# Parse B3 Handover - Capture + Offline Queue

Generated: 2026-07-22 18:53 IST  
Branch: `feat/b3-capture-offline-queue`  
Base commit before B3 working-tree changes: `ae0d829d3a874b43338ea96fa42bf0225e74b6eb`

## Status

B3 is complete for Dev A + Dev B.

Automated checks passed:

- `npm run b3:all`
- `npm run gate -- b3`
- B3 app/source checks
- B3 backend `/extract` checks
- B3 DB/storage policy/schema checks

Manual device/cloud smoke tests passed in both:

- Staging Supabase project `wfboznibkhsfxteejxco`
- Production Supabase project `uhiqjbxqhhxjxnbznocc`

The gate script still prints `official device/manual evidence still pending` because it cannot automatically ingest our manual device proof. The manual proof is logged in `gates/report-b3-official.json`.

## What B3 Includes

Frontend Dev A:

- Capture path in `src/app/camera.tsx`.
- Default mode shows review card after extract succeeds.
- One-click mode can auto-confirm locally after extract succeeds.
- Failed/transport paths show "Your receipt is being processed" and leave the scan queued.
- Network listener retries pending extracts on reconnect and on camera mount.
- Local durable queue/store in `src/lib/receipts/store.ts`.
- Capture pipeline in `src/lib/receipts/capture.ts`.
- Real/mock extract client switch in `src/lib/receipts/client.ts`.
- Env fix in `src/lib/foundations/env.ts`: Expo device bundles use `EXPO_PUBLIC_MOCK_BACKEND`.

Backend Dev B:

- Supabase Edge Function: `supabase/functions/extract/index.ts`.
- B3 migration: `supabase/migrations/20260722000100_b3_capture_offline_queue.sql`.
- Follow-up grant migration: `supabase/migrations/20260722000200_b3_receipt_items_grants.sql`.
- Contract sync updates under `packages/contracts/src/*` and `supabase/functions/_shared/contracts/*`.
- B3 gate/verifier scripts under `scripts/`.

## Test Results

5/5 B3 test cases passed:

- T3.1: capture compress/orientation path.
- T3.2: enqueue all modes with unique capture ids.
- T3.3: reconnect drains pending queue.
- T3.4: backend idempotent extract ack.
- T3.5: ack gate/local retention.

Official result file:

- `gates/report-b3-official.json`

Latest generated local gate report:

- `gates/report-b3.json`

## Staging Evidence

Project ref: `wfboznibkhsfxteejxco`

Latest verified receipt:

- Receipt id: `7d4c5573-5eb9-445b-83d5-ccab6e06a1df`
- Capture id: `3908cbef-5687-4a06-a209-4343af63daf3`
- Status: `needs_review`
- Merchant: `Whole Foods Market`
- Total: `73.36`
- Image bytes: `134185`
- Image path shape: `<user_id>/3908cbef-5687-4a06-a209-4343af63daf3.jpg`
- Acked at: `2026-07-22T13:11:07.901Z`

Storage check:

- `receipts` bucket contained matching compressed object.
- Four receipt image objects were observed after staging testing, including earlier failed-then-fixed runs.

## Production Evidence

Project ref: `uhiqjbxqhhxjxnbznocc`

Latest verified receipt:

- Receipt id: `efe8c7af-aade-4218-9891-3cc90a9454ec`
- Capture id: `718bf984-55e0-4293-af5d-3dd21be14255`
- Status: `needs_review`
- Merchant: `Whole Foods Market`
- Total: `73.36`
- Image bytes: `143768`
- Image path shape: `<user_id>/718bf984-55e0-4293-af5d-3dd21be14255.jpg`
- Acked at: `2026-07-22T13:20:11.205Z`

Storage check:

- `receipts` bucket contained matching compressed object.
- One production storage object existed immediately after the production smoke test.

## Issues Found And Fixed During Device Testing

- Device bundle was still using mock backend because Expo only exposes `EXPO_PUBLIC_*` variables. Fixed with `EXPO_PUBLIC_MOCK_BACKEND`.
- `supabase.functions.invoke` plus React Native FormData failed with `Failed to send a request to edge function` and then `Unsupported formdata part implementation`. Fixed by using `expo-file-system/legacy` `uploadAsync` multipart upload.
- Backend returned `VALIDATION_FAILED` too generically. Client now surfaces backend `message` first for dev diagnostics.
- Production and staging needed `receipt_items` grants because the receipt search trigger reads `receipt_items`. Fixed with `20260722000200_b3_receipt_items_grants.sql`.

## Known Boundaries

- `receipt_items` persistence is not part of this B3 v0 function. The function returns fixture `line_items` to the app but only persists the parent `receipts` row.
- Swipe-up confirm currently updates local queue state. Server-side confirm/edit/item sync is still future backend work.
- Android was not device-tested.
- This handover was generated before the final B3 commit; check git history for the committed snapshot.
- There is a safety stash from before the main sync: `stash@{0}: On feat/b3-capture-offline-queue: b3-before-main-sync`. Do not drop it unless explicitly asked.

## Commands For Next Conversation

Run local verification:

```bash
npm run b3:all
npm run gate -- b3
```

Run staging Metro:

```bash
set -a
source .env.staging
set +a
npx expo start --clear
```

Run production Metro:

```bash
set -a
source .env.production
set +a
npx expo start --clear
```

Check staging latest receipt:

```bash
set -a
source .env.staging
set +a
supabase db query "select id, user_id, capture_id, capture_mode, image_path, image_byte_size, status, merchant, total, acked_at, created_at from public.receipts order by created_at desc limit 5" --db-url "$SUPABASE_DB_URL"
```

Check production latest receipt:

```bash
set -a
source .env.production
set +a
supabase db query "select id, user_id, capture_id, capture_mode, image_path, image_byte_size, status, merchant, total, acked_at, created_at from public.receipts order by created_at desc limit 5" --db-url "$SUPABASE_DB_URL"
```

## Suggested Next Step

Commit B3 once the user is ready, then open the next phase from a clean branch off updated `main`.
