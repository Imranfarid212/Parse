/**
 * Staging black-box test for B4.8.3.
 *
 * A database assertion proves the policy transition; this proves the deployed
 * Edge Function actually uses it. Warm-up avoids any model call or receipt
 * write, while still travelling through authentication and device enforcement.
 */
const { randomUUID } = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { resolveConfig, makeAdmin, connectPg, projectRef, withUser } = require('./lib/staging');

const TAG = '[b4:device]';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const config = resolveConfig({ needDbUrl: true, needAnonKey: true });
  const admin = makeAdmin(config);
  const pg = await connectPg(config);
  console.log(`${TAG} target ${projectRef(config.url)} — creating a throwaway user, no model calls`);

  try {
    await withUser(admin, async ({ email, password }) => {
      const user = createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error: signInError } = await user.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;

      const firstDevice = randomUUID();
      const secondDevice = randomUUID();
      const { data: firstClaim, error: firstClaimError } = await user.rpc('claim_user_device', {
        p_device_id: firstDevice,
        p_takeover: false,
      });
      if (firstClaimError) throw firstClaimError;
      assert(firstClaim?.[0]?.out_status === 'active', 'first device did not become active');

      const { data: sessionData, error: sessionError } = await user.auth.getSession();
      if (sessionError || !sessionData.session?.access_token) throw sessionError ?? new Error('missing access token');
      const headers = {
        Authorization: `Bearer ${sessionData.session.access_token}`,
        apikey: config.anonKey,
        'Content-Type': 'application/json',
        'x-rf-device-id': firstDevice,
      };
      const before = await fetch(`${config.url}/functions/v1/extract-balanced`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ warm_up: true }),
      });
      assert(before.status === 200, `active device warm-up returned ${before.status}`);

      const { data: takeover, error: takeoverError } = await user.rpc('claim_user_device', {
        p_device_id: secondDevice,
        p_takeover: true,
      });
      if (takeoverError) throw takeoverError;
      assert(takeover?.[0]?.out_status === 'active', 'second device takeover did not activate');

      const after = await fetch(`${config.url}/functions/v1/extract-balanced`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ warm_up: true }),
      });
      const payload = await after.json().catch(() => null);
      assert(after.status === 409, `displaced device warm-up returned ${after.status}`);
      assert(payload?.code === 'DEVICE_INACTIVE', `displaced device response was ${payload?.code ?? 'not JSON'}`);
      console.log(`${TAG} PASS active device accepted; displaced device refused by deployed extract-balanced`);
    }, pg);
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(`${TAG} ${error.message}`);
  process.exit(1);
});
