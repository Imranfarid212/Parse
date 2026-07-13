# Parse: AI Receipt Scanner — Front-End Spec

**Status:** Draft — awaiting PM ratification
**Date:** 2026-07-13
**Owner:** Claude (engineer) / Imran (PM)
**Folder:** `D:\workspace\Parse - AI Receipt Scanner` (display name "Parse: AI Receipt Scanner"; folder omits the `:` which Windows forbids)

## What Parse is

A camera-first mobile app: open it, it's already a camera aimed at a receipt.
Snap → the image goes to a backend that runs it through a vision LLM →
structured JSON comes back → the user confirms/edits → it's saved and sorted
into expense categories. Front end only; a separate team builds the backend.
Our job includes **defining the API contract** they build against.

Provenance: architecture validated over 5 runs in `D:\workspace\receipt-experiment`.

## Platform & stack

- **Expo (managed) + development build.** Dev builds render the Skia shaders,
  blur, and effects that Expo Go cannot; production ships via EAS Build. Expo
  is fully production-grade — the dev build is just the daily-driver flavor.
- **Language:** TypeScript, strict.
- **Camera:** `react-native-vision-camera` (Expo config plugin) — production
  capture, flash/torch control, tap-to-focus. Basic `expo-camera` is the
  fallback if a plugin issue blocks us.
- **Visual effects:** `react-native-skia` for shaders/gradients/glow.
- **Navigation:** Expo Router (file-based).
- **State/storage (v1):** local only. Receipts persist on-device (SQLite via
  `expo-sqlite`, images in app document dir). No accounts, no cloud in v1.
- **Backend:** **mock API layer** now — a local async function returning the
  exact JSON contract below. Swapping in the real endpoint later is a one-line
  base-URL change. Mirrors how Propzo New Design used mock data.

## Parallel Figma + code workflow

Design in Figma and implement in RN **at the same time, screen by screen**,
both anchored to one shared source of truth:

- **Design tokens are the contract.** Color, type scale, spacing, radius,
  shadow, and shader parameters are defined once and mirrored on both sides —
  Figma Variables ⇄ a `theme/tokens.ts` module. Neither side invents values.
- **Build order:** (1) establish tokens + core primitives (Button, Card,
  Screen shell, the shader/gradient backdrop) in Figma and code together;
  (2) then go screen by screen — design a screen in Figma, implement it in RN,
  reconcile, move on. Keeps the two from drifting.
- Figma is created from scratch via the Figma MCP; code and design stay synced
  as we go.

## Screens & flow (v1)

First launch: **Landing → Onboarding (multi-screen) → Camera.**
Every launch after onboarding: straight to **Camera** (the default screen).

1. **Landing** — brand moment; entry into onboarding. Showcase surface for the
   shader/effect language.
2. **Onboarding** — a few screens explaining scan → auto-extract → track by
   category. Ends by requesting camera permission. Seen once (persisted flag).
3. **Camera** (home) — live preview, capture button, flash/torch toggle,
   entry to Settings. Auto-frames the receipt.
4. **Processing / Confirmation** — after capture: compress image, send, show a
   brief processing state, then an **editable card** of the extracted fields
   for the user to confirm or correct before saving. Non-receipts show
   "Please scan only documents and receipts" and return to camera.
5. **Settings** — entry point that opens **Receipts (history)**: the saved
   list, viewable on-screen, grouped/sortable by category with totals.

## Data model & API contract (hand-off to backend team)

Front end compresses to ~1024px long-edge JPEG (~120 KB) before sending.

`POST /extract` (image payload) → returns either:

```json
{
  "date": "purchase date as printed on receipt",
  "store": "merchant name",
  "place": "city/location or empty string",
  "items": ["item name and price per line"],
  "total": 0.00,
  "category": "one of the 10 categories",
  "handwritten_notes": "handwritten text or empty string"
}
```

or, for a non-receipt image:

```json
{ "error": "not_a_receipt" }
```

- **Date** is returned as printed; the app normalizes it to `YYYY-MM-DD` in
  deterministic code (most-recent non-future reading — logic already written
  and unit-tested in `receipt-experiment/src/dates.js`, ports in as-is).
- **Latency target:** p95 < 3s end to end (validated ~1.7s with the ratified
  model stack: Grok 4.5 primary + Gemini 3.5 Flash fallback, 1.3s hedge).
- **Categories (10):** Travel & Transit · Meals & Entertainment · Office
  Supplies · Software & IT · Vehicle Expenses · Advertising & Marketing ·
  Professional Services · Utilities & Telecom · Inventory & Materials ·
  Miscellaneous.

Local stored record adds: `id`, `capturedAt`, local `imageUri`, normalized
`date`, and an `edited` flag (did the user correct any field).

## v1 scope

In: the five screens above, capture→extract→confirm→save, on-device history
with category totals, the shader/effect visual system.

Out (later): accounts/cloud sync, export (CSV/PDF), search/filter beyond
category, multi-currency handling, budgets/analytics.

## Open decisions for PM

1. **Visual direction** — the one blocker to starting the Figma (asked
   separately). Drives the whole design system.
2. History depth in v1 — simple list grouped by category with totals, or also
   per-receipt detail view? (Assuming both: list + tap-through detail.)
3. Currency — receipts so far are CAD + one INR. Store a currency code per
   receipt, or assume one? (Assuming: store the symbol as seen, no conversion.)
