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

All gallery islands share one CDN-cached public `GET /api/style-gallery/tags` request. Ordinary article Lightboxes do not request tags. Exact `?tag=` filters and `#tag` searches operate locally without downloading the prompt-search index. Separate hashtags with any whitespace for AND matching (`#溶图 #现实`); each category matches its complete normalized label, and spaces within a label are preserved until the next `#`. The reserved query `#null` selects sources with no categories (`#null #插画` therefore matches nothing); free-text search only matches prompt/source text, never category labels. The dense index supports filtering but leaves its tiny cards unlabelled. Sub-gallery cards and every Gallery Lightbox display their source's tags. Preview overlays show two labels plus an overflow link; detail overlays, the editor and Lightbox expose the full set.

Editing uses the existing `STYLE_GALLERY_UPLOAD_TOKEN` management credential, shared with browser uploads and remembered under the same local storage key after successful verification. GitHub sessions authorize likes only. `GET ?edit=1` is authenticated, fresh and private. Same-origin `PUT` accepts `{slug,tags,previousTags}` and requires a valid Bearer token to edit shared source categories.

Batches accept `{slugs,tags,mode}` (up to 10,000 distinct sources, 2 MB request limit). Omitting `mode` means `add`: union the labels with each source. `remove` deletes only the chosen labels and retains everything else; it accepts up to 100 labels across the batch vocabulary. `replace` sets every selected source to exactly `tags`, including an empty array to clear all categories, and requires `previousTagsBySlug` with a fresh base for every target. Each operation commits the whole batch in one ETag-conditional write. Unknown sources, per-source limits and vocabulary limits reject the entire batch without partial writes. Replays are idempotent.

Multi-select and select-all operate on all current filtered sources, including unmounted cards; sub-gallery deduplicates source IDs. Selection and saving are disabled until text/tag filtering has finished. While bulk mode is active, leaving the page requires confirmation; cancelling a link or Back/Forward preserves the URL and selected sources. Refresh/close use the browser unload dialog. Shallow filters and opening a new tab do not leave the page; exiting bulk mode removes the guard. Tags are normalized with NFKC, trimmed, deduplicated and Latin case-folded; limits are 12 per source, 24 Unicode characters per label and 100 active categories. Invisible controls and markup are rejected. The editor supports substring suggestions, mouse selection, arrow keys, Tab/Enter completion and IME composition; no role/character taxonomy is imposed.

The bulk editor defaults to Add and offers Remove and Replace with an impact summary (changed sources, added/removed assignments). Removal suggestions come from the selected sources. Remove/Replace require a second confirmation with the chosen labels, including an explicit Clear all tags action for empty replacement. Returning to editing preserves the draft; saving retains selection for the next operation, subject to the active filter.

Single edits and batch replacements compare each affected source's previous tags and return 409 for a competing edit to that source; the whole batch is rejected. Addition and removal replay their explicit operation on fresh data, preserving unrelated concurrent labels. ETag retries preserve edits to other sources, and first-write races use `If-None-Match: *`. Successful edits publish to all local cards/Lightboxes and invalidate only the `style-gallery-tags` CDN tag; unchanged list/detail SSR caches remain warm. CDN misses read HF directly rather than republishing a potentially stale per-worker snapshot. Image-processing code remains unchanged; tagging performs no image reads, signing or transformations.

### Importing categories with Codex sessions

```sh
npm run import:style-prompts -- <session.jsonl> --tag "溶图" --tag "现实"
npm run import:style-prompts -- <session.jsonl> --tag "溶图" --tag "现实" --overwrite-tag
```

Repeat `--tag` (or `--tag=label`) to append categories to every eligible source in the session after its metadata is saved. Existing tags are retained by default. With `--overwrite-tag`, replace every eligible source's categories with exactly the supplied labels, including an existing image receiving a different prompt variant. This option requires at least one `--tag`; it cannot accidentally clear tags when no labels were supplied. Replacement reads the authenticated fresh tag index and submits per-source bases, stops on 409 without automatically refreshing/rebasing, and preserves unrelated sources.

Exact duplicate image/prompt records still receive tags, so retrying the same command repairs a failed tag phase without re-uploading images. No flag means no tag reads or writes. `--metadata-only` only targets existing sources; `--dry-run` reports the categories and target count without writing. Tags use the existing management token and conditional batch API with an explicit same-origin header. Additions use atomic batches of at most 10,000 sources; replacements use at most 1,000 to keep serialized per-source bases below the 2 MB request limit, even with maximum-length labels. Atomicity applies to each batch, not an entire multi-batch import. A tag-phase failure keeps imported images/prompts and exits with a retry message. The catalog and item schemas remain unchanged.

## Removing redundant reference-thumbnail fields

Reference previews retain their existing `thumb/<hash-prefix>.webp` objects. The index and source badges derive this path from the original source filename; a multi-image item's combined hash must not be used. `thumbnailImage` is no longer stored in catalog entries, item top-level fields, or reference-image records. Import, validation, asset cleanup, and reconciliation use the same derived contract. No additional HF reads or image processing are needed for derivation.

```sh
node --use-env-proxy --env-file-if-exists=.env.local --import tsx scripts/migrate-style-gallery-thumbnail-metadata.ts
node --use-env-proxy --env-file-if-exists=.env.local --import tsx scripts/migrate-style-gallery-thumbnail-metadata.ts --apply
```

Audit refuses any custom thumbnail path that cannot be derived. Apply removes only redundant fields, saves each overwritten revision in a private temporary directory, and uses ETag conditional writes with conflict retries. IDs, prompts, dimensions, timestamps, examples, and likes remain intact. Re-run the audit after migration; it should report zero changed documents. The example index has no reference-thumbnail fields and is not rewritten.

## Prompt curation and manual collection

The preview and image index offer **Collect image**. A management token and a JPG, PNG or WebP (up to 12 MB) plus a reusable prompt are required; the original request, model name and tags are optional. Collection lives beside bulk tagging, outside the filters. Prompt fields preserve newlines and scroll internally within the bounded dialog. The server derives image/prompt hashes, dimensions, thumbnail, and the UTC+8 date and slug. The browser reuses the example uploader's bounded direct/chunk transport and computes visual features locally, loaded only on submission. No additional image processing or full-item reads run during ordinary listing or scrolling. Existing images reuse their canonical item identity; another prompt becomes a variant, and retrying identical text does not duplicate it. Optional tags are appended through the existing tag index and never replace an existing image’s categories. If tag or visual-index publication fails after metadata was saved, the dialog retains the input and offers a safe retry.

The detail prompt panel's edit icon changes only the selected candidate. `PATCH /api/style-gallery/prompts/:slug` accepts `{id, prompt, originalPrompt?, previousOriginalPrompt?}` with the existing Bearer management token. Omitting `originalPrompt` preserves it; an empty string clears it. Supplying it requires the editing snapshot in `previousOriginalPrompt` (empty string for a previously absent value). The editor exposes both fields, including missing originals, and the left panel updates without leaving an empty spacing slot. The generated content ID and original-field snapshot act as edit preconditions: a stale editor or a replacement duplicating another candidate returns 409 and keeps the draft. Writes preserve all other variants and examples, update the lightweight catalog and prompt-search index once, and invalidate the existing list/item cache tags. Cross-instance ETag conditions and conditional rollback protect concurrent writes. Normalizing text changes its prompt ID and catalog revision; clients never reuse the old prompt cache URL for new text.

Manual publication uses authenticated `POST /api/style-gallery/source-upload` for the shared binary transport, followed by `POST /api/style-gallery/manual` with `{images: [{imageHash, extension, feature}], prompt, originalPrompt?, model?, tags?}`. Select up to 20 images, each at most 12 MB, to create one collection with a shared prompt. The previous single-image payload is also accepted. Uploads and server verification run sequentially to bound memory. The server verifies every stored source before publishing metadata; duplicate source hashes in a request are rejected. Multi-image identity matches session imports: SHA-256 of the ordered source hashes joined by a newline. Retrying the same collection and prompt does not add another card or prompt variant.

The collection dialog has one scrollable form body with a fixed header and footer; textareas and tag suggestions scroll within it. Focusing tags brings the suggestion area into view. The page scroll root stays locked until the dialog closes. Selected files occupy one large, three-layer fan stack using the same component as sub-gallery. File selections append and clipboard image paste is supported. Remove individual draft images from the shared lightbox toolbar; keep this control out of the editor body. Draft removal requires confirmation, preserves the remaining File identities/URLs, and closes the viewer after the last image while preserving text. The shared viewer retains zoom in/out/reset, sensitivity, rotation and navigation, but hides download/copy/locate actions. Merge previews offer viewing tools only. A nested Radix focus scope hosts the shared Floating UI portal; never toggle the parent modal mode, which remounts children. Revoke only removed/abandoned local blobs, never retained or remote URLs. Local previews perform no upload or signing requests.

Visible dates and slug day boundaries use UTC+8, while persisted instants retain canonical UTC serialization for consistent catalog ordering; no `sourceSession` or `sourceLine` is invented. Asset names remain deterministic, with no new per-item thumbnail field. Failed publication leaves unreferenced, content-addressed assets available for retry, never a visible partial card. Management tokens are reused only after a successful authenticated operation; GitHub login alone cannot collect or edit prompts.

The importer extracts the embedded source before attempting attachment recovery. In the observed JSONL order, a nonempty `event_msg:user_message.images` replaces the model-facing projection because it may contain the original, larger image. The ten-original audit in `docs/research/2026-09-20-codex-ten-originals-verification.md` verifies this for all five VS Code inputs, including three oversized originals. UI attachment icons do not indicate whether those bytes were resized.

Original recovery accepts structured `user_message.local_images` / `item_completed.UserMessage.local_image` records and Desktop's complete `Files mentioned by the user` envelope. Some queued messages contain only that envelope and embedded images, with no `local_image` or `<image path>` wrapper. For this form, both the model and UI records must identify the same ordered filenames and absolute paths, with exactly one image file per embedded image. The displayed filename must match the path basename. The UI projection must belong to the pending input; `item_completed` also requires the same turn ID. Mixed attachment lists, incomplete envelopes and ordinary paths in the actual request are not used for automatic recovery.

Replacing a model projection with its UI images retains validated attachment state. A UI image can be larger than the model image, so byte equality between the two is not required. Before recovery, the file is checked against both recorded representations for format, aspect ratio and a small decoded comparison. This rejects an obviously replaced file or mismatched image ordering; it does not authorize merging visually similar cards. Extraction does not silently change the embedded identity used to find existing published cards.

Import logs distinguish UI-confirmed attachment paths, records with unconfirmed paths, successfully recovered different bytes, unavailable files and actual online replacement plans. `Recovered` counts local recovery, not publication: an original may already be published or a higher-resolution published version may be retained. Unconfirmed paths include source and Prompt line numbers so a zero-replacement result does not hide an unsupported attachment association.

When an accepted attachment is missing or invalid, the importer warns and retains embedded bytes. Normal reimports preserve published images and may append new prompt variants or requested tags. Explicit `--overwrite-images` may restore validated originals, updating the active URL's hash while preserving prompts, tags, examples and likes. An archive can restore original source bytes only if it embeds those bytes or its validated local attachment is still available. Local paths are never published.

`--overwrite-images` explicitly scans recoverable originals for existing records. It replaces source refs, dimensions, byte hashes, default hash titles, thumbnails and derived source features, and moves the public slug/URL to the current image hash suffix while preserving the import-date prefix, all prompt variants and their original requests, tags, example IDs and votes. All slug-keyed catalog/search/visual/tag/example indexes migrate in the same CAS publication. Small retired-detail redirects remain for identity resolution and lost-response retries; the active catalog never retains the old hash URL. Explicit overwrite also repairs an already-correct image whose historical URL suffix differs, without changing its bytes. Missing/partially recovered attachments never replace existing images, and a lower-resolution clipboard attachment never downgrades a larger published original. `--metadata-only` is incompatible. If two still-active cards already own the old/new identities, the importer stops with their slugs; use the merge editor to decide which independently edited facts to keep.

Malformed private alias ledgers fail closed for both imports and merges; only an absent ledger starts empty. Private recovery records retain its pre-write text and ETag because transformed aliases cannot be reconstructed from card metadata.

Identity resolution uses the private `metadata/import-image-identities-v1.json` ledger (not part of Catalog/SSR). It records exact byte hashes and domain-separated decoded RGBA pixel-group fingerprints in original image order. This recognizes lossless clipboard/container conversions without treating perceptual similarity as equality. Pixel decoding runs locally. Validated same-turn original/projection pairs and explicit admin merges establish additional aliases; redirects preserve identities of historical merges. Unknown lossy transformations cannot be proven equal from a hash and may still need an explicit merge. A successful session reimport seeds historical aliases and the canonical source pixel fingerprint. An alias/redirect hit with different source bytes reads only that touched canonical source, verifies its SHA-256 and reuses the bytes for local inference when needed; no all-gallery image download is required. This also covers an already-merged card whose temporary attachment has disappeared. Missing or invalid session timestamps fail with a line-specific error before writes, rather than inventing a changing import date.

Authenticated `POST /api/style-gallery/import-identities` resolves up to 100 records, reserves confirmed aliases before publication, or conditionally replaces a batch. Pending aliases are invisible until their target is in the catalog, so a lost response after item publication cannot resurrect a processed copy on retry. A migration writes private recovery metadata under `import-backups/`, uses ETags for every touched object, publishes catalog last and rolls back only versions it still owns. The catalog/search/visual indexes are updated once per batch. Source objects are immutable and old objects are retained because another card/recovery record can reference them. A failed import can be rerun; console output distinguishes existing associations, unavailable originals, planned/published replacements, newly created cards, prompt duplicates and actual tag changes.

```bash
npm run import:style-prompts -- <session.jsonl> --tag '插画' --overwrite-images --dry-run
npm run import:style-prompts -- <session.jsonl> --tag '插画' --overwrite-images
```

The management token is required even for identity-aware dry runs: the resolver reads private import provenance and fresh details. `--overwrite-tag` remains independent; image replacement alone never changes existing tags.

Tag mutation responses include a transient `changedSources` count calculated during the successful conditional write (including zero for idempotent retries); this field is never stored in `tags-v1.json`. CLI output separates processed, changed and unchanged sources. Duplicate image/prompt sources remain eligible for additive tags so failed tag writes can be retried. `--overwrite-tag` changes replacement semantics, not whether duplicate records participate. If an older server omits the count, output explicitly says the count is unavailable.

The session importer removes the recognized Codex desktop attachment envelope from `originalPrompt` and removes `<oai-mem-citation>` blocks from generated text before computing IDs. Empty, line-delimited `<image name=[Image #n] path="…">…</image>` desktop attachments are removed only from original requests, never from generated prompts. Nonempty image tags and generic angle-bracket instructions remain content. It preserves ordinary Markdown, image-style trait placeholders, and paragraph layout. Historical cleanup reads HF metadata directly, backs up affected objects privately, and recomputes prompt IDs, excerpts, revisions, and search entries. Do not fix the persisted text only in the rendering layer or rescan local sessions to repair metadata.


Catalog cold reads within one server instance share an in-flight request, including schema validation. The 30-second memory TTL, CDN policy and forced management reads are unchanged. Writes detach pending reads so an older response cannot replace newly published catalog data. This reduces duplicate work during concurrent cache misses without delaying normal browsing.

## Administrator card merging

**Merge cards**, immediately after Collect image on both preview and index, accepts exactly two distinct 12–64 character image hashes. Comparison and publication both require the existing management token. Details are read only after Load comparison; ordinary list reads add no HF work. Desktop comparison uses two columns and small screens stack them. Reference and example stacks use derived thumbnails and fetch the viewed original only when opened.

Choose one reference-image identity (including its hash and URL), one import date, and at most one original request. Select any nonempty set of generated prompt variants, either/both/neither example group, and up to 12 existing tags. The chosen original request applies to all retained variants. Identical prompt IDs are deduplicated; the first selected variant becomes the default. Examples deduplicate by platform and image hash, preferring the retained card's IDs. Votes follow retained examples, with user IDs unioned for duplicate examples. Parent like totals are derived from those votes.

Closing a populated comparison or navigating away requires discard confirmation. Submitting requires a separate confirmation naming the kept and retired identities and retained counts. Saving disables close and selection controls. Failed requests retain the draft; a 409 requires reloading both cards rather than silently overwriting a competing edit or new vote.

`POST /api/style-gallery/merge` supports `preview` and `merge`. The latter requires the two comparison revisions plus the explicit selection. Revisions include each detail, its tags and indexed votes. Publication conditionally updates the retained item and example, tag, prompt-search and visual indexes, replaces the retired detail with `{ "mergedInto": "<retained-slug>" }`, and publishes the catalog last. Normal reads follow this marker and detail pages issue a permanent redirect; fresh administrative reads reject retired identities. Raw image objects remain untouched because content-addressed assets may be shared.

Before publication, `merge-backups/<uuid>.json` stores the two original details, their tag lists, example groups/votes and selection. This private recovery record is not exposed by image signing or public routes. Successful writes are journaled by ETag; ordinary failures conditionally restore owned revisions in reverse order without overwriting concurrent data. Lost responses are checked against the exact intended payload before journaling. Multi-object S3 writes are not a transaction: process termination or an unreachable store during recovery can require manual restoration from this record. There is no one-click undo. Merges invalidate existing public cache tags without adding fields to active items or changing their schema version.


### Selection and merge entry points

Preview, dense index and Sub-gallery source-tag selection share document-coordinate mouse marquee selection. A fresh gesture replaces selection; Ctrl, Shift or Cmd at pointer-down appends. Mousewheel scrolling and progressively mounted cards update the rectangle; Escape cancels to the starting selection. Form controls and touch checkboxes retain native behavior. Detail sub-image platform/download/delete selection uses the same hook. Modal prompt/tag/group checkboxes are semantic choices, not card grids, and do not use marquee selection.

A selection-only, collapsible floating dock mirrors the top actions without scrolling. Merge enters a two-card selection mode on the current list; filters and visual search preserve both choices, including hidden cards. Confirming the pair mounts the comparison dialog and reads exactly two details with the saved management token (or asks for it). No details are prefetched merely by selecting. Never reinstate manual hash entry as the primary flow. Preserve final destructive and dirty-exit confirmations, bounded dialog/textarea scrolling, and nested lightbox ownership.

## Import diagnostics and editor snapshots

The import plan reports prompts for new cards separately from additional prompts on published cards, and numbers duplicate/variant records from one. `Recovered original attachment bytes` describes local byte recovery, not publication. Image/URL replacement runs only with explicit `--overwrite-images`, before normal metadata batches. The replacement endpoint returns `changedSlugs` alongside its existing aggregate count, allowing CLI output to distinguish prompt-only, image/URL-only and combined changes from acknowledged results. The items endpoint returns `promptChangedHashes` from each committed candidate versus its fresh public prompt revision; a metadata-only or duplicate upsert is not a prompt update. Metadata batch image replacements are always zero; tags and original/thumbnail asset files have separate counts.

Tag editors reuse the small public index to open immediately. PUT still validates the shared management token and compares base tags for destructive replacement. A conflict forces a fresh editor read next time; cached drafts never bypass server authorization or concurrency checks. No extra metadata fields, SSR reads or per-card requests are introduced.
