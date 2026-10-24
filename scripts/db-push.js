/**
 * Pushes migrations to one named Supabase environment.
 *
 * The npm scripts this replaces were byte-identical — both read the ambient
 * `SUPABASE_DB_URL`, so `supabase:prod:push` with a staging URL exported in the
 * shell pushed to staging while reading like it pushed to production. The
 * environment is now an argument, the URL is read only from that environment's
 * own gitignored env file, and the ref encoded in the URL has to agree with the
 * project that file names before anything is applied.
 *
 * Run: node scripts/db-push.js <staging|production> [--dry-run]
 */
const { execFileSync } = require('child_process');
const { readEnvFile, projectRef } = require('./lib/staging');

const TAG = '[db:push]';

const ENV_FILES = {
  staging: '.env.staging',
  production: '.env.production',
};

/**
 * Both connection shapes carry the ref: the pooler puts it in the user, the
 * legacy direct host in the subdomain. Whichever form the file uses, this is
 * the project the push will actually land on.
 */
function refFromDbUrl(dbUrl) {
  const pooler = /:\/\/postgres\.([a-z0-9]+):/i.exec(dbUrl);
  if (pooler) return pooler[1];
  const direct = /@db\.([a-z0-9]+)\.supabase\./i.exec(dbUrl);
  if (direct) return direct[1];
  return null;
}

function main() {
  const [environment, ...passThrough] = process.argv.slice(2);
  const envFile = ENV_FILES[environment];
  if (!envFile) {
    throw new Error(`unknown environment '${environment ?? ''}'. Use one of: ${Object.keys(ENV_FILES).join(', ')}`);
  }

  // Deliberately not falling back to process.env: an inherited SUPABASE_DB_URL
  // is the one thing this script exists to ignore.
  const fromFile = readEnvFile(envFile);
  const dbUrl = fromFile.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error(`${envFile} has no SUPABASE_DB_URL. It is gitignored; copy the value from the Supabase dashboard.`);
  }

  const expectedRef = fromFile.SUPABASE_PROJECT_REF ?? projectRef(fromFile.EXPO_PUBLIC_SUPABASE_URL);
  const targetRef = refFromDbUrl(dbUrl);
  if (!expectedRef) {
    throw new Error(`${envFile} names no project: set SUPABASE_PROJECT_REF or EXPO_PUBLIC_SUPABASE_URL.`);
  }
  if (!targetRef) {
    throw new Error(`could not read a project ref out of SUPABASE_DB_URL in ${envFile}.`);
  }
  if (targetRef !== expectedRef) {
    throw new Error(
      `${envFile} is inconsistent: it names project ${expectedRef}, but its SUPABASE_DB_URL points at ${targetRef}.\n` +
        `  Refusing to push — one of the two is stale.`,
    );
  }

  const dryRun = passThrough.includes('--dry-run');
  console.log(`${TAG} ${dryRun ? 'dry-run against' : 'pushing to'} ${environment} (${targetRef})`);

  // The URL carries the database password, so it is handed over as an argument
  // and never printed.
  execFileSync('supabase', ['db', 'push', '--db-url', dbUrl, ...passThrough], { stdio: 'inherit' });
}

try {
  main();
} catch (error) {
  console.error(`${TAG} FAIL ${error.message}`);
  process.exitCode = 1;
}
