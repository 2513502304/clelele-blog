# Image Style Prompt Gallery storage

The gallery stores runtime data in the Hugging Face bucket configured by `STYLE_GALLERY_BUCKET_PREFIX`. The Git repository contains the application and import tooling, not gallery records or images.

## Current layout

```text
metadata/catalog.json
items/<slug>.json
source/<hash-prefix>.<ext>
thumb/<hash-prefix>.webp
examples/index.json
examples/images/<sha256>.<ext>
```

`metadata/catalog.json` is the only object loaded by the main gallery page. It is pretty-printed JSON containing shared tags/model targets and only the card, search, sorting, pagination, and prompt-copy fields required by the preview UI. It contains `exampleCount` for card display and sorting, but no generated-example records.

`items/<slug>.json` is the source of truth for one detail page. It contains the complete prompt record, all reference images, import provenance, and that item's generated examples. A detail request therefore reads one item document instead of joining separate item and example manifests.

`examples/index.json` is a derived, compact index used only by the global sub-gallery overview. Each entry contains a source slug plus the minimum generated-example fields needed by that page. The main gallery and individual detail pages do not load it.

Generated images use a content-addressed path independent of their platform. Platform changes update metadata only; they never copy or rename image objects. Physical deletion happens only after no entry in the global example index references the image URL.

## Writes and consistency

The browser upload flow has five phases:

1. Hash selected files concurrently.
2. Read the current item once and check content-addressed image objects concurrently.
3. Upload missing files through independent same-origin requests with bounded concurrency and retries.
4. Verify each referenced image object exists.
5. Commit the item document, catalog count, and example index together. If any metadata write fails, restore all three previous documents.

The browser distinguishes transferring bytes, waiting for the server to finish the HF upload, and saving metadata. A file can therefore show `processing` after its browser upload reaches 100%; this means the server is still waiting for HF storage, not that the progress bar lost the final bytes.

Batch platform changes and deletions send one metadata mutation for every selected example, including selections spanning several platform groups. Orphan image cleanup runs concurrently after a successful metadata commit.

`POST /api/style-gallery/reconcile` rebuilds catalog example counts and `examples/index.json` from the authoritative item documents. It requires the gallery upload token.

Local development must configure the same token on the Astro server. If
`STYLE_GALLERY_UPLOAD_TOKEN` is absent from the command that starts `pnpm dev`,
the detail page remains read-only even when a token was previously saved in the
browser.

## Legacy migration

The one-time v2 migration combined `metadata/items/<slug>.json` and `examples/<slug>.json`, moved generated images from platform-specific folders to `examples/images/`, verified all counts and object references, and then removed the old metadata, image folders, snapshots, and migration code. Runtime code has no v2 fallback.
