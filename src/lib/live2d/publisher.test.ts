import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertImmutableProvenanceMatches,
  parseArguments,
  removeCatalogCharacters,
  upsertCatalog,
  upsertCatalogBatch,
} from '../../../scripts/live2d/publish-models';
import type { Live2DCatalog, Live2DCostume, Live2DProvenance, Live2DVoicePack } from './types';

const releaseId = 'a'.repeat(64);
const replacementReleaseId = 'b'.repeat(64);

function createCostume(id = 'default', idRelease = releaseId): Live2DCostume {
  return {
    id,
    label: { zh: '默认' },
    releaseId: idRelease,
    entryPath: `releases/${idRelease}/model.json`,
    packageBytes: 12,
    scale: 1,
    position: [0, 0],
    interactions: [],
    provenancePath: `src/data/live2d/provenance/${idRelease}.json`,
  };
}

function createCatalog(): Live2DCatalog {
  return {
    version: 1,
    characters: [{ id: 'anon', label: { zh: '爱音' }, costumes: [createCostume()] }],
  };
}

function createProvenance(): Live2DProvenance {
  return {
    version: 1,
    releaseId,
    source: {
      url: 'https://example.com/source',
      revision: 'revision-1',
      acquiredAt: '2026-07-27T00:00:00.000Z',
    },
    converter: {
      repository: 'https://example.com/converter',
      commit: 'commit-1',
      options: { coreAudioRemoved: true, approvedAudio: [] },
    },
    manifestSha256: 'c'.repeat(64),
    licenseReferences: ['https://example.com/license'],
    publisher: 'clelele',
    publishedAt: '2026-07-27T01:00:00.000Z',
  };
}

function publisherArguments(): string[] {
  return [
    '--package',
    '/tmp/live2d-package',
    '--character-id',
    'anon',
    '--character-labels',
    'zh=爱音',
    '--costume-id',
    'default',
    '--costume-labels',
    'zh=默认',
    '--source-url',
    'https://example.com/source',
    '--source-revision',
    'revision-1',
    '--acquired-at',
    '2026-07-27T00:00:00.000Z',
    '--converter-repository',
    'https://example.com/converter',
    '--converter-commit',
    'commit-1',
    '--license',
    'https://example.com/license',
    '--publisher',
    'clelele',
  ];
}

test('publisher is idempotent but requires explicit --replace for changed existing costume', () => {
  assert.equal(parseArguments(publisherArguments()).replace, false);
  assert.equal(parseArguments([...publisherArguments(), '--replace']).replace, true);

  const catalog = createCatalog();
  assert.deepEqual(
    upsertCatalog(catalog, { characterId: 'anon', characterLabels: { zh: '爱音' }, replace: false }, createCostume()),
    catalog,
  );
  assert.throws(
    () =>
      upsertCatalog(
        catalog,
        { characterId: 'anon', characterLabels: { zh: '爱音' }, replace: false },
        { ...createCostume(), scale: 0.9 },
      ),
    /already exists; pass --replace/,
  );
  assert.deepEqual(catalog, createCatalog(), 'create-only validation must not mutate the source catalog');
});

test('--replace updates only the matching costume and preserves its hand-tuned interactions', () => {
  const catalog = createCatalog();
  const curatedInteractions = [{ area: 'head', motionGroup: 'custom-smile', lines: ['欢迎回来。'] }];
  catalog.characters[0].costumes[0].interactions = curatedInteractions;
  const second = createCostume('summer', 'd'.repeat(64));
  catalog.characters[0].costumes.push(second);
  const replacement = {
    ...createCostume('default', replacementReleaseId),
    scale: 0.9,
    interactions: [{ area: 'head', motionGroup: 'smile01', lines: ['你好，很高兴见到你。'] }],
  };
  const next = upsertCatalog(
    catalog,
    { characterId: 'anon', characterLabels: { zh: '不会覆盖现有角色名' }, replace: true },
    replacement,
  );

  assert.deepEqual(next.characters[0].costumes, [{ ...replacement, interactions: curatedInteractions }, second]);
  assert.deepEqual(next.characters[0].label, { zh: '爱音' });
  assert.equal(catalog.characters[0].costumes[0].releaseId, releaseId);
});

test('--replace-interactions lets a verified migration update paired dialogue audio', () => {
  const catalog = createCatalog();
  const replacement = {
    ...createCostume('default', replacementReleaseId),
    interactions: [{ area: 'head', dialogues: [{ text: '台词', audio: 'audio/card.mp3' }] }],
  };
  const next = upsertCatalog(
    catalog,
    {
      characterId: 'anon',
      characterLabels: { zh: '爱音' },
      replace: true,
      replaceInteractions: true,
    },
    replacement,
  );

  assert.deepEqual(next.characters[0].costumes[0].interactions, replacement.interactions);
});

test('new costumes retain their default interactions', () => {
  const costume = {
    ...createCostume('summer', replacementReleaseId),
    interactions: [{ area: 'head', motionGroup: 'smile01', lines: ['你好，很高兴见到你。'] }],
  };
  const next = upsertCatalog(
    createCatalog(),
    { characterId: 'anon', characterLabels: { zh: '爱音' }, replace: false },
    costume,
  );

  assert.deepEqual(next.characters[0].costumes[1], costume);
});

test('batch upsert merges multiple characters and costumes without mutating inputs', () => {
  const catalog = createCatalog();
  const summer = createCostume('summer', replacementReleaseId);
  const tomori = createCostume('default', 'c'.repeat(64));
  const next = upsertCatalogBatch(catalog, [
    {
      options: { characterId: 'anon', characterLabels: { zh: '爱音' }, replace: false },
      costume: summer,
    },
    {
      options: { characterId: 'tomori', characterLabels: { zh: '灯' }, replace: false },
      costume: tomori,
    },
  ]);

  assert.deepEqual(
    next.characters.map((character) => [character.id, character.costumes.map((costume) => costume.id)]),
    [
      ['anon', ['default', 'summer']],
      ['tomori', ['default']],
    ],
  );
  assert.deepEqual(catalog, createCatalog());
  assert.deepEqual(summer.interactions, []);
  assert.deepEqual(tomori.interactions, []);
});

test('character voice pointers attach after costume updates without duplicating dialogues in the catalog', () => {
  const voice: Live2DVoicePack = {
    releaseId: 'e'.repeat(64),
    entryPath: `releases/${'e'.repeat(64)}/dialogues.json`,
    packageBytes: 100,
    dialogueCount: 20,
    provenancePath: `provenance/${'e'.repeat(64)}.json`,
  };
  const next = upsertCatalogBatch(createCatalog(), [], [{ characterId: 'anon', characterLabels: { zh: '爱音' }, voice }]);

  assert.deepEqual(next.characters[0].voice, voice);
  assert.equal('interactions' in (next.characters[0].voice ?? {}), false);
  assert.throws(
    () => upsertCatalogBatch(createCatalog(), [], [{ characterId: 'missing', characterLabels: { zh: '缺失角色' }, voice }]),
    /before character missing has a published costume/,
  );
});

test('catalog alias cleanup removes only the superseded character without mutating the source', () => {
  const catalog = createCatalog();
  catalog.characters.push({ id: 'bestdori-37', label: { zh: '爱音旧别名' }, costumes: [createCostume()] });

  const next = removeCatalogCharacters(catalog, new Set(['bestdori-37']));

  assert.deepEqual(
    next.characters.map((character) => character.id),
    ['anon'],
  );
  assert.deepEqual(
    catalog.characters.map((character) => character.id),
    ['anon', 'bestdori-37'],
  );
});

test('existing provenance may differ only in publishedAt', () => {
  const existing = createProvenance();
  assert.doesNotThrow(() =>
    assertImmutableProvenanceMatches(existing, { ...existing, publishedAt: '2026-07-27T02:00:00.000Z' }),
  );

  const conflicts: Live2DProvenance[] = [
    { ...existing, manifestSha256: 'd'.repeat(64) },
    { ...existing, publisher: 'another-publisher' },
    { ...existing, source: { ...existing.source, revision: 'revision-2' } },
    { ...existing, converter: { ...existing.converter, options: { coreAudioRemoved: false } } },
    { ...existing, licenseReferences: ['https://example.com/other-license'] },
  ];
  for (const conflict of conflicts) {
    assert.throws(() => assertImmutableProvenanceMatches(existing, conflict), /conflicts with immutable publication fields/);
  }
});
