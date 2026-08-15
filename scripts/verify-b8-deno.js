/**
 * Runs the B8 Deno suite through the shared resolver, so the gate does not
 * depend on `deno` being on PATH in whatever shell CI happens to use.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const { resolveDeno } = require('./lib/deno');

const root = path.resolve(__dirname, '..');
const deno = resolveDeno('[b8:deno]');

const result = spawnSync(deno, ['test', 'supabase/functions/_tests/b8/'], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
});

if (result.status !== 0) {
  console.error('[b8:deno] failed');
  process.exit(result.status ?? 1);
}
console.log('[b8:deno] ok');
