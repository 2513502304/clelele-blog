import assert from 'node:assert/strict';
import test from 'node:test';
import { groupStyleGalleryExamplesByPlatform } from './style-gallery-platforms';

test('groups examples by configured platform while preserving upload order inside each group', () => {
  const examples = [
    { id: 'pixai-first', model: 'PixAI' },
    { id: 'gpt-first', model: 'GPT-Image2' },
    { id: 'pixai-second', model: 'PixAI' },
    { id: 'other', model: 'Custom' },
  ];

  const groups = groupStyleGalleryExamplesByPlatform(examples);

  assert.deepEqual(
    groups.map(([platform, items]) => [platform, items.map((item) => item.id)]),
    [
      ['GPT-Image2', ['gpt-first']],
      ['PixAI', ['pixai-first', 'pixai-second']],
      ['Custom', ['other']],
    ],
  );
});
