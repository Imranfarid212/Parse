// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

import { probeGrok } from '../_shared/extraction-jobs.ts';

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

  try {
    await probeGrok();
    const { error } = await admin.rpc('close_provider_breaker_after_probe');
    if (error) throw error;
    return json(200, { status: 200, provider: 'grok', breaker_state: 'closed' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[provider-probe] failed', { message });
    return json(503, { code: 'VALIDATION_FAILED', message });
  }
});
