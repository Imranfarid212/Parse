// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * The export job runner, against a stubbed Supabase client.
 *
 * This covers the parts that no amount of file-format testing reaches: that a
 * job already leased by another worker is not built twice, that a failure is
 * recorded as a failure rather than leaving a job stuck in `running` forever,
 * and that the seven-day link lifetime is actually what gets written.
 *
 * Run: npm run b7:builders
 */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { EXPORT_SIGNED_URL_TTL_SECONDS } from '../../_shared/contracts/exports.ts';
import { claimAndRunExportJob, runClaimedExportJob } from '../../_shared/exports/run.ts';
import { tinyJpeg } from './tiny-jpeg.ts';

const USER = '20000000-0000-4000-8000-000000000001';
const JOB = '10000000-0000-4000-8000-000000000001';

const ROW = {
  id: '30000000-0000-4000-8000-000000000001',
  txn_date: '2026-07-02',
  merchant: 'Whole Foods Market',
  category_name: 'Meals & Entertainment',
  currency: 'USD',
  total: 73.36,
  notes: null,
  image_path: 'user/one.jpg',
  created_at: '2026-07-02T10:00:00.000Z',
  line_items: [{ name: 'Organic bananas', qty: 1, amount: 1.74 }],
};

function stubAdmin(options = {}) {
  const calls = { rpc: [], uploads: [], downloads: [] };
  const job = { id: JOB, user_id: USER, status: 'running', attempt_count: 1, filters: {}, timezone: null, ...options.job };

  const admin = {
    calls,
    rpc(name: string, args: Record<string, unknown>) {
      calls.rpc.push({ name, args });
      if (name === 'claim_export_job') {
        return Promise.resolve({ data: options.claimable === false ? [] : [job], error: null });
      }
      if (name === 'export_receipt_rows') {
        const rows = args.p_offset > 0 ? [] : (options.rows ?? [ROW]);
        return Promise.resolve({ data: rows, error: null });
      }
      if (name === 'complete_export_job' || name === 'fail_export_job') {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from(bucket: string) {
        return {
          upload(path: string, bytes: Uint8Array, opts: Record<string, unknown>) {
            calls.uploads.push({ bucket, path, size: bytes.byteLength ?? bytes.length, contentType: opts?.contentType });
            if (options.uploadFails) return Promise.resolve({ error: new Error('storage is down') });
            return Promise.resolve({ error: null });
          },
          download(path: string) {
            calls.downloads.push({ bucket, path });
            const bytes = tinyJpeg();
            return Promise.resolve({ data: { arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0)) }, error: null });
          },
        };
      },
    },
  };
  return { admin, job };
}

Deno.test('an xlsx job uploads one workbook and completes with a seven-day expiry', async () => {
  const { admin, job } = stubAdmin({ job: { format: 'xlsx', include_images: false } });
  const result = await runClaimedExportJob(admin, job);

  assertEquals(result.status, 'done');
  assertEquals(admin.calls.uploads.length, 1);
  assertEquals(admin.calls.uploads[0].bucket, 'exports');
  assert(admin.calls.uploads[0].path.startsWith(`${USER}/${JOB}/parse_export_`));
  assert(admin.calls.uploads[0].path.endsWith('.xlsx'));

  const complete = admin.calls.rpc.find((call) => call.name === 'complete_export_job');
  assert(complete, 'the job must be completed');
  assertEquals(complete.args.p_receipt_count, 1);
  assertEquals(complete.args.p_artifacts.length, 1);

  const ttlMs = new Date(complete.args.p_expires_at).getTime() - Date.now();
  assert(Math.abs(ttlMs - EXPORT_SIGNED_URL_TTL_SECONDS * 1000) < 60_000, `expiry was ${ttlMs}ms away, not seven days`);
});

Deno.test('a pdf job with images uploads the statement and the images PDF', async () => {
  const { admin, job } = stubAdmin({ job: { format: 'pdf', include_images: true } });
  const result = await runClaimedExportJob(admin, job);

  assertEquals(result.status, 'done');
  assertEquals(admin.calls.uploads.length, 2);
  assert(admin.calls.uploads[0].path.endsWith('.pdf'));
  assert(admin.calls.uploads[1].path.endsWith('_images.pdf'));
  assertEquals(admin.calls.uploads[0].contentType, 'application/pdf');
  assertEquals(admin.calls.downloads[0], { bucket: 'receipts', path: 'user/one.jpg' });
});

Deno.test('a job nobody can claim is not built a second time', async () => {
  const { admin } = stubAdmin({ claimable: false, job: { format: 'xlsx', include_images: false } });
  const result = await claimAndRunExportJob(admin, JOB);

  assertEquals(result.status, 'skipped');
  assertEquals(admin.calls.uploads.length, 0);
  assert(!admin.calls.rpc.some((call) => call.name === 'complete_export_job'));
});

Deno.test('a storage failure marks the job failed instead of leaving it running', async () => {
  const { admin, job } = stubAdmin({ uploadFails: true, job: { format: 'xlsx', include_images: false } });
  const result = await runClaimedExportJob(admin, job);

  assertEquals(result.status, 'failed');
  const failed = admin.calls.rpc.find((call) => call.name === 'fail_export_job');
  assert(failed, 'the failure must be recorded so the sweeper can retry it');
  assertEquals(failed.args.p_job_id, JOB);
  assert(!admin.calls.rpc.some((call) => call.name === 'complete_export_job'));
});

Deno.test('an export of nothing still completes, with zero receipts', async () => {
  const { admin, job } = stubAdmin({ rows: [], job: { format: 'pdf', include_images: true } });
  const result = await runClaimedExportJob(admin, job);

  assertEquals(result.status, 'done');
  assertEquals(result.receipt_count, 0);
  // The statement is still produced — an empty export the user can open beats
  // an export that silently never appears.
  assertEquals(admin.calls.uploads.length, 1);
  assertEquals(admin.calls.downloads.length, 0);
});
