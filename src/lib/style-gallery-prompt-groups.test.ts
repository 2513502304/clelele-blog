import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getStyleGalleryPromptCacheKey,
  groupStyleGalleryPromptsByModel,
  toggleStyleGalleryPromptModel,
} from './style-gallery-prompt-groups';

describe('style gallery prompt groups', () => {
  it('versions prompt cache entries when the catalog prompt count changes', () => {
    assert.notEqual(
      getStyleGalleryPromptCacheKey('2026-08-08-161b8ebf9dc1', 1),
      getStyleGalleryPromptCacheKey('2026-08-08-161b8ebf9dc1', 2),
    );
  });

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

  it('treats a whitespace-only model as unknown', () => {
    const groups = groupStyleGalleryPromptsByModel([{ id: 'blank-1', model: '   ' }, { id: 'unknown-1' }]);

    assert.deepEqual(
      groups.map((group) => ({
        model: group.model,
        prompts: group.prompts.map(({ prompt, modelIndex }) => ({ id: prompt.id, modelIndex })),
      })),
      [
        {
          model: undefined,
          prompts: [
            { id: 'blank-1', modelIndex: 1 },
            { id: 'unknown-1', modelIndex: 2 },
          ],
        },
      ],
    );
  });

  it('opens only the first prompt when a model group is expanded', () => {
    const initial = {
      expandedModels: new Set(['gpt-5.6-terra']),
      expandedPromptIds: new Set(['terra-1', 'terra-2']),
    };

    const collapsed = toggleStyleGalleryPromptModel(initial, 'gpt-5.6-terra', ['terra-1', 'terra-2']);
    assert.deepEqual([...collapsed.expandedModels], []);
    assert.deepEqual([...collapsed.expandedPromptIds], []);

    const reopened = toggleStyleGalleryPromptModel(collapsed, 'gpt-5.6-terra', ['terra-1', 'terra-2']);
    assert.deepEqual([...reopened.expandedModels], ['gpt-5.6-terra']);
    assert.deepEqual([...reopened.expandedPromptIds], ['terra-1']);
  });

  it('keeps other model disclosures unchanged', () => {
    const next = toggleStyleGalleryPromptModel(
      {
        expandedModels: new Set(['gpt-5.6-terra']),
        expandedPromptIds: new Set(['terra-1', 'sol-2']),
      },
      'gpt-5.6-sol',
      ['sol-1', 'sol-2'],
    );

    assert.deepEqual([...next.expandedModels], ['gpt-5.6-terra', 'gpt-5.6-sol']);
    assert.deepEqual([...next.expandedPromptIds], ['terra-1', 'sol-1']);
  });
});
