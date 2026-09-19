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

let databaseContainer;

function localDatabaseContainer() {
  if (databaseContainer) return databaseContainer;

  const containers = run('docker', ['ps', '--format', '{{.Names}}'])
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name.startsWith('supabase_db_'));

  if (containers.length !== 1) {
    throw new Error(
      `[b1:db] expected one running local Supabase database container, found ${containers.length}: ${containers.join(', ') || 'none'}`,
    );
  }

  databaseContainer = containers[0];
  return databaseContainer;
}

function sql(query) {
  return run('docker', [
    'exec',
    localDatabaseContainer(),
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

/**
 * `--schema public` is load-bearing, not tidiness.
 *
 * Generating every schema pulled in `storage`, whose internal tables are
 * created by the Supabase platform image rather than by anything in
 * supabase/migrations. When that image gained `iceberg_namespaces` and
 * `iceberg_tables`, 94 lines appeared in the generated output that no commit
 * here could have produced, and whole-file equality could never hold again --
 * which is exactly the drift that kept this gate red for months. Scoping to
 * `public` makes this check depend only on migrations this repo owns, and has
 * the side effect of dropping the `__InternalSupabase` block, whose
 * PostgrestVersion is read from the running stack and varies by CLI version.
 *
 * The app only ever uses `Database['public']`: the single consumer is a
 * `import type { Database }` in src/lib/auth/supabase.ts, and nothing anywhere
 * references the storage schema's types.
 */
const generated = run('supabase', ['gen', 'types', 'typescript', '--local', '--schema', 'public']);
const current = fs.readFileSync(path.join(root, 'packages/contracts/src/db.types.ts'), 'utf8');

/** How many differing lines to print before truncating. */
const DRIFT_PREVIEW_LINES = 25;

/**
 * Say WHAT drifted, not just that something did.
 *
 * This check has been red on every pull-request branch for months and its
 * message named no line, so each failure read exactly like the last one and
 * told whoever saw it nothing they could act on. That is most of why it
 * survived: `gate.yml` even documents the pattern -- "a check that is always
 * the same check stops being read".
 *
 * Lines are aligned by index rather than by a real LCS diff, because the
 * interesting case here is a value that changes in place -- `PostgrestVersion`,
 * for instance, which the generator reads from the running stack rather than
 * from the migrations, and which therefore differs between a developer's CLI
 * and the one CI pins. A single inserted or deleted line misaligns everything
 * after it, so the FIRST difference is the signal and the count is an upper
 * bound, not a measurement.
 */
function describeDrift(current, generated) {
  const currentLines = current.split('\n');
  const generatedLines = generated.split('\n');
  const show = (line) => (line === undefined ? '<no such line>' : JSON.stringify(line));

  const preview = [];
  let differing = 0;
  for (let i = 0; i < Math.max(currentLines.length, generatedLines.length); i += 1) {
    if (currentLines[i] === generatedLines[i]) continue;
    differing += 1;
    if (differing > DRIFT_PREVIEW_LINES) continue;
    preview.push(`  line ${i + 1}`);
    preview.push(`    checked in: ${show(currentLines[i])}`);
    preview.push(`    generated : ${show(generatedLines[i])}`);
  }

  return [
    `  checked in: ${currentLines.length} lines`,
    `  generated : ${generatedLines.length} lines`,
    `  lines differing by position: ${differing}`
      + (differing > DRIFT_PREVIEW_LINES ? ` (showing the first ${DRIFT_PREVIEW_LINES})` : ''),
    ...preview,
  ].join('\n');
}

if (generated.trim() !== current.trim()) {
  process.stderr.write(`[b1:db] db.types.ts drift:\n${describeDrift(current.trim(), generated.trim())}\n`);
  throw new Error(
    '[b1:db] generated db.types.ts differs from packages/contracts/src/db.types.ts - see the drift report above',
  );
}

console.log('[b1:db] local database reset state and generated types verified');
