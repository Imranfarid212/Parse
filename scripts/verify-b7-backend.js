const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const fail = (message) => { throw new Error(`[b7:backend] ${message}`); };
const includes = (source, needle, label) => { if (!source.includes(needle)) fail(`${label}: expected ${JSON.stringify(needle)}`); };
const excludes = (source, needle, label) => { if (source.includes(needle)) fail(`${label}: did not expect ${JSON.stringify(needle)}`); };

const migration = read('supabase/migrations/20260805000100_b7_export_jobs.sql');
const timezoneMigration = read('supabase/migrations/20260806000100_b7_export_timezone.sql');
const exportFn = read('supabase/functions/export/index.ts');
const request = read('supabase/functions/_shared/exports/request.ts');
const run = read('supabase/functions/_shared/exports/run.ts');
const money = read('supabase/functions/_shared/exports/money.ts');
const workbook = read('supabase/functions/_shared/exports/workbook.ts');
const statement = read('supabase/functions/_shared/exports/statement.ts');
const images = read('supabase/functions/_shared/exports/images.ts');
const sweeper = read('supabase/functions/sweeper/index.ts');
const schemas = read('packages/contracts/src/schemas.ts');
const exportsContract = read('packages/contracts/src/exports.ts');

// --- the export reads what the app reads ------------------------------------
includes(migration, 'from public.active_receipts', 'exports read through the shared soft-delete predicate');
includes(migration, "r.status in ('needs_review', 'confirmed', 'failed', 'processing')", 'exports use the same status set as search');
includes(migration, 'order by r.txn_date asc nulls last', 'export rows are date-ordered for the images PDF');
includes(migration, 'amount_currency is required with amount filters', 'currency-less amount filters are refused server-side');
includes(migration, 'r.currency = p_amount_currency', 'amount comparisons stay inside one currency');
includes(migration, 'service role required', 'the export read path is service-role only');

// --- durable jobs, the same shape as B5's extraction queue -------------------
includes(migration, 'for update skip locked', 'export jobs are claimed concurrently-safely');
includes(migration, 'locked_at', 'claims take a lease rather than a flag');
includes(migration, 'function public.claim_export_job(', 'a named job can be claimed by the inline runner');
includes(migration, 'function public.claim_export_jobs(', 'due jobs can be claimed by the sweeper');
includes(migration, 'function public.complete_export_job(', 'completion is a service-role transition');
includes(migration, 'function public.fail_export_job(', 'failure is recorded rather than left running');
includes(migration, "when attempt_count >= 3 then 'failed'", 'a job gives up after three attempts');
includes(migration, "and status <> 'done'", 'a late worker cannot overwrite a finished export');
includes(migration, 'too many exports already running', 'concurrent exports per user are capped');

// --- the client can watch, and cannot forge ---------------------------------
includes(migration, 'create policy "export jobs owner select"', 'a user can watch their own exports');
excludes(migration, 'create policy "export jobs owner all"', 'the permissive B1 policy is gone');
includes(migration, 'grant select on public.export_jobs to authenticated', 'the select policy is actually reachable');
includes(migration, 'alter publication supabase_realtime add table public.export_jobs', 'export progress is published over Realtime');
includes(migration, 'security definer', 'the retry path does not need a client write grant');

// --- retention --------------------------------------------------------------
includes(migration, 'function public.purge_expired_exports(', 'expired exports are purged');
includes(migration, 'export_file_purge_queue', 'file deletion survives a failed Storage call');
includes(migration, 'out_file_path', 'purge outputs cannot shadow the columns they select');
includes(sweeper, 'claimAndRunExportJobs', 'the sweeper is the guarantee behind every 202');
includes(sweeper, 'purgeExpiredExports', 'the sweeper enforces the seven-day retention');
includes(sweeper, "storage.from('exports').remove(paths)", 'expired export files leave Storage');
includes(sweeper, "from('export_file_purge_queue').delete()", 'a file is forgotten only after Storage confirms');

// --- the function -----------------------------------------------------------
includes(exportFn, 'auth.getUser()', 'the export function authenticates the caller');
includes(exportFn, "rpc('enqueue_export_job'", 'the job row is committed before the response');
includes(exportFn, 'json(202', 'export is async by design and never returns a file');
includes(exportFn, 'waitUntil(claimAndRunExportJob', 'the inline build is best-effort background work');
includes(exportFn, "code: 'RATE_LIMITED'", 'the concurrency cap reaches the client as a rate limit');
excludes(exportFn, "json(200, { file", 'there is no synchronous file response to fall back to');

// --- money ------------------------------------------------------------------
includes(money, 'toMinorUnits', 'money is summed in integer minor units');
includes(money, 'inside the ${group.currency} group', 'a mixed-currency sum throws rather than rounding');
// The workbook shape after the B7 revision (DL-006): one sheet per currency,
// no subtotal rows, no line-items sheet, no receipt ids.
includes(workbook, 'currencySheet(group.rows, group.currency), group.currency', 'each currency gets its own sheet');
excludes(workbook, 'Subtotal', 'per-currency sheets make subtotal rows unnecessary');
excludes(workbook, "'Line items'", 'line items are not exported');
excludes(workbook, 'Receipt ID', 'receipt ids are not exported');
includes(workbook, "`Amount (${currency})`", 'the currency qualifies the amounts rather than repeating in a column');
excludes(workbook, "'Currency',", 'a sheet named for its currency does not repeat it in a column');
includes(workbook, "HEADER_FILL = 'D8E4BC'", 'the header row carries the olive fill');
includes(workbook, 'font: { bold: true }', 'the header row is bold');
includes(workbook, "z = DATE_FORMAT", 'dates are written as dates, formatted dd/mm/yyyy');
includes(statement, 'categoryTotalsFor(group)', 'the statement totals categories inside one currency');
includes(statement, 'NO_GRAND_TOTAL_NOTE', 'the statement explains why there is no combined total');
includes(statement, 'HEADER_BG', 'PDF table headers sit on the same olive fill as the workbook');
includes(statement, "fonts.semibold.heightAtSize(size, { descender: false })", 'the header band is sized from the text it encloses');
excludes(statement, "layout.text('Parse export'", 'the statement carries no cover title');
includes(statement, 'formatTimestamp(generatedAt, timeZone)', 'the generated time is readable, in the reader\'s timezone');
includes(exportFn, 'p_timezone: validated.request.timezone', 'the device timezone is stored on the job');
includes(run, 'timeZone: job.timezone', 'the stored timezone is what the statement renders in');
includes(timezoneMigration, 'add column if not exists timezone text', 'the job carries a timezone');
includes(timezoneMigration, 'drop function if exists public.enqueue_export_job(uuid, jsonb, export_format, boolean, int)', 'the old enqueue signature is replaced, not overloaded');
includes(images, 'perPart', 'the images PDF chunks');
includes(images, 'unavailable', 'a receipt whose image is missing is reported, not hidden');
includes(run, 'EXPORT_SIGNED_URL_TTL_SECONDS', 'the link lifetime comes from contracts');
includes(images, 'FETCH_CONCURRENCY', 'images are fetched concurrently so a large export finishes in one invocation');

// Supabase's server-side bundler (`functions deploy --use-api`) refuses imports
// from hosts outside its allow-list, and cdn.sheetjs.com is one of them. The
// deploy fails at bundle time, so catching it here is the difference between a
// failed gate and a failed release.
for (const [name, source] of Object.entries({ workbook, statement, images, run, money, request })) {
  if (/from '(https?:)?\/\/cdn\./.test(source) || source.includes("from 'https://cdn.")) {
    fail(`${name}.ts imports from a CDN the function bundler will refuse; vendor it instead`);
  }
}
// SheetJS Community Edition cannot write cell styling, so the workbook is
// written with the style-capable fork. Nothing on the server parses a
// spreadsheet; only the writing path is used.
includes(workbook, "from 'https://esm.sh/xlsx-js-style", 'the workbook is written with a style-capable writer');

// --- the two copies of the request rules stay in step ------------------------
includes(request, 'Currency is required with amount filters', 'the function refuses what the schema refuses');
includes(schemas, 'Currency is required with amount filters', 'the client refuses what the function refuses');
includes(exportsContract, 'receiptflow_export', 'file names live in contracts');
includes(exportsContract, '7 * 24 * 60 * 60', 'the seven-day expiry lives in contracts');
excludes(exportsContract, "from './enums'", 'the shared export module stays importable from Deno');
for (const format of ['xlsx', 'pdf']) {
  includes(exportsContract, `.${format}`, `the ${format} file name is defined`);
}
excludes(schemas, "'csv'", 'CSV is not an export format');

// --- branding -----------------------------------------------------------------
// Only code is checked. Comments are allowed to say "ReceiptFlow" where they
// explain what the playbook calls something and why the build differs (DL-006);
// what must not survive is the old name reaching a user.
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

for (const [name, source] of Object.entries({ statement, images, exportsContract })) {
  if (/ReceiptFlow/i.test(withoutComments(source))) {
    fail(`${name} still ships the name ReceiptFlow; the product is called Parse`);
  }
}
includes(exportsContract, "'parse_export'", 'exported files are named for the app');

console.log('[b7:backend] PASS');
