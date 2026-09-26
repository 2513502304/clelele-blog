import { createHash } from 'node:crypto';

// Explicit test-server preload: exercise the real SSR routes without credentials or HF latency.
// A reserved .invalid endpoint and read-only fetch stub make production writes impossible.
Object.assign(process.env, {
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
  dimensions: { width: 640, height: 960 },
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
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname !== 'gallery-fixture.invalid') return originalFetch(input, init);
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  if (!['GET', 'HEAD'].includes(method)) throw new Error('Fixture storage is read-only.');
  const key = Object.keys(objects).find((candidate) => url.pathname.endsWith(`/${candidate}`));
  return new Response(method === 'HEAD' ? null : key ? JSON.stringify(objects[key]) : '', {
    status: key ? 200 : 404,
    headers: { 'Content-Type': 'application/json', ETag: '"fixture-v1"' },
  });
};
