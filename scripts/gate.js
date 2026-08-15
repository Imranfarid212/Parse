const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const phase = process.argv[2]?.toLowerCase();
const root = path.resolve(__dirname, '..');

if (!['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'].includes(phase)) {
  console.error('Usage: npm run gate -- b1|b2|b3|b4|b5|b6|b7|b8');
  process.exit(1);
}

const startedAt = Date.now();
const testsByPhase = {
  b1: [
    {
      id: 'T1.frontend-static',
      command: ['npm', ['run', 'b1:app']],
    },
    {
      id: 'T1.backend-static',
      command: ['npm', ['run', 'b1:backend']],
    },
    {
      id: 'T1.1-db-reset',
      command: ['npm', ['run', 'b1:db:reset']],
    },
    {
      id: 'T1.2-db-drift',
      command: ['npm', ['run', 'b1:db:verify']],
    },
  ],
  b2: [
    {
      id: 'T2.frontend-static',
      command: ['npm', ['run', 'b2:app']],
    },
    {
      id: 'T2.backend-static',
      command: ['npm', ['run', 'b2:backend']],
    },
    {
      id: 'T2.db-reset',
      command: ['npm', ['run', 'b2:db:reset']],
    },
    {
      id: 'T2.1-T2.5-db-verify',
      command: ['npm', ['run', 'b2:db:verify']],
    },
  ],
  b3: [
    {
      id: 'T3.1-compress-orientation',
      command: ['npm', ['run', 'b3:app']],
    },
    {
      id: 'T3.2-enqueue-all-modes',
      command: ['npm', ['run', 'b3:app']],
    },
    {
      id: 'T3.3-reconnect-drain',
      command: ['npm', ['run', 'b3:app']],
    },
    {
      id: 'T3.4-backend-idempotency',
      command: ['npm', ['run', 'b3:backend']],
    },
    {
      id: 'T3.5-ack-gate-retention',
      command: ['npm', ['run', 'b3:db:verify']],
    },
  ],
  b4: [
    {
      id: 'T4.1-validate-repair-reject-misc',
      command: ['npm', ['run', 'b4:backend']],
    },
    {
      // Checks the committed golden report rather than grepping source for
      // readiness. The run itself is `npm run b4:golden` — 20 live model calls,
      // done deliberately, the way the playbook treats a scripted test. The gate
      // reads its result and refuses a report whose code has since changed, so
      // the evidence is real without every gate check costing 20 calls.
      // The harness covers the Balanced 20-case accuracy and average-latency
      // gate. The report also carries the operator-supplied Precise/Grok
      // physical image-path result.
      id: 'T4.2-golden-latency',
      command: ['npm', ['run', 'b4:golden:verify']],
    },
    {
      // Runs can_scan against a real database rather than grepping the
      // migration for it. b4:backend still covers this phase's source checks
      // under T4.1 and T4.4; idempotency is a runtime claim, so it is tested at
      // runtime — the ambiguity bug that broke every scan was invisible to a
      // source check and obvious the moment anything executed the function.
      id: 'T4.3-quota-idempotency',
      command: ['npm', ['run', 'b4:db:verify']],
    },
    {
      id: 'T4.4-ack-gate-server',
      command: ['npm', ['run', 'b4:backend']],
    },
    {
      id: 'T4.5-mode-e2e-source-readiness',
      command: ['npm', ['run', 'b4:app']],
    },
  ],
  // B5 and B6 shipped on their verify scripts without ever being added here.
  // They are wired up in B7 so `gate all` means something; the phases whose
  // evidence needs staging still say so in the note rather than pretending the
  // local run covers them.
  b5: [
    {
      id: 'T5.1-T5.3-fallback-jobs-breaker-source',
      command: ['npm', ['run', 'b5:backend']],
    },
    {
      id: 'T5.2-durable-jobs-db',
      command: ['npm', ['run', 'b5:db:verify']],
    },
  ],
  b6: [
    {
      id: 'T6.1-T6.4-management-app',
      command: ['npm', ['run', 'b6:app']],
    },
    {
      id: 'T6.1-T6.5-management-backend',
      command: ['npm', ['run', 'b6:backend']],
    },
  ],
  b7: [
    {
      // Static readiness for the Export screen, the shared filter sheet and the
      // client job library.
      id: 'T7.4-export-ui-progress-and-retry',
      command: ['npm', ['run', 'b7:app']],
    },
    {
      id: 'T7.1-T7.5-export-backend-source',
      command: ['npm', ['run', 'b7:backend']],
    },
    {
      // The builders, the job runner and the request validator, run for real:
      // the workbook is parsed back with SheetJS and the PDFs with a text
      // extractor, so these assert what the user will open.
      id: 'T7.1-T7.3-export-builders',
      command: ['npm', ['run', 'b7:builders']],
    },
    {
      // The job lifecycle against a live database: the lease, the retry budget,
      // the concurrency cap, and the proof that an export reads exactly what
      // search reads.
      id: 'T7.4-export-jobs-db',
      command: ['npm', ['run', 'b7:db:verify']],
    },
    {
      // The whole path: seed, export, download, diff against SQL — including
      // the 1,000-receipt run and the chunked images PDF.
      id: 'T7.1-T7.5-export-end-to-end',
      command: ['npm', ['run', 'b7:e2e']],
    },
  ],
  b8: [
    {
      // Keys, prices, entitlement wiring, paywall routing and the deletion
      // interstitial's compliance copy.
      id: 'T8.1-T8.3-T8.5-monetization-app-source',
      command: ['npm', ['run', 'b8:app']],
    },
    {
      // The webhook, the deletion path, and — the one that matters — proof
      // that the product catalogue in SQL and in contracts are the same list.
      id: 'T8.1-T8.5-monetization-backend-source',
      command: ['npm', ['run', 'b8:backend']],
    },
    {
      // The RevenueCat translation layer under Deno: store mapping, Play base
      // plan suffixes, which events may move the quota window, refund signs.
      id: 'T8.2-T8.4-revenuecat-mapping',
      command: ['npm', ['run', 'b8:deno']],
    },
    {
      // The money paths against a live database: the quota matrix across both
      // tiers and the renewal boundary, 10-parallel no-double-spend, webhook
      // replay, refund reversal, a deleted user's late event, and the
      // clock-mocked five-year purge.
      id: 'T8.2-T8.4-T8.5-monetization-db',
      command: ['npm', ['run', 'b8:db:verify']],
    },
  ],
};

const tests = testsByPhase[phase];

const results = [];
let failed = false;

for (const test of tests) {
  const testStartedAt = Date.now();
  const [command, args] = test.command;
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  const status = result.status === 0 ? 'passed' : 'failed';

  results.push({
    id: test.id,
    status,
    duration_ms: Date.now() - testStartedAt,
  });

  if (status === 'failed') failed = true;
}

const report = {
  phase,
  status: failed ? 'failed' : 'passed_local_backend',
  note:
    phase === 'b1'
      ? 'Local B1 app/backend/db checks passed. Official playbook 5/5 still requires device smoke runs and CI lock proof.'
      : phase === 'b2'
        ? 'Local B2 static/backend/db checks passed. Official playbook 5/5 still requires OTP device flow plus Apple/Google manual evidence.'
        : phase === 'b3'
          ? 'Local B3 static capture/offline queue checks passed. Official evidence still requires device capture/gallery/offline retry verification.'
          : phase === 'b4'
            ? 'Local B4 checks passed. T4.2 uses the live Balanced average-latency gate plus the Precise/Grok physical image-path result.'
            : phase === 'b5'
              ? 'Local B5 source and durable-job database checks passed. The breaker, probe and sweeper-cron evidence is the staging HTTP suite (b5:http:verify, b5:breaker:verify, b5:probe:verify, b5:sweeper-cron:verify).'
              : phase === 'b6'
                ? 'Local B6 static app/backend checks passed. Ranked-search latency and two-session convergence evidence is b6:staging plus the device audit.'
                : phase === 'b7'
                ? 'Local B7 checks passed: builders and job runner under Deno, the job lifecycle against a live database, and a full seed-export-download-diff run including the 1,000-receipt and chunked-images cases. Deploying the export function to staging and opening a mixed-currency file on-device remains the manual integration step.'
                  : 'Local B8 checks passed: catalogue parity between SQL and contracts, the RevenueCat mapping layer, and the money paths against a live database (quota matrix, no-double-spend, replay, refund reversal, tombstoned events, clock-mocked five-year purge). T8.1 and T8.3 need sandbox purchases on both platforms and T8.5 needs a full deletion on staging — all four blocked on store accounts that do not exist yet (docs/B8-store-runbook.md).',
  duration_ms: Date.now() - startedAt,
  commit_sha: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
  tests: results,
};

const reportPath = path.join(root, 'gates', `report-${phase}.json`);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (failed) {
  console.error(`GATE ${phase.toUpperCase()} - FAILED local checks`);
  process.exit(1);
}

console.log(`GATE ${phase.toUpperCase()} - PASSED local checks; official device/manual evidence still pending`);
