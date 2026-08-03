# B4 — what is left

Written to be picked up cold in a new thread. Branch
`feat/b4-extraction-fast-path`, pushed, PR
[#11](https://github.com/Imranfarid212/Parse/pull/11) green. Staging project
`receiptflow-staging` (`wfboznibkhsfxteejxco`) runs the current migration and
both edge functions.

For what was built and verified, see `docs/B4-rate-limit-handover.md`. This
document is only the remainder.

---

## 1. The item that actually closes the phase

**The live Grok golden/latency run and the device mode runs.**

`gates/report-b4.json` says so itself: *"Official evidence still requires live
Grok golden/latency and device mode runs."* T4.2 and T4.5 are named
`golden-latency-source-readiness` and `mode-e2e-source-readiness` and both just
run `npm run b4:app` — a grep over files. Nothing about them executes a model or
a device.

T4.3 was in exactly this state until it was pointed at `b4:db:verify`, so the
pattern for fixing one exists. Everything else in this document can be deferred;
this cannot, because it is the phase's own definition of done.

---

## 2. 4.5 — the image-durability contract

**Status: investigated, not started. Three assertions currently red.**

This is the only pending item with failing gate assertions attached, so it is the
one holding a visible red mark against the phase.

### What the original contract was

B3 was photo-first. `extract` received the image, and the order was **Storage
upload → receipts upsert → 200**. By the time the client was acked the image was
durably stored, so the client could delete its local copy immediately. Two gate
assertions encode exactly that:

- `b3:backend` — *"ack order must be Storage upload -> receipts upsert -> 200
  response"*
- `b3:app` T3.5 — *"delete after capture ack"* and *"delete after retry ack"*,
  each matching a literal source snippet in `capture.ts`

### Why it no longer holds

Balanced is text-first. It posts OCR text, so the server never receives the image
and cannot store it before acking. The client uploads afterwards, through
`extract` with `upload_only=1`, and only deletes its local copy once that
confirms (`imageSyncStatus: 'uploaded'`). The old assertions are not stale —
they are correctly objecting that the rule changed and was never rewritten.

**Do not make them green by rewriting the assertions.** Redefine the rule first,
implement it, then encode the new rule. The original was written for a design
that no longer exists; expect to replace it rather than restore it.

### The two exposures, confirmed in code

**A permanently failed upload is invisible.** `upload_failed_final` is set in
exactly one place, `capture.ts:908`, after `MAX_IMAGE_BACKUP_ATTEMPTS` (5). It is
read **nowhere** — no query, no label, no UI. So a receipt whose image never
uploads sits with a path to nothing, the user is never told, and nothing retries.
The local file does survive, so a retry would work if anything offered one.

**The server advertises a path for an object it does not have.**
`extract-balanced` returns `image_path: ${userId}/${captureId}.jpg` in its 200,
before any upload. `server-sync.ts` reads that into `remoteImagePath`, so a
second device gets a dead link until the first device's background upload lands —
or permanently, if it fails.

Useful thing found while investigating: the `upload_only` path in
`extract/index.ts:1004` **already** sets `image_path` on the receipt row after a
successful upload. So the server does record the path correctly once the object
exists. The defect is narrower than it looks — it is only the *initial* Balanced
response claiming a path prematurely.

### Suggested shape (not agreed, not built)

1. **Stop advertising a path that does not resolve.** Balanced returns
   `image_path: null`; the `upload_only` path already fills it in on success. Any
   consumer then either has a real object or nothing, never a dead link.
2. **Surface `upload_failed_final`** in Search with a Try again, the same
   treatment `blocked_quota` and `llm_failed_final` already have. The local photo
   is still on the device, so the retry genuinely works.
3. **Then rewrite the two T3.5 assertions** to encode the new rule — *the local
   copy is deleted only once the upload is confirmed* — which is what the code
   already does via the `imageSyncStatus: 'uploaded'` branch. They go green
   because the rule is true and stated, not because the check was weakened.

---

## 3. Smaller pending items

**8.3 — single-device enforcement.** Agreed, not built. Takeover rather than a
hard block, because a hard block locks a user out of their own data when a phone
is lost. Build `user_devices` (user_id, device_id, last_seen_at, is_active)
rather than a column on `profiles`, so relaxing to multi-device later is a policy
change and not a migration. Must be enforced in the edge functions.

**8.4 — line-item sync.** Items are flattened to text before reaching the device,
so item edits cannot be pushed. Closing it means carrying structured line items
through the extract contract and turning the item editor into rows with quantity
and amount. Needs a decision-log entry.

**4.6 — camera capture failures.** Five hardware-level capture errors appeared in
device logs, cause unknown, rapid shutter taps suspected. **Worth re-checking
now**: rapid capture was impossible when that was written and is now possible in
both One-click and Precise. The errors are also no longer swallowed — a failed
capture shows a notice and logs `[capture] failed`.

---

## 4. Found during this work, not on anyone's list

**The duplicate check costs ~400 ms on the critical path.** Measured:
`findDuplicateCandidate` runs strictly after the model returns
(`extract-balanced/index.ts:1203`). The phone already runs its own
`findLocalDuplicateCandidate` before dispatch, so the server's may not need to be
synchronous — it could ride the background persist. Clear route off the critical
path; nobody has asked for it.

**Every request lands on a cold isolate.** `req_count: 1` and
`isolate_age_ms: 6` on every sample. The first database round trip from a fresh
isolate costs 250–1360 ms and *everything* pays it — quota, categories, reserve
and duplicate all move together. This, not any individual query, is where the
pre-model time goes. Run `node scripts/measure-b4-timing.js 5` to reproduce
(spends one model call per sample; not in any gate).

**The model's `is_receipt` verdict is not deterministic.** The same passage of
prose was rejected on one run and accepted on the next. This is why the on-device
pre-check is the *deterministic* guard and not merely a cost saving — worth
remembering before anyone trims it. A rejected capture is deleted outright by
design; there is no row and no retry, which is a deliberate decision.

**`auth.admin.deleteUser` returns 500 for users that have receipts.** Every
foreign key cascades or nulls and a direct SQL delete works instantly, so the
cause is unexplained. The test harnesses retry and then fall back to SQL. It will
matter when account deletion is built.

---

## 5. Process items

- No decision-log entry for the Balanced/Precise split. The playbook requires one
  for anything not in the original documents.
- Phase tracking still reports B1 in progress; the CI job meant to enforce phase
  ordering was never built.
- **B5 needs a decision before it starts.** All five of its planned tests assume
  the original delayed-response, circuit-breaker and sweeper design. The app now
  uses a client-side visible-deadline approach instead. Decide whether B5 builds
  the original design, formalises the current one, or both — so its tests get
  rewritten deliberately rather than discovered as failures.

---

## 6. One small thing worth doing first

`b4:all` runs `b3:db:verify`, not `b1:db:verify`. Today's CI failure — stale
`db.types.ts` after the 1 August schema change — was invisible locally for
exactly that reason and only appeared on push. Adding `b1:db:verify` to `b4:all`,
or to any phase gate that touches migrations, catches it where the migration is
written. One line in `package.json`.
