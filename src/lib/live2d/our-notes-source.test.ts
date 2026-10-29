import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeOurNotesIndexes, ourNotesIdentity } from './our-notes-source';

test('unifies regional copies by model id, preferring story assets without losing model-site names', () => {
  const a = { id: 'adv_live2d_anon_002_casual_spring_01', group: '002_adv', names: { ja: '千早 愛音' } };
  const models = mergeOurNotesIndexes([
    { site: 'https://models.test', models: [a] },
    { site: 'https://story.test', models: [{ id: a.id }, { id: 'adv_live2d_sub_new_01' }] },
  ]);
  assert.equal(models.length, 2);
  assert.equal(models[0].site, 'https://story.test');
  assert.equal(models[0].names?.ja, a.names.ja);
  assert.throws(() => mergeOurNotesIndexes([{ site: 'https://models.test', models: [{ id: '../escape' }] }]));
});

test('joins an existing character using normalized names and keeps new source costume IDs separate', () => {
  const catalog = { version: 1 as const, characters: [{ id: 'chihaya-anon', label: { ja: '千早愛音' }, costumes: [] }] };
  const model = {
    id: 'adv_live2d_anon_002_casual_spring_01',
    group: '002_adv',
    names: { ja: '千早 愛音', 'zh-Hans': '千早爱音' },
    site: 'https://source.test',
  };
  const identity = ourNotesIdentity(model, catalog);
  assert.equal(identity.characterId, 'chihaya-anon');
  assert.equal(identity.costumeId, 'our-notes-adv-live2d-anon-002-casual-spring-01');
  assert.match(identity.costumeLabels.zh, /Our Notes/);
  assert.equal(
    ourNotesIdentity({ ...model, id: 'adv_live2d_sub_mystery_01', group: 'sub_mystery', names: undefined }, catalog)
      .characterId,
    'our-notes-sub-mystery',
  );
});

test('costume differences inherit character names before joining an existing catalog identity', () => {
  const models = mergeOurNotesIndexes([
    {
      site: 'https://source.test',
      models: [
        { id: 'adv_live2d_anon_002_spring', group: '002_adv', names: { ja: '千早 愛音' } },
        { id: 'adv_live2d_anon_002_glasses', group: '002_adv' },
      ],
    },
  ]);
  const catalog = { version: 1 as const, characters: [{ id: 'chihaya-anon', label: { ja: '千早愛音' }, costumes: [] }] };
  assert.ok(models.every((model) => ourNotesIdentity(model, catalog).characterId === 'chihaya-anon'));
});

test('stage aliases still resolve to the same existing character across games', () => {
  const catalog = { version: 1 as const, characters: [{ id: 'bestdori-41', label: { ja: '三角 初華' }, costumes: [] }] };
  const model = {
    id: 'adv_live2d_uika_006_live_01',
    group: '006_adv',
    names: { ja: 'ドロリス / 三角 初華' },
    site: 'https://source.test',
  };
  assert.equal(ourNotesIdentity(model, catalog).characterId, 'bestdori-41');
});

test('regional partial names merge by locale for both a model and its character group', () => {
  const models = mergeOurNotesIndexes([
    { site: 'https://jp.test', models: [{ id: 'adv_live2d_anon_002_spring', group: '002_adv', names: { ja: '千早 愛音' } }] },
    {
      site: 'https://en.test',
      models: [
        { id: 'adv_live2d_anon_002_spring', group: '002_adv', names: { en: 'Anon' } },
        { id: 'adv_live2d_anon_002_glasses', group: '002_live', names: { en: 'Anon Chihaya' } },
      ],
    },
  ]);
  assert.ok(models.every((m) => m.names?.ja === '千早 愛音'));
  assert.equal(models.find((m) => m.id.endsWith('spring'))?.names?.en, 'Anon');
  const catalog = { version: 1 as const, characters: [{ id: 'chihaya-anon', label: { ja: '千早愛音' }, costumes: [] }] };
  assert.ok(models.every((m) => ourNotesIdentity(m, catalog).characterId === 'chihaya-anon'));
});
