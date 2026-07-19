# B1 Dev A Gate Notes

Playbook source: ReceiptFlow Build Playbook v1.1, B1 Foundations.

## Implemented in this frontend repo

- Expo SDK 57 shell verified against the versioned Expo docs.
- App boot smoke target: `.maestro/b1-app-smoke.yaml`.
- Health route: `parse://health`, implemented at `src/app/health.tsx`.
- Environment registry: `.env.example`.
- Version registry: `VERSIONS.md`.
- Local app check script: `npm run b1:app`.

## Dev B / shared repo blockers for full B1 5/5

- Complete Supabase v1.1 migrations and seed data, including locked `Miscellaneous`.
- `packages/contracts` with enums, error codes, canonical copy strings, fixtures, and generated `db.types.ts`.
- Contract sync into `supabase/functions/_shared/contracts`.
- Root workspace CI, gate runner, `gates/phases.json`, CODEOWNERS, and phase lock workflow.
- Reference iOS and Android devices/simulators finalized for gate E2E.
