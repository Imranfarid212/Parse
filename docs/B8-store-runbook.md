# B8 — store setup runbook

Everything that has to exist outside the repository before B8's gate can print
5/5. Nothing here is in git, and nothing here should be: every value produced
below is a secret or an account setting.

The code is already written and its local gate is green. What is missing is the
three accounts. Work top to bottom — RevenueCat needs the store products to
exist, and the app needs RevenueCat.

**One rule throughout: paste secrets into `.env` (already gitignored) or into the
Supabase dashboard. Never into a file that git tracks, never into chat, never
into `.env.example` — that file holds names only.**

---

## Path A — Test Store (no Apple/Google account needed)

Use this to test the whole money path **today**. RevenueCat's Test Store
simulates purchases: real SDK calls, real offerings and prices, real
entitlements, real webhooks. Skip sections 1 and 2 entirely.

1. In RevenueCat, use the **Test Store** app and copy its API key.
2. `.env`:
   ```
   EXPO_PUBLIC_RC_TEST_KEY=<test store key>
   ```
   Leave `EXPO_PUBLIC_RC_APPLE_KEY` / `EXPO_PUBLIC_RC_GOOGLE_KEY` empty. A
   platform key always wins where one exists, so adding the real keys later
   switches over with no code change.
3. Create the 8 **products** directly in RevenueCat (Product catalog → Products
   → Test Store), using the IDs and prices in the matrix below. No store review,
   no App Store Connect.
4. Create the `pro` / `max` entitlements and the `default` / `promo` offerings
   exactly as in section 3 — identical for both paths.
5. Allow Test Store events on the server:
   ```bash
   supabase secrets set RC_ALLOW_TEST_STORE=1 --project-ref <staging-ref>
   ```
   **The webhook refuses Test Store events unless this is set.** That is
   deliberate: a Test Store event grants an entitlement with no money paid, so
   production must never honour one. Set it on staging only.

What differs from a real store:

- Subscriptions renew automatically **up to 5 times**, then cancel — enough to
  exercise renewals, and it makes B9's recurring-commission test quick.
- Renewals take 5 minutes to an hour instead of a month.
- Events arrive as `store: TEST_STORE`, `environment: SANDBOX`. They are stored
  as `store = 'test'` and **never accrue influencer commission** — otherwise an
  afternoon of testing would owe someone 15% on dozens of imaginary sales.
- Exclude `environment <> 'PRODUCTION'` from any revenue query.

**What Path A cannot prove:** real StoreKit / Play Billing behaviour, store
review, or the actual purchase sheet. T8.1 still needs real sandbox purchases
before launch — but everything else in B8 can be verified now.

---

## Path B — real stores

Needed before launch. Requires an Apple Developer Program membership ($99/yr)
and a Google Play Developer account ($25 one-off).

## 0. The product matrix

Eight products. Two tiers x two billing terms x two price lists.

The promo list exists because the Plan screen's "Early promotion discount"
switch has to correspond to something a store will actually charge. Flipping it
selects the promo offering; the prices shown are always real.

| Product ID | Tier | Term | Price list | Price (USD) | Grants |
|---|---|---|---|---|---|
| `parse_pro_m` | Pro | Monthly | Standard | 9.99 | `pro` |
| `parse_pro_y` | Pro | Yearly | Standard | 71.99 | `pro` |
| `parse_max_m` | Max | Monthly | Standard | 15.99 | `max` |
| `parse_max_y` | Max | Yearly | Standard | 149.99 | `max` |
| `parse_pro_m_promo` | Pro | Monthly | Promo | 6.99 | `pro` |
| `parse_pro_y_promo` | Pro | Yearly | Promo | 49.99 | `pro` |
| `parse_max_m_promo` | Max | Monthly | Promo | 10.99 | `max` |
| `parse_max_y_promo` | Max | Yearly | Promo | 79.99 | `max` |

Prices are the ones already in the Plan screen design. Set them as the **base
country (US) price** and let both stores localise the rest — the app never
formats a price itself, it prints what the store returns.

> **Product IDs are permanent.** Neither store lets you rename or reuse one.
> Check the spelling above character by character before you click create. They
> are also asserted by the B8 gate, so a typo fails the build rather than
> silently selling nothing.

**Pro grants 200 scans/month. Max is uncapped** (deprioritised past 2,000/month
as fair use). That 200 is enforced by the server from the `products` table and
is what the Plan screen advertises — the two are pinned together by the gate.

---

## 1. App Store Connect

1. **Paid Applications agreement.** Business → Agreements. Sign it and complete
   banking and tax. *Nothing else works until this is Active — products stay
   "Missing Metadata" and the sandbox returns no products.*
2. **Subscription group.** Apps → Parse → Subscriptions → create one group,
   name it `Parse`. All eight go in this group so users upgrade/downgrade
   between them instead of stacking subscriptions.
3. **Create the 8 subscriptions** with the IDs and prices from the table.
   - Reference name: anything readable (`Parse Pro Monthly`).
   - Duration: 1 month or 1 year per the table.
   - Add a localised display name and description for each — required for review.
4. **Ranking within the group:** Max above Pro. This is what makes Pro → Max an
   upgrade (immediate) rather than a crossgrade.
5. **Sandbox tester.** Users and Access → Sandbox → Testers. Create one with an
   email that is *not* an existing Apple ID.
6. **Sign in with Apple key** (needed for account deletion — this is the
   "In-app purchase key configuration" screen that blocks you without a paid
   account; skip it entirely on Path A):
   - Certificates, Identifiers & Profiles → Keys → **+**, enable *Sign in with
     Apple*, download the `.p8` **once** — it cannot be downloaded again.
   - Note the **Key ID**, your **Team ID**, and the **Services ID / bundle ID**
     (`com.imranfarid.parse`).

Give me / put in `.env`:

```
APPLE_SIWA_TEAM_ID=
APPLE_SIWA_CLIENT_ID=com.imranfarid.parse
APPLE_SIWA_KEY_ID=
APPLE_SIWA_PRIVATE_KEY=      # the whole .p8 contents, BEGIN/END lines included
```

---

## 2. Google Play Console

1. **Merchant account** set up and payments profile complete.
2. Upload at least one build to **Internal testing** — Play will not let you
   create subscriptions for an app that has never been uploaded.
3. **Monetise → Subscriptions → Create** for each of the 4 Pro/Max IDs.
   - Each subscription gets a **base plan** whose ID can be anything readable
     (`monthly`, `yearly`); the app strips the `:basePlanId` suffix, so it does
     not need to match.
   - Auto-renewing, price per the table, availability: all launch countries.
4. **Licence testers.** Setup → Licence testing → add the tester Google
   accounts. These accounts get test purchases that renew fast and are never
   charged.
5. **Service account for RevenueCat:** Play Console → Setup → API access →
   create/link a Google Cloud service account with *Financial data* and *Manage
   orders* permissions, then download its JSON key for step 3.

---

## 3. RevenueCat

1. Create a project (`Parse`) and add **two apps** — one iOS, one Android.
2. **iOS app:** bundle ID `com.imranfarid.parse`, upload the App Store Connect
   **In-App Purchase key** (.p8) plus your issuer ID, and the **App-Specific
   Shared Secret**.
3. **Android app:** package `com.imranfarid.parse`, upload the Play service
   account JSON from step 2.5.
4. **Entitlements** — create exactly two, spelled exactly:
   - `pro` — attach `parse_pro_m`, `parse_pro_y`, `parse_pro_m_promo`, `parse_pro_y_promo`
   - `max` — attach `parse_max_m`, `parse_max_y`, `parse_max_m_promo`, `parse_max_y_promo`

   Every product of a tier grants that tier's entitlement, whatever the term or
   price list. The app reads only these two names.
5. **Offerings** — create exactly two, identified exactly:
   - `default` — packages for `parse_pro_m`, `parse_pro_y`, `parse_max_m`, `parse_max_y`. **Mark this one Current.**
   - `promo` — packages for the four `_promo` products.

   Package identifiers do not matter; the app matches on the store product ID.
   An offering missing from the dashboard simply hides the promo switch rather
   than breaking the screen.
6. **Webhook:** Integrations → Webhooks.
   - URL: `https://<project-ref>.supabase.co/functions/v1/rc-webhook`
   - Authorization header: invent a long random value. This becomes
     `RC_WEBHOOK_AUTH`, and the header must match **byte for byte** — the
     function compares the whole header string, so if you enter `Bearer abc123`
     there, the env var is `Bearer abc123` including the word Bearer.
7. **API keys:** Project settings → API keys.
   - Public **Apple** SDK key → `EXPO_PUBLIC_RC_APPLE_KEY`
   - Public **Google** SDK key → `EXPO_PUBLIC_RC_GOOGLE_KEY`
   - **Secret** key → `RC_SECRET_API_KEY` (server only — used by account-delete
     to unlink a subscriber. Never prefix it with `EXPO_PUBLIC_`.)

---

## 4. Where each value goes

`.env` (local) and the same names in EAS secrets for builds:

```
EXPO_PUBLIC_RC_APPLE_KEY=
EXPO_PUBLIC_RC_GOOGLE_KEY=
```

Supabase edge function secrets (`supabase secrets set --project-ref <ref>`), or
the dashboard's Edge Functions → Secrets:

```
RC_WEBHOOK_AUTH=
RC_SECRET_API_KEY=
APPLE_SIWA_TEAM_ID=
APPLE_SIWA_CLIENT_ID=
APPLE_SIWA_KEY_ID=
APPLE_SIWA_PRIVATE_KEY=
RETENTION_FINANCIAL_YEARS=5
```

Then deploy the three new functions:

```bash
supabase functions deploy rc-webhook --no-verify-jwt --project-ref <ref> && supabase functions deploy account-delete --project-ref <ref> && supabase functions deploy apple-link --project-ref <ref>
```

`rc-webhook` uses `--no-verify-jwt` because RevenueCat is not a signed-in user;
it authenticates with the shared `RC_WEBHOOK_AUTH` header instead. The other two
are called by the app and **must** keep JWT verification on.

---

## 5. What this unblocks

Three gate tests are waiting on the above and cannot be faked:

- **T8.1** — sandbox Plus purchase on iOS *and* Android → webhook → entitlement
  active in-app without restart, `subscriptions` row carries `current_period_start`.
- **T8.3** — free-exhausted shows the Pro paywall, cap-hit shows the Max
  paywall, both priced from RevenueCat.
- **T8.5 (manual half)** — a real deletion on staging: interstitial warning,
  both manage-subscription links, Apple tokens revoked, RevenueCat unlinked,
  tombstone written, restore-purchases still works on a fresh account.

Everything else in B8 is already proven locally — `npm run gate -- b8` is green
4/4, including 27 database checks against the real money paths.

Sandbox renewals compress a month into minutes on both stores, so set the
testers up early: B9's recurring-commission test depends on watching several
renewals land.
