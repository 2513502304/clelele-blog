# Cloudflare migration validation

Status on 2026-11-09: the native container and public read path are deployed;
OAuth, controlled writes and production acceptance remain pending. Vercel is
still the production fallback and must remain available during the observation
period, approximately through 2026-11-15. Keep PR #81 in draft until acceptance.

Public target: https://clelele-blog.pages.dev/

## Deployment and architecture

The production Pages project `clelele-blog` forwards the original Request through
its `BLOG` service binding to `clelele-blog-container`. This retains the public
host, Origin, cookies and streaming body for OAuth and CSRF checks. Pages hides
`/_internal/*`; the Worker's authenticated cache endpoint is not public through
Pages. Pages' deployment branch `main` selects its environment and does not merge
the repository branch.

Astro's standalone Node adapter runs in one Cloudflare Container. Native Sharp
and ONNX remain available; HF remains the durable store. The Dockerfile runs a
real decoding/inference probe and retains the model weights. CUDA downloads are
disabled because this is a CPU image. The basic instance has a maximum of one
replica and sleeps after 20 idle minutes. This uses the existing Workers Paid
account; no additional subscription was created.

The outer Worker serves static assets, bypasses shared cache for authenticated,
cookie-bearing, range and mutation requests, and translates existing CDN TTL/tag
headers in a separate cached entrypoint. Cache invalidation executes in that same
entrypoint and preserves stale invalidation versus hard purge. Signed public
image redirects retain their explicit TTL; private and login responses remain
uncached. Gallery CAS, immutable asset paths, active-card identity and
pending-deletion rules are unchanged.

`BLOG_READ_ONLY=true` rejects non-GET/HEAD/OPTIONS requests before the Node app.
The music-session prefix is separate from Vercel production. OAuth, upload/admin
and music session secrets are not yet installed. Do not enable general writes
before authentication and isolated mutation acceptance are complete.

## Reproduce

Use the pinned pnpm 9.15.1 and Node 24.22.1 for the Cloudflare image build.
`pnpm build:cloudflare-container` builds the standalone target;
`pnpm deploy:cloudflare-container` deploys the container Worker with
`wrangler.container.jsonc`. The configured Cloudflare Build tracks
`feat/cloudflare-validation`. Ordinary `pnpm build` still targets Vercel.

The Pages entrypoint is `cloudflare/pages-entry.mjs`, with a production `BLOG`
service binding to `clelele-blog-container`. Its latest accepted deployment is
`cc5782af-270e-4627-8884-06f3a5e6cd39`. The successful container build is
`8ff45ab6-cc8c-479b-9c09-baba3140455c`, from commit `8e872cc`. Initial container
provisioning can return 503 before an instance becomes available; repeat bounded
HTTP checks before classifying this as an application failure.

## Verified evidence

Local and Linux build checks:

- Astro check: 0 errors, 0 warnings, 19 existing hints; standalone build passed.
- 218 Gallery tests, 28 Hpoi tests and 7 cache-policy/bridge tests passed.
- A further 153 music/Live2D tests passed on 2026-11-09.
- Real Sharp decoding and ONNX inference produced the expected 384-byte
  quantized embedding locally and during the Cloudflare Linux image build.
- Worker bundling/configuration dry-run passed. The cloud-built image was
  deployed successfully; local Docker was unavailable.
- Authenticated remote invalidation of a synthetic cache tag returned 204.
  This proves endpoint execution, not post-mutation catalog freshness.

Public HTTP checks against the new Pages domain:

| Route | Result | Scope |
| --- | --- | --- |
| `/health` | 200, `readOnly: true` | Gateway configuration |
| `/` | 200, edge HIT | Complete 171 KB HTML response |
| Built logo WebP | 200, edge HIT | Actual image bytes |
| `/image-style-prompt-gallery` | 200, edge HIT | HTTP probe capped at 6 MiB; browser checks below |
| `/api/style-gallery/catalog` | 200 JSON, edge HIT | Complete 5.8 MB response |
| `/api/live2d/catalog` | 200 JSON, edge HIT | Four costume releases |
| `/api/site-assets/avatar` | 200 WebP, edge HIT | Actual avatar bytes |
| `/api/music/meting` without arguments | 400, BYPASS, private/no-store | Input validation only |
| Existing NetEase playlist through Meting | 200 JSON, 27 songs | Metadata only |
| First song's stream redirect chain | 206, `audio/mpeg`, ID3 prefix | 4 KiB range from the audio origin |
| GitHub login entry | 503 | Expected while OAuth is unconfigured |
| POST `/api/style-gallery/manual` | 405 | Read-only guard; no storage writes |

The HTTP probe uses an explicit `CleleleMigrationAcceptance/1.0` user agent;
Python's default user agent received 403 on the same route. This difference is
not evidence that the application handler failed.

Browser checks on 2026-11-09 used the actual new Pages domain in Edge:

- Homepage visible logo, cover, avatar and post-cover images all completed with
  nonzero intrinsic dimensions.
- Live2D reported that Chihaya Anon had loaded.
- Gallery hydrated and displayed 5,613 cards. Searching `#专辑` changed the result
  count to 43 / 5,613; visible filtered images loaded.
- Opening the first card displayed its loaded reference image and 1 / 5,613.
  Next-image navigation displayed the second loaded image and 2 / 5,613.
- The music page rendered the playlist and lyrics. A browser play click did not
  establish advancing time in this session, so playback is not accepted merely
  because the range request returned audio bytes.

These checks use the local browser/network. The user's earlier phone test with
VPN disabled applied to `clelele-blog-preview.pages.dev`, not this new domain.

## Remaining acceptance and cleanup

1. Configure GitHub OAuth for
   `https://clelele-blog.pages.dev/api/style-gallery/auth/github/callback` without
   removing Vercel's callback. A separate application's non-sensitive form has
   been prepared; its registration and secret generation await the user.
   Install credentials only as Cloudflare Secrets, never in Git or chat.
2. Verify login, session cookies, CSRF rejection and protected admin routes on
   the Pages host. Migrate upload/admin and music configuration as needed.
3. Exercise native upload, readback, update, cache freshness and deletion with
   isolated synthetic records. Do not merge, overwrite or remove real cards or
   user assets. Preserve CAS and pending-deletion behavior during cleanup.
4. Verify actual music playback/session behavior, Live2D controls/editor assets,
   and cold/concurrent requests. Test the new Pages domain from the user's
   intended network with VPN disabled.
5. After production acceptance, enable writes, update canonical site settings,
   merge the PR with a merge commit, and point the build at the production
   branch. Keep Vercel available through the observation period.
6. Remove the superseded `clelele-blog-preview` Pages project and Worker only
   after the new target passes acceptance. They are currently retained for
   fallback. Clean migration-only local artifacts after useful evidence and
   recovery material have been retained.

## Superseded experiment

The earlier Workers-only Astro Cloudflare adapter preview could serve public
pages, but runtime manual upload failed while loading Sharp's native addon
(`sharp-linuxnull-x64.node`). Header logos through `/_image` also failed. That
experiment is not the production architecture; the native container and built
logo checks above resolve those deployment incompatibilities. Its still-retained
URLs are `clelele-blog-preview.pages.dev` and
`clelele-blog-preview.2513502304.workers.dev`.

References: [Cloudflare container environment variables and secrets](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/),
[entrypoint cache invalidation](https://developers.cloudflare.com/workers/cache/purge/),
and [Workers cache examples](https://developers.cloudflare.com/workers/cache/examples/).
