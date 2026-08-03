/** Aggregates bounded live Gemini slices into the complete T5.5 result. */
const fs = require('fs');
const path = require('path');
const { THRESHOLDS, GOLDEN } = require('./lib/golden-set');

const root = path.resolve(__dirname, '..');
const dir = path.resolve(root, process.argv[2] ?? 'tmp/b5-gemini-chunks');
const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json')).sort();
const reports = files.map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
const samples = reports.flatMap((report) => report.samples ?? []);
const unique = new Map(samples.map((sample) => [sample.id, sample]));
const rate = (field) => samples.length ? samples.filter((sample) => sample.match?.[field]).length / samples.length : 0;
const checks = [
  ['all 20 canonical cases exactly once', unique.size === GOLDEN.length && samples.length === GOLDEN.length, `${unique.size}/${samples.length}`],
  ['merchant exact >= 90%', rate('merchant') >= THRESHOLDS.fieldAccuracy, rate('merchant')],
  ['txn_date exact >= 90%', rate('txn_date') >= THRESHOLDS.fieldAccuracy, rate('txn_date')],
  ['total exact >= 90%', rate('total') >= THRESHOLDS.fieldAccuracy, rate('total')],
  ['category always in list', rate('category_in_list') >= THRESHOLDS.categoryInList, rate('category_in_list')],
  ['Gemini recorded for every image fallback', rate('provider') === 1, rate('provider')],
  ['every sample returned 200', samples.every((sample) => sample.status === 200), samples.filter((sample) => sample.status === 200).length],
];
const report = {
  test: 'T5.5-forced-gemini-synthetic-vision-golden',
  corpus: 'synthetic rendered receipt text; does not measure camera-photo robustness',
  reports: files,
  accuracy: { attempted: samples.length, merchant: rate('merchant'), txn_date: rate('txn_date'), total: rate('total'), category_in_list: rate('category_in_list'), provider_recorded: rate('provider') },
  checks: checks.map(([label, ok, value]) => ({ label, ok, value })),
  status: checks.every(([, ok]) => ok) ? 'passed' : 'failed',
};
const out = path.join(dir, 'report.json');
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(`[b5:gemini] ${report.status.toUpperCase()} - ${out}`);
for (const [label, ok, value] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label} (${value})`);
if (report.status !== 'passed') process.exitCode = 1;
