import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { it } from 'node:test';
import { archiveImportedSession, openCodexArchiveClient, snapshotSessionFiles } from './codex-session-archive.mjs';
import { findSessionFiles } from './codex-session-files.mjs';

const id = '01a0f275-1553-7fe2-a469-1a9fd0f3da5f';

/** Keep discovery and file-change checks real without touching the user's Codex home. */
async function fixture(run) {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-archive-')));
  const file = path.join(home, 'sessions', `rollout-2026-10-02T18-45-35-${id}.jsonl`);
  await fs.mkdir(path.dirname(file));
  await fs.writeFile(file, `${JSON.stringify({ type: 'session_meta', payload: { id } })}\n`);
  try {
    const selection = await findSessionFiles(file, home);
    await run({ home, file, selection, snapshot: await snapshotSessionFiles(selection), verified: true });
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

/** Deliver input only after the question is written, including EOF and concurrent edits. */
function terminal(answer, beforeAnswer = () => {}) {
  const input = new PassThrough();
  input.isTTY = true;
  const output = new Writable({
    write(chunk, _encoding, done) {
      if (chunk.toString().includes('[y/n]'))
        setImmediate(async () => {
          await beforeAnswer();
          if (answer === null) input.end();
          else input.write(`${answer}\n`);
        });
      done();
    },
  });
  output.isTTY = true;
  return { input, output, log() {} };
}

/** Model the protocol's archive/readback transition; never spawn or mutate real Codex. */
function fakeClient(context, failure) {
  const calls = [];
  let archived = false;
  return {
    calls,
    connect: () => ({
      async initialize() {
        calls.push('initialize');
      },
      async read() {
        calls.push('read');
        return {
          id,
          name: '[prompt] 插画',
          status: { type: 'idle' },
          path: archived ? path.join(context.home, 'archived_sessions', path.basename(context.file)) : context.file,
        };
      },
      async archive() {
        calls.push('archive');
        if (failure) throw new Error('disconnected');
        archived = true;
      },
      close() {
        calls.push('close');
      },
    }),
  };
}

it('never asks or opens Codex for dry runs or incomplete/empty imports even in a terminal', async () => {
  for (const options of [{ verified: false }, { dryRun: true }])
    await fixture(async (context) => {
      assert.equal(
        await archiveImportedSession(
          { ...context, ...options },
          {
            ...terminal('y', () => assert.fail('must not ask for confirmation')),
            connect() {
              assert.fail('must not open Codex before successful publication');
            },
          },
        ),
        false,
      );
    });
});

it('never opens Codex if either input or output is noninteractive after a verified import', async () => {
  for (const [inputTTY, outputTTY] of [
    [false, true],
    [true, false],
    [false, false],
  ]) {
    assert.equal(
      await archiveImportedSession(
        { verified: true },
        {
          input: { isTTY: inputTTY },
          output: { isTTY: outputTTY },
          log() {},
          connect() {
            assert.fail();
          },
        },
      ),
      false,
    );
  }
});

it('requires explicit y after success, archives once, and confirms the archived path', async () =>
  fixture(async (context) => {
    const client = fakeClient(context);
    assert.equal(await archiveImportedSession(context, { ...terminal('y'), connect: client.connect }), true);
    assert.deepEqual(client.calls, ['initialize', 'read', 'archive', 'read', 'close']);
  }));

it('n, empty and invalid confirmation leave the uploaded conversation active', async () => {
  for (const answer of ['n', '', 'yes', 'anything', null])
    await fixture(async (context) => {
      const client = fakeClient(context);
      assert.equal(await archiveImportedSession(context, { ...terminal(answer), connect: client.connect }), false);
      assert.ok(!client.calls.includes('archive'));
    });
});

it('refuses changed session files both before and after the confirmation', async () => {
  for (const duringPrompt of [false, true])
    await fixture(async (context) => {
      const change = () => fs.appendFile(context.file, '\n');
      if (!duringPrompt) await change();
      const client = fakeClient(context);
      await assert.rejects(
        archiveImportedSession(context, {
          ...terminal('y', duringPrompt ? change : undefined),
          connect: client.connect,
        }),
        /新内容|文件变化/,
      );
      assert.ok(!client.calls.includes('archive'));
    });
});

it('never retries an ambiguous archive failure', async () =>
  fixture(async (context) => {
    const client = fakeClient(context, true);
    await assert.rejects(archiveImportedSession(context, { ...terminal('y'), connect: client.connect }), /disconnected/);
    assert.equal(client.calls.filter((call) => call === 'archive').length, 1);
    assert.equal(client.calls.at(-1), 'close');
  }));

it('rejects a running or differently located conversation before asking for confirmation', async () => {
  for (const override of [{ status: { type: 'active' } }, { path: '/missing/not-imported.jsonl' }, { id: 'different' }])
    await fixture(async (context) => {
      const client = fakeClient(context);
      await assert.rejects(
        archiveImportedSession(context, {
          ...terminal('y'),
          connect: () => {
            const connection = client.connect();
            const read = connection.read;
            connection.read = async () => ({ ...(await read()), ...override });
            return connection;
          },
        }),
      );
      assert.ok(!client.calls.includes('archive'));
      assert.equal(client.calls.at(-1), 'close');
    });
});

it('uses bounded JSON-RPC requests and ignores notifications without logging server data', async () => {
  const server = `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
    const m=JSON.parse(line); if(!m.id) return;
    process.stdout.write(JSON.stringify({method:'notification',params:{}})+'\\n');
    if(m.method==='thread/archive') return;
    process.stdout.write(JSON.stringify({id:m.id,result:m.method==='thread/read'?{thread:{id:m.params.threadId}}:{}})+'\\n');
  });`;
  const client = openCodexArchiveClient(os.tmpdir(), { command: process.execPath, args: ['-e', server], timeoutMs: 250 });
  try {
    await client.initialize();
    assert.equal((await client.read(id)).id, id);
    await assert.rejects(client.archive(id), /超时/);
  } finally {
    client.close();
  }
});
