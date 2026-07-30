// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

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

    const body = await req.json().catch(() => null);
    const receiptId = String(body?.receipt_id ?? '');
    if (!isUuid(receiptId)) return json(400, { code: 'VALIDATION_FAILED', message: 'receipt_id must be a UUID' });

    const { data: receipt, error } = await admin
      .from('receipts')
      .update({ status: 'confirmed', confirmed_via: 'user' })
      .eq('id', receiptId)
      .eq('user_id', userData.user.id)
      .select('id, status, confirmed_via')
      .maybeSingle();

    if (error) return json(500, { code: 'VALIDATION_FAILED', message: error.message });
    if (!receipt) return json(404, { code: 'NOT_FOUND', message: 'Receipt not found' });

    return json(200, { status: 200, receipt_id: receipt.id, confirmed_via: receipt.confirmed_via });
  } catch (error) {
    return json(500, {
      code: 'VALIDATION_FAILED',
      message: error instanceof Error ? error.message : 'Unexpected confirmation failure',
    });
  }
});
