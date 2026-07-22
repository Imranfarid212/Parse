// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-rf-force-storage-failure',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { code: 'VALIDATION_FAILED', message: 'POST required' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return json(500, { code: 'VALIDATION_FAILED', message: 'Supabase env missing' });

  const authorization = req.headers.get('Authorization') ?? '';
  const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json(401, { code: 'VALIDATION_FAILED', message: 'Authentication required' });

  const form = await req.formData();
  const captureId = String(form.get('capture_id') ?? '');
  const mode = String(form.get('mode') ?? '');
  const capturedAt = String(form.get('captured_at') ?? '');
  const image = form.get('image');

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(captureId)) {
    return json(400, { code: 'VALIDATION_FAILED', message: 'capture_id must be a v4 UUID' });
  }
  if (mode !== 'default' && mode !== 'one_click') {
    return json(400, { code: 'VALIDATION_FAILED', message: 'mode must be default or one_click' });
  }
  if (!capturedAt || Number.isNaN(Date.parse(capturedAt))) {
    return json(400, { code: 'VALIDATION_FAILED', message: 'captured_at must be an ISO datetime' });
  }
  if (!(image instanceof File)) return json(400, { code: 'VALIDATION_FAILED', message: 'image file required' });
  if (image.type !== 'image/jpeg') return json(400, { code: 'VALIDATION_FAILED', message: 'image must be JPEG' });
  if (image.size > 2_000_000) return json(400, { code: 'VALIDATION_FAILED', message: 'image too large' });

  const userId = userData.user.id;
  const imagePath = `${userId}/${captureId}.jpg`;
  if (req.headers.get('x-rf-force-storage-failure') === '1') {
    return json(503, { code: 'VALIDATION_FAILED', message: 'Forced Storage failure' });
  }

  const bytes = new Uint8Array(await image.arrayBuffer());
  const { error: uploadError } = await supabase.storage.from('receipts').upload(imagePath, bytes, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (uploadError) return json(503, { code: 'VALIDATION_FAILED', message: uploadError.message });

  const ackedAt = new Date().toISOString();
  const { data: receipt, error: receiptError } = await supabase
    .from('receipts')
    .upsert(
      {
        user_id: userId,
        capture_id: captureId,
        capture_mode: mode,
        status: 'needs_review',
        image_path: imagePath,
        image_byte_size: image.size,
        merchant: 'Whole Foods Market',
        txn_date: '2026-07-01',
        currency: 'USD',
        total: 73.36,
        notes: 'B3 v0 fixture extraction response',
        acked_at: ackedAt,
      },
      { onConflict: 'capture_id' },
    )
    .select('id')
    .single();

  if (receiptError) return json(500, { code: 'VALIDATION_FAILED', message: receiptError.message });

  return json(200, {
    status: 200,
    receipt_id: receipt.id,
    image_path: imagePath,
    acked_at: ackedAt,
    result: {
      merchant: 'Whole Foods Market',
      txn_date: '2026-07-01',
      currency: 'USD',
      total: 73.36,
      line_items: [{ name: 'Organic bananas 1.2 lb', qty: 1, amount: 1.74 }],
      suggested_category: 'Meals & Entertainment',
      is_receipt: true,
    },
  });
});
