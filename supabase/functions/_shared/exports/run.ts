// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * Running one export job, end to end.
 *
 * Two callers share this: the `export` function, which claims the job it just
 * created and runs it immediately so the common case is fast, and the sweeper,
 * which claims whatever is due and is the reason a job cannot be lost. Neither
 * is special — both go through claim → build → complete, so a job that the
 * inline attempt drops on the floor is indistinguishable from one whose worker
 * was killed, and the same recovery covers both (D15's shape, applied to
 * exports).
 *
 * The claim is what makes that safe: a job already leased by someone else
 * returns no row and this returns `skipped` rather than building the files a
 * second time.
 */
import { EXPORT_SIGNED_URL_TTL_SECONDS, exportFileName, exportStoragePath } from '../contracts/exports.ts';
import { buildImagePdfs } from './images.ts';
import { describeFilters, fetchExportRows } from './rows.ts';
import { buildStatement } from './statement.ts';
import { buildWorkbook } from './workbook.ts';

const LEASE_SECONDS = 240;
const EXPORTS_BUCKET = 'exports';
const RECEIPTS_BUCKET = 'receipts';

/** Claims a specific job and runs it. Used by the export function inline. */
export async function claimAndRunExportJob(admin, jobId: string) {
  const { data, error } = await admin.rpc('claim_export_job', {
    p_job_id: jobId,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) throw error;
  const job = (data ?? [])[0];
  if (!job) return { status: 'skipped', job_id: jobId };
  return await runClaimedExportJob(admin, job);
}

/** Claims whatever is due and runs it. Used by the sweeper. */
export async function claimAndRunExportJobs(admin, limit = 3) {
  const { data, error } = await admin.rpc('claim_export_jobs', {
    p_limit: limit,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) throw error;

  const results = [];
  for (const job of data ?? []) {
    results.push(await runClaimedExportJob(admin, job));
  }
  return { claimed: (data ?? []).length, results };
}

export async function runClaimedExportJob(admin, job) {
  const startedAt = Date.now();
  try {
    const generatedAt = new Date();
    const date = generatedAt.toISOString().slice(0, 10);
    const filters = job.filters ?? {};
    const rows = await fetchExportRows(admin, job.user_id, filters);
    const artifacts = [];

    const upload = async (kind, bytes, contentType, receiptCount, part = 1, partCount = 1) => {
      const fileName = exportFileName({ kind, date, part, part_count: partCount });
      const filePath = exportStoragePath(job.user_id, job.id, fileName);
      const { error } = await admin.storage.from(EXPORTS_BUCKET).upload(filePath, bytes, {
        contentType,
        upsert: true,
      });
      if (error) throw error;
      artifacts.push({
        kind,
        file_name: fileName,
        file_path: filePath,
        byte_size: bytes.byteLength ?? bytes.length ?? 0,
        receipt_count: receiptCount,
        part,
        part_count: partCount,
      });
    };

    if (job.format === 'xlsx') {
      await upload('workbook', buildWorkbook(rows), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', rows.length);
    } else {
      const statement = await buildStatement(rows, {
        generatedAt: generatedAt.toISOString(),
        filterSummary: describeFilters(filters),
        timeZone: job.timezone,
      });
      await upload('statement', statement, 'application/pdf', rows.length);
    }

    let imageSummary = null;
    if (job.include_images) {
      // Each part is uploaded and released before the next is built; holding
      // every image PDF in memory is exactly how the 100-image case dies.
      imageSummary = await buildImagePdfs(
        rows,
        (path) => downloadReceiptImage(admin, path),
        async (part) => {
          await upload('images', part.bytes, 'application/pdf', part.receiptCount, part.part, part.partCount);
        },
      );
    }

    const expiresAt = new Date(Date.now() + EXPORT_SIGNED_URL_TTL_SECONDS * 1000).toISOString();
    const { error: completeError } = await admin.rpc('complete_export_job', {
      p_job_id: job.id,
      p_artifacts: artifacts,
      p_receipt_count: rows.length,
      p_expires_at: expiresAt,
    });
    if (completeError) throw completeError;

    console.log('[export] done', {
      job_id: job.id,
      receipts: rows.length,
      artifacts: artifacts.length,
      images_embedded: imageSummary?.embedded ?? 0,
      images_unavailable: imageSummary?.unavailable?.length ?? 0,
      duration_ms: Date.now() - startedAt,
    });

    return {
      status: 'done',
      job_id: job.id,
      receipt_count: rows.length,
      artifacts,
      images: imageSummary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Receipt contents never reach the log; the job id and the failure reason
    // are enough to operate on (§13.1).
    console.error('[export] failed', { job_id: job.id, attempt: job.attempt_count, message });
    const { error: failError } = await admin.rpc('fail_export_job', {
      p_job_id: job.id,
      p_error: message,
      p_backoff_seconds: 30 * Math.max(1, Number(job.attempt_count) || 1),
    });
    if (failError) console.error('[export] could not record failure', { job_id: job.id, message: failError.message });
    return { status: 'failed', job_id: job.id, error: message };
  }
}

async function downloadReceiptImage(admin, path: string) {
  const { data, error } = await admin.storage.from(RECEIPTS_BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}
