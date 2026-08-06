/**
 * Runs the B7 Deno unit suites (builders, job runner, request validation).
 *
 * A thin wrapper for the same reason as b7-e2e.js: Deno is not a project
 * dependency, so the gate needs one place that knows how to find it.
 *
 * Run: npm run b7:builders
 */
const { spawnSync } = require('child_process');
const path = require('path');

const { resolveDeno } = require('./lib/deno');

const result = spawnSync(
  resolveDeno('[b7:builders]'),
  ['test', '--allow-net', '--allow-read', '--allow-env', '--allow-import', 'supabase/functions/_tests/b7/'],
  { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' },
);

process.exit(result.status ?? 1);
