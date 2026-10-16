import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { zstdCompressSync } from 'node:zlib';
import { createSessionReadStream, findSessionFiles, resolveSessionPath, sessionHeader } from './codex-session-files.mjs';

it('any continuation finds the same chronological active + archived session, excluding forks and titles', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-search-'));
  const id = '01a0df23-90af-7e71-8b57-77f4b4be0faa';
  const other = '01a0ed6e-e4d9-7671-bf5d-f71f207d7ac6';
  async function write(tree, day, suffix, headerId = id) {
    const dir = path.join(home, tree, '2026', '09', day);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `rollout-2026-09-${day}T03-14-05-${suffix}.jsonl`);
    await fs.writeFile(
      file,
      `${JSON.stringify({
        type: 'session_meta',
        payload: { id: headerId, timestamp: `2026-09-${day}`, title: 'same title', forked_from_id: id },
      })}\n`,
    );
    return fs.realpath(file);
  }
  try {
    const a = await write('archived_sessions', '27', id);
    const b = await write('sessions', '29', `${id}_${other}`);
    const c = await write('sessions', '30', `${id}_${other}_${other}`);
    await write('sessions', '28', other, other);
    await write('sessions', '28', `${other}_${id}`, other);
    for (const entry of [a, b, c]) assert.deepEqual((await findSessionFiles(entry, home)).files, [a, b, c]);
    // Filename association is never sufficient to write data from a different session.
    await write('sessions', '26', `${id}_${other}`, other);
    await assert.rejects(findSessionFiles(b, home), /disagree/);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

it('discovers compressed active and archived segments from a stale uncompressed path', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-zstd-'));
  const id = '01a0df23-90af-7e71-8b57-77f4b4be0faa';
  const continuation = '01a0ed6e-e4d9-7671-bf5d-f71f207d7ac6';
  const a = path.join(home, 'archived_sessions', `rollout-2026-09-27T03-14-05-${id}.jsonl`);
  const b = path.join(home, 'sessions', `rollout-2026-09-29T03-14-05-${id}_${continuation}.jsonl`);
  const encode = (timestamp) => `${JSON.stringify({ type: 'session_meta', payload: { id, timestamp } })}\n`;
  try {
    await fs.mkdir(path.dirname(a), { recursive: true });
    await fs.mkdir(path.dirname(b), { recursive: true });
    await fs.writeFile(`${a}.zst`, zstdCompressSync(encode('2026-09-27')));
    await fs.writeFile(`${b}.zst`, zstdCompressSync(encode('2026-09-29')));
    const expected = await Promise.all([`${a}.zst`, `${b}.zst`].map((file) => fs.realpath(file)));
    for (const file of [a, `${a}.zst`, b, `${b}.zst`]) {
      assert.deepEqual((await findSessionFiles(file)).files, expected);
    }
    assert.equal((await sessionHeader(`${b}.zst`)).segmentId, continuation);
    assert.equal(await resolveSessionPath(a), expected[0]);
    await fs.writeFile(b, encode('2026-09-29'));
    await assert.rejects(findSessionFiles(a), /multiple copies/);
    await fs.rm(b);
    await fs.writeFile(`${b}.zst`, zstdCompressSync(encode('2026-09-29').replace(id, continuation)));
    await assert.rejects(findSessionFiles(a), /disagree/);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

it('propagates missing, corrupt and truncated compressed stream failures', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-zstd-errors-'));
  const file = path.join(home, 'broken.jsonl.zst');
  const read = async () => {
    for await (const _chunk of createSessionReadStream(file)) {
      /* fully validate the frame */
    }
  };
  try {
    await assert.rejects(read(), /ENOENT/);
    await fs.writeFile(file, 'not zstd');
    await assert.rejects(read());
    const compressed = zstdCompressSync('valid payload\n'.repeat(100));
    await fs.writeFile(file, compressed.subarray(0, compressed.length - 1));
    await assert.rejects(read());
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
