# Supabase Environments

Source of truth: ReceiptFlow Build Playbook v1.1, B1 Foundations.

## Environments

| Environment | Purpose | App env |
| --- | --- | --- |
| local | Developer validation with local Docker/Colima Supabase | `.env.local` |
| staging | Shared pre-production validation | `.env.staging` |
| production | Live user data | `.env.production` |

Do not commit real `.env.*` files. Use `.env.example`, `.env.staging.example`, and
`.env.production.example` as templates.

## Required Supabase Cloud Values

For staging and production, capture these values outside git:

- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

`SUPABASE_DB_URL` is for CLI/CI migration commands only. Never expose it to the
Expo public bundle.

## Migration Commands

Run a dry-run first:

```sh
SUPABASE_DB_URL="<staging-db-url>" npm run supabase:staging:dry-run
SUPABASE_DB_URL="<production-db-url>" npm run supabase:prod:dry-run
```

Apply after the dry-run is reviewed:

```sh
SUPABASE_DB_URL="<staging-db-url>" npm run supabase:staging:push
SUPABASE_DB_URL="<production-db-url>" npm run supabase:prod:push
```

Use `--include-seed` only for the B1 category master list and foundation seed.
Do not add user data to `supabase/seed.sql`.

## B1 Verification

After each environment migration, verify:

- `public.health_check()` returns `1`.
- `categories` contains the B1 master list.
- `Miscellaneous` has `is_system = true`.
- `storage.buckets` has private `receipts` and `exports` buckets.
- `scan_ledger` has `UNIQUE(user_id, reason, ref_id)`.
- `provider_state` has singleton row `id = 1`.
