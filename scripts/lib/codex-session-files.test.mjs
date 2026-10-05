import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { findSessionFiles } from './codex-session-files.mjs';

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
