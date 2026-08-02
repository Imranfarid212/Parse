# Handover — B4 per-user rate limit + atomic quota

Written to be picked up cold. Branch `feat/b4-extraction-fast-path`, staging
project `receiptflow-staging` (`wfboznibkhsfxteejxco`).

Supersedes the 2 August version, which said a scan had never succeeded through
`can_scan` and whose §8 environment notes were wrong in ways that cost real time.

## Status in one line

**Verified end to end, on the device and in an automated suite.** Six commits,
none pushed. The §6 checklist is closed, and so is 4.2 — the item the earlier
handover called the most serious one open.

---

## 1. What exists

`public.can_scan(p_user_id uuid, p_capture_id uuid)` — one transaction that
locks the user's `profiles` row, enforces a 12/min burst from
`public.scan_attempts`, evaluates entitlement, and writes the `-1 scan_used`
ledger row. Returns `(out_allowed, out_reason, out_remaining, out_paywall)`.

`public.refund_scan(p_user_id, p_capture_id)` writes a compensating `+1` with
reason `refund`, idempotent on `UNIQUE(user_id, reason, ref_id)`.

**The burst is a pool, not a spacing rule.** Twelve back-to-back are fine; the
thirteenth inside a minute is refused. **Over the limit returns 429
`RATE_LIMITED`, not 402** — too fast is not out of scans.

**Charging happens at decision time**, before the model runs. That is the single
fact most of this document follows from: every outcome that is not a delivered
receipt has to give the scan back.

### The lock, since it is the least obvious part

`profiles` is not read here and is never written. Its row is purely a mutex,
because the thing being protected — the balance — is an aggregate over
`scan_ledger` and has no row of its own to lock, and rows that do not exist yet
cannot be locked. Two captures with *different* capture ids do not conflict on
any constraint; without the lock they both read the balance and both spend it.

`PERFORM ... FOR UPDATE` matching no row locks nothing **and raises nothing**, so
a user without a `profiles` row would run the whole function unserialised in
silence. There is a `NOT FOUND` guard now.

---

## 2. What this session found

Everything below was live on staging before it was found. Ordered by how much it
cost the user.

**A quota rejection destroyed the capture and its photo.** Four sites deleted the
row and the local file on a 402; the worst was the reconnect drain, whose own
comment admitted there was "no live screen to toast into". So a receipt
photographed offline was destroyed, permanently, the moment connectivity
returned on an exhausted account, with nothing shown at any point. Defensible
while it could not happen unobserved — optimistic offline capture removed that.

**A throttle became permanent data loss.** The client ignored the 429's
`retry_after_s`, retried after one second, and each refusal spent one of five
attempts, so a capture could reach `llm_failed_final` in under fifteen seconds
over a window that clears in sixty. The exact opposite of why the server answers
429 rather than 402.

**Five exits charged and never refunded** — the 503 on a failed reservation, the
422 on an empty extraction, the catch-all 500, and in Precise the 500s on a
profile or category read and the 200 that reports a rejected image.

**`is_receipt` was fail-open.** A missing field read as "receipt", so a model
omission became a charge with no refund. And an explicit "receipt" stood on a
document with no amounts at all: an order list extracts seven named items with
quantities and not one amount among them, which was saved as a 0.00 row the user
cannot expense and charged for.

**The retry queue had no clock.** A retry time was written and nothing woke up to
honour it; a capture queued while the user sat on Search stayed "waiting to
retry" indefinitely.

**Capture failures were invisible.** A throw before the skeleton card left the
screen untouched — no card, no alert, one `console.warn`. Pointing the camera at
a keyboard and getting nothing at all was this.

**Rapid One-click was impossible.** The shutter was held until the model
answered and every capture aborted the one before it, so the five rapid scans
T4.5 asks for could not happen — the 12/min pool guarded a rate the UI could not
reach.

---

## 3. Commits

| | |
| --- | --- |
| `ff98b78` | `can_scan` trusted a lock that may never have been taken |
| `0af966e` | a scan charged before the model ran was not always given back |
| `5fde28a` | captures failed, waited and rendered in ways the user could not read |
| `50eca55` | run `can_scan` instead of grepping the migration for it |
| `1d89694` | a scan refused for quota destroyed the user's photo |
| `5fd7e0b` | retrying a blocked capture hid the row it was meant to recover |

Nothing pushed. Both edge functions and the migration are deployed to staging.

---

## 4. Tests

Three suites, and the distinction between them matters.

`npm run b4:db:verify` — **11 tests, 75 checks, no model calls.** Creates a
throwaway user, drives every entitlement branch, the burst limit and the
parallel race, deletes it. Wired into `b4:all` and into gate test **T4.3**,
which was named `quota-idempotency` and had never executed a quota call.

The race test was mutation-checked: against a copy of `can_scan` with the lock
removed, six parallel captures on one credit produced **three charges and a
balance of −2**. It fails when the thing it guards is broken.

`npm run b4:http:verify` — 5 tests against the deployed function as a real
signed-in user. **Not in the gate: two of them spend a model call.** Covers what
the database suite cannot — that the edge function reaches `can_scan`, and that
a verdict becomes the right status on the wire.

`npm run b4:preflight` — the receipt heuristic as a pure function, possible only
because the rule now has no imports. Real receipts must pass; blank frames,
signage and a photographed keyboard must warn.

Both live suites need `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` in
`.env.staging` (gitignored). `can_scan` is granted to `service_role` only, by
design; seeding goes over the direct connection because `service_role` here
holds least privilege — `select` on `profiles` and `subscriptions`, nothing more
— and widening those grants so tests could write would permanently enlarge what
a leaked key can do, in production, to serve a test.

### Device-verified

Normal scans in both modes; the pre-check catching a blank frame and an order
list while a **badly-lit real receipt still passed**; a rejection refunding; a
throttled capture queueing, waiting the server's 60s and landing on its own; the
blocked-quota path end to end (offline capture on an exhausted account,
reconnect, "Out of scans" with its photo intact, recovered on a tap once the
balance returned); and rapid One-click.

---

## 5. Still outstanding

- **The live Grok golden/latency run and device mode runs** — per
  `docs/B4-handover-2026-08-01.md`, these are what actually close the phase.
  T4.2 and T4.5 are still named `source-readiness` and are still static.
- From that document's §8: **4.4** (category lookup timing), **4.5**
  (image-durability, two B3 assertions deliberately failing), **4.6** process
  items, **8.3** single-device enforcement, **8.4** line-item sync.
- **The model's `is_receipt` verdict is not deterministic.** The same passage of
  prose was rejected on one run and accepted on the next. The on-device
  pre-check is therefore the *deterministic* guard, not merely a cost saving —
  worth remembering before anyone trims it.
- **`auth.admin.deleteUser` returns a 500 for users that have receipts.** Every
  foreign key cascades or nulls and a direct SQL delete works instantly, so the
  cause is unexplained. The harnesses retry and fall back to SQL. It will matter
  when account deletion is built.

---

## 6. Environment

Corrections to the old §8, which was wrong twice:

- **`db.wfboznibkhsfxteejxco.supabase.co` has no A record — only AAAA.** It is
  IPv6-only and will never resolve from a host without IPv6, on any network.
  This is not a local DNS fault.
- **The region is `us-east-2`, and the pooler is `aws-1`, not `aws-0`.**
  `SUPABASE_DB_URL` now points at
  `postgresql://postgres.<ref>@aws-1-us-east-2.pooler.supabase.com:5432/postgres`
  and `npm run supabase:staging:push` works directly.
- `supabase functions logs` still does not exist in CLI 2.109.1; use the
  dashboard.
- `supabase storage rm` reports success and deletes nothing. Verify by listing.
- Deploy order still matters: the migration lands before the functions.

---

## 7. Rollback

Database objects are additive — one table, two functions, and a
`create or replace` that changed no signature. Rolling back is reverting the
commits and redeploying:

```bash
git revert 5fd7e0b 1d89694 50eca55 5fde28a 0af966e ff98b78
supabase functions deploy extract-balanced --project-ref wfboznibkhsfxteejxco
supabase functions deploy extract --project-ref wfboznibkhsfxteejxco
```

Note that reverting `0af966e` restores exits that charge without refunding, and
reverting `1d89694` restores the silent deletion of a refused capture's photo.
Prefer fixing forward.
