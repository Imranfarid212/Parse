/**
 * Asserts the zero-PII property of the monitoring layer.
 *
 * The guarantee is not "we were careful at each call site" — it is that nothing
 * reaches Crashlytics or Analytics without passing through `sanitizeMessage`.
 * So this checks both halves: that the sanitiser actually redacts real-shaped
 * secrets, and that no reporting path bypasses it.
 *
 * Run: npm run verify:monitoring
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { sanitizeMessage, sanitizeParams } = await import(
  path.join(root, 'src/lib/monitoring/sanitize.ts')
);

let failures = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${label}\n       ${error.message.split('\n')[0]}`);
  }
};

/** Every one of these is a real shape this app actually handles. */
const LEAKS = [
  ['supabase access token', `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk`, ['eyJhbGciOi', 'dBjftJeZ']],
  ['email in an auth error', 'User already registered: saranya.example@gmail.com', ['saranya', '@gmail.com']],
  ['supabase user id', 'no profiles row for user 6f2c1a90-5b3e-4d88-9f21-77aa0c3e1b45', ['6f2c1a90', '77aa0c3e1b45']],
  ['token in a query string', 'GET https://x.supabase.co/auth/v1/user?apikey=sb_secret_9dK2mQ&token=abc', ['sb_secret_9dK2mQ']],
  ['named credential', 'request failed: authorization="Bearer sk-live-4829"', ['sk-live-4829']],
  ['card number', 'declined for card 4111111111111111', ['4111111111111111']],
  ['phone number', 'otp sent to 919876543210', ['919876543210']],
  ['local path with account name', 'ENOENT: /Users/afrinmalick/Desktop/Parse/receipt.jpg', ['afrinmalick']],
  ['android data path', '/data/user/0/com.imranfarid.parse/cache/x.jpg', ['com.imranfarid.parse']],
  ['app attest key id', 'key 0584af2dc42778883c9a416d2f6cae6b33f62f535891349 rejected', ['0584af2dc42778883c9a416d2f6cae6b33f62f535891349']],
];

console.log('\nsanitizeMessage redacts:');
for (const [label, input, mustNotAppear] of LEAKS) {
  check(label, () => {
    const out = sanitizeMessage(input);
    for (const secret of mustNotAppear) {
      assert.ok(!out.includes(secret), `"${secret}" survived sanitisation as: ${out}`);
    }
  });
}

console.log('\nsanitizeMessage preserves diagnostics:');
check('keeps the error name and shape', () => {
  const out = sanitizeMessage(new Error('Network request failed'));
  assert.ok(out.includes('Network request failed'), out);
  assert.ok(out.includes('Error'), out);
});
check('keeps small numbers (status, ms, counts)', () => {
  const out = sanitizeMessage('request failed with 429 after 1500 ms');
  assert.ok(out.includes('429') && out.includes('1500'), out);
});
check('caps runaway messages', () => {
  assert.ok(sanitizeMessage('x'.repeat(5000)).length <= 512);
});
check('survives a non-Error throw', () => {
  assert.equal(typeof sanitizeMessage(undefined), 'string');
  assert.equal(typeof sanitizeMessage({ a: 1 }), 'string');
  assert.equal(typeof sanitizeMessage(null), 'string');
});

console.log('\nsanitizeParams:');
check('drops non-primitives rather than stringifying them', () => {
  const out = sanitizeParams({ ok: 1, nested: { receipt: 'total 42.00' }, list: [1, 2] });
  assert.deepEqual(Object.keys(out), ['ok']);
});
check('redacts string values', () => {
  const out = sanitizeParams({ note: 'mail me at a@b.com' });
  assert.ok(!out.note.includes('a@b.com'), out.note);
});

console.log('\nno reporting path bypasses the sanitiser:');
const index = fs.readFileSync(path.join(root, 'src/lib/monitoring/index.ts'), 'utf8');
check('recordError is only ever called with a redacted Error', () => {
  const calls = [...index.matchAll(/recordError\(/g)];
  assert.equal(calls.length, 1, `expected 1 recordError call, found ${calls.length}`);
  assert.ok(index.includes('const redacted = new Error(message)'), 'redacted Error not constructed');
});
check('crashlytics log() receives a sanitised value', () => {
  assert.ok(
    /const safe = sanitizeMessage\(message\);[\s\S]*api\.log\(api\.getCrashlytics\(\), safe\)/.test(index),
    'breadcrumb path does not sanitise',
  );
});
check('analytics params go through sanitizeParams', () => {
  assert.ok(/logEvent\([\s\S]{0,200}\.\.\.sanitizeParams\(params\)/.test(index), 'event params not sanitised');
});
check('no account identifier is ever sent as the user id', () => {
  assert.ok(!/setUserId\([^)]*user(?:Id|\.id)/.test(index), 'setUserId may be receiving an account id');
  assert.ok(
    /setUserId\(instance, supportCode\)/.test(index),
    'setUserId must carry the support code: Crashlytics user-id search is exact-match, so the full uuid is unsearchable from the 6 characters a user can read out',
  );
});

console.log('\nunhandled rejections are covered:');
check('rejection tracker is installed at init', () => {
  assert.ok(/installRejectionTracker\(\);/.test(index), 'initMonitoring does not install the tracker');
  assert.ok(
    /enablePromiseRejectionTracker/.test(index),
    'tracker must re-register with Hermes: rejections never reach ErrorUtils',
  );
  assert.ok(/logSafeError\(rejection, 'global.unhandledRejection'\)/.test(index), 'rejections are not reported');
});

console.log('\nflow watchdogs:');
const flows = fs.readFileSync(path.join(root, 'src/lib/monitoring/flows.ts'), 'utf8');

check('deadlines count foreground time only', () => {
  // A wall-clock deadline reports every user who switches apps mid-flow, which
  // is ordinary behaviour -- the signal would drown in it.
  assert.ok(/AppState\.addEventListener\('change'/.test(flows), 'no AppState listener');
  assert.ok(/suspendedMs \+= Date\.now\(\) - suspendedAt/.test(flows), 'suspended time is not deducted');
  assert.ok(/if \(remaining > 0\)/.test(flows), 'deadline does not reschedule after a suspension');
});

check('reports are bounded per flow name', () => {
  assert.ok(/MAX_REPORTS_PER_FLOW/.test(flows), 'no per-flow cap');
  assert.ok(/seen >= MAX_REPORTS_PER_FLOW/.test(flows), 'cap is not enforced');
});

check('only a timeout reports; a handled ending does not', () => {
  // fail() means the caller already surfaced it. Reporting again turns one
  // incident into two records of it.
  // Anchor on the implementation, not the `Flow` type declaration above it --
  // matching the type slices in the whole deadline handler and its legitimate report.
  const failStart = flows.indexOf('fail: (reason: string) => {');
  assert.ok(failStart > 0, 'could not locate the fail() implementation');
  const failBody = flows.slice(failStart, flows.indexOf('cancel: dispose'));
  assert.ok(!/logSafeError/.test(failBody), 'fail() reports, so handled endings would double-report');
  assert.ok(/logSafeError\([\s\S]{0,200}flow\.stalled/.test(flows), 'timeout does not report');
});

// Every started flow must have a declared ending, or it silently never resolves
// -- the exact failure mode this mechanism exists to detect.
const srcFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name)) srcFiles.push(full);
  }
})(path.join(root, 'src'));

for (const file of srcFiles) {
  const text = fs.readFileSync(file, 'utf8');
  if (!/\bbeginFlow\(/.test(text) || file.endsWith('flows.ts')) continue;
  const rel = path.relative(root, file);
  check(`${rel} settles every flow it starts`, () => {
    assert.ok(
      /\.succeed\(\)|\.fail\(|settleSignInFlow\(|useStateInvariant/.test(text),
      'starts a flow but declares no ending, so it can only ever time out',
    );
  });
}

console.log('\nsilent-catch guard:');
const eslintConfig = fs.readFileSync(path.join(root, 'eslint.config.js'), 'utf8');
check('the rule is an error, not a warning', () => {
  assert.ok(
    /'monitoring\/no-silent-catch':\s*'error'/.test(eslintConfig),
    'downgraded to a warning, where it guards nothing',
  );
});

const SUPPRESSION_BASELINE = 48;
check(`suppressed violations do not exceed the baseline (${SUPPRESSION_BASELINE})`, () => {
  // A ratchet. The backlog predates the rule and may shrink freely; growing it
  // means a new silent catch was baselined instead of examined, which is the
  // one way this guard can be defeated without anyone noticing.
  const file = path.join(root, 'eslint-suppressions.json');
  const suppressions = JSON.parse(fs.readFileSync(file, 'utf8'));
  const total = Object.values(suppressions)
    .map((rules) => rules['monitoring/no-silent-catch']?.count ?? 0)
    .reduce((a, b) => a + b, 0);
  assert.ok(
    total <= SUPPRESSION_BASELINE,
    `${total} suppressed, baseline is ${SUPPRESSION_BASELINE}. Fix the new catch rather than baselining it; ` +
      'lower SUPPRESSION_BASELINE here when you burn some down.',
  );
});

console.log('\nfirebase.json privacy flags:');
const firebase = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'))['react-native'];
check('RNFirebase does not record raw JS errors alongside ours', () => {
  // Its built-in handler reports the unsanitised Error, which would defeat
  // every redaction above. Ours records the same crashes, sanitised.
  assert.equal(firebase.crashlytics_is_error_generation_on_js_crash_enabled, false);
});
for (const flag of [
  'google_analytics_adid_collection_enabled',
  'google_analytics_ssaid_collection_enabled',
  'google_analytics_default_allow_ad_personalization_signals',
  'google_analytics_default_allow_ad_user_data',
  'google_analytics_default_allow_ad_storage',
]) {
  check(`${flag} is off`, () => assert.equal(firebase[flag], false));
}

console.log(failures === 0 ? '\nverify-monitoring: PASS\n' : `\nverify-monitoring: ${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
