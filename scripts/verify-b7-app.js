const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const fail = (message) => { throw new Error(`[b7:app] ${message}`); };
const includes = (source, needle, label) => { if (!source.includes(needle)) fail(`${label}: expected ${JSON.stringify(needle)}`); };
const excludes = (source, needle, label) => { if (source.includes(needle)) fail(`${label}: did not expect ${JSON.stringify(needle)}`); };

const screen = read('src/components/menu/ExportScreen.tsx');
const client = read('src/lib/receipts/exports.ts');
const sheet = read('src/components/receipt/ReceiptFilterSheet.tsx');
const search = read('src/components/search/SearchView.tsx');

// --- the screen is wired to the real subsystem ------------------------------
includes(screen, 'startExport', 'Generate starts a real export job');
includes(screen, 'useExportJobs', 'the screen renders live job state');
excludes(screen, 'setTimeout', 'no mock progress remains');
excludes(screen, "'csv'", 'CSV is gone; the contract is xlsx or pdf');
excludes(screen, 'Expense_Report_Jul26', 'no invented file names remain');
includes(screen, 'Excel Sheet', 'the format control offers the xlsx contract format');
includes(screen, 'include_images: includeScans', 'the include-images toggle reaches the request');

// --- progress, download, failure --------------------------------------------
includes(screen, "state === 'running' ? 'Building your export…' : 'Queued'", 'queued and running are both visible');
includes(screen, 'Ready to download', 'a finished export offers its files');
includes(screen, 'retryExportJob', 'a failed export can be retried');
includes(screen, 'Try again', 'the retry control is labelled');
includes(screen, 'createExportDownloadUrl', 'downloads use a freshly minted signed link');
includes(screen, 'Share.share', 'a finished file can be shared out of the app');
includes(screen, 'part ${artifact.part} of ${artifact.part_count}', 'a chunked export says which part a file is');
includes(screen, 'exportState(job)', 'each job renders the state it is actually in');
includes(screen, 'Download expired', 'an export whose files are gone says so instead of offering them');
includes(screen, 'Export again', 'an expired export can be re-run with the same filters');
includes(screen, 'Available until', 'a live export shows how long its files last');
includes(screen, 'Downloads stay available for 7 days', 'an expired export explains why, in a full sentence');
includes(screen, "Alert.alert(\n          'Nothing to export'", 'an empty filter set is refused before a job is created');
includes(screen, 'searchManagedReceipts(filters, auth.user?.id)', 'the emptiness check counts what the export would contain');
includes(screen, 'describeFilters(job.filters ?? {}, categories)', 'every past export says what it covered');
includes(screen, 'styles.jobContents', 'the filter summary is rendered on the job row');
includes(sheet, "if (filters.text) parts.push", 'the summary covers text search, not just dates and categories');
includes(client, "job.artifacts.length === 0 || past ? 'expired' : 'ready'", 'a done job with no files is never advertised as ready');
includes(client, 'repeatExport', 'the client can re-run a finished export');

// --- one filter sheet, one contract -----------------------------------------
includes(screen, '<ReceiptFilterSheet', 'Export filters through the shared sheet');
includes(search, '<ReceiptFilterSheet', 'Search filters through the same shared sheet');
includes(sheet, 'searchQuerySchema.safeParse', 'the shared sheet validates against the canonical contract');
includes(sheet, 'amount_currency', 'amount filters carry a currency');
includes(sheet, "from '@expo/ui/community/datetime-picker'", 'date filters use the native SDK 57 picker');
includes(sheet, 'minimumDate=', 'the end-date picker enforces the selected start date');
includes(sheet, 'maximumDate=', 'date pickers prevent invalid future or reversed ranges');
includes(sheet, '<KeyboardAvoidingView', 'the filter sheet stays visible above the keyboard');
includes(sheet, 'filterScrollRef.current?.scrollToEnd', 'amount inputs are revealed when focused');
excludes(search, 'function FilterModal', 'the duplicate filter sheet is gone');

// --- the client library ------------------------------------------------------
includes(client, "functions.invoke('export'", 'exports start through the edge function');
includes(client, "table: 'export_jobs'", 'progress arrives over Realtime, not polling');
includes(client, 'removeChannel', 'the Realtime channel is cleaned up');
includes(client, 'EXPORT_SIGNED_URL_TTL_SECONDS', 'the link lifetime comes from contracts');
includes(client, "code === 'RATE_LIMITED'", 'the concurrency cap is explained rather than shown as a crash');
includes(client, 'timezone: deviceTimeZone()', 'exports are rendered in the device\'s timezone');
includes(client, 'Localization.getCalendars()', 'the timezone comes from the device rather than being guessed');
excludes(client, 'setInterval', 'no polling loop replaces Realtime');

console.log('[b7:app] PASS');
