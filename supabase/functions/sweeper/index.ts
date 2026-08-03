// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

import { claimAndRunExtractionJobs } from '../_shared/extraction-jobs.ts';

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
    const result = await claimAndRunExtractionJobs(admin, limit);
    return json(200, { status: 200, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[sweeper] failed', { message });
    return json(500, { code: 'VALIDATION_FAILED', message });
  }
});
