# Cloudflare migration validation

Status: experimental read-only deployment, not ready to replace Vercel production.
Baseline: upstream main `6b7e437` (2026-11-02). Checked on 2026-11-08.

Preferred preview: https://clelele-blog-preview.pages.dev/

Workers comparison: https://clelele-blog-preview.2513502304.workers.dev/

## Reproduce

Use the repository's pinned pnpm 9.15.1. Run `pnpm build:cloudflare`, wait for
completion, then run `pnpm deploy:cloudflare-preview`. Ordinary `pnpm build`
continues to target Vercel. The Cloudflare adapter is pinned to the Astro 5
compatible 12.x line rather than upgrading the application framework.

For the separately validated Pages domain, run `node scripts/prepare-cloudflare-pages.mjs`
after the Cloudflare build. Deploy from `.cloudflare-pages` with
`npx --yes wrangler@4.158.0 pages deploy public --project-name clelele-blog-preview --branch main --force`.
Here `--force` selects the legacy Pages workflow instead of Wrangler's automatic
conversion to Workers; it is unrelated to Git force pushes. The Pages `main`
deployment branch selects this independent preview's production environment and
does not commit or merge into the Git repository's main branch.

The preview wrapper rejects all non-GET/HEAD/OPTIONS requests before Astro loads
route modules. It is intentionally not a production entrypoint. Storage credentials
are configured as Worker secrets, never bundled into code. OAuth/admin credentials
were not migrated. `.assetsignore` prevents publishing the server bundle as static
files. `.wrangler` and local secret bindings are ignored by Git.

## Verified

- Astro Cloudflare build and Wrangler bundling completed.
- Remote homepage returned HTTP 200.
- Remote gallery returned HTTP 200 after HF storage bindings were configured.
- Remote Live2D catalog endpoint returned HTTP 200.
- Pages home, gallery and Live2D catalog also returned 200 while bypassing the local
  explicit proxy. Workers-domain access timed out on that path. This validates one
  local network, not all mainland ISPs or users.
- Browser rendered the gallery layout, filters and cards; full interaction parity
  is not yet established.
- The outer preview wrapper returned HTTP 405 for POST to the gallery upload route.
- No production storage writes were performed as acceptance tests.

## Migration blockers and remaining checks

- Before the preview write guard was introduced, invoking the gallery manual
  upload route returned HTTP 500. Worker logs identify `sharp` native addon loading:
  `Dynamic require ... sharp-linuxnull-x64.node is not supported`. Astro build
  success does not establish compatibility of runtime image processing.
- Vercel cache tags and invalidation require a Cloudflare implementation with
  equivalent freshness guarantees. Removing these calls is not a migration.
- GitHub OAuth callback, sessions and protected mutations require separate staging
  setup and tests before write access is enabled.
- Music APIs, Live2D editor/runtime, all gallery interactions, image services and
  cold/concurrent request performance are not fully verified.
- Header logos using `/_image` were broken in browser inspection; the Astro image
  service needs adaptation alongside runtime Sharp operations.
- Local installation with Node 26 encountered a native `re2` build failure. A
  scripts-disabled dependency installation allowed build/runtime investigation;
  this does not prove a clean CI installation. Validate with the intended CI Node
  version before production use.
- Default-domain mainland connectivity is not guaranteed. Test the actual URL
  from the intended networks; a successful proxied request is insufficient.

Keep this PR in draft until the migration gaps have been resolved. Do not cancel
Vercel or replace production based solely on this preview.

## Native container migration in progress

The next target uses `pnpm build:cloudflare-container` with Astro's standalone
Node adapter. A single Cloudflare Container retains native Sharp and ONNX support;
HF remains the durable store. The existing Vercel build and read-only Pages preview
remain available during validation.

The outer Worker serves static assets and excludes authenticated, cookie-bearing,
range and mutation requests from shared caching. A separate cached entrypoint
translates the existing CDN TTL/tag headers while preserving browser revalidation.
Authenticated invalidation runs in that same entrypoint, retains the distinction
between stale invalidation and hard purge, and fails visibly if configuration or
invalidation is unavailable. Gallery lightweight indexes, immutable image paths,
direct HF asset delivery, CAS and pending-deletion rules are unchanged.

Local checks on 2026-11-08:

- Astro check: 0 errors, 0 warnings (19 existing hints).
- Standalone Node production build passed.
- 218 gallery tests, 28 Hpoi tests and 6 cache-policy/bridge tests passed.
- Real Sharp decoding and ONNX inference on synthetic pixels passed, producing
  the expected 384-byte quantized embedding. No storage writes or paid APIs used.
- Wrangler bundled the Worker and validated its configuration with
  `--dry-run --containers-rollout=none`. The host lacks Docker, so the actual
  Linux image must be built and validated in Cloudflare Builds before acceptance.

The container Dockerfile also runs the native probe during image creation and
retains its model weights, avoiding a runtime download on the first upload. The
gateway defaults to read-only and the container sleeps after 20 idle minutes.
Remote native uploads, OAuth, cache invalidation and cold starts still need staging
acceptance before enabling writes or replacing the existing Pages deployment.

The Pages entry in `cloudflare/pages-entry.mjs` uses a `BLOG` service binding to
`clelele-blog-container`. Passing the original Request preserves the public host
and Origin for OAuth/cookie/CSRF handling without trusting a client-supplied proxy
header. It streams the response unchanged and hides internal maintenance routes.
This entry requires its own Pages project; the earlier preview remains available
until the new container deployment passes remote acceptance.

Cache API references: [entrypoint cache invalidation](https://developers.cloudflare.com/workers/cache/purge/)
and [Workers cache examples](https://developers.cloudflare.com/workers/cache/examples/).
