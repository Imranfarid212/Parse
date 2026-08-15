# B9 handover — referrals and commissions

Status date: 2026-08-15

Branch: `feat/b9-referral`

Base commit: `a64e5c7`

Phase state: `locked` pending live/manual release evidence

Worktree: B9 implementation is currently **uncommitted**. Do not switch, clean,
reset or recreate the branch before committing the intended B9 changes.

## Product decisions

- Referral codes are six uppercase characters and exclude ambiguous characters.
- A successful redemption grants `+10` scans to the referrer and `+5` to the
  referred account in one atomic transaction.
- One referred account can redeem only once. A referrer is rewarded for at most
  four friends, for a maximum referral bonus of `+40` scans.
- Referral eligibility does not depend on account age, current balance or
  whether the friend has already used initial free scans.
- Paid Branch deferred-install attribution was deliberately removed. The first
  production release uses a manual invitation containing the App Store URL,
  referral code, `+5` reward and `Menu → Plan` instructions. The backend retains
  `entry_method=link` compatibility for a future provider.
- The Plan UI shows `Referral already applied · 5 extra scans received` after a
  successful redemption. Share and Apply have independent progress states.

## Implemented application flow

- Plan displays the signed-in user's code and server-owned `0/4` progress.
- Share opens the native share sheet with the configured download URL and code.
- A friend manually enters the code in Plan. Input is normalized and constrained
  to the six-character contract.
- The first Camera landing guides a newly signed-in user to `Menu → Plan`.
- Successful redemption refreshes entitlements and displays the server result.
- A previously loaded valid referral summary is retained if a later background
  refresh fails, avoiding contradictory success and error messages.

Primary files:

- `src/components/menu/PlanScreen.tsx`
- `src/lib/referrals/client.ts`
- `src/lib/referrals/integrity.ts`
- `src/lib/auth/referralPrompt.ts`
- `packages/contracts/src/referrals.ts`

## Backend and fraud controls

- `redeem_referral` serializes competing requests and atomically inserts both
  replay-safe ledger grants.
- Enforced server-side: one referral per account, self-referral block, four-
  reward cap, active-device requirement, IP/device velocity checks, attempt
  throttling, unknown-code auditing and attestation gating.
- IP evidence is HMAC-pseudonymized; raw IP addresses are not persisted.
- Blocked and replayed requests cannot create duplicate scan credits.
- Influencer commission rows are created only from released influencer
  attribution. Initial purchase and renewal use 15% of gross; refunds create a
  negative reversal tied to the original event.

Migrations deployed to staging:

- `20260815000100_b9_referrals.sql`
- `20260815000200_b9_commission_guard.sql`
- `20260815000300_b9_app_attest.sql`
- `20260815000400_b9_app_attest_optional_extensions.sql`

## Platform integrity

### iOS

- App Attest enrollment validates Apple's certificate chain, nonce, App ID,
  environment and supported build extensions.
- Referral redemption uses a new action-bound assertion, single-use challenge
  and atomic monotonic-counter advancement.
- Authenticated app admission enrolls App Attest immediately after the active
  device claim.
- Development physical-device enrollment and one manual redemption have worked.
  The iOS simulator cannot provide real App Attest and is not valid evidence.
- Production still requires a production-signed binary, production entitlement,
  production server environment and exact allowed bundle version.

### Android

- Expo App Integrity prepares the Play Integrity standard-token provider and
  produces SHA-256 request-bound tokens for signup admission and redemption.
- The server signs a service-account JWT, obtains a short-lived Google OAuth
  token, asks Google to decode the opaque token, and validates freshness,
  request hash, package, `PLAY_RECOGNIZED`, Play signing certificate, version
  code, `LICENSED` and `MEETS_DEVICE_INTEGRITY`.
- Missing configuration, Google errors and negative verdicts fail closed.
- Unit/network fixtures pass. Live testing awaits Play Console/Cloud setup and a
  licensed physical Android device on a Play test track.

Functions deployed to staging:

- `app-attest-enroll`
- `app-integrity-admit`
- `app-integrity-verify`
- `referral-redeem`

## Automated evidence

Latest `npm run gate -- b9` result: local/backend gate passed.

- TypeScript: passed.
- ESLint: zero errors; three unrelated pre-existing camera warnings remain.
- Deno: nine tests passed, including App Attest, Play request binding, negative
  verdicts and a mocked service-account OAuth/Google decode exchange.
- Staging DB T9.1–T9.5: passed, including `+10/+5`, manual/link entry methods,
  replay, self/second/fifth referral blocks, exact `+40` cap, failed attestation,
  15% initial/renewal commissions and refund reversal.

Evidence: `gates/report-b9.json`

Detailed release procedure: `docs/B9-referral-runbook.md`

## Configuration still required

### iOS release

- Set `EXPO_PUBLIC_IOS_APP_STORE_URL` to the final public listing.
- Build with `EXPO_PUBLIC_ENV=production`.
- Set production App Attest environment and allowlist the exact shipped bundle
  version.

### Android release

- Link the Play Console app to its Google Cloud project and enable Play
  Integrity.
- Set `EXPO_PUBLIC_PLAY_INTEGRITY_PROJECT_NUMBER` in the Android build.
- Create the least-privileged service account used for token decoding.
- Set `PLAY_INTEGRITY_CONFIG` using the schema in the B9 runbook, including the
  Play signing certificate digest and allowed version code.
- Publish the build to a Play internal test track. A sideloaded build is expected
  to fail while `require_licensed` is enabled.

### Influencer commission

- Finish RevenueCat/store configuration.
- Seed an influencer code using `npm run b9:influencer:seed` (dry run first).
- Execute a sandbox initial purchase, renewal and refund and retain webhook plus
  database evidence.

## Manual evidence required to unlock B9

1. With the final iOS build and App Store URL, share from account A to a new
   account B, redeem after installation, and confirm `+10` for A and `+5` for B.
2. Relaunch B and confirm a second redemption is unavailable and the applied
   status is shown.
3. Record physical-device fraud/replay evidence required by T9.2/T9.3/T9.5.
4. Complete a live Play Integrity signup and referral on a licensed Android
   physical device.
5. Complete the RevenueCat influencer initial/renewal/refund sequence.
6. Record tester, date, build numbers, integrity verdicts and database evidence;
   then change B9 from `locked` to `passed`.

## Recommended continuation order

1. Review and commit the dirty B9 worktree on `feat/b9-referral`.
2. Insert the final iOS App Store URL and run the amended T9.1 test.
3. Complete production iOS App Attest evidence.
4. Finish RevenueCat and run T9.4.
5. Configure Play Integrity and run Android evidence when the hardware/track is
   available.
6. Rerun `npm run gate -- b9`, update the evidence, and unlock the phase only
   when every required manual result is recorded.
