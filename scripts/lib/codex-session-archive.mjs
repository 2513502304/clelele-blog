import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createInterface as createPrompt } from 'node:readline/promises';
import { findSessionFiles, inferCodexHome } from './codex-session-files.mjs';

/** Fingerprint every segment before upload; do not archive a conversation edited meanwhile. */
export async function snapshotSessionFiles(selection) {
  return Promise.all(
    selection.files.map(async (file) => {
      const stat = await fs.stat(file, { bigint: true });
      return [file, stat.size.toString(), stat.mtimeNs.toString()];
    }),
  );
}

/** Use the installed Codex protocol, never move rollouts or edit its state database ourselves.
 * Requests are bounded and never retried: a lost archive response has an unknown outcome.
 */
export function openCodexArchiveClient(
  codexHome,
  { command = 'codex', args = ['app-server', '--stdio'], timeoutMs = 30_000 } = {},
) {
  const child = spawn(command, args, {
    env: { ...process.env, CODEX_HOME: codexHome },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 0,
    failure;
  const fail = (error) => {
    failure = error;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };
  child.on('error', (error) =>
    fail(
      new Error(
        error.code === 'ENOENT'
          ? '找不到 Codex CLI；请确认 codex 已安装并在 PATH 中。'
          : `无法启动 Codex CLI (${error.code ?? 'unknown'})。`,
      ),
    ),
  );
  child.on('exit', () => fail(new Error('Codex app-server 已退出，无法确认归档结果。')));
  child.stdin.on('error', () => fail(new Error('Codex app-server 连接已断开，无法确认归档结果。')));
  lines.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(`Codex ${entry.method} 失败 (${message.error.code ?? 'unknown'})。`));
    else entry.resolve(message.result);
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex ${method} 超时；不会自动重试归档，请在 Codex 中核对状态。`));
      }, timeoutMs);
      pending.set(id, { method, resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  return {
    async initialize() {
      await request('initialize', {
        clientInfo: { name: 'gallery_import', title: 'Gallery Import', version: '1.0.0' },
        capabilities: null,
      });
      child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
    },
    read: (threadId) => request('thread/read', { threadId, includeTurns: false }).then((result) => result?.thread),
    archive: (threadId) => request('thread/archive', { threadId }),
    close() {
      lines.close();
      child.stdin.end();
      child.kill();
    },
  };
}

/** Called only after publication readback and tag writes succeed. A terminal confirmation is
 * mandatory; dry runs, empty/partial imports, changed sessions and piped stdin never archive.
 */
export async function archiveImportedSession(
  { selection, snapshot, verified, dryRun = false },
  { input = process.stdin, output = process.stdout, log = console.log, connect = openCodexArchiveClient } = {},
) {
  if (dryRun || !verified) {
    log('[归档] 未执行：仅完整导入并回读成功后才可归档；试跑、空记录或部分导入不会归档。');
    return false;
  }
  if (!input.isTTY || !output.isTTY) {
    log('[归档] 上传已成功；当前不是交互式终端，无法进行 y/n 二次确认，保留活动会话。');
    return false;
  }
  const home = inferCodexHome(selection.files[0]);
  const assertUnchanged = async () => {
    const fresh = await findSessionFiles(selection.files[0], home);
    if (fresh.id !== selection.id || JSON.stringify(await snapshotSessionFiles(fresh)) !== JSON.stringify(snapshot))
      throw new Error('上传期间会话有新内容或文件变化，未归档；请重新导入。');
  };
  await assertUnchanged();
  const client = connect(home);
  try {
    await client.initialize();
    const thread = await client.read(selection.id);
    if (thread?.id !== selection.id || !thread.path) throw new Error('无法核对 Codex 会话身份，未归档。');
    const isArchived = (file) => path.dirname(file) === path.join(home, 'archived_sessions');
    if (isArchived(thread.path)) {
      log(`[归档] ${selection.id} 已归档。`);
      return false;
    }
    if (!selection.files.includes(await fs.realpath(thread.path)))
      throw new Error('Codex 当前使用的会话文件不在本次导入范围内，未归档。');
    if (thread.status?.type === 'active') throw new Error('Codex 会话仍在运行，未归档。');
    // JSON quoting prevents a user-controlled title from injecting terminal control sequences.
    const name = JSON.stringify(thread.name || selection.id);
    const prompt = createPrompt({ input, output });
    const controller = new AbortController();
    prompt.once('close', () => controller.abort());
    prompt.once('SIGINT', () => controller.abort());
    let answer;
    try {
      answer = await prompt.question(`[归档确认] 图片、Prompt 和标签已处理成功。归档会话 ${name} (${selection.id})？[y/n] `, {
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
      answer = 'n';
    } finally {
      prompt.close();
    }
    if (answer.trim().toLowerCase() !== 'y') {
      log('[归档] 已取消，上传结果保留，会话仍为活动状态。');
      return false;
    }
    await assertUnchanged();
    await client.archive(selection.id);
    const after = await client.read(selection.id);
    if (after?.id !== selection.id || !after.path || !isArchived(after.path))
      throw new Error('归档请求已发送，但回读未确认；请在 Codex 中核对，不会自动重试。');
    log(`[归档] 已确认 ${name} (${selection.id}) 归档成功。`);
    return true;
  } finally {
    client.close();
  }
}
