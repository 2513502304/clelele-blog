import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  cardDialogueText,
  cardHasVoiceText,
  characterCardIds,
  checkpointState,
  voiceCheckpointState,
} from '../../../scripts/live2d/sync-bestdori-models';
import type { Live2DCostume, Live2DVoicePack } from './types';

const releaseId = 'a'.repeat(64);

function costume(): Live2DCostume {
  return {
    id: 'default',
    label: { zh: '默认' },
    releaseId,
    entryPath: `releases/${releaseId}/model.json`,
    packageBytes: 12,
    scale: 1,
    position: [0, 0],
    interactions: [],
    provenancePath: `provenance/${releaseId}.json`,
  };
}

test('checkpoint recovery distinguishes uploaded assets from cataloged models', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'live2d-checkpoint-'));
  const file = path.join(root, 'manifest.jsonl');
  const base = { server: 'jp', releaseId, publishedAt: '2026-07-27T00:00:00.000Z' };
  const uploaded = {
    ...base,
    model: '002_live_default',
    status: 'uploaded',
    characterId: 'bestdori-2',
    characterLabels: { zh: '角色二' },
    costume: costume(),
  };
  await writeFile(
    file,
    [
      JSON.stringify({ ...base, model: '001_live_default', status: 'published' }),
      JSON.stringify(uploaded),
      JSON.stringify({ ...uploaded, status: 'cataloged' }),
      JSON.stringify({ ...uploaded, model: '003_live_default', status: 'uploaded' }),
    ].join('\n'),
  );

  try {
    const state = await checkpointState(file);
    assert.deepEqual([...state.completed].sort(), ['001_live_default', '002_live_default']);
    assert.deepEqual([...state.pendingCatalog], [['003_live_default', { ...uploaded, model: '003_live_default' }]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('character card aggregation includes every rarity and prefers Japanese dialogue text', () => {
  const cards = {
    '200': { characterId: 37, resourceSetName: 'ssr', prefix: ['SSR', 'SSR en'] },
    '100': { characterId: 37, resourceSetName: 'r', prefix: ['R', 'R en'] },
    '300': { characterId: 36, resourceSetName: 'other', prefix: ['Other', 'Other en'] },
  };
  assert.deepEqual(characterCardIds(cards, '37'), ['100', '200']);
  assert.equal(cardDialogueText({ gachaText: ['日本語', 'English'] }, cards['100']), '日本語');
  assert.equal(cardDialogueText({ gachaText: [null, 'English'] }, cards['100']), 'English');
  assert.equal(cardDialogueText({}, cards['100']), 'R');
  assert.equal(cardHasVoiceText({ gachaText: ['日本語', null] }), true);
  assert.equal(cardHasVoiceText({ gachaText: [null, null], prefix: ['文字のみ'] }), false);
});

test('voice checkpoint recovery keeps uploaded character packs pending until cataloged', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'live2d-voice-checkpoint-'));
  const file = path.join(root, 'voice-manifest.jsonl');
  const voice: Live2DVoicePack = {
    releaseId,
    entryPath: `releases/${releaseId}/dialogues.json`,
    packageBytes: 42,
    dialogueCount: 3,
    provenancePath: `provenance/${releaseId}.json`,
  };
  const uploaded = {
    characterId: 'chihaya-anon',
    characterLabels: { zh: '千早爱音' },
    status: 'uploaded',
    voice,
    publishedAt: '2026-07-27T00:00:00.000Z',
  };
  await writeFile(
    file,
    [
      JSON.stringify(uploaded),
      JSON.stringify({ ...uploaded, status: 'cataloged' }),
      JSON.stringify({ ...uploaded, characterId: 'takamatsu-tomori' }),
    ].join('\n'),
  );

  try {
    const state = await voiceCheckpointState(file);
    assert.deepEqual([...state.completed], ['chihaya-anon']);
    assert.deepEqual([...state.pendingCatalog.keys()], ['takamatsu-tomori']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
