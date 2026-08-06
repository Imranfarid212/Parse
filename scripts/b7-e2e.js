/**
 * Runs the B7 end-to-end harness under Deno with the right environment.
 *
 * The harness itself is Deno because the exported files have to be read back to
 * be believed — SheetJS and a PDF text extractor both live there. This wrapper
 * exists so nobody has to remember four exported variables: it finds the local
 * stack through the CLI, or a configured project through B7_E2E_ENV_FILE.
 *
 * Run: npm run b7:e2e
 *      B7_E2E_ENV_FILE=.env.staging B7_E2E_MODE=http npm run b7:e2e
 */
const { spawnSync } = require('child_process');
const path = require('path');

const { localKeys, readEnvFile } = require('./lib/staging');
const { resolveDeno } = require('./lib/deno');

const root = path.resolve(__dirname, '..');
const TAG = '[b7:e2e]';

function resolveEnv() {
  const envFile = process.env.B7_E2E_ENV_FILE;
  if (envFile) {
    const values = { ...readEnvFile('.env'), ...readEnvFile(envFile) };
    const url = process.env.SUPABASE_URL ?? values.SUPABASE_URL ?? values.EXPO_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? values.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.SUPABASE_ANON_KEY ?? values.SUPABASE_ANON_KEY ?? values.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !serviceRoleKey || !anonKey) {
      throw new Error(`${TAG} ${envFile} is missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY`);
    }
    const production = readEnvFile('.env.production').EXPO_PUBLIC_SUPABASE_URL;
    if (production && production === url) throw new Error(`${TAG} refusing to run against the project in .env.production`);
    return {
      SUPABASE_URL: url,
      SUPABASE_FUNCTIONS_URL: `${url.replace(/\/$/, '')}/functions/v1`,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      SUPABASE_ANON_KEY: anonKey,
    };
  }

  const local = localKeys();
  if (!local) {
    throw new Error(
      `${TAG} no local stack is running.\n` +
        '  supabase start -x vector && supabase db reset\n' +
        '  Or point at a project: B7_E2E_ENV_FILE=.env.staging npm run b7:e2e',
    );
  }
  return {
    SUPABASE_URL: local.url,
    SUPABASE_FUNCTIONS_URL: `${local.url.replace(/\/$/, '')}/functions/v1`,
    SUPABASE_SERVICE_ROLE_KEY: local.serviceRoleKey,
    SUPABASE_ANON_KEY: local.anonKey,
  };
}

const env = { ...process.env, ...resolveEnv() };
const deno = resolveDeno(TAG);
const result = spawnSync(
  deno,
  [
    'run',
    '--allow-net',
    '--allow-read',
    '--allow-env',
    '--allow-import',
    'supabase/functions/_tests/b7/export-e2e.ts',
  ],
  { cwd: root, env, stdio: 'inherit' },
);

process.exit(result.status ?? 1);
