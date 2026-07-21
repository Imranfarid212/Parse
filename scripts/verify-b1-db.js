const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || '');
    process.stdout.write(result.stdout || '');
    throw new Error(`${command} ${args.join(' ')} failed`);
  }

  return result.stdout;
}

function sql(query) {
  return run('docker', [
    'exec',
    'supabase_db_receiptflow-local',
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-tAc',
    query,
  ]).trim();
}

const checks = [
  ['category count', sql('select count(*) from public.categories;'), '10'],
  [
    'locked Miscellaneous',
    sql("select name || ':' || is_system || ':' || is_default from public.categories where name = 'Miscellaneous';"),
    'Miscellaneous:true:true',
  ],
  [
    'private buckets',
    sql("select string_agg(id || ':' || public, ',' order by id) from storage.buckets where id in ('receipts', 'exports');"),
    'exports:false,receipts:false',
  ],
  ['provider state singleton', sql("select state || ':' || consecutive_failures from public.provider_state where id = 1;"), 'closed:0'],
  ['health check rpc', sql('select public.health_check();'), '1'],
  [
    'scan ledger unique ref_id',
    sql("select count(*) from pg_indexes where schemaname = 'public' and tablename = 'scan_ledger' and indexdef like '%user_id, reason, ref_id%';"),
    '1',
  ],
];

for (const [label, actual, expected] of checks) {
  if (actual !== expected) {
    throw new Error(`[b1:db] ${label} expected ${expected}, got ${actual}`);
  }
}

const generated = run('supabase', ['gen', 'types', 'typescript', '--local']);
const current = fs.readFileSync(path.join(root, 'packages/contracts/src/db.types.ts'), 'utf8');

if (generated.trim() !== current.trim()) {
  throw new Error('[b1:db] generated db.types.ts differs from packages/contracts/src/db.types.ts');
}

console.log('[b1:db] local database reset state and generated types verified');
