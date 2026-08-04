/**
 * Identifies the code a golden run was produced by.
 *
 * The gate no longer re-runs T4.2 — 20 live model calls on every gate check is
 * a cost nobody asked for — so it trusts a committed report instead. That is
 * only safe if the report cannot outlive the code it describes: otherwise B4
 * passes on evidence from a build that no longer exists.
 *
 * A commit SHA alone is not enough. Branches move, reports get rebased forward,
 * and a SHA tells you when the run happened rather than what it ran against. So
 * the run records a hash of the files that can actually change the answers, and
 * the verifier recomputes it. Edit the prompt, the schema, the category rules or
 * the fixtures, and the fingerprint stops matching — the report is stale by
 * definition and the gate says so.
 *
 * Not covered on purpose: the model itself, its weights, and XAI_MODEL. Nothing
 * in the repo can detect a provider-side change, which is the honest reason the
 * report also carries `ran_at` — a fingerprint match is not a promise the answer
 * would be the same today.
 *
 * Not covered, and worth knowing: this hashes the source in the working tree,
 * while the run itself hits whatever is *deployed* to staging. Edit an edge
 * function without deploying it and the fingerprint will happily match a report
 * produced by the old code. It catches "the source moved after the run"; it
 * cannot catch "the source never reached the server". Deploy before you re-run,
 * or the report describes something that is not running anywhere.
 */
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const root = path.resolve(__dirname, '..', '..');

/** Everything whose contents can move the accuracy or latency numbers. */
const FINGERPRINTED = [
  'supabase/functions/extract-balanced/index.ts', // the prompt and the whole path
  'supabase/functions/_shared/categories.ts', // the offered list and the Miscellaneous fallback
  'supabase/functions/_shared/quota.ts', // sits on the critical path being timed
  'packages/contracts/src/schemas.ts', // what counts as a valid extraction
  'scripts/lib/golden-set.js', // the fixtures, the answer key, the thresholds and the matching rules
];
// Deliberately absent: scripts/golden-b4.js. It drives the run but does not
// decide the answers, and pinning it would make a reworded log line cost twenty
// live model calls. Anything in it that does affect a score belongs in
// golden-set.js instead.

function sourceFingerprint() {
  const hash = createHash('sha256');
  const files = [];
  for (const relPath of FINGERPRINTED) {
    const absolute = path.join(root, relPath);
    // A missing file is a fingerprint change, not a crash: renaming the
    // function out from under a committed report must invalidate it.
    const contents = fs.existsSync(absolute) ? fs.readFileSync(absolute) : Buffer.from('<absent>');
    const fileHash = createHash('sha256').update(contents).digest('hex');
    hash.update(`${relPath}:${fileHash}\n`);
    files.push({ path: relPath, sha256: fileHash });
  }
  return { combined: hash.digest('hex'), files };
}

module.exports = { FINGERPRINTED, sourceFingerprint };
