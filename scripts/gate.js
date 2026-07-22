const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const phase = process.argv[2]?.toLowerCase();
const root = path.resolve(__dirname, '..');

if (!['b1', 'b2', 'b3'].includes(phase)) {
  console.error('Usage: npm run gate -- b1|b2|b3');
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
        : 'Local B3 static capture/offline queue checks passed. Official evidence still requires device capture/gallery/offline retry verification.',
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
