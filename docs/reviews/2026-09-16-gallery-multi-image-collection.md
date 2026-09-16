# Multi-image collection and card merge review

## Scope and outcome

Manual collection now supports one ordered group of up to 20 images sharing a prompt. The form scrolls independently inside a bounded dialog, keeps tag suggestions reachable, and locks the underlying page. A local fan stack opens a viewing-only lightbox.

## Review coverage

Reviewed sequentially in the main task per repository instructions, not as an independent multi-agent review. Inspected correctness, API contracts, authorization, storage integrity, accessibility, lifecycle cleanup, and performance. Simplification pass retained existing upload, zoom, tag, and storage helpers; no new dependency or metadata version was introduced.

- Management authorization remains required before request parsing or storage access.
- Existing single-image callers remain supported; ordered multi-image identity matches the session importer.
- Source bytes, hashes, formats and feature hashes are validated before metadata publication. A failed later image cannot publish a partial card.
- Duplicate sources are excluded by the client and rejected by the API. Retrying the same prompt and image group is idempotent.
- Source processing runs sequentially; heavy visual computation remains an on-submit browser import. Ordinary gallery reads add no storage requests.
- Blob URLs are revoked on selection changes and unmount. Closing the nested viewer preserves form values and the page lock; closing the collection dialog restores scrolling.

Merge review also covers token-first authorization, exact two-card selection, revision conflicts, selected-only retention, duplicate-example vote unions, old-link redirects, private recovery records and conditional rollback. Tests inject conflicts before and after the retired detail is replaced, a lost PUT response and a missing response ETag. Multi-object publication still requires manual recovery after process termination or an unavailable store; it is not a database transaction.

Actionable findings: none remaining after local validation. Automated external review follows in the PR.

## Validation

- 164 gallery/importer Node tests passed, including real image-byte verification with mocked HF storage and grouped retry/failure cases.
- 11 browser tests passed across collection, local-viewer and merge flows. Merge coverage includes both destructive/discard confirmations, rejected page navigation, conflict drafts and the successful redirect. Desktop and mobile suggestion-visibility regressions failed before the fix and passed afterward.
- Astro check: 0 errors, 0 warnings, 3 existing hints.
- Production build passed.
- Full Biome check passed with one existing unused-import warning outside this change; changed files are clean.

Local browser QA uses an isolated read-only HF fixture after the local live-HF route timed out. Browser save tests intercept writes; API tests exercise the real handler against mocked storage. No production collection was created during these tests. No historical records were merged or changed.

## Deployment

No migration, new secret, or new environment variable is required. The existing management token and deterministic source/thumbnail paths remain in use. Collections use the existing multi-image structure. Once an administrator merges cards, retired detail records use redirect markers; an application rollback must retain marker support or restore those records from the private recovery backup. The two user-nominated production cards remain untouched for manual acceptance.
