import { createHash } from 'node:crypto';

// Explicit test-server preload: exercise the real SSR routes without credentials or HF latency.
// A reserved .invalid endpoint and in-memory profile writes make production mutations impossible.
Object.assign(process.env, {
  STYLE_GALLERY_SESSION_SECRET: 'profile-fixture-secret-for-local-tests-only',
  STYLE_GALLERY_GITHUB_CLIENT_ID: 'fixture-client',
  STYLE_GALLERY_GITHUB_CLIENT_SECRET: 'fixture-secret',
  STYLE_GALLERY_GITHUB_REDIRECT_URI: 'http://127.0.0.1:4340/api/style-gallery/auth/github/callback',
  SITE_ADMIN_GITHUB_ID: '129171955',
  HF_S3_ENDPOINT: 'https://gallery-fixture.invalid',
  HF_S3_ACCESS_KEY_ID: 'fixture',
  HF_S3_SECRET_ACCESS_KEY: 'fixture',
});
const slug = '2026-09-23-35dc5191ccad';
const date = '2026-09-26T00:00:00Z';
const hash = 'a'.repeat(64);
const prompt = '来源模板用于测试。';
const note = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 行：保留角色特征、花瓣、水彩笔触和完整换行。`).join('\n');
const sourceImage = '/api/style-gallery/image/source/35dc5191ccad.png';
const examples = [1, 2].map((id) => ({
  id: `fixture-${id}`,
  src: `/api/style-gallery/image/examples/images/${`${id}`.repeat(64)}.png`,
  alt: `测试生成图片 ${id}`,
  model: 'PixAI',
  note,
  uploadedAt: date,
  imageHash: `${id}`.repeat(64),
  dimensions: { width: id === 1 ? 640 : 1280, height: 960 },
}));
const item = {
  version: 4,
  slug,
  date,
  title: '生成图片提示词测试',
  sourceImage,
  imageHash: hash,
  images: [{ sourceImage, imageHash: hash }],
  examples,
  prompts: [{ id: createHash('sha256').update(prompt).digest('hex'), prompt, importedAt: date }],
};
const objects = {
  [`items/${slug}.json`]: item,
  'metadata/catalog-v5.json': {
    version: 5,
    updatedAt: date,
    modelTargets: ['GPT-Image', 'Nano Banana', 'PixAI', 'Midjourney', 'NovelAI', 'Flux'],
    items: [
      {
        slug,
        date,
        title: item.title,
        sourceImage,
        imageHash: hash,
        imageCount: 1,
        exampleCount: 2,
        promptCount: 1,
        promptRevision: hash,
        promptExcerpt: prompt,
      },
    ],
  },
  'examples/index-v2.json': {
    version: 2,
    updatedAt: date,
    groups: [{ sourceSlug: slug, examples: examples.map((example) => ({ ...example, likedBy: [] })) }],
  },
};
// Opt-in large catalog for real progressive-rendering tests; keep all existing
// detail/profile fixtures unchanged and all storage traffic on the .invalid host.
if (process.env.GALLERY_SCROLL_FIXTURE === '1') {
  const catalog = objects['metadata/catalog-v5.json'];
  const template = catalog.items[0];
  catalog.items = Array.from({ length: 192 }, (_, index) => {
    const id = (index + 1).toString(16).padStart(12, '0');
    return {
      ...template,
      slug: `2026-10-01-${id}`,
      sourceImage: `/api/style-gallery/image/source/${id}.webp`,
      imageHash: id.padStart(64, '0'),
      sourceImageDimensions: { width: 1664, height: 2432 },
    };
  });
}
const profileKey = `images/${'c'.repeat(64)}.png`;
const historyKey = `images/${'d'.repeat(64)}.png`;
objects['profile.v1.json'] = {
  version: 1,
  revision: '0b6964a3-f2db-4555-9383-d600bcaa448d',
  updatedAt: date,
  name: 'clelele',
  signature: '记录技术、AIGC、ACG 与一些个人的兴趣爱好',
  links: [],
  assets: { avatar: profileKey, home: profileKey },
  history: [profileKey, historyKey].map((key, i) => ({
    key,
    name: `历史图片${i + 1}.png`,
    uploadedAt: date,
    width: 1,
    height: 1,
  })),
};
const blobs = new Map(
  [profileKey, historyKey].map((key) => [
    key,
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
  ]),
);
let revision = 1;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  // Reserved fixture IDs exercise rating cache policy without querying real figures.
  if (url.hostname === 'www.hpoi.net' && /^\/hobby\/99000000[1-3]$/.test(url.pathname)) {
    if (url.pathname.endsWith('3')) return new Response('Fixture upstream unavailable', { status: 503 });
    const product = { '@type': 'Product' };
    if (url.pathname.endsWith('1')) product.aggregateRating = { ratingValue: 4.77, ratingCount: 2 };
    return new Response(`<script type="application/ld+json">${JSON.stringify(product)}</script>`);
  }
  if (url.hostname !== 'gallery-fixture.invalid') return originalFetch(input, init);
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  // Only this in-memory profile namespace accepts writes. No request can escape the .invalid host.
  if (!['GET', 'HEAD'].includes(method)) {
    if (method === 'DELETE' && url.pathname.includes('/site-profile/images/')) {
      blobs.delete(url.pathname.split('/site-profile/')[1]);
      return new Response(null, { status: 204 });
    }
    if (method !== 'PUT' || !url.pathname.includes('/site-profile/')) throw new Error('Fixture gallery storage is read-only.');
    const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
    if (url.pathname.endsWith('/profile.v1.json')) {
      if (new Headers(init.headers).get('if-match') !== `"fixture-v${revision}"`) return new Response('', { status: 412 });
      objects['profile.v1.json'] = JSON.parse(new TextDecoder().decode(bytes));
      revision++;
    } else blobs.set(url.pathname.split('/site-profile/')[1], bytes);
    return new Response(null, { headers: { ETag: `"fixture-v${revision}"` } });
  }
  const blobKey = [...blobs.keys()].find((key) => url.pathname.endsWith(`/${key}`));
  if (blobKey)
    return new Response(method === 'HEAD' ? null : blobs.get(blobKey), {
      headers: { 'Content-Type': 'image/png', ETag: '"image"' },
    });
  const key = Object.keys(objects).find((candidate) => url.pathname.endsWith(`/${candidate}`));
  return new Response(method === 'HEAD' ? null : key ? JSON.stringify(objects[key]) : '', {
    status: key ? 200 : 404,
    headers: { 'Content-Type': 'application/json', ETag: `"fixture-v${revision}"` },
  });
};
