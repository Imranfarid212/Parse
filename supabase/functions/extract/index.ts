// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

import { evaluateQuota, refundScan } from '../_shared/quota.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-rf-force-storage-failure, x-rf-fixture-case',
};

const CATEGORIES = [
  'Travel & Transit',
  'Meals & Entertainment',
  'Office Supplies',
  'Software & IT',
  'Vehicle Expenses',
  'Advertising & Marketing',
  'Professional Services',
  'Utilities & Telecom',
  'Inventory & Materials',
  'Miscellaneous',
] as const;

const MODEL_FIXTURE_KEY = 'dummy';
const DEFAULT_XAI_MODEL = 'grok-4.5';
const XAI_CHAT_COMPLETIONS_URL = 'https://api.x.ai/v1/chat/completions';
const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_OPENROUTER_BALANCED_MODEL = 'google/gemini-2.5-flash-lite';
const MAX_IMAGE_BYTES = 2_000_000;
const XAI_MAX_TOKENS = 500;
const JWKS_CACHE_MS = 10 * 60 * 1000;
const JWKS_FORCE_COOLDOWN_MS = 30 * 1000;
const JWKS_NEGATIVE_KID_CACHE_MS = 60 * 1000;
const BOOT_ID = crypto.randomUUID();
const BOOT_AT = Date.now();
let reqCount = 0;

type CaptureMode = 'default' | 'one_click';
type ExtractionMode = 'balanced' | 'precise';
type ExtractionLineItem = { name: string; qty: number; amount: number };
type ExtractionResult = {
  merchant: string;
  txn_date: string;
  currency: string;
  total: number;
  line_items: ExtractionLineItem[];
  suggested_category: string;
  handwritten_notes: string;
  is_receipt: boolean;
};

type ExtractTiming = {
  total_ms?: number;
  grok_ms?: number;
  storage_ms?: number;
  db_ms?: number;
  auth_ms?: number;
  body_ms?: number;
  existing_lookup_ms?: number;
  profile_ms?: number;
  categories_ms?: number;
  quota_ms?: number;
  image_read_ms?: number;
  image_bytes?: number;
  base64_ms?: number;
  duplicate_check_ms?: number;
  duplicate_hydrate_ms?: number;
  duplicate_cleanup_ms?: number;
  duplicate_shadow_ms?: number;
  receipt_upsert_ms?: number;
  items_delete_ms?: number;
  items_insert_ms?: number;
  ledger_ms?: number;
  model_storage_wall_ms?: number;
  server_unaccounted_ms?: number;
  auth_method?: string;
  auth_reason?: string | null;
  jwks_fetch_ms?: number;
  jwks_source?: 'env' | 'fetched' | null;
  boot_id?: string;
  req_count?: number;
  isolate_age_ms?: number;
};

type Jwk = JsonWebKey & { kid?: string; alg?: string };
type AuthOutcome =
  | { ok: true; claims: Record<string, unknown>; source: 'env' | 'fetched'; fetchMs: number }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'unknown_kid' | 'fetch_failed' };

let jwksCache: { keys: Jwk[]; fetchedAt: number; source: 'env' | 'fetched' } | null = null;
let jwksRefreshInFlight: Promise<Jwk[]> | null = null;
let lastForcedJwksFetchAt = 0;
const keyCache = new Map<string, CryptoKey>();
const negativeKidCache = new Map<string, number>();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const isIsoDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isCurrency = (value: unknown) => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const safeNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value));
const toMinorUnits = (value: unknown) => Math.round((safeNumber(value) || 0) * 100);
const normalizeText = (value: unknown, fallback = '') => String(value ?? fallback).trim();
const normalizeMerchantKey = (value: unknown) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(pvt|private|ltd|limited|inc|llc|store|market)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const isFixtureKey = (value: string | null) => !value || value.trim().toLowerCase() === MODEL_FIXTURE_KEY;
const monthNumber = (value: string) =>
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(
    value.toLowerCase().slice(0, 3),
  ) + 1;
const toIsoDate = (value: unknown) => {
  const text = normalizeText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const numeric = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]);
    const day = first > 12 ? first : second > 12 ? second : first;
    const month = first > 12 ? second : second > 12 ? first : second;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const named = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (named) {
    const month = monthNumber(named[1]);
    const day = Number(named[2]);
    if (month >= 1 && day >= 1 && day <= 31) {
      return `${named[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return new Date().toISOString().slice(0, 10);
};
const lineItemFromText = (value: unknown): ExtractionLineItem => {
  const text = normalizeText(value);
  const amountMatch = text.match(/(-?\d+(?:[.,]\d{2})?)\s*$/);
  const amount = amountMatch ? safeNumber(amountMatch[1].replace(',', '.')) || 0 : 0;
  const name = amountMatch ? text.slice(0, amountMatch.index).trim() : text;
  return { name: name.slice(0, 160) || 'Item', qty: 1, amount: Math.max(0, amount) };
};
const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};
const bearerToken = (authorization: string) => authorization.replace(/^Bearer\s+/i, '').trim();

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function base64UrlToJson(value: string) {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(value)));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

const algParams = (alg: string) =>
  alg === 'ES256'
    ? {
        import: { name: 'ECDSA', namedCurve: 'P-256' },
        verify: { name: 'ECDSA', hash: 'SHA-256' },
      }
    : {
        import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        verify: { name: 'RSASSA-PKCS1-v1_5' },
      };

async function cacheJwks(keys: Jwk[], source: 'env' | 'fetched') {
  jwksCache = { keys, fetchedAt: Date.now(), source };
  await Promise.all(
    keys.map(async (jwk) => {
      if (!jwk.kid || (jwk.alg !== 'ES256' && jwk.alg !== 'RS256')) return;
      keyCache.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk, algParams(jwk.alg).import, false, ['verify']));
      negativeKidCache.delete(jwk.kid);
    }),
  );
  console.log('[extract] JWKS cached', { source, key_count: keys.length });
}

const seededJwks = Deno.env.get('JWT_PUBLIC_JWKS') || Deno.env.get('SUPABASE_JWT_PUBLIC_JWKS');
if (seededJwks) {
  try {
    const parsed = JSON.parse(seededJwks);
    const keys = Array.isArray(parsed?.keys) ? parsed.keys as Jwk[] : [];
    await cacheJwks(keys, 'env');
  } catch (error) {
    console.error('[extract] SUPABASE_JWT_PUBLIC_JWKS is malformed', error);
  }
}

async function verifyJwtLocally(jwt: string, secret: string | undefined) {
  try {
    if (!secret) return null;
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const header = base64UrlToJson(parts[0]);
    if (header?.alg !== 'HS256') return null;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signed = `${parts[0]}.${parts[1]}`;
    const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed)));
    const actual = base64UrlDecode(parts[2]);
    if (!timingSafeEqual(expected, actual)) return null;
    const claims = base64UrlToJson(parts[1]);
    const exp = Number(claims?.exp ?? 0);
    if (Number.isFinite(exp) && exp > 0 && exp * 1000 < Date.now()) return null;
    return claims as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function getJwks(supabaseUrl: string, force = false) {
  const now = Date.now();
  if (!force && jwksCache && now - jwksCache.fetchedAt < JWKS_CACHE_MS) return jwksCache.keys;
  if (!jwksRefreshInFlight) {
    jwksRefreshInFlight = fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`JWKS fetch failed with ${response.status}`);
        const body = await response.json();
        const keys = Array.isArray(body?.keys) ? body.keys as Jwk[] : [];
        await cacheJwks(keys, 'fetched');
        return keys;
      })
      .finally(() => {
        jwksRefreshInFlight = null;
      });
  }
  return jwksRefreshInFlight;
}

async function refreshJwksForKid(supabaseUrl: string, kid: string) {
  const now = Date.now();
  const negativeCachedAt = negativeKidCache.get(kid) ?? 0;
  if (now - negativeCachedAt < JWKS_NEGATIVE_KID_CACHE_MS) return { keys: jwksCache?.keys ?? [], fetchMs: 0, skipped: true };
  if (now - lastForcedJwksFetchAt < JWKS_FORCE_COOLDOWN_MS) return { keys: jwksCache?.keys ?? [], fetchMs: 0, skipped: true };
  lastForcedJwksFetchAt = now;
  const fetchStartedAt = performance.now();
  const keys = await getJwks(supabaseUrl, true);
  const fetchMs = Math.round(performance.now() - fetchStartedAt);
  if (!keys.some((key) => key.kid === kid)) negativeKidCache.set(kid, Date.now());
  return { keys, fetchMs, skipped: false };
}

async function verifyJwtWithJwks(jwt: string, supabaseUrl: string): Promise<AuthOutcome> {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'malformed' };
    const header = base64UrlToJson(parts[0]);
    const alg = String(header?.alg ?? '');
    const kid = String(header?.kid ?? '');
    if (!kid || (alg !== 'ES256' && alg !== 'RS256')) return { ok: false, reason: 'malformed' };

    let key = keyCache.get(kid);
    let fetchMs = 0;
    let source = jwksCache?.source ?? 'env';
    if (!key && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_MS) {
      const jwk = jwksCache.keys.find((candidate) => candidate.kid === kid);
      if (jwk?.alg === alg) {
        key = await crypto.subtle.importKey('jwk', jwk, algParams(alg).import, false, ['verify']);
        keyCache.set(kid, key);
      }
    }
    if (!key) {
      const refresh = await refreshJwksForKid(supabaseUrl, kid);
      fetchMs = refresh.fetchMs;
      source = 'fetched';
      key = keyCache.get(kid);
      if (!key) return { ok: false, reason: 'unknown_kid' };
    }

    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlDecode(parts[2]);
    const verified = await crypto.subtle.verify(algParams(alg).verify, key, signature, signed);
    if (!verified) return { ok: false, reason: 'bad_signature' };
    const claims = base64UrlToJson(parts[1]);
    const exp = Number(claims?.exp ?? 0);
    if (Number.isFinite(exp) && exp > 0 && exp * 1000 < Date.now()) return { ok: false, reason: 'expired' };
    return { ok: true, claims: claims as Record<string, unknown>, source, fetchMs };
  } catch {
    return { ok: false, reason: 'fetch_failed' };
  }
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Model did not return JSON');
    return JSON.parse(match[0]);
  }
}

function modelPreview(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);
}

class ModelJsonError extends Error {
  stage: string;
  preview: string;

  constructor(stage: string, raw: unknown, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'ModelJsonError';
    this.stage = stage;
    this.preview = modelPreview(raw);
  }
}

function logModelJsonFailure(stage: string, raw: unknown, error: unknown) {
  console.warn('[extract] model_json_parse_failed', {
    stage,
    message: error instanceof Error ? error.message : String(error),
    preview: modelPreview(raw),
    preview_length: modelPreview(raw).length,
  });
}

function normalizeExtraction(raw: unknown, categories: string[], defaultCurrency: string): ExtractionResult {
  if (!raw || typeof raw !== 'object') throw new Error('Extraction result must be an object');
  const r = raw as Record<string, unknown>;
  if (r.error === 'not_a_receipt') {
    return {
      merchant: 'Rejected image',
      txn_date: new Date().toISOString().slice(0, 10),
      currency: defaultCurrency,
      total: 0,
      line_items: [],
      suggested_category: 'Miscellaneous',
      handwritten_notes: '',
      is_receipt: false,
    };
  }
  const isReceipt = r.is_receipt !== false;

  const lineItems = Array.isArray(r.line_items)
    ? r.line_items.map((item) => {
        const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        return {
          name: normalizeText(row.name).slice(0, 160) || 'Item',
          qty: Math.max(0.01, safeNumber(row.qty ?? 1) || 1),
          amount: Math.max(0, safeNumber(row.amount) || 0),
        };
      })
    : [];

  const promptItems = Array.isArray(r.items) ? r.items.map(lineItemFromText) : [];
  const category = normalizeText(r.suggested_category ?? r.category);
  return {
    merchant: normalizeText(r.merchant ?? r.store, isReceipt ? 'Unknown merchant' : 'Rejected image').slice(0, 160),
    txn_date: isIsoDate(r.txn_date) ? String(r.txn_date) : toIsoDate(r.date),
    currency: isCurrency(r.currency) ? String(r.currency) : defaultCurrency,
    total: Math.max(0, safeNumber(r.total) || 0),
    line_items: lineItems.length > 0 ? lineItems : promptItems,
    suggested_category: categories.includes(category) ? category : 'Miscellaneous',
    handwritten_notes: normalizeText(r.handwritten_notes ?? r.notes).slice(0, 1000),
    is_receipt: isReceipt,
  };
}

function fixtureExtraction(caseName: string | null): ExtractionResult | string {
  if (caseName === 'malformed') {
    return '{"merchant":"Whole Foods Market","txn_date":"2026-07-01","currency":"USD","total":73.36,"line_items":[{"name":"Organic bananas 1.2 lb","qty":1,"amount":1.74}],"suggested_category":"Meals & Entertainment","is_receipt":true';
  }
  if (caseName === 'non_receipt') {
    return {
      merchant: 'Rejected image',
      txn_date: '2026-07-01',
      currency: 'USD',
      total: 0,
      line_items: [],
      suggested_category: 'Miscellaneous',
      handwritten_notes: '',
      is_receipt: false,
    };
  }
  if (caseName === 'off_list') {
    return {
      merchant: 'City Hardware',
      txn_date: '2026-07-01',
      currency: 'USD',
      total: 28.42,
      line_items: [{ name: 'Shelf brackets', qty: 2, amount: 28.42 }],
      suggested_category: 'Home Improvement',
      handwritten_notes: '',
      is_receipt: true,
    };
  }
  return {
    merchant: 'Whole Foods Market',
    txn_date: '2026-07-01',
    currency: 'USD',
    total: 73.36,
    line_items: [{ name: 'Organic bananas 1.2 lb', qty: 1, amount: 1.74 }],
    suggested_category: 'Meals & Entertainment',
    handwritten_notes: '',
    is_receipt: true,
  };
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function buildPrompt(categories: string[], defaultCurrency: string) {
  const categoryLines = categories.map((name) => `- ${JSON.stringify(name)}`).join('\n');
  return [
    'Analyze this photo of a receipt. Extract only the fields below. Be terse.',
    'Categorize the transaction into exactly ONE of these options:',
    categoryLines,
    'Return ONLY JSON matching this exact structure, retaining keys:',
    '{',
    '  "date": "purchase date as printed",',
    '  "store": "merchant name",',
    '  "place": "city or location if printed, else empty string",',
    '  "items": ["one short entry per line item: item name and price only"],',
    '  "total": 0.00,',
    '  "category": "one of the options above",',
    '  "handwritten_notes": "any handwritten text, else empty string"',
    '}',
    'Handwritten note handling is important: inspect the whole image for handwriting,',
    'including margins, blank areas, the back/side of the receipt, signatures, names,',
    'initials, tips, table notes, corrections, or short labels. Transcribe handwriting',
    'verbatim into handwritten_notes even if it is not part of the printed receipt.',
    'Do not copy printed receipt text into handwritten_notes. Use an empty string only',
    'when you are confident there is no handwriting visible.',
    'Do not include greetings or thank-you text, tax breakdowns (GST/HST/PST),',
    'subtotals, invoice/table/receipt/terminal numbers, card or payment details,',
    'or loyalty points — not in any field. No text outside the JSON.',
    `The user's default currency is ${defaultCurrency}; use it when the receipt does not clearly imply another currency.`,
    'If the receipt shows a city, country, address, phone country code, tax system, or currency symbol that clearly indicates a different country/currency, infer and return that local ISO 4217 currency instead of the user default.',
    'Do not convert amounts between currencies; only choose the correct currency code for the printed receipt.',
    'If the image does not show a receipt, invoice, bill, or similar financial',
    'document, return exactly: {"error": "not_a_receipt"}',
  ].join('\n');
}

function buildTextPrompt(ocrText: string, categories: string[], defaultCurrency: string) {
  return [
    'Return ONLY a raw JSON object. No markdown fences. No prose.',
    'Extract from this OCR text. If the text is not a receipt, invoice, bill,',
    'or similar financial document, return exactly: {"error": "not_a_receipt"}',
    '',
    buildPrompt(categories, defaultCurrency),
    '',
    'OCR text:',
    ocrText.slice(0, 12_000),
  ].join('\n');
}

function extractionResponseFormat(categories: string[]) {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'receipt_extraction',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['merchant', 'txn_date', 'currency', 'total', 'line_items', 'suggested_category', 'is_receipt'],
        properties: {
          merchant: { type: 'string' },
          txn_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          currency: { type: 'string', pattern: '^[A-Z]{3}$' },
          total: { type: 'number', minimum: 0 },
          line_items: {
            type: 'array',
            maxItems: 24,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'qty', 'amount'],
              properties: {
                name: { type: 'string' },
                qty: { type: 'number', minimum: 0 },
                amount: { type: 'number', minimum: 0 },
              },
            },
          },
          suggested_category: { type: 'string', enum: categories },
          is_receipt: { type: 'boolean' },
        },
      },
    },
  };
}

async function callGrok(
  imageBytes: Uint8Array,
  imageType: string,
  categories: string[],
  defaultCurrency: string,
  timing?: ExtractTiming,
  signal?: AbortSignal,
) {
  const apiKey = Deno.env.get('XAI_API_KEY');
  const model = Deno.env.get('XAI_MODEL') || DEFAULT_XAI_MODEL;
  const fixtureCase = Deno.env.get('RF_EXTRACT_FIXTURE_CASE');
  if (isFixtureKey(apiKey)) return fixtureExtraction(fixtureCase);

  const base64StartedAt = performance.now();
  const base64 = bytesToBase64(imageBytes);
  if (timing) timing.base64_ms = Math.round(performance.now() - base64StartedAt);
  const response = await fetch(XAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: XAI_MAX_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildPrompt(categories, defaultCurrency) },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract.' },
            { type: 'image_url', image_url: { url: `data:${imageType};base64,${base64}` } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`Grok failed with ${response.status}`);
  const body = await response.json();
  return body?.choices?.[0]?.message?.content ?? '';
}

async function repairExtraction(raw: unknown, categories: string[], defaultCurrency: string): Promise<unknown> {
  if (typeof raw !== 'string') return raw;
  const apiKey = Deno.env.get('XAI_API_KEY');
  if (isFixtureKey(apiKey)) return parseJsonObject(`${raw}}`);

  const response = await fetch(XAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: Deno.env.get('XAI_MODEL') || DEFAULT_XAI_MODEL,
      temperature: 0,
      max_tokens: XAI_MAX_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildPrompt(categories, defaultCurrency) },
        { role: 'user', content: `Repair this malformed JSON into the exact extraction schema:\n${raw}` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Grok repair failed with ${response.status}`);
  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content ?? '';
  try {
    return parseJsonObject(content);
  } catch (error) {
    logModelJsonFailure('grok_repair', content, error);
    throw new ModelJsonError('grok_repair', content, error);
  }
}

async function extractWithGrok(
  imageBytes: Uint8Array,
  imageType: string,
  categories: string[],
  defaultCurrency: string,
  timing?: ExtractTiming,
) {
  const timeoutMs = Number(Deno.env.get('GROK_TIMEOUT_MS') || 3500);
  let raw: unknown;
  try {
    raw = await withTimeout(timeoutMs, (signal) => callGrok(imageBytes, imageType, categories, defaultCurrency, timing, signal));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Grok timed out after ${timeoutMs}ms`);
    }
    if (error instanceof Error && /aborted/i.test(error.message)) {
      throw new Error(`Grok timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
  try {
    const parsed = typeof raw === 'string' ? parseJsonObject(raw) : raw;
    return normalizeExtraction(parsed, categories, defaultCurrency);
  } catch (error) {
    if (typeof raw === 'string') logModelJsonFailure('grok_primary', raw, error);
    try {
      const repaired = await repairExtraction(raw, categories, defaultCurrency);
      return normalizeExtraction(repaired, categories, defaultCurrency);
    } catch (repairError) {
      if (repairError instanceof ModelJsonError) throw repairError;
      throw new ModelJsonError('grok_primary', raw, error);
    }
  }
}

async function callOpenRouterText(
  model: string,
  ocrText: string,
  categories: string[],
  defaultCurrency: string,
  signal?: AbortSignal,
) {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  const fixtureCase = Deno.env.get('RF_EXTRACT_FIXTURE_CASE');
  if (apiKey?.trim().toLowerCase() === MODEL_FIXTURE_KEY) return fixtureExtraction(fixtureCase);
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

  const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://receiptflow.app',
      'X-Title': 'Parse Receipt Scanner',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 320,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You extract receipt data. You must return only a valid JSON object.' },
        { role: 'user', content: buildTextPrompt(ocrText, categories, defaultCurrency) },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenRouter ${model} failed with ${response.status}`);
  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error(`OpenRouter ${model} returned empty content`);
  return content;
}

async function extractWithOpenRouterText(ocrText: string, categories: string[], defaultCurrency: string) {
  const timeoutMs = Number(Deno.env.get('OPENROUTER_TIMEOUT_MS') || 3500);
  const model = Deno.env.get('OPENROUTER_BALANCED_MODEL') || DEFAULT_OPENROUTER_BALANCED_MODEL;
  let raw: unknown;

  raw = await withTimeout(timeoutMs, (signal) => callOpenRouterText(model, ocrText, categories, defaultCurrency, signal));

  try {
    return normalizeExtraction(typeof raw === 'string' ? parseJsonObject(raw) : raw, categories, defaultCurrency);
  } catch {
    const repaired = await repairExtraction(raw, categories, defaultCurrency);
    return normalizeExtraction(repaired, categories, defaultCurrency);
  }
}

function rejectEmptyExtraction(extraction: ExtractionResult) {
  return (
    extraction.is_receipt &&
    !normalizeText(extraction.merchant) &&
    extraction.total <= 0 &&
    extraction.line_items.length === 0
  );
}

function waitUntil(promise: Promise<unknown>) {
  const runtime = (globalThis as Record<string, unknown>).EdgeRuntime as { waitUntil?: (promise: Promise<unknown>) => void } | undefined;
  if (runtime?.waitUntil) {
    runtime.waitUntil(promise);
    return;
  }
  promise.catch((error) => console.error('[extract] background task failed', error));
}

function finishTiming(timing: ExtractTiming, startedAt: number) {
  timing.total_ms = Math.round(performance.now() - startedAt);
  timing.model_storage_wall_ms = Math.max(timing.grok_ms ?? 0, timing.storage_ms ?? 0);
  const known =
    (timing.model_storage_wall_ms ?? 0) +
    (timing.db_ms ?? 0) +
    (timing.auth_ms ?? 0) +
    (timing.body_ms ?? 0) +
    (timing.existing_lookup_ms ?? 0) +
    (timing.profile_ms ?? 0) +
    (timing.categories_ms ?? 0) +
    (timing.quota_ms ?? 0) +
    (timing.image_read_ms ?? 0);
  timing.server_unaccounted_ms = Math.max(0, timing.total_ms - known);
}

async function logDuplicateShadowEvent({
  admin,
  userId,
  captureId,
  extraction,
  duplicate,
  action,
}: {
  admin: ReturnType<typeof createClient>;
  userId: string;
  captureId: string;
  extraction: ExtractionResult;
  duplicate: {
    id: string;
    merchant: string | null;
    txn_date: string | null;
    currency: string | null;
    total: number | string | null;
  };
  action: 'duplicate_returned' | 'save_anyway';
}) {
  const total = Math.round(extraction.total * 100) / 100;
  const merchantKey = normalizeMerchantKey(extraction.merchant);
  const matchedMerchantKey = normalizeMerchantKey(duplicate.merchant);
  if (!merchantKey || !extraction.txn_date || !extraction.currency || total <= 0) return;

  const { error } = await admin.from('duplicate_shadow_events').upsert(
    {
      user_id: userId,
      capture_id: captureId,
      receipt_id: null,
      matched_receipt_id: duplicate.id,
      match_rule: 'merchant_date_currency_total',
      match_strength: 'weak',
      action,
      merchant: extraction.merchant,
      merchant_key: merchantKey,
      matched_merchant: duplicate.merchant,
      matched_merchant_key: matchedMerchantKey,
      txn_date: extraction.txn_date,
      currency: extraction.currency,
      total_minor_units: toMinorUnits(total),
      total,
      matched_total: Number(duplicate.total) || null,
    },
    { onConflict: 'user_id,capture_id,matched_receipt_id,match_rule' },
  );
  if (error) throw error;
}

async function persistBalancedResult({
  admin,
  userId,
  receiptId,
  captureId,
  mode,
  extraction,
  categoryId,
  imagePath,
  imageSize,
  ackedAt,
}: {
  admin: ReturnType<typeof createClient>;
  userId: string;
  receiptId: string;
  captureId: string;
  mode: CaptureMode;
  extraction: ExtractionResult;
  categoryId: number;
  imagePath: string | null;
  imageSize: number | null;
  ackedAt: string;
}) {
  const status = extraction.is_receipt ? (mode === 'one_click' ? 'confirmed' : 'needs_review') : 'rejected';
  const confirmedVia = extraction.is_receipt && mode === 'one_click' ? 'auto' : null;

  const { error: receiptError } = await admin.from('receipts').upsert(
    {
      id: receiptId,
      user_id: userId,
      capture_id: captureId,
      capture_mode: mode,
      extraction_mode: 'balanced',
      status,
      confirmed_via: confirmedVia,
      provider: 'gemini',
      image_path: imagePath,
      image_byte_size: imageSize,
      merchant: extraction.is_receipt ? extraction.merchant : null,
      txn_date: extraction.is_receipt ? extraction.txn_date : null,
      currency: extraction.currency,
      total: extraction.is_receipt ? extraction.total : null,
      category_id: categoryId,
      notes: extraction.is_receipt ? extraction.handwritten_notes || null : null,
      acked_at: ackedAt,
    },
    { onConflict: 'capture_id' },
  );
  if (receiptError) throw receiptError;

  await admin.from('receipt_items').delete().eq('receipt_id', receiptId);
  if (extraction.is_receipt && extraction.line_items.length > 0) {
    const { error: itemsError } = await admin.from('receipt_items').insert(
      extraction.line_items.map((item) => ({
        receipt_id: receiptId,
        name: item.name,
        qty: item.qty,
        amount: item.amount,
      })),
    );
    if (itemsError) throw itemsError;
  }

  // Charged by can_scan() before the model ran; give it back if the image was
  // not a receipt.
  if (!extraction.is_receipt) {
    await refundScan(admin, userId, captureId);
  }
}

async function handleExtract(req: Request) {
  reqCount += 1;
  const startedAt = performance.now();
  const timing: ExtractTiming = {
    boot_id: BOOT_ID,
    req_count: reqCount,
    isolate_age_ms: Date.now() - BOOT_AT,
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { code: 'VALIDATION_FAILED', message: 'POST required' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, { code: 'VALIDATION_FAILED', message: 'Supabase server env missing' });
  }

  const authorization = req.headers.get('Authorization') ?? '';
  const userSupabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const authStartedAt = performance.now();
  const jwt = bearerToken(authorization);
  let userId = '';
  let authMethod = 'local_jwks';
  let localClaims: Record<string, unknown> | null = null;
  const jwksOutcome = jwt ? await verifyJwtWithJwks(jwt, supabaseUrl) : { ok: false, reason: 'malformed' } as AuthOutcome;
  timing.jwks_source = jwksOutcome.ok ? jwksOutcome.source : null;
  timing.jwks_fetch_ms = jwksOutcome.ok ? jwksOutcome.fetchMs : 0;
  timing.auth_reason = jwksOutcome.ok ? null : jwksOutcome.reason;
  if (jwksOutcome.ok) {
    localClaims = jwksOutcome.claims;
    authMethod = `local_jwks_${jwksOutcome.source}`;
  } else if (jwksOutcome.reason === 'bad_signature' || jwksOutcome.reason === 'expired') {
    timing.auth_ms = Math.round(performance.now() - authStartedAt);
    timing.auth_method = 'rejected';
    return json(401, { code: 'VALIDATION_FAILED', message: 'Authentication required', timing });
  }
  if (!localClaims) {
    authMethod = 'local_hs256';
    localClaims = jwt ? await verifyJwtLocally(jwt, Deno.env.get('SUPABASE_JWT_SECRET') || Deno.env.get('JWT_SECRET')) : null;
  }
  userId = String(localClaims?.sub ?? '');
  if (!isUuid(userId)) {
    authMethod = 'claims';
    const { data: claimsData, error: claimsError } = jwt
      ? await userSupabase.auth.getClaims(jwt)
      : { data: null, error: new Error('Missing bearer token') };
    userId = String(claimsData?.claims?.sub ?? '');
    if (claimsError || !isUuid(userId)) {
      authMethod = 'getUser';
      const { data: userData, error: userError } = await userSupabase.auth.getUser();
      if (userError || !userData.user) {
        timing.auth_ms = Math.round(performance.now() - authStartedAt);
        timing.auth_method = authMethod;
        return json(401, { code: 'VALIDATION_FAILED', message: 'Authentication required', timing });
      }
      userId = userData.user.id;
    }
  }
  timing.auth_ms = Math.round(performance.now() - authStartedAt);
  timing.auth_method = authMethod;

  const contentType = req.headers.get('content-type') ?? '';
  const isJson = contentType.toLowerCase().includes('application/json');
  const bodyStartedAt = performance.now();
  const body = isJson ? await req.json().catch(() => null) : null;
  let form: FormData | null = null;
  if (!isJson) {
    try {
      form = await req.formData();
    } catch {
      return json(400, {
        code: 'VALIDATION_FAILED',
        message: 'Request body must be JSON for Balanced text extraction or multipart form data for image upload.',
      });
    }
  }
  timing.body_ms = Math.round(performance.now() - bodyStartedAt);
  if (isJson && body?.warm_up === true) {
    finishTiming(timing, startedAt);
    return json(200, { status: 200, warm: true, timing });
  }
  const captureId = String((isJson ? body?.capture_id : form?.get('capture_id')) ?? '');
  const mode = String((isJson ? body?.mode : form?.get('mode')) ?? '') as CaptureMode;
  const extractionMode = String((isJson ? body?.extraction_mode : form?.get('extraction_mode')) || 'precise') as ExtractionMode;
  const capturedAt = String((isJson ? body?.captured_at : form?.get('captured_at')) ?? '');
  const extractedText = String((isJson ? body?.extracted_text : form?.get('extracted_text')) ?? '').trim();
  const duplicateOfRaw = String((isJson ? body?.duplicate_of ?? body?.duplicateOf : form?.get('duplicate_of')) ?? '');
  const duplicateOf = isUuid(duplicateOfRaw) ? duplicateOfRaw : null;
  const duplicateMatchStrengthRaw = String(
    (isJson ? body?.duplicate_match_strength ?? body?.duplicateMatchStrength : form?.get('duplicate_match_strength')) ?? '',
  );
  const duplicateMatchStrength =
    duplicateMatchStrengthRaw === 'weak' || duplicateMatchStrengthRaw === 'strong' ? duplicateMatchStrengthRaw : null;
  const duplicateOverrideRaw = isJson ? body?.duplicate_override ?? body?.duplicateOverride : form?.get('duplicate_override');
  const duplicateOverride = duplicateOverrideRaw === true || String(duplicateOverrideRaw) === '1' || String(duplicateOverrideRaw) === 'true';
  const uploadOnly = String(form?.get('upload_only') ?? '') === '1';
  const image = form?.get('image') ?? null;
  if (image instanceof File) timing.image_bytes = image.size;

  if (!isUuid(captureId)) return json(400, { code: 'VALIDATION_FAILED', message: 'capture_id must be a v4 UUID' });
  if (mode !== 'default' && mode !== 'one_click') {
    return json(400, { code: 'VALIDATION_FAILED', message: 'mode must be default or one_click' });
  }
  if (extractionMode !== 'balanced' && extractionMode !== 'precise') {
    return json(400, { code: 'VALIDATION_FAILED', message: 'extraction_mode must be balanced or precise' });
  }
  if (!capturedAt || Number.isNaN(Date.parse(capturedAt))) {
    return json(400, { code: 'VALIDATION_FAILED', message: 'captured_at must be an ISO datetime' });
  }
  const textOnlyBalanced = extractionMode === 'balanced' && Boolean(extractedText) && !uploadOnly;
  if (!textOnlyBalanced) {
    if (!(image instanceof File)) return json(400, { code: 'VALIDATION_FAILED', message: 'image file required' });
    if (image.type !== 'image/jpeg') return json(400, { code: 'VALIDATION_FAILED', message: 'image must be JPEG' });
    if (image.size > MAX_IMAGE_BYTES) return json(400, { code: 'VALIDATION_FAILED', message: 'image too large' });
  }

  const imagePath = `${userId}/${captureId}.jpg`;

  const existingLookupStartedAt = performance.now();
  const { data: existing } = await admin
    .from('receipts')
    .select('id, status, image_path, acked_at, merchant, txn_date, currency, total, category_id, notes')
    .eq('capture_id', captureId)
    .maybeSingle();
  timing.existing_lookup_ms = Math.round(performance.now() - existingLookupStartedAt);
  if (uploadOnly && image instanceof File) {
    const storageStartedAt = performance.now();
    const bytes = new Uint8Array(await image.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from('receipts')
      .upload(imagePath, bytes, { contentType: 'image/jpeg', upsert: true });
    timing.storage_ms = Math.round(performance.now() - storageStartedAt);
    if (uploadError) return json(503, { code: 'VALIDATION_FAILED', message: uploadError.message });

    const ackedAt = new Date().toISOString();
    const { error: receiptError } = await admin
      .from('receipts')
      .update({ image_path: imagePath, image_byte_size: image.size, acked_at: ackedAt })
      .eq('capture_id', captureId)
      .eq('user_id', userId);
    if (receiptError) return json(500, { code: 'VALIDATION_FAILED', message: receiptError.message });

    finishTiming(timing, startedAt);
    return json(200, { status: 200, receipt_id: existing?.id ?? captureId, image_path: imagePath, acked_at: ackedAt, timing });
  }

  if (existing && existing.status !== 'processing') {
    const dbStartedAt = performance.now();
    const { data: items } = await admin.from('receipt_items').select('name, qty, amount').eq('receipt_id', existing.id);
    const { data: category } = await admin.from('categories').select('name').eq('id', existing.category_id).maybeSingle();
    const rejected = existing.status === 'rejected';
    timing.db_ms = Math.round(performance.now() - dbStartedAt);
    finishTiming(timing, startedAt);
    return json(200, {
      status: 200,
      receipt_id: existing.id,
      image_path: existing.image_path ?? imagePath,
      acked_at: existing.acked_at,
      rejected,
      timing,
      result: {
        merchant: existing.merchant ?? (rejected ? 'Rejected image' : ''),
        txn_date: existing.txn_date ?? new Date().toISOString().slice(0, 10),
        currency: existing.currency ?? 'USD',
        total: Number(existing.total) || 0,
        line_items: items ?? [],
        suggested_category: category?.name ?? 'Miscellaneous',
        handwritten_notes: existing.notes ?? '',
        is_receipt: !rejected,
      },
    });
  }

  if (textOnlyBalanced) {
    const defaultCurrency = 'USD';
    const categories = [...CATEGORIES];
    const categoryId = 10;
    const modelStartedAt = performance.now();
    const extraction = await extractWithOpenRouterText(extractedText, categories, defaultCurrency);
    timing.grok_ms = Math.round(performance.now() - modelStartedAt);
    if (rejectEmptyExtraction(extraction)) {
      finishTiming(timing, startedAt);
      return json(422, {
        code: 'VALIDATION_FAILED',
        message: 'Extraction returned empty receipt fields',
        timing,
      });
    }

    const receiptId = crypto.randomUUID();
    const ackedAt = new Date().toISOString();
    finishTiming(timing, startedAt);

    waitUntil(
      persistBalancedResult({
        admin,
        userId,
        receiptId,
        captureId,
        mode,
        extraction,
        categoryId,
        imagePath: null,
        imageSize: null,
        ackedAt,
      }),
    );

    return json(200, {
      status: 200,
      receipt_id: receiptId,
      image_path: imagePath,
      acked_at: ackedAt,
      timing,
      result: extraction,
    });
  }

  const profileStartedAt = performance.now();
  const profilePromise = userSupabase
    .from('profiles')
    .select('default_currency')
    .eq('id', userId)
    .single()
    .then((result) => {
      timing.profile_ms = Math.round(performance.now() - profileStartedAt);
      return result;
    });

  const categoriesStartedAt = performance.now();
  const categoriesPromise = userSupabase
    .from('user_categories')
    .select('categories(id, name, is_system)')
    .eq('user_id', userId)
    .then((result) => {
      timing.categories_ms = Math.round(performance.now() - categoriesStartedAt);
      return result;
    });

  const quotaStartedAt = performance.now();
  // Shared with extract-balanced so the two modes can never enforce different
  // limits — see functions/_shared/quota.ts.
  const quotaPromise = evaluateQuota(admin, userId, captureId).then((verdict) => {
    timing.quota_ms = Math.round(performance.now() - quotaStartedAt);
    return verdict;
  });

  const [
    { data: profile, error: profileError },
    { data: selectedCategories, error: categoriesError },
    quota,
  ] = await Promise.all([profilePromise, categoriesPromise, quotaPromise]);

  if (profileError) return json(500, { code: 'VALIDATION_FAILED', message: profileError.message });
  const defaultCurrency = profile.default_currency ?? 'USD';

  if (categoriesError) return json(500, { code: 'VALIDATION_FAILED', message: categoriesError.message });
  const categoryRows = (selectedCategories ?? []).map((row) => row.categories).filter(Boolean);
  const categories = Array.from(new Set([...categoryRows.map((row) => row.name), 'Miscellaneous']));
  const categoryByName = new Map(categoryRows.map((row) => [row.name, row.id]));

  if (!quota.canScan) {
    // Too fast is not out of scans: 429 is retryable, 402 is a verdict.
    if (quota.reason === 'rate_limited') {
      return json(429, { status: 429, code: 'RATE_LIMITED', retry_after_s: 60 });
    }
    return json(402, { status: 402, code: 'QUOTA_EXHAUSTED', paywall: quota.paywall });
  }

  if (req.headers.get('x-rf-force-storage-failure') === '1') {
    return json(503, { code: 'VALIDATION_FAILED', message: 'Forced Storage failure' });
  }

  const imageReadStartedAt = performance.now();
  const bytes = image instanceof File ? new Uint8Array(await image.arrayBuffer()) : null;
  timing.image_read_ms = Math.round(performance.now() - imageReadStartedAt);
  const storageStartedAt = performance.now();
  const storagePromise = image instanceof File
    ? admin.storage.from('receipts').upload(imagePath, bytes!, { contentType: 'image/jpeg', upsert: true }).then((result) => {
        timing.storage_ms = Math.round(performance.now() - storageStartedAt);
        return result;
      })
    : Promise.resolve({ error: null });
  const grokStartedAt = performance.now();
  const extractionPromise = extractionMode === 'balanced' && extractedText
    ? extractWithOpenRouterText(extractedText, categories, defaultCurrency)
    : extractWithGrok(bytes!, image instanceof File ? image.type : 'image/jpeg', categories, defaultCurrency, timing);
  const grokPromise = extractionPromise.then((result) => {
    timing.grok_ms = Math.round(performance.now() - grokStartedAt);
    return result;
  });
  const [{ error: uploadError }, extraction] = await Promise.all([
    storagePromise,
    grokPromise,
  ]);
  if (uploadError) return json(503, { code: 'VALIDATION_FAILED', message: uploadError.message });

  const ackedAt = new Date().toISOString();
  const categoryId = categoryByName.get(extraction.suggested_category) ?? categoryByName.get('Miscellaneous') ?? 10;
  const dbStartedAt = performance.now();
  if (rejectEmptyExtraction(extraction)) {
    finishTiming(timing, startedAt);
    return json(422, {
      code: 'VALIDATION_FAILED',
      message: 'Extraction returned empty receipt fields',
      timing,
    });
  }

  if (extraction.is_receipt && !duplicateOverride) {
    const total = Math.round(extraction.total * 100) / 100;
    const duplicateStartedAt = performance.now();
    const { data: candidates, error: duplicateError } = await admin
      .from('receipts')
      .select('id, status, image_path, acked_at, merchant, txn_date, currency, total, category_id')
      .eq('user_id', userId)
      .neq('capture_id', captureId)
      .is('deleted_at', null)
      .in('status', ['needs_review', 'confirmed'])
      .eq('txn_date', extraction.txn_date)
      .eq('currency', extraction.currency)
      .gte('total', total - 0.01)
      .lte('total', total + 0.01)
      .limit(10);
    timing.duplicate_check_ms = Math.round(performance.now() - duplicateStartedAt);
    if (duplicateError) return json(500, { code: 'VALIDATION_FAILED', message: duplicateError.message });

    const merchantKey = normalizeMerchantKey(extraction.merchant);
    const duplicate = (candidates ?? []).find((candidate) => normalizeMerchantKey(candidate.merchant) === merchantKey);
    if (duplicate) {
      const shadowStartedAt = performance.now();
      try {
        await logDuplicateShadowEvent({
          admin,
          userId,
          captureId,
          extraction,
          duplicate,
          action: 'duplicate_returned',
        });
      } catch (error) {
        console.error('[extract] duplicate shadow log failed', { capture_id: captureId, error: shortError(error) });
      }
      timing.duplicate_shadow_ms = Math.round(performance.now() - shadowStartedAt);
      const cleanupStartedAt = performance.now();
      if (image instanceof File) await admin.storage.from('receipts').remove([imagePath]);
      timing.duplicate_cleanup_ms = Math.round(performance.now() - cleanupStartedAt);
      const hydrateStartedAt = performance.now();
      const { data: items } = await admin.from('receipt_items').select('name, qty, amount').eq('receipt_id', duplicate.id);
      const { data: category } = await admin.from('categories').select('name').eq('id', duplicate.category_id).maybeSingle();
      timing.duplicate_hydrate_ms = Math.round(performance.now() - hydrateStartedAt);
      timing.db_ms = Math.round(performance.now() - dbStartedAt);
      finishTiming(timing, startedAt);
      return json(200, {
        status: 200,
        receipt_id: duplicate.id,
        image_path: duplicate.image_path,
        acked_at: duplicate.acked_at ?? ackedAt,
        duplicate: true,
        timing,
        result: {
          merchant: duplicate.merchant ?? extraction.merchant,
          txn_date: duplicate.txn_date ?? extraction.txn_date,
          currency: duplicate.currency ?? extraction.currency,
          total: Number(duplicate.total) || extraction.total,
          line_items: items ?? extraction.line_items,
          suggested_category: category?.name ?? extraction.suggested_category,
          is_receipt: true,
        },
      });
    }
  }

  const status = extraction.is_receipt ? (mode === 'one_click' ? 'confirmed' : 'needs_review') : 'rejected';
  const confirmedVia = extraction.is_receipt && mode === 'one_click' ? 'auto' : null;

  const receiptUpsertStartedAt = performance.now();
  const { data: receipt, error: receiptError } = await admin
    .from('receipts')
    .upsert(
      {
        user_id: userId,
        capture_id: captureId,
        capture_mode: mode,
        extraction_mode: extractionMode,
        status,
        confirmed_via: confirmedVia,
        provider: extractionMode === 'balanced' && extractedText ? 'gemini' : 'grok',
        image_path: extraction.is_receipt && image instanceof File ? imagePath : null,
        image_byte_size: image instanceof File ? image.size : null,
        merchant: extraction.is_receipt ? extraction.merchant : null,
        txn_date: extraction.is_receipt ? extraction.txn_date : null,
        currency: extraction.currency,
        total: extraction.is_receipt ? extraction.total : null,
        category_id: categoryId,
        notes: extraction.is_receipt ? extraction.handwritten_notes || null : null,
        duplicate_of: duplicateOf,
        duplicate_match_strength: duplicateOf ? duplicateMatchStrength : null,
        acked_at: ackedAt,
      },
      { onConflict: 'capture_id' },
    )
    .select('id')
    .single();
  timing.receipt_upsert_ms = Math.round(performance.now() - receiptUpsertStartedAt);
  if (receiptError) return json(500, { code: 'VALIDATION_FAILED', message: receiptError.message });

  const itemsDeleteStartedAt = performance.now();
  await admin.from('receipt_items').delete().eq('receipt_id', receipt.id);
  timing.items_delete_ms = Math.round(performance.now() - itemsDeleteStartedAt);
  if (extraction.is_receipt && extraction.line_items.length > 0) {
    const itemsInsertStartedAt = performance.now();
    const { error: itemsError } = await admin.from('receipt_items').insert(
      extraction.line_items.map((item) => ({
        receipt_id: receipt.id,
        name: item.name,
        qty: item.qty,
        amount: item.amount,
      })),
    );
    timing.items_insert_ms = Math.round(performance.now() - itemsInsertStartedAt);
    if (itemsError) return json(500, { code: 'VALIDATION_FAILED', message: itemsError.message });
  }

  if (!extraction.is_receipt) {
    if (image instanceof File) await admin.storage.from('receipts').remove([imagePath]);
    timing.db_ms = Math.round(performance.now() - dbStartedAt);
    finishTiming(timing, startedAt);
    return json(200, {
      status: 200,
      receipt_id: receipt.id,
      image_path: imagePath,
      acked_at: ackedAt,
      rejected: true,
      timing,
      result: extraction,
    });
  }

  // The debit happened in can_scan() before any model spend; nothing to do here.
  timing.ledger_ms = 0;

  timing.db_ms = Math.round(performance.now() - dbStartedAt);
  finishTiming(timing, startedAt);
  return json(200, {
    status: 200,
    receipt_id: receipt.id,
    image_path: imagePath,
    acked_at: ackedAt,
    // Refreshes the client's cached balance off a call it already made. The
    // verdict predates this scan's debit, so account for it here.
    scans_remaining: quota.remaining == null ? null : Math.max(0, quota.remaining - 1),
    timing,
    result: extraction,
  });
}

Deno.serve(async (req) => {
  try {
    return await handleExtract(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const debug =
      error instanceof ModelJsonError
        ? {
            model_parse_stage: error.stage,
            model_preview: error.preview,
            model_preview_length: error.preview.length,
          }
        : {};
    return json(500, { code: 'VALIDATION_FAILED', message, ...debug });
  }
});
