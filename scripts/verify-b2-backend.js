const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const fixture = read('packages/contracts/src/fixtures.ts');
const seed = read('supabase/seed.sql');
const migration = read('supabase/migrations/20260720000100_b2_auth_onboarding.sql');
const config = read('supabase/config.toml');

for (const category of [
  'Travel & Transit',
  'Meals & Entertainment',
  'Office Supplies',
  'Software & IT',
  'Vehicle Expenses',
  'Advertising & Marketing',
  'Professional Services',
  'Utilities & Telecom',
  'Inventory & Materials',
  'Miscellaneous',
]) {
  if (!fixture.includes(category)) throw new Error(`[b2:backend] category fixture missing ${category}`);
  if (!seed.includes(category)) throw new Error(`[b2:backend] seed missing ${category}`);
}

for (const expected of ['complete_onboarding', 'onboarding_complete = true', 'non_system_count < 1']) {
  if (!migration.includes(expected)) throw new Error(`[b2:backend] onboarding migration missing ${expected}`);
}

if (!config.includes('parse://auth/callback')) {
  throw new Error('[b2:backend] Supabase config must allow parse://auth/callback');
}

if (!config.includes('receiptflow://auth/callback')) {
  throw new Error('[b2:backend] Supabase config must allow receiptflow://auth/callback');
}

console.log('[b2:backend] category fixtures, onboarding RPC migration, and auth redirects verified');
