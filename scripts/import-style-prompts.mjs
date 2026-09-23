#!/usr/bin/env node
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { readStyleGalleryImageDimensions } from '../src/lib/style-gallery-image-dimensions.ts';
import { sanitizeImportedOriginalPrompt, sanitizeImportedPrompt } from '../src/lib/style-gallery-prompt-sanitize.ts';
import { isValidGalleryTag, MAX_GALLERY_TAGS_PER_ITEM, normalizeGalleryTag } from '../src/lib/style-gallery-tags.ts';
import { computeStyleGalleryVisualFeaturesFromBytes } from '../src/lib/style-gallery-visual-feature-node.ts';
import { configureEnvironmentProxy } from './lib/environment-proxy.mjs';
import {
  describeImportContext,
  describeImportHelp,
  describeImportPlan,
  describeMetadataWrite,
  describeOriginalRecovery,
  summarizePublishedImport,
} from './lib/style-prompt-import-diagnostics.mjs';
import { publishReplacementBatch } from './lib/style-prompt-import-publication.mjs';

const PLACEHOLDER = '[在此处替换为您想要生成的主体内容]';
const DEFAULT_API_BASE_URL = process.env.STYLE_GALLERY_API_BASE_URL ?? 'https://clelele-blog.vercel.app';
const REQUEST_TIMEOUT_MS = positiveInteger(process.env.STYLE_GALLERY_IMPORT_REQUEST_TIMEOUT_MS, 30_000);
const UPLOAD_TIMEOUT_MS = positiveInteger(process.env.STYLE_GALLERY_IMPORT_UPLOAD_TIMEOUT_MS, 300_000);
const REQUEST_ATTEMPTS = positiveInteger(process.env.STYLE_GALLERY_IMPORT_ATTEMPTS, 3);
const UPLOAD_CONCURRENCY = positiveInteger(process.env.STYLE_GALLERY_IMPORT_UPLOAD_CONCURRENCY, 5);
// API 单批上限就是 100；默认填满可避免常见的 50-100 条 session 重复改写全量 catalog/视觉索引。
const ITEM_BATCH_SIZE = Math.min(positiveInteger(process.env.STYLE_GALLERY_IMPORT_ITEM_BATCH_SIZE, 100), 100);
const VISUAL_INFERENCE_BATCH_SIZE = Math.min(positiveInteger(process.env.STYLE_GALLERY_VISUAL_INFERENCE_BATCH_SIZE, 8), 16);

class NonRetryableRequestError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function usage() {
  return describeImportHelp();
}

function parseArgs(argv) {
  let sessionPath = null;
  let apiBaseUrl = DEFAULT_API_BASE_URL;
  let metadataOnly = false;
  let overwriteTag = false;
  let overwriteImages = false;
  let promptModel = null;
  let dryRun = false;
  let help = false;
  const tags = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--metadata-only' || arg === '--update-metadata-only') metadataOnly = true;
    else if (arg === '--overwrite-tag') overwriteTag = true;
    else if (arg === '--overwrite-images') overwriteImages = true;
    else if (arg === '--tag' || arg.startsWith('--tag=')) {
      const raw = arg === '--tag' ? argv[++index] : arg.slice('--tag='.length);
      if (!raw || raw.startsWith('--') || raw.length > 100) throw new Error('--tag requires a valid category label.');
      const tag = normalizeGalleryTag(raw);
      if (!isValidGalleryTag(tag))
        throw new Error('--tag requires 1–24 visible characters; null is reserved for untagged search.');
      if (!tags.includes(tag)) tags.push(tag);
      if (tags.length > MAX_GALLERY_TAGS_PER_ITEM) throw new Error(`At most ${MAX_GALLERY_TAGS_PER_ITEM} tags are allowed.`);
    } else if (arg.startsWith('--prompt-model=')) promptModel = arg.slice('--prompt-model='.length).trim() || null;
    else if (arg.startsWith('--api-base-url=')) apiBaseUrl = arg.slice('--api-base-url='.length);
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else if (!sessionPath) sessionPath = arg;
    else throw new Error(`Unexpected positional argument: ${arg}`);
  }
  if (overwriteTag && !tags.length && !help) throw new Error('--overwrite-tag requires at least one --tag.');
  if (metadataOnly && overwriteImages) throw new Error('--overwrite-images cannot be combined with --metadata-only.');
  return {
    overwriteImages,
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ''),
    dryRun,
    help,
    metadataOnly,
    overwriteTag,
    promptModel,
    sessionPath,
    tags,
  };
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseDataUri(uri) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(uri);
  if (!match) return null;
  const [, mime, data] = match;
  const extension = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1] || 'bin';
  return { bytes: Buffer.from(data, 'base64'), extension, mime };
}

/** 移除原始用户 prompt 中的本机 skill 绝对路径，只保留可公开展示的 `/skill-name`。 */
function sanitizeOriginalPrompt(prompt) {
  return sanitizeImportedOriginalPrompt(prompt);
}

/** 单图沿用图片哈希；多图按用户输入顺序拼接各图哈希后再次计算，作为组合 item 的稳定身份。 */
function itemHashFromImageHashes(imageHashes) {
  if (imageHashes.length === 1) return imageHashes[0];
  return crypto.createHash('sha256').update(imageHashes.join('\n')).digest('hex');
}

/** 只计算导入记录的 item 身份；无效 data URI 不参与既有 metadata 查询。 */
function getExtractedItemHash(extracted) {
  const parsedImages = extracted.images.map(parseDataUri);
  if (parsedImages.some((image) => !image)) return null;
  return itemHashFromImageHashes(parsedImages.map((image) => crypto.createHash('sha256').update(image.bytes).digest('hex')));
}

/** Exact decoded-pixel identity handles clipboard PNG/JPEG-container changes without perceptual guesses.
 * Dimensions and ordered image boundaries are part of the digest. Lossy/resized variants only match
 * when a previous validated attachment or an explicit admin merge established their byte/pixel aliases.
 * Computation stays on the importing machine; Vercel only receives four fixed-size hashes per record.
 */
async function getDecodedItemHash(extracted) {
  return getDecodedImageGroupHash(
    extracted.images.map((uri) => {
      const image = parseDataUri(uri);
      if (!image) throw new Error('Invalid session image.');
      return image.bytes;
    }),
  );
}

async function getDecodedImageGroupHash(images) {
  const imageHashes = [];
  for (const bytes of images) {
    const { data, info } = await sharp(bytes)
      .rotate()
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    imageHashes.push(
      crypto.createHash('sha256').update(`gallery-pixels-v1:${info.width}:${info.height}:rgba\n`).update(data).digest('hex'),
    );
  }
  return crypto
    .createHash('sha256')
    .update(`gallery-pixel-group-v1:${imageHashes.join('\n')}`)
    .digest('hex');
}

/** Reject malformed session dates before network writes; inventing today's date breaks repeatability. */
function getImportDate(item) {
  if (typeof item.timestamp !== 'string' || !item.timestamp.trim() || !Number.isFinite(Date.parse(item.timestamp)))
    throw new Error(`Line ${item.sourceLine ?? '?'}: missing or invalid session timestamp.`);
  return new Date(item.timestamp).toISOString().slice(0, 10);
}

/** Seed the canonical pixels too when an old projection resolves through a merge/alias. */
async function buildCanonicalIdentityBinding(target, extracted, readCanonicalBytes) {
  const pixelHash =
    target.imageHash === getExtractedItemHash(extracted)
      ? extracted.preferredPixelHash
      : await getDecodedImageGroupHash(await Promise.all(target.images.map(readCanonicalBytes)));
  return {
    hashes: [...new Set([target.imageHash, pixelHash].filter(Boolean))],
    slug: target.slug,
    expectedHash: target.imageHash,
  };
}

function normalizePrompt(prompt) {
  return sanitizeImportedPrompt(prompt);
}

function promptId(prompt) {
  return crypto.createHash('sha256').update(normalizePrompt(prompt)).digest('hex');
}

function apiImagePath(kind, fileName) {
  return `/api/style-gallery/image/${kind}/${fileName}`;
}

/** Stream the JSONL rather than allocating one V8 string for the whole session.
 * Only paired images/prompts survive extraction; tool output, replayed UI payloads and other
 * unrelated records are released after each line. Physical line numbers include blank lines.
 */
async function readSessionItems(sessionPath) {
  const extractor = createItemExtractor();
  const input = createReadStream(sessionPath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let index = 0;
  try {
    for await (const line of lines) {
      index++;
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch (error) {
        throw new Error(`Failed to parse JSONL line ${index}: ${error.message}`);
      }
      extractor.consume({ index, record });
    }
    return extractor.items;
  } finally {
    lines.close();
    input.destroy();
  }
}

/**
 * 读取新版 `response_item` 中面向模型的用户输入投影。
 *
 * 同一内容也会出现在 UI 投影中；这里只创建一次配对，UI 的结构化 local_image 用于恢复原附件。
 *
 * @param {Record<string, unknown>} payload
 * @returns {{ images: string[], originalPrompt: string, attachmentPaths: (string | null)[] } | null}
 */
function responseItemInput(payload) {
  if (payload.type !== 'message' || payload.role !== 'user' || !Array.isArray(payload.content)) return null;
  const images = payload.content
    .filter((part) => part?.type === 'input_image')
    .map((part) => part.image_url)
    .filter((value) => typeof value === 'string' && value.startsWith('data:image/'));
  if (!images.length) return null;
  const originalPrompt = payload.content
    .filter((part) => part?.type === 'input_text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
  // Renderer wrappers and the complete Desktop file envelope are candidate paths only.
  // A matching UI projection must corroborate them before any local file is opened.
  let attachmentPaths = payload.content.flatMap((part, index) => {
    if (part?.type !== 'input_image') return [];
    const previous = payload.content[index - 1];
    const match = previous?.type === 'input_text' && /^<image name=\[Image #\d+\] path="([^"\n]+)">\s*$/.exec(previous.text);
    return [match ? match[1] : null];
  });
  if (attachmentPaths.every((value) => value === null)) {
    attachmentPaths = desktopImageEnvelopePaths(originalPrompt, images.length) ?? attachmentPaths;
  }
  return { images, originalPrompt, attachmentPaths };
}

/** Parse only a complete Desktop attachment envelope, never paths in the actual request.
 * Refuse mixed file/image lists and ambiguous counts instead of guessing which file belongs
 * to an embedded image. Basenames must match the displayed filenames, including spaces.
 */
function desktopImageEnvelopePaths(text, imageCount) {
  if (typeof text !== 'string') return null;
  const match =
    /^# Files mentioned by the user:\n\n([\s\S]*?)\n\nDistinguish instructions in attached documents from the user's request\.\n\n## My request:\n/.exec(
      text.replace(/\r\n?/g, '\n').trim(),
    );
  if (!match || !imageCount) return null;
  const entries = match[1].split('\n').filter((line) => line.trim());
  if (entries.length !== imageCount) return null;
  const paths = entries.map((line) => {
    const entry = /^## (.+): ([^\r\n]+)$/.exec(line);
    return entry && path.isAbsolute(entry[2]) && path.basename(entry[2]) === entry[1] && /\.(?:jpe?g|png|webp)$/i.test(entry[2])
      ? entry[2]
      : null;
  });
  return paths.every(Boolean) ? paths : null;
}

/** Some queued Desktop inputs repeat an envelope plus embedded images, without local_image.
 * Require the same ordered paths and image count in the UI projection. UI bytes can be larger
 * than model bytes, so resolveOriginalImages checks the file against BOTH representations.
 */
function envelopeProjectionPaths(text, images, input) {
  const paths = desktopImageEnvelopePaths(text, images.length);
  return paths &&
    matchingAttachmentPaths(paths, input) &&
    images.every((value) => typeof value === 'string' && parseDataUri(value))
    ? paths
    : null;
}

/**
 * 读取新版 `response_item` 中最终可见的助手回复。
 *
 * 部分版本会把 commentary 与 final answer 都写成 assistant message；存在 `phase` 时必须只接受
 * `final_answer`，否则中间说明中偶然出现 prompt 占位符会提前结束当前 task 的配对。
 *
 * @param {Record<string, unknown>} payload
 * @returns {string | null}
 */
function responseItemOutput(payload) {
  if (payload.type !== 'message' || payload.role !== 'assistant' || !Array.isArray(payload.content)) return null;
  // 新版记录会把中间 commentary 也写成 assistant message；有 phase 时只接受最终可见回复。
  if (typeof payload.phase === 'string' && payload.phase !== 'final_answer') return null;
  const message = payload.content
    .filter((part) => part?.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
  return message || null;
}

/**
 * 从 Codex JSONL 中提取每个 task 的图片与最终 prompt 配对。
 *
 * 同一输入可能同时写入 `event_msg` 的 UI 图片和 `response_item:message` 的模型图片。
 * 有 UI 内嵌图时优先保留其字节，否则使用模型图片。`item_completed` 与 `user_message.local_images`
 * 及完整的 Desktop 文件说明只补充经过同一输入和路径双重校验的原始附件，不创建额外配对。task_complete 和压缩副本也不重复导入；
 * task 边界会清空未完成配对，避免上一轮图片被错误关联到下一轮回复。
 */
function extractItems(records) {
  const extractor = createItemExtractor();
  for (const record of records) extractor.consume(record);
  return extractor.items;
}

/** UI attachment paths must corroborate every ordered wrapper or Desktop-envelope path. */
function matchingAttachmentPaths(paths, input) {
  return (
    Array.isArray(paths) &&
    paths.length === input.images.length &&
    paths.length > 0 &&
    paths.every((value, i) => typeof value === 'string' && path.isAbsolute(value) && value === input.attachmentPaths?.[i])
  );
}

/** UI/model projections of one verified input are aliases, not additional gallery cards.
 * Keep only ordered byte fingerprints here; no extra image payload enters public metadata.
 */
function withUiImages(input, images) {
  return {
    ...input,
    imageIdentityHashes: [
      ...new Set([...(input.imageIdentityHashes ?? []), getExtractedItemHash(input), getExtractedItemHash({ images })]),
    ],
    attachmentImageProjections: input.attachmentImageProjections ?? input.images,
    images,
  };
}

/** Include every corroborated representation before deciding whether to create a card.
 * Two active matches remain a conflict; a shared prompt alone never establishes identity.
 */
function buildIdentityQuery(item) {
  return {
    hashes: [
      ...new Set(
        [
          ...(item.imageIdentityHashes ?? []),
          item.embeddedHash,
          getExtractedItemHash(item),
          item.embeddedPixelHash,
          item.preferredPixelHash,
        ].filter(Boolean),
      ),
    ],
    legacySlug: `${getImportDate(item)}-${(item.embeddedHash || getExtractedItemHash(item)).slice(0, 12)}`,
  };
}

/** Share the exact turn/attachment pairing state machine between streams and in-memory fixtures. */
function createItemExtractor() {
  const items = [];
  let pendingInput = null;
  let currentModel = null;
  function consume({ index, record }) {
    const payload = record?.payload;
    if (!payload || typeof payload !== 'object') return;
    if (record.type === 'event_msg' && payload.type === 'task_started') {
      pendingInput = null;
      currentModel = null;
      return;
    }
    if (record.type === 'event_msg' && payload.type === 'task_complete') {
      pendingInput = null;
      return;
    }
    if (record.type === 'turn_context' && typeof payload.model === 'string' && payload.model.trim()) {
      currentModel = payload.model.trim();
      return;
    }
    if (record.type === 'event_msg' && payload.type === 'user_message' && Array.isArray(payload.images)) {
      const images = payload.images.filter((value) => typeof value === 'string' && value.startsWith('data:image/'));
      const originalPrompt = sanitizeOriginalPrompt(typeof payload.message === 'string' ? payload.message : '');
      // A UI projection has no turn_id in current Desktop JSONL. Bind it only once to the
      // pending model message in this task, with matching request text and image count.
      const sameInput =
        pendingInput?.turnId &&
        !pendingInput.uiProjectionSeen &&
        originalPrompt === pendingInput.originalPrompt &&
        (!payload.turn_id || payload.turn_id === pendingInput.turnId) &&
        (!images.length || images.length === pendingInput.images.length);
      if (images.length) {
        pendingInput = {
          ...(sameInput ? withUiImages(pendingInput, images) : {}),
          images,
          originalPrompt,
          sourceLine: index,
          timestamp: record.timestamp,
          model: currentModel,
        };
      } else if (!sameInput) {
        pendingInput = null;
      }
      if (pendingInput) {
        pendingInput.uiProjectionSeen = true;
        // Plain file mentions are not enough: require corroborated wrapper/envelope paths.
        // Actual file contents are still checked by resolveOriginalImages before any migration.
        if (sameInput && matchingAttachmentPaths(payload.local_images, pendingInput))
          pendingInput.localImagePaths = [...payload.local_images];
        else if (sameInput) {
          const paths = envelopeProjectionPaths(payload.message, images, pendingInput);
          if (paths) pendingInput.localImagePaths = paths;
        }
      }
      return;
    }
    if (record.type === 'response_item') {
      const input = responseItemInput(payload);
      if (input) {
        pendingInput = {
          images: input.images,
          attachmentPaths: input.attachmentPaths,
          turnId: payload.internal_chat_message_metadata_passthrough?.turn_id,
          originalPrompt: sanitizeOriginalPrompt(input.originalPrompt),
          sourceLine: index,
          timestamp: record.timestamp,
          model: currentModel,
        };
        return;
      }
    }
    // UI projections never create another item. Associate originals only when both the turn
    // identity and every ordered attachment path match the model-facing message.
    if (
      pendingInput?.turnId &&
      record.type === 'event_msg' &&
      payload.type === 'item_completed' &&
      payload.item?.type === 'UserMessage' &&
      payload.turn_id === pendingInput.turnId
    ) {
      const content = Array.isArray(payload.item.content) ? payload.item.content : [];
      const text = content
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n');
      const images = content.filter((part) => part?.type === 'image').map((part) => part.image_url);
      // Current rollouts can use item_completed instead of user_message for UI bytes.
      // Match the explicit turn, request and ordered count, and consume this projection once.
      // The UI image remains usable even when no attachment exists or its file was removed.
      if (
        !pendingInput.completedProjectionSeen &&
        sanitizeOriginalPrompt(text) === pendingInput.originalPrompt &&
        images.length === pendingInput.images.length &&
        images.every((image) => typeof image === 'string' && image.startsWith('data:image/'))
      ) {
        pendingInput = withUiImages(pendingInput, images);
        pendingInput.completedProjectionSeen = true;
      }
      const paths = content.filter((part) => part?.type === 'local_image').map((part) => part.path);
      if (matchingAttachmentPaths(paths, pendingInput)) {
        pendingInput.localImagePaths = paths;
      } else if (!paths.length) {
        const envelopePaths = envelopeProjectionPaths(text, images, pendingInput);
        if (envelopePaths) {
          pendingInput.localImagePaths = envelopePaths;
        }
      }
      return;
    }
    const message =
      record.type === 'event_msg' && payload.type === 'agent_message'
        ? typeof payload.message === 'string'
          ? payload.message
          : payload.message?.content
        : record.type === 'response_item'
          ? responseItemOutput(payload)
          : null;
    if (pendingInput && typeof message === 'string' && message.includes(PLACEHOLDER)) {
      items.push({ ...pendingInput, prompt: normalizePrompt(message), promptLine: index });
      pendingInput = null;
    }
  }
  return { items, consume };
}

/** Restore exact original bytes before identity lookup. Missing archived attachments fall back
 * explicitly; never search the disk or merge different byte hashes using visual similarity.
 * Local paths are extraction-only data and are never written to public metadata.
 */
async function resolveOriginalImages(items, warn = console.warn) {
  let restored = 0;
  let fallback = 0;
  const resolved = [];
  for (const item of items) {
    const images = [...item.images];
    let originalsVerified = 0;
    // Extraction-only accounting: group/duplicate records need image-occurrence counts, not card counts.
    let restoredImageCount = 0;
    const originalDimensions = [];
    for (const [index, originalPath] of (item.localImagePaths ?? []).entries()) {
      try {
        const stat = await fs.stat(originalPath);
        if (!stat.isFile() || !stat.size || stat.size > 50 * 1024 * 1024) throw new Error('unsupported attachment size');
        const bytes = await fs.readFile(originalPath);
        const metadata = await sharp(bytes).metadata();
        const mime = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[metadata.format];
        if (!mime) throw new Error('unsupported image format');
        const embedded = parseDataUri(images[index]);
        // Desktop's UI image may precede a second model-only resize. Validate both without
        // changing the embedded identity used to resolve already-published cards on reruns.
        const projections = new Set([images[index], item.attachmentImageProjections?.[index]].filter(Boolean));
        for (const projection of projections) {
          const projected = parseDataUri(projection);
          const embeddedSize = await sharp(projected.bytes).metadata();
          // Refuse an obviously replaced file rather than silently associating another picture.
          const ratio = (metadata.autoOrient?.width ?? metadata.width) / (metadata.autoOrient?.height ?? metadata.height);
          if (
            Math.abs(
              ratio -
                (embeddedSize.autoOrient?.width ?? embeddedSize.width) /
                  (embeddedSize.autoOrient?.height ?? embeddedSize.height),
            ) > 0.005
          )
            throw new Error('attachment dimensions no longer match');
          if (!bytes.equals(projected.bytes)) {
            const pixels = (buffer) =>
              sharp(buffer)
                .rotate()
                .flatten({ background: '#ffffff' })
                .toColourspace('srgb')
                .resize(64, 64, { fit: 'fill' })
                .removeAlpha()
                .raw()
                .toBuffer();
            const [originalPixels, sessionPixels] = await Promise.all([pixels(bytes), pixels(projected.bytes)]);
            const difference =
              originalPixels.reduce((total, value, i) => total + Math.abs(value - sessionPixels[i]), 0) / originalPixels.length;
            // This is only a stale-path guard, never a cross-item deduplication rule.
            if (difference > 8) throw new Error('attachment content no longer matches the session image');
          }
        }
        images[index] = `data:${mime};base64,${bytes.toString('base64')}`;
        originalsVerified++;
        originalDimensions[index] = {
          width: metadata.autoOrient?.width ?? metadata.width,
          height: metadata.autoOrient?.height ?? metadata.height,
        };
        // Count byte replacements; an already-original embedded image needs no restoration.
        if (!bytes.equals(embedded.bytes)) {
          restored++;
          restoredImageCount++;
        }
      } catch (error) {
        fallback++;
        warn(
          `Line ${item.sourceLine}, image ${index + 1}: original attachment unavailable (${error.code ?? error.message}); using session image bytes, which may have a different hash.`,
        );
      }
    }
    resolved.push({ ...item, images, originalsVerified, originalDimensions, restoredImageCount });
  }
  return { items: resolved, restored, fallback };
}

/**
 * 构造待写入的 v4 item 和缺失资产集合。
 * 同图不同 prompt 合并为有序变体；既有图片不重新生成或上传资产。
 */
async function buildImportData(extractedItems, sessionPath, existingByHash, metadataOnly, promptModelOverride) {
  const assets = new Map();
  const imageBytesByHash = new Map();
  const itemsByHash = new Map();
  const sourceSlugs = new Map();
  const recordDetails = [];
  let skippedDuplicates = 0;
  let skippedNewMetadata = 0;

  for (const extracted of extractedItems) {
    const parsedImages = extracted.images.map(parseDataUri);
    if (parsedImages.some((image) => !image)) continue;
    const imageHashes = parsedImages.map((image) => crypto.createHash('sha256').update(image.bytes).digest('hex'));
    const itemHash = extracted.canonicalHash ?? itemHashFromImageHashes(imageHashes);
    const existing = existingByHash.get(itemHash);
    if (!existing && metadataOnly) {
      skippedNewMetadata += 1;
      continue;
    }
    // Keep duplicate records eligible: rerunning after a tag-write failure must repair tags
    // without re-uploading assets or adding duplicate prompts. Reuse the first identity in a session.
    const shortHash = itemHash.slice(0, 12);
    const date = extracted.timestamp ? new Date(extracted.timestamp) : new Date();
    const slug = existing?.slug ?? sourceSlugs.get(itemHash) ?? `${date.toISOString().slice(0, 10)}-${shortHash}`;
    sourceSlugs.set(itemHash, slug);
    const normalizedPrompt = normalizePrompt(extracted.prompt);
    const existingPrompts = existing?.prompts ?? [];
    if (existing && !metadataOnly && existingPrompts.some((prompt) => normalizePrompt(prompt) === normalizedPrompt)) {
      skippedDuplicates += 1;
      recordDetails.push({
        kind: 'duplicate',
        slug,
        sourceLine: extracted.sourceLine,
        promptLine: extracted.promptLine,
        previousLine: null,
      });
      continue;
    }

    const title = existing?.title ?? `Style Prompt ${shortHash}`;
    const imageRefs = [];

    for (let index = 0; index < parsedImages.length; index += 1) {
      const image = parsedImages[index];
      const imageHash = imageHashes[index];
      imageBytesByHash.set(imageHash, image.bytes);
      if (existing) continue;
      const imageName = `${imageHash.slice(0, 12)}.${image.extension}`;
      const thumbnailName = `${imageHash.slice(0, 12)}.webp`;
      const sourceKey = `source/${imageName}`;
      const thumbnailKey = `thumb/${thumbnailName}`;
      assets.set(sourceKey, { body: image.bytes, contentType: image.mime });
      if (!assets.has(thumbnailKey)) {
        const thumbnail = await sharp(image.bytes)
          .resize({ width: 720, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
        assets.set(thumbnailKey, { body: thumbnail, contentType: 'image/webp' });
      }
      imageRefs.push({
        dimensions: await readStyleGalleryImageDimensions(image.bytes),
        sourceImage: apiImagePath('source', imageName),
        sourceImageAlt: `${title} reference image ${index + 1}`,
        imageHash,
      });
    }
    // 同一图片可能曾以不同 MIME/扩展名导入，alt 文案也可能沿用早期格式。命中既有 item 后必须复用
    // HF 详情中的完整引用；仅凭本轮 data URI 重建会让顶层字段与 images[0] 分叉并破坏持久化不变量。
    const storedImageRefs = existing?.images ?? imageRefs;
    if (
      !extracted.canonicalHash &&
      (storedImageRefs.length !== imageHashes.length ||
        storedImageRefs.some((image, index) => image.imageHash !== imageHashes[index]))
    ) {
      throw new Error(`Stored image metadata does not match imported image group for ${slug}.`);
    }

    const variant = {
      id: promptId(normalizedPrompt),
      prompt: normalizedPrompt,
      ...(promptModelOverride || extracted.model ? { model: promptModelOverride ?? extracted.model } : {}),
      ...(extracted.originalPrompt ? { originalPrompt: extracted.originalPrompt } : {}),
      importedAt: date.toISOString(),
      sourceSession: path.basename(sessionPath),
      sourceLine: extracted.sourceLine,
    };
    const pending = itemsByHash.get(itemHash);
    if (pending) {
      if (pending.prompts.some((prompt) => normalizePrompt(prompt.prompt) === normalizedPrompt)) {
        skippedDuplicates += 1;
        recordDetails.push({
          kind: 'duplicate',
          slug,
          sourceLine: extracted.sourceLine,
          promptLine: extracted.promptLine,
          previousLine: pending.prompts.find((prompt) => normalizePrompt(prompt.prompt) === normalizedPrompt)?.sourceLine,
        });
      } else {
        recordDetails.push({
          kind: 'variant',
          slug,
          sourceLine: extracted.sourceLine,
          promptLine: extracted.promptLine,
          previousLine: pending.prompts[0].sourceLine,
        });
        pending.prompts.push(variant);
      }
      continue;
    }
    if (existing)
      recordDetails.push({
        kind: 'variant',
        slug,
        sourceLine: extracted.sourceLine,
        promptLine: extracted.promptLine,
        previousLine: null,
      });
    itemsByHash.set(itemHash, {
      version: 4,
      slug,
      title,
      date: existing?.date ?? date.toISOString(),
      sourceImage: storedImageRefs[0].sourceImage,
      sourceImageAlt: storedImageRefs[0].sourceImageAlt,
      prompts: [variant],
      imageHash: itemHash,
      images: storedImageRefs,
      examples: [],
    });
  }
  return {
    assets,
    imageBytesByHash,
    items: [...itemsByHash.values()],
    sourceSlugs: [...sourceSlugs.values()],
    recordDetails,
    skippedDuplicates,
    skippedNewMetadata,
  };
}

/**
 * 视觉特征在本机从与上传对象相同的字节预计算。单个 ONNX pipeline 内做有界批处理，既减少逐图
 * 调度开销，也避免并发创建多个模型与中间张量；网络上传仍保持原有并发，Vercel 不参与图片推理。
 */
async function buildSourceVisualRecords(items, imageBytesByHash) {
  const uniqueImages = new Map();
  for (const item of items) {
    for (const image of item.images) {
      const bytes = imageBytesByHash.get(image.imageHash);
      if (!bytes) throw new Error(`Missing local image bytes for visual feature ${image.imageHash}.`);
      uniqueImages.set(image.imageHash, { bytes, imageHash: image.imageHash });
    }
  }
  const featureByHash = new Map();
  for (const batch of chunks([...uniqueImages.values()], VISUAL_INFERENCE_BATCH_SIZE)) {
    const features = await computeStyleGalleryVisualFeaturesFromBytes(batch);
    for (const feature of features) featureByHash.set(feature.imageHash, feature);
  }
  return items.flatMap((item) =>
    uniqueImagesByHash(item.images).map((image) => ({
      feature: featureByHash.get(image.imageHash),
      kind: 'source',
      sourceSlug: item.slug,
      imageId: image.imageHash,
    })),
  );
}

/** 同一轮消息可能重复携带相同 data URI；视觉索引按 item + imageHash 只保留一个引用。 */
function uniqueImagesByHash(images) {
  const unique = new Map();
  for (const image of images) {
    if (!unique.has(image.imageHash)) unique.set(image.imageHash, image);
  }
  return [...unique.values()];
}

async function requestJson(url, options, timeoutMs = REQUEST_TIMEOUT_MS, attempts = REQUEST_ATTEMPTS) {
  return requestWithRetries(url, options, timeoutMs, (response) => response.json(), attempts);
}

/** Retry both transport and response-body failures; image reads can fail after a redirect/header succeeds. */
async function requestWithRetries(url, options, timeoutMs, read, attempts = REQUEST_ATTEMPTS) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return await read(response);
      const message = await response.text();
      if (![408, 429].includes(response.status) && response.status < 500) {
        throw new NonRetryableRequestError(message || `HTTP ${response.status}`, response.status);
      }
      lastError = new Error(message || `HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof NonRetryableRequestError) throw error;
      lastError = error;
      if (error?.name === 'TimeoutError') {
        console.warn(`Request timed out after ${timeoutMs}ms (${attempt}/${attempts}): ${url}`);
      }
      if (attempt === attempts) break;
    }
    await sleep(400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
  }
  throw new Error(`Request failed after ${attempts} attempts (${timeoutMs}ms per attempt): ${url}`, {
    cause: lastError,
  });
}

/** 上传一个 HF 签名 URL；每次重试都有独立 timeout，明确的非重试型 4xx 会立即失败。 */
async function uploadObject(uploadUrl, asset) {
  let lastError;
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        body: asset.body,
        headers: { 'content-type': asset.contentType },
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      if (response.ok) return;
      const message = await response.text();
      if (![408, 429].includes(response.status) && response.status < 500) {
        throw new NonRetryableRequestError(message || `HTTP ${response.status}`);
      }
      lastError = new Error(message || `HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof NonRetryableRequestError) throw error;
      lastError = error;
      if (attempt === REQUEST_ATTEMPTS) break;
    }
    await sleep(500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
  }
  throw new Error(`Asset upload failed after ${REQUEST_ATTEMPTS} attempts.`, { cause: lastError });
}

/**
 * 先让服务端 HEAD 检查 HF 对象，只为缺失资产申请签名 URL，再用固定 worker 数并发上传。
 * 返回值只包含本轮新写入的键，供后续元数据失败时做精确补偿清理。
 */
async function prepareAndUploadAssets(apiBaseUrl, token, assets) {
  const entries = [...assets.entries()];
  const uploadedKeys = [];
  for (const chunk of chunks(entries, 200)) {
    const prepared = await requestJson(
      `${apiBaseUrl}/api/style-gallery/uploads`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'prepare', keys: chunk.map(([key]) => key) }),
      },
      UPLOAD_TIMEOUT_MS,
    );
    const uploadByKey = new Map(prepared.uploads.map((upload) => [upload.key, upload]));
    const pending = chunk.filter(([key]) => !uploadByKey.get(key)?.exists);
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < pending.length) {
        const [key, asset] = pending[nextIndex];
        nextIndex += 1;
        const upload = uploadByKey.get(key);
        if (!upload?.uploadUrl) throw new Error(`Missing signed upload URL for ${key}.`);
        await uploadObject(upload.uploadUrl, asset);
        uploadedKeys.push(key);
      }
    }
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, pending.length) }, worker));
  }
  return uploadedKeys;
}

async function cleanupAssets(apiBaseUrl, token, keys) {
  if (!keys.length) return;
  for (const chunk of chunks(keys, 200)) {
    await requestJson(
      `${apiBaseUrl}/api/style-gallery/uploads`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'cleanup', keys: chunk }),
      },
      UPLOAD_TIMEOUT_MS,
    ).catch((error) => console.error(`Cleanup warning: ${error.message}`));
  }
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { apiBaseUrl, dryRun, help, metadataOnly, overwriteTag, overwriteImages, promptModel, sessionPath, tags } = parseArgs(
    process.argv.slice(2),
  );
  if (help || !sessionPath) {
    (help ? console.log : console.error)(usage());
    process.exit(help ? 0 : 1);
  }
  configureEnvironmentProxy();
  const token = process.env.STYLE_GALLERY_UPLOAD_TOKEN;
  if (!token) throw new Error('STYLE_GALLERY_UPLOAD_TOKEN is required, including read-only identity planning.');
  const absoluteSessionPath = path.resolve(sessionPath);
  console.log(describeImportContext({ overwriteImages, dryRun, metadataOnly, overwriteTag, tags, apiBaseUrl }));
  console.log(`\nReading session: ${path.basename(absoluteSessionPath)} (streaming JSONL)...`);
  const rawItems = (await readSessionItems(absoluteSessionPath)).map((item) => ({
    ...item,
    embeddedHash: getExtractedItemHash(item),
    embeddedPixelHash: '',
  }));
  for (const item of rawItems) {
    getImportDate(item);
    item.embeddedPixelHash = await getDecodedItemHash(item);
  }
  const identityRequest = (body) =>
    requestJson(
      `${apiBaseUrl}/api/style-gallery/import-identities`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      UPLOAD_TIMEOUT_MS,
      // A disconnected write can still be running remotely. Poll its outcome before any new write.
      body.action === 'replace' ? 1 : REQUEST_ATTEMPTS,
    );
  const queryFor = buildIdentityQuery;
  const resolve = async (items) => {
    const matches = [];
    for (const batch of chunks(items, 100))
      matches.push(...(await identityRequest({ action: 'resolve', queries: batch.map(queryFor) })));
    return matches;
  };
  // Resolve UI bytes AND their corroborated model projections first. A recovery policy must never silently
  // create a second card, undo a manual merge, or replace an already published image on a normal rerun.
  const initialMatches = await resolve(rawItems);
  const originals = await resolveOriginalImages(
    rawItems.map((item, index) => (initialMatches[index] && !overwriteImages ? { ...item, localImagePaths: [] } : item)),
  );
  const extractedItems = originals.items;
  for (const item of extractedItems)
    item.preferredPixelHash =
      getExtractedItemHash(item) === item.embeddedHash ? item.embeddedPixelHash : await getDecodedItemHash(item);
  const matches = await resolve(extractedItems);
  const migrations = planImageMigrations(extractedItems, matches, overwriteImages);
  console.log(
    `\n[Identity] ${extractedItems.length} image/prompt records; ${matches.filter(Boolean).length} already associated with published cards.`,
  );
  const confirmedAttachments = rawItems.reduce((count, item) => count + (item.localImagePaths?.length ?? 0), 0);
  const unconfirmedRecords = rawItems.filter((item) => item.attachmentPaths?.some(Boolean) && !item.localImagePaths?.length);
  console.log(
    `附件路径：${confirmedAttachments} 张图片的路径已与同一条输入核对；${unconfirmedRecords.length} 条记录的路径无法确认归属，不读取对应文件。路径确认后仍需校验实际文件内容。`,
  );
  for (const item of unconfirmedRecords)
    console.log(
      `  Unconfirmed attachment: image line ${item.sourceLine}, prompt line ${item.promptLine}; source bytes retained.`,
    );
  console.log(
    describeOriginalRecovery({
      items: extractedItems.map((item, index) => ({
        restoredImages: item.restoredImageCount,
        reason: imageMigrationDecision(item, matches[index], overwriteImages),
        slug: matches[index]?.item.slug,
      })),
      fallback: originals.fallback,
      migrations: migrations.length,
      overwriteImages,
      dryRun,
    }),
  );
  const migratedHashes = new Set();
  const replacementUploadedKeys = [];
  const promptUpdatedHashes = new Set();
  if (migrations.length && !dryRun) {
    const replacements = [];
    for (const migration of migrations) {
      const assets = await buildImportData([migration.extracted], absoluteSessionPath, new Map(), false, promptModel);
      const replacement = { ...assets.items[0], slug: migration.match.item.slug };
      const visualRecords = await buildSourceVisualRecords([replacement], assets.imageBytesByHash);
      replacementUploadedKeys.push(...(await prepareAndUploadAssets(apiBaseUrl, token, assets.assets)));
      // A failed/lost replacement response leaves immutable source assets available for safe retry.
      // The server journals conditional metadata writes; it never deletes a shared old source object.
      replacements.push({
        slug: replacement.slug,
        revision: migration.match.revision,
        item: replacement,
        visualRecords,
        hashes: queryFor(migration.extracted).hashes,
      });
      console.log(
        `Prepared replacement ${replacement.slug}: ${migration.match.item.imageHash.slice(0, 12)} -> ${replacement.imageHash.slice(0, 12)} (URL hash follows image; prompts, tags and examples preserved).`,
      );
    }
    // Each source move writes two details plus shared indexes and a recovery snapshot. Keep these
    // batches smaller than read/metadata batches so HF latency stays within the function deadline.
    for (const batch of chunks(replacements, 10)) {
      const result = await publishReplacementBatch(identityRequest, batch, { timeoutMs: UPLOAD_TIMEOUT_MS });
      const changedSlugs = new Set(result.changedSlugs ?? []);
      for (const item of result.items ?? []) if (changedSlugs.has(item.slug)) migratedHashes.add(item.imageHash);
      console.log(
        result.readback
          ? `回读确认 ${result.changed} 张卡片已换为目标原图及 URL；发布响应丢失后确认成功，没有重复发送替换请求。`
          : result.changed
            ? `Published ${result.changed} image/URL migration(s) with one shared-index update; recovery ${result.recoveryId ?? 'not needed'}.`
            : `本批 ${batch.length} 张卡片已是目标原图及 URL，无需再次替换。`,
      );
    }
    matches.splice(0, matches.length, ...(await resolve(extractedItems)));
  }
  const existingByHash = new Map();
  for (const [index, match] of matches.entries()) {
    if (!match) continue;
    extractedItems[index].canonicalHash = match.item.imageHash;
    existingByHash.set(match.item.imageHash, { ...match.item, prompts: match.item.prompts.map((prompt) => prompt.prompt) });
  }

  const prepared = await buildImportData(extractedItems, absoluteSessionPath, existingByHash, metadataOnly, promptModel);

  console.log(describeImportPlan(prepared, existingByHash, metadataOnly));
  if (dryRun) {
    const updates = prepared.items.filter((item) => existingByHash.has(item.imageHash)).length;
    console.log(
      `Dry run: ${prepared.items.length - updates} new item(s), ${updates} existing item(s) with candidate prompts, ${prepared.skippedDuplicates} exact duplicate(s), ${prepared.assets.size} asset object(s) would be prepared.`,
    );
    if (tags.length)
      console.log(
        `Dry run: would ${overwriteTag ? 'replace tags with' : 'add'} ${tags.map((tag) => `#${tag}`).join(' ')} to ${prepared.sourceSlugs.length} source(s), including duplicates.`,
      );
    return;
  }
  // Reserve confirmed aliases before publishing new items. If a response/process is lost after
  // metadata commits, the next import can still find that card even if its temp attachment vanished.
  // A pending alias never appears as a public card until the catalog actually contains its target.
  const pendingByHash = new Map(prepared.items.map((item) => [item.imageHash, item]));
  const readCanonicalBytes = async (image) => {
    if (!prepared.imageBytesByHash.has(image.imageHash)) {
      const bytes = await requestWithRetries(new URL(image.sourceImage, apiBaseUrl), {}, UPLOAD_TIMEOUT_MS, async (response) =>
        Buffer.from(await response.arrayBuffer()),
      );
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== image.imageHash)
        throw new Error(`Canonical source hash mismatch ${image.imageHash.slice(0, 12)}.`);
      prepared.imageBytesByHash.set(image.imageHash, bytes);
    }
    return prepared.imageBytesByHash.get(image.imageHash);
  };
  const bindings = [];
  const canonicalBindings = new Map();
  for (const [index, item] of extractedItems.entries()) {
    const target = matches[index]?.item ?? pendingByHash.get(getExtractedItemHash(item));
    if (!target) continue;
    bindings.push({ hashes: queryFor(item).hashes, slug: target.slug, expectedHash: target.imageHash });
    if (!canonicalBindings.has(target.slug)) {
      canonicalBindings.set(target.slug, await buildCanonicalIdentityBinding(target, item, readCanonicalBytes));
    }
  }
  bindings.push(...canonicalBindings.values());
  for (const batch of chunks(bindings, 100)) await identityRequest({ action: 'remember', bindings: batch });
  let uploadedKeys = [];
  let written = 0,
    created = 0,
    updated = 0,
    addedPrompts = 0,
    apiDuplicates = 0;
  try {
    console.log(`\n[Prepare] Computing visual features for ${prepared.items.length} metadata item(s)...`);
    // Reuse verified canonical bytes for visual inference when an alias hit appends a prompt.
    for (const item of prepared.items) for (const image of item.images) await readCanonicalBytes(image);
    const visualRecords = await buildSourceVisualRecords(prepared.items, prepared.imageBytesByHash);
    const visualRecordsBySlug = new Map();
    for (const record of visualRecords) {
      const current = visualRecordsBySlug.get(record.sourceSlug) ?? [];
      current.push(record);
      visualRecordsBySlug.set(record.sourceSlug, current);
    }
    uploadedKeys = await prepareAndUploadAssets(apiBaseUrl, token, prepared.assets);
    const itemChunks = chunks(prepared.items, ITEM_BATCH_SIZE);
    for (let index = 0; index < itemChunks.length; index += 1) {
      const itemChunk = itemChunks[index];
      const batchVisualRecords = itemChunk.flatMap((item) => visualRecordsBySlug.get(item.slug) ?? []);
      console.log(`\n[Metadata] Writing batch ${index + 1}/${itemChunks.length} (${itemChunk.length} item(s))...`);
      const result = await requestJson(
        `${apiBaseUrl}/api/style-gallery/items`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            mode: metadataOnly ? 'upsert' : 'create',
            items: itemChunk,
            visualRecords: batchVisualRecords,
          }),
        },
        UPLOAD_TIMEOUT_MS,
      );
      for (const hash of result.promptChangedHashes ?? []) promptUpdatedHashes.add(hash);
      written += result.written ?? 0;
      created += result.created ?? 0;
      updated += result.updated ?? 0;
      addedPrompts += result.addedPrompts ?? 0;
      apiDuplicates += result.skippedDuplicates ?? 0;
      if (result.visualIndexUpdated === false) {
        console.warn('Warning: metadata was saved but the derived visual index needs to be rebuilt.');
      }
      console.log(
        `Metadata batch response ${index + 1}/${itemChunks.length}: ${describeMetadataWrite(result, migratedHashes)}`,
      );
    }
  } catch (error) {
    // 元数据未完成时只清理由本轮新增且未被 catalog 引用的资产，既有 HF 对象不会进入该列表。
    await cleanupAssets(apiBaseUrl, token, uploadedKeys);
    throw error;
  }
  // Persist only after item publication. Exact transformed-byte aliases make later clipboard/session
  // repeats stable without adding fields to the public catalog or using visual similarity as identity.
  const published = await resolve(extractedItems);
  // A retry can return duplicate counts after the first request committed. Reuse the existing
  // readback to reconcile this run; no additional public metadata fields or HTTP reads are needed.
  if (!metadataOnly) {
    const confirmed = summarizePublishedImport(
      extractedItems.map((item) => ({ prompt: normalizePrompt(item.prompt) })),
      published,
      existingByHash,
    );
    ({ written, created, updated, addedPrompts } = confirmed);
    apiDuplicates = confirmed.skippedDuplicates - prepared.skippedDuplicates;
    promptUpdatedHashes.clear();
    for (const hash of confirmed.promptChangedHashes) promptUpdatedHashes.add(hash);
    console.log('\n[回读] 已确认图片与 Prompt；以下普通导入汇总按本轮开始前后的差异统计。');
  }
  // Include replacement assets in reporting, but not in new-item rollback cleanup:
  // they may already be referenced by successfully published image migrations.
  const allUploadedKeys = [...new Set([...replacementUploadedKeys, ...uploadedKeys])];
  const originalsUploaded = allUploadedKeys.filter((key) => key.startsWith('source/')).length;
  const thumbnailsUploaded = allUploadedKeys.filter((key) => key.startsWith('thumb/')).length;
  console.log(
    `\n[Result] Uploaded ${allUploadedKeys.length} missing asset file(s): ${originalsUploaded} original image(s) + ${thumbnailsUploaded} thumbnail(s); concurrency ${UPLOAD_CONCURRENCY}.`,
  );
  console.log(
    `${metadataOnly ? 'Updated' : 'Wrote'} ${written} gallery metadata item(s): ${created} created, ${updated} with prompt changes, ${addedPrompts} prompt variant(s) added.`,
  );
  const both = [...migratedHashes].filter((hash) => promptUpdatedHashes.has(hash)).length;
  console.log(
    `Existing-card changes: ${promptUpdatedHashes.size - both} prompt-only; ${migratedHashes.size - both} image/URL-only; ${both} both image/URL and prompt. Tags are reported separately.`,
  );
  console.log(`Skipped ${prepared.skippedDuplicates + apiDuplicates} duplicate image/prompt records.`);
  if (metadataOnly) console.log(`Skipped ${prepared.skippedNewMetadata} new records because --metadata-only was set.`);
  for (const batch of chunks(
    extractedItems
      .map((item, index) => (published[index] ? { hashes: queryFor(item).hashes, slug: published[index].item.slug } : null))
      .filter(Boolean),
    100,
  )) {
    await identityRequest({ action: 'remember', bindings: batch });
  }
  // Tag storage is separate from image metadata. A failed tag write must never roll back imported images.
  try {
    const tagResult = await writeImportedTags(apiBaseUrl, token, prepared.sourceSlugs, tags, overwriteTag);
    if (tags.length)
      console.log(
        `\n[Tags] ${tags.map((tag) => `#${tag}`).join(' ')}: ${tagResult.processed} source(s) processed; ${tagResult.changed === null ? 'change count unavailable from this server' : `${tagResult.changed} changed, ${tagResult.processed - tagResult.changed} unchanged`}.`,
      );
  } catch (error) {
    throw new Error(
      'Images/prompts are saved, but tags could not be saved. Review any tag conflict before rerunning the same command.',
      {
        cause: error,
      },
    );
  }
}

/** Only proven original recovery can replace an existing card; missing attachments never downgrade it. */
function imageMigrationDecision(extracted, match, overwriteImages) {
  if (!match) return 'new';
  if (!overwriteImages) return 'preserved';
  if (extracted.originalsVerified !== extracted.images.length) return 'incomplete';
  const recoveredHash = getExtractedItemHash(extracted);
  if (recoveredHash === match.item.imageHash && match.item.slug.endsWith(`-${recoveredHash.slice(0, 12)}`)) return 'current';
  if (
    match.item.images.some((image, index) => {
      const candidate = extracted.originalDimensions?.[index];
      return (
        candidate && image.dimensions && candidate.width * candidate.height < image.dimensions.width * image.dimensions.height
      );
    })
  )
    return 'larger';
  return 'replace';
}

/** Share the same decision with diagnostics so skip explanations cannot drift from write eligibility. */
function planImageMigrations(items, matches, overwriteImages) {
  if (!overwriteImages) return [];
  const bySlug = new Map();
  for (const [index, extracted] of items.entries()) {
    const match = matches[index];
    const recoveredHash = getExtractedItemHash(extracted);
    const decision = imageMigrationDecision(extracted, match, overwriteImages);
    // A clipboard temp file may itself be a derivative. Never replace a larger published original
    // with a smaller decoded raster merely because both hashes are known aliases.
    if (decision === 'larger') {
      console.warn(`Keeping higher-resolution published image for ${match.item.slug}; recovered attachment is smaller.`);
      continue;
    }
    if (decision !== 'replace') continue;
    const previous = bySlug.get(match.item.slug);
    if (previous && getExtractedItemHash(previous.extracted) !== recoveredHash)
      throw new Error(`Conflicting originals for ${match.item.slug}; inspect the session before replacing images.`);
    bySlug.set(match.item.slug, { extracted, match });
  }
  return [...bySlug.values()];
}

/** Preserve existing tags by default; explicit replacement compares a fresh base and never auto-rebases conflicts. */
async function writeImportedTags(apiBaseUrl, token, slugs, tags, overwriteTag = false) {
  if (!tags.length) return { processed: 0, changed: 0 };
  let processed = 0;
  let changed = 0;
  // Replacement repeats source IDs and up to 12 base labels; 1,000 worst-case sources fit below 2 MB.
  const batchSize = overwriteTag ? 1000 : 10000;
  for (const batch of chunks([...new Set(slugs)], batchSize)) {
    let replacement;
    if (overwriteTag) {
      const current = await requestJson(`${apiBaseUrl}/api/style-gallery/tags?edit=1`, {
        cache: 'no-store',
        headers: { authorization: `Bearer ${token}` },
      });
      replacement = {
        mode: 'replace',
        previousTagsBySlug: Object.fromEntries(batch.map((slug) => [slug, current.items[slug] ?? []])),
      };
    }
    const result = await requestJson(
      `${apiBaseUrl}/api/style-gallery/tags`,
      {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, origin: new URL(apiBaseUrl).origin, 'content-type': 'application/json' },
        body: JSON.stringify({ slugs: batch, tags, ...replacement }),
      },
      UPLOAD_TIMEOUT_MS,
    );
    processed += batch.length;
    // Older deployments do not report mutations. Never label eligible sources as newly tagged.
    changed = changed !== null && Number.isInteger(result.changedSources) ? changed + result.changedSources : null;
  }
  return { processed, changed };
}

export {
  buildIdentityQuery,
  getExtractedItemHash,
  getDecodedItemHash,
  getImportDate,
  buildCanonicalIdentityBinding,
  planImageMigrations,
  imageMigrationDecision,
  resolveOriginalImages,
  writeImportedTags,
  buildImportData,
  extractItems,
  readSessionItems,
  parseArgs,
  uniqueImagesByHash,
  requestWithRetries,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    // 让 ONNX/Sharp 等原生 worker 自然清理；强制 process.exit() 可能在异常路径触发 mutex teardown 崩溃。
    process.exitCode = 1;
  });
}

/*
npm run import:style-prompts -- --help
# 首次导入或补回原图前可先加 --dry-run 查看来源、去重和覆盖计划；它需要管理 token，但不会写入。
npm run import:style-prompts -- <session.jsonl> --prompt-model='gpt-5.6-sol'
npm run import:style-prompts -- <session.jsonl> --tag "溶图" --tag "现实"
npm run import:style-prompts -- <session.jsonl> --tag "溶图" --tag "现实" --overwrite-tag

# 默认保留已发布图片身份；--overwrite-images 才会迁移可恢复的原始附件，URL 尾缀同步更新为新 hash，保留导入日期、Prompt、标签、示例和点赞。
# npm run import:style-prompts -- <session.jsonl> --tag "插画" --overwrite-images
# 不要按 Codex 新旧版本推断图片质量：UI/模型投影及客户端输入路径可能不同；此选项仅迁移已验证的原附件，不无条件重传。
# 内嵌图哈希别名只记录已经确认的来源；手动合并的跳转也会被尊重，不按视觉相似度自动合并。
# 原始附件优先：支持结构化 local_images/local_image，也支持模型与 UI 同时出现的完整 Desktop 文件说明；必须核对同一输入、路径顺序和图片内容。
# UI 图可能比模型图大，附件会对照两者校验；没有 local_image 字段不代表没有原附件。未确认路径会单独计数，不读取普通 prompt 中的路径。
# 附件不可用时警告并保留内嵌图。Recovered 只统计成功读取且字节不同的附件，不等于线上替换数量。
# Codex 可能缩放/重编码内嵌图；导入器不会改写 source 字节。请在临时附件仍存在时导入。
# JSONL 逐行读取；诊断行号对应真实物理行（包括空行），不再把 GB 级会话整体拼成字符串。
# Recovered 表示本机恢复了不同字节的原附件，不代表覆盖线上图；线上替换只发生在显式 --overwrite-images 阶段。
# 元数据批次只改 Prompt；结果另列仅图片/URL、仅 Prompt、两者都变更，重复明细从 1 编号。
# 记录、卡片、Prompt 与资产文件分别计数；source 原图与 thumb 缩略图各算一个文件，重复/新变体列出对应 hash 和行号。
# npm 入口只屏蔽 tsx 当前触发的 DEP0205 弃用警告，保留其他警告。
# 标签输出区分 processed / changed / unchanged；重复图片也参与标签修复，但不会虚报为新增。
# --tag 可重复传入，向本次来源（包括已导入的重复图）追加标签，保留已有标签；省略则不读写标签。
# --overwrite-tag 必须配合 --tag：以本次标签完整替换来源标签，适用于同图不同 Prompt 和完全重复的记录。
# 覆盖前读取最新标签；遇到并发修改会停止，请核对后再重跑，不会自动覆盖其他会话的修改。
# 标签使用同一个 Upload Token；标签失败可重跑同一命令，不会重复上传图片或 Prompt。
# --metadata-only 配合 --tag 时只标记已存在的来源；追加每批最多 10000 个，覆盖最多 1000 个，单批原子写入。

# 新版桌面附件包装仅提取 My request 正文；记忆引用块在计算 Prompt ID 前移除，保留 <...> 风格占位符。
# JSONL 的 turn_context 已包含正确模型时，可省略 --prompt-model；该参数用于缺失或手动覆盖来源模型。
# 写入前只核对新建/更新/重复数量时追加 --dry-run；该模式需要 Upload Token 只读解析私有身份别名，不会修改 HF。
# Upload Token、HF 凭证和可选调优项自动读取 .env.local；package script 会自动启用 shell 中已有的代理。
*/

/*
完整本地功能启动方式（首次运行及 Vercel Development 环境变量变化后，先执行第一行）：
npm exec --yes --package=node@24 --package=vercel -- vercel env pull .env.local --environment=development --yes

npm run dev -- --host 127.0.0.1 --port 4324

dev/import/upload script 都会读取被 gitignore 的 .env.local；代理地址沿用当前 shell 的 HTTP_PROXY/HTTPS_PROXY。
不要把 Upload Token、HF S3 密钥、GitHub OAuth Secret 或 Session Secret 直接写进本文件；
Vercel Development 中配置完整后，上述启动方式会启用全部功能。
*/
