import assert from 'node:assert/strict';
import test from 'node:test';
import { Live2DInteractionGeneration, resolveLive2DInteraction, resolveLive2DPlayback } from './interactions';

const interactions = [
  { area: 'head', motionGroup: 'tap', lines: ['one', 'two'] },
  { area: 'body', lines: ['body'] },
];

test('resolves exact areas, deterministic lines, and unknown-area fallback', () => {
  assert.equal(resolveLive2DInteraction(interactions, ' BODY ', () => 0.5)?.line, 'body');
  assert.equal(resolveLive2DInteraction(interactions, 'missing', () => 0.99)?.line, 'two');
  assert.equal(resolveLive2DInteraction([], 'head'), null);
});

test('keeps each migrated dialogue paired with its own audio', () => {
  const migrated = [
    {
      area: 'head',
      dialogues: [
        { text: 'first', audio: 'audio/first.mp3' },
        { text: 'second', audio: 'audio/second.mp3' },
      ],
    },
  ];
  assert.deepEqual(
    resolveLive2DInteraction(migrated, 'head', () => 0.99),
    {
      mapping: migrated[0],
      line: 'second',
      audio: 'audio/second.mp3',
    },
  );
});

test('combines costume animation mapping with the character-wide dialogue pool', () => {
  const costumeMappings = [{ area: 'head', motionGroup: 'tap-head', lines: ['costume fallback'] }];
  const characterDialogues = [
    {
      area: 'head',
      dialogues: [{ text: 'shared card line', audio: 'audio/gacha-42.mp3' }],
    },
  ];

  assert.deepEqual(
    resolveLive2DInteraction(costumeMappings, 'head', () => 0, characterDialogues),
    {
      mapping: costumeMappings[0],
      line: 'shared card line',
      audio: 'audio/gacha-42.mp3',
    },
  );
});

test('binds a character-wide dialogue and audio to the character voice release for every costume', () => {
  const voiceReleaseId = 'a'.repeat(64);
  const voice = [{ area: 'head', dialogues: [{ text: 'shared line', audio: 'audio/gacha-1819.mp3' }] }];
  const costumes = [
    { area: 'head', motionGroup: 'default-tap', lines: ['default fallback'], audio: 'audio/default.mp3' },
    { area: 'head', motionGroup: 'sr-tap', lines: ['sr fallback'], audio: 'audio/sr.mp3' },
  ];

  for (const costume of costumes) {
    const resolved = resolveLive2DPlayback(
      {
        mappingInteractions: [costume],
        mappingReleaseId: 'b'.repeat(64),
        dialogueSource: { interactions: voice, releaseId: voiceReleaseId },
      },
      'head',
      () => 0,
    );
    assert.equal(resolved?.line, 'shared line');
    assert.deepEqual(resolved?.audio, { path: 'audio/gacha-1819.mp3', releaseId: voiceReleaseId });
    assert.equal(resolved?.mapping.motionGroup, costume.motionGroup);
  }
});

test('does not play costume audio while a declared character voice index is loading', () => {
  const resolved = resolveLive2DPlayback(
    {
      mappingInteractions: [{ area: 'head', lines: ['fallback'], audio: 'audio/costume.mp3' }],
      mappingReleaseId: 'c'.repeat(64),
      suppressMappingAudio: true,
    },
    'head',
    () => 0,
  );
  assert.equal(resolved?.line, 'fallback');
  assert.equal(resolved?.audio, undefined);
});

test('invalidating an interaction generation makes late work stale', () => {
  const generations = new Live2DInteractionGeneration();
  const first = generations.next();
  assert.equal(generations.isCurrent(first), true);
  generations.invalidate();
  assert.equal(generations.isCurrent(first), false);
});

test('ignores whitespace-only dialogue instead of rendering an empty speech bubble', () => {
  const result = resolveLive2DInteraction(
    [
      { area: 'head', lines: ['   '] },
      { area: 'body', dialogues: [{ text: '\n\t' }] },
    ],
    'head',
  );
  assert.equal(result, null);
});
