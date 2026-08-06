/**
 * The client half of the export subsystem.
 *
 * The device never builds a file. It asks the server to start a job, then
 * watches that job's row over Realtime — the same pattern Recents uses for
 * receipts. That is why there is no polling here and no progress the client
 * invents: the row is the progress.
 *
 * Download links are minted on demand rather than stored, so a link is always
 * fresh while the file exists. The file itself is deleted once the job's
 * seven-day expiry passes (Blueprint §12), which is what actually ends access.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Localization from 'expo-localization';

import type { ExportArtifact, ExportJob, SearchQuery } from '@/../packages/contracts/src';
import { EXPORT_SIGNED_URL_TTL_SECONDS, exportRequestSchema } from '@/../packages/contracts/src';
import { isSupabaseConfigured, supabase } from '@/lib/auth/supabase';

export type ExportFormat = 'xlsx' | 'pdf';

export type StartExportInput = {
  filters: Omit<SearchQuery, 'text' | 'view'> & { text?: string };
  format: ExportFormat;
  include_images: boolean;
};

const RECENT_JOB_LIMIT = 10;

/**
 * The device's IANA timezone, sent with every export.
 *
 * The statement's generated timestamp is rendered server-side, possibly minutes
 * later by the sweeper, so the zone has to travel with the request — the server
 * has no other way to know it. Expo reports the calendar's zone; Intl is the
 * fallback, and an export with neither is rendered in UTC rather than refused.
 */
function deviceTimeZone(): string | undefined {
  try {
    const fromCalendar = Localization.getCalendars()[0]?.timeZone;
    if (fromCalendar) return fromCalendar;
  } catch {
    // fall through to Intl
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function toExportJob(row: Record<string, unknown>): ExportJob {
  return {
    id: String(row.id),
    status: (row.status as ExportJob['status']) ?? 'queued',
    format: (row.format as ExportFormat) ?? 'xlsx',
    include_images: Boolean(row.include_images),
    filters: (row.filters as SearchQuery) ?? {},
    artifacts: Array.isArray(row.artifacts) ? (row.artifacts as ExportArtifact[]) : [],
    receipt_count: row.receipt_count === null || row.receipt_count === undefined ? null : Number(row.receipt_count),
    timezone: (row.timezone as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    expires_at: (row.expires_at as string | null) ?? null,
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  };
}

export async function startExport(input: StartExportInput): Promise<ExportJob> {
  if (!isSupabaseConfigured) throw new Error('Exports need a signed-in account.');

  // Validated against the shared contract before it leaves the device, so a
  // malformed request is a message here rather than a 400 after a round trip.
  // This is the same schema the function's hand-written validator is reviewed
  // against — the server cannot run zod, so this is where it actually runs.
  const parsed = exportRequestSchema.safeParse({
    filters: input.filters ?? {},
    format: input.format,
    include_images: input.include_images,
    timezone: deviceTimeZone(),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'These export settings are not valid.');
  }

  const { data, error } = await supabase.functions.invoke('export', { body: parsed.data });

  if (error) {
    // functions.invoke folds any non-2xx into an error; read the body so the
    // user is told which of the two things actually happened rather than
    // "something went wrong".
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      const body = await context.json().catch(() => null);
      if (body?.code === 'RATE_LIMITED') {
        throw new Error(body.message ?? 'You already have exports running. Wait for those to finish.');
      }
      if (body?.message) throw new Error(body.message);
    }
    throw error;
  }

  if (!data?.job) throw new Error('The export did not start. Try again.');
  return toExportJob(data.job);
}

export async function listExportJobs(): Promise<ExportJob[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('export_jobs')
    .select('id,status,format,include_images,filters,artifacts,receipt_count,timezone,error,expires_at,created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(RECENT_JOB_LIMIT);
  if (error) throw error;
  return (data ?? []).map(toExportJob);
}

export async function retryExportJob(jobId: string): Promise<void> {
  if (!isSupabaseConfigured) throw new Error('Exports need a signed-in account.');
  const { error } = await supabase.rpc('retry_export_job', { p_job_id: jobId });
  if (error) throw error;
}

/** A fresh signed link for one artifact, valid for the canonical seven days. */
export async function createExportDownloadUrl(artifact: ExportArtifact): Promise<string> {
  const { data, error } = await supabase.storage
    .from('exports')
    .createSignedUrl(artifact.file_path, EXPORT_SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('That file is no longer available.');
  return data.signedUrl;
}

/**
 * What a finished job actually offers the user.
 *
 * A `done` job is not the same as a job you can download from. Its files live
 * for seven days and are then deleted, which leaves the row exactly as it was
 * minus its artifacts — so "done" alone would have the screen advertise a
 * download that no longer exists. The artifact list is the authority; the expiry
 * date is a second signal for the window between the deadline passing and the
 * sweeper getting to it.
 */
export function exportState(job: ExportJob): 'queued' | 'running' | 'failed' | 'ready' | 'expired' {
  if (job.status === 'failed') return 'failed';
  if (job.status !== 'done') return job.status;
  const past = Boolean(job.expires_at && new Date(job.expires_at).getTime() <= Date.now());
  return job.artifacts.length === 0 || past ? 'expired' : 'ready';
}

export function isExportExpired(job: ExportJob): boolean {
  return exportState(job) === 'expired';
}

/** Re-runs a finished export with the same filters, format and image choice. */
export async function repeatExport(job: ExportJob): Promise<ExportJob> {
  return startExport({
    filters: job.filters ?? {},
    format: job.format,
    include_images: job.include_images,
  });
}

/**
 * The user's recent export jobs, kept current by Realtime on export_jobs.
 *
 * Progress is queued → running → done|failed, and every one of those
 * transitions is a row update the server already makes, so the UI needs no
 * timers and cannot show a state the database is not in.
 */
export function useExportJobs(userId: string | null | undefined) {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const next = await listExportJobs();
      if (request !== requestRef.current) return;
      setJobs(next);
      setError(null);
    } catch (cause) {
      if (request !== requestRef.current) return;
      setError(cause instanceof Error ? cause.message : 'Could not load your exports.');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId || !isSupabaseConfigured) {
      setJobs([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    void reload();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`export-jobs:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'export_jobs', filter: `user_id=eq.${userId}` },
        () => {
          clearTimeout(timer);
          timer = setTimeout(() => void reload(), 100);
        },
      )
      .subscribe();

    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [reload, userId]);

  return { jobs, loading, error, reload, setJobs };
}
