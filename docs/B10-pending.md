# Carried into B10

Things decided-not-to-decide during earlier phases, parked here so B10 does not
have to rediscover them. Each says what the gap is, why it was deferred, and
what "done" looks like — a note that only says "look at exports" is how items
like these get dropped.

---

## Export job retention — no rows are ever deleted

**From:** B7 (2026-08-06) · **Owner:** Dev B · **Size:** ~half a day

`export_jobs` rows live forever. The *files* are purged at seven days
(`purge_expired_exports`, run by the sweeper), and `account-delete` removes the
rows when an account goes — but an active account accumulates a row per export
indefinitely.

**Why it matters, and it is not disk.** `export_jobs.filters` stores what the
user searched for: date ranges, categories, amount bands, and free text. Free
text can be revealing — a clinic name, a lawyer, an employer. Keeping a
searchable history of that long after the file it produced was deleted is
retention we cannot justify under data minimisation, and it is the only reason
this is worth doing.

The Blueprint fixes retention for receipts (30 days after soft delete) and
financial records (5 years) and says nothing about export jobs, so any period is
a new decision.

**Proposal:** delete `export_jobs` rows 90 days after `created_at`, in the same
sweeper pass that already purges expired files. Ninety days covers a full
quarter, so someone filing quarterly still finds their last export's filters
ready to re-run.

**Done looks like:** a purge function with a dry-run mode (matching
`purge_soft_deleted_receipts`), wired into the sweeper, with a test proving a
row younger than the cutoff survives a purge that removes an older one.

---

## PDF exports cannot render CJK, Indic or Arabic merchant names

**From:** B7 (DL-005) · **Owner:** Dev B · **Size:** ~1–2 days, mostly decisions

The statement and images PDFs embed a subset of Noto Sans covering Latin, Latin
Extended, Greek, Cyrillic, punctuation and currency symbols. A merchant name
outside those scripts **renders as nothing** — the cell is blank. Verified, not
assumed: a statement built with `ローソン 渋谷店` and `रिलायंस फ्रेश` produces rows with
correct dates, categories and amounts and an empty Merchant column.

Note this is worse than the usual missing-glyph behaviour. A `▯` box at least
says "there is a character here I cannot draw"; a blank cell reads as "this
receipt has no merchant", which is a different and wrong statement. Whatever
else B10 does here, the blank is the part that misleads.

Affected: Japanese, Chinese, Korean, Devanagari and other Indic scripts, Arabic,
Hebrew, Thai — somewhere north of three billion people. What is rare here is the
coverage in our font, not the languages.

**Why this is B10 and not a launch blocker:** the first market is the US
(confirmed 2026-08-06), where receipts are Latin-script and the gap does not
bite. It becomes urgent the moment a market using any of the scripts above is
added — at that point a user's PDF statement lists every receipt with correct
dates, categories and amounts and a blank where the shop name should be. Revisit
this before any non-Latin market launch, not on a date.

**Not affected:** the xlsx export (Excel renders with system fonts), the app UI,
search, and the stored data. This is a PDF-rendering limit only.

**Why it was not fixed in B7:** coverage needs a different font *family*, not a
larger subset. Noto Sans CJK is ~16 MB per weight, which cannot simply be
embedded the way the Latin subset is (two weights of that subset are ~310 KB
combined).

**Options, roughly in order of appeal:**

0. Cheapest, and worth doing even alongside a real fix: detect that a string
   cannot be represented by the embedded font and draw a visible placeholder
   instead of nothing — the receipt id, or an explicit marker. Hours, not days,
   and it converts a silent blank into an honest gap.
1. Detect the scripts present in a given export and embed only the font(s) those
   rows need, per run. Most exports stay small; a Japanese export carries a
   Japanese font. Needs per-script font assets available to the function.
2. Subset a CJK font at build time against a frequency-ranked glyph set. Smaller,
   but silently wrong for a rare character.
3. Fall back to transliteration or the raw bytes. Rejected — mangling a
   merchant's name is worse than an honest box.

**Done looks like:** an export containing a Japanese and a Devanagari merchant
name renders both legibly, asserted the way the existing PDF tests assert — by
extracting the text back out and comparing it to the source.
