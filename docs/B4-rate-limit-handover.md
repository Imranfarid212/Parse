# Handover — B4 per-user rate limit + atomic quota

Written to be picked up cold in a new thread. Branch
`feat/b4-extraction-fast-path`, staging project `receiptflow-staging`
(`wfboznibkhsfxteejxco`).

## Status in one line

**Deployed to staging, not yet verified.** One scan has been attempted and it
failed; the cause was found and fixed, and the fix is deployed but untested.
**The next action is a single scan on the device.**

---

## 1. What the task was

The playbook requires of B4:

> can_scan() + atomic −1 scan_used in one transaction (row lock on profiles);
> per-user rate limit (12/min burst)

Neither existed. Entitlement was three PostgREST reads in application code, and
the debit was a separate insert written after the model call, seconds later.

Two holes followed:

- **Nothing bounded call rate.** Every scan is a paid model call, and an
  Unlimited subscriber has no entitlement ceiling at all, so one account could
  spend without limit.
- **A parallel-scan race.** Two captures fired at once both read the balance
  before either wrote, so a user with one scan left could get two.
  `UNIQUE(user_id, reason, ref_id)` makes a *redelivered* capture idempotent but
  does nothing for two different receipts.

## 2. What was built

`public.can_scan(p_user_id uuid, p_capture_id uuid)` — one transaction that:

1. locks the user's `profiles` row
2. enforces a 12/min burst from `public.scan_attempts` (new table)
3. evaluates entitlement (free balance / Plus monthly cap / Unlimited)
4. writes the `-1 scan_used` ledger row

Returns `(out_allowed, out_reason, out_remaining, out_paywall)`.
`out_remaining` already accounts for the scan just charged.

`public.refund_scan(p_user_id, p_capture_id)` writes a compensating `+1` with
reason `refund` — a rejected image gets its credit back, as an entry rather than
a deletion, so the ledger stays an audit trail.

**The burst is a pool, not a spacing rule.** Twelve back-to-back are fine; the
thirteenth inside a minute is refused. This matters because gate test T4.5
requires five rapid One-click scans to work.

**Over the limit returns 429 `RATE_LIMITED`, not 402.** Too fast is not out of
scans. The client already treats 429 as retryable and 402 as a verdict, so a
throttled scan queues and retries silently instead of showing a paywall.

**Charging moved to decision time** — it had to, to share the transaction with
the check. So every non-billable outcome must refund. A rejected image still
counts against the burst window: it cost a model call either way.

### Deliberate trade-off

The quota arithmetic now exists in two places. `packages/contracts/src/quota.ts`
(`decideQuota`) remains the **client's advisory copy** for the shutter gate; the
SQL is the **server authority**. The gate pins the cap and both product ids in
both files so they cannot drift silently. This was accepted knowingly — the
alternative was leaving the race open.

### Also in this batch

The on-device "is this a receipt" pre-check now runs in **Balanced** too. It
previously ran only in Precise, so the default mode sent everything to the
model. Balanced already reads the text, so the check is free, runs before the
draft card, and warns rather than blocks (same Retake / Continue Anyway prompt).
This makes the refund path a last resort rather than the first line of defence.

## 3. What went wrong on the first attempt

The first scan returned **"Quota could not be verified"** — the extract path
fails closed when the quota check throws.

Cause: the function's outputs were named `allowed`, `reason`, `remaining`,
`paywall`. In PL/pgSQL those are variables in scope for the whole body, so the
ledger insert's `reason` — in both the column list and the conflict target —
meant two things at once. Ambiguous on every scan, regardless of plan.

Fixed in `20260801000200_b4_can_scan_unambiguous.sql`:

- outputs renamed with an `out_` prefix so none can shadow a column
- every column reference inside the function table-qualified
- conflict target pinned to `scan_ledger_user_id_reason_ref_id_key` by name
- the function is **dropped and recreated** — renaming outputs changes the
  return type, which `CREATE OR REPLACE` refuses
- `notify pgrst, 'reload schema'` — a function created by a migration is
  invisible to `rpc()` until the cache refreshes, which produces the *identical*
  symptom for an unrelated reason. Both were fixed because there was no way to
  tell them apart without database access.

## 4. Current state

| thing | state |
| --- | --- |
| `20260801000100_b4_can_scan_rate_limit.sql` | applied |
| `20260801000200_b4_can_scan_unambiguous.sql` | applied — "Remote database is up to date" |
| `extract-balanced` | deployed, boots (401 on unauthenticated POST) |
| `extract` | deployed, boots |
| `b4:backend`, `b4:app`, typecheck, lint | pass |
| **a scan actually succeeding through can_scan** | **never happened** |

Commits: `1627c7a` (the feature), `e1310b8` (Balanced pre-check), `6f8cdd8`
(the ambiguity fix). Nothing pushed to a remote.

## 5. Next action

**Take one scan in Balanced mode on the device.**

- **It works** → the atomic charge and rate limit are live. Move to §6.
- **It still says "Quota could not be verified"** → do not guess. Open the
  Supabase dashboard → Edge Functions → `extract-balanced` → Logs, and find the
  line beginning `[extract-balanced] quota check failed`. It carries the real
  error. This CLI version (2.109.1) has **no `functions logs` command**, and the
  direct database host does not resolve on the current network, so the dashboard
  is the only window onto it.

## 6. Test checklist once a scan succeeds

1. **Normal scan** — completes, and `scan_ledger` gains one `scan_used` row for
   that capture id.
2. **Photograph a wall or blank page** — the new Balanced pre-check warns
   *before* the model runs, in well under a second.
3. **Photograph a menu or bank statement** — gets past the pre-check, reaches
   the model, comes back rejected, and a `refund` row appears in `scan_ledger`.
4. **Thirteen scans inside a minute** — the thirteenth is throttled. Nothing
   visible happens; it queues and retries. Watch Metro logs, not the screen.
5. **Parallel race (untested, needs two devices or a script)** — two captures at
   the same instant on a balance of 1 must produce exactly one charge. This is
   the bug the row lock exists for and it has never been exercised.

## 7. Rollback

The database objects are **additive** — a new table and two functions. Nothing
existing was altered or dropped. So rolling back is just redeploying the
previous function code:

```bash
git revert 6f8cdd8 1627c7a          # leaves the Balanced pre-check in place
supabase functions deploy extract-balanced --project-ref wfboznibkhsfxteejxco
supabase functions deploy extract --project-ref wfboznibkhsfxteejxco
```

`can_scan`, `refund_scan` and `scan_attempts` can stay — unused, they cost
nothing. Note that reverting also restores the old post-model debit, so any scan
charged by `can_scan` in the meantime would be charged again by the old code
path; on staging with a test account that does not matter.

## 8. Environment gotchas that cost time

- **`db.wfboznibkhsfxteejxco.supabase.co` does not resolve** on the current
  network (Mac at `192.168.1.103`). It resolved earlier from a different
  network. The `supabase` CLI connects fine through its own routing, so
  `db push` works; a direct `pg` client does not. The pooler host resolves but
  `postgres.wfboznibkhsfxteejxco` is rejected as a tenant on `ap-south-1`, so
  the region is something else.
- **`supabase functions logs` does not exist** in CLI 2.109.1. Use the
  dashboard.
- **`supabase storage rm` reports success and deletes nothing.** Verify storage
  deletions by listing afterwards.
- **Deploy order matters.** The functions call `can_scan`, so the migration must
  land first or scanning breaks in the window between.

## 9. Still outstanding, unrelated to whether this works

- **The device needs rebuilding.** It runs a build from before all of this, so
  it has neither the Balanced pre-check nor the earlier sync fixes.
- **Delete the app before reinstalling.** It holds ~24 receipts that no longer
  exist on staging (that data was cleared with a hard `DELETE`, which leaves no
  tombstones for sync to act on). They will not go away on their own.
- Remaining B4 items are in `docs/B4-handover-2026-08-01.md` §8 — chiefly the
  live Grok golden/latency run and device mode runs, which are what actually
  close the phase.
