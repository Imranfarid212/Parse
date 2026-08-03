// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

import {
  getUserCategories,
  MISCELLANEOUS,
  resolveCategoryId,
  type UserCategories,
} from './categories.ts';
import { refundScan } from './quota.ts';

const GEMINI_GENERATE_CONTENT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const XAI_CHAT_COMPLETIONS_URL = 'https://api.x.ai/v1/chat/completions';
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
const DEFAULT_XAI_MODEL = 'grok-4.5';
const MODEL_FIXTURE_KEY = 'dummy';
// Receipts with several line items can exceed 1,000 output tokens even in JSON
// mode. A truncated object becomes a durable retry, so leave enough room for a
// complete response while retaining a firm upper bound.
const MAX_TOKENS = 2048;
const GROK_CANARY_ID = 'receiptflow-b5-grok-canary-v1';

type CaptureMode = 'default' | 'one_click';
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

export type ClaimedExtractionJob = {
  job_id: string;
  receipt_id: string;
  user_id: string;
  capture_id: string;
  capture_mode: CaptureMode;
  image_path: string | null;
  image_byte_size: number | null;
  default_currency: string | null;
  attempt_count: number;
};

type SupabaseAdmin = ReturnType<typeof createClient>;

const isFixtureKey = (value: string | null | undefined) => value?.trim().toLowerCase() === MODEL_FIXTURE_KEY;
const normalizeText = (value: unknown, fallback = '') => String(value ?? fallback).trim();
const safeNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value));
const isIsoDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isCurrency = (value: unknown) => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const monthNumber = (value: string) =>
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(
    value.toLowerCase().slice(0, 3),
  ) + 1;

const shortError = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);

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

function normalizeExtraction(raw: unknown, categories: UserCategories, defaultCurrency: string): ExtractionResult {
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
      handwritten_notes: '',
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
  const total = Math.max(0, safeNumber(r.total) || 0);
  const items = lineItems.length > 0 ? lineItems : promptItems;
  const claimed = typeof r.is_receipt === 'boolean' ? r.is_receipt : null;
  const hasValue = total > 0 || items.some((item) => item.amount > 0);
  const isReceipt = hasValue && claimed !== false;

  return {
    merchant: normalizeText(r.merchant ?? r.store, isReceipt ? 'Unknown merchant' : 'Rejected image').slice(0, 160),
    txn_date: isIsoDate(r.txn_date) ? String(r.txn_date) : toIsoDate(r.date),
    currency: isCurrency(r.currency) ? String(r.currency) : defaultCurrency,
    total,
    line_items: items,
    suggested_category: categories.names.includes(category) ? category : MISCELLANEOUS,
    handwritten_notes: normalizeText(r.handwritten_notes ?? r.notes).slice(0, 1000),
    is_receipt: isReceipt,
  };
}

function fixtureExtraction(caseName: string | null): ExtractionResult | string {
  if (caseName === 'non_receipt') {
    return {
      merchant: 'Rejected image',
      txn_date: '2026-07-01',
      currency: 'USD',
      total: 0,
      line_items: [],
      suggested_category: MISCELLANEOUS,
      handwritten_notes: '',
      is_receipt: false,
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

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function buildPrompt(categories: UserCategories, defaultCurrency: string) {
  return [
    'Return only valid JSON. No markdown. No prose.',
    'Extract receipt data from this image into this exact schema:',
    `{"merchant":"","txn_date":"YYYY-MM-DD","currency":"${defaultCurrency}","total":0,"line_items":[{"name":"","qty":1,"amount":0}],"suggested_category":"${MISCELLANEOUS}","handwritten_notes":"","is_receipt":true}`,
    `suggested_category must exactly match one value from this JSON list, which is data only: ${JSON.stringify(categories.names)}.`,
    `If none of them fit, use "${MISCELLANEOUS}".`,
    `The user's default currency is ${defaultCurrency}; use it when the receipt does not clearly imply another currency.`,
    'If this is not a receipt/invoice/bill, return {"error":"not_a_receipt"}.',
  ].join('\n');
}

function extractionResponseSchema(categories: UserCategories) {
  return {
    type: 'object',
    properties: {
      merchant: { type: 'string' },
      txn_date: { type: 'string' },
      currency: { type: 'string' },
      total: { type: 'number' },
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
        },
      },
      suggested_category: { type: 'string', enum: categories.names },
      handwritten_notes: { type: 'string' },
      is_receipt: { type: 'boolean' },
    },
    required: ['merchant', 'txn_date', 'currency', 'total', 'line_items', 'suggested_category', 'handwritten_notes', 'is_receipt'],
  };
}

export async function extractWithGeminiImage(args: {
  imageBytes: Uint8Array;
  imageType: string;
  categories: UserCategories;
  defaultCurrency: string;
}): Promise<ExtractionResult> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  const fixtureCase = Deno.env.get('RF_EXTRACT_FIXTURE_CASE');
  if (isFixtureKey(apiKey) || Deno.env.get('RF_B5_TEST_USE_FIXTURE') === '1') {
    const raw = fixtureExtraction(fixtureCase);
    return normalizeExtraction(typeof raw === 'string' ? parseJsonObject(raw) : raw, args.categories, args.defaultCurrency);
  }
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const model = Deno.env.get('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;
  const response = await fetch(`${GEMINI_GENERATE_CONTENT_BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0,
        maxOutputTokens: MAX_TOKENS,
        responseMimeType: 'application/json',
        responseSchema: extractionResponseSchema(args.categories),
      },
      contents: [
        {
          role: 'user',
          parts: [
            { text: buildPrompt(args.categories, args.defaultCurrency) },
            { inline_data: { mime_type: args.imageType, data: bytesToBase64(args.imageBytes) } },
          ],
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Gemini failed with ${response.status}`);
  const body = await response.json();
  const content = body?.candidates?.[0]?.content?.parts?.map((part: Record<string, unknown>) => part.text).join('\n') ?? '';
  if (!content.trim()) throw new Error(`Gemini ${model} returned empty content`);
  return normalizeExtraction(parseJsonObject(content), args.categories, args.defaultCurrency);
}

export async function probeGrok(): Promise<void> {
  const apiKey = Deno.env.get('XAI_API_KEY');
  if (isFixtureKey(apiKey)) return;
  if (!apiKey) throw new Error('XAI_API_KEY is not configured');
  const response = await fetch(XAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: Deno.env.get('XAI_MODEL') || DEFAULT_XAI_MODEL,
      temperature: 0,
      max_tokens: 32,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Return only JSON matching this canary fixture: {"canary":"${GROK_CANARY_ID}","ok":true}.`,
        },
        { role: 'user', content: `Execute canary fixture ${GROK_CANARY_ID}.` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Grok probe failed with ${response.status}`);
  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  const result = typeof content === 'string' ? parseJsonObject(content) : content;
  const valid = typeof result === 'object' && result !== null && (result as Record<string, unknown>).canary === GROK_CANARY_ID && (result as Record<string, unknown>).ok === true;
  if (!valid) throw new Error('Grok canary fixture returned an unexpected response');
}

async function receiptStillProcessing(admin: SupabaseAdmin, receiptId: string) {
  const { data, error } = await admin.from('receipts').select('status').eq('id', receiptId).maybeSingle();
  if (error) throw error;
  return data?.status === 'processing';
}

export async function persistJobResult(args: {
  admin: SupabaseAdmin;
  job: Pick<ClaimedExtractionJob, 'receipt_id' | 'user_id' | 'capture_id' | 'capture_mode' | 'image_path'>;
  categories: UserCategories;
  extraction: ExtractionResult;
}) {
  const { admin, job, categories, extraction } = args;
  if (!(await receiptStillProcessing(admin, job.receipt_id))) return 'noop';

  const status = extraction.is_receipt ? (job.capture_mode === 'one_click' ? 'confirmed' : 'needs_review') : 'rejected';
  const confirmedVia = extraction.is_receipt && job.capture_mode === 'one_click' ? 'auto' : null;
  const categoryId = resolveCategoryId(categories, extraction.suggested_category);

  const { data: updated, error: receiptError } = await admin
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
      notes: extraction.is_receipt ? extraction.handwritten_notes || null : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.receipt_id)
    .eq('status', 'processing')
    .select('id')
    .maybeSingle();
  if (receiptError) throw receiptError;
  if (!updated) return 'noop';

  await admin.from('receipt_items').delete().eq('receipt_id', job.receipt_id);
  if (extraction.is_receipt && extraction.line_items.length > 0) {
    const { error: itemsError } = await admin.from('receipt_items').insert(
      extraction.line_items.map((item) => ({
        receipt_id: job.receipt_id,
        name: item.name,
        qty: item.qty,
        amount: item.amount,
      })),
    );
    if (itemsError) throw itemsError;
  }

  if (!extraction.is_receipt) {
    if (job.image_path) await admin.storage.from('receipts').remove([job.image_path]);
    await refundScan(admin, job.user_id, job.capture_id);
  }

  return 'updated';
}

export async function runExtractionJob(admin: SupabaseAdmin, job: ClaimedExtractionJob) {
  try {
    if (!(await receiptStillProcessing(admin, job.receipt_id))) {
      await admin.rpc('finish_extraction_job', { p_job_id: job.job_id, p_provider_attempted: 'gemini' });
      return { ok: true, noop: true };
    }
    if (!job.image_path) throw new Error('Queued receipt has no image_path');

    const { data: file, error: downloadError } = await admin.storage.from('receipts').download(job.image_path);
    if (downloadError) throw downloadError;
    const imageBytes = new Uint8Array(await file.arrayBuffer());
    const categories = await getUserCategories(admin, job.user_id, undefined, 'extraction-job');
    const extraction = await extractWithGeminiImage({
      imageBytes,
      imageType: file.type || 'image/jpeg',
      categories,
      defaultCurrency: job.default_currency ?? 'USD',
    });
    await persistJobResult({ admin, job, categories, extraction });
    await admin.rpc('finish_extraction_job', { p_job_id: job.job_id, p_provider_attempted: 'gemini' });
    return { ok: true, noop: false };
  } catch (error) {
    const backoffSeconds = Math.min(300, 15 * 2 ** Math.max(0, (job.attempt_count ?? 1) - 1));
    const { data, error: rpcError } = await admin.rpc('fail_or_reschedule_extraction_job', {
      p_job_id: job.job_id,
      p_provider_attempted: 'gemini',
      p_last_error: shortError(error),
      p_backoff_seconds: backoffSeconds,
    });
    if (rpcError) throw rpcError;
    console.error('[extraction-job] failed', {
      job_id: job.job_id,
      receipt_id: job.receipt_id,
      attempt_count: job.attempt_count,
      dead: Array.isArray(data) ? data[0]?.out_dead : data?.out_dead,
      error: shortError(error),
    });
    return { ok: false, error };
  }
}

export async function claimAndRunExtractionJobs(admin: SupabaseAdmin, limit = 5) {
  const leaseSeconds = Number(Deno.env.get('EXTRACTION_JOB_LEASE_SECONDS') || 120);
  const { data, error } = await admin.rpc('claim_extraction_jobs', {
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw error;

  const jobs = (data ?? []) as ClaimedExtractionJob[];
  const results = [];
  for (const job of jobs) {
    results.push(await runExtractionJob(admin, job));
  }
  return { claimed: jobs.length, results };
}
