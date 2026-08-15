const { spawnSync } = require('child_process');
const path = require('path');
const { resolveDeno } = require('./lib/deno');

const result = spawnSync(resolveDeno('[b9:deno]'), ['test', '--allow-env=PLAY_INTEGRITY_CONFIG', 'supabase/functions/_tests/b9/'], {
  cwd: path.resolve(__dirname, '..'), stdio: 'inherit', shell: false,
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('[b9:deno] ok');
