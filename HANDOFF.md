# Parse: AI Receipt Scanner — Handoff

Front-end for a camera-first receipt scanner. Snap a receipt → backend runs it
through a vision LLM → structured JSON → user confirms → saved by category.

**This repo is the front end only.** A separate team builds the backend; the API
contract we hand them is in [API contract](#api-contract-backend-handoff).

---

## 1. Repos & accounts

| Thing | Value |
|---|---|
| Local repo | `D:\workspace\Parse - AI Receipt Scanner` |
| GitHub | https://github.com/Imranfarid212/Parse (branch `main`) |
| Display name | "Parse: AI Receipt Scanner" (folder omits `:` — Windows forbids it) |
| Expo account | `imranfarid212` |
| EAS project | `parse-receipt-scanner` (projectId in `app.json`) |
| Bundle ID | `com.imranfarid.parse` (iOS + Android) |
| Apple team | "Afrin Malick" (individual) — PM's Apple Developer account |
| Related | Experiment repo: `D:\workspace\receipt-experiment` (model bake-off) |

**Secrets are NOT in this repo.** The OpenRouter API key lives in
`receipt-experiment/.env` (gitignored). Apple credentials live in EAS.

**Cleanup nits:** a stray EAS project `immy-boi` was created by accident (ignore
or delete on expo.dev). A `*.lnk` Windows shortcut got committed early on.

---

## 2. Stack

- **Expo SDK 57**, React Native 0.86, React 19.2, **TypeScript** (strict)
- **Expo Router** — file-based routes live in **`src/app`** (not `/app`)
- **Reanimated 4** (+ `react-native-worklets`) — all animation
- **@shopify/react-native-skia 2.6.2** — grid background, Google logo, glow effects
- **expo-camera** — the camera (see rule 4: *not* vision-camera)
- **expo-image-picker** — gallery
- **expo-blur** (`BlurView`) + **expo-glass-effect** (`GlassView`) — glassmorphism
- **@expo/vector-icons** (Ionicons)
- **@expo-google-fonts/instrument-sans** — Instrument Sans, loaded in `src/app/_layout.tsx`

**A development build is mandatory.** Expo Go cannot run Skia, the camera, or
the glass effects.

---

## 3. Running it (daily loop)

```bash
git clone https://github.com/Imranfarid212/Parse.git
cd Parse
npm install
npx expo start --dev-client
```
Then open the **Parse** dev-client app on the device and scan the QR.

- **LAN is the reliable path.** Windows needs the Metro ports open once:
  `New-NetFirewallRule -DisplayName "Expo Metro" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8081-8082` (admin PowerShell).
- **Tunnel** (`--tunnel`) works but ngrok has been flaky ("remote gone away").
- New teammates need a dev build on their device — either share the EAS
  internal-distribution build, or they run their own `eas build`.

### Rebuilding the dev client (only when native code changes)

```bash
git add -A && git commit -m "…"        # REQUIRED — see rule 3
eas build --platform ios --profile development
```
Install the resulting build from the EAS link (Safari on the device). It
**replaces** the existing Parse app — same bundle ID, not a second app.

Android has never been built. It should work (`eas build --platform android
--profile development` → APK, no Apple account needed) but needs a visual pass.

---

## 4. Rules (learned the hard way — read these)

1. **Pasted web components do not run in React Native.** Tailwind/`className`,
   CSS gradients, `framer-motion`, GSAP, DOM elements, SVG filters — none exist
   in RN. The established pattern: **rebuild the effect natively in Skia +
   Reanimated.** Done so far for: Aurora background, Animated Grid, the fan
   carousel, the rainbow glow button.
2. **Some web effects have no RN equivalent at all.** The "liquid glass"
   `feDisplacementMap`/`feImage` SVG filter cannot be ported. Use
   **`expo-glass-effect`'s `GlassView`** (Apple's real UIGlassEffect) instead —
   that's how native iOS apps do glassmorphism. It requires **iOS 26+**
   (`isLiquidGlassAvailable()`); fall back to `expo-blur`.
3. **Commit before every native rebuild.** EAS builds **from the git commit**,
   not your working tree. Uncommitted work is silently excluded — this is what
   caused the "cannot find native module camera" error.
4. **expo-camera, not react-native-vision-camera.** Vision-camera v5 is a
   low-level Nitro rewrite (hooks + outputs + session config) — far more
   complexity than a receipt scanner needs. It was installed then removed.
5. **JS-only changes hot-reload.** Only *native module* additions need a rebuild.
   Adding a new **font** may need `npx expo start --dev-client --clear`.
6. **Glassmorphism needs contrast behind it.** Glass over a blank white area
   looks flat no matter the blur intensity. `BlurView` also needs
   `overflow: 'hidden'` for `borderRadius` to clip the frost, and a
   semi-transparent white **edge border** to read as a physical pane.
   Because a shadow can't coexist with `overflow: 'hidden'`, the shadow lives on
   an **outer wrapper** view.
7. **`StyleSheet.absoluteFillObject` fails typecheck** in this RN version. Use an
   explicit `position: 'absolute', top/left/right/bottom: 0`.
8. **Deterministic logic belongs in code, not the prompt.** Date disambiguation
   (e.g. `07-04-2026`) is solved by picking the most recent non-future reading in
   code — see `receipt-experiment/src/dates.js` (unit-tested; **port it into the
   app** when wiring the backend). Keeping the LLM prompt simple reduces errors.
9. **Verification:** this is a native app, so the browser preview workflow does
   not apply. `npx tsc --noEmit` is the check; visual confirmation is on-device.
10. **Working method:** interview → spec → PM ratifies → build. Discuss before
    running experiments; wait for an explicit "go".

---

## 5. API contract (backend handoff)

The front end compresses to ~1024px JPEG (~120 KB) and POSTs the image.

`POST /extract` → returns either:

```json
{
  "date": "purchase date as printed on the receipt",
  "store": "merchant name",
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
→ the app shows "Please scan only documents and receipts" and stays on camera.

- **`date` is returned as printed**; the app normalizes to `YYYY-MM-DD` in code.
- **These 6 fields are the whole payload** (PM decision 2026-07-16). `place` was
  dropped — it was never shown or edited. The same 6 are what the review card
  displays and what the edit sheet writes.
- **Latency target: p95 < 3s** end-to-end.
- **The 10 categories:** Travel & Transit · Meals & Entertainment · Office
  Supplies · Software & IT · Vehicle Expenses · Advertising & Marketing ·
  Professional Services · Utilities & Telecom · Inventory & Materials ·
  Miscellaneous

### Validated model stack (from `receipt-experiment`, 5 runs, ~$0.40 total)

- **Pipeline B (image → vision LLM) beat OCR+text.** Desktop OCR mangled totals
  ($68 → $66); vision models read faded thermal print correctly.
- **Grok 4.5 primary + Gemini 3.5 Flash fallback**, via **OpenRouter** (one key,
  native error-fallback via the `models` list), **hedge at ~1.3s** client-side.
  Effective p95 **~1.7s**; ~**$0.40/month** for a 150-receipt power user.
- **The lean prompt is the keeper** (no free-text `notes` field — it was the
  verbosity/cost hole). Output tokens dominate cost.
- The API key must live on a **backend proxy**, never in the app binary.
- **Open:** the peak-hour reliability run was never done (the whole reason the
  experiment started — Gemini free tier failed at peak).

---

## 6. What's built

| Screen | File | State |
|---|---|---|
| Landing | `src/app/index.tsx` | Done |
| Onboarding | `src/components/OnboardingOverlay.tsx` | Skeleton (empty cards) |
| Camera | `src/app/camera.tsx` | Real camera; capture logs only |
| Menu (push drawer) | `src/components/MenuPanel.tsx` | Search tab real; others placeholder |
| Search | `src/components/search/SearchView.tsx`, `search/FanCarousel.tsx` | Dummy data |

**Flow:** Landing → (any auth button) → Onboarding overlay → "Let's go" →
Camera → Menu pill → Menu drawer.

- **Landing** — `AnimatedGridBackground` (Skia: skewed ~-12° grey grid + grey
  twinkling squares, radial fade). The squares **avoid the hero text**: the
  landing measures the headline's on-screen bounds (`measureInWindow`) and passes
  an `excludeBand`; the grid skips any square within one grid cell of it. (The
  entrance is opacity-only so the measurement stays accurate.)
- **`CreateAccountCard`** — floating frosted-glass drawer pinned to the bottom
  (4px inset): `BlurView` intensity 15 + a 10% cool-grey `#F4F5F7` tint, white
  edge border. Header "Your search ends here". Three buttons, descending weight:
  Google (dark `#2b2a2a`, **real colored Google logo rendered via Skia
  `ImageSVG`**), Apple (solid white), email (75% white). All → onboarding.
  **Placeholder — no real auth wired.**
- **Onboarding** — blurred backdrop, 3 stacked `ReceiptCard`s; swipe either
  direction tosses the top card to the bottom-left; "Let's go" appears **only on
  the 3rd** card. (A tear/crush exit animation was designed but deferred.)
- **Camera** — `expo-camera` `CameraView`, `flash="auto"` (deliberately **no
  flash button**), static guide frame, shutter, gallery button, **Default /
  One-click** mode toggle, Menu pill-card. No zoom (dropped).
- **Menu** — not an overlay: camera + menu sit on one **horizontal strip** that
  slides left, so opening the menu **pushes the camera out**. Uses an
  **"emphasized" easing** `Easing.bezier(0.5, 0, 0.2, 1)` (620ms open / 560ms
  close): zero velocity start (deliberate drag), fast middle, soft settle.
  Bottom has a 4-tab **real-glass** toggle (Export · Search · Plan · Settings)
  with a spring-sliding indicator.
- **Search** — search bar, **fan carousel** of receipt cards (tap a side card to
  swap it to centre, chevrons rotate, dots track), and a glass **Card/List**
  toggle. **Rule: >7 results forces List view** and disables the toggle.
- **`ReceiptCard`** — paper receipt look with a torn zigzag bottom; **content
  scales with `width`** (`s = width / 300`) so it reads correctly both large
  (onboarding) and small (fan carousel).

**Design system:** `src/theme/tokens.ts` — clean-fintech direction, Instrument
Sans, semantic colors, spacing, radius. Components reference tokens, not raw
values. Intended to mirror Figma Variables 1:1.

---

## 7. Open TODOs

**Blocking real functionality**
- Wire capture + gallery downstream: compress → `POST /extract` → confirmation
  screen (currently they only `console.log`).
- Port `receipt-experiment/src/dates.js` into the app.
- Backend `/extract` endpoint + the proxy that holds the OpenRouter key.
- Local persistence (SQLite/`expo-sqlite`) for receipt history — not added.

**Product decisions needed**
- What **Default vs One-click** modes actually do at capture time.
- What goes in the **Export / Plan / Settings** tabs.
- Contents of the **3 onboarding cards**.
- The camera's **right-side button** (empty placeholder; front/back flip planned).

**Deferred / nice-to-have**
- Onboarding tear-or-crush exit animation (crush is cheapest; a realistic
  crumple needs a Lottie/sprite asset).
- **Figma is out of sync** — frame `2:24` still shows the early aurora design,
  not the current grid/glass work. File key `efM2T4q54mnTjaZKWGcsXP`.
- Android build + visual pass (blur/shadows render differently there).
- Peak-hour model reliability run.
- Real Google/Apple OAuth (native config; the buttons are placeholders).
