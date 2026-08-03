# Decision log

Blueprint v1.1 carries decisions D1–D18. The playbook requires a logged entry
for anything not in the original documents, and the Blueprint wins on conflict —
so where the build has diverged from a D-code, the divergence is recorded here
and the D-code is explicitly amended rather than quietly ignored.

Entries are append-only. Superseding an entry means writing a new one that says
so, not editing the old one.

---

## DL-003 — Line items remain structured on the device

**Date:** 2026-08-03 · **Status:** accepted · **Touches:** B4.8.4

Extraction already supplies `name`, `qty`, and `amount`; converting that to
display strings on the client made item edits lossy. Receipt fields now retain
structured rows end-to-end. Existing local string rows are read as quantity-one
items for backwards compatibility. Confirmation replaces the server item rows
in the same database transaction as the receipt header update.

---

## DL-001 — The extraction path is split into Balanced and Precise

**Date:** 2026-08-03 · **Status:** accepted · **Supersedes:** nothing ·
**Touches:** Blueprint §4.1, D14

### Context

Blueprint §4.1 describes one fast path: the client posts the image, `extract`
runs the model against it, and one function owns the whole scan. The B4 build
found that shape could not meet the T4.2 latency budget — sending a 150–300 KB
JPEG and having the model read it is the dominant cost, and it is paid on every
scan whether or not the image is needed.

### Decision

Two paths, chosen per capture:

- **Balanced** (`extract-balanced`, the default). The device runs OCR locally and
  posts **text only**. The image never reaches this function. The photo is
  uploaded separately afterwards, in the background, through `extract` with
  `upload_only=1`.
- **Precise** (`extract`). The original photo-first path, unchanged, for captures
  where the image itself must be read.

### Consequences

- The bulk of extraction latency moves off the request. Text is a fraction of
  the bytes and a fraction of the tokens.
- **D14 can no longer hold for Balanced as written** — see DL-002. A function
  that never receives the image cannot store it before acking.
- Two prompts and two category-resolution paths existed briefly and drifted;
  they are now shared through `supabase/functions/_shared/categories.ts`.
- The client must own image durability on the Balanced path, because nothing
  else can.

### Why this was not written down sooner

It was not. The split was built during B4 and this entry is retrospective — the
gap is what the B4 pending document flagged. Recorded here rather than back-dated.

---

## DL-002 — D14 amended: the ack gate binds whoever holds the image

**Date:** 2026-08-03 · **Status:** accepted · **Amends:** D14 ·
**Depends on:** DL-001

### Context

D14, as written:

> No 200/202 leaves `extract` before the image is durable in Storage. A Storage
> failure returns an error; the client keeps its copy and retries.

The intent is a safety property, and a good one: **the user's photo is never the
only copy at a moment when the system has told them it is safe.** The mechanism
in D14 — store before you ack — is one way to get that property, and it assumes
the server has the image to store.

On the Balanced path the server never receives the image, so the mechanism is not
merely unimplemented, it is unimplementable. Three gate assertions currently fail
against it (`b3:backend` ack order, `b3:app` T3.5 ×2). They are correct to fail:
the rule changed and was never rewritten.

### Decision

D14's *intent* is retained and its *mechanism* is made path-specific.

**Amended D14 — the local copy is released only once a durable copy exists.**

| Path | Who holds the image at ack | Rule |
|---|---|---|
| Precise (`extract`) | the server | Unchanged. Storage upload → receipts upsert → 200. A Storage failure returns an error and no ack. |
| Balanced (`extract-balanced`) | the client | The ack covers the **extraction result only** and makes no claim about the image. The client keeps its local file until the separate upload confirms, and only then deletes it. |

Two rules follow, and both are testable:

1. **The client deletes the local file only on a confirmed upload** — the
   `imageSyncStatus: 'uploaded'` branch, never on the extraction ack.
2. **The server never advertises an image path it cannot serve.** Balanced
   returns `image_path: null`; the path is written when the object exists, by
   the `upload_only` path that actually stores it.

### Consequences

- `extractAckSchema.image_path` becomes nullable. A contract change: null now
  means "no image is stored yet", which is a state that previously could not be
  expressed and was therefore misrepresented as a real path.
- A permanently failed upload becomes a state the user can see and act on, since
  the device is now the sole custodian until the upload lands. Silence there was
  acceptable when the server stored the image up front; under this amendment it
  is not. (`upload_failed_final`, surfaced in Search with Try again.)
- The three failing assertions are rewritten to encode the amended rule. They go
  green because the rule is stated and true, not because the check was relaxed.
- T4.4's ack-gate assertions ran only against `extract`. Under a two-path rule
  each path needs its own assertion, so `extract-balanced` gains one.

### What was checked, and what turned out not to be true

The B4 pending document records a second exposure: that `extract-balanced`
returns a path for an object it does not have, and that `server-sync.ts` reads
that into `remoteImagePath`, giving a second device a dead link.

The first half is true. **The second is not.** `server-sync.ts:113` reads
`image_path` from the `receipts` **table**, and `extract-balanced` never writes
that column — it is deliberately omitted from the background persist so a racing
image backup cannot be clobbered (`extract-balanced/index.ts:750`). The client's
`ExtractFunctionPayload` does not carry `image_path` at all, so the response
field is consumed by nobody.

So there is no live dead-link bug. What exists is a contract that *promises* a
non-null path, which any future consumer would be entitled to trust. It is fixed
here as a latent trap, not as a live defect — recorded so nobody re-derives the
scarier version from the older document.
