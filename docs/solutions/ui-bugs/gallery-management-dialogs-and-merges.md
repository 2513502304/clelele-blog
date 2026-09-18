---
title: Gallery management dialog and merge regression boundaries
date: 2026-09-16
module: style-gallery
problem_type: ui_bug
component: management-dialogs
tags: [gallery, scrolling, lightbox, merging, conditional-writes]
---

# Gallery management regression boundaries

Read this before changing collection, prompt editing, bulk tags or card merging. Storage contracts and recovery details live in [style-gallery-storage.md](../../style-gallery-storage.md).

## Modal geometry and input

- Bound the outer dialog to the viewport (`90dvh` plus a maximum height). Keep header/footer nonshrinking and place the form body in a `min-height: 0`, flexing, vertically scrollable container. The scroll container must wrap the disabled fieldset: a fieldset is not a reliable flex-shrinking scroll root.
- Multi-line inputs and long comparison text need their own bounded heights and vertical scrolling. Preserve newlines. Reserve scrollbar space; do not let long text determine dialog height. Hash/model fields remain single-line, with enough line height for descenders.
- Keep existing-tag suggestions visibly inside the form flow. Focusing tags should scroll the suggestion section into view; invisible Tab candidates are a usability regression.
- Selecting images must occupy one large bounded fan stack, reusing `GalleryImageStack` from sub-gallery. File selections append and clipboard images are accepted. Individual removal belongs in the shared lightbox toolbar, not a file list below the stack. Recheck maximum selection, long prompts and narrow/short viewports.
- This site's actual page scroll root is `html`. Radix body locking alone does not stop background wheel chaining because global styles restore root overflow. Reuse `useGalleryDialogScrollLock`, restore the previous inline value/priority, and keep inner text/body scrolling functional.
- Nested image previews preserve the parent draft and page lock. Host the existing lightbox inside a nested Radix focus scope using its portal root. Do not change the parent modal mode: it remounts children and revokes draft blob URLs. Retain zoom/sensitivity/rotation and hide unavailable actions. Draft removal uses File identity rather than shifting indices, revokes only removed blobs, and advances the viewer; removing the last image returns to the form. Closing with Escape must not close the editor. Previews must not upload data.
- Browser checks should wait for Astro hydration and the opening animation before exercising close; the shared dialog suppresses close during its opening animation.

## Permission and destructive editing

- Reuse the management-token authorization and browser token storage. A GitHub login grants like actions, not metadata-edit rights. Never document or commit the credential value.
- Confirm both final merge and leaving a populated/changed comparison. The final confirmation identifies the retained/retired cards and retained counts. Cancel preserves selections; saving disables close and editing. Include full navigation/refresh and Back/Forward guards, not only a close-button handler.
- Compare exactly two distinct hashes. Keep one reference-image identity/hash/URL, one date and one original request. Prompt variants, example groups and tags support multiple selections; at least one generated prompt remains. Votes follow retained examples and deduplicate by user within identical platform/hash examples.
- Card hashes identify image bytes (or an ordered image group), not prompt text. Re-encoding/resizing a copied image changes its identity. Never automatically merge visually similar cards or run a user's nominated production acceptance merge.

## Storage and performance

- Comparison revisions include item data, tags and votes. Fresh administrative reads must not follow retired redirects and edit another card implicitly.
- Conditional publication updates detail and derived indexes before the catalog; retire the old detail with a redirect. Do not delete shared raw image assets. Invalidate the existing caches.
- Preserve a private recovery record. Journal successful versions by ETag and conditionally restore only those versions on failure. Lost PUT responses need exact-payload readback; a retry can report 412 even when the first attempt committed. S3 writes across objects are not a transaction: process termination or failed recovery needs manual intervention, not a false success or an unconditional retry.
- Keep list/SSR reads lightweight. Merge detail reads are explicit and on demand; stack images use thumbnails, originals open only in the viewer, and visual feature work loads only when submitting a collection.
- Use production observability to attribute CPU usage by environment, route and cold starts. Preview development alone is not evidence of the cause; crawler user agents are self-reported. Do not block normal visitors based on an unverified assumption.

## Required regression evidence

Exercise long generated/original prompts, visible tag suggestions, multiple images, desktop/mobile viewport bounds, all nested scroll areas, stable background scroll, local-viewer cleanup, merge/discard confirmations, rejected navigation, stale revisions, duplicate votes, mid-publication conflicts and lost responses. Mock destructive browser writes and test real server handlers against isolated storage. Production verification may read/compare real cards but must leave user-reserved acceptance data untouched.

### Card selection and imports (2026-09-19)

- Merge starts with exactly two visual card selections, before mounting the comparison dialog. Keep choices across text/tag/date/visual filters and show their thumbnails in the floating dock. Default small-screen docks to collapsed so they do not cover the cards users must select.
- Marquee coordinates belong to the document, not the viewport: mousewheel scroll changes the rectangle endpoint while the pointer stays still. Recompute on scroll and progressive mounting, deduplicate source IDs, and cap merge selection at two. Ctrl/Shift/Cmd at gesture start append; Escape restores the prior set. Suppress only the click generated by a drag. Ordinary bulk-tag links must still use the navigation confirmation; ordinary sub-image clicks must still open Lightbox.
- Avoid rerendering all cards on every pointer move when the selected ID set has not changed. Reuse one control state for the top toolbar and floating dock. Browser tests must scope duplicated actions to the intended toolbar.
- `--overwrite-images` now changes the active URL suffix with the source hash. Slug changes require moving tags, example groups, source/example visual records, prompt search entries and private aliases in the same conditional publication. Preserve votes and example IDs; never infer identity from visual similarity. Tiny retired-detail redirects support import retries, but are not active catalog cards.
- See `docs/research/2026-09-19-codex-image-preprocessing.md` for the pinned Codex version, measured image sizes and limits of the preprocessing evidence. Do not equate a larger file with an unprocessed original, or lossless output encoding with a lossless resize.
