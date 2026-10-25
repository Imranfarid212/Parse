/**
 * Installs the B5 recurring jobs in a Supabase project.
 * Credentials enter Vault over the TLS database connection and are never logged.
 *
 * Production is opt-in and must be asked for out loud, because the shared
 * resolver refuses it by default. Doing this in the SQL editor instead would
 * leave the service-role key in the dashboard's query history; here it only
 * ever travels over the database connection.
 *
 * Run: node scripts/configure-b5-schedules.js [--production]
 */
const { resolveConfig, connectPg, projectRef } = require('./lib/staging');

const TAG = '[b5:schedules]';

async function upsertVaultSecret(pg, name, value, description) {
  const existing = (await pg.query('select id from vault.secrets where name = $1', [name])).rows[0];
  if (existing) {
    await pg.query('select vault.update_secret($1, $2, $3, $4)', [existing.id, value, name, description]);
    return;
  }
  await pg.query('select vault.create_secret($1, $2, $3)', [value, name, description]);
}

async function main() {
  const production = process.argv.includes('--production');
  const config = resolveConfig({
    needDbUrl: true,
    allowProduction: production,
    envFile: production ? '.env.production' : undefined,
  });
  if (!config.serviceRoleKey) throw new Error('missing SUPABASE_SERVICE_ROLE_KEY');
  // Say which project this is about to change. The whole failure mode worth
  // guarding against here is an operator who thinks they are on staging.
  console.log(`${TAG} target ${production ? 'PRODUCTION' : 'staging'} (${projectRef(config.url)})`);
  const pg = await connectPg(config);
  try {
    await upsertVaultSecret(pg, 'receiptflow_b5_project_url', config.url, 'ReceiptFlow B5 scheduler Edge Function URL');
    await upsertVaultSecret(pg, 'receiptflow_b5_service_role_key', config.serviceRoleKey, 'ReceiptFlow B5 scheduler service credential');
    const rows = (await pg.query('select * from public.configure_b5_schedules() order by out_job_name')).rows;
    if (rows.length !== 2) throw new Error(`expected two scheduled jobs, got ${rows.length}`);
    for (const row of rows) console.log(`${TAG} ${row.out_job_name} ${row.out_schedule} (job ${row.out_job_id})`);
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(`${TAG} FAIL ${error.message}`);
  process.exitCode = 1;
});
