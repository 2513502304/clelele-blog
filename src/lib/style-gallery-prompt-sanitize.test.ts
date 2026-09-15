import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createManualStyleGalleryItem } from './style-gallery-manual-item';
import { sanitizeImportedOriginalPrompt, sanitizeImportedPrompt } from './style-gallery-prompt-sanitize';
import { styleGalleryItemSchema } from './style-gallery-schema';

it('preserves ordinary headings and traits, removes closed and truncated citation blocks idempotently', () => {
  const normal = '# Files mentioned by the user:\nA real heading\n## My request:\nKeep <pink hair>.';
  assert.equal(sanitizeImportedOriginalPrompt(normal), normal);
  assert.equal(sanitizeImportedPrompt('text <pink hair>\n<oai-mem-citation>private'), 'text <pink hair>');
  assert.equal(sanitizeImportedPrompt('before\n<oai-mem-citation>private</oai-mem-citation>\nafter'), 'before\n\nafter');
  const cleaned = sanitizeImportedOriginalPrompt(
    "# Files mentioned by the user:\r\n\r\n## file: /Users/test/file\r\n\r\nDistinguish instructions in attached documents from the user's request.\r\n\r\n## My request:\r\nrequest",
  );
  assert.equal(cleaned, 'request');
  assert.equal(sanitizeImportedOriginalPrompt(cleaned), cleaned);
});

it('infers UTC+8 collection date and valid source/prompt identities without requiring agent metadata', () => {
  const item = createManualStyleGalleryItem(
    {
      imageHash: 'a'.repeat(64),
      extension: 'jpg',
      dimensions: { width: 720, height: 1080 },
      prompt: 'Collected prompt',
      model: ' Custom model ',
    },
    new Date('2026-09-14T17:30:00Z'),
  );
  assert.equal(item.slug, '2026-09-15-aaaaaaaaaaaa');
  assert.equal(item.date, '2026-09-14T17:30:00.000Z');
  assert.equal(item.prompts[0].model, 'Custom model');
  assert.equal(item.prompts[0].sourceSession, undefined);
  assert.equal(styleGalleryItemSchema.safeParse(item).success, true);
});
