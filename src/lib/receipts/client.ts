/**
 * The /extract client. The backend does not exist yet (HANDOFF §7), so the app
 * runs against `mockExtractClient`, which honours the contract exactly —
 * including latency and the failure modes the UI has to survive.
 *
 * Swapping in the real backend is a one-line change in `extractClient` below;
 * nothing upstream knows the difference.
 */
import { normalizeReceiptDate } from '@/lib/dates';
import { getFoundationEnv } from '@/lib/foundations/env';
import { supabase } from '@/lib/auth/supabase';
import * as FileSystem from 'expo-file-system/legacy';
import {
  CATEGORIES,
  isCategory,
  isNotAReceipt,
  type CaptureMode,
  type Category,
  type ExtractResponse,
  type ExtractSuccess,
  type ReceiptFields,
} from '@/lib/receipts/types';

export type ExtractInput = {
  captureId: string;
  imageUri: string;
  mode: CaptureMode;
  capturedAt: string;
  signal?: AbortSignal;
};

export type ExtractAck = {
  receiptId: string;
  response: ExtractResponse;
};

type ExtractFunctionPayload = {
  status: 200 | 202;
  receipt_id: string;
  result?: {
    merchant: string;
    txn_date: string;
    total: number;
    suggested_category: string;
    line_items: { name: string; amount: number }[];
  };
  code?: 'PROVIDER_DELAY' | string;
  error?: string;
  message?: string;
};

export interface ExtractClient {
  /** Rejects on transport failure/timeout; resolves for both contract shapes. */
  extract(input: ExtractInput): Promise<ExtractAck>;
}

/** Turn a wire payload into app-side fields: date normalized, category guarded. */
export function toReceiptFields(r: ExtractSuccess): ReceiptFields {
  return {
    date: normalizeReceiptDate(r.date),
    store: r.store ?? '',
    items: Array.isArray(r.items) ? r.items : [],
    total: Number(r.total) || 0,
    // A model can return an off-list category; Miscellaneous is the catch-all.
    category: isCategory(r.category) ? r.category : 'Miscellaneous',
    handwritten_notes: r.handwritten_notes ?? '',
  };
}

// ── Mock ────────────────────────────────────────────────────────────────────

/** Tunable so the UI can be driven through every branch by hand. */
export type MockConfig = {
  /** Latency window, ms. Defaults track the measured p95 (~1.7s). */
  minMs: number;
  maxMs: number;
  /** Probability the image is judged a non-receipt. */
  notAReceiptRate: number;
  /** Probability the request fails outright (timeout/500/offline). */
  failureRate: number;
  /** Which SAMPLE to return; 'random' picks one each time. */
  sample: number | 'random';
};

export const mockConfig: MockConfig = {
  minMs: 900,
  maxMs: 2200,
  notAReceiptRate: 0,
  failureRate: 0,
  // The grocery run: 12 items, so the card's overflow row is on the default
  // path rather than something you have to go hunting for.
  sample: 0,
};

const SAMPLES: { store: string; items: string[]; total: number; category: Category; notes: string }[] = [
  {
    store: 'Whole Foods Market',
    items: [
      'Organic bananas 1.2 lb  1.74',
      'Whole milk, 1 gal  4.29',
      'Sourdough loaf  5.99',
      'Free-range eggs, dozen  6.49',
      'Chicken thighs 2.4 lb  14.38',
      'Baby spinach 5 oz  3.99',
      'Roma tomatoes 1.1 lb  2.73',
      'Cheddar block 8 oz  5.49',
      'Olive oil 500ml  12.99',
      'Pasta penne 1 lb  2.29',
      'Greek yogurt 32 oz  6.99',
      'Sparkling water 12pk  5.99',
    ],
    total: 73.36,
    category: 'Meals & Entertainment',
    notes: 'Weekly grocery run — paid with joint card',
  },
  { store: 'Shell', items: ['Unleaded 12.4 gal  48.20', 'Car wash  9.00'], total: 57.2, category: 'Vehicle Expenses', notes: '' },
  { store: 'Blue Bottle Coffee', items: ['Latte  5.75', 'Croissant  4.25'], total: 10.0, category: 'Meals & Entertainment', notes: 'Client catch-up — reimburse' },
  { store: 'Office Depot', items: ['Copy paper 5-ream  42.99', 'Pens 12pk  8.49'], total: 51.48, category: 'Office Supplies', notes: '' },
  { store: 'Delta Air Lines', items: ['SFO-JFK economy  318.40'], total: 318.4, category: 'Travel & Transit', notes: 'Q3 client visit' },
  { store: 'Adobe', items: ['Creative Cloud, 1 mo  59.99'], total: 59.99, category: 'Software & IT', notes: '' },
];

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

export const mockExtractClient: ExtractClient = {
  async extract({ captureId, signal }) {
    const { minMs, maxMs, notAReceiptRate, failureRate, sample } = mockConfig;
    await wait(minMs + Math.random() * (maxMs - minMs), signal);

    if (Math.random() < failureRate) throw new Error('extract failed (mock)');
    if (Math.random() < notAReceiptRate) return { receiptId: captureId, response: { error: 'not_a_receipt' } };

    const s = sample === 'random' ? pick(SAMPLES) : (SAMPLES[sample] ?? SAMPLES[0]);
    // Dates come back AS PRINTED — including the ambiguous forms dates.ts exists
    // to resolve, so the mock exercises that path rather than hiding it.
    const printed = pick(['07-04-2026', '2026-06-28', 'Jul 1, 2026', '05/07/2026']);
    return {
      receiptId: captureId,
      response: {
        date: printed,
        store: s.store,
        items: s.items,
        total: s.total,
        category: s.category,
        handwritten_notes: s.notes,
      },
    };
  },
};

export const supabaseExtractClient: ExtractClient = {
  async extract({ captureId, imageUri, mode, capturedAt, signal }) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const env = getFoundationEnv();
    if (!env.supabaseUrl || !env.supabaseAnonKey) throw new Error('Supabase env missing');
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error('No active Supabase session');

    if (__DEV__) {
      console.log('[extract] invoking', { environment: env.environment, mockBackend: env.mockBackend, mode });
    }
    const response = await FileSystem.uploadAsync(`${env.supabaseUrl}/functions/v1/extract`, imageUri, {
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      httpMethod: 'POST',
      fieldName: 'image',
      mimeType: 'image/jpeg',
      parameters: {
        capture_id: captureId,
        mode,
        captured_at: capturedAt,
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: env.supabaseAnonKey,
      },
    });

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const data = JSON.parse(response.body || 'null') as ExtractFunctionPayload | null;
    if (response.status < 200 || response.status >= 300) {
      throw new Error(data?.message ?? data?.error ?? data?.code ?? `extract failed (${response.status})`);
    }
    if (!data) throw new Error('extract returned no data');
    if (data.status === 202) throw new Error(data.code ?? 'PROVIDER_DELAY');

    return {
      receiptId: data.receipt_id,
      response: {
        date: data.result?.txn_date ?? '',
        store: data.result?.merchant ?? '',
        items: data.result?.line_items.map((item) => `${item.name}  ${item.amount.toFixed(2)}`) ?? [],
        total: data.result?.total ?? 0,
        category: data.result?.suggested_category ?? 'Miscellaneous',
        handwritten_notes: '',
      },
    };
  },
};

// ── Selection ───────────────────────────────────────────────────────────────

/** The app's client. Swap to a real HTTP client once /extract exists. */
export const extractClient: ExtractClient = getFoundationEnv().mockBackend ? mockExtractClient : supabaseExtractClient;

export { isNotAReceipt, CATEGORIES };
