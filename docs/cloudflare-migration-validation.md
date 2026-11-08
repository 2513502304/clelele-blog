# Cloudflare migration validation

Validated on 2026-11-09. Production target: https://clelele-blog.pages.dev/

The native Cloudflare deployment passed public reads, GitHub owner login,
synthetic uploads and cleanup, profile CAS/retry/cache checks, music session
login and actual browser playback. Source configuration now selects the Pages
canonical URL and enables production writes. Vercel remains available during the
observation period, approximately through 2026-11-15; it has not been deleted.

## Architecture and deployment

Pages forwards the original Request through its production `BLOG` service
binding to `clelele-blog-container`. The public host, Origin, cookies and streaming
body survive the binding. Pages hides `/_internal/*`.

Astro's standalone Node adapter runs in one basic Cloudflare Container. Native
Sharp and ONNX remain available; HF remains the durable store. The Linux image
runs a real decoding/inference probe and retains model weights. CUDA downloads
are disabled. Maximum replicas remain one; the container sleeps after 20 idle
minutes. No additional subscription was created.

The outer Worker serves static assets and bypasses shared cache for authenticated,
cookie-bearing, range and mutation requests. A separate cached entrypoint
translates existing CDN TTL/tag headers. Authenticated invalidation runs in that
same entrypoint, preserving stale invalidation versus hard purge. Signed public
image redirects retain their explicit TTL; private and login responses are
uncached. Gallery CAS, immutable image identity and pending-deletion rules remain
unchanged.

Use pinned pnpm 9.15.1 and Node 24.x (24.22.1 in the verified Linux build):

- `pnpm build:cloudflare-container` builds the native Node origin.
- `pnpm deploy:cloudflare-container` deploys the container Worker.
- `pnpm deploy:cloudflare-pages` prepares and deploys the small service-binding
  gateway to the existing `clelele-blog` Pages project. It does not copy the
  server bundle or replace the container's static assets.
- Ordinary `pnpm build` retains the Vercel adapter for the observation-period
  fallback.
- Workers Builds must track `main` after the PR merge, using the container build
  and deploy commands above. Pages' deployment branch `main` selects its own
  environment and does not commit or merge repository code.

`BLOG_READ_ONLY=true` remains an emergency maintenance switch. Acceptance used a
temporary write-enabled deployment and restored the guard afterward; the final
production source sets it to `false`.

## Credentials and music storage

New migration credentials are saved only in the user's gitignored
`~/code/Github/clelele-blog/.env.local`, mode 0600. These local names map to the
corresponding unprefixed Cloudflare Worker Secrets:

- `CLOUDFLARE_STYLE_GALLERY_GITHUB_CLIENT_ID`
- `CLOUDFLARE_STYLE_GALLERY_GITHUB_CLIENT_SECRET`
- `CLOUDFLARE_STYLE_GALLERY_GITHUB_REDIRECT_URI`
- `CLOUDFLARE_STYLE_GALLERY_SESSION_SECRET`
- `CLOUDFLARE_BLOG_CACHE_INVALIDATION_TOKEN`

The aliases are not loaded automatically by the application or Wrangler.
Unprefixed local OAuth fields belong to the existing development app and are
preserved. Optional `VERCEL_PRODUCTION_*` fields are local archives, not runtime
bindings. Temporary duplicate credential files were removed.

The existing `clelele-blog-production` GitHub OAuth app now retains both:

- `https://clelele-blog.vercel.app/api/style-gallery/auth/github/callback`
- `https://clelele-blog.pages.dev/api/style-gallery/auth/github/callback`

GitHub confirmed the save; a fresh page load confirmed both persisted callbacks.
The Cloudflare secret is a second secret on that same production app. Vercel's
old secret and homepage remain intact; the development app was not changed.

Cloudflare uses `music-sessions/cloudflare-validation` in HF. Despite its historical
name, this is now the production Cloudflare music-session prefix and must not be
deleted as temporary data. An initial encrypted Vercel session copy failed
authentication with the locally available encryption key. That unchanged
migration copy was conditionally deleted using its ETag and ciphertext identity,
with the original Vercel object preserved. The user then completed a fresh
NetEase QR login; the new encrypted Cloudflare session is healthy. No cookie
plaintext or secret value was printed or committed.

Worker secret updates affect the container process on its next start. During
migration, the login handler kept returning its old “not configured” response
until the new image/Worker deployment actually started. Application rollout
metadata and instance listings lagged; HTTP behavior established that the new
environment was active.

## Validation

Build and code checks:

- Astro check: 0 errors, 0 warnings, 19 existing hints.
- 219 Gallery tests and 30 Gallery-generation tests passed after the final API
  default changes. Earlier checks also passed 28 Hpoi, 7 cache-policy/bridge and
  153 music/Live2D tests.
- Native Sharp decoding and ONNX inference produced the expected 384-byte
  embedding locally and in the Cloudflare Linux image build.
- The verified Linux image `52b0002d688081fdc4d03ae5235800201e92c4aa9a0b3150e2f08b367c4f3616`
  completed build/deployment `dd9d6b03-4b6e-4559-9d8a-d6ddc440598b`.
- Node's former open-ended engine range selected Node 26 on Vercel and broke
  `re2`/NAN installation. Pinning 24.x passed the remote clean-install Vercel
  build for commit `0721371`. The local Vercel trace hit an absent optional
  `@img/sharp-wasm32` package in the existing local install; remote CI verified
  the clean build.
- PR review threads were empty. CodeRabbit skipped the draft and was not counted
  as an approving review.

Public/browser checks:

| Surface | Observed result |
| --- | --- |
| Home, logo, avatar, Gallery HTML/catalog | 200; images loaded and public responses reached edge HIT |
| Gallery browser | 5,613 cards; `#专辑` filtered to 43; first/next lightbox images loaded |
| Anonymous Live2D catalog | 200 MISS then HIT, 1,939,530 bytes, 115 characters / 3,522 costumes |
| Native-inclusive Live2D catalog | 165 characters / 3,783 costumes on an uncached read |
| Live2D widget | Chihaya Anon loaded in Edge |
| GitHub OAuth roundtrip | Returned to Pages without an error; owner profile admin GET returned 200 |
| Session cookie attributes | Pages host only; HttpOnly, Secure, SameSite=Lax; flow cookie removed |
| Gallery cross-origin tag write | 403 even with a valid management token |
| Gallery same-origin wrong-token write | 401 |
| Internal cache endpoint | Anonymous/wrong Bearer 401 on Worker; 404 through Pages; valid synthetic-tag request 204 |
| Synthetic Gallery source upload | 200; public read 200 and exact PNG SHA-256 match; conditional DELETE 204; origin object absent |
| Synthetic inactive profile asset | Native 32×32 dimensions; original active slots preserved; test asset removed |
| Profile deletion recovery | Pending intent was retained after a failed deletion, then completed by retry; original fields/assets/history equal afterward |
| Profile CAS and cache | Stale revision 409; same-content save 200; anonymous public revision refreshed in 35 seconds and ended as HIT |
| Music session | User QR login completed; configured/connected/healthy all true |
| Music playback | Real mouse click produced loadedmetadata and playing, readyState 4, visible pause control and time advancing to 21.72 seconds |

The first music track was a 30-second fallback preview. Vercel and Cloudflare
returned the same fallback source for that track. This verifies session health
and working playback, not full-track access for every copyright/region/account
combination. Playback was paused and temporary inspection hooks were removed.

Three warm concurrent health/catalog/avatar requests returned 200 in
0.43–1.55 seconds. This sample does not establish sustained-load capacity. The
earlier HTTP Gallery probe capped its body at 6 MiB; the browser checks above
established actual hydration and image interaction.

Initial Live2D responses contained only bootstrap data; subsequent ordinary
anonymous requests confirmed the complete remote directory without cookies,
cache-busting parameters or forced invalidation. Initial browser DOM clicks were
rejected for lacking user activation; the accepted playback check used a real
mouse click. Python's default user agent received 403, while the explicit
acceptance user agent and browser worked.

No real Gallery cards were created, merged, overwritten or deleted during
acceptance. Synthetic objects were cleaned and profile content/active assets
were preserved. Actual active-card metadata publication was covered by existing
logic tests rather than a production-record mutation.

## Cleanup and observation

The superseded Workers-only preview could not load Sharp's native addon. Its
Pages project and Worker, both named `clelele-blog-preview`, were deleted and
absence was read back. Neither had exclusive storage data. The source no longer
offers their deployment commands or adapter; the gateway helper targets only the
existing production Pages project.

Keep the Vercel blog and subscription through the observation period. Default
domain reachability depends on the user's network: the earlier phone/VPN-off
test applied to the old Pages preview; the new domain was exercised through the
local browser and HTTP checks. Continue observing the new domain and Cloudflare
usage while Vercel remains available.

References: [container environment variables and secrets](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/),
[entrypoint cache invalidation](https://developers.cloudflare.com/workers/cache/purge/),
[Pages service bindings](https://developers.cloudflare.com/pages/functions/bindings/),
and [Vercel Node version selection](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
