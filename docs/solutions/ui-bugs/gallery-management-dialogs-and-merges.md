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

Generated example notes have three distinct presentations: overview cards reserve/clamp three lines, detail sub-image cards show at most five lines with their own keyboard-accessible scroll area, and Lightbox has a full-text scroll area and a separate copy-generation-prompt action. Image clicks start collapsed; the shared card note's explicit prompt action opens the reader expanded. Both overview and detail launchers must pass the complete note into Lightbox; copying a source template must not substitute for copying the actual generation input. Test the real card launchers, scrolling, and full-text clipboard content, not only injected modal data. A preview-only PR does not change production, even when example data has already been uploaded to HF.

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
- Collection and merge stacks fill their form/comparison column, without a separate narrow max-width. Their owning dialog provides vertical scrolling; keep the shared sub-gallery fan geometry and mobile width bounds.
- Marquee coordinates belong to the document, not the viewport: mousewheel scroll changes the rectangle endpoint while the pointer stays still. Recompute on scroll and progressive mounting, deduplicate source IDs, and cap merge selection at two. Ctrl/Shift/Cmd at gesture start append; Escape restores the prior set. Suppress only the click generated by a drag. Ordinary bulk-tag links must still use the navigation confirmation; ordinary sub-image clicks must still open Lightbox.
- Avoid rerendering all cards on every pointer move when the selected ID set has not changed. Reuse one control state for the top toolbar and floating dock. Browser tests must scope duplicated actions to the intended toolbar.
- `--overwrite-images` now changes the active URL suffix with the source hash. Slug changes require moving tags, example groups, source/example visual records, prompt search entries and private aliases in the same conditional publication. Preserve votes and example IDs; never infer identity from visual similarity. Tiny retired-detail redirects support import retries, but are not active catalog cards.
- See `docs/research/2026-09-19-codex-image-preprocessing.md` for the pinned Codex version, measured image sizes and limits of the preprocessing evidence. Do not equate a larger file with an unprocessed original, or lossless output encoding with a lossless resize.

### Pointer origins, dialog entry, and large imports (2026-09-19 follow-up)

- Marquee tests must begin in the whitespace above/between cards and on caption text, not only in image centers. Native `selectstart` may target a Text node; normalize to its parent element. While selection owns the gesture, prevent native pointer selection before it starts, but exclude form controls, management controls, dock controls and dialogs. Keep ordinary text selection outside selection mode.
- Selected cards need both a clear outline and a subtle glow. Dragging the dock starts anywhere on its surface, including action buttons, after a 5px movement threshold; suppress the release click after a drag. Native input/select editing remains native, and the dedicated grip retains arrow-key support. Window listeners keep dragging outside the dock; resize/content changes clamp a moved dock back into the viewport. Collapse remains independent from position.
- Collection/merge editors opt out of entrance/exit opacity compositing to avoid the reported opening flash on image-heavy pages. Preserve stable positioning, the shared modal focus scope, root scroll lock and nested lightbox behavior; do not toggle modal mode or remount drafts to address animation artifacts.
- Pass the actual route locale into detail examples and their dock. Test the Chinese route with Chinese button names; asserting English on a Chinese page previously hid the missing locale connection.
- Codex JSONL can exceed V8's maximum string size. Stream physical lines into the shared extraction state machine, retaining only paired image/Prompt records. Keep CRLF, blank-line numbering, truncated/bad JSON errors, and same-turn attachment checks. Streaming the file still retains valid image payloads needed downstream; do not claim constant-memory imports.
- Log card count, prompt count and asset count separately. Same-image/different-prompt adds a variant; identical image/prompt skips a record. Include source/prompt line numbers and matching card slug without dumping prompts or base64. Uploaded assets distinguish `source/` and `thumb/`; a 38-card import can correctly upload 76 files.
- Investigate Codex using session `originator`, session version and the actual extension binary. `source=vscode` can appear in Desktop sessions too, and upgrading the terminal CLI does not update VS Code's bundled CLI. Dimension metadata describes stored originals; it does not prove model-request bytes or activation dates.

## 2026-09-20: outer gutters, scroll rendering and tag opening

- Mark the Astro content container with `data-gallery-selection-surface`, including its padding. Restrict gesture starts vertically to the active selection section below the filters; never attach a page-wide selection handler that also owns the sidebar or dialogs.
- Render the marquee in `document.body`, using document-space anchor/card bounds and the current scroll offset. Paint through one animation frame, independently of React state. Cache card bounds until resize, image load or progressive mounting changes layout; disable hover lift while selecting. Tests must compare the actual rectangle coordinates before/after wheel movement, not merely check that the rectangle exists.
- Tag drafts may open from the already-loaded public index. Authentication remains on every PUT; single-card and bulk replacement writes carry base tags for conflict detection. After 409, invalidate the editor snapshot so closing/reopening reads fresh data. Do not publish or reset a user's draft from a delayed background request.
- Import diagnostics must separate recovery of local original bytes from a confirmed production image/URL replacement. Metadata batches only modify prompts; acknowledged replacement hashes identify cards changed in both stages. Never call candidate totals successful writes.
- A Codex `event_msg:user_message` image and `response_item:input_image` are different projections. Keep higher-resolution UI bytes where available; investigate both before drawing conclusions about client behavior. Attachment UI, file mentions and structured local-image paths are three different signals; none alone proves lossy processing. See the nine-image report for concrete counterexamples.


### Embedded UI images and historical identities

Treat `user_message.images` and same-turn `item_completed.UserMessage` image content as UI representations, independent of attachment paths. Selecting better source bytes must retain the displaced model group hash for private identity resolution. A byte-integrity check and an idempotent rerun do not prove that there is no second active card: also resolve every corroborated representation and check that they converge to one identity. If they resolve to two active cards, stop before publication and report the conflict. Keep group order, require matching input identity, and never infer a relationship from the generic reverse-prompt request alone.
