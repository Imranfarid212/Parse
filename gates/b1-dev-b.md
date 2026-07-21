# B1 Dev B Gate Notes

Playbook source: ReceiptFlow Build Playbook v1.1, B1 Foundations.

## Implemented in this repo

- Supabase foundation config: `supabase/config.toml`.
- Full v1.1 foundation migration: `supabase/migrations/20260719000100_b1_foundations.sql`.
- Seed data: `supabase/seed.sql`, including locked system `Miscellaneous`.
- Shared contracts package: `packages/contracts/src`.
- Contract mirror into edge-function shared folder: `supabase/functions/_shared/contracts`.
- Local backend foundation check: `npm run b1:backend`.

## Still needs real local/staging validation

- Supabase CLI 2.109.1 installed locally during validation.
- `supabase db reset` passed locally with Vector excluded under Colima.
- Real Supabase `db.types.ts` generated from the local stack.
- Local generated type drift check added in `npm run b1:db:verify`.
- Add full gate runner and `gates/phases.json` lock workflow.
