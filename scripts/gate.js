const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const phase = process.argv[2]?.toLowerCase();
const root = path.resolve(__dirname, '..');

if (phase !== 'b1') {
  console.error('Usage: npm run gate -- b1');
  process.exit(1);
}

const startedAt = Date.now();
const tests = [
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
];

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
  phase: 'b1',
  status: failed ? 'failed' : 'passed_local_backend',
  note: 'Local B1 app/backend/db checks passed. Official playbook 5/5 still requires device smoke runs and CI lock proof.',
  duration_ms: Date.now() - startedAt,
  commit_sha: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
  tests: results,
};

const reportPath = path.join(root, 'gates', 'report-b1.json');
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (failed) {
  console.error('GATE B1 - FAILED local static checks');
  process.exit(1);
}

console.log('GATE B1 - PASSED local app/backend/db checks; official 5/5 still pending device smoke and CI lock proof');
