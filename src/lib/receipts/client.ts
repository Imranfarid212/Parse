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
import { getDeviceId } from '@/lib/auth/device';
import * as FileSystem from 'expo-file-system/legacy';
import { AppState } from 'react-native';
import {
  CATEGORIES,
  isDuplicateReceipt,
  isCategory,
  isNotAReceipt,
  type CaptureMode,
  type Category,
  type DuplicateCandidate,
  type ExtractionMode,
  type ExtractResponse,
  type ExtractSuccess,
  type ReceiptFields,
  type ReceiptLineItem,
  normalizeReceiptItems,
} from '@/lib/receipts/types';

export type ExtractInput = {
  captureId: string;
  imageUri: string;
  mode: CaptureMode;
  extractionMode: ExtractionMode;
  defaultCurrency?: string;
  localOcrText?: string | null;
  duplicateOverride?: boolean;
  duplicateOfReceiptId?: string | null;
  duplicateMatchStrength?: 'weak' | 'strong' | null;
  capturedAt: string;
  signal?: AbortSignal;
};

export type ExtractCompletedAck = {
  receiptId: string;
  response: ExtractResponse;
  attempts?: CaptureAttemptTrace[];
  duplicateCandidate?: DuplicateCandidate | null;
  /** Server's post-debit balance; null means unlimited, undefined means not reported. */
  scansRemaining?: number | null;
};

export type ExtractVisibleDeadlineAck = {
  state: 'visible_deadline';
  attempts?: CaptureAttemptTrace[];
  deferred: Promise<ExtractAck>;
};

export type ExtractAck = ExtractCompletedAck | ExtractVisibleDeadlineAck;

export type ConfirmReceiptInput = {
  receiptId: string;
  fields: ReceiptFields;
};

export type ImageBackupInput = {
  captureId: string;
  imageUri: string;
  mode: CaptureMode;
  extractionMode: ExtractionMode;
  capturedAt: string;
};

export type CaptureMetricsPayload = {
  captureId: string;
  receiptId?: string | null;
  captureMode: CaptureMode;
  extractionMode: ExtractionMode;
  metrics: Record<string, number | null | undefined>;
  attempts?: CaptureAttemptTrace[];
};

export type CaptureAttemptTrace = {
  attempt_number: number;
  transport: 'balanced_text' | 'image_extract';
  started_at: string;
  ended_at: string;
  duration_ms: number;
  status_code?: number | null;
  error_message?: string | null;
  retry_delay_ms?: number | null;
  server_total_ms?: number | null;
  server_auth_ms?: number | null;
  server_body_ms?: number | null;
  server_model_ms?: number | null;
  server_normalize_ms?: number | null;
  attempt_timeout_ms?: number | null;
  timed_out?: number | null;
  transport_error?: number | null;
  ms_since_warmup?: number | null;
  app_state?: string | null;
  abort_reason?: 'visible_deadline' | 'hard_timeout' | 'user_cancel' | 'screen_unmount' | 'winner_cancelled' | null;
};

type ConfirmReceiptErrorPayload = {
  message?: string;
  error?: string;
  code?: string;
  model_parse_stage?: string;
  model_preview?: string;
  model_preview_length?: number;
};

type ExtractFunctionPayload = {
  status: 200 | 202;
  receipt_id: string;
  rejected?: boolean;
  duplicate?: boolean;
  scans_remaining?: number | null;
  duplicate_candidate?: {
    matched_receipt_id?: string;
    match_rule?: string;
    match_strength?: 'weak' | 'strong';
    merchant?: string | null;
    txn_date?: string | null;
    currency?: string | null;
    total?: number | null;
  } | null;
  timing?: {
    total_ms?: number;
    auth_ms?: number;
    body_ms?: number;
    model_ms?: number;
    normalize_ms?: number;
    grok_ms?: number;
    storage_ms?: number;
    db_ms?: number;
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
  result?: {
    merchant?: string;
    txn_date?: string;
    currency?: string;
    total?: number;
    suggested_category?: string;
    line_items: ReceiptLineItem[];
    handwritten_notes?: string | null;
    is_receipt?: boolean;
  };
  code?: 'PROVIDER_DELAY' | string;
  error?: string;
  message?: string;
  /** A 429 carries the server's own "come back in N seconds". */
  retry_after_s?: number;
  model_parse_stage?: string;
  model_preview?: string;
  model_preview_length?: number;
};

export interface ExtractClient {
  /** Rejects on transport failure/timeout; resolves for both contract shapes. */
  extract(input: ExtractInput): Promise<ExtractAck>;
  /** Best-effort preflight to warm the function isolate and connection. */
  warmUpBalanced?(): Promise<void>;
  warmUpPrecise?(): Promise<void>;
}

export interface ConfirmReceiptClient {
  /** Rejects on transport failure; resolves once Supabase has marked the row confirmed. */
  confirm(input: ConfirmReceiptInput): Promise<void>;
}

export interface ImageBackupClient {
  /** Rejects on transport failure; resolves once Supabase has stored the image. */
  upload(input: ImageBackupInput): Promise<void>;
}

export interface CaptureMetricsClient {
  upload(input: CaptureMetricsPayload): Promise<void>;
}

const BALANCED_HEDGE_DELAY_MS = 2000;
const BALANCED_VISIBLE_DEADLINE_MS = 3800;
const BALANCED_HARD_DEADLINE_MS = 15_000;
const BALANCED_WARMUP_TIMEOUT_MS = 5000;
const PRECISE_VISIBLE_DEADLINE_MS = 4500;
const PRECISE_WARMUP_TIMEOUT_MS = 5000;
/** Confirm is a small write; anything this slow is a stalled connection. */
const CONFIRM_TIMEOUT_MS = 20_000;
const AUTH_REFRESH_WINDOW_MS = 30_000;
let balancedWarmupInFlight: Promise<void> | null = null;
let preciseWarmupInFlight: Promise<void> | null = null;
let lastBalancedWarmupCompletedAt: number | null = null;
let lastPreciseWarmupCompletedAt: number | null = null;

const assertNotAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
};

async function getAccessTokenForRequest(): Promise<string> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  let session = sessionData.session;
  const expiresAtMs = session?.expires_at ? session.expires_at * 1000 : 0;
  if (expiresAtMs > 0 && expiresAtMs - Date.now() < AUTH_REFRESH_WINDOW_MS) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) throw refreshError;
    session = refreshed.session ?? session;
  }
  const accessToken = session?.access_token;
  if (!accessToken) throw new Error('No active Supabase session');
  return accessToken;
}

const isRetryableBalancedStatus = (status: number) => status === 408 || status === 429 || status >= 500;
const isTransportErrorMessage = (message: string) =>
  /network connection was lost|network request failed|fetch failed|fetchrequestcanceledexception|unexpectedexception|aborterror|aborted/i.test(message);

function childTimeoutSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  abort: (reason?: CaptureAttemptTrace['abort_reason']) => void;
  getReason: () => CaptureAttemptTrace['abort_reason'];
  dispose: () => void;
} {
  const controller = new AbortController();
  let abortReason: CaptureAttemptTrace['abort_reason'] = null;
  const abort = (reason: CaptureAttemptTrace['abort_reason'] = 'user_cancel') => {
    abortReason = reason;
    controller.abort();
  };
  const parentAbort = () => abort('user_cancel');
  const timeout = setTimeout(() => abort('hard_timeout'), timeoutMs);
  parent?.addEventListener('abort', parentAbort, { once: true });
  return {
    signal: controller.signal,
    abort,
    getReason: () => abortReason,
    dispose: () => {
      clearTimeout(timeout);
      parent?.removeEventListener('abort', parentAbort);
    },
  };
}

export function getCaptureAttempts(error: unknown): CaptureAttemptTrace[] {
  if (error instanceof Error && Array.isArray((error as Error & { captureAttempts?: unknown }).captureAttempts)) {
    return (error as Error & { captureAttempts: CaptureAttemptTrace[] }).captureAttempts;
  }
  return [];
}

/** Pulls the server's error code (e.g. QUOTA_EXHAUSTED) off a rejected extract(). */
export function getExtractErrorCode(error: unknown): string | null {
  if (error instanceof Error && typeof (error as Error & { code?: unknown }).code === 'string') {
    return (error as Error & { code: string }).code;
  }
  return null;
}

/**
 * A 429 carries the server's own "come back in N seconds". Scheduling anything
 * shorter is a call guaranteed to be refused, which is exactly how a throttled
 * capture used to burn its retry budget and die before the window even cleared.
 */
export function getExtractRetryAfterMs(error: unknown): number | null {
  const seconds = error instanceof Error ? (error as Error & { retryAfterS?: unknown }).retryAfterS : undefined;
  return typeof seconds === 'number' && seconds > 0 ? seconds * 1000 : null;
}

function errorWithAttempts(message: string, attempts: CaptureAttemptTrace[]) {
  const error = new Error(message) as Error & { captureAttempts: CaptureAttemptTrace[] };
  error.captureAttempts = attempts;
  return error;
}

function extractPayloadToAck(data: ExtractFunctionPayload, attempts?: CaptureAttemptTrace[]): ExtractAck {
  const duplicateCandidate = data.duplicate_candidate?.matched_receipt_id
    ? {
        matchedReceiptId: data.duplicate_candidate.matched_receipt_id,
        matchRule: data.duplicate_candidate.match_rule ?? 'merchant_date_currency_total',
        matchStrength: data.duplicate_candidate.match_strength ?? 'weak',
        merchant: data.duplicate_candidate.merchant ?? null,
        date: data.duplicate_candidate.txn_date ?? null,
        currency: data.duplicate_candidate.currency ?? null,
        total: typeof data.duplicate_candidate.total === 'number' ? data.duplicate_candidate.total : null,
      }
    : null;
  if (data.status === 202) throw errorWithAttempts(data.code ?? 'PROVIDER_DELAY', attempts ?? []);
  if (data.rejected || data.result?.is_receipt === false) {
    return { receiptId: data.receipt_id, response: { error: 'not_a_receipt' }, attempts, scansRemaining: data.scans_remaining };
  }
  if (data.duplicate) {
    return {
      receiptId: data.receipt_id,
      response: { error: 'duplicate_receipt' },
      attempts,
      duplicateCandidate,
      scansRemaining: data.scans_remaining,
    };
  }

  return {
    receiptId: data.receipt_id,
    attempts,
    duplicateCandidate,
    scansRemaining: data.scans_remaining,
    response: {
      date: data.result?.txn_date ?? '',
      store: data.result?.merchant ?? '',
      items: data.result?.line_items ?? [],
      currency: data.result?.currency ?? 'USD',
      total: data.result?.total ?? 0,
      category: data.result?.suggested_category ?? 'Miscellaneous',
      handwritten_notes: data.result?.handwritten_notes ?? '',
    },
  };
}

/** Turn a wire payload into app-side fields: date normalized, category guarded. */
export function toReceiptFields(r: ExtractSuccess): ReceiptFields {
  return {
    date: normalizeReceiptDate(r.date),
    store: r.store ?? '',
    items: Array.isArray(r.items) ? r.items : [],
    currency: /^[A-Z]{3}$/.test(r.currency ?? '') ? r.currency! : 'USD',
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

const SAMPLES: { store: string; items: string[]; currency: string; total: number; category: Category; notes: string }[] = [
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
    currency: 'USD',
    total: 73.36,
    category: 'Meals & Entertainment',
    notes: 'Weekly grocery run — paid with joint card',
  },
  { store: 'Shell', items: ['Unleaded 12.4 gal  48.20', 'Car wash  9.00'], currency: 'USD', total: 57.2, category: 'Vehicle Expenses', notes: '' },
  { store: 'Blue Bottle Coffee', items: ['Latte  5.75', 'Croissant  4.25'], currency: 'USD', total: 10.0, category: 'Meals & Entertainment', notes: 'Client catch-up — reimburse' },
  { store: 'Office Depot', items: ['Copy paper 5-ream  42.99', 'Pens 12pk  8.49'], currency: 'USD', total: 51.48, category: 'Office Supplies', notes: '' },
  { store: 'Delta Air Lines', items: ['SFO-JFK economy  318.40'], currency: 'USD', total: 318.4, category: 'Travel & Transit', notes: 'Q3 client visit' },
  { store: 'Adobe', items: ['Creative Cloud, 1 mo  59.99'], currency: 'USD', total: 59.99, category: 'Software & IT', notes: '' },
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
  async warmUpBalanced() {
    // No-op: the mock has no network path to warm.
  },
  async warmUpPrecise() {
    // No-op: the mock has no network path to warm.
  },
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
        items: normalizeReceiptItems(s.items),
        currency: s.currency,
        total: s.total,
        category: s.category,
        handwritten_notes: s.notes,
      },
    };
  },
};

export const supabaseExtractClient: ExtractClient = {
  warmUpBalanced() {
    if (balancedWarmupInFlight) return balancedWarmupInFlight;
    const env = getFoundationEnv();
    if (!env.supabaseUrl || !env.supabaseAnonKey) return Promise.resolve();
    const supabaseUrl = env.supabaseUrl;
    const supabaseAnonKey = env.supabaseAnonKey;
    const requestStartedAt = Date.now();
    balancedWarmupInFlight = getAccessTokenForRequest()
      .then(async (accessToken) => {
        const deviceId = await getDeviceId();
        const warmupSignal = childTimeoutSignal(undefined, BALANCED_WARMUP_TIMEOUT_MS);
        const response = await fetch(`${supabaseUrl}/functions/v1/extract-balanced`, {
          method: 'POST',
          signal: warmupSignal.signal,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'x-rf-device-id': deviceId,
            apikey: supabaseAnonKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ warm_up: true }),
        });
        warmupSignal.dispose();
        const payload = await response.json().catch(() => null) as { timing?: ExtractFunctionPayload['timing'] } | null;
        if (__DEV__) {
          console.log('[extract] balanced warm-up completed', {
            status: response.status,
            request_ms: Date.now() - requestStartedAt,
            server: payload?.timing ?? null,
          });
        }
        if (!response.ok) throw new Error(`balanced warm-up failed (${response.status})`);
        lastBalancedWarmupCompletedAt = Date.now();
      })
      .catch((error) => {
        if (__DEV__) console.warn('[extract] balanced warm-up failed', error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        balancedWarmupInFlight = null;
      });
    return balancedWarmupInFlight;
  },

  warmUpPrecise() {
    if (preciseWarmupInFlight) return preciseWarmupInFlight;
    const env = getFoundationEnv();
    if (!env.supabaseUrl || !env.supabaseAnonKey) return Promise.resolve();
    const supabaseUrl = env.supabaseUrl;
    const supabaseAnonKey = env.supabaseAnonKey;
    const requestStartedAt = Date.now();
    preciseWarmupInFlight = getAccessTokenForRequest()
      .then(async (accessToken) => {
        const deviceId = await getDeviceId();
        const warmupSignal = childTimeoutSignal(undefined, PRECISE_WARMUP_TIMEOUT_MS);
        const response = await fetch(`${supabaseUrl}/functions/v1/extract`, {
          method: 'POST',
          signal: warmupSignal.signal,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'x-rf-device-id': deviceId,
            apikey: supabaseAnonKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ warm_up: true }),
        });
        warmupSignal.dispose();
        const payload = await response.json().catch(() => null) as { timing?: ExtractFunctionPayload['timing'] } | null;
        if (__DEV__) {
          console.log('[extract] precise warm-up completed', {
            status: response.status,
            request_ms: Date.now() - requestStartedAt,
            server: payload?.timing ?? null,
          });
        }
        if (!response.ok) throw new Error(`precise warm-up failed (${response.status})`);
        lastPreciseWarmupCompletedAt = Date.now();
      })
      .catch((error) => {
        if (__DEV__) console.warn('[extract] precise warm-up failed', error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        preciseWarmupInFlight = null;
      });
    return preciseWarmupInFlight;
  },

  async extract({
    captureId,
    imageUri,
    mode,
    extractionMode,
    defaultCurrency,
    localOcrText,
    duplicateOverride,
    duplicateOfReceiptId,
    duplicateMatchStrength,
    capturedAt,
    signal,
  }) {
    assertNotAborted(signal);
    const env = getFoundationEnv();
    if (!env.supabaseUrl || !env.supabaseAnonKey) throw new Error('Supabase env missing');
    const supabaseAnonKey = env.supabaseAnonKey;
    let accessToken = await getAccessTokenForRequest();
    const deviceId = await getDeviceId();

    if (__DEV__) {
      console.log('[extract] invoking', { environment: env.environment, mockBackend: env.mockBackend, mode, extractionMode });
    }
    const requestStartedAt = Date.now();
    if (extractionMode === 'balanced' && localOcrText) {
      if (__DEV__) {
        console.log('[extract] sending balanced text-only request', {
          captureId,
          textLength: localOcrText.length,
          preview: localOcrText.slice(0, 120),
        });
      }
      let lastError: unknown = null;
      const attempts: CaptureAttemptTrace[] = [];
      const deadlineAt = Date.now() + BALANCED_HARD_DEADLINE_MS;
      const attemptSignals: ReturnType<typeof childTimeoutSignal>[] = [];
      let settled = false;
      let terminalHttpError: unknown = null;
      let rejectHedge: ((reason?: unknown) => void) | null = null;
      let hedgeTimer: ReturnType<typeof setTimeout> | null = null;
      let visibleTimer: ReturnType<typeof setTimeout> | null = null;

      const startBalancedAttempt = async (attempt: number) => {
        assertNotAborted(signal);
        if (attempt > 1) accessToken = await getAccessTokenForRequest();
        const remainingBudget = Math.max(250, deadlineAt - Date.now());
        const attemptStartedAt = Date.now();
        const timeoutMs = remainingBudget;
        const attemptSignal = childTimeoutSignal(signal, timeoutMs);
        attemptSignals.push(attemptSignal);
        const trace: CaptureAttemptTrace = {
          attempt_number: attempt,
          transport: 'balanced_text',
          started_at: new Date(attemptStartedAt).toISOString(),
          ended_at: new Date(attemptStartedAt).toISOString(),
          duration_ms: 0,
          status_code: null,
          error_message: null,
          retry_delay_ms: null,
          attempt_timeout_ms: timeoutMs,
          timed_out: 0,
          transport_error: 0,
          ms_since_warmup: lastBalancedWarmupCompletedAt == null ? null : attemptStartedAt - lastBalancedWarmupCompletedAt,
          app_state: AppState.currentState,
          abort_reason: null,
        };
        try {
          const attemptResponse = await fetch(`${env.supabaseUrl}/functions/v1/extract-balanced`, {
            method: 'POST',
            signal: attemptSignal.signal,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'x-rf-device-id': deviceId,
              apikey: supabaseAnonKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              capture_id: captureId,
              mode,
              extraction_mode: extractionMode,
              default_currency: defaultCurrency,
              extracted_text: localOcrText,
              duplicate_override: duplicateOverride === true,
              ...(duplicateOfReceiptId ? { duplicate_of: duplicateOfReceiptId } : {}),
              ...(duplicateMatchStrength ? { duplicate_match_strength: duplicateMatchStrength } : {}),
              captured_at: capturedAt,
            }),
          });
          const attemptEndedAt = Date.now();
          const attemptData = (await attemptResponse.json().catch(() => null)) as ExtractFunctionPayload | null;
          trace.ended_at = new Date(attemptEndedAt).toISOString();
          trace.duration_ms = attemptEndedAt - attemptStartedAt;
          trace.status_code = attemptResponse.status;
          trace.server_total_ms = attemptData?.timing?.total_ms ?? null;
          trace.server_auth_ms = attemptData?.timing?.auth_ms ?? null;
          trace.server_body_ms = attemptData?.timing?.body_ms ?? null;
          trace.server_model_ms = attemptData?.timing?.model_ms ?? null;
          trace.server_normalize_ms = attemptData?.timing?.normalize_ms ?? null;
          attempts.push(trace);
          if (attemptResponse.ok) {
            return { response: attemptResponse, data: attemptData };
          }

          const message = attemptData?.message ?? attemptData?.error ?? attemptData?.code ?? `extract failed (${attemptResponse.status})`;
          trace.error_message = message;
          const error = errorWithAttempts(message, attempts) as Error & {
            statusCode?: number;
            code?: string;
            retryAfterS?: number;
          };
          error.statusCode = attemptResponse.status;
          error.code = attemptData?.code;
          error.retryAfterS = attemptData?.retry_after_s;
          if (!isRetryableBalancedStatus(attemptResponse.status)) {
            terminalHttpError = error;
          }
          throw error;
        } catch (error) {
          const attemptEndedAt = Date.now();
          if (trace.duration_ms === 0) {
            trace.ended_at = new Date(attemptEndedAt).toISOString();
            trace.duration_ms = attemptEndedAt - attemptStartedAt;
            trace.error_message = error instanceof Error ? error.message : String(error);
            trace.timed_out = trace.duration_ms >= timeoutMs - 25 ? 1 : 0;
            trace.transport_error = isTransportErrorMessage(trace.error_message) ? 1 : 0;
            trace.abort_reason = attemptSignal.getReason();
            attempts.push(trace);
          }
          lastError = error;
          if (__DEV__ && trace.abort_reason !== 'winner_cancelled') {
            console.warn('[extract] balanced text attempt failed', {
              attempt,
              reason: trace.error_message,
              timedOut: trace.timed_out === 1,
              transportError: trace.transport_error === 1,
              abortReason: trace.abort_reason,
            });
          }
          throw error;
        } finally {
          attemptSignal.dispose();
        }
      };

      const primaryAttempt = startBalancedAttempt(1);
      const hedgedAttempt = new Promise<{ response: Response; data: ExtractFunctionPayload | null }>((resolve, reject) => {
        rejectHedge = reject;
        hedgeTimer = setTimeout(() => {
          if (settled) {
            reject(new Error('Hedged attempt skipped'));
            return;
          }
          if (terminalHttpError) {
            reject(terminalHttpError);
            return;
          }
          if (__DEV__) console.warn('[extract] balanced text hedge fired', { delayMs: BALANCED_HEDGE_DELAY_MS });
          startBalancedAttempt(2).then(resolve, reject);
        }, BALANCED_HEDGE_DELAY_MS);
      });
      primaryAttempt.catch((error) => {
        const statusCode = (error as Error & { statusCode?: number }).statusCode;
        if (statusCode != null) {
          terminalHttpError = error;
          if (hedgeTimer) clearTimeout(hedgeTimer);
          rejectHedge?.(error);
        }
      });

      const completion = (async () => {
        const winner = await Promise.any([primaryAttempt, hedgedAttempt]);
        settled = true;
        if (hedgeTimer) clearTimeout(hedgeTimer);
        attemptSignals.forEach((attemptSignal) => attemptSignal.abort('winner_cancelled'));
        if (!winner.data) throw errorWithAttempts('extract returned no data', attempts);
        if (__DEV__) {
          console.log('[extract] completed', {
            status: winner.response.status,
            request_ms: Date.now() - requestStartedAt,
            server: winner.data.timing,
            duplicate: winner.data.duplicate === true,
            rejected: winner.data.rejected === true,
          });
        }
        return extractPayloadToAck(winner.data, attempts);
      })().catch((error) => {
        settled = true;
        if (hedgeTimer) clearTimeout(hedgeTimer);
        attemptSignals.forEach((attemptSignal) => attemptSignal.abort('hard_timeout'));
        lastError =
          error instanceof AggregateError
            ? (error.errors.find((attemptError) => attemptError !== terminalHttpError) ?? terminalHttpError ?? error.errors[0] ?? error)
            : error;
        throw lastError instanceof Error
          ? Object.assign(lastError, { captureAttempts: attempts })
          : errorWithAttempts('extract returned no response', attempts);
      });

      const visibleDeadline = new Promise<'visible_deadline'>((resolve) => {
        visibleTimer = setTimeout(() => resolve('visible_deadline'), BALANCED_VISIBLE_DEADLINE_MS);
      });
      const result = await Promise.race([completion, visibleDeadline]);
      if (visibleTimer) clearTimeout(visibleTimer);
      if (result === 'visible_deadline') {
        if (__DEV__) {
          console.warn('[extract] visible deadline reached; request continues in background', {
            captureId,
            visibleDeadlineMs: BALANCED_VISIBLE_DEADLINE_MS,
          });
        }
        return { state: 'visible_deadline', attempts, deferred: completion };
      }
      return result;
    }

    if (__DEV__) {
      console.log('[extract] sending image request', {
        captureId,
        requestedExtractionMode: extractionMode,
        hasLocalOcrText: Boolean(localOcrText),
        reason: 'primary',
        ms_since_warmup: lastPreciseWarmupCompletedAt == null ? null : Date.now() - lastPreciseWarmupCompletedAt,
      });
    }
    const completion = (async (): Promise<ExtractCompletedAck> => {
      const response = await FileSystem.uploadAsync(`${env.supabaseUrl}/functions/v1/extract`, imageUri, {
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        httpMethod: 'POST',
        fieldName: 'image',
        mimeType: 'image/jpeg',
        parameters: {
          capture_id: captureId,
          mode,
          extraction_mode: extractionMode,
          duplicate_override: duplicateOverride === true ? '1' : '0',
          ...(localOcrText ? { extracted_text: localOcrText } : {}),
          ...(duplicateOfReceiptId ? { duplicate_of: duplicateOfReceiptId } : {}),
          ...(duplicateMatchStrength ? { duplicate_match_strength: duplicateMatchStrength } : {}),
          captured_at: capturedAt,
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-rf-device-id': deviceId,
          apikey: supabaseAnonKey,
        },
      });

      assertNotAborted(signal);
      let data: ExtractFunctionPayload | null = null;
      try {
        data = JSON.parse(response.body || 'null') as ExtractFunctionPayload | null;
      } catch {
        const preview = response.body ? response.body.slice(0, 160).trim() : '';
        throw new Error(preview || `extract returned non-JSON (${response.status})`);
      }
      if (response.status < 200 || response.status >= 300) {
        if (__DEV__ && (data?.model_preview || data?.model_parse_stage)) {
          console.warn('[extract] model JSON failure preview', {
            stage: data.model_parse_stage,
            preview: data.model_preview,
            previewLength: data.model_preview_length,
          });
        }
        const error = new Error(data?.message ?? data?.error ?? data?.code ?? `extract failed (${response.status})`) as Error & {
          statusCode?: number;
          code?: string;
          retryAfterS?: number;
        };
        error.statusCode = response.status;
        error.code = data?.code;
        error.retryAfterS = data?.retry_after_s;
        throw error;
      }
      if (!data) throw new Error('extract returned no data');
      const requestMs = Date.now() - requestStartedAt;
      const serverMs = data.timing?.total_ms ?? null;
      if (__DEV__) {
        console.log('[extract] completed', {
          status: response.status,
          request_ms: requestMs,
          transfer_gap_ms: serverMs == null ? null : Math.max(0, requestMs - serverMs),
          image_bytes: data.timing?.image_bytes ?? null,
          server: data.timing,
          duplicate: data.duplicate === true,
          rejected: data.rejected === true,
        });
      }
      if (data.status === 202) throw new Error(data.code ?? 'PROVIDER_DELAY');
      if (data.rejected || data.result?.is_receipt === false) {
        return { receiptId: data.receipt_id, response: { error: 'not_a_receipt' }, scansRemaining: data.scans_remaining };
      }
      if (data.duplicate) {
        return { receiptId: data.receipt_id, response: { error: 'duplicate_receipt' }, scansRemaining: data.scans_remaining };
      }

      return {
        receiptId: data.receipt_id,
        scansRemaining: data.scans_remaining,
        response: {
          date: data.result?.txn_date ?? '',
          store: data.result?.merchant ?? '',
          items: data.result?.line_items ?? [],
          currency: data.result?.currency ?? 'USD',
          total: data.result?.total ?? 0,
          category: data.result?.suggested_category ?? 'Miscellaneous',
          handwritten_notes: data.result?.handwritten_notes ?? '',
        },
      };
    })();

    const visibleDeadline = new Promise<'visible_deadline'>((resolve) => {
      setTimeout(() => resolve('visible_deadline'), PRECISE_VISIBLE_DEADLINE_MS);
    });
    const result = await Promise.race([completion, visibleDeadline]);
    if (result === 'visible_deadline') {
      if (__DEV__) {
        console.warn('[extract] precise visible deadline reached; request continues in background', {
          captureId,
          visibleDeadlineMs: PRECISE_VISIBLE_DEADLINE_MS,
        });
      }
      return { state: 'visible_deadline', attempts: [], deferred: completion };
    }
    return result;
  },

};

export const supabaseImageBackupClient: ImageBackupClient = {
  async upload({ captureId, imageUri, mode, extractionMode, capturedAt }) {
    const env = getFoundationEnv();
    if (!env.supabaseUrl || !env.supabaseAnonKey) throw new Error('Supabase env missing');
    const accessToken = await getAccessTokenForRequest();
    const deviceId = await getDeviceId();

    const response = await FileSystem.uploadAsync(`${env.supabaseUrl}/functions/v1/extract`, imageUri, {
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      httpMethod: 'POST',
      fieldName: 'image',
      mimeType: 'image/jpeg',
      parameters: {
        capture_id: captureId,
        mode,
        extraction_mode: extractionMode,
        upload_only: '1',
        captured_at: capturedAt,
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-rf-device-id': deviceId,
        apikey: env.supabaseAnonKey,
        // Only development bundles can opt into the failure drill. The switch
        // is intentionally absent from release behavior and exercises the
        // upload_only path without changing Storage permissions or credentials.
        ...(__DEV__ && process.env.EXPO_PUBLIC_FORCE_IMAGE_BACKUP_FAILURE === '1'
          ? { 'x-rf-force-storage-failure': '1' }
          : {}),
      },
    });

    const data = JSON.parse(response.body || 'null') as ConfirmReceiptErrorPayload | null;
    if (response.status < 200 || response.status >= 300) {
      throw new Error(data?.message ?? data?.error ?? data?.code ?? `image backup failed (${response.status})`);
    }
  },
};

export const supabaseCaptureMetricsClient: CaptureMetricsClient = {
  async upload({ captureId, receiptId, captureMode, extractionMode, metrics, attempts }) {
    const env = getFoundationEnv();
    if (!env.supabaseUrl || !env.supabaseAnonKey) throw new Error('Supabase env missing');
    const accessToken = await getAccessTokenForRequest();
    const deviceId = await getDeviceId();

    const startedAt = Date.now();
    const response = await fetch(`${env.supabaseUrl}/functions/v1/capture-metrics`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-rf-device-id': deviceId,
        apikey: env.supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        capture_id: captureId,
        receipt_id: receiptId,
        capture_mode: captureMode,
        extraction_mode: extractionMode,
        metrics: {
          ...metrics,
          metrics_upload_ms: Date.now() - startedAt,
        },
        attempts,
      }),
    });

    const data = (await response.json().catch(() => null)) as ConfirmReceiptErrorPayload | null;
    if (!response.ok) {
      throw new Error(data?.message ?? data?.error ?? data?.code ?? `capture metrics failed (${response.status})`);
    }
  },
};

export const supabaseConfirmReceiptClient: ConfirmReceiptClient = {
  async confirm({ receiptId, fields }) {
    const env = getFoundationEnv();
    if (!env.supabaseUrl || !env.supabaseAnonKey) throw new Error('Supabase env missing');
    const accessToken = await getAccessTokenForRequest();
    const deviceId = await getDeviceId();

    // Bounded on purpose. This request used to have no timeout at all, so a
    // connection that never settled left the local row marked `syncing` with
    // nothing to retry it and no error to show — the receipt looked saved on
    // the device and never reached the server. A timeout turns that silence
    // into an ordinary retryable failure.
    const timeout = childTimeoutSignal(undefined, CONFIRM_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${env.supabaseUrl}/functions/v1/receipt-confirm`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-rf-device-id': deviceId,
          apikey: env.supabaseAnonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ receipt_id: receiptId, fields }),
        signal: timeout.signal,
      });
    } finally {
      timeout.dispose();
    }

    let data: ConfirmReceiptErrorPayload | null = null;
    try {
      data = (await response.json()) as ConfirmReceiptErrorPayload;
    } catch {
      // A non-JSON edge/gateway response should still leave the local row queued.
    }
    if (!response.ok) {
      const error = new Error(data?.message ?? data?.error ?? data?.code ?? `confirm failed (${response.status})`);
      // The caller has to tell "the server is briefly unwell" from "the server
      // will reject this forever" — one is worth retrying and the other never
      // is. Without the status that distinction is unrecoverable, because a
      // JSON error body replaces the only place it appeared.
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
  },
};

export const mockConfirmReceiptClient: ConfirmReceiptClient = {
  async confirm() {
    await wait(120);
  },
};

export const mockImageBackupClient: ImageBackupClient = {
  async upload() {
    await wait(120);
  },
};

export const mockCaptureMetricsClient: CaptureMetricsClient = {
  async upload() {
    await wait(20);
  },
};

// ── Selection ───────────────────────────────────────────────────────────────

/** The app's client. Swap to a real HTTP client once /extract exists. */
export const extractClient: ExtractClient = getFoundationEnv().mockBackend ? mockExtractClient : supabaseExtractClient;
export const confirmReceiptClient: ConfirmReceiptClient = getFoundationEnv().mockBackend
  ? mockConfirmReceiptClient
  : supabaseConfirmReceiptClient;
export const imageBackupClient: ImageBackupClient = getFoundationEnv().mockBackend
  ? mockImageBackupClient
  : supabaseImageBackupClient;
export const captureMetricsClient: CaptureMetricsClient = getFoundationEnv().mockBackend
  ? mockCaptureMetricsClient
  : supabaseCaptureMetricsClient;

export { isDuplicateReceipt, isNotAReceipt, CATEGORIES };
