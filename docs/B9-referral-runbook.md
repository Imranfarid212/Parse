# B9 referrals and commissions — release runbook

This document separates verified staging evidence from the vendor configuration
and physical-device evidence still required to unlock B9. Missing integrity
configuration always fails closed and never grants scans.

## Implemented and verified on staging (2026-08-15)

- Six-character user codes, Plan progress (`0/4`), manual redemption, first-
  Camera guidance and App Store invite sharing are implemented.
- `redeem_referral` releases attribution and inserts both idempotent ledger
  grants in one transaction: `+10 referral_bonus` for the referrer and
  `+5 referred_signup` for the friend.
- One referral per referred account, self-referral prevention, four rewarded
  referrals per user code, IP/device velocity flags, attempt throttling and
  replay-safe ledger constraints are enforced server-side.
- iOS App Attest enrollment validates Apple's certificate chain, nonce, App ID,
  environment and optional iOS 26 build extensions. Redemption requires a new
  action-bound assertion and advances the monotonic counter atomically.
- Authenticated iOS app admission now enrolls App Attest immediately after the
  active-device claim. Referral release still requires its separate assertion.
- Android signup admission and referral redemption now use Google Play Integrity
  standard tokens bound to their exact trusted request contexts. The verifier
  code and negative-verdict fixtures are complete; Play configuration and live
  physical-device evidence remain pending.
- RevenueCat initial purchase, renewal and refund events create 15% influencer
  commission entries only for released influencer attribution.
- Migrations `20260815000100` through `20260815000400` and functions
  `app-attest-enroll`, `app-integrity-admit`, `app-integrity-verify`, and
  `referral-redeem` are deployed to staging.
- `npm run b9:db:verify` passed T9.1–T9.5 on staging, including code/link entry
  methods, `+10/+5`, self/second/fifth blocks, failed attestation, concurrent
  replay, influencer initial/renewal commission and refund reversal.

There is deliberately no account-age, existing-scan-balance or first-scan
eligibility rule. The contractual controls are one referral per referred
account, self-referral prevention, the referrer's four-reward cap, velocity
checks and platform attestation.

## 1. Product amendment — manual App Store invitation

On 2026-08-15 the product owner approved replacing the paid Branch deferred-
install flow with an explicit manual invitation for the initial production
release. `Share invite` sends:

- a short description of Parse;
- the configured iOS App Store URL;
- the six-character referral code; and
- the exact instruction `Menu → Plan` plus the `+5` friend reward.

Set `EXPO_PUBLIC_IOS_APP_STORE_URL` to the final public listing before release.
If it is absent, sharing remains functional and omits a broken URL in favour of
the text `Download Parse from the App Store.`

The friend may use initial free scans before redeeming. Account age, scan usage
and current balance are not eligibility rules. Redemption remains available
until the account has used another referral, and remains subject to self-
referral, four-reward, velocity and platform-integrity controls.

This is an intentional deviation from the original T9.1 Branch wording. True
automatic attribution across an App Store installation is not claimed. The
backend retains `entry_method=link` compatibility so a deferred-link provider
can be added later without changing reward or fraud semantics.

## 2. Platform integrity

### iOS App Attest

Client build value:

- `EXPO_PUBLIC_APP_ATTEST_ENROLL_URL` — URL of `app-attest-enroll`

Edge Function secrets/config shared by enrollment and verification:

- `APP_ATTEST_APP_ID_PREFIX` — Apple Team/App ID prefix
- `APP_ATTEST_BUNDLE_ID=com.imranfarid.parse`
- `APP_ATTEST_ENVIRONMENT=development` on staging, `production` in production
- `APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES` — comma-separated allowed values
- `APP_ATTEST_ALLOWED_BUNDLE_VERSIONS` — comma-separated shipped build versions
- `APP_ATTEST_CHALLENGE_TTL_SECONDS` — optional, clamped to 60–600 seconds
- `APP_INTEGRITY_VERIFIER_URL` — URL of `app-integrity-verify`
- `APP_INTEGRITY_VERIFIER_AUTH` — random internal bearer secret, identical on
  `referral-redeem` and `app-integrity-verify`
- `REFERRAL_IP_HASH_SECRET` — at least 32 random bytes

The staging client and entitlement use the development App Attest environment.
Production requires a newly signed binary with `EXPO_PUBLIC_ENV=production`,
the production entitlement, the production server environment and the exact
allowed bundle version. Do not reuse development App Attest keys in production.
Development-only verifier reasons are suppressed when the environment is
`production`.

### Android Play Integrity — implemented, configuration and live evidence pending

Set the client build value:

- `EXPO_PUBLIC_PLAY_INTEGRITY_PROJECT_NUMBER`

Deploy `app-integrity-admit` and the updated `app-integrity-verify`. Configure
`PLAY_INTEGRITY_CONFIG` as raw JSON or base64-encoded JSON with this schema (the
service-account values come from the Google Cloud project linked in Play
Console):

```json
{
  "package_name": "com.imranfarid.parse",
  "service_account": {
    "client_email": "play-integrity-verifier@PROJECT.iam.gserviceaccount.com",
    "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
    "token_uri": "https://oauth2.googleapis.com/token"
  },
  "allowed_certificate_sha256_digests": ["BASE64URL_PLAY_SIGNING_CERT_SHA256"],
  "allowed_version_codes": ["1"],
  "max_token_age_seconds": 120,
  "require_licensed": true
}
```

The server exchanges a signed service-account JWT for a short-lived OAuth token,
asks Google to decode the opaque standard token, and validates freshness, the
trusted request hash, package, `PLAY_RECOGNIZED`, Play signing certificate,
version code, `LICENSED`, and `MEETS_DEVICE_INTEGRITY`. Signup uses
`signup_integrity:user_id:device_id`; referral redemption uses
`referral_redeem:user_id:device_id:code:entry_method`. Both paths fail closed on
missing configuration, Google outages, malformed payloads, or negative verdicts.

The implementation and fixture tests are complete. Live evidence still requires
the app in a Play test track, the linked Cloud project and service account, the
Play signing digest, an allowlisted version code and a physical licensed Android
device. A sideloaded development build is intentionally rejected when
`require_licensed` is true.

## 3. Influencer and RevenueCat

Create an influencer code with a dry run first:

```sh
INFLUENCER_CODE=ABC234 INFLUENCER_PAYOUT_CONTACT=... npm run b9:influencer:seed
```

Add `-- --apply` to insert it. Production additionally requires
`--allow-production`. Use a RevenueCat/store sandbox purchase for the attributed
account, then a renewal and refund. Confirm positive 15% initial/renewal rows and
one negative reversal referencing the original event. Database fixtures already
verify the calculation; this test verifies the live webhook mapping and vendor
delivery.

## 4. Required release evidence

### T9.1-amended — shared invitation and delayed manual redemption

1. On account A, tap Share invite and confirm the message contains the App Store
   URL, A's six-character code, `+5` reward and `Menu → Plan` instructions.
2. Send it through WhatsApp/iMessage to the tester, install/open Parse, sign in
   as a different account B and finish categories.
3. Confirm Camera points B to Menu → Plan. Use some initial scans if desired,
   then return to the original message, copy the code and apply it in Plan.
4. Confirm `entry_method=code`, one released referral, `+10` to A and `+5` to B.
5. Relaunch and confirm the referral cannot be applied a second time.

### T9.2/T9.3/T9.5 — code, fraud and replay drill

1. Enter a six-character code in Plan and confirm immediate release with
   `entry_method=code`.
2. Exercise self-referral, a second code on one account, a fifth rewarded user,
   failed integrity and the same redemption invoked concurrently. Confirm zero
   illicit grants and no duplicate ledger rows.

### T9.4 — live commission path

Run the RevenueCat initial purchase, renewal and refund sequence described above
against a sandbox store account attributed to an influencer code.

Record tester, date, build number, shared invitation text, platform-integrity
verdict and database evidence for each manual test. Keep B9 locked until the
amended iOS share/install/manual-redemption test, live Android Play Integrity
path and live RevenueCat commission test are green.

## 5. Automated gates

```sh
npm run b9:app
npm run b9:backend
npm run b9:deno
npm run b9:db:verify
npm run gate -- b9
```

`b9:db:verify` requires `SUPABASE_DB_URL` and creates isolated test users that it
removes before exit. The generated database contract must include
`app_attest_challenges`, `app_attest_keys`, `extensions_present`,
`claim_app_attest_challenge`, `advance_app_attest_counter` and
`prune_app_attest_challenges`.
