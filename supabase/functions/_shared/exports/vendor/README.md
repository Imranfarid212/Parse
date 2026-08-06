# Vendored dependencies

## xlsx.mjs — SheetJS Community Edition 0.20.3

Source: <https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs>, unmodified.
Licence: Apache-2.0, see `LICENSE-SheetJS.txt`.

Vendored rather than imported from a URL because Supabase's server-side function
bundler (`supabase functions deploy --use-api`) refuses imports from
`cdn.sheetjs.com`, and SheetJS does not publish current versions to npm — the
newest thing on the public registry is 0.18.5, which carries a
prototype-pollution advisory in its *reading* path. Reaching for that older
version to satisfy a bundler host allow-list would be trading a real security
property for a packaging convenience.

Checked in, so an export never depends on a third-party CDN being reachable at
deploy time or at runtime.

To update: download the new `xlsx.mjs` and its `LICENSE` from the SheetJS CDN,
replace both files unmodified, and run `npm run b7:builders` — the workbook tests
parse a generated file back, so a breaking change in the library shows up there.
