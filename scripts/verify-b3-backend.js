const fs = require('fs');
const path = require('path');

const { rewriteRelativeImports } = require('./contracts-sync');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function fail(message) {
  throw new Error(`[b3:backend] ${message}`);
}

function includes(source, needle, label) {
  if (!source.includes(needle)) fail(`${label}: expected ${JSON.stringify(needle)}`);
}

const fn = read('supabase/functions/extract/index.ts');
const schemas = read('packages/contracts/src/schemas.ts');
const mirrorSchemas = read('supabase/functions/_shared/contracts/schemas.ts');
const fixtures = read('packages/contracts/src/fixtures.ts');

includes(schemas, 'extractAckSchema', 'contracts ack schema');
includes(schemas, 'image_path', 'contracts ack image path');
includes(schemas, 'acked_at', 'contracts ack timestamp');
// Compared through the same rewrite contracts:sync applies, because the mirror
// is deliberately not byte-identical any more: Deno needs .ts on relative
// import specifiers and the app must not have them.
if (rewriteRelativeImports(schemas) !== mirrorSchemas) fail('contracts mirror differs; run npm run contracts:sync');
includes(fixtures, 'extractRequestFixture', 'extract request fixture');
includes(fixtures, 'extractionResultFixture', 'fixture result');

includes(fn, "Deno.serve", 'extract function server');
// Client variable name is not part of the contract — B4 renamed it to
// `userSupabase`, which silently broke this check.
includes(fn, '.auth.getUser()', 'JWT check');
includes(fn, ".get('capture_id')", 'capture_id form field');
includes(fn, ".get('mode')", 'mode form field');
includes(fn, ".get('captured_at')", 'captured_at form field');
includes(fn, ".get('image')", 'image form field');
includes(fn, "x-rf-force-storage-failure", 'forced storage failure drill');
includes(fn, "storage.from('receipts').upload", 'Storage write before ack');
includes(fn, "imagePath = `${userId}/${captureId}.jpg`", 'owner-scoped storage path');
includes(fn, ".from('receipts')", 'receipts upsert');
includes(fn, "upsert(", 'idempotent duplicate capture upsert');
includes(fn, "{ onConflict: 'capture_id' }", 'duplicate capture id conflict target');
// Was a flat fixture literal in the B3 stub; B4 made it the real mode split.
includes(fn, "'needs_review'", 'default-mode captures land in needs_review');
includes(fn, "return json(200", 'ack response after durable writes');

/**
 * The ack gate on the Precise path: a Storage failure must not produce a 200.
 *
 * This replaces three `indexOf` calls that claimed to prove the ordering
 * "upload -> receipts upsert -> 200". They never did. Once `extract` grew more
 * than one response path, the first `.upsert(` in the file was the one on
 * duplicate_shadow_events (line ~775) and the first `return json(200` was the
 * warm-up reply (line ~958) — neither on the ack path, and both textually ahead
 * of the upload at ~1161. The check was comparing three unrelated sites and
 * reporting on file layout rather than control flow.
 *
 * Text order cannot prove execution order in a file where helpers are defined
 * above the handler that calls them. So this asserts the thing the guarantee
 * actually rests on, which is local and readable: the handler waits for the
 * Storage write, and a failed write returns an error before any success
 * response. Ordering is only claimed within the one linear region after the
 * upload is awaited, where it means something.
 *
 * DL-002 makes this rule Precise-specific. Balanced never receives the image and
 * is asserted separately in b4:backend.
 */
includes(
  fn,
  'const [{ error: uploadError }, extraction] = await Promise.all([\n    storagePromise,\n    grokPromise,\n  ]);',
  'ack waits for the Storage write',
);
includes(fn, 'if (uploadError) return json(503,', 'a failed Storage write returns an error, not an ack');

const gateIndex = fn.indexOf('const [{ error: uploadError }, extraction] = await Promise.all([');
const guardIndex = fn.indexOf('if (uploadError) return json(503,', gateIndex);
const firstAckIndex = fn.indexOf('return json(200', gateIndex);
if (gateIndex === -1 || guardIndex === -1 || firstAckIndex === -1 || guardIndex > firstAckIndex) {
  fail('the Storage failure guard must come before any 200 on the ack path');
}

console.log('[b3:backend] extract ack semantics verified (Precise path; see DL-002)');
