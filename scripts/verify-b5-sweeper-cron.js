/** Proves the staging 30-second cron invokes sweeper and completes a queued job. */
const { randomUUID } = require('crypto');
const { resolveConfig, makeAdmin, connectPg, projectRef, withUser } = require('./lib/staging');

const TAG = '[b5:sweeper-cron]';
const WAIT_MS = 50_000;
const POLL_MS = 500;
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z', 'base64');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const config = resolveConfig({ needDbUrl: true });
  const admin = makeAdmin(config);
  const pg = await connectPg(config);
  const original = (await pg.query('select * from public.provider_state where id = 1')).rows[0];
  try {
    await withUser(admin, async ({ userId }) => {
      const captureId = randomUUID();
      const imagePath = `${userId}/${captureId}.jpg`;
      const { error: uploadError } = await admin.storage.from('receipts').upload(imagePath, JPEG, {
        contentType: 'image/jpeg',
        upsert: false,
      });
      if (uploadError) throw new Error(`storage upload: ${uploadError.message}`);
      const { data, error } = await admin.rpc('enqueue_provider_delay_job', {
        p_user_id: userId,
        p_capture_id: captureId,
        p_capture_mode: 'default',
        p_extraction_mode: 'precise',
        p_image_path: imagePath,
        p_image_byte_size: JPEG.length,
        p_acked_at: new Date().toISOString(),
        p_provider_attempted: 'grok',
        p_last_error: 'cron verification seed',
        p_failure_window_seconds: 120,
        p_failure_threshold: 999,
      });
      if (error) throw new Error(`enqueue: ${error.message}`);
      const receiptId = (Array.isArray(data) ? data[0] : data)?.out_receipt_id;
      if (!receiptId) throw new Error('enqueue did not return a receipt id');

      let completed = null;
      const deadline = Date.now() + WAIT_MS;
      while (Date.now() < deadline) {
        const row = (await pg.query(
          `select r.status::text as receipt_status, r.provider::text as provider, j.status::text as job_status
             from public.receipts r join public.extraction_jobs j on j.receipt_id = r.id
            where r.id = $1`,
          [receiptId],
        )).rows[0];
        if (row?.job_status === 'done') {
          completed = row;
          break;
        }
        await sleep(POLL_MS);
      }
      if (!completed) throw new Error(`cron did not complete the job inside ${WAIT_MS}ms`);
      if (completed.receipt_status !== 'needs_review' || completed.provider !== 'gemini') {
        throw new Error(`unexpected completion: ${JSON.stringify(completed)}`);
      }
      console.log(`${TAG} PASS scheduled sweeper completed a queued job on ${projectRef(config.url)}`);
    }, pg);
  } finally {
    if (original) await pg.query(
      'update public.provider_state set state = $2, consecutive_failures = $3, opened_at = $4, last_probe_at = $5, updated_at = $6 where id = $1',
      [original.id, original.state, original.consecutive_failures, original.opened_at, original.last_probe_at, original.updated_at],
    );
    await pg.end();
  }
}

main().catch((error) => {
  console.error(`${TAG} FAIL ${error.message}`);
  process.exitCode = 1;
});
