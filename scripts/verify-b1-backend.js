const fs = require('fs');
const path = require('path');

const { rewriteRelativeImports } = require('./contracts-sync');

const root = path.resolve(__dirname, '..');

function fail(message) {
  console.error(`[b1:backend] ${message}`);
  process.exitCode = 1;
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

const requiredFiles = [
  'packages/contracts/src/index.ts',
  'packages/contracts/src/enums.ts',
  'packages/contracts/src/errors.ts',
  'packages/contracts/src/copy.ts',
  'packages/contracts/src/fixtures.ts',
  'packages/contracts/src/schemas.ts',
  'packages/contracts/src/db.types.ts',
  'supabase/config.toml',
  'supabase/migrations/20260719000100_b1_foundations.sql',
  'supabase/seed.sql',
];

for (const file of requiredFiles) {
  if (!exists(file)) fail(`missing required file: ${file}`);
}

if (process.exitCode) process.exit();

const migration = read('supabase/migrations/20260719000100_b1_foundations.sql');
const contractsIndex = read('packages/contracts/src/index.ts');

const requiredSchemaTerms = [
  'create table if not exists public.profiles',
  'create table if not exists public.categories',
  'create table if not exists public.user_categories',
  'create table if not exists public.receipts',
  'create table if not exists public.receipt_items',
  'create table if not exists public.extraction_jobs',
  'create table if not exists public.provider_state',
  'create table if not exists public.scan_ledger',
  'create table if not exists public.referral_codes',
  'create table if not exists public.referrals',
  'create table if not exists public.subscriptions',
  'create table if not exists public.payment_events',
  'create table if not exists public.commission_ledger',
  'create table if not exists public.account_tombstones',
  'create table if not exists public.export_jobs',
  'create table if not exists public.push_tokens',
  'unique (user_id, reason, ref_id)',
  "'Miscellaneous', true, true",
  "'rf_plus_699_m', 'rf_unlimited_1199_m'",
  "insert into storage.buckets",
];

for (const term of requiredSchemaTerms) {
  if (!migration.includes(term)) fail(`migration missing expected B1 term: ${term}`);
}

const requiredContractTerms = ['./copy', './db.types', './enums', './errors', './fixtures', './schemas', './types'];
for (const term of requiredContractTerms) {
  if (!contractsIndex.includes(term)) fail(`contracts index missing export: ${term}`);
}

const sourceDir = path.join(root, 'packages', 'contracts', 'src');
const mirrorDir = path.join(root, 'supabase', 'functions', '_shared', 'contracts');
const sourceFiles = fs.readdirSync(sourceDir).filter((file) => file.endsWith('.ts')).sort();
const mirrorFiles = fs.existsSync(mirrorDir) ? fs.readdirSync(mirrorDir).filter((file) => file.endsWith('.ts')).sort() : [];

if (sourceFiles.join('\n') !== mirrorFiles.join('\n')) {
  fail('contracts mirror file list differs; run npm run contracts:sync');
} else {
  for (const file of sourceFiles) {
    const source = fs.readFileSync(path.join(sourceDir, file), 'utf8');
    const mirror = fs.readFileSync(path.join(mirrorDir, file), 'utf8');
    // Through the same rewrite contracts:sync applies — the mirror carries .ts
    // on relative imports so Deno can resolve them, and the source must not.
    if (rewriteRelativeImports(source) !== mirror) fail(`contracts mirror differs for ${file}; run npm run contracts:sync`);
  }
}

if (!process.exitCode) {
  console.log('[b1:backend] foundation files verified');
}
