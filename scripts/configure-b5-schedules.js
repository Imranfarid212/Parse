/**
 * Installs the B5 recurring jobs in a non-production Supabase project.
 * Credentials enter Vault over the TLS database connection and are never logged.
 *
 * Run: node scripts/configure-b5-schedules.js
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
  const config = resolveConfig({ needDbUrl: true });
  if (!config.serviceRoleKey) throw new Error('missing SUPABASE_SERVICE_ROLE_KEY');
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
