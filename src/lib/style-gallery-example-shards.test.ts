import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { it } from 'node:test';
import type { StyleGalleryExampleIndex, StyleGalleryExampleIndexGroup } from '@/types/style-gallery';
import { GET } from '../pages/api/style-gallery/examples/[slug]';
import {
  type ExampleManifest,
  materializeExamples,
  parseExampleRoot,
  prepareExampleRoot,
  putExampleRoot,
  queueExamplePacking,
  readGalleryMetadataSnapshot,
  STYLE_GALLERY_EXAMPLE_INDEX_KEY,
  stageExampleGroups,
  writeGalleryMetadata,
} from './style-gallery-example-shards';
import {
  getStyleGalleryExampleIndex,
  invalidateStyleGalleryStoreCache,
  mutateStyleGalleryExampleIndex,
} from './style-gallery-store';

it('publishes isolated groups atomically, replays concurrent changes, and preserves the private full readback', async (t) => {
  const keys = ['HF_S3_ENDPOINT', 'HF_S3_ACCESS_KEY_ID', 'HF_S3_SECRET_ACCESS_KEY', 'STYLE_GALLERY_UPLOAD_TOKEN'];
  const originals = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    HF_S3_ENDPOINT: 'https://gallery-fixture.invalid',
    HF_S3_ACCESS_KEY_ID: 'fixture',
    HF_S3_SECRET_ACCESS_KEY: 'fixture',
    STYLE_GALLERY_UPLOAD_TOKEN: 'fixture',
  });
  t.after(() => {
    for (const key of keys) {
      if (originals[key] === undefined) delete process.env[key];
      else process.env[key] = originals[key];
    }
    invalidateStyleGalleryStoreCache();
  });
  invalidateStyleGalleryStoreCache();
  const objects = new Map<string, Buffer>();
  const paths: string[] = [];
  const etag = (body: Buffer) => `"${createHash('sha256').update(body).digest('hex')}"`;
  let concurrent: ExampleManifest | undefined;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'gallery-fixture.invalid');
    const key = url.pathname.slice(url.pathname.indexOf('/examples/') + 1),
      method = init?.method ?? 'GET';
    if (method === 'PUT' && key === STYLE_GALLERY_EXAMPLE_INDEX_KEY && concurrent) {
      objects.set(key, Buffer.from(JSON.stringify(concurrent)));
      concurrent = undefined;
    }
    const old = objects.get(key),
      headers = new Headers(init?.headers);
    if (method === 'PUT') {
      paths.push(key);
      if (
        (headers.has('if-match') && (!old || headers.get('if-match') !== etag(old))) ||
        (old && headers.get('if-none-match') === '*')
      )
        return new Response(null, { status: 412 });
      const next = Buffer.from(await new Response(init?.body).arrayBuffer());
      objects.set(key, next);
      return new Response(null, { headers: { etag: etag(next) } });
    }
    return old
      ? new Response(method === 'HEAD' ? null : new Uint8Array(old), { headers: { etag: etag(old) } })
      : new Response(null, { status: 404 });
  });
  const updatedAt = '2026-07-22T00:00:00.000Z';
  const group = (sourceSlug: string): StyleGalleryExampleIndexGroup => ({
    sourceSlug,
    examples: [
      {
        id: sourceSlug,
        src: '/api/style-gallery/image/examples/images/aaaaaaaa.png',
        uploadedAt: updatedAt,
        model: 'GPT-Image',
        note: 'full prompt',
        likedBy: [17],
      },
    ],
  });
  const a = group('source-a'),
    b = group('source-b');
  const data: StyleGalleryExampleIndex = { version: 2, updatedAt, groups: [a, b] };
  const first: ExampleManifest = { version: 3, updatedAt, groups: await stageExampleGroups(data.groups) };
  await putExampleRoot(first, { ifNoneMatch: '*' });
  assert.deepEqual(await materializeExamples(first, undefined, true), data);
  const before = await getStyleGalleryExampleIndex({ fresh: true });
  assert.deepEqual(before, data);
  const b2 = { ...b, examples: [{ ...b.examples[0], likedBy: [17, 42] }] };
  concurrent = { ...first, groups: [first.groups[0], ...(await stageExampleGroups([b2]))] };
  paths.length = 0;
  const a2 = { ...a, examples: [{ ...a.examples[0], note: 'edited full prompt' }] };
  await mutateStyleGalleryExampleIndex((i) => ({ ...i, groups: [a2] }), 'source-a');
  const saved = parseExampleRoot(objects.get(STYLE_GALLERY_EXAMPLE_INDEX_KEY)?.toString() ?? null);
  assert.equal(saved.version, 3);
  assert.deepEqual((await getStyleGalleryExampleIndex()).groups, [b2, a2]);
  assert.equal(paths.filter((key) => key === STYLE_GALLERY_EXAMPLE_INDEX_KEY).length, 2);
  assert.equal(new Set(paths.filter((key) => key !== STYLE_GALLERY_EXAMPLE_INDEX_KEY)).size, 1);
  const endpoint = (auth: boolean) =>
    GET({
      params: { slug: 'source-a' },
      request: new Request('https://example.test/api/style-gallery/examples/source-a?view=index', {
        headers: auth ? { authorization: 'Bearer fixture' } : {},
      }),
    } as never);
  assert.equal((await endpoint(false)).status, 401);
  const resp = await endpoint(true);
  assert.match(resp.headers.get('cache-control') ?? '', /no-store/);
  assert.deepEqual(await resp.json(), a2);
  if (saved.version !== 3) throw Error('Expected manifest.');
  const deleted = await prepareExampleRoot(
    saved,
    await materializeExamples(saved, 'source-a'),
    { ...data, groups: [] },
    'source-a',
  );
  assert.deepEqual((await materializeExamples(deleted)).groups, [b2]);
  // Repair/merge tooling works on the logical document and rolls back with the physical root ETag.
  const logical = await readGalleryMetadataSnapshot(STYLE_GALLERY_EXAMPLE_INDEX_KEY);
  assert(logical.etag && logical.text);
  await assert.rejects(() =>
    writeGalleryMetadata(STYLE_GALLERY_EXAMPLE_INDEX_KEY, Buffer.from(logical.text ?? ''), 'application/json', {
      ifMatch: '"obsolete"',
    }),
  );
  const restoredEtag = await writeGalleryMetadata(
    STYLE_GALLERY_EXAMPLE_INDEX_KEY,
    Buffer.from(logical.text),
    'application/json',
    { ifMatch: logical.etag },
  );
  assert(restoredEtag);
  assert.equal(parseExampleRoot(objects.get(STYLE_GALLERY_EXAMPLE_INDEX_KEY)?.toString() ?? null).version, 3);
  // Consolidation creates optional read packs, never a competing root write; a later edit wins over an older hint.
  const many = Array.from({ length: 34 }, (_, i) => group(`other-${i}`));
  const singles: ExampleManifest = {
    version: 3,
    updatedAt,
    groups: (await Promise.all(many.map((g) => stageExampleGroups([g])))).flat(),
  };
  paths.length = 0;
  await queueExamplePacking(singles);
  assert(!paths.includes(STYLE_GALLERY_EXAMPLE_INDEX_KEY));
  const modified = { ...many[0], examples: [{ ...many[0].examples[0], note: 'after packing' }] };
  const compact = await prepareExampleRoot(
    singles,
    { ...data, groups: [many[0]] },
    { ...data, groups: [modified] },
    modified.sourceSlug,
  );
  assert.deepEqual((await materializeExamples(compact, undefined, true)).groups, [...many.slice(1), modified]);
  assert(compact.version === 3 && new Set(compact.groups.map((g) => g.pack)).size < singles.groups.length);
  const other = saved.groups.find((g) => g.sourceSlug === 'source-b');
  assert(other);
  const shardKey = `examples/shards-v3/${other.pack}.json.gz`;
  objects.delete(shardKey);
  await assert.rejects(() => materializeExamples(saved, undefined, true), /Missing or damaged/);
  objects.set(shardKey, Buffer.from('corrupt'));
  await assert.rejects(() => materializeExamples(saved, undefined, true), /Missing or damaged/);
});
