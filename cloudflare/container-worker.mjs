import { WorkerEntrypoint } from 'cloudflare:workers';
import { Container, getContainer } from '@cloudflare/containers';
import { canUsePublicCache, forBrowser, forEdgeCache, parseInvalidation } from './cache-policy.mjs';

const RUNTIME_BINDINGS = [
  'HF_S3_ACCESS_KEY_ID',
  'HF_S3_SECRET_ACCESS_KEY',
  'HF_S3_BUCKET',
  'HF_S3_ENDPOINT',
  'HF_S3_REGION',
  'STYLE_GALLERY_BUCKET_PREFIX',
  'STYLE_GALLERY_UPLOAD_TOKEN',
  'STYLE_GALLERY_SIGNED_URL_TTL_SECONDS',
  'STYLE_GALLERY_GITHUB_CLIENT_ID',
  'STYLE_GALLERY_GITHUB_CLIENT_SECRET',
  'STYLE_GALLERY_GITHUB_REDIRECT_URI',
  'STYLE_GALLERY_SESSION_SECRET',
  'SITE_ADMIN_GITHUB_ID',
  'SITE_PROFILE_BUCKET_PREFIX',
  'MUSIC_ADMIN_GITHUB_ID',
  'MUSIC_SESSION_ENCRYPTION_KEY',
  'MUSIC_SESSION_HF_S3_PREFIX',
  'MUSIC_FALLBACK_METING_API',
  'MUSIC_NETEASE_AUDIO_LEVEL',
  'MUSIC_NETEASE_HEALTHCHECK_SONG_ID',
  'LIVE2D_ASSET_DELIVERY_MODE',
  'LIVE2D_HF_S3_BUCKET',
  'LIVE2D_HF_S3_ENDPOINT',
  'LIVE2D_HF_S3_PREFIX',
  'LIVE2D_HF_S3_READ_ACCESS_KEY_ID',
  'LIVE2D_HF_S3_READ_SECRET_ACCESS_KEY',
  'LIVE2D_HF_S3_REGION',
  'ANIME_QUOTE_CHARACTER',
  'ANIME_QUOTE_CHARACTER_LABEL',
  'BLOG_CACHE_INVALIDATION_URL',
  'BLOG_CACHE_INVALIDATION_TOKEN',
];

/** One stateless Node origin retains native Sharp/ONNX; durable data stays in HF. */
export class BlogContainer extends Container {
  defaultPort = 4321;
  sleepAfter = '20m';
  envVars = {
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: '4321',
    DEPLOY_TARGET: 'cloudflare-container',
    ...Object.fromEntries(
      RUNTIME_BINDINGS.filter((name) => typeof this.env[name] === 'string').map((name) => [name, this.env[name]]),
    ),
  };
}

/** Forward the public host while discarding untrusted proxy-origin headers. */
function origin(request, env) {
  const forwarded = new Request(request);
  // Never let client-supplied proxy headers change Astro's origin/CSRF checks.
  const url = new URL(request.url);
  forwarded.headers.set('x-forwarded-host', url.host);
  forwarded.headers.set('x-forwarded-proto', url.protocol.slice(0, -1));
  forwarded.headers.delete('forwarded');
  return getContainer(env.BLOG, 'primary').fetch(forwarded);
}

/** This entrypoint owns the cache; invalidation must run in the same entrypoint. */
export class CachedOrigin extends WorkerEntrypoint {
  async fetch(request) {
    return forEdgeCache(await origin(request, this.env));
  }

  async invalidate(input) {
    const { mode, tags } = parseInvalidation(input);
    const result = await this.ctx.cache[mode]({ tags });
    if (!result.success) throw new Error('Cache invalidation was rejected.');
    return true;
  }
}

/** Compare maintenance bearer credentials through constant-time HMAC verification. */
async function authorized(request, expected) {
  if (!expected) return false;
  const supplied = request.headers.get('authorization') ?? '';
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(expected), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`Bearer ${expected}`));
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(supplied));
}

export default {
  /** The uncached gateway enforces maintenance read-only mode before static or origin work. */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/_internal/cache') {
      if (request.method !== 'POST' || !(await authorized(request, env.BLOG_CACHE_INVALIDATION_TOKEN))) {
        return new Response('Unauthorized', { status: 401 });
      }
      try {
        // Read a bounded stream: Content-Length is optional and client controlled.
        const reader = request.body?.getReader();
        if (!reader) return new Response('Missing body', { status: 400 });
        const chunks = [];
        let length = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 32768) {
            await reader.cancel();
            return new Response('Too large', { status: 413 });
          }
          chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        const input = parseInvalidation(JSON.parse(new TextDecoder().decode(bytes)));
        await ctx.exports.CachedOrigin.invalidate(input);
        return new Response(null, { status: 204 });
      } catch {
        return new Response('Invalidation failed', { status: 502 });
      }
    }
    if (url.pathname.startsWith('/_internal/')) return new Response('Not found', { status: 404 });
    if (url.pathname === '/health')
      return Response.json({ service: 'clelele-blog-container', readOnly: env.BLOG_READ_ONLY !== 'false' });
    if (env.BLOG_READ_ONLY !== 'false' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      return new Response('Service is temporarily read-only.', { status: 405, headers: { Allow: 'GET, HEAD, OPTIONS' } });
    }
    try {
      if (['GET', 'HEAD'].includes(request.method)) {
        const asset = await env.ASSETS.fetch(request);
        if (asset.status !== 404) return asset;
      }
      return canUsePublicCache(request)
        ? forBrowser(await ctx.exports.CachedOrigin.fetch(request))
        : await origin(request, env);
    } catch {
      console.error(JSON.stringify({ event: 'blog_origin_unavailable', path: url.pathname }));
      return new Response('Temporarily unavailable', { status: 503, headers: { 'Retry-After': '10' } });
    }
  },
};
