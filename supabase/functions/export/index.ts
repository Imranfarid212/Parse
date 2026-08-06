// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * POST /export — start an export of the user's filtered receipts.
 *
 * Async by design (Blueprint §12): this returns the job, never the file. The
 * work then runs inline as a background task so the ordinary export is ready in
 * seconds, but the response does not depend on that finishing — the job row is
 * committed before the response leaves, and the sweeper is what guarantees the
 * files eventually exist. A dead instance costs a delay, not an export.
 *
 * Everything the user sees afterwards arrives over Realtime on export_jobs.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

import { validateExportRequest } from '../_shared/exports/request.ts';
import { claimAndRunExportJob } from '../_shared/exports/run.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-rf-device-id',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

function waitUntil(promise: Promise<unknown>) {
  const runtime = (globalThis as Record<string, unknown>).EdgeRuntime as
    | { waitUntil?: (promise: Promise<unknown>) => void }
    | undefined;
  if (runtime?.waitUntil) runtime.waitUntil(promise);
  else promise.catch(() => {});
}

function toContractJob(row) {
  return {
    id: row.id,
    status: row.status,
    format: row.format,
    include_images: row.include_images,
    filters: row.filters ?? {},
    artifacts: Array.isArray(row.artifacts) ? row.artifacts : [],
    receipt_count: row.receipt_count ?? null,
    timezone: row.timezone ?? null,
    error: row.error ?? null,
    expires_at: row.expires_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { code: 'VALIDATION_FAILED', message: 'POST required' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, { code: 'VALIDATION_FAILED', message: 'Supabase env missing' });
  }

  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization) return json(401, { code: 'VALIDATION_FAILED', message: 'Authorization required' });

  const userSupabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: userData, error: userError } = await userSupabase.auth.getUser();
  const userId = userData?.user?.id;
  if (userError || !userId) return json(401, { code: 'VALIDATION_FAILED', message: 'Invalid session' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { code: 'VALIDATION_FAILED', message: 'A JSON body is required' });
  }

  const validated = validateExportRequest(body);
  if (validated.error) return json(400, { code: 'VALIDATION_FAILED', message: validated.error });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: job, error: enqueueError } = await admin.rpc('enqueue_export_job', {
    p_user_id: userId,
    p_filters: validated.request.filters,
    p_format: validated.request.format,
    p_include_images: validated.request.include_images,
    p_timezone: validated.request.timezone ?? null,
  });

  if (enqueueError) {
    // PT429 is the concurrency cap, raised inside the same statement that would
    // have inserted the row — the user has exports running, not a broken app.
    if (enqueueError.code === 'PT429' || /too many exports/i.test(enqueueError.message ?? '')) {
      return json(429, { code: 'RATE_LIMITED', message: 'You already have exports running. Wait for those to finish.' });
    }
    console.error('[export] enqueue failed', { message: enqueueError.message });
    return json(500, { code: 'VALIDATION_FAILED', message: 'Could not start the export' });
  }

  // The row is committed. Building it inline is an optimization from here on:
  // if this instance dies mid-build the lease expires and the sweeper finishes
  // the job, and the client is watching the same row either way.
  waitUntil(claimAndRunExportJob(admin, job.id));

  return json(202, { status: 202, job: toContractJob(job) });
});
