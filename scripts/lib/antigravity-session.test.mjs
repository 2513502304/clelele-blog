import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { readAntigravityItems, resolveAntigravityTranscript } from './antigravity-session.mjs';

const title = '[prompt] 插画';
const subject = '[在此处替换为您想要生成的主体内容]';
const jpeg = Buffer.from([255, 216, 255, 0, 1]);
const pcm = { source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', model: 'gemini-4-hydrogen-high' };
const reply = { ...pcm, content: subject, thinking: 'private reasoning' };

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ag-import-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'brain', 'aa-11');
  const logs = path.join(dir, '.system_generated/logs');
  const uploads = path.join(dir, '.user_uploaded');
  const annotations = path.join(root, 'annotations');
  await Promise.all([logs, uploads, annotations].map((p) => fs.mkdir(p, { recursive: true })));
  await fs.writeFile(path.join(annotations, 'aa-11.pbtxt'), `title: ${JSON.stringify(title)}`);
  const transcript = path.join(logs, 'transcript.jsonl');
  await fs.writeFile(transcript, '');
  const file = path.join(uploads, 'one.jpg');
  await fs.writeFile(file, jpeg);
  const media = { uri: pathToFileURL(file).href, mime_type: 'image/jpeg' };
  const input = {
    source: 'USER_EXPLICIT',
    type: 'USER_INPUT',
    status: 'DONE',
    created_at: '2026-11-20T10:00:00Z',
    media: [media],
    content: '<USER_REQUEST>画风</USER_REQUEST><ADDITIONAL_METADATA>private context</ADDITIONAL_METADATA>',
  };
  const write = (records) =>
    fs.writeFile(transcript, records.map((record) => (record ? JSON.stringify(record) : '')).join('\n'));
  return { root, dir, uploads, annotations, transcript, input, media, write };
}

test('selects one exact title or a specific conversation directory', async (t) => {
  const f = await fixture(t);
  assert.equal(await resolveAntigravityTranscript(title, f.root), f.transcript);
  await assert.rejects(resolveAntigravityTranscript('插画', f.root), /found 0/);
  await fs.writeFile(path.join(f.annotations, 'bb-22.pbtxt'), `title: ${JSON.stringify(title)}`);
  await assert.rejects(resolveAntigravityTranscript(title, f.root), /found 2/);
  assert.equal(await resolveAntigravityTranscript(f.dir, f.root), f.transcript);
});

test('pairs ordered original uploads with the visible template and excludes private context and tool steps', async (t) => {
  const f = await fixture(t);
  const second = path.join(f.uploads, 'two.jpg');
  const secondBytes = Buffer.concat([jpeg, Buffer.from([2])]);
  await fs.writeFile(second, secondBytes);
  await f.write([
    f.input,
    { ...f.input, media: [] },
    reply,
    null,
    { ...f.input, media: [{ ...f.media, uri: second }, f.media] },
    { ...reply, tool_calls: [{ name: 'read' }] },
    { ...reply, status: 'IN_PROGRESS' },
    reply,
  ]);
  const items = await readAntigravityItems(f.transcript);
  assert.equal(items.length, 1);
  assert.deepEqual(
    items[0].images,
    [secondBytes, jpeg].map((b) => `data:image/jpeg;base64,${b.toString('base64')}`),
  );
  assert.equal(items[0].prompt, subject);
  assert.equal(items[0].originalPrompt, '画风');
  assert.equal(items[0].model, pcm.model);
  assert.equal(items[0].sourceLine, 5);
  assert.equal(items[0].promptLine, 8);
  assert.equal(items[0].sourceSession, 'antigravity-aa-11');
  assert.doesNotMatch(JSON.stringify(items), /private/);
});

test('rejects unresolved turns, other sessions, escaping symlinks and media type mismatches', async (t) => {
  const f = await fixture(t);
  await f.write([f.input, { ...reply, content: '' }]);
  await assert.rejects(readAntigravityItems(f.transcript), /No completed/);
  const outside = path.join(f.dir, 'outside.jpg');
  await fs.writeFile(outside, jpeg);
  const link = path.join(f.uploads, 'link.jpg');
  await fs.symlink(outside, link);
  for (const uri of [outside, link]) {
    await f.write([{ ...f.input, media: [{ ...f.media, uri }] }, reply]);
    await assert.rejects(readAntigravityItems(f.transcript), /does not belong/);
  }
  await f.write([{ ...f.input, media: [{ ...f.media, mime_type: 'image/png' }] }, reply]);
  await assert.rejects(readAntigravityItems(f.transcript), /mismatched/);
});
