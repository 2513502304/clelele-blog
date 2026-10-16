import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createZstdDecompress } from 'node:zlib';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const rolloutName = new RegExp(
  `^rollout-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-(${UUID})(?:_${UUID})*\\.jsonl(?:\\.zst)?$`,
  'i',
);

/** Codex may compress an inactive rollout without updating a previously copied CLI path. */
export async function resolveSessionPath(file) {
  try {
    return await fs.realpath(file);
  } catch (error) {
    if (error.code !== 'ENOENT' || !file.endsWith('.jsonl')) throw error;
    try {
      return await fs.realpath(`${file}.zst`);
    } catch (compressedError) {
      if (compressedError.code !== 'ENOENT') throw compressedError;
      throw error;
    }
  }
}

/** Decode in memory as a stream: history_base offsets refer to the uncompressed UTF-8 bytes.
 * Destroying a header-only reader must also close its underlying file, and source/decode
 * failures must reach the consumer rather than being mistaken for a complete import.
 */
export function createSessionReadStream(file) {
  const source = createReadStream(file);
  if (!file.endsWith('.zst')) return source.setEncoding('utf8');
  const decoded = createZstdDecompress();
  source.on('error', (error) => decoded.destroy(error));
  decoded.once('close', () => source.destroy());
  source.pipe(decoded);
  return decoded.setEncoding('utf8');
}

/** Read only the header, never the images or private conversation bodies during discovery. */
export async function sessionHeader(file, required = true) {
  const input = createSessionReadStream(file);
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      const record = JSON.parse(line);
      if (record.type !== 'session_meta' || !new RegExp(`^${UUID}$`, 'i').test(record.payload?.id ?? '')) break;
      const id = record.payload.id.toLowerCase();
      const name = path.basename(file);
      return {
        id,
        // Continuation headers retain the conversation ID, while history_base can point
        // to the previous segment's trailing UUID. This never expands session membership.
        segmentId:
          rolloutName.exec(name)?.[1].toLowerCase() === id ? name.match(new RegExp(UUID, 'gi')).at(-1).toLowerCase() : id,
        timestamp: record.payload.timestamp ?? '',
        historyBase: record.payload.history_base ?? null,
      };
    }
    if (required) throw new Error('Missing session_meta.id');
    return null;
  } catch (error) {
    throw new Error(`${path.basename(file)}: cannot verify session identity (${error.message}).`);
  } finally {
    lines.close();
    input.destroy();
  }
}

/** A supplied active/archive path determines its Codex home; copied files use the configured home. */
export function inferCodexHome(file) {
  let directory = path.dirname(file);
  while (path.dirname(directory) !== directory) {
    if (['sessions', 'archived_sessions'].includes(path.basename(directory))) return path.dirname(directory);
    directory = path.dirname(directory);
  }
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

/** Find continuations in active and archived trees. Both filename root and header must agree;
 * titles, fork ancestry and the continuation's trailing UUID never establish membership.
 */
export async function findSessionFiles(file, codexHome = inferCodexHome(path.resolve(file))) {
  const selected = await resolveSessionPath(file);
  const header = await sessionHeader(selected);
  const files = new Map([[selected, header]]);
  async function visit(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && rolloutName.exec(entry.name)?.[1].toLowerCase() === header.id) {
        const canonical = await fs.realpath(target);
        if (files.has(canonical)) continue;
        const candidate = await sessionHeader(canonical);
        if (candidate.id !== header.id)
          throw new Error(`${entry.name}: filename and session_meta.id disagree; stopping before upload.`);
        files.set(canonical, candidate);
      }
    }
  }
  await visit(path.join(codexHome, 'sessions'));
  await visit(path.join(codexHome, 'archived_sessions'));
  const segments = new Set();
  for (const name of files.keys()) {
    const segment = path.basename(name).replace(/\.zst$/, '');
    if (segments.has(segment))
      throw new Error(`${segment}: multiple copies of the same rollout; keep one verified copy before importing.`);
    segments.add(segment);
  }
  return {
    id: header.id,
    files: [...files]
      .sort(([a, am], [b, bm]) => am.timestamp.localeCompare(bm.timestamp) || a.localeCompare(b))
      .map(([name]) => name),
  };
}
