// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

import { getUserCategories, resolveCategoryId } from '../_shared/categories.ts';

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

const isIsoDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isCurrency = (value: unknown) => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const normalizeText = (value: unknown) => String(value ?? '').trim();

/**
 * The values the user can actually change, mapped onto the receipt columns.
 *
 * This is the only path by which anything the user typed reaches the database —
 * extraction stores the model's reading, and every correction made afterwards
 * comes through here. It is written to be safe to call more than once, so
 * editing a receipt later reuses it rather than needing a second endpoint.
 *
 * Line items are deliberately not written: the app flattens them to plain text
 * before they ever reach the device, so pushing them back would overwrite real
 * quantities and amounts with placeholders. See the B4 follow-up.
 */
async function buildFieldPatch(
  admin: { from: (table: string) => any },
  userId: string,
  fields: Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  const patch: Record<string, unknown> = { status: 'confirmed', confirmed_via: 'user' };
  if (!fields || typeof fields !== 'object') return patch;

  const merchant = normalizeText(fields.store);
  if (merchant) patch.merchant = merchant.slice(0, 160);
  if (isIsoDate(fields.date)) patch.txn_date = fields.date;
  if (isCurrency(fields.currency)) patch.currency = fields.currency;

  const total = typeof fields.total === 'number' ? fields.total : Number(fields.total);
  if (Number.isFinite(total) && total >= 0) patch.total = total;

  patch.notes = normalizeText(fields.handwritten_notes).slice(0, 2000);

  // A category the account does not actually have must never be stored, whoever
  // sent it — the same rule extraction applies to the model's answer.
  const categories = await getUserCategories(admin, userId, undefined, 'receipt-confirm');
  patch.category_id = resolveCategoryId(categories, fields.category);

  return patch;
}

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

    const patch = await buildFieldPatch(admin, userData.user.id, body?.fields ?? null);

    const { data: receipt, error } = await admin
      .from('receipts')
      .update(patch)
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
