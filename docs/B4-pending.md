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

**T4.2's gate has been updated to the agreed mode-specific latency contract.**

Balanced is now measured by the live 20-case golden run: merchant/date/total
accuracy remains at least 90%, category remains in the user's list, and the
average server round trip must be at most 2.5 seconds. p50, p95, and max remain
diagnostic values. Precise is the direct Grok/image path and is accepted against
an average `total_to_ui_ms` of at most 4.5 seconds; that part must come from a
physical-device run because the text golden harness cannot measure it.

The old p50 1.6-second target is retired. T4.5 already has physical-device
evidence: Default confirmation, five rapid One-click captures newest-first, and
a non-receipt toast with no net charge or stored image. The regenerated
`gates/report-b4-golden.json` passes the Balanced gate at `2385ms` average
(`p50 2255ms`, `p95 2685ms`, `max 3895ms`). The clean Precise/Grok retry
recorded five metrics at `4126ms`
average (`p50 3984ms`, `p95/max 4972ms`), so the full T4.2 gate now passes.

T4.3 was in exactly this state until it was pointed at `b4:db:verify`, so the
pattern for fixing one exists. Everything else in this document can be deferred;
this cannot, because it is the phase's own definition of done.

---

## 2. 4.5 — the image-durability contract

**Status: implemented and device-verified.**

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

### Implemented contract and evidence

1. **Balanced is honest at ack time.** It returns `image_path: null`, and the
   shared contract permits null. `upload_only` writes the actual path only after
   Storage succeeds.
2. **Image backup is observable and recoverable.** Recents distinguishes a
   backup in progress, a scheduled retry, a terminal `Photo not backed up` state
   with Try again, and a missing local file. A reachable app schedules bounded
   backup retries; startup and network recovery remain the fallback after the
   app is suspended.
3. **The deletion rule is tested.** T3.5 asserts that the local photo remains
   until `imageSyncStatus` becomes `uploaded`, then is deleted. The B4 backend
   verifier also checks the Balanced ack cannot advertise a nonexistent image.
4. **Physical-device staging drill passed.** A development-only forced Storage
   failure produced a confirmed receipt with no `image_path` or Storage object;
   after Try again with the drill disabled, its Storage object and database
   `image_path` both appeared. Extraction was never re-run and no additional
   scan was spent.

Validation: `npm run b3:app`, `npm run b4:backend`, and the live
`npm run b4:db:verify` all passed. The staging `extract` function was deployed
for the `upload_only` failure drill.

---

## 3. Smaller pending items

**8.3 — single-device enforcement.** Implemented, pending staging device drill.
Takeover rather than a hard block, because a hard block locks a user out of their
own data when a phone is lost. `user_devices` (user_id, device_id, last_seen_at,
is_active) holds an opaque SecureStore-backed app-installation ID rather than a
hardware identifier. The authenticated claim RPC asks before deactivating an
existing device; each write-capable Edge Function independently rejects inactive
devices before it can charge or write. The new device begins its normal receipt
pull only after it becomes active.

**8.4 — line-item sync.** Implemented and device-verified. Structured
name/quantity/amount rows now survive extraction, local persistence, server pull,
editing, and confirmation. Existing string-only local rows are upgraded in memory
as quantity-one rows. Confirmation commits receipt fields and replacement items
in one database transaction. A physical Balanced-mode capture was edited on device
(item description and notes); staging confirmed the receipt, updated note, and
structured item row. See DL-003.

**4.6 — camera capture failures.** Completed and device-verified. The earlier
five hardware-level errors were not reproduced after rapid capture became
possible. A fresh staging run created nine receipts with no hardware capture
failures. The only six recorded failed attempts were expected Balanced hedge
cancellations: each has a paired successful `200` attempt. Failures remain
visible as a notice and `[capture] failed` log.

---

## 4. Found during this work, not on anyone's list

**The duplicate check costs ~400 ms on the critical path.** Kept intentionally:
the server is the final duplicate authority and returns its candidate before the
app asks the user whether to retain the new receipt. The local OCR check is an
early same-device shortcut, not a replacement for that decision.

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

**Completed.** `b4:all` now runs `b1:db:verify` before the B3 and B4 database
checks. This catches stale `db.types.ts` alongside the migration that caused it,
rather than waiting for CI after a push.
