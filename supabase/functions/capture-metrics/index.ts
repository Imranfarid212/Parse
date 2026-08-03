// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

import { isActiveDevice, isDeviceId } from '../_shared/device.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-rf-device-id',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const intOrNull = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

const addMetric = (row: Record<string, unknown>, metrics: Record<string, unknown>, key: string) => {
  if (Object.prototype.hasOwnProperty.call(metrics, key)) {
    row[key] = intOrNull(metrics[key]);
  }
};

const stringOrNull = (value: unknown) => {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, 500) : null;
};

const dateOrNull = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};

Deno.serve(async (req) => {
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
    const { data: userData, error: userError } = await userSupabase.auth.getUser();
    if (userError || !userData.user) return json(401, { code: 'VALIDATION_FAILED', message: 'Authentication required' });
    const deviceId = req.headers.get('x-rf-device-id') ?? '';
    if (!isDeviceId(deviceId)) return json(400, { code: 'VALIDATION_FAILED', message: 'Device identifier required' });
    if (!(await isActiveDevice(admin, userData.user.id, deviceId))) {
      return json(409, { code: 'DEVICE_INACTIVE', message: 'This device is no longer active' });
    }

    const body = await req.json().catch(() => null);
    const captureId = String(body?.capture_id ?? '');
    const receiptId = body?.receipt_id ? String(body.receipt_id) : null;
    if (!isUuid(captureId)) return json(400, { code: 'VALIDATION_FAILED', message: 'capture_id must be a UUID' });
    if (receiptId && !isUuid(receiptId)) return json(400, { code: 'VALIDATION_FAILED', message: 'receipt_id must be a UUID' });

    const metrics = body?.metrics && typeof body.metrics === 'object' ? body.metrics : {};
    const row: Record<string, unknown> = {
      user_id: userData.user.id,
      capture_id: captureId,
      receipt_id: receiptId,
      capture_mode: String(body?.capture_mode ?? 'default'),
      extraction_mode: String(body?.extraction_mode ?? 'balanced'),
      updated_at: new Date().toISOString(),
    };

    addMetric(row, metrics, 'document_correction_ms');
    addMetric(row, metrics, 'compression_ms');
    addMetric(row, metrics, 'local_file_ms');
    addMetric(row, metrics, 'local_row_ms');
    addMetric(row, metrics, 'local_ocr_ms');
    addMetric(row, metrics, 'ocr_image_resize_ms');
    addMetric(row, metrics, 'ocr_input_width');
    addMetric(row, metrics, 'ocr_input_height');
    addMetric(row, metrics, 'ocr_timeout_ms');
    addMetric(row, metrics, 'local_ocr_timed_out');
    addMetric(row, metrics, 'backend_extract_ms');
    addMetric(row, metrics, 'total_to_response_ms');
    addMetric(row, metrics, 'total_to_ui_ms');
    addMetric(row, metrics, 'image_backup_ms');
    addMetric(row, metrics, 'metrics_upload_ms');

    const { data, error } = await admin
      .from('receipt_capture_metrics')
      .upsert(row, { onConflict: 'user_id,capture_id' })
      .select('id')
      .single();
    if (error) return json(500, { code: 'VALIDATION_FAILED', message: error.message });

    const attempts = Array.isArray(body?.attempts) ? body.attempts : [];
    if (attempts.length > 0) {
      const attemptRows = attempts
        .map((attempt: unknown, index: number) => {
          const a = attempt && typeof attempt === 'object' ? (attempt as Record<string, unknown>) : {};
          const attemptNumber = intOrNull(a.attempt_number) ?? index + 1;
          const durationMs = intOrNull(a.duration_ms);
          const serverTotalMs = intOrNull(a.server_total_ms);
          return {
            user_id: userData.user.id,
            capture_id: captureId,
            receipt_id: receiptId,
            attempt_number: attemptNumber,
            transport: stringOrNull(a.transport) ?? 'balanced_text',
            started_at: dateOrNull(a.started_at),
            ended_at: dateOrNull(a.ended_at),
            duration_ms: durationMs,
            status_code: intOrNull(a.status_code),
            error_message: stringOrNull(a.error_message),
            retry_delay_ms: intOrNull(a.retry_delay_ms),
            server_total_ms: serverTotalMs,
            server_auth_ms: intOrNull(a.server_auth_ms),
            server_body_ms: intOrNull(a.server_body_ms),
            server_model_ms: intOrNull(a.server_model_ms),
            server_normalize_ms: intOrNull(a.server_normalize_ms),
            network_gap_ms: durationMs != null && serverTotalMs != null ? Math.max(0, durationMs - serverTotalMs) : null,
            attempt_timeout_ms: intOrNull(a.attempt_timeout_ms),
            timed_out: intOrNull(a.timed_out),
            transport_error: intOrNull(a.transport_error),
            ms_since_warmup: intOrNull(a.ms_since_warmup),
            app_state: stringOrNull(a.app_state),
          };
        })
        .filter((attempt) => attempt.attempt_number > 0);

      if (attemptRows.length > 0) {
        const { error: attemptsError } = await admin
          .from('receipt_capture_attempts')
          .upsert(attemptRows, { onConflict: 'user_id,capture_id,attempt_number' });
        if (attemptsError) return json(500, { code: 'VALIDATION_FAILED', message: attemptsError.message });
      }
    }

    return json(200, { status: 200, id: data.id });
  } catch (error) {
    return json(500, {
      code: 'VALIDATION_FAILED',
      message: error instanceof Error ? error.message : 'Unexpected metrics failure',
    });
  }
});
