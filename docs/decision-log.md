# Decision log

Blueprint v1.1 carries decisions D1–D18. The playbook requires a logged entry
for anything not in the original documents, and the Blueprint wins on conflict —
so where the build has diverged from a D-code, the divergence is recorded here
and the D-code is explicitly amended rather than quietly ignored.

Entries are append-only. Superseding an entry means writing a new one that says
so, not editing the old one.

---

## DL-007 — B8 sells four tiers from two price lists, and B2's Apple gap is closed here

**Date:** 2026-08-08 · **Status:** accepted · **Amends:** D8, D12, D17, B2 ·
**Touches:** B8, Blueprint §7 §10 §13.2, Playbook B8

### Context

Blueprint §10 locks two products — `rf_plus_699_m` at $6.99 for 500 scans/month
and `rf_unlimited_1199_m` at $11.99 — monthly only, with annual SKUs listed as
post-v1. The Plan screen that actually shipped sells something else: **Pro** and
**Max**, monthly *and* yearly, with an "Early promotion discount" switch showing
a second, lower price for each. The product owner reviewed both and chose to keep
the screen as built.

That choice is not cosmetic. It changes the number of store products from two to
eight, changes the enforced monthly allowance, and — because a client-side switch
cannot change what Apple or Google charges — required deciding what the promo
switch actually *does*.

### Decision

| Blueprint / playbook | Now | Why |
|---|---|---|
| Tiers named Plus / Unlimited | **Pro / Max** | The shipped UI. Entitlements are `pro` / `max`. |
| Plus = 500 scans/month | **Pro = 200 scans/month** | The Plan screen advertises "200 uploads per month". The server must enforce what the screen sells, so 200 is the cap. The figure is imported into the screen from the catalogue, so the two cannot drift. |
| Monthly only | **Monthly + yearly** | The design has both billing cards. |
| 2 products | **8 products** | 2 tiers x 2 terms x 2 price lists. |
| `rf_plus_699_m` / `rf_unlimited_1199_m` | **`parse_{tier}_{m,y}[_promo]`** | The product is Parse, and store product IDs are permanent — an id embedding `699` becomes a lie the first time the price moves and can never be corrected. IDs now encode tier and term only. |
| Product IDs in a CHECK constraint | **A `products` table** | Eight SKUs whose prices will be experimented with cannot live in a schema constraint. The catalogue is data; `can_scan()` joins to it and reads the allowance from a column instead of carrying a hardcoded 500. |
| — | **The promo switch selects a RevenueCat offering** | A client cannot discount a store price. The switch chooses between two real offerings (`default`, `promo`), each holding real store products, so every price displayed is a price the store will charge. The eligibility decision is client-side today and the shape is built so it can move server-side later without touching the products, the entitlements or the contract. |

**The uncapped tier is still not literally unlimited.** D8's fair-use rule is
implemented as `products.fair_use_threshold` (2,000/period): past it `can_scan()`
returns `out_deprioritized = true` while still allowing the scan. Nothing in the
UI may render that as a block — the tier is sold as unlimited and it is.

### B2's Apple gap, closed here

Sign in with Apple shipped in B2 authenticating with the identity token alone and
discarding `credential.authorizationCode`. Apple requires an app offering SIWA to
**revoke the user's tokens on account deletion**, and revocation needs a refresh
token, which only exists if that code was exchanged for one. As built, B8's
`account-delete` could never do more than report `apple_revoked: false`, and the
app would fail review on it.

So B8 adds the capture: the code is exchanged by a new `apple-link` function and
the refresh token is stored in `apple_auth_tokens` — RLS on, no policies, no
grant to any client role, taken-and-deleted in a single statement at deletion
time. This is B2 work landing in B8 because B8 is the phase whose gate asserts
revocation happens.

### Consequences

- `can_scan()` was dropped and recreated (its return type gained
  `out_deprioritized`). Every B4 assertion naming `rf_plus_699_m`,
  `PLUS_MONTHLY_CAP`, `plus_within_cap` or the 500 cap is rewritten against the
  new tier vocabulary; the invariants those tests protect — the profiles-row
  mutex, the loud failure on a missing profile, idempotent debit, grace counting
  as active — are unchanged and re-asserted by the B8 gate.
- Deleted accounts keep a **pseudonym**, not a timestamp. Financial rows are
  anonymised by detaching `user_id` and stamping `payment_events.subject_ref`
  with the tombstone's random `financial_ref`. The first cut matched rows for
  purging by "recorded before the tombstone was written", which stranded any
  event arriving *after* deletion: it fell outside the range, survived the
  five-year purge, and by then the tombstone was gone so nothing could ever
  collect it. `apply_rc_event` stamps late arrivals with the same ref.
- `payment_events` gained `subject_ref`; `account_tombstones` gained
  `financial_ref`; `subscriptions` gained `offering` and a UNIQUE on `user_id`
  (the webhook upsert needs a conflict target, or a redelivered renewal could
  leave two active rows whose `current_period_start` disagree).
- A **cancellation does not end access.** `CANCELLATION` is deliberately absent
  from the webhook's status map: it means auto-renew is off, not that the period
  ended. Only `EXPIRATION` expires a subscription. The gate asserts this.
- Local B8 gate is green 4/4. The phase stays **locked**: T8.1, T8.3 and the
  manual half of T8.5 need App Store Connect, Play Console and RevenueCat
  accounts that do not exist yet (docs/B8-store-runbook.md).

## DL-006 — The export file format follows the product, not the playbook

**Date:** 2026-08-06 · **Status:** accepted · **Amends:** B7's T7.1 ·
**Touches:** B7, Blueprint §12, Playbook B7

### Context

B7 shipped the export exactly as the playbook specifies it. Reviewing the real
files, the product owner asked for a different shape. Three of the changes
contradict the playbook's wording for T7.1, so they are recorded here rather
than quietly absorbed — the playbook says a phase's gate test is the definition
of done, and this changes what two of those tests assert.

### Decision

| Playbook / earlier build | Now | Why |
|---|---|---|
| One receipts sheet, currencies grouped with per-currency subtotal blocks | One sheet per currency, no subtotals | Separating the currencies makes D13 structural: no sheet holds two currencies, so nothing on it could add them. Subtotal rows then have nothing to disambiguate, and a user who wants a total selects the amount column — which is now a correct thing to do on every sheet. |
| A line-items sheet | No line items in the export | Not wanted in the export. |
| A Receipt ID column | No receipt ids | An internal identifier on a document meant for an accountant. |
| `receiptflow_export_YYYY-MM-DD.*` | `parse_export_YYYY-MM-DD.*` | The product is called Parse. A file landing in someone's Downloads folder is branding, so it follows the app rather than the document. |
| PDF cover title "ReceiptFlow export" | No title | The metadata lines under it already say what the document is. |
| Grey PDF table headers, band offset below the text | Olive `D8E4BC` headers, band sized from the font's ascent | The statement and the sheet now look like one export. The old band was drawn three points below the baseline with a fixed height, so the text sat above its own background. |
| ISO timestamps (`2026-08-05T17:45:49.674Z`) | `05/08/2026 11:15 PM GMT+5:30` in the device's zone, dates `dd/mm/yyyy` | Readable, and in the reader's own time. |

**The timestamp is rendered in the device's timezone, and always labelled.** The
client sends its IANA zone with the export; the job stores it in a `timezone`
column, because the file may be built minutes later by the sweeper in a process
that knows nothing about the user. The label stays on (`05/08/2026 11:15 PM
GMT+5:30`) since the same instant is the 5th in Chicago and the 6th in Adelaide.

An export that sends no zone, or one the runtime cannot resolve, renders in UTC
rather than failing: the request is validated for shape only, and the fallback
happens at render time. Losing an export over the label on one line would be a
poor trade.

### Consequences

- T7.1's assertions are rewritten: instead of subtotal blocks and a line-items
  sheet, they check one sheet per currency, that each sheet's rows are all its
  own currency, that the per-sheet totals match SQL, that no receipt id appears
  anywhere, and that the header row is bold on the olive fill. The
  no-cross-currency property is asserted more strongly than before, not less.
- The workbook is written with `xlsx-js-style` rather than the vendored SheetJS
  Community Edition, because CE does not write cell styling and the header row
  has to be bold on a fill. Only the write path is used; nothing on the server
  parses a spreadsheet. The vendored SheetJS 0.20.3 stays as the *test* reader,
  which has the side benefit that the reader verifying these files is a
  different implementation from the writer producing them.
- Dates are written as real date cells with a `dd/mm/yyyy` format rather than
  text, so a column still sorts as dates. They are built from local components:
  the writer converts a Date to an Excel serial relative to local midnight, so a
  UTC-parsed date carried a spurious time-of-day that varied by host.
- **No Currency column.** The sheet is named for its currency, so a column
  repeating it on every row says nothing. The code moved into the amount header
  — `Amount (USD)` — which keeps it attached to the numbers it qualifies, so a
  row copied out of the sheet still sits under a heading that names the currency.
  "Every row on this sheet is this currency" is then asserted by totalling the
  sheet against SQL rather than by reading a column.
- **A finished export is not the same as a downloadable one.** Files live seven
  days and are then deleted, which leaves the row `done` with an empty artifact
  list — and the screen was advertising "Ready to download" over nothing. The UI
  now derives its state from the artifacts rather than the status: `ready` only
  when there are files, otherwise `expired`, which keeps the row as a record of
  what was exported and offers to run it again with the same filters. The row is
  not hidden by age; a five-day-old export with files is still useful and a
  one-hour-old export whose files are gone is still not.
- Storage keys, the `receiptflow://` deep-link scheme, the Supabase project
  names and the `receiptflow.*` SecureStore prefixes are **not** renamed. They
  are infrastructure identifiers, not branding; renaming the scheme or the
  storage prefixes would break existing sessions and links for no user-visible
  gain.

## DL-005 — B7 exports run inline with the sweeper as the guarantee

**Date:** 2026-08-05 · **Status:** accepted · **Supersedes:** nothing ·
**Touches:** B7, Blueprint §12, D13, D15

### Context

Blueprint §12 specifies exports as async jobs delivered by signed URL, and the
playbook's B7 gate requires a 1,000-receipt export to complete "within limits or
auto-chunk". It does not say what runs the job. B5 already answered that question
for extraction (DL-004): commit the work as a row, run it best-effort inline, and
let a sweeper with leases be the thing correctness depends on.

### Decision

Exports use the same shape, deliberately, so the system has one durable-work
pattern rather than two.

- `POST /export` authenticates, validates, commits an `export_jobs` row, and
  returns 202 with the job. It never returns a file, and there is no synchronous
  variant to fall back to.
- The build then runs inline under `EdgeRuntime.waitUntil`, having first *claimed*
  the job. A claim is a lease, not a flag.
- The 30-second sweeper claims anything due — queued work nobody picked up, or a
  job whose lease expired because its worker died mid-build. `attempt_count <= 3`,
  then the job is `failed` and the user is offered a retry.
- A claimed job cannot be claimed again, so the inline attempt and the sweeper
  cannot both build the same export.

Three rules follow from D13 and are enforced in code rather than documented:

1. `subtotalFor` and `categoryTotalsFor` take a single-currency group and throw
   if handed a foreign row. There is no function anywhere that returns one number
   for a mixed set, so a cross-currency total is not a bug that can be written.
2. The statement says in print that no combined total exists, because a user
   hunting for a total they cannot find deserves a reason rather than a suspicion.
3. `export_receipt_rows` refuses an amount filter with no currency, the same way
   `search_receipts` does.

### Consequences and things found on the way

- **`export_jobs` had no table grants.** It shipped in B1 with a permissive
  `for all` RLS policy and no privileges for any role, which made the policy
  unreachable — the client could not have read its own exports. Found by running
  the lifecycle rather than reading it. The policy is now select-only for the
  owner, every write goes through a service-role RPC, and the grant exists.
- **Export retention is new.** The Blueprint gives the sweeper three jobs and
  export cleanup is not among them, but a 7-day signed link over an object that
  lives forever is a leak. `purge_expired_exports` plus an `export_file_purge_queue`
  now mirror the receipt-image purge, acknowledging only after Storage confirms.
- **Links are minted on demand, not stored.** A URL in a table goes stale and is
  one more copy of a credential. The client mints a 7-day link when the user taps
  a file; what actually ends access at seven days is the purge deleting the object.
- **PDF text is Unicode, within one font.** pdf-lib's built-in fonts are WinAnsi,
  which cannot render a merchant name in Greek or Cyrillic — unacceptable for a
  global launch. A subset of Noto Sans (Latin, Latin Extended, Greek, Cyrillic,
  punctuation, currency symbols) is embedded. **Known gap:** CJK, Indic and Arabic
  merchant names render as the missing-glyph box. Covering them means shipping a
  different font family, not a bigger subset, and is a v1.1 item.
- **Receipts with no stored image are reported, not hidden.** DL-002 leaves the
  Balanced path's image in the client's custody, so a receipt can legitimately
  have no object behind it. The images PDF counts those as `skipped` and an
  unreadable object as `unavailable` instead of quietly producing a shorter file
  than the export claims to represent.
- **Concurrent exports per user are capped at three**, checked and inserted under
  a profile row lock. Not in the Blueprint; a 1,000-receipt image export is the
  most expensive thing an unpaid user can ask for on demand.
- **CSV is gone from the Export screen.** The B7 design mock offered PDF/CSV; the
  contract has only `xlsx | pdf`, and a CSV cannot carry per-currency subtotal
  blocks. Removed rather than reinterpreted.
- Deno tests live in `supabase/functions/_tests/` rather than the playbook's
  `functions/tests/`: the CLI treats every non-underscore directory under
  `functions/` as a function and fails to boot when one has no `index.ts`.
- **SheetJS is vendored** (`_shared/exports/vendor/xlsx.mjs`, Apache-2.0). The
  server-side bundler used by `functions deploy --use-api` refuses imports from
  `cdn.sheetjs.com`, and the newest SheetJS on public npm is 0.18.5, which carries
  a prototype-pollution advisory in its reading path. Vendoring the current 0.20.3
  keeps the security property and removes a deploy-time CDN dependency; the b7
  backend check now fails any CDN import in function code, because that failure
  otherwise surfaces at deploy rather than at test.

### What deploying to staging changed

Two of these were only visible against a hosted project, and both are recorded
because the fix in each case was to the test's model of the world, not only to
the code.

- **A 1,000-receipt export with 120 images exceeded one edge-function
  invocation.** The job still completed — the lease expired and the sweeper
  finished it on attempt 2, exactly as designed — but taking the recovery path
  routinely is wasteful. Image downloads were sequential and are almost entirely
  latency, so they now run eight at a time; the same export finishes inline in
  ~88 s, and the filtered 150-receipt case went from 31 s to 12.6 s. Pages are
  still embedded strictly in SQL order, because T7.3 is about order.
- **A purged export still served over HTTP 200.** Storage on a hosted project sits
  behind a CDN, so a URL fetched moments earlier keeps serving from the edge cache
  after the object is deleted. Re-fetching a signed URL was therefore testing the
  CDN, not the purge. The assertion now proves the two real mechanisms separately:
  a deliberately short-lived link is refused once it expires, and the purged
  object is gone according to Storage's own API. The seven-day horizon is asserted
  from the token's `exp` claim and the job's `expires_at`.

### A note on this file's numbering

There are two entries numbered DL-003 (line items on the device, and local-first
B6 search). Entries are append-only, so neither is renumbered here; this one takes
DL-005 and the collision is recorded so nobody assumes a missing entry.

## DL-004 - B5 uses hybrid provider fallback with durable server jobs

**Date:** 2026-08-03 · **Status:** accepted · **Supersedes:** nothing ·
**Touches:** B5, Blueprint §5, D15

### Context

B4 split extraction into a fast text-first Balanced path and a photo-first
Precise path. Balanced already races Gemini providers and returns the first
valid result. Precise still calls Grok directly with the image. The client also
has visible deadlines: 3.8 seconds for Balanced and 4.5 seconds for Precise.
Those deadlines are UI behavior only; a slow request can still finish after the
screen has moved on, and device-local retry covers network failures.

The original Blueprint B5 design assumed one photo-first `extract` endpoint with
server-owned durable images before any 200 or 202. DL-002 amended D14 for the
Balanced path because Balanced never receives the image at extraction ack time.
B5 therefore cannot blindly restore the original single-path design without
undoing B4's latency work.

### Decision

B5 keeps the successful B4 fast paths unchanged and adds durability only at the
point where the server has accepted responsibility for delayed provider work.

- Normal Balanced success remains the current Gemini race and returns 200.
- Normal Precise success remains the current Grok image path and returns 200.
- A provider failure after the configured Grok attempts commits the Precise
  receipt in `processing` with its durable Storage image and commits exactly one
  `extraction_jobs` row in the same database transaction, then returns 202
  `PROVIDER_DELAY`.
- A 202 row is server-owned work. The device shows the canonical pending copy
  and does not create a new server job or repeatedly resubmit the image for that
  capture.
- A transport failure with no server response remains a device-local silent
  requeue. It is not shown as `PROVIDER_DELAY`.
- The sweeper is the correctness mechanism: it claims due jobs with leases and
  `FOR UPDATE SKIP LOCKED`, runs Gemini, completes or reschedules with backoff,
  and treats late duplicate workers as no-ops by re-checking receipt status.
- Terminal job failure marks the receipt `failed`, writes an idempotent refund
  ledger row, and updates the receipt so Realtime/polling can notify the user.
- The Grok breaker opens after 3 failures inside 120 seconds. While open, new
  Precise scans route synchronously to Gemini and return normal 200s, with
  `provider='gemini'`. A 15-minute provider probe closes the breaker after a
  successful Grok canary.

### Consequences

- No server job is created on the ordinary 200 path.
- The current B4 latency gates stay mode-specific: Balanced 2.5-second average
  acceptance and Precise 4.5-second temporary acceptance are not changed.
- `extraction_jobs` remains unique by `receipt_id`; `receipts.capture_id` remains
  the capture idempotency key.
- B4's `extraction_persist_jobs` table stays as background persistence
  bookkeeping. B5's durable retry queue is the canonical `extraction_jobs` table
  that already exists from the Blueprint schema.

## DL-003 — Line items remain structured on the device

**Date:** 2026-08-03 · **Status:** accepted · **Touches:** B4.8.4

Extraction already supplies `name`, `qty`, and `amount`; converting that to
display strings on the client made item edits lossy. Receipt fields now retain
structured rows end-to-end. Existing local string rows are read as quantity-one
items for backwards compatibility. Confirmation replaces the server item rows
in the same database transaction as the receipt header update.

---

## DL-001 — The extraction path is split into Balanced and Precise

**Date:** 2026-08-03 · **Status:** accepted · **Supersedes:** nothing ·
**Touches:** Blueprint §4.1, D14

### Context

Blueprint §4.1 describes one fast path: the client posts the image, `extract`
runs the model against it, and one function owns the whole scan. The B4 build
found that shape could not meet the T4.2 latency budget — sending a 150–300 KB
JPEG and having the model read it is the dominant cost, and it is paid on every
scan whether or not the image is needed.

### Decision

Two paths, chosen per capture:

- **Balanced** (`extract-balanced`, the default). The device runs OCR locally and
  posts **text only**. The image never reaches this function. The photo is
  uploaded separately afterwards, in the background, through `extract` with
  `upload_only=1`.
- **Precise** (`extract`). The original photo-first path, unchanged, for captures
  where the image itself must be read.

### Consequences

- The bulk of extraction latency moves off the request. Text is a fraction of
  the bytes and a fraction of the tokens.
- **D14 can no longer hold for Balanced as written** — see DL-002. A function
  that never receives the image cannot store it before acking.
- Two prompts and two category-resolution paths existed briefly and drifted;
  they are now shared through `supabase/functions/_shared/categories.ts`.
- The client must own image durability on the Balanced path, because nothing
  else can.

### Why this was not written down sooner

It was not. The split was built during B4 and this entry is retrospective — the
gap is what the B4 pending document flagged. Recorded here rather than back-dated.

---

## DL-002 — D14 amended: the ack gate binds whoever holds the image

**Date:** 2026-08-03 · **Status:** accepted · **Amends:** D14 ·
**Depends on:** DL-001

### Context

D14, as written:

> No 200/202 leaves `extract` before the image is durable in Storage. A Storage
> failure returns an error; the client keeps its copy and retries.

The intent is a safety property, and a good one: **the user's photo is never the
only copy at a moment when the system has told them it is safe.** The mechanism
in D14 — store before you ack — is one way to get that property, and it assumes
the server has the image to store.

On the Balanced path the server never receives the image, so the mechanism is not
merely unimplemented, it is unimplementable. Three gate assertions currently fail
against it (`b3:backend` ack order, `b3:app` T3.5 ×2). They are correct to fail:
the rule changed and was never rewritten.

### Decision

D14's *intent* is retained and its *mechanism* is made path-specific.

**Amended D14 — the local copy is released only once a durable copy exists.**

| Path | Who holds the image at ack | Rule |
|---|---|---|
| Precise (`extract`) | the server | Unchanged. Storage upload → receipts upsert → 200. A Storage failure returns an error and no ack. |
| Balanced (`extract-balanced`) | the client | The ack covers the **extraction result only** and makes no claim about the image. The client keeps its local file until the separate upload confirms, and only then deletes it. |

Two rules follow, and both are testable:

1. **The client deletes the local file only on a confirmed upload** — the
   `imageSyncStatus: 'uploaded'` branch, never on the extraction ack.
2. **The server never advertises an image path it cannot serve.** Balanced
   returns `image_path: null`; the path is written when the object exists, by
   the `upload_only` path that actually stores it.

### Consequences

- `extractAckSchema.image_path` becomes nullable. A contract change: null now
  means "no image is stored yet", which is a state that previously could not be
  expressed and was therefore misrepresented as a real path.
- A permanently failed upload becomes a state the user can see and act on, since
  the device is now the sole custodian until the upload lands. Silence there was
  acceptable when the server stored the image up front; under this amendment it
  is not. (`upload_failed_final`, surfaced in Search with Try again.)
- The three failing assertions are rewritten to encode the amended rule. They go
  green because the rule is stated and true, not because the check was relaxed.
- T4.4's ack-gate assertions ran only against `extract`. Under a two-path rule
  each path needs its own assertion, so `extract-balanced` gains one.

### What was checked, and what turned out not to be true

The B4 pending document records a second exposure: that `extract-balanced`
returns a path for an object it does not have, and that `server-sync.ts` reads
that into `remoteImagePath`, giving a second device a dead link.

The first half is true. **The second is not.** `server-sync.ts:113` reads
`image_path` from the `receipts` **table**, and `extract-balanced` never writes
that column — it is deliberately omitted from the background persist so a racing
image backup cannot be clobbered (`extract-balanced/index.ts:750`). The client's
`ExtractFunctionPayload` does not carry `image_path` at all, so the response
field is consumed by nobody.

So there is no live dead-link bug. What exists is a contract that *promises* a
non-null path, which any future consumer would be entitled to trust. It is fixed
here as a latent trap, not as a live defect — recorded so nobody re-derives the
scarier version from the older document.

---

## DL-003 — B6 search is local-first; the server remains authoritative

**Date:** 2026-08-04 · **Status:** accepted

### Context

The ranked server search executes quickly inside Postgres, but staging API round
trips are consistently hundreds of milliseconds. The one-device policy and the
existing restore/delta pull make the device mirror the best interactive index,
provided completeness is measured rather than assumed. A later multi-device
plan must not require replacing today's search or accepting last-write-wins data
loss.

### Decision

- Once `sync_state.hydrated_at` exists for the current `local_owner`, Search uses
  SQLite FTS5 plus SQL date/category/currency/amount filters. An unhydrated or
  account-mismatched cache falls back to the RLS-protected server RPC.
- Realtime is an invalidation signal, not the search result source: pull server
  changes into SQLite first, then rerun the same local query.
- Pull cursors never advance past skipped unsent local work. Metadata schema
  changes explicitly invalidate hydration and perform a full backfill.
- Server receipts carry a monotonic `revision`. Edits send an expected revision
  and a unique operation id; duplicate delivery returns the recorded result and
  a stale write returns HTTP 409.
- Single-device takeover remains the product policy. Enabling multiple devices
  later changes session policy and conflict UX, not the storage/search contract.

### Consequences

Search latency no longer contains network RTT during normal use, while first
install and recovery stay correct. Future multi-device work still needs a user
experience for 409 conflicts (refresh, field merge, or explicit choice), but the
backend already detects them and never silently overwrites a newer revision.
