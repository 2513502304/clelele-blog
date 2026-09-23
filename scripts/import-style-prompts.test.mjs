import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { assertStyleGalleryItemConsistency } from '../src/lib/style-gallery-assets.ts';
import {
  buildCanonicalIdentityBinding,
  buildImportData,
  extractItems,
  getDecodedItemHash,
  getExtractedItemHash,
  getImportDate,
  parseArgs,
  planImageMigrations,
  readSessionItems,
  requestWithRetries,
  resolveOriginalImages,
  uniqueImagesByHash,
  writeImportedTags,
} from './import-style-prompts.mjs';

const PLACEHOLDER = '[在此处替换为您想要生成的主体内容]';

it('retries a failed image response body but does not retry an authorization rejection', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response('image bytes');
    };
    const bytes = await requestWithRetries('https://example.test/image', {}, 1000, async (response) => {
      if (calls === 1) throw new Error('Body stream interrupted after successful headers');
      return response.text();
    });
    assert.equal(bytes, 'image bytes');
    assert.equal(calls, 2);
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response('Unauthorized', { status: 401 });
    };
    await assert.rejects(
      requestWithRetries('https://example.test/image', {}, 1000, (r) => r.text()),
      /Unauthorized/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it('requires stable session dates before identity lookup or writes', () => {
  for (const timestamp of [undefined, null, '', 'invalid'])
    assert.throws(() => getImportDate({ timestamp, sourceLine: 42 }), /Line 42: missing or invalid/);
  assert.equal(getImportDate({ timestamp: '2026-09-18T01:00:00+08:00' }), '2026-09-17');
});

it('seeds canonical pixel aliases after an old projection resolves through a manual merge', async () => {
  const original = await sharp({ create: { width: 40, height: 60, channels: 3, background: '#adcefb' } })
    .jpeg()
    .toBuffer();
  const resized = await sharp(original).resize(20, 30).jpeg().toBuffer();
  const png = await sharp(original).png().toBuffer();
  const imageHash = crypto.createHash('sha256').update(original).digest('hex');
  const projection = { images: [`data:image/jpeg;base64,${resized.toString('base64')}`] };
  let reads = 0;
  const binding = await buildCanonicalIdentityBinding(
    { imageHash, slug: 'canonical', images: [{ imageHash }] },
    projection,
    async () => {
      reads++;
      return original;
    },
  );
  const clipboardHash = await getDecodedItemHash({ images: [`data:image/png;base64,${png.toString('base64')}`] });
  assert.equal(reads, 1);
  assert.deepEqual(binding.hashes, [imageHash, clipboardHash]);
  assert.notEqual(clipboardHash, await getDecodedItemHash(projection));
});

describe('style prompt import variants', () => {
  it('restores only matched structured originals before hashing, with explicit missing-file fallback', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-import-'));
    const originalPath = path.join(directory, 'original.jpg');
    const bytes = await sharp({ create: { width: 1289, height: 2048, channels: 3, background: '#aabbcc' } })
      .jpeg()
      .toBuffer();
    const resized = await sharp(bytes).resize(1248, 1982).jpeg().toBuffer();
    const uri = `data:image/jpeg;base64,${resized.toString('base64')}`;
    await fs.writeFile(originalPath, bytes);
    const records = [
      {
        index: 1,
        record: {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            internal_chat_message_metadata_passthrough: { turn_id: 'turn-a' },
            content: [
              { type: 'input_text', text: `<image name=[Image #1] path="${originalPath}">` },
              { type: 'input_image', image_url: uri },
              { type: 'input_text', text: '</image>' },
            ],
          },
        },
      },
      {
        index: 2,
        record: {
          type: 'event_msg',
          payload: {
            type: 'item_completed',
            turn_id: 'turn-a',
            item: { type: 'UserMessage', content: [{ type: 'local_image', path: originalPath }] },
          },
        },
      },
      {
        index: 3,
        record: {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: `${PLACEHOLDER} style` }],
          },
        },
      },
    ];
    try {
      const extracted = extractItems(records);
      assert.equal(extracted.length, 1);
      const result = await resolveOriginalImages(extracted);
      assert.equal(result.restored, 1);
      assert.equal(result.fallback, 0);
      const unchanged = await resolveOriginalImages(result.items);
      assert.equal(unchanged.restored, 0);
      assert.equal(unchanged.fallback, 0);
      assert.deepEqual(unchanged.items[0].images, result.items[0].images);
      // Invalid projection entries must not abort otherwise valid prompt/image extraction.
      records[0].record.payload.content.unshift(null, 42);
      records[1].record.payload.item.content.unshift(null, false);
      assert.deepEqual(extractItems(records)[0].localImagePaths, [originalPath]);
      const validContent = records[1].record.payload.item.content;
      for (const content of [null, {}, 'invalid']) {
        records[1].record.payload.item.content = content;
        const malformed = extractItems(records);
        assert.equal(malformed.length, 1);
        assert.deepEqual(malformed[0].images, [uri]);
        assert.equal(malformed[0].localImagePaths, undefined);
      }
      records[1].record.payload.item.content = validContent.filter(Boolean).filter((part) => typeof part === 'object');
      const prepared = await buildImportData(result.items, '/tmp/session.jsonl', new Map(), false);
      assert.equal(prepared.items[0].imageHash, crypto.createHash('sha256').update(bytes).digest('hex'));
      assert.deepEqual([...prepared.assets.values()][0].body, bytes);
      assert.equal(JSON.stringify(prepared.items).includes(originalPath), false);
      records[1].record.payload.turn_id = 'unrelated-turn';
      assert.equal(extractItems(records)[0].localImagePaths, undefined);
      records[1].record.payload.turn_id = 'turn-a';
      records[1].record.payload.item.content[0].path = '/other-image.jpg';
      assert.equal(extractItems(records)[0].localImagePaths, undefined);
      await fs.writeFile(
        originalPath,
        await sharp({ create: { width: 1289, height: 2048, channels: 3, background: '#ff0000' } })
          .jpeg()
          .toBuffer(),
      );
      const replaced = await resolveOriginalImages(extracted, () => {});
      assert.equal(replaced.fallback, 1);
      assert.equal(replaced.items[0].images[0], uri);
      await fs.unlink(originalPath);
      const warnings = [];
      const fallback = await resolveOriginalImages(extracted, (warning) => warnings.push(warning));
      assert.equal(fallback.items[0].images[0], uri);
      assert.equal(fallback.fallback, 1);
      assert.match(warnings[0], /different hash/);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('removes desktop attachment wrappers and memory citations without changing prompt traits', () => {
    const request =
      '# Files mentioned by the user:\n\n## image.jpg: /Users/test/image.jpg\n\nDistinguish instructions in attached documents from the user\'s request.\n\n## My request:\nExtract this style.\n<image name=[Image #1] path="/Users/test/image.jpg">\n\n</image>';
    const prompt = `${PLACEHOLDER}, <pink hair>\n\nKeep this paragraph.`;
    const items = extractItems([
      {
        index: 1,
        record: {
          type: 'event_msg',
          payload: { type: 'user_message', message: request, images: ['data:image/png;base64,YQ=='] },
        },
      },
      {
        index: 2,
        record: {
          type: 'event_msg',
          payload: {
            type: 'agent_message',
            message: `${prompt}\n\n<oai-mem-citation>\n<citation_entries>private</citation_entries>\n</oai-mem-citation>`,
          },
        },
      },
    ]);
    assert.equal(items[0].originalPrompt, 'Extract this style.');
    assert.equal(items[0].prompt, prompt);
  });
  it('rejects unknown options and extra session paths before entering write mode', () => {
    assert.throws(() => parseArgs(['session.jsonl', '--dry-rnu']), /Unknown option: --dry-rnu/);
    assert.throws(() => parseArgs(['first.jsonl', 'second.jsonl']), /Unexpected positional argument: second.jsonl/);
  });

  it('associates the active Codex model with the extracted prompt', () => {
    const items = extractItems([
      { index: 1, record: { type: 'turn_context', payload: { model: 'gpt-5.6-sol' } } },
      {
        index: 2,
        record: {
          type: 'event_msg',
          timestamp: '2026-08-11T00:00:00.000Z',
          payload: { type: 'user_message', message: 'Extract this style.', images: ['data:image/png;base64,YQ=='] },
        },
      },
      {
        index: 3,
        record: { type: 'event_msg', payload: { type: 'agent_message', message: `${PLACEHOLDER}, prompt body` } },
      },
    ]);

    assert.equal(items.length, 1);
    assert.equal(items[0].model, 'gpt-5.6-sol');
  });

  it('extracts structured response_item messages without reading their event duplicates', () => {
    const items = extractItems([
      {
        index: 1,
        record: { type: 'event_msg', timestamp: '2026-08-29T00:00:00.000Z', payload: { type: 'task_started' } },
      },
      { index: 2, record: { type: 'turn_context', payload: { model: 'gpt-5.6-sol' } } },
      {
        index: 3,
        record: {
          type: 'response_item',
          timestamp: '2026-08-29T00:00:01.000Z',
          payload: {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: 'Extract this style.' },
              { type: 'input_image', image_url: 'data:image/png;base64,YQ==' },
              { type: 'input_image', image_url: 'data:image/jpeg;base64,Yg==' },
            ],
          },
        },
      },
      {
        index: 4,
        record: {
          type: 'event_msg',
          payload: {
            type: 'item_completed',
            item: { type: 'UserMessage', content: [{ type: 'image', image_url: 'data:image/png;base64,YQ==' }] },
          },
        },
      },
      {
        index: 5,
        record: {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            phase: 'commentary',
            content: [{ type: 'output_text', text: `${PLACEHOLDER}, intermediate commentary` }],
          },
        },
      },
      {
        index: 6,
        record: {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: `${PLACEHOLDER}, structured prompt body` }],
          },
        },
      },
      {
        index: 7,
        record: {
          type: 'event_msg',
          payload: { type: 'task_complete', last_agent_message: `${PLACEHOLDER}, structured prompt body` },
        },
      },
    ]);

    assert.equal(items.length, 1);
    assert.equal(items[0].images.length, 2);
    assert.equal(items[0].originalPrompt, 'Extract this style.');
    assert.equal(items[0].prompt, `${PLACEHOLDER}, structured prompt body`);
    assert.equal(items[0].model, 'gpt-5.6-sol');
    assert.equal(items[0].sourceLine, 3);
    assert.equal(items[0].promptLine, 6);
  });

  it('does not associate an interrupted task image with the next task response', () => {
    const items = extractItems([
      { index: 1, record: { type: 'event_msg', payload: { type: 'task_started' } } },
      {
        index: 2,
        record: {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_image', image_url: 'data:image/png;base64,YQ==' }],
          },
        },
      },
      { index: 3, record: { type: 'event_msg', payload: { type: 'task_complete', last_agent_message: '' } } },
      { index: 4, record: { type: 'event_msg', payload: { type: 'task_started' } } },
      {
        index: 5,
        record: {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: `${PLACEHOLDER}, unrelated prompt` }],
          },
        },
      },
    ]);

    assert.deepEqual(items, []);
  });

  it('adds a different prompt to an existing image without rebuilding image assets', async () => {
    const bytes = Buffer.from('a');
    const imageHash = crypto.createHash('sha256').update(bytes).digest('hex');
    const existing = {
      slug: `2026-08-11-${imageHash.slice(0, 12)}`,
      title: `Style Prompt ${imageHash.slice(0, 12)}`,
      date: '2026-08-10T00:00:00.000Z',
      sourceImage: `/api/style-gallery/image/source/${imageHash.slice(0, 12)}.png`,
      sourceImageAlt: 'Existing reference image',
      promptExcerpt: `${PLACEHOLDER}, first prompt`,
      prompts: [`${PLACEHOLDER}, first prompt`, `${PLACEHOLDER}, second prompt`],
      promptCount: 2,
      promptRevision: 'c'.repeat(64),
      imageHash,
      imageCount: 1,
      exampleCount: 0,
      images: [
        {
          sourceImage: `/api/style-gallery/image/source/${imageHash.slice(0, 12)}.png`,
          sourceImageAlt: 'Existing reference image',
          imageHash,
        },
      ],
    };
    const extracted = [
      {
        images: [`data:image/png;base64,${bytes.toString('base64')}`],
        originalPrompt: 'Extract this style again.',
        sourceLine: 8,
        timestamp: '2026-08-11T00:00:00.000Z',
        model: 'gpt-5.6-terra',
        prompt: `${PLACEHOLDER}, third prompt`,
      },
    ];

    const prepared = await buildImportData(extracted, '/tmp/session.jsonl', new Map([[imageHash, existing]]), false, null);
    assert.equal(prepared.assets.size, 0);
    assert.equal(prepared.items.length, 1);
    assert.equal(prepared.items[0].slug, existing.slug);
    assert.deepEqual(prepared.sourceSlugs, [existing.slug]);
    assert.equal(prepared.items[0].prompts[0].model, 'gpt-5.6-terra');
    assert.deepEqual(prepared.items[0].images, existing.images);
    assert.doesNotThrow(() => assertStyleGalleryItemConsistency(prepared.items[0]));

    const duplicate = await buildImportData(
      [{ ...extracted[0], prompt: existing.prompts[0] }],
      '/tmp/session.jsonl',
      new Map([[imageHash, existing]]),
      false,
      null,
    );
    assert.equal(duplicate.items.length, 0);
    assert.equal(duplicate.skippedDuplicates, 1);
    assert.deepEqual(duplicate.sourceSlugs, [existing.slug]);

    const duplicateAdditionalPrompt = await buildImportData(
      [{ ...extracted[0], prompt: existing.prompts[1] }],
      '/tmp/session.jsonl',
      new Map([[imageHash, existing]]),
      false,
      null,
    );
    assert.equal(duplicateAdditionalPrompt.items.length, 0);
    assert.equal(duplicateAdditionalPrompt.skippedDuplicates, 1);
  });

  it('groups ordered prompt variants for the same new image', async () => {
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const common = {
      images: [`data:image/png;base64,${bytes.toString('base64')}`],
      originalPrompt: 'Extract this style.',
      timestamp: '2026-08-11T00:00:00.000Z',
      model: 'gpt-5.6-sol',
    };
    const firstPrompt = `${PLACEHOLDER}, first extraction`;
    const secondPrompt = `${PLACEHOLDER}, second extraction`;

    const prepared = await buildImportData(
      [
        { ...common, sourceLine: 2, prompt: firstPrompt },
        { ...common, sourceLine: 8, prompt: secondPrompt },
        { ...common, sourceLine: 12, prompt: firstPrompt },
      ],
      '/tmp/session.jsonl',
      new Map(),
      false,
      null,
    );

    assert.equal(prepared.items.length, 1);
    assert.deepEqual(
      prepared.items[0].prompts.map(({ prompt }) => prompt),
      [firstPrompt, secondPrompt],
    );
    assert.notEqual(prepared.items[0].prompts[0].id, prepared.items[0].prompts[1].id);
    assert.equal(prepared.skippedDuplicates, 1);
    assert.deepEqual(
      prepared.recordDetails.map(({ kind, sourceLine, previousLine }) => ({ kind, sourceLine, previousLine })),
      [
        { kind: 'variant', sourceLine: 8, previousLine: 2 },
        { kind: 'duplicate', sourceLine: 12, previousLine: 2 },
      ],
    );
    assert.equal([...prepared.assets.keys()].filter((key) => key.startsWith('source/')).length, 1);
    assert.equal([...prepared.assets.keys()].filter((key) => key.startsWith('thumb/')).length, 1);
  });

  it('deduplicates repeated image references before creating visual index records', () => {
    const first = { imageHash: 'a'.repeat(64), sourceImage: 'first' };
    const duplicate = { imageHash: first.imageHash, sourceImage: 'duplicate' };
    const second = { imageHash: 'b'.repeat(64), sourceImage: 'second' };
    assert.deepEqual(uniqueImagesByHash([first, duplicate, second]), [first, second]);
  });
});

describe('import category flags', () => {
  it('normalizes repeated optional labels and validates them before uploading', () => {
    assert.deepEqual(parseArgs(['session.jsonl']).tags, []);
    assert.deepEqual(parseArgs(['session.jsonl', '--tag', '＃溶图', '--tag=现实', '--tag', '溶图']).tags, ['溶图', '现实']);
    for (const args of [
      ['--tag'],
      ['--tag', '--dry-run'],
      ['--tag='],
      ['--tag=<x>'],
      ['--tag=#null'],
      [`--tag=${'长'.repeat(25)}`],
    ]) {
      assert.throws(() => parseArgs(['session.jsonl', ...args]), /tag/);
    }
    assert.throws(() => parseArgs(['session.jsonl', ...Array.from({ length: 13 }, (_, i) => `--tag=tag${i}`)]), /At most 12/);
  });

  it('does not write without tags and sends one additive authenticated request for a batch', async () => {
    const original = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return Response.json({ version: 1, items: { 'source-a': ['existing', '溶图'] }, changedSources: 1 });
    };
    try {
      await writeImportedTags('https://blog.example', 'test-only', ['source-a'], []);
      await writeImportedTags('https://blog.example', 'test-only', [], ['溶图']);
      assert.equal(requests.length, 0);
      const result = await writeImportedTags(
        'https://blog.example',
        'test-only',
        ['source-a', 'source-a', 'source-b'],
        ['溶图', '现实'],
      );
      assert.deepEqual(result, { processed: 2, changed: 1 });
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, 'https://blog.example/api/style-gallery/tags');
      const { options } = requests[0];
      assert.equal(options.method, 'PUT');
      assert.equal(options.headers.origin, 'https://blog.example');
      assert.equal(options.headers.authorization, 'Bearer test-only');
      assert.deepEqual(JSON.parse(options.body), { slugs: ['source-a', 'source-b'], tags: ['溶图', '现实'] });
      globalThis.fetch = async () => new Response('Tag vocabulary limit reached', { status: 400 });
      await assert.rejects(writeImportedTags('https://blog.example', 'test-only', ['source-a'], ['new']), /400|vocabulary/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('requires explicit overwrite plus tags and compares the latest tags when replacing', async () => {
    assert.equal(parseArgs(['session.jsonl']).overwriteTag, false);
    assert.equal(parseArgs(['session.jsonl', '--tag=现实', '--overwrite-tag']).overwriteTag, true);
    assert.throws(() => parseArgs(['session.jsonl', '--overwrite-tag']), /requires.*--tag/);
    const original = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return Response.json({ version: 1, items: { 'source-a': ['插画', '溶图'] } });
    };
    try {
      await writeImportedTags('https://blog.example', 'test-only', ['source-a', 'source-b'], ['现实'], true);
      assert.equal(requests.length, 2);
      assert.equal(new URL(requests[0].url).searchParams.get('edit'), '1');
      assert.equal(requests[0].options.cache, 'no-store');
      assert.equal(requests[0].options.headers.authorization, 'Bearer test-only');
      assert.deepEqual(JSON.parse(requests[1].options.body), {
        slugs: ['source-a', 'source-b'],
        tags: ['现实'],
        mode: 'replace',
        previousTagsBySlug: { 'source-a': ['插画', '溶图'], 'source-b': [] },
      });
      // A conflict must not be retried with a refreshed base, which would silently discard concurrent edits.
      let puts = 0;
      globalThis.fetch = async (_url, options) => {
        if (options.method === 'PUT') {
          puts++;
          return new Response('Tags changed', { status: 409 });
        }
        return Response.json({ version: 1, items: {} });
      };
      await assert.rejects(writeImportedTags('https://blog.example', 'test-only', ['source-a'], ['现实'], true), /409|changed/);
      assert.equal(puts, 1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('keeps replacement requests under 2 MB with maximum-length source IDs and four-byte labels', async () => {
    const original = globalThis.fetch;
    const slugs = Array.from({ length: 2001 }, (_, i) => `${'s'.repeat(156)}${String(i).padStart(4, '0')}`);
    const tags = Array.from({ length: 12 }, (_, i) => String.fromCodePoint(0x20000 + i).repeat(24));
    const items = Object.fromEntries(slugs.map((slug) => [slug, tags]));
    const batches = [];
    let reads = 0;
    globalThis.fetch = async (_url, options) => {
      if (options.method === 'PUT') {
        assert.ok(Buffer.byteLength(options.body, 'utf8') < 2_000_000);
        const body = JSON.parse(options.body);
        assert.deepEqual(Object.keys(body.previousTagsBySlug), body.slugs);
        for (const base of Object.values(body.previousTagsBySlug)) assert.deepEqual(base, tags);
        batches.push(body.slugs);
      } else reads++;
      return Response.json({ version: 1, items });
    };
    try {
      await writeImportedTags('https://blog.example', 'test-only', [...slugs, slugs[0]], ['现实'], true);
      assert.deepEqual(
        batches.map((batch) => batch.length),
        [1000, 1000, 1],
      );
      assert.deepEqual(batches.flat(), slugs);
      assert.equal(reads, 3);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('metadata-only excludes new sources from tag additions', async () => {
    const prepared = await buildImportData(
      [{ images: ['data:image/png;base64,YQ=='], prompt: 'test' }],
      '/tmp/session.jsonl',
      new Map(),
      true,
      null,
    );
    assert.deepEqual(prepared.sourceSlugs, []);
    assert.equal(prepared.skippedNewMetadata, 1);
  });
});

it('image replacement is opt-in, deduplicated per card, and never downgrades missing originals', async () => {
  const png = await sharp({ create: { width: 20, height: 30, channels: 3, background: '#aabbcc' } })
    .png()
    .toBuffer();
  const item = {
    images: [`data:image/png;base64,${png.toString('base64')}`],
    prompt: `${PLACEHOLDER} test`,
    timestamp: '2026-09-01T00:00:00Z',
    sourceLine: 2,
    embeddedHash: 'a'.repeat(64),
    originalsVerified: 1,
  };
  const match = {
    item: {
      imageHash: 'a'.repeat(64),
      slug: 'old-card',
      images: [{ imageHash: 'a'.repeat(64), sourceImage: '/api/style-gallery/image/source/aaaaaaaaaaaa.jpg' }],
      prompts: [],
      title: 'Old',
      date: item.timestamp,
    },
    revision: 'revision',
  };
  assert.equal(parseArgs(['test.jsonl']).overwriteImages, false);
  assert.equal(parseArgs(['test.jsonl', '--overwrite-images']).overwriteImages, true);
  assert.throws(() => parseArgs(['test.jsonl', '--overwrite-images', '--metadata-only']), /cannot/);
  assert.equal(planImageMigrations([item], [match], false).length, 0);
  assert.equal(planImageMigrations([item, item], [match, match], true).length, 1);
  assert.equal(
    planImageMigrations(
      [{ ...item, originalDimensions: [{ width: 10, height: 10 }] }],
      [{ ...match, item: { ...match.item, images: [{ ...match.item.images[0], dimensions: { width: 20, height: 20 } }] } }],
      true,
    ).length,
    0,
  );

  assert.equal(
    planImageMigrations([{ ...item, originalsVerified: 0, embeddedHash: getExtractedItemHash(item) }], [match], true).length,
    0,
  );
  const existing = { ...match.item, prompts: [item.prompt] };
  const prepared = await buildImportData(
    [{ ...item, canonicalHash: existing.imageHash }],
    '/tmp/session.jsonl',
    new Map([[existing.imageHash, existing]]),
    false,
  );
  assert.equal(prepared.assets.size, 0);
  assert.equal(prepared.items.length, 0);
  assert.equal(prepared.skippedDuplicates, 1);
  const changed = await buildImportData(
    [{ ...item, canonicalHash: existing.imageHash, prompt: `${PLACEHOLDER} new prompt` }],
    '/tmp/session.jsonl',
    new Map([[existing.imageHash, existing]]),
    false,
  );
  assert.equal(changed.items[0].slug, 'old-card');
  assert.deepEqual(changed.items[0].images, existing.images);
  assert.equal(changed.assets.size, 0);
});

it('clipboard containers share exact decoded identity, but resized/edited pixels do not', async () => {
  const jpeg = await sharp({ create: { width: 30, height: 40, channels: 3, background: '#123456' } })
    .jpeg()
    .toBuffer();
  const png = await sharp(jpeg).png().toBuffer();
  const resized = await sharp(jpeg).resize(15, 20).png().toBuffer();
  const item = (bytes, mime) => ({ images: [`data:image/${mime};base64,${bytes.toString('base64')}`] });
  assert.notEqual(getExtractedItemHash(item(jpeg, 'jpeg')), getExtractedItemHash(item(png, 'png')));
  assert.equal(await getDecodedItemHash(item(jpeg, 'jpeg')), await getDecodedItemHash(item(png, 'png')));
  assert.notEqual(await getDecodedItemHash(item(jpeg, 'jpeg')), await getDecodedItemHash(item(resized, 'png')));
});

it('streams records across chunks, preserves physical lines, and reports corrupt JSON precisely', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-stream-'));
  const file = path.join(directory, 'session.jsonl');
  const records = [
    {
      type: 'event_msg',
      timestamp: '2026-09-17T00:00:00Z',
      payload: { type: 'user_message', images: ['data:image/png;base64,YQ=='], message: '原始请求' },
    },
    { type: 'event_msg', payload: { type: 'agent_message', message: PLACEHOLDER + '中文段落\n'.repeat(20000) } },
  ];
  try {
    await fs.writeFile(file, `\r\n${records.map((r) => JSON.stringify(r)).join('\r\n\r\n')}`);
    const result = await readSessionItems(file);
    assert.deepEqual(result, extractItems(records.map((record, i) => ({ record, index: 2 + i * 2 }))));
    assert.equal(result[0].sourceLine, 2);
    assert.equal(result[0].promptLine, 4);
    await fs.appendFile(file, '\n\ninvalid json');
    await assert.rejects(readSessionItems(file), /Failed to parse JSONL line 6/);
    await assert.rejects(readSessionItems(path.join(directory, 'missing')), /ENOENT/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

it('import diagnostics separate new-card prompts, additional prompts and numbered skipped duplicates', async () => {
  const { describeImportPlan, describeMetadataWrite } = await import('./lib/style-prompt-import-diagnostics.mjs');
  const result = describeImportPlan(
    {
      sourceSlugs: ['new', 'old', 'duplicate'],
      items: [
        { imageHash: 'new', prompts: ['a', 'b'] },
        { imageHash: 'old', prompts: ['c'] },
      ],
      skippedDuplicates: 2,
      recordDetails: [
        { kind: 'duplicate', slug: 'duplicate', sourceLine: 10, promptLine: 11 },
        { kind: 'variant', slug: 'new', sourceLine: 20, promptLine: 21, previousLine: 1 },
        { kind: 'duplicate', slug: 'duplicate', sourceLine: 30, promptLine: 31 },
        { kind: 'variant', slug: 'old', sourceLine: 40, promptLine: 41 },
      ],
    },
    new Map([['old', {}]]),
  );
  assert.match(result, /New cards: 1, with 2 prompt\(s\). Existing cards: 1, with 1 additional/);
  assert.match(result, /Duplicate skipped \[1\]: duplicate; image line 10/);
  assert.match(result, /Duplicate skipped \[2\]: duplicate; image line 30/);
  assert.match(result, /Additional prompt \[2\]: old; image line 40/);
  assert.match(
    describeMetadataWrite(
      { created: 98, updated: 2, addedPrompts: 100, promptChangedHashes: ['old', 'other'] },
      new Set(['old']),
    ),
    /1 prompt-only, 1 also image-replaced earlier/,
  );
  assert.match(
    describeMetadataWrite({ updated: 2, promptChangedHashes: ['a', 'b'] }),
    /2 prompt-only, 0 also image-replaced earlier/,
  );
});

it('metadata-only upserts do not count as prompt mutations', async () => {
  const { describeMetadataWrite } = await import('./lib/style-prompt-import-diagnostics.mjs');
  assert.match(
    describeMetadataWrite({ updated: 1, items: [{ imageHash: 'old' }], promptChangedHashes: [] }, new Set(['old'])),
    /0 existing card\(s\) with prompt changes \(0 prompt-only, 0 also image-replaced earlier\)/,
  );
});

it('matches user_message local_images and preserves attachment context across a UI projection', () => {
  const model = {
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      internal_chat_message_metadata_passthrough: { turn_id: 'a' },
      content: [
        { type: 'input_text', text: 'request' },
        { type: 'input_text', text: '<image name=[Image #1] path="/original.jpg">' },
        { type: 'input_image', image_url: 'data:image/jpeg;base64,AA==' },
        { type: 'input_text', text: '</image>' },
      ],
    },
  };
  const ui = {
    type: 'event_msg',
    payload: { type: 'user_message', message: 'request', images: [], local_images: ['/original.jpg'] },
  };
  const completed = {
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      turn_id: 'a',
      item: { type: 'UserMessage', content: [{ type: 'local_image', path: '/original.jpg' }] },
    },
  };
  const final = { type: 'event_msg', payload: { type: 'agent_message', message: `${PLACEHOLDER} style` } };
  const extract = (...records) => extractItems(records.map((record, index) => ({ record, index: index + 1 })));
  assert.deepEqual(extract(model, ui, final)[0].localImagePaths, ['/original.jpg']);
  const projection = { ...ui, payload: { ...ui.payload, images: ['data:image/jpeg;base64,AQ=='], local_images: [] } };
  assert.deepEqual(extract(model, projection, completed, final)[0].localImagePaths, ['/original.jpg']);
  assert.deepEqual(extract(model, completed, projection, final)[0].localImagePaths, ['/original.jpg']);
  assert.equal(extract(model, projection, completed, final)[0].images[0], 'data:image/jpeg;base64,AQ==');
  for (const local_images of [['/wrong.jpg'], ['/original.jpg', '/extra.jpg'], ['relative.jpg'], null]) {
    assert.equal(extract(model, { ...ui, payload: { ...ui.payload, local_images } }, final)[0].localImagePaths, undefined);
  }
  assert.equal(extract(model, { ...ui, payload: { ...ui.payload, turn_id: 'other' } }, final).length, 0);
  assert.equal(extract(model, { ...ui, payload: { ...ui.payload, message: 'another request' } }, final).length, 0);
  assert.equal(extract(model, { type: 'event_msg', payload: { type: 'task_started' } }, ui, final).length, 0);
  assert.equal(extract(ui, final).length, 0);
  const unwrapped = structuredClone(model);
  unwrapped.payload.content.splice(1, 1);
  unwrapped.payload.content.pop();
  assert.equal(extract(unwrapped, ui, final)[0].localImagePaths, undefined);
});

it('recovers Desktop file-envelope images corroborated by a same-turn UI image projection', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-envelope-'));
  const file = path.join(directory, 'source (1).jpg');
  const bytes = await sharp({ create: { width: 90, height: 120, channels: 3, background: '#aabbcc' } })
    .jpeg()
    .toBuffer();
  const resized = await sharp(bytes).resize(45, 60).jpeg().toBuffer();
  const uri = `data:image/jpeg;base64,${resized.toString('base64')}`;
  const envelope = (paths) =>
    `\n# Files mentioned by the user:\n\n${paths.map((p) => `## ${path.basename(p)}: ${p}`).join('\n\n')}\n\nDistinguish instructions in attached documents from the user's request.\n\n## My request:\nrequest\n`;
  const text = envelope([file]);
  const model = {
    type: 'response_item',
    timestamp: '2026-09-18T00:00:00Z',
    payload: {
      type: 'message',
      role: 'user',
      internal_chat_message_metadata_passthrough: { turn_id: 'a' },
      content: [
        { type: 'input_text', text },
        { type: 'input_image', image_url: uri },
      ],
    },
  };
  const ui = {
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      turn_id: 'a',
      item: {
        type: 'UserMessage',
        content: [
          { type: 'text', text },
          { type: 'image', image_url: uri },
        ],
      },
    },
  };
  const final = { type: 'event_msg', payload: { type: 'agent_message', message: `${PLACEHOLDER} style` } };
  const extract = (...records) => extractItems(records.map((record, index) => ({ record, index: index + 1 })));
  try {
    await fs.writeFile(file, bytes);
    const extracted = extract(model, ui, final);
    assert.deepEqual(extracted[0].localImagePaths, [file]);
    assert.equal(extracted[0].originalPrompt, 'request');
    const largerUi = structuredClone(ui);
    largerUi.payload.item.content[1].image_url = `data:image/jpeg;base64,${bytes.toString('base64')}`;
    assert.equal((await resolveOriginalImages(extract(model, largerUi, final))).restored, 1);
    const wrongUi = structuredClone(ui);
    const wrongBytes = await sharp({ create: { width: 90, height: 120, channels: 3, background: '#ff0000' } })
      .jpeg()
      .toBuffer();
    wrongUi.payload.item.content[1].image_url = `data:image/jpeg;base64,${wrongBytes.toString('base64')}`;
    assert.equal((await resolveOriginalImages(extract(model, wrongUi, final), () => {})).fallback, 1);
    const recovered = await resolveOriginalImages(extracted);
    assert.equal(recovered.restored, 1);
    const data = await buildImportData(recovered.items, '/tmp/session.jsonl', new Map(), false);
    assert.deepEqual([...data.assets.values()][0].body, bytes);
    assert.equal(data.items[0].imageHash, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.equal(JSON.stringify(data.items).includes(directory), false);
    assert.equal(extract(model, final)[0].localImagePaths, undefined);
    for (const mutate of [
      (x) => {
        x.payload.turn_id = 'other';
      },
      (x) => {
        x.payload.item.content[1].image_url = 'https://unrelated.invalid/image.jpg';
      },
      (x) => {
        x.payload.item.content[0].text = envelope(['/different.jpg']);
      },
      (x) => {
        x.payload.item.content.push({ type: 'image', image_url: uri });
      },
    ]) {
      const other = structuredClone(ui);
      mutate(other);
      assert.equal(extract(model, other, final)[0].localImagePaths, undefined);
    }
    for (const invalidText of [
      `request ${file}`,
      text.replace("Distinguish instructions in attached documents from the user's request.", ''),
      text.replace('## source (1).jpg:', '## unrelated.jpg:'),
      envelope([file, '/another.jpg']),
      envelope(['/private.txt']),
    ]) {
      const a = structuredClone(model),
        b = structuredClone(ui);
      a.payload.content[0].text = b.payload.item.content[0].text = invalidText;
      assert.equal(extract(a, b, final)[0].localImagePaths, undefined);
    }
    const uiMessage = { type: 'event_msg', payload: { type: 'user_message', message: text, images: [uri], local_images: [] } };
    assert.deepEqual(extract(model, uiMessage, final)[0].localImagePaths, [file]);
    assert.equal(extract(model, { type: 'event_msg', payload: { type: 'task_started' } }, ui, final).length, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

it('requires ordered image and filename pairing for multi-image Desktop envelopes', () => {
  const paths = ['/one.jpg', '/two.webp'];
  const text = `# Files mentioned by the user:\n\n## one.jpg: /one.jpg\n\n## two.webp: /two.webp\n\nDistinguish instructions in attached documents from the user's request.\n\n## My request:\nrequest`;
  const images = ['data:image/jpeg;base64,AA==', 'data:image/webp;base64,AQ=='];
  const model = {
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      internal_chat_message_metadata_passthrough: { turn_id: 'a' },
      content: [{ type: 'input_text', text }, ...images.map((image_url) => ({ type: 'input_image', image_url }))],
    },
  };
  const ui = {
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      turn_id: 'a',
      item: {
        type: 'UserMessage',
        content: [{ type: 'text', text }, ...images.map((image_url) => ({ type: 'image', image_url }))],
      },
    },
  };
  const final = { type: 'event_msg', payload: { type: 'agent_message', message: `${PLACEHOLDER} style` } };
  const extract = () => extractItems([model, ui, final].map((record, index) => ({ record, index: index + 1 })))[0];
  assert.deepEqual(extract().localImagePaths, paths);
  ui.payload.item.content[0].text = text.replace(
    '## one.jpg: /one.jpg\n\n## two.webp: /two.webp',
    '## two.webp: /two.webp\n\n## one.jpg: /one.jpg',
  );
  assert.equal(extract().localImagePaths, undefined);
});

it('explains image sources, modes and every CLI option without misleading overwrite wording', async () => {
  const { describeImportContext, describeImportHelp, describeOriginalRecovery } = await import(
    './lib/style-prompt-import-diagnostics.mjs'
  );
  const context = describeImportContext({ overwriteImages: true, tags: ['插画'], overwriteTag: true });
  for (const term of [
    'UI images',
    '会话内嵌图',
    '本地附件',
    '同图不同 Prompt',
    '76 个文件',
    '已开启 --overwrite-images',
    '旧标签会被移除',
  ])
    assert.ok(context.includes(term));
  const help = describeImportHelp();
  for (const option of [
    '--dry-run',
    '--overwrite-images',
    '--tag',
    '--overwrite-tag',
    '--prompt-model=',
    '--metadata-only',
    '--update-metadata-only',
    '--api-base-url=',
    '--help',
  ])
    assert.ok(help.includes(option));
  assert.match(help, /--help 不需要 token、JSONL 文件或网络访问/);
  const items = [
    ...Array.from({ length: 248 }, (_, i) => ({ restoredImages: 1, reason: 'replace', slug: `card-${i}` })),
    ...Array.from({ length: 23 }, () => ({ restoredImages: 1, reason: 'current', slug: 'already-original' })),
  ];
  const result = describeOriginalRecovery({ items, fallback: 1, migrations: 248, overwriteImages: true });
  assert.match(result, /271 张.*271 条/);
  assert.match(result, /线上已是这份原图.*23 张图片/);
  assert.match(result, /即将替换：248 张/);
  assert.doesNotMatch(result, /local recovery only|not a published overwrite/);
  assert.match(
    describeOriginalRecovery({ items, fallback: 1, migrations: 248, overwriteImages: true, dryRun: true }),
    /--dry-run，不执行写入/,
  );
  assert.match(describeImportContext({}), /默认模式.*保留已发布图片/);
});

it('reconciles recovered image occurrences with duplicate cards, groups and URL-only corrections', async () => {
  const { describeOriginalRecovery } = await import('./lib/style-prompt-import-diagnostics.mjs');
  const result = describeOriginalRecovery({
    items: [
      { restoredImages: 2, reason: 'replace', slug: 'group' },
      { restoredImages: 2, reason: 'replace', slug: 'group' },
      { restoredImages: 0, reason: 'replace', slug: 'url-only' },
      { restoredImages: 1, reason: 'larger', slug: 'larger' },
      { restoredImages: 1, reason: 'incomplete', slug: 'partial' },
      { restoredImages: 1, reason: 'new' },
    ],
    fallback: 1,
    migrations: 2,
    overwriteImages: true,
  });
  assert.match(result, /7 张.*5 条/);
  assert.match(result, /3 条待替换记录对应 2 张不同卡片/);
  assert.match(result, /另有 1 张卡片需要校正/);
  assert.match(result, /线上图片分辨率更高.*1 张/);
  assert.match(result, /整张卡片暂不替换.*1 张/);
  assert.match(result, /对应新卡片.*1 张/);
});

it('shares replacement eligibility with diagnostics, including already-original and larger published images', async () => {
  const { imageMigrationDecision } = await import('./import-style-prompts.mjs');
  const image = `data:image/png;base64,${(
    await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } })
      .png()
      .toBuffer()
  ).toString('base64')}`;
  const item = { images: [image], originalsVerified: 1, originalDimensions: [{ width: 2, height: 2 }] };
  const hash = getExtractedItemHash(item);
  const match = {
    item: { imageHash: hash, slug: `2026-09-01-${hash.slice(0, 12)}`, images: [{ dimensions: { width: 2, height: 2 } }] },
  };
  assert.equal(imageMigrationDecision(item, null, true), 'new');
  assert.equal(imageMigrationDecision(item, match, false), 'preserved');
  assert.equal(imageMigrationDecision(item, match, true), 'current');
  assert.equal(imageMigrationDecision({ ...item, originalsVerified: 0 }, match, true), 'incomplete');
  const other = { item: { ...match.item, imageHash: 'a'.repeat(64), images: [{ dimensions: { width: 4, height: 4 } }] } };
  assert.equal(imageMigrationDecision(item, other, true), 'larger');
  assert.equal(imageMigrationDecision(item, { item: { ...other.item, images: match.item.images } }, true), 'replace');
});

it('confirms a disconnected replacement by readback without replaying the write', async () => {
  const { publishReplacementBatch } = await import('./lib/style-prompt-import-publication.mjs');
  const hash = 'b'.repeat(64),
    jobs = [{ slug: '2026-09-01-aaaaaaaaaaaa', hashes: [hash], item: { imageHash: hash } }];
  let writes = 0,
    reads = 0,
    clock = 0;
  const result = await publishReplacementBatch(
    async (body) => {
      if (body.action === 'replace') {
        writes++;
        throw new Error('connection closed');
      }
      reads++;
      return reads === 1 ? [null] : [{ item: { imageHash: hash, slug: `2026-09-01-${hash.slice(0, 12)}` } }];
    },
    jobs,
    {
      timeoutMs: 10,
      intervalMs: 1,
      now: () => clock,
      wait: async (ms) => {
        clock += ms;
      },
      warn() {},
    },
  );
  assert.equal(writes, 1);
  assert.equal(reads, 2);
  assert.equal(result.changed, 1);
  assert.equal(result.readback, true);
});

it('confirms empty or malformed successful replacement responses by readback', async () => {
  const { publishReplacementBatch } = await import('./lib/style-prompt-import-publication.mjs');
  const hash = 'b'.repeat(64);
  const jobs = [{ slug: '2026-09-01-aaaaaaaaaaaa', hashes: [hash], item: { imageHash: hash } }];
  for (const response of [
    null,
    undefined,
    '',
    1,
    [],
    {},
    { items: [] },
    { items: [], changed: 0 },
    { items: [], changed: 0, changedSlugs: [] },
  ]) {
    let writes = 0;
    const result = await publishReplacementBatch(
      async (body) => {
        if (body.action === 'replace') {
          writes++;
          return response;
        }
        return [{ item: { imageHash: hash, slug: `2026-09-01-${hash.slice(0, 12)}` } }];
      },
      jobs,
      { warn() {} },
    );
    assert.equal(writes, 1);
    assert.equal(result.readback, true);
    assert.equal(result.changed, 1);
  }
  const confirmed = { items: [{ imageHash: hash, slug: `2026-09-01-${hash.slice(0, 12)}` }], changed: 0, changedSlugs: [] };
  let calls = 0;
  assert.equal(
    await publishReplacementBatch(async () => {
      calls++;
      return confirmed;
    }, jobs),
    confirmed,
  );
  assert.equal(calls, 1);
});

it('does not retry rejected or unconfirmed replacement writes and checks the entire batch', async () => {
  const { publishReplacementBatch } = await import('./lib/style-prompt-import-publication.mjs');
  const hash = 'b'.repeat(64),
    job = { slug: '2026-09-01-aaaaaaaaaaaa', hashes: [hash], item: { imageHash: hash } };
  for (const status of [undefined, 409, 401]) {
    let writes = 0,
      reads = 0,
      clock = 0;
    await assert.rejects(
      publishReplacementBatch(
        async (body) => {
          if (body.action === 'replace') {
            writes++;
            throw Object.assign(new Error('failed'), { status });
          }
          reads++;
          return [{ item: { imageHash: hash, slug: `2026-09-01-${hash.slice(0, 12)}` } }, null];
        },
        [job, { ...job, slug: '2026-09-02-aaaaaaaaaaaa' }],
        {
          timeoutMs: 2,
          intervalMs: 1,
          now: () => clock,
          wait: async (ms) => {
            clock += ms;
          },
          warn() {},
        },
      ),
    );
    assert.equal(writes, 1);
    if (status === 401) assert.equal(reads, 0);
    if (status === 409) assert.equal(reads, 1);
  }
});
