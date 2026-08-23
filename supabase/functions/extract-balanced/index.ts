// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

import { isActiveDevice, isDeviceId } from '../_shared/device.ts';

import {
  getUserCategories,
  MISCELLANEOUS,
  resolveCategoryId,
  type UserCategories,
} from '../_shared/categories.ts';
import { evaluateQuota, refundScan, type ScanVerdict } from '../_shared/quota.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-rf-device-id',
};

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GEMINI_GENERATE_CONTENT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_OPENROUTER_BALANCED_MODEL = 'google/gemini-3.5-flash-lite';
const DEFAULT_OPENROUTER_BALANCED_SECONDARY_MODEL = 'google/gemini-2.5-flash-lite';
const DEFAULT_GEMINI_BALANCED_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_GEMINI_BALANCED_SECONDARY_MODEL = 'gemini-2.5-flash-lite';
const DEFAULT_OPENROUTER_MAX_TOKENS = 1000;
const DEFAULT_HEDGE_DELAY_MS = 0;
const MODEL_FIXTURE_KEY = 'dummy';
const JWKS_CACHE_MS = 10 * 60 * 1000;
const JWKS_FORCE_COOLDOWN_MS = 30 * 1000;
const JWKS_NEGATIVE_KID_CACHE_MS = 60 * 1000;
const BOOT_ID = crypto.randomUUID();
const BOOT_AT = Date.now();
let reqCount = 0;

type CaptureMode = 'default' | 'one_click';
type ExtractionLineItem = { name: string; qty: number; amount: number };
type ExtractionResult = {
  merchant: string;
  txn_date: string;
  currency: string;
  total: number;
  line_items: ExtractionLineItem[];
  suggested_category: string;
  is_receipt: boolean;
};
type DuplicateCandidate = {
  matched_receipt_id: string;
  match_rule: 'merchant_date_currency_total';
  match_strength: 'weak';
  merchant: string | null;
  txn_date: string | null;
  currency: string | null;
  total: number;
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
  console.log('[extract-balanced] JWKS cached', { source, key_count: keys.length });
}

const seededJwks = Deno.env.get('JWT_PUBLIC_JWKS') || Deno.env.get('SUPABASE_JWT_PUBLIC_JWKS');
if (seededJwks) {
  try {
    const parsed = JSON.parse(seededJwks);
    const keys = Array.isArray(parsed?.keys) ? parsed.keys as Jwk[] : [];
    await cacheJwks(keys, 'env');
  } catch (error) {
    console.error('[extract-balanced] SUPABASE_JWT_PUBLIC_JWKS is malformed', error);
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const isIsoDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isCurrency = (value: unknown) => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const normalizeText = (value: unknown, fallback = '') => String(value ?? fallback).trim();
const safeNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value));
const normalizeMerchantKey = (value: unknown) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(pvt|private|ltd|limited|inc|llc|store|market)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const toMinorUnits = (value: unknown) => Math.round((safeNumber(value) || 0) * 100);
const monthNumber = (value: string) =>
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(
    value.toLowerCase().slice(0, 3),
  ) + 1;

function toIsoDate(value: unknown) {
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
    if (month >= 1 && day >= 1 && day <= 31) return `${named[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return new Date().toISOString().slice(0, 10);
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Model did not return JSON');
    return JSON.parse(match[0]);
  }
}

function lineItemFromText(value: unknown): ExtractionLineItem {
  const text = normalizeText(value);
  const amountMatch = text.match(/(-?\d+(?:[.,]\d{2})?)\s*$/);
  const amount = amountMatch ? safeNumber(amountMatch[1].replace(',', '.')) || 0 : 0;
  const name = amountMatch ? text.slice(0, amountMatch.index).trim() : text;
  return { name: name.slice(0, 160) || 'Item', qty: 1, amount: Math.max(0, amount) };
}

function normalizeExtraction(raw: unknown, defaultCurrency: string, categoryNames: string[]): ExtractionResult {
  if (!raw || typeof raw !== 'object') throw new Error('Extraction result must be an object');
  const r = raw as Record<string, unknown>;
  if (r.error === 'not_a_receipt') {
    return {
      merchant: 'Rejected image',
      txn_date: new Date().toISOString().slice(0, 10),
      currency: defaultCurrency,
      total: 0,
      line_items: [],
      suggested_category: MISCELLANEOUS,
      is_receipt: false,
    };
  }

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

  const merchant = normalizeText(r.merchant ?? r.store, 'Unknown merchant').slice(0, 160);
  const total = Math.max(0, safeNumber(r.total) || 0);
  const items = lineItems.length > 0 ? lineItems : promptItems;

  // An explicit verdict is honoured either way. A *missing* one used to mean
  // "receipt", which is the wrong direction to fail in now that the scan is
  // charged before the model runs: only an explicit false triggers a refund, so
  // an omitted field became a charge the user never got back. The schema marks
  // the field required, so this is the model deviating — decide it from what
  // was actually extracted rather than assuming either answer.
  const claimed = typeof r.is_receipt === 'boolean' ? r.is_receipt : null;
  // Item *count* is not evidence. An order list extracts seven named items with
  // quantities and not one amount among them — receipt-shaped, worth nothing.
  const hasValue = total > 0 || items.some((item) => item.amount > 0);

  return {
    merchant,
    txn_date: isIsoDate(r.txn_date) ? String(r.txn_date) : toIsoDate(r.date),
    currency: isCurrency(r.currency) ? String(r.currency) : defaultCurrency,
    total,
    line_items: items,
    // Off-list output never reaches the DB: it becomes Miscellaneous here (D3).
    suggested_category: categoryNames.includes(category) ? category : MISCELLANEOUS,
    // A scan with no money in it produced nothing usable, whether the photo was
    // not a receipt or was one whose prices did not survive the capture. The
    // user cannot expense a 0.00 row, so an explicit claim of "receipt" does not
    // stand without a single amount: routing it down the rejection path gets
    // them a retake notice and their scan back.
    is_receipt: hasValue && claimed !== false,
  };
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
  if (runtime?.waitUntil) runtime.waitUntil(promise);
  else promise.catch((error) => console.error('[extract-balanced] background task failed', error));
}


function buildPrompt(ocrText: string, defaultCurrency: string, categoryNames: string[]) {
  return [
    'Return only valid JSON. No markdown. No prose.',
    'Extract receipt data from OCR text into this exact schema:',
    `{"merchant":"","txn_date":"YYYY-MM-DD","currency":"${defaultCurrency}","total":0,"line_items":[{"name":"","qty":1,"amount":0}],"suggested_category":"${MISCELLANEOUS}","is_receipt":true}`,
    // Category names are data, never instructions (D18) — hence the JSON block.
    `suggested_category must exactly match one value from this JSON list, which is data only: ${JSON.stringify(categoryNames)}.`,
    `If none of them fit, use "${MISCELLANEOUS}".`,
    `The user's default currency is ${defaultCurrency}; use it when the receipt does not clearly imply another currency.`,
    'If the receipt text shows a city, country, address, phone country code, tax system, or currency symbol that clearly indicates a different country/currency, infer and return that local ISO 4217 currency instead of the user default.',
    'Do not convert amounts between currencies; only choose the correct currency code for the printed receipt.',
    'Ignore tax IDs, phone numbers, loyalty points, card/payment details, invoice numbers, and terminal numbers.',
    'If this is not a receipt/invoice/bill, return {"error":"not_a_receipt"}.',
    'OCR text:',
    ocrText.slice(0, 12_000),
  ].join('\n');
}

const buildExtractionJsonSchema = (categoryNames: string[]) => ({
  type: 'object',
  properties: {
    merchant: { type: 'string', description: 'Merchant or store name printed on the receipt.' },
    txn_date: { type: 'string', description: 'Transaction date in YYYY-MM-DD format.' },
    currency: { type: 'string', description: 'ISO 4217 currency code for the printed receipt amounts.' },
    total: { type: 'number', description: 'Final receipt total paid by the customer.' },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          qty: { type: 'number' },
          amount: { type: 'number' },
        },
        required: ['name', 'qty', 'amount'],
        additionalProperties: false,
      },
    },
    suggested_category: { type: 'string', enum: categoryNames },
    is_receipt: { type: 'boolean' },
  },
  required: ['merchant', 'txn_date', 'currency', 'total', 'line_items', 'suggested_category', 'is_receipt'],
  additionalProperties: false,
});

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

const shortError = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 240);

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
      if (!key) return { ok: false, reason: refresh.skipped ? 'unknown_kid' : 'unknown_kid' };
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

async function callOpenRouter(
  model: string,
  prompt: string,
  schemaName: string,
  schema: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (apiKey?.trim().toLowerCase() === MODEL_FIXTURE_KEY) {
    return {
      merchant: 'Whole Foods Market',
      txn_date: '2026-07-01',
      currency: 'USD',
      total: 73.36,
      line_items: [{ name: 'Organic bananas 1.2 lb', qty: 1, amount: 1.74 }],
      suggested_category: 'Meals & Entertainment',
      is_receipt: true,
    };
  }
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

  const maxTokens = Number(Deno.env.get('OPENROUTER_BALANCED_MAX_TOKENS') || DEFAULT_OPENROUTER_MAX_TOKENS);
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
      max_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.round(maxTokens) : DEFAULT_OPENROUTER_MAX_TOKENS,
      reasoning: { effort: 'minimal', exclude: true },
      provider: { require_parameters: true },
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: schemaName,
          strict: true,
          schema,
        },
      },
      messages: [
        { role: 'system', content: 'You extract receipt data. Return only valid JSON.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenRouter ${model} failed with ${response.status}`);
  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error(`OpenRouter ${model} returned empty content`);
  return content;
}

function stripOpenRouterModelPrefix(model: string) {
  return model.replace(/^google\//, '');
}

async function callGemini(
  model: string,
  prompt: string,
  schema: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const apiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_GEMINI_API_KEY');
  if (apiKey?.trim().toLowerCase() === MODEL_FIXTURE_KEY) {
    return {
      merchant: 'Whole Foods Market',
      txn_date: '2026-07-01',
      currency: 'USD',
      total: 73.36,
      line_items: [{ name: 'Organic bananas 1.2 lb', qty: 1, amount: 1.74 }],
      suggested_category: 'Meals & Entertainment',
      is_receipt: true,
    };
  }
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const maxTokens = Number(
    Deno.env.get('GEMINI_BALANCED_MAX_TOKENS') ||
      Deno.env.get('OPENROUTER_BALANCED_MAX_TOKENS') ||
      DEFAULT_OPENROUTER_MAX_TOKENS,
  );
  const geminiModel = stripOpenRouterModelPrefix(model);
  const response = await fetch(`${GEMINI_GENERATE_CONTENT_BASE_URL}/${encodeURIComponent(geminiModel)}:generateContent`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: 'You extract receipt data. Return only valid JSON.' }],
      },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.round(maxTokens) : DEFAULT_OPENROUTER_MAX_TOKENS,
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
      },
    }),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Gemini ${geminiModel} failed with ${response.status}${errorText ? `: ${errorText.slice(0, 160)}` : ''}`);
  }
  const body = await response.json();
  const content = body?.candidates?.[0]?.content?.parts
    ?.map((part: Record<string, unknown>) => (typeof part?.text === 'string' ? part.text : ''))
    .join('');
  if (typeof content !== 'string' || !content.trim()) throw new Error(`Gemini ${geminiModel} returned empty content`);
  return content;
}

async function extractWithModel(
  model: string,
  prompt: string,
  schemaName: string,
  schema: Record<string, unknown>,
  provider: 'gemini' | 'openrouter',
  timeoutMs: number,
  normalize: (raw: unknown) => ExtractionResult,
  signal?: AbortSignal,
  timing?: Record<string, unknown>,
  index = 0,
) {
  const raw = await withTimeout(timeoutMs, (timeoutSignal) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    timeoutSignal.addEventListener('abort', abort, { once: true });
    const call =
      provider === 'gemini'
        ? callGemini(model, prompt, schema, controller.signal)
        : callOpenRouter(model, prompt, schemaName, schema, controller.signal);
    return call.finally(() => {
      signal?.removeEventListener('abort', abort);
      timeoutSignal.removeEventListener('abort', abort);
    });
  });
  const normalizeStartedAt = performance.now();
  const extraction = normalize(typeof raw === 'string' ? parseJsonObject(raw) : raw);
  const normalizeMs = Math.round(performance.now() - normalizeStartedAt);
  if (timing) {
    timing[`model_${index + 1}_normalize_ms`] = normalizeMs;
    timing.normalize_ms = Math.max(Number(timing.normalize_ms ?? 0) || 0, normalizeMs);
  }
  return extraction;
}

async function extractBalanced(
  ocrText: string,
  defaultCurrency: string,
  categories: UserCategories,
  timing?: Record<string, unknown>,
) {
  const rawProvider = (Deno.env.get('BALANCED_MODEL_PROVIDER') || (Deno.env.get('GEMINI_API_KEY') ? 'gemini' : 'openrouter')).toLowerCase();
  const provider: 'gemini' | 'openrouter' = rawProvider === 'gemini' ? 'gemini' : 'openrouter';
  const timeoutMs = Number(
    (provider === 'gemini' ? Deno.env.get('GEMINI_TIMEOUT_MS') : null) ||
      Deno.env.get('OPENROUTER_TIMEOUT_MS') ||
      3500,
  );
  const primaryModel =
    provider === 'gemini'
      ? Deno.env.get('GEMINI_BALANCED_MODEL') || DEFAULT_GEMINI_BALANCED_MODEL
      : Deno.env.get('OPENROUTER_BALANCED_MODEL') || DEFAULT_OPENROUTER_BALANCED_MODEL;
  const secondaryModel =
    provider === 'gemini'
      ? Deno.env.get('GEMINI_BALANCED_SECONDARY_MODEL') || DEFAULT_GEMINI_BALANCED_SECONDARY_MODEL
      : Deno.env.get('OPENROUTER_BALANCED_SECONDARY_MODEL') || DEFAULT_OPENROUTER_BALANCED_SECONDARY_MODEL;
  const rawHedgeDelay = Deno.env.get('OPENROUTER_BALANCED_HEDGE_DELAY_MS');
  const hedgeDelayMs = rawHedgeDelay == null || rawHedgeDelay === '' ? DEFAULT_HEDGE_DELAY_MS : Number(rawHedgeDelay);
  const hedgeEnabled = Number.isFinite(hedgeDelayMs) && hedgeDelayMs >= 0;
  const models = hedgeEnabled ? Array.from(new Set([primaryModel, secondaryModel].filter(Boolean))) : [primaryModel];
  const modelStartedAt = performance.now();
  const controllers = models.map(() => new AbortController());
  const prompt = buildPrompt(ocrText, defaultCurrency, categories.names);
  const schema = buildExtractionJsonSchema(categories.names);
  const runModel = (model: string, index: number) => {
    const startedAt = performance.now();
    return extractWithModel(
      model,
      prompt,
      'receipt_extraction',
      schema,
      provider,
      timeoutMs,
      (raw) => normalizeExtraction(raw, defaultCurrency, categories.names),
      controllers[index].signal,
      timing,
      index,
    )
      .then((extraction) => {
        if (timing) {
          timing[`model_${index + 1}_name`] = model;
          timing[`model_${index + 1}_ms`] = Math.round(performance.now() - startedAt);
        }
        return { model, extraction, index };
      })
      .catch((error) => {
        if (timing) {
          timing[`model_${index + 1}_name`] = model;
          timing[`model_${index + 1}_ms`] = Math.round(performance.now() - startedAt);
          timing[`model_${index + 1}_error`] = shortError(error);
        }
        throw error;
      });
  };
  const attempts = models.map((model, index) => {
    if (index === 0) return runModel(model, index);
    const delay = Number.isFinite(hedgeDelayMs) && hedgeDelayMs >= 0 ? hedgeDelayMs : DEFAULT_HEDGE_DELAY_MS;
    return new Promise<{ model: string; extraction: ExtractionResult; index: number }>((resolve, reject) => {
      const timer = setTimeout(() => {
        runModel(model, index).then(resolve, reject);
      }, delay);
      controllers[0].signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          controllers[index].abort();
          reject(new Error('Hedged model cancelled'));
        },
        { once: true },
      );
    });
  });

  const winner = await Promise.any(attempts).catch((error) => {
    throw new Error(error instanceof AggregateError ? error.errors.map(shortError).join(' | ') : shortError(error));
  });
  controllers.forEach((controller, index) => {
    if (index !== winner.index) controller.abort();
  });
  if (timing) {
    timing.model_ms = Math.round(performance.now() - modelStartedAt);
    timing.model_provider = provider;
    timing.winning_model = winner.model;
    timing.model_race_count = models.length;
    timing.hedge_delay_ms = hedgeEnabled ? hedgeDelayMs : DEFAULT_HEDGE_DELAY_MS;
    timing.hedge_fired = models.length > 1;
    timing.normalize_ms = timing.normalize_ms ?? 0;
  }
  return winner.extraction;
}

/**
 * Claim the receipt row before the model is called, so the id handed to the
 * client always exists. The insert overlaps the model wait, so it is effectively
 * free on the hot path.
 *
 * Redelivery of the same capture_id reuses the existing row instead of minting a
 * second id — at-least-once dispatch, exactly-once effect (D7).
 */
async function reserveReceipt({
  admin,
  userId,
  captureId,
  captureMode,
  ackedAt,
}: {
  admin: ReturnType<typeof createClient>;
  userId: string;
  captureId: string;
  captureMode: CaptureMode;
  ackedAt: string;
}): Promise<{ id: string; created: boolean }> {
  // DO NOTHING on conflict: an existing row keeps its id, status and fields.
  const { data: inserted, error } = await admin
    .from('receipts')
    .upsert(
      {
        user_id: userId,
        capture_id: captureId,
        capture_mode: captureMode,
        extraction_mode: 'balanced',
        status: 'processing',
        acked_at: ackedAt,
      },
      { onConflict: 'capture_id', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (inserted?.id) return { id: inserted.id, created: true };

  const { data: existing, error: existingError } = await admin
    .from('receipts')
    .select('id')
    .eq('capture_id', captureId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing?.id) throw new Error('receipt reservation could not be read back');
  return { id: existing.id, created: false };
}

async function persistResult({
  admin,
  userId,
  receiptId,
  captureId,
  captureMode,
  extraction,
  categoryId,
  ackedAt,
  duplicateOf,
  duplicateMatchStrength,
}: {
  admin: ReturnType<typeof createClient>;
  userId: string;
  receiptId: string;
  captureId: string;
  captureMode: CaptureMode;
  extraction: ExtractionResult;
  categoryId: number;
  ackedAt: string;
  duplicateOf?: string | null;
  duplicateMatchStrength?: 'weak' | 'strong' | null;
}) {
  const persistStartedAt = performance.now();
  const status = extraction.is_receipt ? (captureMode === 'one_click' ? 'confirmed' : 'needs_review') : 'rejected';
  const confirmedVia = extraction.is_receipt && captureMode === 'one_click' ? 'auto' : null;

  // The row was reserved before the model call, so this fills it in place.
  // Guarded on `processing` so a redelivered capture cannot walk back a receipt
  // the user has already confirmed, and image_path is deliberately absent so a
  // racing image backup is never clobbered.
  const { data: claimed, error: receiptError } = await admin
    .from('receipts')
    .update({
      status,
      confirmed_via: confirmedVia,
      provider: 'gemini',
      merchant: extraction.is_receipt ? extraction.merchant : null,
      txn_date: extraction.is_receipt ? extraction.txn_date : null,
      currency: extraction.currency,
      total: extraction.is_receipt ? extraction.total : null,
      category_id: categoryId,
      duplicate_of: duplicateOf ?? null,
      duplicate_match_strength: duplicateOf ? duplicateMatchStrength ?? null : null,
      acked_at: ackedAt,
    })
    .eq('id', receiptId)
    .eq('status', 'processing')
    .select('id')
    .maybeSingle();
  if (receiptError) throw receiptError;
  if (!claimed) {
    // An earlier delivery of this capture already completed it. Re-running the
    // items/ledger writes here is what would double-charge a scan.
    console.log('[extract-balanced] persist skipped; receipt already left processing', {
      capture_id: captureId,
      receipt_id: receiptId,
    });
    return;
  }

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

  // The scan was charged by can_scan() before the model ran, so the only work
  // here is giving it back when the image turns out not to be a receipt.
  if (!extraction.is_receipt) {
    await refundScan(admin, userId, captureId);
  }

  console.log('[extract-balanced] background persist completed', {
    capture_id: captureId,
    receipt_id: receiptId,
    persist_ms: Math.round(performance.now() - persistStartedAt),
  });
}

async function logDuplicateShadowEvent({
  admin,
  userId,
  receiptId,
  captureId,
  extraction,
  duplicateOverride = false,
}: {
  admin: ReturnType<typeof createClient>;
  userId: string;
  receiptId: string;
  captureId: string;
  extraction: ExtractionResult;
  duplicateOverride?: boolean;
}) {
  if (!extraction.is_receipt) return;

  const total = Math.round(extraction.total * 100) / 100;
  const merchantKey = normalizeMerchantKey(extraction.merchant);
  if (!merchantKey || !extraction.txn_date || !extraction.currency || total <= 0) return;

  const { data: candidates, error } = await admin
    .from('receipts')
    .select('id, capture_id, merchant, txn_date, currency, total, status')
    .eq('user_id', userId)
    .neq('capture_id', captureId)
    .is('deleted_at', null)
    .in('status', ['needs_review', 'confirmed'])
    .eq('txn_date', extraction.txn_date)
    .eq('currency', extraction.currency)
    .gte('total', total - 0.01)
    .lte('total', total + 0.01)
    .limit(10);
  if (error) throw error;

  const duplicate = (candidates ?? []).find((candidate) => normalizeMerchantKey(candidate.merchant) === merchantKey);
  if (!duplicate) return;

  const matchedMerchantKey = normalizeMerchantKey(duplicate.merchant);
  const { error: eventError } = await admin.from('duplicate_shadow_events').upsert(
    {
      user_id: userId,
      capture_id: captureId,
      receipt_id: receiptId,
      matched_receipt_id: duplicate.id,
      match_rule: 'merchant_date_currency_total',
      match_strength: 'weak',
      action: duplicateOverride ? 'save_anyway' : 'shadow_logged',
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
  if (eventError) throw eventError;

  console.log('[extract-balanced] duplicate shadow match logged', {
    capture_id: captureId,
    receipt_id: receiptId,
    matched_receipt_id: duplicate.id,
    match_rule: 'merchant_date_currency_total',
    match_strength: 'weak',
  });
}

/** The authoritative duplicate candidate returned to the app for a user decision. */
async function findDuplicateCandidate({
  admin,
  userId,
  captureId,
  extraction,
}: {
  admin: ReturnType<typeof createClient>;
  userId: string;
  captureId: string;
  extraction: ExtractionResult;
}): Promise<DuplicateCandidate | null> {
  if (!extraction.is_receipt) return null;
  const total = Math.round(extraction.total * 100) / 100;
  const merchantKey = normalizeMerchantKey(extraction.merchant);
  if (!merchantKey || !extraction.txn_date || !extraction.currency || total <= 0) return null;
  const { data: candidates, error } = await admin
    .from('receipts')
    .select('id, merchant, txn_date, currency, total')
    .eq('user_id', userId)
    .neq('capture_id', captureId)
    .is('deleted_at', null)
    .in('status', ['needs_review', 'confirmed'])
    .eq('txn_date', extraction.txn_date)
    .eq('currency', extraction.currency)
    .gte('total', total - 0.01)
    .lte('total', total + 0.01)
    .limit(10);
  if (error) throw error;
  const duplicate = (candidates ?? []).find((candidate) => normalizeMerchantKey(candidate.merchant) === merchantKey);
  if (!duplicate) return null;
  return {
    matched_receipt_id: duplicate.id,
    match_rule: 'merchant_date_currency_total',
    match_strength: 'weak',
    merchant: duplicate.merchant ?? null,
    txn_date: duplicate.txn_date ?? null,
    currency: duplicate.currency ?? null,
    total: Number(duplicate.total) || total,
  };
}

async function persistResultWithJob(args: {
  admin: ReturnType<typeof createClient>;
  userId: string;
  receiptId: string;
  captureId: string;
  captureMode: CaptureMode;
  extraction: ExtractionResult;
  categoryId: number;
  ackedAt: string;
  duplicateOverride?: boolean;
  duplicateOf?: string | null;
  duplicateMatchStrength?: 'weak' | 'strong' | null;
}) {
  const {
    admin,
    userId,
    receiptId,
    captureId,
    captureMode,
    extraction,
    categoryId,
    ackedAt,
    duplicateOverride = false,
    duplicateOf = null,
    duplicateMatchStrength = null,
  } = args;
  const payload = {
    user_id: userId,
    receipt_id: receiptId,
    capture_id: captureId,
    capture_mode: captureMode,
    extraction,
    category_id: categoryId,
    acked_at: ackedAt,
    duplicate_override: duplicateOverride,
    duplicate_of: duplicateOf,
    duplicate_match_strength: duplicateMatchStrength,
  };
  const startedAt = new Date().toISOString();
  try {
    await admin.from('extraction_persist_jobs').upsert(
      {
        user_id: userId,
        receipt_id: receiptId,
        capture_id: captureId,
        status: 'running',
        attempts: 1,
        payload,
        started_at: startedAt,
        last_error: null,
        updated_at: startedAt,
      },
      { onConflict: 'capture_id' },
    );
  } catch (error) {
    console.error('[extract-balanced] persist job create failed', { capture_id: captureId, error: shortError(error) });
  }

  try {
    await persistResult(args);
    try {
      await logDuplicateShadowEvent(args);
    } catch (error) {
      console.error('[extract-balanced] duplicate shadow check failed', { capture_id: captureId, error: shortError(error) });
    }
    const finishedAt = new Date().toISOString();
    await admin
      .from('extraction_persist_jobs')
      .update({ status: 'succeeded', finished_at: finishedAt, updated_at: finishedAt, last_error: null })
      .eq('capture_id', captureId);
  } catch (error) {
    const failedAt = new Date().toISOString();
    await admin
      .from('extraction_persist_jobs')
      .update({
        status: 'failed',
        finished_at: failedAt,
        updated_at: failedAt,
        last_error: shortError(error),
      })
      .eq('capture_id', captureId);
    throw error;
  }
}

Deno.serve(async (req) => {
  reqCount += 1;
  const startedAt = performance.now();
  const timing: Record<string, unknown> = {
    boot_id: BOOT_ID,
    req_count: reqCount,
    isolate_age_ms: Date.now() - BOOT_AT,
  };
  // The scan is charged by can_scan() before the model runs, so every way out of
  // this handler that is not a delivered receipt has to give it back. Sprinkling
  // refundScan() across a dozen return sites is how one gets missed — three
  // already were: the 503 on a failed reservation, the 422 on an empty
  // extraction, and the catch-all 500 all charged and never refunded. So the
  // refund hangs off one flag in a finally instead.
  let refundCharge: (() => Promise<void>) | null = null;
  let billable = false;
  try {
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

    const deviceId = req.headers.get('x-rf-device-id') ?? '';
    if (!isDeviceId(deviceId)) return json(400, { code: 'VALIDATION_FAILED', message: 'Device identifier required', timing });
    if (!(await isActiveDevice(admin, userId, deviceId))) {
      return json(409, { code: 'DEVICE_INACTIVE', message: 'This device is no longer active', timing });
    }

    // Started before the body is read so the round trip overlaps parsing, and so
    // the camera's warm-up call leaves the picks cached before the real scan.
    const categoriesPromise = getUserCategories(admin, userId, timing);

    const bodyStartedAt = performance.now();
    const rawBody = await req.text().catch(() => '');
    let body = rawBody ? JSON.parse(rawBody) : null;
    if (typeof body === 'string') body = JSON.parse(body);
    timing.body_ms = Math.round(performance.now() - bodyStartedAt);
    if (body?.warm_up === true) {
      await categoriesPromise;
      timing.total_ms = Math.round(performance.now() - startedAt);
      return json(200, { status: 200, warm: true, timing });
    }
    const captureId = String(body?.capture_id ?? body?.captureId ?? '').trim();
    const captureMode = String(body?.mode ?? body?.capture_mode ?? 'default') as CaptureMode;
    const capturedAt = String(body?.captured_at ?? body?.capturedAt ?? '');
    const extractedText = String(body?.extracted_text ?? body?.extractedText ?? '').trim();
    const duplicateOverride = body?.duplicate_override === true || body?.duplicateOverride === true;
    const duplicateOf = isUuid(String(body?.duplicate_of ?? body?.duplicateOf ?? ''))
      ? String(body?.duplicate_of ?? body?.duplicateOf)
      : null;
    const duplicateMatchStrengthRaw = String(body?.duplicate_match_strength ?? body?.duplicateMatchStrength ?? '');
    const duplicateMatchStrength =
      duplicateMatchStrengthRaw === 'weak' || duplicateMatchStrengthRaw === 'strong' ? duplicateMatchStrengthRaw : null;
    let defaultCurrency = isCurrency(body?.default_currency) ? String(body.default_currency) : null;
    // A fingerprint, not a category list: it can only invalidate this isolate's
    // cache, never populate it. Absent on older app builds, which keeps the
    // previous time-based behaviour rather than breaking them.
    const clientCategoriesVersion =
      typeof body?.categories_version === 'string' && body.categories_version.length <= 128
        ? body.categories_version
        : null;
    if (!isUuid(captureId)) {
      return json(400, {
        code: 'VALIDATION_FAILED',
        message: 'capture_id must be a v4 UUID',
        debug: {
          body_type: typeof body,
          body_keys: body && typeof body === 'object' ? Object.keys(body) : [],
          capture_id_preview: captureId.slice(0, 48),
        },
      });
    }
    if (captureMode !== 'default' && captureMode !== 'one_click') {
      return json(400, { code: 'VALIDATION_FAILED', message: 'mode must be default or one_click' });
    }
    if (!capturedAt || Number.isNaN(Date.parse(capturedAt))) {
      return json(400, { code: 'VALIDATION_FAILED', message: 'captured_at must be an ISO datetime' });
    }
    if (!extractedText) return json(400, { code: 'VALIDATION_FAILED', message: 'extracted_text is required' });

    if (!defaultCurrency) defaultCurrency = 'USD';
    timing.profile_ms = 0;

    // Quota is settled BEFORE anything else is awaited. It needs neither the
    // categories nor a reserved row, and a rejection that waits on them can
    // arrive after the client's visible deadline — at which point the client has
    // stopped listening and the verdict is lost.
    const quotaStartedAt = performance.now();
    let quota: ScanVerdict;
    try {
      quota = await evaluateQuota(admin, userId, captureId);
      timing.quota_ms = Math.round(performance.now() - quotaStartedAt);
      timing.quota_reason = quota.reason;
    } catch (error) {
      timing.quota_ms = Math.round(performance.now() - quotaStartedAt);
      timing.total_ms = Math.round(performance.now() - startedAt);
      console.error('[extract-balanced] quota check failed', { capture_id: captureId, error: shortError(error) });
      // Fail closed: a scan we cannot account for is not a scan we serve.
      return json(500, { code: 'VALIDATION_FAILED', message: 'Quota could not be verified', timing });
    }

    if (!quota.canScan) {
      // Nothing has been reserved or sent to a model yet, so there is nothing to
      // undo — and the client gets this back in a few hundred ms.
      timing.total_ms = Math.round(performance.now() - startedAt);
      // Too fast is not out of scans: 429 is retryable, 402 is a verdict, and
      // the client already treats them differently.
      if (quota.reason === 'rate_limited') {
        return json(429, { status: 429, code: 'RATE_LIMITED', retry_after_s: 60, timing });
      }
      return json(402, { status: 402, code: 'QUOTA_EXHAUSTED', paywall: quota.paywall, timing });
    }

    // From here on the user has been debited. Arm the refund.
    refundCharge = () => refundScan(admin, userId, captureId);

    // The category read was started before the body was parsed, so this has
    // usually resolved already and costs nothing here.
    await categoriesPromise;
    // Re-ask, now that the body has told us which selection the app is holding.
    // Normally a cache hit costing nothing; it only goes back to the database
    // when the app's fingerprint disagrees with what this isolate cached —
    // which is exactly the window after the user edited their categories, when
    // the eager read above would otherwise have served the old list to the
    // model AND to resolveCategoryId below.
    const categories = await getUserCategories(admin, userId, timing, 'categories', clientCategoriesVersion);
    const ackedAt = new Date().toISOString();

    // Reserve the row and call the model at the same time: the client only ever
    // receives a receipt_id that is already committed, and the insert hides
    // inside the model wait rather than adding to it.
    const reserveStartedAt = performance.now();
    const reservationPromise = reserveReceipt({ admin, userId, captureId, captureMode, ackedAt }).then((reservation) => {
      timing.reserve_ms = Math.round(performance.now() - reserveStartedAt);
      return reservation;
    });
    const extractionPromise = extractBalanced(extractedText, defaultCurrency, categories, timing);
    // Both are in flight; keep the loser from surfacing as an unhandled rejection.
    reservationPromise.catch(() => {});
    extractionPromise.catch(() => {});

    let reservation: { id: string; created: boolean };
    try {
      reservation = await reservationPromise;
    } catch (error) {
      timing.total_ms = Math.round(performance.now() - startedAt);
      console.error('[extract-balanced] receipt reservation failed', {
        capture_id: captureId,
        error: shortError(error),
      });
      // Retryable: the client keeps the capture queued and dispatches again.
      return json(503, { code: 'VALIDATION_FAILED', message: 'Receipt could not be reserved', timing });
    }

    const extraction = await extractionPromise;
    if (rejectEmptyExtraction(extraction)) {
      // Nothing was charged or written beyond the reservation — take it back.
      if (reservation.created) {
        await admin.from('receipts').delete().eq('id', reservation.id).eq('status', 'processing');
      }
      timing.total_ms = Math.round(performance.now() - startedAt);
      return json(422, { code: 'VALIDATION_FAILED', message: 'Extraction returned empty receipt fields', timing });
    }

    const receiptId = reservation.id;
    const duplicateStartedAt = performance.now();
    const duplicateCandidate = duplicateOverride ? null : await findDuplicateCandidate({ admin, userId, captureId, extraction });
    timing.duplicate_ms = Math.round(performance.now() - duplicateStartedAt);
    timing.total_ms = Math.round(performance.now() - startedAt);
    waitUntil(
      persistResultWithJob({
        admin,
        userId,
        receiptId,
        captureId,
        captureMode,
        extraction,
        categoryId: resolveCategoryId(categories, extraction.suggested_category),
        ackedAt,
        duplicateOverride,
        duplicateOf,
        duplicateMatchStrength,
      }),
    );

    // A receipt is being delivered, so the charge stands. If the model rejected
    // the image, persistExtraction() refunds it on the background path; that is
    // idempotent with this one, so neither can double-credit.
    billable = extraction.is_receipt;

    return json(200, {
      status: 200,
      receipt_id: receiptId,
      // Null, not a path: this function is text-first and never received the
      // image, so at this moment nothing is stored under that name. It used to
      // return `${userId}/${captureId}.jpg` — the name the background upload
      // will eventually use — which reads as a promise the server cannot keep.
      // The `upload_only` path in extract/index.ts sets image_path on the row
      // once the object actually exists. DL-002.
      image_path: null,
      acked_at: ackedAt,
      duplicate_candidate: duplicateCandidate,
      // Lets the client refresh its cached balance off a call it already made.
      // The verdict was read before this scan's debit, so account for it here;
      // a rejected image is never charged.
      scans_remaining:
        quota.remaining == null ? null : quota.remaining + (extraction.is_receipt ? 0 : 1),
      timing,
      result: extraction,
    });
  } catch (error) {
    return json(500, {
      code: 'VALIDATION_FAILED',
      message: error instanceof Error ? error.message : 'Unexpected balanced extraction failure',
      timing,
    });
  } finally {
    if (refundCharge && !billable) {
      // After the response, never before it: a refund must not add latency to
      // the error the user is already waiting on. waitUntil keeps the isolate
      // alive for it, and refund_scan is idempotent, so overlapping with the
      // background persist's own refund cannot double-credit.
      waitUntil(
        refundCharge().catch((refundError) =>
          console.error('[extract-balanced] refund failed', { error: shortError(refundError) }),
        ),
      );
    }
  }
});
