const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const fail = (message) => { throw new Error(`[b6:backend] ${message}`); };
const includes = (source, needle, label) => { if (!source.includes(needle)) fail(`${label}: expected ${JSON.stringify(needle)}`); };
const excludes = (source, needle, label) => { if (source.includes(needle)) fail(`${label}: did not expect ${JSON.stringify(needle)}`); };

const migration = read('supabase/migrations/20260804000100_b6_receipt_management.sql');
const revisionMigration = read('supabase/migrations/20260804000200_b6_local_first_revision.sql');
const conflictMigration = read('supabase/migrations/20260804000500_b6_conflict_http_status.sql');
const foundations = read('supabase/migrations/20260719000100_b1_foundations.sql');
const sweeper = read('supabase/functions/sweeper/index.ts');
const schemas = read('packages/contracts/src/schemas.ts');
const searchVectorFunction = foundations.slice(
  foundations.indexOf('create or replace function public.refresh_receipt_search_text'),
  foundations.indexOf('create or replace function public.receipts_search_text_trigger'),
);

includes(migration, 'with (security_invoker = true)', 'shared active-receipt predicate honors RLS');
includes(migration, 'function public.search_receipts', 'ranked search RPC exists');
includes(migration, "websearch_to_tsquery('simple'", 'query text is parsed safely');
includes(migration, 'ts_rank_cd', 'text matches are ranked');
includes(migration, 'amount_currency is required with amount filters', 'currency-less amount filters are rejected');
includes(migration, 'r.currency = p_amount_currency', 'amount comparisons are currency scoped');
includes(migration, 'function public.update_receipt_with_items', 'atomic edit RPC exists');
includes(migration, 'delete from public.receipt_items', 'line-item replacement is in the edit transaction');
includes(migration, 'function public.soft_delete_receipt', 'soft-delete RPC exists');
includes(migration, 'function public.restore_receipt', 'restore RPC exists');
includes(migration, 'function public.purge_soft_deleted_receipts', '30-day purge RPC exists');
includes(migration, 'for update skip locked', 'purge is concurrency safe');
includes(migration, 'receipt_image_purge_queue', 'image deletion survives worker failures');
includes(migration, 'service role required', 'purge is service-role only');
includes(migration, 'drop policy if exists "receipts owner all"', 'client hard-delete policy is removed');
excludes(migration, 'for delete using', 'no client receipt delete policy is recreated');
includes(foundations, 'receipt_items_refresh_search_text', 'line-item changes refresh parent FTS');
includes(foundations, 'receipts_search_text_idx', 'FTS has a GIN index');
includes(searchVectorFunction, "coalesce(r.notes, '')", 'receipt notes are searchable');
includes(searchVectorFunction, "string_agg(ri.name, ' ')", 'line-item descriptions are searchable');
excludes(searchVectorFunction, 'ri.qty', 'line-item quantity is not searchable');
excludes(searchVectorFunction, 'ri.amount', 'line-item amount is not searchable');
includes(sweeper, 'purgeSoftDeletedReceipts', 'sweeper runs receipt retention');
includes(sweeper, "storage.from('receipts').remove(paths)", 'sweeper removes purged images');
includes(sweeper, "from('receipt_image_purge_queue').delete()", 'sweeper acknowledges image deletion only after Storage succeeds');
includes(schemas, 'Currency is required with amount filters', 'client/server contract rejects ambiguous amounts');
includes(revisionMigration, 'revision bigint not null', 'receipts carry monotonic server revisions');
includes(revisionMigration, 'p_expected_revision', 'future multi-device writes detect stale versions');
includes(revisionMigration, 'receipt_mutations', 'mutation retries are idempotent');
includes(conflictMigration, "errcode = 'PT409'", 'revision conflicts return a machine-readable HTTP 409');

console.log('[b6:backend] PASS');
