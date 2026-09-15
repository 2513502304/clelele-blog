# Gallery curation follow-up review

Scope: `fix/gallery-curation-polish` against `4b287cf0a1590064912835c3ef9e51af3d3d2ed0`. Review performed sequentially in the main task.

## Behavior and correctness

- Override global content-sized textareas only inside curation. Both prompt fields retain newlines, with fixed heights, internal scrolling and a separately scrolling form body. Header and save controls remain visible.
- Optional collection categories reuse the shared vocabulary, normalization and token-protected tag index. Duplicate collection adds categories; an empty selection preserves existing categories. Partial tag/index failures retain the draft for an idempotent retry.
- Original prompt edits compare the original-field snapshot as well as the generated content ID. Adding or clearing an original keeps generated text, identities, other variants and examples intact. Empty Astro islands no longer create sibling spacing below the reference image.
- Collection and bulk tagging share a management row outside both list filter bars.
- Only empty, line-delimited Codex image attachments with the complete name/path signature are removed from original requests. Generated text is never passed through this new cleanup. Regression tests retain nonempty tags, trait placeholders and ordinary markup.
- Concurrent public catalog misses share one download/parse. Forced management reads bypass sharing. Publication/invalidation detaches older work, and failed requests allow retry. No TTL or CDN freshness policy changed.

## Validation

- 162 Node tests passed, including actual route handlers with mocked storage, original-only edits, unauthorized/stale edits, additive/empty tags, shared cold reads and write/read races.
- Six curation browser cases passed across desktop/mobile and preview/index, including 2,500 prompt lines, keyboard tag entry, multiline upload payload, draft retention and live original-prompt add/clear.
- Two existing sticky-column end-alignment browser cases passed; the curation test additionally checks end alignment without an original prompt.
- Astro check: zero errors, zero warnings, three existing hints. Production build passed.

## Runtime cost evidence

Vercel runtime logs show real gallery SSR, session and signing requests, alongside cached tag responses. The route-level CPU metrics API returned HTTP 402: the team's Hobby plan requires Observability Plus for that query. This prevents attributing the monthly total to a specific route or development activity. Function CPU measures execution; build minutes and network wait are not interchangeable with that metric.

A local synthetic catalog benchmark used 3,455 items, eight concurrent cold reads and 12 measured rounds after warm-up. The baseline made 96 storage reads and used 1,179.771 ms process CPU; the change made 12 reads and used 130.002 ms. Wall time was 923.245 ms versus 172.561 ms with mocked 5 ms storage latency. This isolates catalog download/validation duplication; it does not predict an equivalent whole-site billing reduction. The committed concurrency test guards the one-read invariant.

## Data repair

A direct HF audit inspected 3,454 item documents and identified ten original prompt fields in ten items. The repair uses private backups, conditional ETag writes and read-back verification. Generated prompt strings, IDs and all other semantic fields are asserted unchanged. Catalog/search files do not need rewriting for this original-only cleanup. No archived session scan is used.
