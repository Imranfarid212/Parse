# B4 Extraction Flow Handover

Last updated: 2026-07-30
Branch: `feat/b4-extraction-fast-path`
Latest pushed commit: `46faf99 feat: harden B4 extraction recents flow`

## Current Goal

B4 introduces two receipt extraction modes on the camera screen:

- Balanced: fast default mode for normal printed receipts.
- Precise: slower high-accuracy mode for handwritten notes or difficult receipts.

The product direction is:

- Balanced should feel fast and populate UI quickly.
- Precise can take longer, but should not block the user on an empty screen.
- Every capture should be durable locally before network work starts.
- Backend/image failures should be recoverable.
- Duplicate handling should warn the user without silently hiding valid receipts.

## High-Level Architecture

Balanced mode:

1. User captures image.
2. App performs document correction.
3. App prepares an OCR-sized image, currently 1600px long edge.
4. iOS local OCR runs through Apple Vision via `modules/document-scan`.
5. App creates OCR draft fields locally.
6. App checks local duplicate candidates before backend call.
7. App sends extracted OCR text to Supabase Edge Function `extract-balanced`.
8. Backend calls Gemini models.
9. Backend returns structured receipt fields to UI.
10. Image compression/persistence/upload is kept off the critical path where possible.
11. Result is saved locally and synced/confirmed.

Precise mode:

1. User captures image or chooses from gallery.
2. App performs document correction.
3. App runs lightweight local OCR preflight only to reject obvious non-receipts before Grok.
4. If preflight is questionable, app shows a prominent alert.
5. App compresses/persists the image.
6. App sends image to Supabase Edge Function `extract`.
7. Backend calls Grok for image extraction, categorization, and handwritten notes.
8. Backend saves image, receipt fields, notes, and items.
9. UI shows "processing" as an alert-style background workflow, not a blocking review card.
10. Once complete, the receipt appears in Recents.

## Important Files

- Camera UI and mode orchestration: `src/app/camera.tsx`
- Capture pipeline: `src/lib/receipts/capture.ts`
- Supabase/API client: `src/lib/receipts/client.ts`
- Local SQLite store: `src/lib/receipts/store.ts`
- Receipt types: `src/lib/receipts/types.ts`
- Recents/Search UI: `src/components/search/SearchView.tsx`
- Recents carousel: `src/components/search/FanCarousel.tsx`
- Menu tab panel: `src/components/MenuPanel.tsx`
- Balanced backend: `supabase/functions/extract-balanced/index.ts`
- Precise backend: `supabase/functions/extract/index.ts`
- Duplicate relationship migration: `supabase/migrations/20260730000100_b4_duplicate_relationship.sql`
- DB contract types: `packages/contracts/src/db.types.ts`
- Shared function DB types: `supabase/functions/_shared/contracts/db.types.ts`

## Balanced Mode Details

Balanced uses local OCR plus Gemini text extraction.

Key implementation points:

- Local OCR text is sent to `extract-balanced`, not the image.
- Default currency is sent from user/profile context.
- Prompt now tells the model not to assume USD and to infer currency from receipt location/city/currency symbols when possible.
- The model response is strict JSON.
- Balanced backend uses Gemini direct key/config for now; OpenRouter logic remains available but is not the primary path during current staging tests.
- Image backup is handled separately from the UI-critical extraction path.
- Backend persistence is backgrounded through `waitUntil`/persist-job style handling where applicable.

Latency work already done:

- Local JWT/JWKS auth improvements.
- Warm-up call support.
- Parallel/hedged model call experiments were tried.
- Current preferred V4 direction is the fast-path model race/latency hardening, with no local deterministic parser replacing model quality.
- Compression/file persistence was moved away from the hottest path where safe.
- OCR guardrail resizes OCR input to avoid 23s OCR stalls.

## Precise Mode Details

Precise sends an image to Grok through `supabase/functions/extract`.

Key implementation points:

- Uses compressed JPEG for backend/Grok, currently from `src/lib/receipts/capture.ts`:
  - upload long edge: `640`
  - JPEG quality: `0.55`
  - OCR preflight long edge: `1600`
  - OCR preflight quality: `0.9`
- Local OCR is used only as preflight in precise mode.
- Handwritten notes are extracted by Grok and persisted as `notes` in Supabase.
- App maps backend `handwritten_notes` into local `ReceiptFields.handwritten_notes`.
- The precise non-receipt preflight alert avoids contradictory messaging by warning before the "processing" alert.

Recent precise UX fix:

- One-click precise was previously falling into the old inline "processing" strip.
- It now uses the same visible-deadline/background completion behavior as default precise.
- When precise one-click completes in background:
  - local row is confirmed,
  - folder animation pops,
  - user sees `Receipt saved to Recents`.

## Local Durability And Retry

Every capture gets a local SQLite row before backend work starts.

Local row fields include:

- capture id
- image URI
- capture mode
- extraction mode
- status
- fields JSON when available
- local OCR text temporarily
- dedupe key
- OCR fingerprint
- image/result sync statuses
- retry attempts and next retry time
- backend receipt id
- duplicate relationship fields

Queues in place:

- `retryPending()` for extraction retries.
- `syncConfirmed()` for confirmed local receipts not yet synced.
- `syncImageBackups()` for image backup retry.
- `flushCaptureMetrics()` for metrics retry.

Network/transport behavior:

- Transport failures are queued instead of losing captures.
- Visible deadline should stop visible waiting, not destroy the capture.
- Hard failures move rows into retryable/final states depending on attempts.
- App listens to network reachability and flushes queues on reconnect.

## Duplicate Handling

Current philosophy:

- Do not silently hide receipts in Search/Recents.
- Do not collapse by `dedupe_key` as source of truth.
- Same merchant/date/currency/total can still be legitimate.
- Warn, mark, and preserve user intent.

Local duplicate detection:

- Balanced mode builds a local OCR draft.
- Local duplicate lookup uses:
  - `dedupe_key`: user + date + currency + total minor units
  - OCR fingerprint similarity
  - merchant fallback when OCR fingerprint is unavailable
- If local duplicate is found, user gets:
  - View Existing
  - Save Anyway

Save Anyway behavior:

- Proceeds to backend.
- Sends `duplicate_override`.
- Stores local relationship:
  - `duplicate_of`
  - `duplicate_match_strength`
- Backend accepts optional:
  - `duplicate_of`
  - `duplicate_match_strength`

Backend duplicate logging:

- Balanced has duplicate shadow logging.
- Precise/Grok duplicate path now also writes to `duplicate_shadow_events` when backend returns duplicate.
- Logged fields include:
  - new capture id
  - matched receipt id
  - merchant/date/currency/total
  - matched merchant/total
  - match rule
  - match strength
  - action, currently `duplicate_returned`

Search/Recents badge behavior:

- List view shows all saved rows.
- Rows can show:
  - `Duplicate receipt` for persisted strong duplicate relationship.
  - `Similar receipt` for weak relationship or display-level similarity.
- Display-level similarity checks:
  - same dedupe key, or
  - same normalized merchant + currency + total, even if date differs.
- Carousel intentionally stays clean without badges.

Known duplicate limitation:

- Existing old rows are not retroactively stamped with `duplicate_of`.
- The badge can infer similarity for display, but product-grade merge/review workflow is still future work.

## Recents/Search Work

What changed:

- Recents folder is now tappable.
- Tapping folder opens Menu on the Search/Recents tab.
- Search no longer uses dummy receipts.
- It reads real local SQLite rows via `listRecent()`.
- Toggle between Card view and List view works at all result counts.
- Card carousel shows latest 5 only.
- List view shows all recent rows.
- Carousel center is dynamic, so 5 cards are visually balanced.
- Merchant names in List view use two lines instead of tail truncating immediately.

Important behavior:

- Search currently loads local SQLite rows only.
- Cross-device server-to-local sync is not implemented yet.

## Backend Schema Added

Migration:

`supabase/migrations/20260730000100_b4_duplicate_relationship.sql`

Adds to `public.receipts`:

- `duplicate_of uuid references public.receipts(id) on delete set null`
- `duplicate_match_strength text check ('weak', 'strong')`
- index on `(user_id, duplicate_of, created_at desc)` where not deleted

Contract types:

- Must match `supabase gen types typescript --local`.
- The B1 gate checks this exactly using `scripts/verify-b1-db.js`.
- Important lesson: generate from local reset DB, not linked staging, before committing type updates.

## Validation And Gates

Local checks run after the latest fix:

- `npm run b4:app`
- `npm run b4:backend`
- `node scripts/verify-b1-db.js`

GitHub:

- B1 Gate run `30546439330` passed after fixing local generated DB types.

Known warnings:

- `src/components/camera/TapToFocus.tsx` has duplicate React import warnings.
- `src/components/camera/TrackingQuad.tsx` has unused `layout` warning.
- These warnings existed outside the main B4 handover work and do not fail the gate.

## Staging State

Staging project ref:

- `wfboznibkhsfxteejxco`

Functions deployed during testing:

- `extract-balanced`
- `extract`

Important staging note:

- Receipt rows were cleared during testing.
- Old storage objects could not be deleted via SQL because Supabase blocks direct storage table deletion.
- `supabase storage rm` listed objects but returned deleted count `0`.
- Since receipt rows were cleared, those orphaned storage files do not affect duplicate detection or Recents.

## Current Branch State

Branch:

- `feat/b4-extraction-fast-path`

Remote:

- `origin/feat/b4-extraction-fast-path`

Latest commit:

- `46faf99 feat: harden B4 extraction recents flow`

Previous B4 base commit:

- `c9a4ec3 feat: add B4 extraction fast path`

Untracked local artifacts intentionally not committed:

- `.codex_snapshots/`
- `gates/report-b4.json`
- `output/`
- `tmp/`

## Remaining Work

Still not fully done:

- Android ML Kit OCR.
- Startup reconciliation between server receipts and local SQLite rows.
- Full production cross-device sync.
- Strong duplicate detection using bill number/time/invoice number where available.
- Review duplicates screen with merge/keep-both actions.
- Complete "View Existing" route/detail behavior beyond local review prompt behavior.
- Precise mode still has higher latency due to image upload/model/backend DB work.
- Search is local-first only; server-backed search/indexing is future work.
- Badge is currently list-view only, not carousel card UI.

## Recommended Next Steps

1. Finish DB/local sync design.
2. Add server-to-local startup reconciliation.
3. Implement Android ML Kit behind the same OCR interface as iOS Vision.
4. Add invoice/bill-number extraction fields for stronger duplicates.
5. Build a real receipt detail route for View Existing.
6. Build Review Duplicates screen.
7. Add server-backed search with Postgres indexes for date, total, category, notes, merchant.
8. Keep measuring precise mode p50/p95 latency after backend region/RPC optimization.
