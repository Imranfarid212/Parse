const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function fail(message) {
  throw new Error(`[b5:backend] ${message}`);
}

function includes(source, needle, label) {
  if (!source.includes(needle)) fail(`${label}: expected ${JSON.stringify(needle)}`);
}

function excludes(source, needle, label) {
  if (source.includes(needle)) fail(`${label}: did not expect ${JSON.stringify(needle)}`);
}

function order(source, before, after, label) {
  const a = source.indexOf(before);
  const b = source.indexOf(after);
  if (a === -1 || b === -1 || a > b) fail(`${label}: expected ${JSON.stringify(before)} before ${JSON.stringify(after)}`);
}

function orderAfter(source, anchor, before, after, label) {
  const start = source.indexOf(anchor);
  if (start === -1) fail(`${label}: expected anchor ${JSON.stringify(anchor)}`);
  order(source.slice(start), before, after, label);
}

const decisionLog = read('docs/decision-log.md');
const migration = read('supabase/migrations/20260803000300_b5_durable_extraction_jobs.sql');
const schedulerMigration = read('supabase/migrations/20260803000400_b5_schedule_workers.sql');
const extract = read('supabase/functions/extract/index.ts');
const sweeper = read('supabase/functions/sweeper/index.ts');
const probe = read('supabase/functions/provider-probe/index.ts');
const jobs = read('supabase/functions/_shared/extraction-jobs.ts');
const client = read('src/lib/receipts/client.ts');
const capture = read('src/lib/receipts/capture.ts');
const camera = read('src/app/camera.tsx');
const store = read('src/lib/receipts/store.ts');
const search = read('src/components/search/SearchView.tsx');
const layout = read('src/app/_layout.tsx');

includes(decisionLog, 'DL-004 - B5 uses hybrid provider fallback with durable server jobs', 'B5 decision logged before implementation');

includes(migration, 'function public.enqueue_provider_delay_job', 'transactional enqueue RPC exists');
includes(migration, 'insert into public.receipts', 'enqueue creates/updates processing receipt');
includes(migration, 'insert into public.extraction_jobs', 'enqueue creates durable job');
includes(migration, 'on conflict (receipt_id)', 'job is idempotent by receipt');
includes(migration, 'for update of j skip locked', 'claim uses FOR UPDATE SKIP LOCKED');
includes(migration, "j.locked_at < now() - make_interval", 'lease expiry reclaims crashed workers');
includes(migration, 'function public.fail_or_reschedule_extraction_job', 'job terminal/reschedule RPC exists');
includes(migration, "set status = 'failed'", 'terminal job marks receipt failed');
includes(migration, 'perform public.refund_scan', 'terminal job refunds scan');
includes(migration, 'v_failures >= p_failure_threshold', 'breaker opens at threshold');
includes(migration, 'p_failure_window_seconds int default 120', 'breaker window is 120 seconds');
includes(migration, 'function public.close_provider_breaker_after_probe', 'probe can close breaker');

includes(extract, 'extractWithGrokRetry', 'Precise Grok has retry wrapper');
includes(extract, "Number(Deno.env.get('GROK_RETRY_TIMEOUT_MS') || 1200)", 'Grok retry timeout is 1.2s');
includes(extract, 'enqueueProviderDelay', 'Precise failure enqueues server job');
includes(extract, "return json(202", 'Precise failure returns 202');
includes(extract, "code: 'PROVIDER_DELAY'", '202 code is PROVIDER_DELAY');
excludes(extract, 'claimAndRunExtractionJobs(admin, 1)', 'provider-delay response leaves work for the leased sweeper so pending UI can render');
includes(extract, 'isProviderBreakerOpen', 'Precise checks breaker');
includes(extract, 'extractWithGeminiImage', 'breaker-open path uses Gemini synchronously');
includes(extract, "breakerOpen ? 'gemini' : 'grok'", 'provider is recorded from actual synchronous provider');
orderAfter(
  extract,
  'const [storageResult, extractionResult]',
  'if (uploadError) return json(503',
  'enqueueProviderDelay',
  'Storage failure cannot return 202',
);
excludes(extract, 'enqueue_provider_delay_job({', 'no invalid direct RPC object call');

includes(sweeper, 'claimAndRunExtractionJobs', 'sweeper runs durable jobs');
includes(probe, 'probeGrok', 'provider probe calls Grok canary');
includes(probe, 'close_provider_breaker_after_probe', 'provider probe closes breaker on success');
includes(jobs, 'GROK_CANARY_ID', 'provider probe uses a named canary fixture');
includes(jobs, 'Grok canary fixture returned an unexpected response', 'provider probe validates canary output');
includes(schedulerMigration, "'30 seconds'", 'sweeper runs every 30 seconds');
includes(schedulerMigration, "'*/15 * * * *'", 'provider probe runs every 15 minutes');
includes(schedulerMigration, 'vault.decrypted_secrets', 'scheduler reads credentials from Vault');
includes(schedulerMigration, 'net.http_post', 'scheduler invokes Edge Functions asynchronously');
includes(jobs, 'claim_extraction_jobs', 'runner claims through SQL RPC');
includes(jobs, 'finish_extraction_job', 'runner marks done');
includes(jobs, 'fail_or_reschedule_extraction_job', 'runner reschedules or kills');
includes(jobs, ".eq('status', 'processing')", 'late worker is guarded by receipt status');
includes(jobs, "provider: 'gemini'", 'worker records Gemini provider');

includes(client, "error.code = 'PROVIDER_DELAY'", 'client preserves 202 error code');
includes(client, 'error.receiptId = data.receipt_id', 'client preserves 202 receipt id');
includes(capture, "getExtractErrorCode(error) === 'PROVIDER_DELAY'", 'capture handles provider delay distinctly');
includes(capture, 'store.markProviderDelayed', 'capture marks server-owned pending status');
includes(store, "'provider_delayed'", 'local store knows provider-delayed status');
includes(store, "row.status === 'provider_delayed'", 'server sync may overwrite provider-delayed rows');
includes(camera, 'COPY_PROVIDER_DELAY', 'camera uses canonical provider delay copy');
includes(search, 'provider_delayed', 'Recents/Search show pending provider jobs');
includes(store, 'countProviderDelayed', 'store can identify server-owned pending jobs');
includes(layout, 'ProviderDelayPoller', 'app polls while a provider-delayed receipt exists');
includes(layout, 'syncFromServer(auth.user.id, auth.categories)', 'pending poll pulls completed jobs from the server');

console.log('[b5:backend] PASS');
