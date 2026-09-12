# Image Style Prompt Gallery storage

The gallery stores runtime data in the Hugging Face bucket configured by `STYLE_GALLERY_BUCKET_PREFIX`. The Git repository contains the application and import tooling, not gallery records or images.

## Current layout

```text
metadata/catalog-v5.json
metadata/prompt-search-index.json
items/<slug>.json
source/<hash-prefix>.<ext>
thumb/<hash-prefix>.webp
examples/index-v2.json
examples/images/<sha256>.<ext>
```

`metadata/catalog-v5.json` contains shared model targets and the lightweight card/sorting fields required by the preview UI. It contains `exampleCount` and a prompt excerpt; full prompts are fetched on demand. The obsolete shared `codex-session` / `style-prompt` tags are ignored by readers and omitted by new writers.

`items/<slug>.json` is the source of truth for one detail page. It contains the complete prompt record, all reference images, import provenance, and that item's generated examples. A detail request therefore reads one item document instead of joining separate item and example manifests.

`examples/index-v2.json` is the single global generated-example index. Each entry contains the source slug, minimum overview fields, and a deduplicated array of GitHub numeric user IDs that liked the example. The Sub-gallery overview renders directly from this index; the main Gallery and image matrix read it in parallel with the catalog only to aggregate parent like totals. Detail pages join the requested item's examples with its one index group.

Like counts are not copied into the catalog or item documents. A missing user ID array is therefore never interpreted by runtime v2 code, and every visible count is derived from the one canonical index.

Generated images use a content-addressed path independent of their platform. Platform changes update metadata only; they never copy or rename image objects. Physical deletion happens only after no entry in the global example index references the image URL.

## Image dimensions and masonry

Reference-image records, catalog cards, generated examples, and example-index entries carry optional `dimensions: { width, height }`, measured after EXIF orientation. The source catalog uses the first reference image's dimensions. Existing record versions and URLs remain compatible; dimensions are optional only during migration and for older API clients.

The session importer reads image headers with Sharp. The example-upload CLI reads file headers, and the browser records display dimensions before upload. The common example merge endpoint fills missing dimensions for older clients; direct and chunked byte uploads share this same metadata path. Index reconciliation preserves dimensions and likes.

Preview and Sub-gallery overview offer `?layout=masonry`. Cards have equal widths and reserve their original aspect ratios before image requests. Shortest-column packing keeps existing positions when more cards are appended. The image index intentionally retains its dense square matrix. Missing legacy dimensions use a stable 4:5 container with `contain`, until backfilled, rather than changing height after loading.

Backfill existing public items and both indexes (read-only by default):

```sh
node --use-env-proxy --env-file-if-exists=.env.local --import tsx scripts/backfill-style-gallery-dimensions.ts
node --use-env-proxy --env-file-if-exists=.env.local --import tsx scripts/backfill-style-gallery-dimensions.ts --apply --remove-tags
```

The script caches dimensions under `/tmp/style-gallery-dimensions`, backs up each overwritten metadata revision, and uses ETag conditions to preserve concurrent changes. It changes neither image bytes nor prompt text, dates, IDs, platform labels, or votes. Re-running is safe. `--remove-tags` deletes the obsolete shared catalog tags as part of the same rollout; the updated catalog schema no longer requires that field.

## Writes and consistency

The browser upload flow has five phases:

1. Hash selected files concurrently.
2. Prepare metadata in bounded request batches and check content-addressed image objects concurrently.
3. Upload missing files through independent same-origin requests with bounded concurrency and retries.
4. Verify each referenced image object exists.
5. Commit the item document, catalog count, and example index together. Example-index mutations use ETag conditional writes and replay after a concurrent update, so uploads, deletions, and likes cannot silently overwrite one another across Vercel instances. If another metadata write fails, the rollback preserves likes added concurrently.

The browser distinguishes transferring bytes, waiting for the server to finish the HF upload, and saving metadata. A file can therefore show `processing` after its browser upload reaches 100%; this means the server is still waiting for HF storage, not that the progress bar lost the final bytes.

The browser does not impose a total image-count limit. Prepare requests contain at most 32 entries, while metadata merge, platform change, deletion, and cleanup requests contain at most 128 entries. Larger user actions are split automatically; completed batches remain committed if a later batch fails. Orphan image cleanup runs concurrently after a successful metadata commit.

`POST /api/style-gallery/reconcile` rebuilds catalog example counts and the structural fields in `examples/index-v2.json` from the authoritative item documents while retaining likes by example ID. It requires the gallery upload token.

Likes use a separate GitHub OAuth session from giscus because the giscus login cookie belongs to its cross-origin iframe and is unavailable to this application's API. The OAuth flow uses PKCE plus a signed `HttpOnly`, `SameSite=Lax` session cookie. The GitHub access token is used once to fetch the numeric user ID and public profile, then discarded. Configure `STYLE_GALLERY_GITHUB_CLIENT_ID`, `STYLE_GALLERY_GITHUB_CLIENT_SECRET`, `STYLE_GALLERY_GITHUB_REDIRECT_URI`, and an independent `STYLE_GALLERY_SESSION_SECRET` of at least 32 characters.

Local development must configure the same token on the Astro server. If
`STYLE_GALLERY_UPLOAD_TOKEN` is absent from the command that starts `pnpm dev`,
the detail page remains read-only even when a token was previously saved in the
browser.

## Legacy migration

The one-time v2 migration combined `metadata/items/<slug>.json` and `examples/<slug>.json`, moved generated images from platform-specific folders to `examples/images/`, verified all counts and object references, and then removed the old metadata, image folders, snapshots, and migration code. Runtime code has no v2 fallback.

The like-index migration copied all 196 groups and 2219 examples from `examples/index.json` into `examples/index-v2.json`, initialized `likedBy` arrays, and verified the uploaded snapshot byte-for-byte. The versioned key keeps the old deployment operational during rollout; after the v2 code is deployed, `examples/index.json` is an unused migration artifact and can be deleted.
