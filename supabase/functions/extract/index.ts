// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

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
  is_receipt: boolean;
};

type ExtractTiming = {
  total_ms?: number;
  grok_ms?: number;
  storage_ms?: number;
  db_ms?: number;
};

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
  signal?: AbortSignal,
) {
  const apiKey = Deno.env.get('XAI_API_KEY');
  const model = Deno.env.get('XAI_MODEL') || DEFAULT_XAI_MODEL;
  const fixtureCase = Deno.env.get('RF_EXTRACT_FIXTURE_CASE');
  if (isFixtureKey(apiKey)) return fixtureExtraction(fixtureCase);

  const base64 = bytesToBase64(imageBytes);
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
      max_tokens: 320,
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
  return parseJsonObject(body?.choices?.[0]?.message?.content ?? '');
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
      max_tokens: 320,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildPrompt(categories, defaultCurrency) },
        { role: 'user', content: `Repair this malformed JSON into the exact extraction schema:\n${raw}` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Grok repair failed with ${response.status}`);
  const body = await response.json();
  return parseJsonObject(body?.choices?.[0]?.message?.content ?? '');
}

async function extractWithGrok(imageBytes: Uint8Array, imageType: string, categories: string[], defaultCurrency: string) {
  const timeoutMs = Number(Deno.env.get('GROK_TIMEOUT_MS') || 3500);
  let raw: unknown;
  try {
    raw = await withTimeout(timeoutMs, (signal) => callGrok(imageBytes, imageType, categories, defaultCurrency, signal));
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
    return normalizeExtraction(typeof raw === 'string' ? parseJsonObject(raw) : raw, categories, defaultCurrency);
  } catch {
    const repaired = await repairExtraction(raw, categories, defaultCurrency);
    return normalizeExtraction(repaired, categories, defaultCurrency);
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
      notes: null,
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

  if (extraction.is_receipt) {
    const { error: ledgerError } = await admin
      .from('scan_ledger')
      .insert({ user_id: userId, delta: -1, reason: 'scan_used', ref_id: receiptId });
    if (ledgerError && ledgerError.code !== '23505') throw ledgerError;
  }
}

async function handleExtract(req: Request) {
  const startedAt = performance.now();
  const timing: ExtractTiming = {};
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
  const { data: userData, error: userError } = await userSupabase.auth.getUser();
  if (userError || !userData.user) return json(401, { code: 'VALIDATION_FAILED', message: 'Authentication required' });

  const contentType = req.headers.get('content-type') ?? '';
  const isJson = contentType.toLowerCase().includes('application/json');
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
  const captureId = String((isJson ? body?.capture_id : form?.get('capture_id')) ?? '');
  const mode = String((isJson ? body?.mode : form?.get('mode')) ?? '') as CaptureMode;
  const extractionMode = String((isJson ? body?.extraction_mode : form?.get('extraction_mode')) || 'precise') as ExtractionMode;
  const capturedAt = String((isJson ? body?.captured_at : form?.get('captured_at')) ?? '');
  const extractedText = String((isJson ? body?.extracted_text : form?.get('extracted_text')) ?? '').trim();
  const uploadOnly = String(form?.get('upload_only') ?? '') === '1';
  const image = form?.get('image') ?? null;

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

  const userId = userData.user.id;
  const imagePath = `${userId}/${captureId}.jpg`;

  const { data: existing } = await admin
    .from('receipts')
    .select('id, status, image_path, acked_at, merchant, txn_date, currency, total, category_id')
    .eq('capture_id', captureId)
    .maybeSingle();
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

    timing.total_ms = Math.round(performance.now() - startedAt);
    return json(200, { status: 200, receipt_id: existing?.id ?? captureId, image_path: imagePath, acked_at: ackedAt, timing });
  }

  if (existing && existing.status !== 'processing') {
    const dbStartedAt = performance.now();
    const { data: items } = await admin.from('receipt_items').select('name, qty, amount').eq('receipt_id', existing.id);
    const { data: category } = await admin.from('categories').select('name').eq('id', existing.category_id).maybeSingle();
    const rejected = existing.status === 'rejected';
    timing.db_ms = Math.round(performance.now() - dbStartedAt);
    timing.total_ms = Math.round(performance.now() - startedAt);
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
      return json(422, {
        code: 'VALIDATION_FAILED',
        message: 'Extraction returned empty receipt fields',
        timing,
      });
    }

    const receiptId = crypto.randomUUID();
    const ackedAt = new Date().toISOString();
    timing.total_ms = Math.round(performance.now() - startedAt);

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

  const { data: profile, error: profileError } = await userSupabase
    .from('profiles')
    .select('default_currency')
    .eq('id', userId)
    .single();
  if (profileError) return json(500, { code: 'VALIDATION_FAILED', message: profileError.message });
  const defaultCurrency = profile.default_currency ?? 'USD';

  const { data: selectedCategories, error: categoriesError } = await userSupabase
    .from('user_categories')
    .select('categories(id, name, is_system)')
    .eq('user_id', userId);
  if (categoriesError) return json(500, { code: 'VALIDATION_FAILED', message: categoriesError.message });
  const categoryRows = (selectedCategories ?? []).map((row) => row.categories).filter(Boolean);
  const categories = Array.from(new Set([...categoryRows.map((row) => row.name), 'Miscellaneous']));
  const categoryByName = new Map(categoryRows.map((row) => [row.name, row.id]));

  const { data: subscriptions, error: subscriptionError } = await userSupabase
    .from('subscriptions')
    .select('product_id, status, current_period_start')
    .eq('user_id', userId)
    .in('status', ['active', 'grace'])
    .order('current_period_start', { ascending: false })
    .limit(1);
  if (subscriptionError) return json(500, { code: 'VALIDATION_FAILED', message: subscriptionError.message });

  const subscription = subscriptions?.[0];
  const hasUnlimited = subscription?.product_id === 'rf_unlimited_1199_m';
  const plusStart = subscription?.product_id === 'rf_plus_699_m' ? subscription.current_period_start : null;
  let canScan = Boolean(hasUnlimited);
  if (!canScan && plusStart) {
    const { count, error } = await userSupabase
      .from('scan_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('reason', 'scan_used')
      .gte('created_at', plusStart);
    if (error) return json(500, { code: 'VALIDATION_FAILED', message: error.message });
    canScan = (count ?? 0) < 500;
  }
  if (!canScan && !plusStart) {
    const { data: ledger, error } = await userSupabase.from('scan_ledger').select('delta').eq('user_id', userId);
    if (error) return json(500, { code: 'VALIDATION_FAILED', message: error.message });
    canScan = (ledger ?? []).reduce((sum, row) => sum + Number(row.delta || 0), 0) > 0;
  }
  if (!canScan) return json(402, { status: 402, code: 'QUOTA_EXHAUSTED', paywall: 'plus' });

  if (req.headers.get('x-rf-force-storage-failure') === '1') {
    return json(503, { code: 'VALIDATION_FAILED', message: 'Forced Storage failure' });
  }

  const bytes = image instanceof File ? new Uint8Array(await image.arrayBuffer()) : null;
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
    : extractWithGrok(bytes!, image instanceof File ? image.type : 'image/jpeg', categories, defaultCurrency);
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
    return json(422, {
      code: 'VALIDATION_FAILED',
      message: 'Extraction returned empty receipt fields',
      timing,
    });
  }

  if (extraction.is_receipt) {
    const total = Math.round(extraction.total * 100) / 100;
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
    if (duplicateError) return json(500, { code: 'VALIDATION_FAILED', message: duplicateError.message });

    const merchantKey = normalizeMerchantKey(extraction.merchant);
    const duplicate = (candidates ?? []).find((candidate) => normalizeMerchantKey(candidate.merchant) === merchantKey);
    if (duplicate) {
      if (image instanceof File) await admin.storage.from('receipts').remove([imagePath]);
      const { data: items } = await admin.from('receipt_items').select('name, qty, amount').eq('receipt_id', duplicate.id);
      const { data: category } = await admin.from('categories').select('name').eq('id', duplicate.category_id).maybeSingle();
      timing.db_ms = Math.round(performance.now() - dbStartedAt);
      timing.total_ms = Math.round(performance.now() - startedAt);
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
        notes: null,
        acked_at: ackedAt,
      },
      { onConflict: 'capture_id' },
    )
    .select('id')
    .single();
  if (receiptError) return json(500, { code: 'VALIDATION_FAILED', message: receiptError.message });

  await admin.from('receipt_items').delete().eq('receipt_id', receipt.id);
  if (extraction.is_receipt && extraction.line_items.length > 0) {
    const { error: itemsError } = await admin.from('receipt_items').insert(
      extraction.line_items.map((item) => ({
        receipt_id: receipt.id,
        name: item.name,
        qty: item.qty,
        amount: item.amount,
      })),
    );
    if (itemsError) return json(500, { code: 'VALIDATION_FAILED', message: itemsError.message });
  }

  if (!extraction.is_receipt) {
    if (image instanceof File) await admin.storage.from('receipts').remove([imagePath]);
    timing.db_ms = Math.round(performance.now() - dbStartedAt);
    timing.total_ms = Math.round(performance.now() - startedAt);
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

  const { error: ledgerError } = await admin
    .from('scan_ledger')
    .insert({ user_id: userId, delta: -1, reason: 'scan_used', ref_id: receipt.id });
  if (ledgerError && ledgerError.code !== '23505') {
    return json(500, { code: 'VALIDATION_FAILED', message: ledgerError.message });
  }

  timing.db_ms = Math.round(performance.now() - dbStartedAt);
  timing.total_ms = Math.round(performance.now() - startedAt);
  return json(200, {
    status: 200,
    receipt_id: receipt.id,
    image_path: imagePath,
    acked_at: ackedAt,
    timing,
    result: extraction,
  });
}

Deno.serve(async (req) => {
  try {
    return await handleExtract(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json(500, { code: 'VALIDATION_FAILED', message });
  }
});
