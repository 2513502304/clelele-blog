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
examples/thumbs/<sha256>.webp
```

`metadata/catalog-v5.json` contains shared model targets and the lightweight card/sorting fields required by the preview UI. It contains `exampleCount` and a prompt excerpt; full prompts are fetched on demand. The obsolete shared `codex-session` / `style-prompt` tags are ignored by readers and omitted by new writers.

`items/<slug>.json` is the source of truth for one detail page. It contains the complete prompt record, all reference images, import provenance, and that item's generated examples. A detail request therefore reads one item document instead of joining separate item and example manifests.

`examples/index-v2.json` is the single global generated-example index. Each entry contains the source slug, minimum overview fields, and a deduplicated array of GitHub numeric user IDs that liked the example. The Sub-gallery overview renders directly from this index; the main Gallery and image matrix read it in parallel with the catalog only to aggregate parent like totals. Detail pages join the requested item's examples with its one index group.

Like counts are not copied into the catalog or item documents. A missing user ID array is therefore never interpreted by runtime v2 code, and every visible count is derived from the one canonical index.

Generated images use a content-addressed path independent of their platform. Platform changes update metadata only; they never copy or rename image objects. Physical deletion of both the original and its thumbnail happens only after no entry in the global example index references the image URL.

## Image dimensions and masonry

Reference-image records, catalog cards, generated examples, and example-index entries carry optional `dimensions: { width, height }`, measured after EXIF orientation. The source catalog uses the first reference image's dimensions. Existing record versions and URLs remain compatible; dimensions are optional only during migration and for older API clients.

The session importer reads image headers with Sharp. The example-upload CLI reads file headers, and the browser records display dimensions before upload. The common example merge endpoint measures the stored object and overwrites advisory client dimensions; direct and chunked byte uploads share this same metadata path. Index reconciliation preserves dimensions and likes.

Preview and Sub-gallery overview default to masonry; `?layout=grid` selects fixed-height cards. Cards have equal widths and reserve their original aspect ratios before image requests. Fixed row-major column assignment preserves the same left-to-right order in both layouts, while each masonry column stacks independently. Appending cards retains the container height throughout measurement so browser scroll clamping cannot send the reader back to the beginning. The image index intentionally retains its dense square matrix. Missing legacy dimensions use a stable 4:5 container with `contain`, until backfilled, rather than changing height after loading.

Sub-gallery overview defaults to grouping; `?grouped=false` disables it globally. Collapsed groups contain only the current filtered results, retain first-occurrence sort order, and open a lightbox containing that group's images. A maximum of three decorative image layers fan out on hover or keyboard focus without changing card geometry; reduced-motion settings disable the transition. Source labels show the short hash without the redundant title prefix. Lightboxes reuse already loaded source thumbnail URLs and display the source hash and detail link without requesting source metadata again.

Backfill existing public items and both indexes (read-only by default):

```sh
node --use-env-proxy --env-file-if-exists=.env.local --import tsx scripts/backfill-style-gallery-dimensions.ts
node --use-env-proxy --env-file-if-exists=.env.local --import tsx scripts/backfill-style-gallery-dimensions.ts --apply --remove-tags
```

The script creates a unique private temporary directory (printed in its result) for cached dimensions and backups of each overwritten metadata revision, and uses ETag conditions to preserve concurrent changes. It changes neither image bytes nor prompt text, dates, IDs, platform labels, or votes. Re-running is safe. To reuse a cache, pass `--work-dir` pointing to a directory owned by the current user with mode `0700`; symlinked directories and files are rejected. `--remove-tags` deletes the obsolete shared catalog tags as part of the same rollout; the updated catalog schema no longer requires that field.

## Generated-example thumbnails

Folded source cards load at most three pre-generated WebP thumbnails, 640 pixels wide at quality 76, without enlargement or cropping. EXIF orientation is normalized. This covers four-column cards on high-density screens; full detail remains available in Lightbox. Unfolded cards continue using originals.

Thumbnail paths are derived from the existing original SHA-256 path. No thumbnail URL, dimensions, availability flags, extra manifests, or duplicate metadata fields are added. List SSR still reads the same lightweight indexes; image signing accepts the narrowly scoped `examples/thumbs/<sha256>.webp` keys. There is no runtime image resizing on a gallery read.

The card's exact loaded thumbnail URL is passed to Lightbox, with a separate cache identity from the original. Lightbox displays that preview while downloading and decoding the full image, then fades in the original in place. The source-reference badge uses its existing independent thumbnail cache.

The CLI creates and uploads the thumbnail locally before uploading the original, avoiding resizing CPU on Vercel. The common merge endpoint covers browser direct/chunked uploads and any API clients: it reuses the original bytes already read for dimension verification and generates a missing thumbnail before committing metadata. A failed derivative prevents publication; cleanup removes both unreferenced assets. Reconciliation derives thumbnail paths automatically from preserved original URLs and does not rewrite assets.

Audit/backfill all unique indexed images (read-only by default). For a large historical collection, the optional s5cmd transport lists existing derivatives once and downloads/encodes/uploads batches, using the same Sharp encoder:

```sh
node --use-env-proxy --env-file-if-exists=.env.local --import tsx scripts/backfill-style-gallery-example-thumbnails.ts
node --use-env-proxy --env-file-if-exists=.env.local --import tsx scripts/backfill-style-gallery-example-thumbnails.ts --apply --concurrency 8
node --use-env-proxy --env-file-if-exists=.env.local --import tsx scripts/backfill-style-gallery-example-thumbnails.ts --apply --s5cmd --concurrency 32
node --use-env-proxy --env-file-if-exists=.env.local --import tsx scripts/backfill-style-gallery-example-thumbnails.ts --apply --s5cmd --hf-upload --concurrency 32
```

For HF buckets, add `--hf-upload` to keep s5cmd downloads while publishing each thumbnail batch through the native `hf buckets sync` API. This requires the installed `hf` CLI and its existing authenticated login. Sync explicitly uses `--no-delete`, so thumbnails from earlier batches remain intact. Native batch publication can be substantially faster than individual S3 PUTs; compare a small sample on the current connection. Standard AWS fallback credentials retain their session token.

The backfill skips existing thumbnails, retries transient failures, and exits nonzero for missing/failed derivatives. The s5cmd mode requires the existing `s5cmd` binary, passes credentials through the child process environment, and uses a private scratch directory. Each batch is hash-verified, encoded, uploaded, and then removed from local scratch storage; a failed batch is retained for inspection. Re-run without `--apply` to audit coverage. It holds at most the configured number of source images in memory and writes no original or metadata objects. Run it before rollout and audit again after deployment to catch concurrent uploads from the previous deployment. `--limit N` supports a small initial sample. Asset creation is resumable without retaining private metadata snapshots.

## Writes and consistency

The browser upload flow has five phases:

1. Hash selected files concurrently.
2. Prepare metadata in bounded request batches and check content-addressed image objects concurrently.
3. Upload missing files through independent same-origin requests with bounded concurrency and retries.
4. Verify each referenced image object, measure its dimensions, and ensure its thumbnail exists before publishing metadata.
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

## Shared category tags

`metadata/tags-v1.json` is the single source of truth for manually curated categories:

```json
{"version":1,"items":{"2026-09-06-c63bb01cb14a":["插画","溶图"]}}
```

Only tagged source slugs are stored. Empty assignments are removed; the small vocabulary and usage counts are derived from this index. Tags are not copied into item, catalog, prompt-search or example metadata, so CLI imports, browser uploads and platform changes cannot overwrite manual classification. No backfill is required: a missing index is an empty installation and the first authenticated edit creates it conditionally.

All gallery islands share one CDN-cached public `GET /api/style-gallery/tags` request. Ordinary article Lightboxes do not request tags. Exact `?tag=` filters and `#tag` searches operate locally without downloading the prompt-search index; free-text search only matches prompt/source text, never category labels. The dense index supports filtering but leaves its tiny cards unlabelled. Sub-gallery cards and every Gallery Lightbox display their source's tags. Preview overlays show two labels plus an overflow link; detail overlays, the editor and Lightbox expose the full set.

Editing uses the existing `STYLE_GALLERY_UPLOAD_TOKEN` management credential, shared with browser uploads and remembered under the same local storage key after successful verification. GitHub sessions authorize likes only. `GET ?edit=1` is authenticated, fresh and private. Same-origin `PUT` accepts `{slug,tags,previousTags}` and requires a valid Bearer token to edit shared source categories. Batch additions accept `{slugs,tags}` (up to 10,000 distinct sources, 2 MB request limit), union the tags with every selected source, and commit the whole batch in one ETag-conditional write. Unknown sources, per-source limits and vocabulary limits reject the entire batch without partial writes. Replays are idempotent. Multi-select and select-all operate on all current filtered sources, including unmounted cards; sub-gallery deduplicates source IDs. Selection and saving are disabled until text/tag filtering has finished. Tags are normalized with NFKC, trimmed, deduplicated and Latin case-folded; limits are 12 per source, 24 Unicode characters per label and 100 active categories. Invisible controls and markup are rejected. The editor supports substring suggestions, mouse selection, arrow keys, Tab/Enter completion and IME composition; no role/character taxonomy is imposed.

The write path compares the source's previous tags and returns 409 for a competing edit to that source. ETag retries preserve edits to other sources, and first-write races use `If-None-Match: *`. Successful edits publish to all local cards/Lightboxes and invalidate only the `style-gallery-tags` CDN tag; unchanged list/detail SSR caches remain warm. CDN misses read HF directly rather than republishing a potentially stale per-worker snapshot. Image-processing code remains unchanged; tagging performs no image reads, signing or transformations.

## Removing redundant reference-thumbnail fields

Reference previews retain their existing `thumb/<hash-prefix>.webp` objects. The index and source badges derive this path from the original source filename; a multi-image item's combined hash must not be used. `thumbnailImage` is no longer stored in catalog entries, item top-level fields, or reference-image records. Import, validation, asset cleanup, and reconciliation use the same derived contract. No additional HF reads or image processing are needed for derivation.

```sh
node --use-env-proxy --env-file-if-exists=.env.local --import tsx scripts/migrate-style-gallery-thumbnail-metadata.ts
node --use-env-proxy --env-file-if-exists=.env.local --import tsx scripts/migrate-style-gallery-thumbnail-metadata.ts --apply
```

Audit refuses any custom thumbnail path that cannot be derived. Apply removes only redundant fields, saves each overwritten revision in a private temporary directory, and uses ETag conditional writes with conflict retries. IDs, prompts, dimensions, timestamps, examples, and likes remain intact. Re-run the audit after migration; it should report zero changed documents. The example index has no reference-thumbnail fields and is not rewritten.
