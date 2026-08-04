# B4 Receipt Capture Architecture: V1 and V2

Date: 2026-07-28

This document captures the B4 architectural decisions for the camera receipt flow, including the V1 implementation we are keeping as the baseline and the V2 latency experiment we tried on top of it.

V1 is saved as a patch at `.codex_snapshots/b4-v1-20260728.patch`.

## Product Goal

B4 introduces two camera extraction modes:

- Balanced: the default mode for normal printed receipts. It should feel fast, avoid handwritten-note handling, use local OCR, and send text only to the LLM.
- Precise: the slower, higher-accuracy mode for receipts with handwritten notes or where image-level reasoning is required.

The UX goal for Balanced is not only backend speed. The user should see an immediate receipt card shell or draft state, then final model-confirmed fields when the backend returns.

## Shared Capture Behavior

The camera supports two capture modes:

- Default capture: user captures, sees review card, then confirms or edits.
- One-click capture: user captures and the app auto-confirms when extraction succeeds.

The app creates a client-side UUID capture id for every scan. This id is used to connect:

- The local app receipt row.
- The backend `receipts.capture_id`.
- The image path under the user folder in Supabase Storage.
- Capture metrics and attempt traces.

The expected storage path is:

```text
{user_id}/{capture_id}.jpg
```

Local rows are kept in SQLite so failed or offline scans can be retried later.

## Balanced Mode V1

Balanced V1 is the current baseline architecture.

### Flow

```text
capture photo
-> document correction / crop
-> compress to upload JPEG
-> persist compressed local file
-> insert local SQLite row
-> run local OCR
-> show conservative OCR draft
-> send OCR text to Supabase extract-balanced
-> Supabase sends text to OpenRouter Gemini
-> return normalized fields to UI
-> update local row
-> queue background image backup
-> upload image to Supabase later
```

### OCR

Balanced V1 uses local OCR before the backend call.

- iOS: Apple Vision framework via the local native module.
- Android: Google ML Kit is planned but not implemented yet. Android currently has a stub path.
- The backend receives extracted text only in Balanced mode.
- Balanced mode does not send the image to Gemini/OpenRouter.

Important V1 detail:

- OCR ran on the compressed/persisted image artifact.
- Compression target: long edge `640px`.
- JPEG quality: `0.55`.

### LLM Provider

Balanced V1 uses OpenRouter to call Gemini-family lightweight models.

Current staging config:

```text
OPENROUTER_BALANCED_MODEL=google/gemini-2.5-flash-lite
OPENROUTER_BALANCED_SECONDARY_MODEL=google/gemini-3.5-flash-lite
OPENROUTER_BALANCED_MAX_TOKENS=1000
OPENROUTER_BALANCED_HEDGE_DELAY_MS=800
OPENROUTER_TIMEOUT_MS=3500
```

The primary model starts first. The secondary model starts after the hedge delay if the primary has not already produced a valid normalized result. First valid normalized JSON wins. Losing requests are aborted where possible.

### Prompt Rules

Balanced sends OCR text with a strict JSON-only prompt.

The prompt asks for:

- `merchant`
- `txn_date`
- `currency`
- `total`
- `line_items`
- `suggested_category`
- `is_receipt`

The prompt tells the model:

- Return only valid JSON.
- Do not return markdown or prose.
- If the image/text is not a receipt, return `{"error":"not_a_receipt"}`.
- Ignore tax IDs, phone numbers, loyalty points, card/payment details, invoice numbers, and terminal numbers.
- Use the user's default currency when the receipt does not clearly imply another currency.
- Override the default currency if the receipt text shows a city, country, address, phone country code, tax system, or currency symbol that clearly indicates a different currency.
- Do not convert amounts between currencies.
- Category must be one of the app-supported categories.

### Currency Decision

The app passes `defaultCurrency` from the user's profile/bootstrap locale to the backend.

The backend prompt treats this as the default but allows model override based on receipt evidence.

Example:

- User default is USD.
- Receipt text shows Bangalore, GST, or `₹`.
- Model should return `INR`.

### Backend Persistence

Balanced V1 responds to the phone as soon as the LLM result is ready and normalized.

The heavy DB writes are intentionally moved off the hot path using Edge runtime background work:

- `receipts` upsert.
- `receipt_items` delete/insert.
- `scan_ledger` insert.

This means the UI gets fields before all backend persistence finishes.

### Background Image Backup

Balanced mode still saves the image to Supabase, but not on the UI-critical path.

After the final fields return:

```text
mark local image sync as pending_upload
-> return useful UI
-> run syncImageBackups in background
-> upload compressed image to Supabase
-> mark uploaded
-> delete local compressed file
```

If upload fails:

- The local row remains available.
- `imageSyncStatus` becomes `upload_failed`.
- Retry metadata is updated.
- Sync runs again later, including on app resume/reconnect.

If the local file is missing:

- `imageSyncStatus` becomes `missing_local_file`.
- The app does not keep retrying a file that no longer exists.

### Retry Logic

Balanced text extraction has up to 3 attempts.

Retry delays:

```text
attempt 1 failure -> wait 200ms
attempt 2 failure -> wait 500ms
attempt 3 failure -> stop and queue locally
```

Retryable statuses:

- `408`
- `422`
- `429`
- `>= 500`

Transport errors such as `fetch failed`, timeout, or connection loss are also retried.

If all attempts fail:

- The local row stays queued.
- Status becomes `llm_failed_retryable`.
- `attempts` increments.
- `next_retry_at` is set with exponential backoff.
- The app can retry later through `retryPending`.

### Fallback Logic

Balanced mode fallback rules:

- If local OCR returns text, send text to `extract-balanced`.
- If local OCR is unavailable or empty, the app falls back to the Precise/image extraction path.
- Balanced does not use Grok as an immediate backup for normal text-mode failures.
- Balanced text calls retry Gemini/OpenRouter first according to the retry policy.
- Grok/image fallback is not part of the Balanced hot path.

### Non-Receipt and Duplicate Handling

If backend returns non-receipt:

- Remove local row.
- Delete local image file.
- Show the user: `Please scan only documents and receipts`.

If backend returns duplicate:

- Remove local row.
- Delete local image file.
- Show duplicate notice.

### UI Behavior

Balanced V1 shows a receipt review shell immediately in Default capture mode.

The UI behavior is conservative:

- Do not show guessed totals before Gemini returns.
- Do not show guessed items before Gemini returns.
- Do not show guessed category before Gemini returns.
- OCR draft may show merchant/date/currency only.
- Unknown fields stay as animated placeholders until final model data arrives.

The first animation attempt used pulsing placeholder bars. This was too subtle.

The second animation attempt used a moving scan line. This looked flaky because it reset and stuttered.

The current V1/V2 UI direction is a receipt-print style placeholder:

- Rows fade/slide in sequentially.
- The loop suggests the receipt is printing.
- Final values replace placeholders only after Gemini returns.

### V1 Measurements

Representative V1 measurements:

Best clean recent V1:

```text
total_to_ui_ms: 2350ms
document_correction_ms: 99ms
compression_ms: 36ms
local_file_ms: 3ms
local_row_ms: 1ms
local_ocr_ms: 213ms
backend_extract_ms: 1965ms
image_backup_ms: 5161ms
```

Backend split:

```text
client backend request: 1962ms
server total: 1843ms
auth: 658ms
model: 1182ms
network gap: 119ms
```

Another good V1 run:

```text
total_to_ui_ms: 2510ms
backend request: 2108ms
server total: 1622ms
auth: 221ms
model: 1397ms
network gap: 486ms
```

V1 conclusion:

- Best final UI was around `2.35s`.
- Draft/shell was visible around `0.35s-0.40s`.
- Model time was usually around `1.1s-1.9s`.
- Auth and network variance caused major swings.

## Precise Mode

Precise mode is for handwritten notes or when accurate image-level extraction matters more than speed.

### Flow

```text
capture image
-> warn user this may take longer
-> send image to Supabase
-> Supabase sends image to Grok path
-> Grok extracts text and categorizes
-> Supabase saves image and extracted details
-> UI receives saved result
```

Precise is not optimized for sub-2s UX. It is the quality path.

### Precise User Messaging

When user selects Precise mode, the app shows an alert before capture/extraction to set expectation that it may take longer.

### T4.2 Latency Acceptance

The product latency gate is mode-specific:

- Balanced uses the live 20-receipt golden run. Its automated latency metric is
  the host-to-server round-trip average, with a threshold of `2500ms`. p50,
  p95, and max are retained for diagnosis but are not pass/fail criteria.
- Precise uses the direct Grok/image path. Its end-to-end metric is the app's
  `total_to_ui_ms`, with an average threshold of `4500ms` for the current B4
  gate. This requires a physical-device run; a text-only golden harness must
  not claim to have tested it.

The Precise threshold intentionally reflects the user warning shown before the
capture. It is a quality path, not a sub-two-second path. The threshold can be
tightened after the remaining product phases are complete.

### Precise Persistence

Precise saves both:

- Image.
- Extracted text/details.

Unlike Balanced, image upload is part of the Precise extraction path.

## Offline and Failure Cases

### Case 1: No Internet or Poor Internet

The app keeps the captured image and local row with a unique capture id.

When connectivity returns:

- The app retries unsynced rows.
- If backend does not have a record for the capture id, the app sends it.
- Balanced can rerun local OCR and send text to the backend.
- On user confirmation or one-click success, result syncs to the backend.

### Case 2: Image Stored but LLM Fails

The user should be notified that processing is delayed.

The local row remains available and retryable.

Planned recovery policy:

- Retry lightweight Gemini/OpenRouter calls first.
- If still failing after a longer delay, backend can route image to the slower high-accuracy model path.
- User can view processed receipt later in Recents once it lands.

### Additional Covered Cases

- Local OCR empty: fall back to image/Precise extraction.
- Network request aborted/lost: retry Balanced text request up to 3 attempts.
- Backend returns invalid JSON from one model: hedged secondary model can still win.
- Backend returns non-receipt: remove local scan and show notice.
- Backend returns duplicate: remove local scan and show duplicate notice.
- Background image upload fails: keep local row and retry later.
- Local image file missing during backup: mark as `missing_local_file`.
- Metrics upload fails: do not block UI; log in development only.

## Metrics and Instrumentation

The app records summary metrics in `receipt_capture_metrics`.

Important fields:

- `document_correction_ms`
- `compression_ms`
- `local_file_ms`
- `local_row_ms`
- `local_ocr_ms`
- `backend_extract_ms`
- `total_to_response_ms`
- `total_to_ui_ms`
- `image_backup_ms`
- `metrics_upload_ms`

Attempt-level traces are stored in `receipt_capture_attempts`.

Important fields:

- `attempt_number`
- `duration_ms`
- `status_code`
- `error_message`
- `retry_delay_ms`
- `server_total_ms`
- `server_auth_ms`
- `server_body_ms`
- `server_model_ms`
- `server_normalize_ms`
- `network_gap_ms`

Metro also logs `[capture:latency]` events in development.

## Balanced Mode V2 Experiment

V2 was introduced to test the advice that the hot path should reduce connection variance, avoid unnecessary compression before OCR/backend, and warm the Edge Function early.

### V2 Goals

- Keep V1 recoverability and accuracy.
- Warm the edge function while local work is happening.
- Run OCR on better pixels.
- Move compression off the OCR-critical path.
- Measure whether this improves final UI latency and consistency.

### V2 Flow

```text
capture photo
-> immediately dispatch Balanced warm-up request
-> document correction / crop
-> start compression in parallel
-> run OCR on corrected full-resolution image
-> show conservative OCR draft
-> wait for compressed image only before local persistence
-> persist compressed local file
-> insert local SQLite row
-> send OCR text to Supabase extract-balanced
-> return normalized fields to UI
-> queue background image backup
```

### Warm-Up Decision

V2 calls `extractClient.warmUpBalanced()` at capture start.

Implementation:

- Client sends an `OPTIONS` request to `/functions/v1/extract-balanced`.
- It includes the Supabase anon key.
- It does not include receipt data.
- It is best effort.
- If it fails, capture continues normally.

Purpose:

- Warm the Edge Function isolate.
- Open/warm the phone-to-Supabase path.
- Reduce variance from cold starts or connection setup.

Observed:

- The warm-up path returned HTTP 200 in staging smoke test.
- Latest V2 scan showed network gap of `232ms`, which is acceptable.

### OCR Image Decision

V1 OCR used the compressed/persisted image.

V2 OCR uses:

```text
corrected full-resolution image if document correction succeeded
otherwise original captured image
```

Reason:

- Dense receipt text can lose detail when downscaled to 640px.
- Better OCR input may improve merchant/item/date extraction quality.

Tradeoff:

- OCR became slower on the tested receipt.
- V1 local OCR was around `213ms`.
- Latest V2 local OCR was `607ms`.

Conclusion:

- Full-resolution OCR may be a quality win, but it is not a default latency win.
- A future V2.1 should test a mid-size OCR image instead of full-res or 640px.

### Compression Decision

V2 starts compression after document correction but does not wait for it before starting OCR.

Compression still uses:

```text
TARGET_LONG_EDGE=640
JPEG_QUALITY=0.55
```

Purpose:

- Keep upload images small.
- Keep background image backup cheap.
- Avoid using the compressed artifact for OCR by default.

Important safety decision:

- We still wait for compression and local file persistence before backend extraction.
- This keeps crash/offline recovery safe because the local row exists before network extraction starts.

Potential future speed decision:

- Backend request could start before compressed local persistence.
- That would save a few more ms but weakens crash recovery unless we add another durable pre-row mechanism.

### Auth Fast Path

V2 adds optional local JWT verification in `extract-balanced`.

Behavior:

- If `SUPABASE_JWT_SECRET` or `JWT_SECRET` is configured, the function verifies HS256 JWT locally.
- If local verification succeeds, `auth_method` becomes `local_jwt`.
- If local verification is unavailable or fails, it falls back to Supabase `getClaims`.
- If claims validation fails, it falls back to `getUser`.

Security decisions:

- Malformed JWT decode errors fail closed and fall back.
- Expired JWTs are rejected from local verification.
- Signature comparison uses a timing-safe equality check.

Current staging observation:

- Latest V2 scan still reported `auth_method: claims`.
- That means local JWT secret is not currently configured in staging Edge Function secrets.
- Auth still cost `820ms` in the latest scan.

### V2 Measurements

Latest V2 scan:

```text
total_to_ui_ms: 3144ms
balanced_warmup_dispatched: 5ms
document_correction_ms: 165ms
compression_ms: 44ms
local_ocr_ms: 607ms
local_file_ms: 43ms
local_row_ms: 4ms
backend_extract_ms: 2318ms
image_backup_ms: 4600ms
```

Backend split:

```text
client backend request: 2302ms
server total: 2070ms
auth: 820ms
model: 1245ms
network gap: 232ms
auth_method: claims
```

V2 conclusion:

- Warm-up appears to keep network gap reasonable.
- Full-resolution OCR increased local hot-path time.
- Auth remains a major problem because local JWT verification is not active in staging.
- Latest V2 was slower than best V1.

## V1 vs V2 Summary

| Area | V1 | V2 |
| --- | --- | --- |
| Warm-up | None | `OPTIONS` request at capture start |
| OCR image | Compressed/persisted 640px JPEG | Corrected full-resolution image |
| Compression | Before OCR | In parallel with OCR |
| Local row | Before OCR/backend | Before backend, after OCR/compression |
| Backend request | Starts after OCR | Starts after OCR and local row |
| Auth | Supabase claims/getUser | Optional local JWT, fallback to claims/getUser |
| Network variance | Can spike | Warm-up reduces some variance |
| OCR quality | Faster but may lose detail | Better input, slower |
| Best measured final UI | `2.350s` | Latest measured `3.144s` |
| Product value | Faster baseline | Quality/variance experiment, not yet faster |

## Current Recommendation

Keep V1 as the baseline and keep V2 as an experiment.

Do keep:

- Warm-up request.
- Background image backup.
- Async backend persistence.
- Conservative draft UI.
- Hedged model race.
- Attempt traces and latency metrics.

Reconsider before making V2 default:

- Full-resolution OCR on the hot path.

Recommended next experiment:

```text
document correction
-> create mid-size OCR image, larger than 640px but smaller than full-res
-> OCR mid-size image
-> backend text request
-> compress 640px upload artifact in parallel/background
```

This should try to balance:

- Better OCR quality than V1.
- Faster OCR than full-res V2.
- Same backend payload size.
- Same offline recovery.

## Streaming Decision

Streaming has not been implemented yet.

The architectural idea is still valid for a later V2/V3:

```text
stream merchant
-> stream date
-> stream total
-> stream category
-> stream items last
```

Reason:

- Long receipts increase output tokens.
- Complete JSON under 2s for every receipt is unrealistic.
- A useful populated screen under 2s is realistic if key fields arrive first.

But streaming is a larger contract change because:

- The Edge Function response format changes.
- Client parsing must handle partial fields.
- UI must distinguish streamed preliminary fields from final normalized result.
- Error/retry behavior must remain clean.

For now, streaming should be treated as a separate milestone, not part of the low-risk V2 hot-path experiment.

## Final Decision as of V2 First Pass

Balanced mode should optimize for perceived speed and reliable correctness:

- Immediate shell/draft UI.
- Text-only LLM extraction.
- No fake totals/items before model confirmation.
- Background image persistence.
- Recoverable local-first storage.

Complete final JSON consistently under 2s is not guaranteed with the current model/auth/OCR stack, especially for long receipts.

The better production target is:

```text
useful receipt screen under 2s
final receipt data as soon as backend completes
background persistence and retry for everything non-critical
```
