# Gallery prompt curation review

Status: complete. Scope: `feat/gallery-prompt-curation` against `2baaf29a5aeea7429ea9dc7831da4c442d4f5482`, including the pending interface changes.

## Actionable findings

None remaining after local fixes.

## Fixed during review

- Keep stored timestamps in canonical UTC and derive the collection day in Asia/Shanghai. Persisting mixed offsets would break the catalog's lexicographic date ordering.
- Publish edited prompt choices to already-mounted cache revisions. An older in-flight read must not overwrite the edited text used by the detail Lightbox and copy controls.

## Coverage

Sequential review in the main task, as required by AGENTS.md; these are not independent reviewer verdicts. Examined correctness, management authorization, API compatibility, conditional storage writes and rollback, request limits and retries, browser draft lifecycle, cached prompt races, and unchanged lightweight list reads. The shared upload extraction retains the existing example route contract. New features have HTTP interfaces as well as browser controls.

Validation: 159 unit tests passed, Astro check reported zero errors and warnings, and the production build passed. The full browser run passed 48 of 49 cases; the remaining existing bulk-tag case timed out waiting for navigation. A targeted rerun passed all nine collection/editing and bulk-tag cases, including that case. Browser saves use mocked mutations; storage integration tests exercise real image processing against mocked HF storage.

Historical repair used fresh HF metadata directly, conditional writes and private backups. Readback verified all 54 affected items and both catalog/search indexes. No local session archive scan was used.

## Verdict

Ready for PR review. Production deployment and real-environment authorization still require post-deployment verification. CodeRabbit review is handled separately before merge.
