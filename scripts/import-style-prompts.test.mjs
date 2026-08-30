import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { assertStyleGalleryItemConsistency } from '../src/lib/style-gallery-assets.ts';
import {
  buildImportData,
  extractItems,
  loadExistingItemsByHash,
  parseArgs,
  uniqueImagesByHash,
} from './import-style-prompts.mjs';

const PLACEHOLDER = '[在此处替换为您想要生成的主体内容]';

describe('style prompt import variants', () => {
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
      thumbnailImage: `/api/style-gallery/image/thumb/${imageHash.slice(0, 12)}.webp`,
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
          thumbnailImage: `/api/style-gallery/image/thumb/${imageHash.slice(0, 12)}.webp`,
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

  it('hydrates prompt arrays only for existing images referenced by the imported session', async () => {
    const bytes = Buffer.from('existing image');
    const imageHash = crypto.createHash('sha256').update(bytes).digest('hex');
    const requests = [];
    const catalogItems = [
      { slug: 'existing-item', imageHash, promptRevision: 'revision-1' },
      { slug: 'unrelated-item', imageHash: 'f'.repeat(64), promptRevision: 'revision-2' },
    ];
    const extracted = [
      {
        images: [`data:image/png;base64,${bytes.toString('base64')}`],
        prompt: `${PLACEHOLDER}, second extraction`,
      },
    ];

    const existingByHash = await loadExistingItemsByHash('https://example.test', catalogItems, extracted, async (url) => {
      requests.push(url);
      return {
        prompts: [{ prompt: `${PLACEHOLDER}, first extraction` }],
        item: {
          slug: 'existing-item',
          title: 'Existing item',
          date: '2026-08-10T00:00:00.000Z',
          sourceImage: `/api/style-gallery/image/source/${imageHash.slice(0, 12)}.png`,
          thumbnailImage: `/api/style-gallery/image/thumb/${imageHash.slice(0, 12)}.webp`,
          sourceImageAlt: 'Existing reference image',
          imageHash,
          images: [
            {
              sourceImage: `/api/style-gallery/image/source/${imageHash.slice(0, 12)}.png`,
              thumbnailImage: `/api/style-gallery/image/thumb/${imageHash.slice(0, 12)}.webp`,
              sourceImageAlt: 'Existing reference image',
              imageHash,
            },
          ],
        },
      };
    });

    assert.deepEqual(requests, ['https://example.test/api/style-gallery/prompts/existing-item?v=revision-1']);
    assert.deepEqual(existingByHash.get(imageHash)?.prompts, [`${PLACEHOLDER}, first extraction`]);
    assert.equal(existingByHash.has('f'.repeat(64)), false);

    const prepared = await buildImportData(extracted, '/tmp/session.jsonl', existingByHash, false, null);
    assert.equal(prepared.items.length, 1);
    assert.equal(prepared.assets.size, 0);
    assert.equal(prepared.items[0].sourceImageAlt, 'Existing reference image');
    assert.doesNotThrow(() => assertStyleGalleryItemConsistency(prepared.items[0]));
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
  });

  it('deduplicates repeated image references before creating visual index records', () => {
    const first = { imageHash: 'a'.repeat(64), sourceImage: 'first' };
    const duplicate = { imageHash: first.imageHash, sourceImage: 'duplicate' };
    const second = { imageHash: 'b'.repeat(64), sourceImage: 'second' };
    assert.deepEqual(uniqueImagesByHash([first, duplicate, second]), [first, second]);
  });
});
