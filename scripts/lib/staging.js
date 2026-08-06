/**
 * Shared plumbing for the B4 verification harnesses: credentials, connections,
 * and the throwaway user they both need.
 *
 * Lives here so the two scripts cannot drift on which env file they read or
 * which project they refuse to touch — the guard that keeps a test run off
 * production is only worth having if there is exactly one of it.
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..', '..');

/** Minimal .env reader — the repo has no dotenv and this needs four values. */
function readEnvFile(relPath) {
  const file = path.join(root, relPath);
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) out[key] = value;
  }
  return out;
}

function projectRef(url) {
  const match = /^https?:\/\/([a-z0-9]+)\.supabase\./i.exec(url ?? '');
  return match ? match[1] : url;
}

/**
 * Resolves credentials from the environment, then the chosen env file.
 *
 * @param {{ needDbUrl?: boolean, needAnonKey?: boolean }} requirements
 */
function resolveConfig({ needDbUrl = false, needAnonKey = false } = {}) {
  const envFile = process.env.B4_DB_ENV_FILE ?? '.env.staging';
  const fromFile = { ...readEnvFile('.env'), ...readEnvFile(envFile) };
  const pick = (...keys) => {
    for (const key of keys) {
      if (process.env[key]) return process.env[key];
      if (fromFile[key]) return fromFile[key];
    }
    return null;
  };

  const config = {
    url: pick('SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL'),
    serviceRoleKey: pick('SUPABASE_SERVICE_ROLE_KEY'),
    anonKey: pick('SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'),
    dbUrl: pick('SUPABASE_DB_URL'),
  };

  const missing = [];
  if (!config.url) missing.push('SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL)');
  if (!config.serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (needDbUrl && !config.dbUrl) missing.push('SUPABASE_DB_URL');
  if (needAnonKey && !config.anonKey) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (missing.length > 0) {
    throw new Error(
      `missing ${missing.join(', ')}.\n` +
        `  Add to ${envFile}, which is gitignored. Reveal the key with:\n` +
        `    supabase projects api-keys --reveal --project-ref <ref>`,
    );
  }

  // These scripts write to whatever they are pointed at. Refuse the project
  // named in .env.production rather than trusting the operator to have exported
  // the right file — throwaway users and seeded ledger rows do not belong there.
  const production = readEnvFile('.env.production').EXPO_PUBLIC_SUPABASE_URL;
  if (production && projectRef(production) === projectRef(config.url)) {
    throw new Error(
      `refusing to run against the project in .env.production (${projectRef(config.url)}).\n` +
        `  This creates and deletes a real user; point it at staging.`,
    );
  }

  return config;
}

function makeAdmin({ url, serviceRoleKey }) {
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function connectPg({ dbUrl }) {
  // The local CLI stack serves plain TCP with no certificate at all, so asking
  // for SSL there fails the connection outright. Hosted projects always want it.
  const isLocal = /@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(dbUrl ?? '');
  const pg = new Client({
    connectionString: dbUrl,
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
  });
  await pg.connect();
  return pg;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Errors from GoTrue's admin API do not reliably carry a readable message. */
function describeError(error) {
  const message = error?.message;
  if (message && message !== '{}') return message;
  return `${error?.name ?? 'error'}${error?.status ? ` (status ${error.status})` : ''}`;
}

/**
 * Removes a throwaway user, and keeps trying.
 *
 * The admin endpoint has been observed returning a retryable 500 right after a
 * run that wrote receipts — the deletion itself is sound, every foreign key to
 * profiles cascades or nulls. But a test harness that can strand a user on
 * staging is worse than no harness, so this retries and then falls back to SQL.
 */
async function deleteUser(admin, userId, pg = null) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (!error) return true;
    if (attempt < 3) await sleep(attempt * 750);
    else if (!pg) {
      console.error(`  WARN could not delete test user ${userId}: ${describeError(error)}`);
      return false;
    }
  }
  try {
    await pg.query('delete from auth.users where id = $1', [userId]);
    console.error(`  NOTE admin delete kept failing for ${userId}; removed it over SQL instead`);
    return true;
  } catch (sqlError) {
    console.error(`  WARN test user ${userId} could not be deleted at all: ${sqlError.message}`);
    return false;
  }
}

/**
 * Creates a confirmed throwaway user and always removes it, whatever happens.
 * Deleting the auth row cascades through profiles to the ledger, attempts,
 * subscriptions and receipts, so nothing needs unwinding by hand.
 *
 * The password is returned because the HTTP harness has to sign in as this user
 * to get a real JWT; the database harness ignores it.
 *
 * @param {object|null} pg Optional live Postgres client, used as the fallback
 *   path if the admin API refuses to delete the user.
 */
async function withUser(admin, fn, pg = null) {
  const email = `b4-verify-${randomUUID()}@example.com`;
  const password = `${randomUUID()}Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`could not create the test user: ${describeError(error)}`);
  const userId = data.user.id;
  try {
    return await fn({ userId, email, password });
  } finally {
    await deleteUser(admin, userId, pg);
  }
}

/**
 * The local stack's keys, straight from the CLI.
 *
 * They are deterministic demo keys, but reading them beats hardcoding them: a
 * harness that needs four exported variables before it will run is a harness
 * that stops being run, and `npm run gate -- b7` has nowhere to get them from.
 * Returns null when no local stack is up, so callers can say so plainly.
 */
function localKeys() {
  try {
    const { execFileSync } = require('child_process');
    const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    if (!status.ANON_KEY || !status.SERVICE_ROLE_KEY) return null;
    return {
      url: status.API_URL ?? 'http://127.0.0.1:54321',
      dbUrl: status.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      anonKey: status.ANON_KEY,
      serviceRoleKey: status.SERVICE_ROLE_KEY,
    };
  } catch {
    return null;
  }
}

module.exports = { readEnvFile, projectRef, resolveConfig, makeAdmin, connectPg, withUser, deleteUser, localKeys };
