/** Live B6 acceptance checks against staging using disposable users only. */
const { createClient } = require('@supabase/supabase-js');

const { connectPg, makeAdmin, resolveConfig, withUser } = require('./lib/staging');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const rpcDefaults = {
  p_text: null,
  p_date_from: null,
  p_date_to: null,
  p_category_ids: null,
  p_amount_min: null,
  p_amount_max: null,
  p_amount_currency: null,
  p_limit: 200,
  p_offset: 0,
};

async function signedInClient(config, email, password) {
  const client = createClient(config.url, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

async function search(client, args, label) {
  const startedAt = performance.now();
  const { data, error } = await client.rpc('search_receipts', { ...rpcDefaults, ...args });
  const elapsedMs = performance.now() - startedAt;
  if (error) throw new Error(`${label}: ${error.message}`);
  console.log(`[b6:staging] ${label}: ${data.length} rows (${elapsedMs.toFixed(1)}ms round trip)`);
  return { rows: data, elapsedMs };
}

async function seed(pg, userId) {
  const categories = await pg.query('select id from public.categories order by id limit 10');
  assert(categories.rows.length >= 10, 'Staging needs at least 10 categories for the B6 fixture');
  const categoryIds = categories.rows.map((row) => row.id);
  await pg.query('begin');
  try {
    await pg.query(
      `insert into public.user_categories (user_id, category_id, sort_order)
       select $1, id, row_number() over (order by id)
       from public.categories
       on conflict (user_id, category_id) do nothing`,
      [userId],
    );
    await pg.query(
      `create temporary table b6_live_rows on commit drop as
       select n, gen_random_uuid() receipt_id, gen_random_uuid() capture_id
       from generate_series(1, 200) n`,
    );
    await pg.query(
      `insert into public.receipts (
         id, user_id, capture_id, status, confirmed_via, capture_mode, provider,
         merchant, txn_date, currency, total, category_id, notes, created_at, updated_at
       )
       select s.receipt_id, $1, s.capture_id, 'confirmed', 'user', 'default', 'grok',
              format('B6 Live Merchant %s', lpad(s.n::text, 3, '0')),
              date '2026-01-01' + (s.n - 1),
              case s.n % 3 when 1 then 'USD' when 2 then 'EUR' else 'GBP' end,
              round((9.50 + s.n * 1.25)::numeric, 2),
              ($2::int[])[((s.n - 1) % 10) + 1],
              format('B6 live note cohort-%s', ((s.n - 1) % 8) + 1),
              now() - make_interval(mins => 201 - s.n),
              now() - make_interval(mins => 201 - s.n)
       from b6_live_rows s`,
      [userId, categoryIds],
    );
    await pg.query(
      `insert into public.receipt_items (receipt_id, name, qty, amount)
       select s.receipt_id, item.name, item.qty, item.amount
       from b6_live_rows s
       cross join lateral (values
         (format('B6 Live Item %s Alpha', lpad(s.n::text, 3, '0')), 1::numeric, round((s.n * .60)::numeric, 2)),
         (format('B6 Live Item %s Beta', lpad(s.n::text, 3, '0')), 2::numeric, round((s.n * .30)::numeric, 2))
       ) item(name, qty, amount)`,
    );
    await pg.query('commit');
    return categoryIds;
  } catch (error) {
    await pg.query('rollback');
    throw error;
  }
}

async function verify(config, pg, admin, owner, intruder) {
  const categoryIds = await seed(pg, owner.userId);
  const ownerClient = await signedInClient(config, owner.email, owner.password);
  const intruderClient = await signedInClient(config, intruder.email, intruder.password);

  const merchant = await search(ownerClient, { p_text: 'B6 Live Merchant 042' }, 'T6.1 merchant');
  const item = await search(ownerClient, { p_text: 'B6 Live Item 137 Alpha' }, 'T6.1 item');
  const note = await search(ownerClient, { p_text: 'cohort-4' }, 'T6.1 note');
  assert(merchant.rows.length === 1, `merchant search returned ${merchant.rows.length}`);
  assert(item.rows.length === 1, `item search returned ${item.rows.length}`);
  assert(note.rows.length === 25, `note search returned ${note.rows.length}`);
  const maxLatency = Math.max(merchant.elapsedMs, item.elapsedMs, note.elapsedMs);
  if (maxLatency >= 150) console.warn(`[b6:staging] WARN T6.1 latency exceeds 150ms (${maxLatency.toFixed(1)}ms)`);

  const combined = await search(ownerClient, {
    p_text: 'B6 Live Merchant 042',
    p_date_from: '2026-02-11',
    p_date_to: '2026-02-11',
    p_category_ids: [categoryIds[1]],
    p_amount_min: 61,
    p_amount_max: 63,
    p_amount_currency: 'GBP',
  }, 'T6.2 combined filters');
  assert(combined.rows.length === 1, `combined filters returned ${combined.rows.length}`);
  const { error: ambiguousError } = await ownerClient.rpc('search_receipts', {
    ...rpcDefaults,
    p_amount_min: 10,
    p_amount_currency: null,
  });
  assert(ambiguousError, 'amount filter without currency was accepted');

  const targetId = merchant.rows[0].id;
  const operationId = crypto.randomUUID();
  const beforeRevision = Number(merchant.rows[0].revision || 1);
  const editArgs = {
    p_operation_id: operationId,
    p_expected_revision: beforeRevision,
    p_receipt_id: targetId,
    p_merchant: 'B6 Shared Editor Result',
    p_txn_date: '2026-02-11',
    p_currency: 'GBP',
    p_total: 62,
    p_category_id: categoryIds[1],
    p_notes: 'B6 shared editor note',
    p_items: [{ name: 'B6 Shared Editor Item', qty: 1, amount: 62 }],
  };
  console.log('[b6:staging] T6.3 applying revision-aware edit');
  const { data: editedRevision, error: updateError } = await ownerClient.rpc('update_receipt_with_items_v2', editArgs);
  if (updateError) throw updateError;
  console.log(`[b6:staging] T6.3 edit revision=${editedRevision}; retrying same operation`);
  const retry = await ownerClient.rpc('update_receipt_with_items_v2', editArgs);
  if (retry.error) throw retry.error;
  assert(retry.data === editedRevision, 'idempotent retry returned a different revision');
  console.log('[b6:staging] T6.3 idempotent retry passed; submitting stale revision');
  const stale = await ownerClient.rpc('update_receipt_with_items_v2', {
    ...editArgs,
    p_operation_id: crypto.randomUUID(),
    p_merchant: 'B6 stale edit must fail',
  });
  console.log(`[b6:staging] T6.3 stale result code=${stale.error?.code ?? 'none'}`);
  assert(stale.error?.code === 'PT409', 'stale revision was not rejected as an HTTP 409 conflict');
  const edited = await search(ownerClient, { p_text: 'B6 Shared Editor Item' }, 'T6.3 atomic edit');
  assert(edited.rows.length === 1 && edited.rows[0].id === targetId, 'atomic edit was not searchable');

  const hiddenRead = await intruderClient.from('receipts').select('id').eq('id', targetId);
  assert(!hiddenRead.error && hiddenRead.data.length === 0, 'cross-user read was not denied');
  const hiddenPatch = await intruderClient.from('receipts').update({ merchant: 'ILLEGAL' }).eq('id', targetId).select('id');
  assert(hiddenPatch.error || hiddenPatch.data.length === 0, 'cross-user patch changed a row');
  const hiddenDelete = await intruderClient.from('receipts').delete().eq('id', targetId).select('id');
  assert(hiddenDelete.error || hiddenDelete.data.length === 0, 'cross-user hard delete changed a row');
  const { error: hiddenRpcDelete } = await intruderClient.rpc('soft_delete_receipt', { p_receipt_id: targetId });
  assert(hiddenRpcDelete, 'cross-user soft delete was accepted');

  const { error: deleteError } = await ownerClient.rpc('soft_delete_receipt', { p_receipt_id: targetId });
  if (deleteError) throw deleteError;
  const vanished = await search(ownerClient, { p_text: 'B6 Shared Editor Item' }, 'T6.4 soft delete hidden');
  assert(vanished.rows.length === 0, 'soft-deleted receipt remained searchable');
  const { error: restoreError } = await ownerClient.rpc('restore_receipt', { p_receipt_id: targetId });
  if (restoreError) throw restoreError;
  const restored = await search(ownerClient, { p_text: 'B6 Shared Editor Item' }, 'T6.4 undo restore');
  assert(restored.rows.length === 1, 'restored receipt did not return to search');
  const { error: finalDeleteError } = await ownerClient.rpc('soft_delete_receipt', { p_receipt_id: targetId });
  if (finalDeleteError) throw finalDeleteError;
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 60_000).toISOString();
  const { data: purgeRows, error: purgeError } = await admin.rpc('purge_soft_deleted_receipts', {
    p_before: future,
    p_limit: 1000,
    p_dry_run: true,
  });
  if (purgeError) throw purgeError;
  assert(purgeRows.some((row) => row.receipt_id === targetId), '30-day purge dry-run missed the receipt');

  console.log('[b6:staging] PASS functional checks T6.1 T6.2 T6.3-revision-idempotency T6.4 T6.5');
  console.log('[b6:staging] NOTE T6.1 latency gate is measured on device SQLite; server RTT is correctness fallback only');
}

async function main() {
  const config = resolveConfig({ needDbUrl: true, needAnonKey: true });
  const pg = await connectPg(config);
  const admin = makeAdmin(config);
  try {
    await withUser(admin, async (owner) => {
      await withUser(admin, async (intruder) => verify(config, pg, admin, owner, intruder), pg);
    }, pg);
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(`[b6:staging] FAIL ${error instanceof Error ? error.message : JSON.stringify(error)}`);
  process.exit(1);
});
