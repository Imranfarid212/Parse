/** Exercises the deployed Grok canary and restores the previous breaker state. */
const { resolveConfig, connectPg, projectRef } = require('./lib/staging');

const TAG = '[b5:probe]';

async function main() {
  const config = resolveConfig({ needDbUrl: true });
  if (!config.serviceRoleKey) throw new Error('missing SUPABASE_SERVICE_ROLE_KEY');
  const pg = await connectPg(config);
  const original = (await pg.query('select * from public.provider_state where id = 1')).rows[0];
  try {
    await pg.query(
      "update public.provider_state set state = 'open', consecutive_failures = 3, opened_at = now() - interval '15 minutes', updated_at = now() where id = 1",
    );
    const response = await fetch(`${config.url}/functions/v1/provider-probe`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.serviceRoleKey}`,
        apikey: config.serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => null);
    if (response.status !== 200) throw new Error(`expected 200, got ${response.status}: ${JSON.stringify(payload)}`);
    if (payload?.breaker_state !== 'closed') throw new Error(`expected closed response, got ${payload?.breaker_state}`);
    const current = (await pg.query('select state, consecutive_failures, opened_at, last_probe_at from public.provider_state where id = 1')).rows[0];
    if (current.state !== 'closed' || current.consecutive_failures !== 0 || current.opened_at !== null || !current.last_probe_at) {
      throw new Error(`breaker was not reset by probe: ${JSON.stringify(current)}`);
    }
    console.log(`${TAG} PASS Grok canary closed the breaker on ${projectRef(config.url)}`);
  } finally {
    if (original) {
      await pg.query(
        `update public.provider_state
            set state = $2, consecutive_failures = $3, opened_at = $4, last_probe_at = $5, updated_at = $6
          where id = $1`,
        [original.id, original.state, original.consecutive_failures, original.opened_at, original.last_probe_at, original.updated_at],
      );
    }
    await pg.end();
  }
}

main().catch((error) => {
  console.error(`${TAG} FAIL ${error.message}`);
  process.exitCode = 1;
});
