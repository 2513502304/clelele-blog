import assert from 'node:assert/strict';
import test from 'node:test';
import { availableOutputs, defaultSettings, type GenerationJob } from './style-gallery-generation-settings';
import { projectPublishedHistory } from './style-gallery-published-history';

test('deletion removes only the published slot and never mutates receipts or reopens a discarded output', () => {
  const legacy: GenerationJob = {
    id: 'legacy',
    prompt: 'test',
    created: '',
    state: 'saved',
    settings: defaultSettings('pixai'),
  };
  const batch: GenerationJob = {
    ...legacy,
    id: 'batch',
    available: [0, 1, 2, 3],
    published: [0, 1],
    discarded: [3],
    settings: { ...legacy.settings, count: 4 },
  };
  const pending: GenerationJob = { ...legacy, id: 'pending', state: 'ready' };
  const projected = projectPublishedHistory([legacy, batch, pending], new Set(['batch-2']));
  assert.deepEqual(
    projected.map((job) => job.id),
    ['batch', 'pending'],
  );
  assert.deepEqual(projected[0].published, [1]);
  assert.deepEqual(availableOutputs(projected[0]), [1, 2]);
  assert.deepEqual(batch.discarded, [3]);
});
