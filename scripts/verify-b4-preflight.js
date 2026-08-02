/**
 * B4 — the on-device "is this a receipt" check, exercised as a pure function.
 *
 * scoreReceiptPreflight() decides whether a capture is worth a paid model call.
 * It runs in both Balanced and Precise now, so a regression here either sends
 * walls to the model or starts warning on real receipts — and until it was
 * lifted out of capture.ts the only way to test it was to point a phone at
 * something.
 *
 * Loaded through Node's type stripping, which works only because the module has
 * no imports; keep it that way.
 *
 * Run: node --experimental-strip-types scripts/verify-b4-preflight.js
 */
const path = require('path');

const root = path.resolve(__dirname, '..');
const MODULE_PATH = path.join(root, 'src', 'lib', 'receipts', 'preflight.ts');

const failures = [];

function check(label, condition, detail) {
  if (condition) return;
  failures.push(detail ? `${label} — ${detail}` : label);
}

/** A warning means "we would interrupt the user"; null means "send it". */
function describe(warning) {
  return warning === null ? 'no warning' : `${warning.confidence} warning`;
}

function expectWarned(score, label, text, { hasDocument = true, timedOut = false, confidence } = {}) {
  const warning = score(text, hasDocument, timedOut);
  check(label, warning !== null, `expected a warning, got none (text length ${(text ?? '').trim().length})`);
  if (warning && confidence) {
    check(`${label} confidence`, warning.confidence === confidence, `expected ${confidence}, got ${warning.confidence}`);
  }
  return warning;
}

function expectAccepted(score, label, text, { hasDocument = true, timedOut = false } = {}) {
  const warning = score(text, hasDocument, timedOut);
  check(label, warning === null, `expected it to pass, got ${describe(warning)}`);
  return warning;
}

// A short but unmistakable receipt: two money-shaped numbers.
const RECEIPT = ['BLUE BOTTLE COFFEE', 'Latte        4.50', 'Total        4.50'].join('\n');

// Real-world shapes that must not be interrupted.
const HANDWRITTEN = ['ramesh general store', 'rice 250.00', 'oil 180.00', 'total 430.00'].join('\n');
const KEYWORD_ONLY = 'INVOICE / BILL — subtotal tax total due on receipt';
const LONG_PROSE = 'lorem ipsum dolor sit amet, '.repeat(12);
// 218 characters of key legends: the shape that got through on the device.
const KEYBOARD =
  'esc F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12 ~ 1 2 3 4 5 6 7 8 9 0 - = delete tab Q W E R T Y U I O P [ ] \\ ' +
  "caps A S D F G H J K L ; ' return shift Z X C V B N M , . / shift fn control option command space command option";

// Shapes that should be caught before a model is paid for them.
const WALL = '';
const BLURRED = 'iiii ll';
const SIGNAGE = 'PLATFORM 4 — TRAINS TO CENTRAL';

async function main() {
  const module = await import(MODULE_PATH);
  const score = module.scoreReceiptPreflight;
  if (typeof score !== 'function') {
    throw new Error('[b4:preflight] scoreReceiptPreflight is not exported from src/lib/receipts/preflight.ts');
  }

  // --- must pass through: a false warning on a real receipt is the costlier bug
  expectAccepted(score, 'plain receipt', RECEIPT);
  expectAccepted(score, 'handwritten shop bill', HANDWRITTEN);
  expectAccepted(score, 'receipt vocabulary without amounts', KEYWORD_ONLY);
  expectAccepted(score, 'one amount plus one keyword', 'Total 12.99');
  expectAccepted(score, 'rupee amounts', '₹250.00 and ₹180.00');
  expectAccepted(score, 'comma decimal separator', '12,50 and 4,00');
  // Deliberately reclassified: a page with no amount and no receipt word is not
  // a receipt at any length, and the old length ceiling made it a paid call.
  expectWarned(score, 'long prose with no money', LONG_PROSE, { confidence: 'uncertain' });
  expectWarned(score, 'photo of a keyboard', KEYBOARD, { confidence: 'uncertain' });
  // OCR timing out is not evidence either way; the framed page still carries.
  expectAccepted(score, 'timed out on a real receipt', RECEIPT, { timedOut: true });

  // --- must warn
  expectWarned(score, 'photo of a wall', WALL, { hasDocument: false, confidence: 'low' });
  expectWarned(score, 'null OCR result', null, { hasDocument: false, confidence: 'low' });
  expectWarned(score, 'blurred nothing', BLURRED, { hasDocument: false, confidence: 'low' });
  expectWarned(score, 'signage with no money', SIGNAGE, { confidence: 'low' });
  expectWarned(score, 'short page, one keyword, no amounts', 'Amount enclosed for the year', {
    confidence: 'uncertain',
  });

  // --- the boundary that separates "low" from "uncertain"
  // A detected document is the only reason a near-empty frame is not 'low'.
  const framedEmpty = score('', true, false);
  check('framed empty page still warns', framedEmpty !== null, 'expected a warning for a framed blank page');

  // --- the warning must carry the counts the prompt shows the user
  const shape = expectWarned(score, 'warning shape', SIGNAGE);
  if (shape) {
    for (const key of ['confidence', 'textLength', 'amountCount', 'keywordCount', 'hasDocument', 'timedOut']) {
      check(`warning carries ${key}`, key in shape, `missing ${key}`);
    }
    check('textLength is trimmed length', shape.textLength === SIGNAGE.trim().length);
    check('hasDocument is echoed back', shape.hasDocument === true);
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`[b4:preflight] FAIL ${failure}`);
    console.error(`[b4:preflight] ${failures.length} check(s) failed`);
    process.exit(1);
  }

  console.log('[b4:preflight] receipt heuristic verified — real receipts pass, blank frames warn');
}

main().catch((error) => {
  console.error(`[b4:preflight] ${error.message}`);
  process.exit(1);
});
