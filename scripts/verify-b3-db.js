const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function fail(message) {
  throw new Error(`[b3:db] ${message}`);
}

function includes(source, needle, label) {
  if (!source.includes(needle)) fail(`${label}: expected ${JSON.stringify(needle)}`);
}

const b1 = read('supabase/migrations/20260719000100_b1_foundations.sql');
const b3 = read('supabase/migrations/20260722000100_b3_capture_offline_queue.sql');

includes(b1, 'capture_id uuid not null unique', 'T3.4 duplicate capture_id idempotency base');
includes(b1, "insert into storage.buckets", 'receipts bucket');
includes(b1, "bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]", 'owner path storage policy');
includes(b3, 'image_byte_size int', 'B3 image byte size');
includes(b3, 'acked_at timestamptz', 'B3 ack timestamp');
includes(b3, 'receipts_user_capture_id_idx', 'B3 capture index');
includes(b3, '"receipt images owner update"', 'B3 owner update policy');
includes(b3, 'grant insert, update, select on public.receipts to authenticated', 'B3 authenticated receipts grants');

console.log('[b3:db] storage policy and receipt ack schema verified');
