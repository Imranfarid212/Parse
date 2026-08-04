/**
 * B5 - live staging verification for the durable-job database contract.
 *
 * Uses the same staging guard and disposable auth user as the B4 harness. It
 * intentionally tests RPC calls over PostgREST, while SQL is reserved for
 * controlled clock/lease setup and assertions.
 *
 * Run: node scripts/verify-b5-db.js
 */
const { randomUUID } = require('crypto');
const { resolveConfig, makeAdmin, connectPg, projectRef, withUser } = require('./lib/staging');

const TAG = '[b5:db]';
const checks = [];
let checkCount = 0;

function assert(condition, message) {
  checkCount += 1;
  if (!condition) throw new Error(message);
}

function equal(actual, expected, label) {
  assert(actual === expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function test(name, fn) {
  checkCount = 0;
  try {
    await fn();
    checks.push({ name, ok: true });
    console.log(`${TAG} PASS ${name} (${checkCount} checks)`);
  } catch (error) {
    checks.push({ name, ok: false, error: error.message });
    console.error(`${TAG} FAIL ${name}\n        ${error.message}`);
  }
}

function one(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function main() {
  const config = resolveConfig({ needDbUrl: true });
  console.log(`${TAG} target ${projectRef(config.url)}`);
  const admin = makeAdmin(config);
  const pg = await connectPg(config);
  const originalBreaker = (await pg.query('select * from public.provider_state where id = 1')).rows[0];

  try {
    await withUser(admin, async ({ userId }) => {
      const enqueue = async (captureId, threshold = 999) => {
        const { data, error } = await admin.rpc('enqueue_provider_delay_job', {
          p_user_id: userId,
          p_capture_id: captureId,
          p_capture_mode: 'default',
          p_extraction_mode: 'precise',
          p_image_path: `b5-verify/${captureId}.jpg`,
          p_image_byte_size: 128,
          p_acked_at: new Date().toISOString(),
          p_provider_attempted: 'grok',
          p_last_error: 'forced Grok failure for B5 verification',
          p_failure_window_seconds: 120,
          p_failure_threshold: threshold,
        });
        if (error) throw new Error(`enqueue_provider_delay_job: ${error.message}`);
        return one(data);
      };

      const claim = async (leaseSeconds = 120) => {
        const { data, error } = await admin.rpc('claim_extraction_jobs', {
          p_limit: 10,
          p_lease_seconds: leaseSeconds,
        });
        if (error) throw new Error(`claim_extraction_jobs: ${error.message}`);
        return data ?? [];
      };

      await test('provider delay commits one processing receipt and one idempotent job', async () => {
        const captureId = randomUUID();
        const first = await enqueue(captureId);
        const second = await enqueue(captureId);
        equal(first.out_receipt_id, second.out_receipt_id, 'receipt id remains stable for the capture');

        const rows = await pg.query(
          `select r.status::text as receipt_status, j.status::text as job_status, j.attempt_count
             from public.receipts r
             join public.extraction_jobs j on j.receipt_id = r.id
            where r.id = $1`,
          [first.out_receipt_id],
        );
        equal(rows.rowCount, 1, 'one receipt/job pair');
        equal(rows.rows[0].receipt_status, 'processing', 'receipt status');
        equal(rows.rows[0].job_status, 'queued', 'job status');
        equal(rows.rows[0].attempt_count, 0, 'job has not been claimed');
      });

      await test('expired lease is reclaimed and a late worker cannot undo completion', async () => {
        const captureId = randomUUID();
        const { out_receipt_id: receiptId } = await enqueue(captureId);
        const firstClaim = (await claim()).find((row) => row.receipt_id === receiptId);
        assert(firstClaim, 'first worker claims the queued job');
        equal(firstClaim.attempt_count, 1, 'first claim count');

        await pg.query(
          "update public.extraction_jobs set locked_at = now() - interval '121 seconds' where id = $1",
          [firstClaim.job_id],
        );
        const reclaimed = (await claim()).find((row) => row.job_id === firstClaim.job_id);
        assert(reclaimed, 'sweeper reclaims expired lease');
        equal(reclaimed.attempt_count, 2, 'reclaimed attempt count');

        const { error: finishError } = await admin.rpc('finish_extraction_job', {
          p_job_id: reclaimed.job_id,
          p_provider_attempted: 'gemini',
        });
        if (finishError) throw new Error(`finish_extraction_job: ${finishError.message}`);
        const { error: lateFinishError } = await admin.rpc('finish_extraction_job', {
          p_job_id: firstClaim.job_id,
          p_provider_attempted: 'grok',
        });
        if (lateFinishError) throw new Error(`late finish_extraction_job: ${lateFinishError.message}`);

        const row = (await pg.query('select status::text, provider_attempted from public.extraction_jobs where id = $1', [reclaimed.job_id])).rows[0];
        equal(row.status, 'done', 'reclaimed job completes');
        equal(row.provider_attempted, 'gemini', 'late worker cannot replace provider result');
      });

      await test('third failed attempt is terminal, fails the receipt, and refunds once', async () => {
        const captureId = randomUUID();
        await pg.query(
          "insert into public.scan_ledger (user_id, delta, reason, ref_id) values ($1, -1, 'scan_used', $2)",
          [userId, captureId],
        );
        const { out_receipt_id: receiptId } = await enqueue(captureId);
        let jobId = null;

        for (let attempt = 1; attempt <= 3; attempt += 1) {
          const claimed = (await claim()).find((row) => row.receipt_id === receiptId);
          assert(claimed, `attempt ${attempt} claims job`);
          jobId = claimed.job_id;
          const { data, error } = await admin.rpc('fail_or_reschedule_extraction_job', {
            p_job_id: jobId,
            p_provider_attempted: 'gemini',
            p_last_error: `forced Gemini failure ${attempt}`,
            p_backoff_seconds: 1,
          });
          if (error) throw new Error(`fail_or_reschedule_extraction_job: ${error.message}`);
          const row = one(data);
          equal(row.out_dead, attempt === 3, `attempt ${attempt} terminal result`);
          if (attempt < 3) {
            await pg.query('update public.extraction_jobs set next_retry_at = now() where id = $1', [jobId]);
          }
        }

        const state = (await pg.query(
          `select r.status::text as receipt_status, j.status::text as job_status,
                  count(sl.*) filter (where sl.reason = 'refund')::int as refunds
             from public.receipts r
             join public.extraction_jobs j on j.receipt_id = r.id
             left join public.scan_ledger sl on sl.user_id = r.user_id and sl.ref_id = r.capture_id
            where r.id = $1
            group by r.status, j.status`,
          [receiptId],
        )).rows[0];
        equal(state.receipt_status, 'failed', 'terminal receipt status');
        equal(state.job_status, 'dead', 'terminal job status');
        equal(state.refunds, 1, 'exactly one refund');
      });

      await test('three provider failures open the breaker and a probe closes it', async () => {
        await pg.query(
          "update public.provider_state set state = 'closed', consecutive_failures = 0, opened_at = null, updated_at = now() - interval '10 minutes' where id = 1",
        );
        for (let n = 0; n < 3; n += 1) await enqueue(randomUUID(), 3);
        const { data, error } = await admin.rpc('get_provider_state');
        if (error) throw new Error(`get_provider_state: ${error.message}`);
        const open = one(data);
        equal(open.out_state, 'open', 'breaker state after third failure');
        equal(open.out_consecutive_failures, 3, 'failure count');

        const { error: probeError } = await admin.rpc('close_provider_breaker_after_probe');
        if (probeError) throw new Error(`close_provider_breaker_after_probe: ${probeError.message}`);
        const { data: closedData, error: closedError } = await admin.rpc('get_provider_state');
        if (closedError) throw new Error(`get_provider_state after probe: ${closedError.message}`);
        const closed = one(closedData);
        equal(closed.out_state, 'closed', 'probe closes breaker');
        equal(closed.out_consecutive_failures, 0, 'probe resets failure count');
      });
    }, pg);
  } finally {
    if (originalBreaker) {
      await pg.query(
        `update public.provider_state
            set state = $2, consecutive_failures = $3, opened_at = $4, last_probe_at = $5, updated_at = $6
          where id = $1`,
        [
          originalBreaker.id,
          originalBreaker.state,
          originalBreaker.consecutive_failures,
          originalBreaker.opened_at,
          originalBreaker.last_probe_at,
          originalBreaker.updated_at,
        ],
      );
    }
    await pg.end();
  }

  const failed = checks.filter((entry) => !entry.ok);
  if (failed.length) process.exitCode = 1;
  console.log(`${TAG} ${failed.length ? 'FAIL' : 'PASS'} ${checks.length - failed.length}/${checks.length} suites`);
}

main().catch((error) => {
  console.error(`${TAG} FATAL ${error.message}`);
  process.exitCode = 1;
});
