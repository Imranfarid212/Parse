/**
 * B4 4.4 — where does server time actually go on a Balanced scan?
 *
 * receipt_capture_attempts persists server_total_ms and server_model_ms but not
 * the pre-model phases, so the 515–1720ms gap between them on real device scans
 * cannot be attributed from the database. The full breakdown only exists in the
 * response body, so this reads it there.
 *
 * The question 4.4 actually asks is whether the category cache helps on real
 * scans: `categories_cached` answers it directly. Warm-up logs suggested every
 * call landed on a fresh instance, which would make the cache useless — but
 * warm-up calls are not the same traffic as scans.
 *
 * Spends one model call per sample. Not a test and not in any gate.
 *
 * Run: node scripts/measure-b4-timing.js [samples]
 */
const { randomUUID } = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { resolveConfig, makeAdmin, connectPg, projectRef, withUser } = require('./lib/staging');

const SAMPLES = Number(process.argv[2] ?? 5);

const RECEIPT_TEXT = [
  'BLUE BOTTLE COFFEE',
  '66 Mint St, San Francisco',
  '2026-07-14  10:32',
  'Latte              4.50',
  'Croissant          3.75',
  'Subtotal           8.25',
  'Tax                0.74',
  'TOTAL              8.99',
  'VISA ****4471  APPROVED',
].join('\n');

const pad = (v, n) => String(v ?? '-').padStart(n);

async function main() {
  const config = resolveConfig({ needDbUrl: true, needAnonKey: true });
  const admin = makeAdmin(config);
  const pg = await connectPg(config);

  console.log(`[measure] ${projectRef(config.url)} — ${SAMPLES} Balanced scans, one model call each\n`);

  try {
    await withUser(admin, async ({ userId, email, password }) => {
      const anon = createClient(config.url, config.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data, error } = await anon.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`sign in: ${error.message}`);
      const token = data.session.access_token;

      // Plenty of balance, and a clear burst window, so nothing is refused.
      await pg.query('delete from public.scan_ledger where user_id = $1', [userId]);
      await pg.query(
        `insert into public.scan_ledger (user_id, delta, reason, ref_id)
         values ($1, 500, 'admin', gen_random_uuid())`,
        [userId],
      );

      const rows = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        await pg.query('delete from public.scan_attempts where user_id = $1', [userId]);
        const started = Date.now();
        const response = await fetch(`${config.url}/functions/v1/extract-balanced`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: config.anonKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            capture_id: randomUUID(),
            mode: 'default',
            captured_at: new Date().toISOString(),
            extracted_text: RECEIPT_TEXT,
            default_currency: 'USD',
          }),
          signal: AbortSignal.timeout(90_000),
        });
        const body = await response.json().catch(() => null);
        const t = body?.timing ?? {};
        rows.push({ wall: Date.now() - started, status: response.status, t });
        console.log(
          `#${i + 1} ${response.status}  total ${pad(t.total_ms, 5)}  model ${pad(t.model_ms, 5)}` +
            `  categories ${pad(t.categories_ms, 5)} ${t.categories_cached === 1 ? '(cached)' : '(cold)  '}` +
            `  quota ${pad(t.quota_ms, 4)}  reserve ${pad(t.reserve_ms, 4)}  dup ${pad(t.duplicate_ms, 4)}` +
            `  isolate_age ${pad(t.isolate_age_ms, 7)}  req# ${pad(t.req_count, 3)}`,
        );
      }

      const ok = rows.filter((r) => r.status === 200 && r.t.total_ms != null);
      if (ok.length === 0) return;
      const sum = (f) => ok.reduce((n, r) => n + (Number(f(r)) || 0), 0);
      const avg = (f) => Math.round(sum(f) / ok.length);
      const cached = ok.filter((r) => r.t.categories_cached === 1).length;

      console.log('\n--- averages over', ok.length, 'successful scans ---');
      console.log('  total      ', avg((r) => r.t.total_ms), 'ms');
      console.log('  model      ', avg((r) => r.t.model_ms), 'ms');
      console.log('  categories ', avg((r) => r.t.categories_ms), `ms   (cache hit on ${cached}/${ok.length})`);
      console.log('  quota      ', avg((r) => r.t.quota_ms), 'ms');
      console.log('  reserve    ', avg((r) => r.t.reserve_ms), 'ms');
      console.log('  duplicate  ', avg((r) => r.t.duplicate_ms), 'ms');
      const gap = avg((r) => r.t.total_ms) - avg((r) => r.t.model_ms);
      console.log(`\n  pre/post-model gap: ${gap} ms of ${avg((r) => r.t.total_ms)} ms total`);
      console.log(`  categories is ${Math.round((avg((r) => r.t.categories_ms) / gap) * 100)}% of that gap`);
    }, pg);
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(`[measure] ${error.message}`);
  process.exit(1);
});
