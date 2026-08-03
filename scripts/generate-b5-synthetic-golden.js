/**
 * Renders the existing B4 canonical receipt text into deterministic JPEGs for
 * the B5 Gemini vision fallback run. The output lives under tmp so it remains
 * test data, not a pretend real-camera corpus.
 *
 * Run: node scripts/generate-b5-synthetic-golden.js [--out tmp/b5-synthetic-golden]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { GOLDEN } = require('./lib/golden-set');

const root = path.resolve(__dirname, '..');

function outputDirectory(argv) {
  const index = argv.indexOf('--out');
  if (index === -1) return path.join(root, 'tmp/b5-synthetic-golden');
  if (!argv[index + 1]) throw new Error('--out requires a directory');
  return path.resolve(root, argv[index + 1]);
}

function main() {
  const out = outputDirectory(process.argv.slice(2));
  fs.mkdirSync(out, { recursive: true });
  execFileSync('swift', [path.join(__dirname, 'render-b5-receipts.swift'), out], {
    input: JSON.stringify(GOLDEN.map(({ id, text }) => ({ id, text }))),
    stdio: ['pipe', 'inherit', 'inherit'],
    // Swift otherwise writes its module cache in a sandboxed user directory.
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: process.env.CLANG_MODULE_CACHE_PATH ?? '/private/tmp/receiptflow-clang-cache',
      SWIFT_MODULECACHE_PATH: process.env.SWIFT_MODULECACHE_PATH ?? '/private/tmp/receiptflow-swift-cache',
    },
  });
  const manifest = GOLDEN.map((testCase) => ({ id: testCase.id, image: `${testCase.id}.jpg`, expect: testCase.expect }));
  fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify({ kind: 'synthetic-rendered-text', cases: manifest }, null, 2)}\n`);
  console.log(`[b5:synthetic] rendered ${manifest.length} exact-text receipt JPEGs in ${out}`);
}

main();
