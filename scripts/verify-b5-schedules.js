/** Verifies that the B5 durable-work schedules are registered on staging. */
const { resolveConfig, connectPg, projectRef } = require('./lib/staging');

const TAG = '[b5:schedules]';
const expected = new Map([
  ['receiptflow-b5-sweeper', '30 seconds'],
  ['receiptflow-b5-provider-probe', '*/15 * * * *'],
]);

async function main() {
  const config = resolveConfig({ needDbUrl: true });
  const pg = await connectPg(config);
  try {
    const rows = (await pg.query(
      'select jobid, jobname, schedule, active from cron.job where jobname = any($1::text[]) order by jobname',
      [[...expected.keys()]],
    )).rows;
    if (rows.length !== expected.size) throw new Error(`expected ${expected.size} jobs, got ${rows.length}`);
    for (const row of rows) {
      if (!row.active) throw new Error(`${row.jobname} is inactive`);
      if (row.schedule !== expected.get(row.jobname)) {
        throw new Error(`${row.jobname}: expected ${expected.get(row.jobname)}, got ${row.schedule}`);
      }
      console.log(`${TAG} PASS ${row.jobname} ${row.schedule} (job ${row.jobid})`);
    }
    console.log(`${TAG} target ${projectRef(config.url)} configured`);
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(`${TAG} FAIL ${error.message}`);
  process.exitCode = 1;
});
