# Cloudflare migration validation

Status: experimental read-only deployment, not ready to replace Vercel production.
Baseline: upstream main `6b7e437` (2026-11-02). Checked on 2026-11-08.

Preview: https://clelele-blog-preview.2513502304.workers.dev/

## Reproduce

Use the repository's pinned pnpm 9.15.1. Run `pnpm build:cloudflare`, wait for
completion, then run `pnpm deploy:cloudflare-preview`. Ordinary `pnpm build`
continues to target Vercel. The Cloudflare adapter is pinned to the Astro 5
compatible 12.x line rather than upgrading the application framework.

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
- Local installation with Node 26 encountered a native `re2` build failure. A
  scripts-disabled dependency installation allowed build/runtime investigation;
  this does not prove a clean CI installation. Validate with the intended CI Node
  version before production use.
- Default-domain mainland connectivity is not guaranteed. Test the actual URL
  from the intended networks; a successful proxied request is insufficient.

Keep this PR in draft until the migration gaps have been resolved. Do not cancel
Vercel or replace production based solely on this preview.
