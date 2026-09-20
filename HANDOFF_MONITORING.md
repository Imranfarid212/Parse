# Parse — Monitoring, duplicates and capture reliability: handoff

Session of **19 Sep 2026**, branch `feat/MinorFeaturesAndBugFixes`, 19 commits
on top of `pre-monitoring` (`8c114b4`). All pushed.

Written to be read cold. Where something is unverified it says so, because
several claims made during this work looked verified and were not.

---

## 1. Why this started

A first-install user completed the Google sign-in flow and landed back on the
sign-in screen with no error. A TestFlight tester had hit something similar a
week earlier. Neither left any client-side evidence.

**That original incident was never root-caused.** See §7.

---

## 2. State

| | |
|---|---|
| Branch | `feat/MinorFeaturesAndBugFixes`, pushed, clean tree |
| Typecheck | 0 errors |
| Lint | 0 errors, 3 warnings (all pre-existing: `TapToFocus` ×2, `TrackingQuad`) |
| `npm run verify:monitoring` | 35/35 |
| Shipped to users | **No.** Nothing here has reached TestFlight or production. |

Tags: `pre-monitoring` (`8c114b4`) → `monitoring-v1` (`fb1f48a`). Revert the
monitoring work with:

```bash
git revert --no-commit pre-monitoring..monitoring-v1 && git commit
```

The three commits after that tag (receipts leak fix, settings profile card,
icons) are unrelated work and must **not** come out with it.

---

## 3. What was built

### Monitoring — `src/lib/monitoring/`

- `sanitize.ts` — dependency-free, so `scripts/verify-monitoring.js` can load it
  in Node and assert redaction against real shapes (JWTs, App Attest key ids,
  emails, UUIDs, card/phone digits). It has already caught one leak:
  `authorization="Bearer sk-live-…"` matched only to the space after `Bearer`.
- `index.ts` — `logSafeError`, `trackAnonymousBreadcrumb`, `trackAnonymousEvent`,
  install id, `installRejectionTracker`.
- `flows.ts` — `beginFlow` / `useStateInvariant`. Deadlines count **foreground
  time only** and reports are capped per flow name per session. Both asserted.

Reports key on the **6-character support code** shown on the About screen, not
the full uuid: Crashlytics user-id search is exact-match, so the full id would be
unsearchable from what a user can read out.

Unhandled rejections are reported separately because they do **not** reach
`ErrorUtils` — React Native's tracker calls `ExceptionsManager.handleException`
directly, and `ErrorUtils` sits upstream of it.

### `eslint-rules/no-silent-catch.js`

A `catch` must report, rethrow, or carry `// monitoring-ignore: <reason>`. Set to
**error**, backlog of 48 worked through rather than suppressed, so
`eslint-suppressions.json` is deleted and the verify suite asserts it stays gone.

### Firebase

iOS resolves Firebase through **CocoaPods, not SPM** — see §5. `firebase.json`
disables ad id, Android SSAID and the ad-personalisation signals, so no ATT
prompt is required. `crashlytics_is_error_generation_on_js_crash_enabled` is
**false** because RNFirebase's own JS handler records the *raw* error and would
bypass the sanitiser.

`crashlytics_debug_enabled` is **true** so debug builds report during bring-up.
It is inside `#ifdef DEBUG`, so it cannot affect Release.

---

## 4. Bugs found and fixed

Ordered by severity.

1. **`ca68e02` — the local database was unusable.** `CREATE INDEX … (user_id)`
   sat in the schema block, but `user_id` is added by `ALTER TABLE` twenty lines
   later. SQLite rejected the index, which failed the entire `execAsync`, so
   every migration after it was skipped and the column was never added. Every
   query raised `no such column: user_id`, on fresh installs as much as upgrades.
   Found by the rejection tracker within seconds of the first device build.

2. **`2ba04c2` — "View Existing" destroyed the user's scan.** It removed the new
   capture *before* looking up the existing receipt. The lookup can fail (the
   server matches across the account, including receipts this device has not
   pulled), leaving the user with neither and a toast claiming the receipt was
   safely saved.

3. **`fc91427` — Precise could hang forever.** It had only a *visible* deadline;
   at 4.5s the request was handed to the background where `applyDeferredDispatch`
   awaited it. A stalled connection meant the promise never settled and the row
   sat in its pre-dispatch status indefinitely. `FileSystem.uploadAsync` takes no
   abort signal, so it now uses `createUploadTask` + `cancelAsync()` at 30s.

4. **`a2bfc8d` / `2c99b16` — duplicate detection ran in Balanced only**, and not
   at all on the two queued paths, which also never wrote dedupe signals — so a
   throttled or offline capture was invisible to matching in *both* directions.

5. **`58074ec` — exports looked like they produced two files.** "Your exports" is
   a history list; a PDF export above last week's Excel read as one export
   producing both. Confirmed against staging: every job had exactly the artifacts
   its format called for. The **ready** card was also the only state that never
   showed which format it was.

---

## 5. iOS build: read before touching native

Three constraints that cost several failed builds.

- **Do not set `useFrameworks: dynamic`.** RNFirebase's docs call for it, but that
  applies to the Firebase *CocoaPods* SDK. This project uses Expo's precompiled
  React Native modules, which produce no `React.framework`, and it fails with
  `ld: framework 'React' not found`. A comment in `app.config.ts` says so.
- **RNFirebase refuses SPM under static linkage**, so
  `plugins/with-rnfirebase-disable-spm.js` sets `$RNFirebaseDisableSPM = true`
  and declares modular headers for `GoogleUtilities`, `GoogleDataTransport` and
  `nanopb`, whose Swift pods cannot import them otherwise.
- **`npx expo prebuild` reports exit 0 even when `pod install` fails**, on a Ruby
  locale error. Always follow with `npm run pods`, which sets `LANG`/`LC_ALL`.

After switching linkage, **clear DerivedData** — stale module caches produced a
bogus `NitroImage/HybridImageSpec.hpp` error that vanished on a clean build.

**iOS simulator builds are broken for an unrelated reason:** Skia's simulator
slice is missing from `node_modules` (installed Jul/Aug, predates this work).
Device and EAS builds are unaffected. A task chip was filed for it.

---

## 6. Duplicate detection — current behaviour

Local signals (device-only): `dedupe_key` = `v1|userId|date|currency|totalMinor`
(no merchant — least reliable OCR field), and `ocr_fingerprint`, hashed tokens
compared by Jaccard. Thresholds: `≥0.55` to match, `≥0.8` for `strong`, and a
fingerprint-only fallback at `≥0.9`.

Server rule, identical in `extract` and `extract-balanced`: same user, different
capture, not deleted, status ∈ (`needs_review`, `confirmed`), exact `txn_date`
and `currency`, `total` ±0.01, then normalised merchant match.

| Mode | Local pre-model | Local post-extract | Server |
|---|---|---|---|
| Balanced | yes — OCR draft + fingerprint | yes | **warns** (`duplicate_candidate` → prompt) |
| Precise | no local OCR to use | yes | **blocks** (`duplicate: true`) |

**Still device-local.** The server holds the verdict but no `dedupe_key` or
`ocr_fingerprint`, so the same receipt on two devices is not matched. Closing
that is a schema change — see §8.

---

## 7. Open — the original incident

Staging (`wfboznibkhsfxteejxco`) showed the reported user's sign-in **succeeded**
end to end: profile created `07:24:26Z`, challenge consumed `07:24:36`, attest
key active. So the failure was client-side, after a valid session.

What was never confirmed is why. The decisive evidence is
`auth.audit_log_entries` and `auth.flow_state`, which need a direct DB
connection; the query is written but was blocked by the sandbox as a production
read. **That table rotates, so this is likely unrecoverable now.**

Two silent branches were instrumented as the best candidates: the WebBrowser
`cancel` branch (returned with no alert and no record) and an authenticated
session with a null profile row (every routing guard reads `auth.profile`, so the
sign-in screen renders behind a valid session).

---

## 8. Open — decided against, with reasons

- **Cross-device duplicates.** Needs `ocr_fingerprint` on `public.receipts` plus
  Jaccard in SQL. Only helps Balanced (Precise has no fingerprint), cannot be
  backfilled, and adds an array-similarity query to a hot path. Recommendation:
  measure first using the existing `duplicate_shadow_events` table — note it has
  only **14 rows**, and the "14/14 merchant keys identical" statistic is circular,
  since the rule requires a merchant match before it logs.
- **Soft duplicate tier in search.** The pre-B6 version grouped lookalikes across
  a result set by a derived key. Not restored: "similar" is a judgement about
  what belongs in a total, and an export count now reads the same rows.
- **`countReceipts()` in `store.ts` is dead code** — no callers, counts every
  owned row including deleted and unsynced. Left alone; `countMatchingReceipts`
  is the one in use.

---

## 9. Before shipping

1. **App Store privacy labels and Play Data Safety** must declare crash,
   diagnostics and usage data. Guideline 5.1.2 rejections over Firebase Analytics
   are common. The `AboutScreen` header already warns that Apple cross-checks the
   privacy policy.
2. **EU consent** for Analytics. The install id is pseudonymous but is still an
   identifier.
3. **Verify reporting end to end**: EAS build → long-press the version line on
   About → confirm the support code appears in Crashlytics. Reports upload on
   *next launch*, not immediately.
4. **Review `8e005b2` properly.** It is a data-exposure fix — a null
   `local_owner` handed the whole local store to the next account that signed in.
   It deserves more scrutiny than anything else on this branch.
5. **`5a4d505` drops `adaptiveIcon`**, so Android loses the adaptive mask and
   themed icon. Restore the block if only the artwork was meant to change.

---

## 10. What is NOT verified

Said plainly, because it was got wrong twice in this session.

- **Nothing here has been seen running.** Typecheck, lint, the verify suite, SQL
  tested directly against `sqlite3`, and a device build that compiles and links —
  that is all.
- Untested on a device: the currency capsules, the export count and the
  "Latest export" split, the duplicate badge, Precise duplicate detection, the
  30s Precise deadline, and every queued-path change.
- **Coverage is not complete and should not be described as such.** It scales
  with declared expectations, not with possible bugs. Wrong-but-not-broken
  behaviour, hangs outside the wrapped flows, and users who uninstall before
  relaunching all remain invisible.
