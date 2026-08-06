// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

import { claimAndRunExtractionJobs } from '../_shared/extraction-jobs.ts';

const RECEIPT_PURGE_LIMIT = 100;

async function purgeSoftDeletedReceipts(admin: ReturnType<typeof createClient>) {
  const { data: purged, error } = await admin.rpc('purge_soft_deleted_receipts', {
    p_before: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    p_limit: RECEIPT_PURGE_LIMIT,
    p_dry_run: false,
  });
  if (error) throw error;

  const { data: queued, error: queueError } = await admin
    .from('receipt_image_purge_queue')
    .select('image_path,attempts')
    .order('created_at', { ascending: true })
    .limit(RECEIPT_PURGE_LIMIT);
  if (queueError) throw queueError;

  const paths = (queued ?? [])
    .map((row: { image_path?: string | null }) => row.image_path)
    .filter((path: unknown): path is string => typeof path === 'string' && path.length > 0);
  if (paths.length > 0) {
    const { error: storageError } = await admin.storage.from('receipts').remove(paths);
    if (storageError) {
      const attempts = Math.max(...(queued ?? []).map((row: { attempts?: number }) => Number(row.attempts) || 0)) + 1;
      await admin.from('receipt_image_purge_queue').update({ attempts, updated_at: new Date().toISOString() }).in('image_path', paths);
      throw storageError;
    }
    const { error: dequeueError } = await admin.from('receipt_image_purge_queue').delete().in('image_path', paths);
    if (dequeueError) throw dequeueError;
  }
  return purged?.length ?? 0;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json(500, { code: 'VALIDATION_FAILED', message: 'Supabase env missing' });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const limit = Math.max(1, Math.min(25, Number(Deno.env.get('EXTRACTION_JOB_SWEEP_LIMIT') || 5)));

  try {
    const [result, purged_receipts] = await Promise.all([
      claimAndRunExtractionJobs(admin, limit),
      purgeSoftDeletedReceipts(admin),
    ]);
    return json(200, { status: 200, ...result, purged_receipts });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[sweeper] failed', { message });
    return json(500, { code: 'VALIDATION_FAILED', message });
  }
});
