import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { groupStyleGalleryPromptsByModel } from './style-gallery-prompt-groups';

describe('style gallery prompt groups', () => {
  it('keeps model order and numbers prompts inside each model independently', () => {
    const groups = groupStyleGalleryPromptsByModel([
      { id: 'terra-1', model: 'gpt-5.6-terra' },
      { id: 'sol-1', model: 'gpt-5.6-sol' },
      { id: 'terra-2', model: 'gpt-5.6-terra' },
      { id: 'unknown-1' },
    ]);

    assert.deepEqual(
      groups.map((group) => ({
        model: group.model,
        prompts: group.prompts.map(({ prompt, modelIndex }) => ({ id: prompt.id, modelIndex })),
      })),
      [
        {
          model: 'gpt-5.6-terra',
          prompts: [
            { id: 'terra-1', modelIndex: 1 },
            { id: 'terra-2', modelIndex: 2 },
          ],
        },
        { model: 'gpt-5.6-sol', prompts: [{ id: 'sol-1', modelIndex: 1 }] },
        { model: undefined, prompts: [{ id: 'unknown-1', modelIndex: 1 }] },
      ],
    );
  });
});
