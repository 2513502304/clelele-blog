import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { sanitizeImportedOriginalPrompt, sanitizeImportedPrompt } from '../../src/lib/style-gallery-prompt-sanitize.ts';

const transcriptPath = '.system_generated/logs/transcript.jsonl';
const subject = '[在此处替换为您想要生成的主体内容]';

/** Resolve an explicit brain directory or an exact annotation title without opening other transcripts. */
export async function resolveAntigravityTranscript(selector, root = path.join(os.homedir(), '.gemini/antigravity')) {
  if ((await fs.stat(selector).catch(() => null))?.isDirectory()) return fs.realpath(path.join(selector, transcriptPath));
  const matches = [];
  for (const filename of await fs.readdir(path.join(root, 'annotations'))) {
    if (!/^[0-9a-f-]+\.pbtxt$/i.test(filename)) continue;
    const metadata = await fs.readFile(path.join(root, 'annotations', filename), 'utf8');
    const title = metadata.match(/(?:^|\s)title\s*:\s*("(?:\\.|[^"\\])*")/);
    if (title && JSON.parse(title[1]) === selector) matches.push(filename.slice(0, -6));
  }
  if (matches.length !== 1)
    throw new Error(
      `Expected one exact Antigravity title, found ${matches.length}. Provide its brain directory to disambiguate.`,
    );
  return fs.realpath(path.join(root, 'brain', matches[0], transcriptPath));
}

async function readAttachment(media, uploadRoot) {
  if (typeof media.uri !== 'string') throw new Error('Missing Antigravity upload URI.');
  const file = await fs.realpath(media.uri.startsWith('file://') ? fileURLToPath(media.uri) : media.uri);
  // Textual paths from prompts, tool calls, other sessions and symlinks outside this upload directory cannot supply bytes.
  if (!file.startsWith(uploadRoot + path.sep)) throw new Error('Attachment does not belong to the selected conversation.');
  const stat = await fs.stat(file);
  if (!stat.isFile() || !stat.size || stat.size > 50 * 1024 * 1024) throw new Error('Unsupported Antigravity attachment size.');
  const bytes = await fs.readFile(file);
  const mime = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    ? 'image/jpeg'
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
        ? 'image/webp'
        : null;
  if (!mime || media.mime_type !== mime) throw new Error('Unsupported or mismatched Antigravity image type.');
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

/** Pair only a completed visible model reply with the current explicit user turn's structured upload list. */
export async function readAntigravityItems(transcript) {
  const sessionDir = path.resolve(path.dirname(transcript), '../..');
  const uploadRoot = path.join(sessionDir, '.user_uploaded');
  if ((await fs.realpath(uploadRoot)) !== uploadRoot) throw new Error('Unexpected Antigravity upload directory.');
  const input = createReadStream(transcript, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const items = [];
  let pending = null,
    line = 0,
    mediaCount = 0,
    paired = 0;
  try {
    for await (const raw of lines) {
      line++;
      if (!raw.trim()) continue;
      const record = JSON.parse(raw);
      if (record.type === 'USER_INPUT' && record.source === 'USER_EXPLICIT') {
        pending = null;
        if (record.status !== 'DONE' || !record.media?.length) continue;
        mediaCount += record.media.length;
        // Client context following USER_REQUEST may contain private paths and account details.
        const request = record.content?.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/)?.[1];
        pending = {
          sourceLine: line,
          timestamp: record.created_at,
          media: record.media,
          originalPrompt: request ? sanitizeImportedOriginalPrompt(request.trim()) : '',
        };
      } else if (
        pending &&
        record.type === 'PLANNER_RESPONSE' &&
        record.source === 'MODEL' &&
        record.status === 'DONE' &&
        !record.tool_calls?.length &&
        typeof record.content === 'string' &&
        record.content.includes(subject)
      ) {
        const { media, ...turn } = pending;
        const images = await Promise.all(media.map((entry) => readAttachment(entry, uploadRoot)));
        items.push({
          ...turn,
          images,
          prompt: sanitizeImportedPrompt(record.content),
          model: record.model,
          promptLine: line,
          sourceSession: `antigravity-${path.basename(sessionDir)}`,
        });
        paired += images.length;
        pending = null;
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  if (!items.length) throw new Error('No completed image/template pairs in this Antigravity transcript.');
  if (paired !== mediaCount)
    console.warn(`Antigravity paired ${paired} of ${mediaCount} uploaded images with reusable prompts.`);
  return items;
}
