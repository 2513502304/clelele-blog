import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { buildImportData, extractItems } from './import-style-prompts.mjs';

const PLACEHOLDER = '[在此处替换为您想要生成的主体内容]';

describe('style prompt import variants', () => {
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
      prompt: `${PLACEHOLDER}, first prompt`,
      promptCount: 1,
      imageHash,
      imageCount: 1,
      exampleCount: 0,
    };
    const extracted = [
      {
        images: [`data:image/png;base64,${bytes.toString('base64')}`],
        originalPrompt: 'Extract this style again.',
        sourceLine: 8,
        timestamp: '2026-08-11T00:00:00.000Z',
        model: 'gpt-5.6-terra',
        prompt: `${PLACEHOLDER}, second prompt`,
      },
    ];

    const prepared = await buildImportData(extracted, '/tmp/session.jsonl', new Map([[imageHash, existing]]), false, null);
    assert.equal(prepared.assets.size, 0);
    assert.equal(prepared.items.length, 1);
    assert.equal(prepared.items[0].slug, existing.slug);
    assert.equal(prepared.items[0].prompts[0].model, 'gpt-5.6-terra');

    const duplicate = await buildImportData(
      [{ ...extracted[0], prompt: existing.prompt }],
      '/tmp/session.jsonl',
      new Map([[imageHash, existing]]),
      false,
      null,
    );
    assert.equal(duplicate.items.length, 0);
    assert.equal(duplicate.skippedDuplicates, 1);
  });
});
