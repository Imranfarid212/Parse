/**
 * T4.2 — checks the committed golden report, without spending a model call.
 *
 * The run itself is `npm run b4:golden`: 20 live model calls, done deliberately
 * before closing the phase and again after anything that could move the numbers.
 * This is what the gate runs instead. It answers one question — is there real,
 * current evidence that T4.2 passes? — and it is strict about "current", because
 * a gate that trusts a stale file is worse than one that trusts nothing.
 *
 * It cannot fail for the reason T4.2 exists to catch. Only the run can do that.
 * What it can do is refuse to let a passing report be inherited by code that
 * never earned it.
 *
 * Run: node scripts/verify-b4-golden.js
 */
const fs = require('fs');
const path = require('path');
const { sourceFingerprint } = require('./lib/golden-fingerprint');
const { THRESHOLDS } = require('./lib/golden-set');

const root = path.resolve(__dirname, '..');
const REPORT = 'gates/report-b4-golden.json';
const EXPECTED_SAMPLES = 20; // the playbook's 20-receipt set

function fail(message, hint) {
  console.error(`[b4:golden:verify] ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

const reportPath = path.join(root, REPORT);
if (!fs.existsSync(reportPath)) {
  fail(`no golden report at ${REPORT}`, 'Run `npm run b4:golden` — 20 live model calls against staging.');
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch (error) {
  fail(`${REPORT} is not readable JSON: ${error.message}`);
}

if (report.test !== 'T4.2-golden-latency') {
  fail(`${REPORT} is not a T4.2 report (test: ${JSON.stringify(report.test)})`);
}

// Stale evidence. The fingerprint covers the prompt, the extraction path, the
// category rules, the schema and the fixtures — see lib/golden-fingerprint.js.
const current = sourceFingerprint();
const recorded = report.source_fingerprint;
if (!recorded?.combined) {
  fail(
    `${REPORT} predates the staleness check and cannot be trusted`,
    'Re-run `npm run b4:golden` to produce a report carrying a fingerprint.',
  );
}
if (recorded.combined !== current.combined) {
  const changed = current.files
    .filter((file) => recorded.files?.find((f) => f.path === file.path)?.sha256 !== file.sha256)
    .map((file) => file.path);
  fail(
    'the golden report describes code that has since changed',
    `Changed since the run: ${changed.join(', ') || 'unknown'}\n` +
      `  The numbers in ${REPORT} are no longer evidence. Re-run \`npm run b4:golden\`.`,
  );
}

// A short run is for iterating on the harness; it is not the playbook's test.
const scored = report.accuracy?.scored ?? 0;
if (scored !== EXPECTED_SAMPLES) {
  fail(
    `the report covers ${scored} receipts, not ${EXPECTED_SAMPLES}`,
    'T4.2 is the full golden set. Run `npm run b4:golden` without --samples.',
  );
}

if (report.status !== 'passed') {
  const failed = (report.checks ?? []).filter((check) => !check.ok);
  fail(
    `the golden run did not pass (${failed.length} failing check${failed.length === 1 ? '' : 's'})`,
    failed.map((check) => `- ${check.label} — got ${check.value}`).join('\n  '),
  );
}

const { accuracy, latency } = report;
const thresholdKeys = [
  'fieldAccuracy',
  'categoryInList',
  'balancedAverageRoundTripMs',
  'preciseAverageToUiMs',
];
const thresholdsMatch = thresholdKeys.every((key) => report.thresholds?.[key] === THRESHOLDS[key]);
if (!thresholdsMatch) {
  fail(
    'the report threshold metadata does not match the current T4.2 contract',
    'Re-run `npm run b4:golden` so the report carries the current 2.5s Balanced and 4.5s Precise limits.',
  );
}
if (
  report.product_acceptance?.balanced?.threshold_ms !== THRESHOLDS.balancedAverageRoundTripMs ||
  report.product_acceptance?.precise?.threshold_ms !== THRESHOLDS.preciseAverageToUiMs
) {
  fail(
    'the report product-acceptance metadata is incomplete or stale',
    'Re-run `npm run b4:golden` so both mode-specific latency criteria are recorded.',
  );
}
if (
  report.device_run_required !== false ||
  report.product_acceptance?.precise?.average_ms == null ||
  report.product_acceptance?.precise?.samples == null
) {
  fail(
    'the report does not include the required Precise physical-device evidence',
    'Re-run `npm run b4:golden -- --precise-average-ms N --precise-samples N` with the device result.',
  );
}
if (report.product_acceptance.precise.average_ms > THRESHOLDS.preciseAverageToUiMs) {
  fail(
    `Precise average latency is ${report.product_acceptance.precise.average_ms} ms, above ${THRESHOLDS.preciseAverageToUiMs} ms`,
    'Run another physical-device measurement; do not edit the report to force a pass.',
  );
}
if (report.thresholds?.balancedAverageRoundTripMs == null || latency.average_ms == null) {
  fail(
    'the report has no Balanced average-latency result',
    'Re-run `npm run b4:golden` with the current T4.2 harness.',
  );
}
if (latency.average_ms > THRESHOLDS.balancedAverageRoundTripMs) {
  fail(
    `Balanced average latency is ${latency.average_ms} ms, above ${THRESHOLDS.balancedAverageRoundTripMs} ms`,
    'Run the live golden set again; do not edit the report to force a pass.',
  );
}
const pct = (value) => `${(value * 100).toFixed(0)}%`;
console.log(`[b4:golden:verify] ${REPORT} — run ${report.ran_at} against ${report.project}`);
console.log(
  `  merchant ${pct(accuracy.merchant)}  date ${pct(accuracy.txn_date)}  total ${pct(accuracy.total)}` +
    `  category ${pct(accuracy.category_in_list)} in list  Balanced average ${latency.average_ms} ms` +
    `  (p50 ${latency.p50_ms} ms)`,
);
// Require the separately recorded Precise/Grok device result before the report
// can be used as the full T4.2 gate.
console.log(
  `  Precise physical average ${report.product_acceptance.precise.average_ms} ms` +
    ` over ${report.product_acceptance.precise.samples} samples`,
);
