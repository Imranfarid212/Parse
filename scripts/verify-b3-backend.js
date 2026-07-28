const fs = require('fs');
const path = require('path');

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
if (schemas !== mirrorSchemas) fail('contracts mirror differs; run npm run contracts:sync');
includes(fixtures, 'extractRequestFixture', 'extract request fixture');
includes(fixtures, 'extractionResultFixture', 'fixture result');

includes(fn, "Deno.serve", 'extract function server');
includes(fn, 'supabase.auth.getUser()', 'JWT check');
includes(fn, "form.get('capture_id')", 'capture_id form field');
includes(fn, "form.get('mode')", 'mode form field');
includes(fn, "form.get('captured_at')", 'captured_at form field');
includes(fn, "form.get('image')", 'image form field');
includes(fn, "x-rf-force-storage-failure", 'forced storage failure drill');
includes(fn, "storage.from('receipts').upload", 'Storage write before ack');
includes(fn, "imagePath = `${userId}/${captureId}.jpg`", 'owner-scoped storage path');
includes(fn, ".from('receipts')", 'receipts upsert');
includes(fn, "upsert(", 'idempotent duplicate capture upsert');
includes(fn, "{ onConflict: 'capture_id' }", 'duplicate capture id conflict target');
includes(fn, "status: 'needs_review'", 'fixture receipt state');
includes(fn, "return json(200", 'ack response after durable writes');

const uploadIndex = fn.indexOf("storage.from('receipts').upload");
const upsertIndex = fn.indexOf(".upsert(");
const responseIndex = fn.indexOf('return json(200');
if (uploadIndex === -1 || upsertIndex === -1 || responseIndex === -1 || uploadIndex > upsertIndex || upsertIndex > responseIndex) {
  fail('ack order must be Storage upload -> receipts upsert -> 200 response');
}

console.log('[b3:backend] extract v0 ack semantics verified');
