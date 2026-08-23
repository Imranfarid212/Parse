// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

import { getUserCategories, resolveCategoryId } from '../_shared/categories.ts';
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
  clientCategoriesVersion: string | null,
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
  // sent it — the same rule extraction applies to the model's answer. The
  // fingerprint keeps that rule from misfiring the other way: a category the
  // user added moments ago is not in this isolate's cached map, so without it
  // the user's own deliberate choice silently resolved to Miscellaneous.
  const categories = await getUserCategories(admin, userId, undefined, 'receipt-confirm', clientCategoriesVersion);
  patch.category_id = resolveCategoryId(categories, fields.category);

  return patch;
}

function normalizeItems(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Items must contain at most 100 rows');
  return value.map((item) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const name = normalizeText(row.name).slice(0, 160);
    const qty = Number(row.qty);
    const amount = Number(row.amount);
    if (!name || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(amount) || amount < 0) throw new Error('Each item needs a name, quantity, and amount');
    return { name, qty, amount };
  });
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
    const deviceId = req.headers.get('x-rf-device-id') ?? '';
    if (!isDeviceId(deviceId)) return json(400, { code: 'VALIDATION_FAILED', message: 'Device identifier required' });
    if (!(await isActiveDevice(admin, userData.user.id, deviceId))) {
      return json(409, { code: 'DEVICE_INACTIVE', message: 'This device is no longer active' });
    }

    const body = await req.json().catch(() => null);
    const receiptId = String(body?.receipt_id ?? '');
    if (!isUuid(receiptId)) return json(400, { code: 'VALIDATION_FAILED', message: 'receipt_id must be a UUID' });

    const clientCategoriesVersion =
      typeof body?.categories_version === 'string' && body.categories_version.length <= 128
        ? body.categories_version
        : null;
    const patch = await buildFieldPatch(admin, userData.user.id, body?.fields ?? null, clientCategoriesVersion);
    const items = normalizeItems(body?.fields?.items);

    const { data: receipt, error } = await admin.rpc('confirm_receipt_with_items', {
      p_user_id: userData.user.id,
      p_receipt_id: receiptId,
      p_merchant: patch.merchant ?? null,
      p_txn_date: patch.txn_date ?? null,
      p_currency: patch.currency ?? null,
      p_total: patch.total ?? null,
      p_category_id: patch.category_id ?? null,
      p_notes: patch.notes ?? '',
      p_items: items,
    });

    if (error) return json(500, { code: 'VALIDATION_FAILED', message: error.message });
    if (receipt !== true) return json(404, { code: 'NOT_FOUND', message: 'Receipt not found' });

    return json(200, { status: 200, receipt_id: receiptId, confirmed_via: 'user' });
  } catch (error) {
    return json(500, {
      code: 'VALIDATION_FAILED',
      message: error instanceof Error ? error.message : 'Unexpected confirmation failure',
    });
  }
});
