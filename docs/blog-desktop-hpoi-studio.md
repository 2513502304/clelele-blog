# Desktop collections and the small Live2D studio

Updated 2026-11-15. Production is `https://clelele-blog.pages.dev/`; the owner has paused legacy Vercel after cancelling its subscription. Use the Cloudflare Container build, not a Vercel deployment, for release acceptance.

## Layout

Collection/list pages use the available desktop width with a 2rem gutter on either side. The shared image grid increases from four to five/six/eight columns at 1800/2200/3000 CSS pixels. A Retina screen's physical screenshot dimensions are not its CSS viewport dimensions. Article pages retain the former 1800px outer bound; this change must not widen long-form prose to the entire display.

## Hpoi data and images

`useHpoiCollection` owns one client crawler shared by the category tabs. It prioritizes unvisited first pages (the selected tab first), then finishes pagination with one collection request in flight. Hpoi's public `all` HTML does not include per-item collection membership, so do not infer `care`/`want`/`buy` from this list or from profile counts. Categories can overlap and have different upstream sort orders.

Complete category snapshots are stored under `hpoi-snapshots-v2` in localStorage for immediate display across reloads. Snapshots older than 30 minutes are displayed while refreshing. Partial crawls may progressively populate an empty category, but cannot replace an already complete snapshot. Only successful completion proves additions/deletions. `reconcileHpoiItems` preserves unchanged item objects and authoritative ordering, and React keys retain card identity. A failed refresh leaves the old cards with an explicit retry action. Storage failure is optional and never blocks live reads. This is a client snapshot plus ID reconciliation, **not an upstream delta API**: Hpoi still requires HTML page reads during refresh.

The existing ratings route accepts optional `details=1` and returns `{score, imageUrl}` per ID. Its original score-only response remains unchanged. Each detail page yields both its rating and the first official product-gallery photo, with four upstream reads at most and a shared 20-second deadline. The client upgrades visible cards in small batches and caches successful per-ID results; default collection loading does not wait for these optional details. Failed/missing official images retain the list cover. Do not guess `/pic/` URLs from `/cover/` filenames; they are independent assets. All images still pass through the existing allowlisted image proxy and Cloudflare cache-tag translation.

Verified example: Hpoi 126224 (`魔女之旅 伊蕾娜`). On 2026-11-15 the `/cover/n/...3fc9be...jpg` image was 360×520, 14,546 bytes; the official `/pic/n/...1d7ba0...jpg` photo was 750×1050, 94,376 bytes. Byte counts may change. Photo selection uses `.hpoi-image-swiper a[onclick*="clickOfficialGallery"] img`, deliberately excluding user albums. Keep a parser regression test if Hpoi changes its markup.

Card title, release date and ID are always-visible translucent overlays, readable by keyboard and touch users without hover. Status and score stay at the top.

## Small studio renderer and input

The Radix dialog mounts portal contents after the parent effect, including when the floating model is already ready. The callback ref must publish the actual stage node; `useStudioViewport` subscribes to that node, not just a stable ref object and a readiness flag. Test the very first open before any model replacement or tab changes.

Our Notes zoom/pan is applied to the pinned 0.1.8 runtime's `_globals().unity_MatrixVP`, matching the standalone workbench projection. DOM percentages convert to NDC (`x / 50`, `-y / 50`). Do not reintroduce CSS scaling for native models. Zoom is 25–600%; pan is bounded at ±300% so a magnified face can be reframed. The canvas backing store is capped at DPR 2 / 4M pixels in the modal and returns to DPR 1.5 / 1.5M in the floating widget. Zoom does not allocate a 6× canvas or reload textures. Existing mipmaps and 30fps/paused scheduling remain intact.

`Live2DRenderer.setStudioViewport(null)` on dialog close restores the widget camera/budget. The renderer reapplies camera state after a model load. Paused camera edits draw once, without starting animation. Native captures already contain the camera transform, so PNG composition receives a neutral transform to avoid double zoom/pan. The Bestdori adapter retains its CSS composition fallback.

## Validation

- `npm run test:hpoi` and `npm run test:live2d`: parser, snapshot reconciliation, viewport bounds, renderer lifecycle.
- `npm exec playwright test -- --config playwright.blog.config.ts`: background prefetch, cached tab switches/reload, failed refresh retention/deletion, high-resolution upgrade, 1512/2560/390px layout.
- `npm exec playwright test -- tests/live2d/live2d-studio.spec.ts`: first-open wheel, paused camera redraw, 600% with constant canvas dimensions, local PNG and renderer reuse.
- `npm run check`, `npm run lint:fix`, `npm run build:cloudflare-container`.

The repository's existing Knip baseline includes generated/runtime entry points and unrelated unused exports; do not delete those as part of this change.
