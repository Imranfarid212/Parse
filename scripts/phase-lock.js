const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const eventPath = process.env.GITHUB_EVENT_PATH;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const phases = readJson(path.join(root, 'gates', 'phases.json'));
const event = eventPath && fs.existsSync(eventPath) ? readJson(eventPath) : {};
const labels = event.pull_request?.labels?.map((label) => label.name) ?? [];
const phaseLabels = labels.filter((label) => /^phase:b\d+$/i.test(label));

if (phaseLabels.length === 0) {
  console.log('[phase-lock] no phase label present; skipping phase lock');
  process.exit(0);
}

const lockedLabels = phaseLabels.filter((label) => {
  const phaseNumber = Number(label.toLowerCase().replace('phase:b', ''));
  if (phaseNumber <= 1) return false;

  for (let current = 1; current < phaseNumber; current += 1) {
    if (phases[`b${current}`]?.state !== 'passed') return true;
  }

  return false;
});

if (lockedLabels.length > 0) {
  console.error(
    `[phase-lock] blocked ${lockedLabels.join(', ')} because earlier phases are not marked passed in gates/phases.json`,
  );
  process.exit(1);
}

console.log(`[phase-lock] allowed ${phaseLabels.join(', ')}`);
