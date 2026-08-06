/** Read-only comparison of a copied physical-device SQLite DB with staging. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { connectPg, resolveConfig } = require('./lib/staging');

const root = path.resolve(__dirname, '..');
const fixturePath = path.join(root, 'tmp', 'b6-device-test-account.json');

function localRows(databasePath) {
  const output = execFileSync(
    'sqlite3',
    [databasePath, `select json_object(
      'receipt_id', receipt_id,
      'status', status,
      'result_sync_status', result_sync_status,
      'fields', json(fields)
    ) from receipts where receipt_id is not null order by receipt_id;`],
    { encoding: 'utf8' },
  );
  return output.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function normalizedItems(items) {
  return [...(items ?? [])]
    .map((item) => ({ name: String(item.name), qty: Number(item.qty), amount: Number(item.amount) }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.qty - right.qty || left.amount - right.amount);
}

function comparableLocal(fields) {
  return {
    store: fields.store,
    date: fields.date,
    currency: fields.currency,
    total: Number(fields.total),
    category: fields.category,
    notes: fields.handwritten_notes ?? '',
    items: normalizedItems(fields.items),
  };
}

function comparableRemote(row) {
  return {
    store: row.merchant ?? '',
    date: row.txn_date,
    currency: row.currency,
    total: Number(row.total) || 0,
    category: row.category_name ?? 'Miscellaneous',
    notes: row.notes ?? '',
    items: normalizedItems(row.items),
  };
}

async function main() {
  const databasePath = process.argv[2];
  if (!databasePath || !fs.existsSync(databasePath)) throw new Error('Pass the copied parse.db path');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  if (!fixture.attached_user_id) throw new Error('Fixture account is not attached');

  const local = localRows(databasePath);
  const config = resolveConfig({ needDbUrl: true });
  const pg = await connectPg(config);
  try {
    const remoteResult = await pg.query(
      `select r.id, r.status, r.merchant, r.txn_date::text, r.currency,
              r.total::float8, c.name as category_name, r.notes, r.deleted_at,
              coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty, 'amount', i.amount))
                filter (where i.id is not null), '[]'::jsonb) as items
         from public.receipts r
         left join public.categories c on c.id = r.category_id
         left join public.receipt_items i on i.receipt_id = r.id
        where r.user_id = $1
        group by r.id, c.name
        order by r.id`,
      [fixture.attached_user_id],
    );

    const localById = new Map(local.map((row) => [row.receipt_id, row]));
    const remoteById = new Map(remoteResult.rows.map((row) => [row.id, row]));
    const missingLocal = [...remoteById.keys()].filter((id) => !localById.has(id));
    const localOnly = [...localById.keys()].filter((id) => !remoteById.has(id));
    const settled = local.filter((row) => row.status === 'synced' && row.result_sync_status === 'synced');
    const fieldMismatches = settled.filter((row) => {
      const remote = remoteById.get(row.receipt_id);
      return !remote || JSON.stringify(comparableLocal(row.fields)) !== JSON.stringify(comparableRemote(remote));
    });
    const localStatusCounts = Object.groupBy(local, (row) => row.status);
    const remoteStatusCounts = Object.groupBy(remoteResult.rows, (row) => row.status);
    const countMap = (groups) => Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.length]));

    const report = {
      local_receipts: local.length,
      remote_receipts: remoteResult.rows.length,
      missing_local: missingLocal.length,
      missing_local_active: missingLocal.filter((id) => !remoteById.get(id).deleted_at).length,
      missing_local_soft_deleted: missingLocal.filter((id) => remoteById.get(id).deleted_at).length,
      local_only: localOnly.length,
      fixture_receipts_local: (fixture.receipt_ids ?? []).filter((id) => localById.has(id)).length,
      settled_local: settled.length,
      settled_field_mismatches: fieldMismatches.length,
      local_statuses: countMap(localStatusCounts),
      remote_statuses: countMap(remoteStatusCounts),
      remote_soft_deleted: remoteResult.rows.filter((row) => row.deleted_at).length,
    };
    console.log(JSON.stringify(report, null, 2));
    if (missingLocal.some((id) => !remoteById.get(id).deleted_at) || localOnly.length || fieldMismatches.length) {
      process.exitCode = 2;
    }
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(`[b6:audit] FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
