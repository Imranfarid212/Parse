# B7 — Export: handover

Branch `feat/b7-export-receipts`. Gate: **5/5 local**, `gates/report-b7.json`.
Design rationale and the decisions made along the way: `docs/decision-log.md`,
DL-005 (how it works) and DL-006 (the file formats, revised after review).

## What exists now

Filtered receipts leave the app as files, grouped by currency, built server-side
from SQL truth and delivered asynchronously.

| Piece | Where |
|---|---|
| Contracts: job lifecycle, artifacts, file names, 7-day TTL | `packages/contracts/src/{enums,schemas,types,exports}.ts` |
| Migration: claiming, leases, retention, the export read path | `supabase/migrations/20260805000100_b7_export_jobs.sql` |
| Migration: the job's timezone | `supabase/migrations/20260806000100_b7_export_timezone.sql` |
| Builders: xlsx, PDF statement, images PDF | `supabase/functions/_shared/exports/{workbook,statement,images,money,dates}.ts` |
| Job runner shared by the function and the sweeper | `supabase/functions/_shared/exports/run.ts` |
| `POST /export` | `supabase/functions/export/index.ts` |
| Sweeper: claims due export jobs, purges expired files | `supabase/functions/sweeper/index.ts` |
| Client: start, watch, download, retry | `src/lib/receipts/exports.ts` |
| Export screen | `src/components/menu/ExportScreen.tsx` |
| Shared filter sheet (Search + Export) | `src/components/receipt/ReceiptFilterSheet.tsx` |

**The shape of a run.** `POST /export` authenticates, validates, commits an
`export_jobs` row and returns 202 with the job — never a file. It then claims
that job and builds it inline as background work. If the instance dies, the lease
expires and the 30-second sweeper finishes it. The client watches the row over
Realtime; `queued → running → done | failed` is the progress, and nothing about
it is invented on the device.

**A job's state is derived, not read.** `exportState()` returns `ready` only when
the job has artifacts and has not expired; a `done` job whose seven days are up
renders as "Download expired" with an *Export again* button rather than an empty
"Ready to download". This is the normal end of every export's life, not an error.

**Money never crosses currencies.** `subtotalFor` and `categoryTotalsFor` take a
single-currency group and throw if handed a foreign row, so there is no function
that can return one number for a mixed set. The workbook goes further and gives
each currency its own sheet, so no sheet even holds two. The statement prints the
reason a combined total is absent.

**File shapes** (revised 2026-08-06, DL-006):

- **xlsx** — one sheet per currency, named for it. Columns are Date, Merchant,
  Category, Currency, Amount, Notes; the header row is bold on `D8E4BC` with
  filter dropdowns. Dates are real date cells shown `dd/mm/yyyy`, amounts are
  real numbers shown `0.00`. No receipt ids, no line items, no subtotal rows.
- **PDF statement** — no cover title. A section per currency, per-category totals
  inside it, table headers on the same olive fill. Dates `dd/mm/yyyy`; the
  generated time is rendered in the device's timezone and labelled, e.g.
  `05/08/2026 11:15 PM GMT+5:30`. The client sends its IANA zone, the job stores
  it, and an export without a usable one falls back to UTC rather than failing.
- **images PDF** — page per image, date-ordered, captions with the readable date.
- Files are named `parse_export_YYYY-MM-DD.{xlsx,pdf}` and `..._images.pdf`.

## Running it

```bash
supabase start -x vector && supabase db reset
npm run gate -- b7
```

Individual pieces:

```bash
npm run b7:app        # static: screen, client library, shared filter sheet
npm run b7:backend    # static: migration, function, builders, contract parity
npm run b7:builders   # Deno: builders, job runner, request validation (24 tests)
npm run b7:db:verify  # live database: lifecycle, leases, RLS, purge (12 tests)
npm run b7:e2e        # seed → export → download → diff against SQL (5 tests)
```

`b7:db:verify` and `b7:e2e` find the local stack through `supabase status`, so
they need no exported variables. Point either at a deployed project with
`B7_DB_ENV_FILE=.env.staging` / `B7_E2E_ENV_FILE=.env.staging`; both refuse the
project named in `.env.production`.

The e2e harness runs in two modes. It defaults to `direct`, driving the job
runner in-process, because local `supabase functions serve` does not boot in this
repo's environment — the edge-runtime container fails the same way at
`supabase start`, which is why B4 and B5 verify functions over HTTP against
staging. Once the function is deployed, `B7_E2E_MODE=http` runs the identical
assertions through the real endpoint.

## Gate evidence

| ID | What was proven | How |
|---|---|---|
| T7.1 | Filtered xlsx over 150 receipts in 3 currencies diffs clean against the database: one sheet per currency, every row on a sheet in that currency, per-sheet totals matching SQL, styled headers, no receipt ids, no line items | `b7:e2e` parses the file back with SheetJS |
| T7.2 | PDF per-category totals inside each currency section match SQL; no cross-currency total appears anywhere | `b7:e2e` extracts the PDF's text and checks every category against SQL |
| T7.3 | Images PDF holds exactly the filtered images, date-ordered | `b7:e2e` compares page count and caption order against the SQL row order |
| T7.4 | `queued → done` observed on the row; job and signed link both carry the 7-day horizon; the purge ends access; a failed job is retryable by its owner | `b7:e2e` + `b7:db:verify` |
| T7.5 | 1,000 receipts export without blocking the request; 120 images auto-chunk into 3 parts of 50/50/20 | `b7:e2e` |

Three defects were found by running these rather than reading them, and are
fixed: `export_jobs` had no table grants (its B1 RLS policy was unreachable),
`purge_expired_exports` had OUT parameters shadowing the columns it selects (the
same failure mode as `can_scan` in B4), and `retry_export_job` needed to be
security definer so the client would not require a write grant.

## Staging

Deployed to `receiptflow-staging` (`wfboznibkhsfxteejxco`) on 2026-08-05, and
`export` redeployed on 2026-08-06 with the revised file formats:

- migration `20260805000100_b7_export_jobs.sql` pushed (it was the only pending one);
- `export` deployed, and `sweeper` redeployed since it now claims export jobs and
  purges expired files.

Both suites pass against it:

```bash
B7_DB_ENV_FILE=.env.staging  npm run b7:db:verify              # 12/12
B7_E2E_ENV_FILE=.env.staging B7_E2E_MODE=http npm run b7:e2e   # 5/5
```

Deploys must use `--use-api`. The Docker-based bundler cannot run here (the same
edge-runtime container that fails at `supabase start`), and the server-side
bundler refuses imports from hosts outside its allow-list — `cdn.sheetjs.com`
among them, which is why the test-only SheetJS copy is vendored and why
`b7:backend` fails any CDN import in function code. The workbook itself is
written with `xlsx-js-style` from esm.sh, an allowed host.

Staging found two things worth knowing, both fixed (DL-005):

- A 1,000-receipt / 120-image export used to exceed one edge-function invocation
  and complete via sweeper recovery on attempt 2. Image downloads now run eight
  at a time and it finishes inline in ~88 s; the 150-receipt case went 31 s → 12.6 s.
- Storage is CDN-backed on a hosted project, so a signed URL fetched moments
  earlier keeps serving after the object is deleted. The expiry assertions now
  test the token's own expiry and Storage's authoritative view instead.

## What is left before B7 flips to passed

1. **The manual integration step the playbook asks for**: open a mixed-currency
   xlsx in Excel and the statement PDF in a reader on-device, and confirm the
   share sheet saves a file. Record tester and date in the gate report.
2. **Flip `gates/phases.json`** b7 to `passed` on a green gate workflow.

## Things a reader should know

- **`db.types.ts` was regenerated** with the CI-pinned CLI (2.109.1). The
  committed file had been generated by a different version and had drifted well
  beyond B7 — it was missing B6's `active_receipts` relationships entirely. The
  regenerated types describe RPC arguments as non-null even where the SQL
  declares `default null`, so `searchServer` now omits unset filters (identical
  at runtime) and the three genuinely-nullable arguments in
  `update_receipt_with_items_v2` are asserted at the call site with a comment.
- **The B6 filter sheet moved** to `ReceiptFilterSheet.tsx` so Export and Search
  share one contract. `verify-b6-app.js` now asserts those claims against the new
  file — the same claims, the same strictness, a different path.
- **B5 and B6 were added to the gate runner**, which had only known b1–b4.
  `npm run gate -- b5` needs staging credentials for its durable-job database
  checks; `gate -- b6` runs locally.
- **Fonts are checked in as base64 TypeScript** (`_shared/exports/fonts/`,
  SIL OFL 1.1, ~310 KB). Regenerate with `npm run b7:fonts` — it needs `python3`
  with `fonttools` and network access. They are modules rather than `.ttf` files
  because a real import is guaranteed to survive function bundling, and a font
  that fails to load turns every PDF export into a 500.
- **Known gap:** merchant names in CJK, Indic or Arabic scripts render as the
  font's missing-glyph box in PDFs. Latin, Latin Extended, Greek and Cyrillic are
  covered. Recorded in DL-005 as a v1.1 item.
