#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { readStyleGalleryImageDimensions } from '../src/lib/style-gallery-image-dimensions.ts';
import { sanitizeImportedOriginalPrompt, sanitizeImportedPrompt } from '../src/lib/style-gallery-prompt-sanitize.ts';
import { isValidGalleryTag, MAX_GALLERY_TAGS_PER_ITEM, normalizeGalleryTag } from '../src/lib/style-gallery-tags.ts';
import { computeStyleGalleryVisualFeaturesFromBytes } from '../src/lib/style-gallery-visual-feature-node.ts';
import { configureEnvironmentProxy } from './lib/environment-proxy.mjs';

const PLACEHOLDER = '[在此处替换为您想要生成的主体内容]';
const DEFAULT_API_BASE_URL = process.env.STYLE_GALLERY_API_BASE_URL ?? 'https://clelele-blog.vercel.app';
const REQUEST_TIMEOUT_MS = positiveInteger(process.env.STYLE_GALLERY_IMPORT_REQUEST_TIMEOUT_MS, 30_000);
const UPLOAD_TIMEOUT_MS = positiveInteger(process.env.STYLE_GALLERY_IMPORT_UPLOAD_TIMEOUT_MS, 300_000);
const REQUEST_ATTEMPTS = positiveInteger(process.env.STYLE_GALLERY_IMPORT_ATTEMPTS, 3);
const UPLOAD_CONCURRENCY = positiveInteger(process.env.STYLE_GALLERY_IMPORT_UPLOAD_CONCURRENCY, 5);
const PROMPT_READ_CONCURRENCY = positiveInteger(process.env.STYLE_GALLERY_IMPORT_PROMPT_READ_CONCURRENCY, 5);
// API 单批上限就是 100；默认填满可避免常见的 50-100 条 session 重复改写全量 catalog/视觉索引。
const ITEM_BATCH_SIZE = Math.min(positiveInteger(process.env.STYLE_GALLERY_IMPORT_ITEM_BATCH_SIZE, 100), 100);
const VISUAL_INFERENCE_BATCH_SIZE = Math.min(positiveInteger(process.env.STYLE_GALLERY_VISUAL_INFERENCE_BATCH_SIZE, 8), 16);

class NonRetryableRequestError extends Error {}

function usage() {
  console.error(
    'Usage: node scripts/import-style-prompts.mjs <codex-session.jsonl> [--dry-run] [--metadata-only] [--prompt-model=<name>] [--tag <label>]... [--overwrite-tag] [--api-base-url=<url>]',
  );
  console.error('Required for writes: STYLE_GALLERY_UPLOAD_TOKEN');
}

function parseArgs(argv) {
  let sessionPath = null;
  let apiBaseUrl = DEFAULT_API_BASE_URL;
  let metadataOnly = false;
  let overwriteTag = false;
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
  return {
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

function normalizePrompt(prompt) {
  return sanitizeImportedPrompt(prompt);
}

function promptId(prompt) {
  return crypto.createHash('sha256').update(normalizePrompt(prompt)).digest('hex');
}

function apiImagePath(kind, fileName) {
  return `/api/style-gallery/image/${kind}/${fileName}`;
}

async function readRecords(sessionPath) {
  const text = await fs.readFile(sessionPath, 'utf8');
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return { index: index + 1, record: JSON.parse(line) };
      } catch (error) {
        throw new Error(`Failed to parse JSONL line ${index + 1}: ${error.message}`);
      }
    });
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
  // Only exact renderer-generated image wrappers can link to a structured UI attachment.
  // Arbitrary paths in a user's prompt are never opened.
  const attachmentPaths = payload.content.flatMap((part, index) => {
    if (part.type !== 'input_image') return [];
    const previous = payload.content[index - 1];
    const match = previous?.type === 'input_text' && /^<image name=\[Image #\d+\] path="([^"\n]+)">\s*$/.exec(previous.text);
    return [match ? match[1] : null];
  });
  return { images, originalPrompt, attachmentPaths };
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
 * Codex 目前存在两种会话格式：旧格式把用户图片和最终回复写入 `event_msg`；新格式只在
 * `response_item:message` 中保存 `input_image` / `output_text`。`item_completed` 只补充经过路径和 turn
 * 双重校验的原始附件，不再创建配对；task_complete 和压缩副本也不重复导入。task 边界会清空未完成配对，避免上一轮
 * 图片被错误关联到下一轮回复。
 */
function extractItems(records) {
  const items = [];
  let pendingInput = null;
  let currentModel = null;
  for (const { index, record } of records) {
    const payload = record?.payload;
    if (!payload || typeof payload !== 'object') continue;
    if (record.type === 'event_msg' && payload.type === 'task_started') {
      pendingInput = null;
      currentModel = null;
      continue;
    }
    if (record.type === 'event_msg' && payload.type === 'task_complete') {
      pendingInput = null;
      continue;
    }
    if (record.type === 'turn_context' && typeof payload.model === 'string' && payload.model.trim()) {
      currentModel = payload.model.trim();
      continue;
    }
    if (record.type === 'event_msg' && payload.type === 'user_message' && Array.isArray(payload.images)) {
      const images = payload.images.filter((value) => typeof value === 'string' && value.startsWith('data:image/'));
      if (images.length) {
        pendingInput = {
          images,
          originalPrompt: sanitizeOriginalPrompt(typeof payload.message === 'string' ? payload.message : ''),
          sourceLine: index,
          timestamp: record.timestamp,
          model: currentModel,
        };
      }
      continue;
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
        continue;
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
      const paths = (payload.item.content ?? []).filter((part) => part.type === 'local_image').map((part) => part.path);
      if (
        paths.length === pendingInput.images.length &&
        paths.every(
          (value, i) => typeof value === 'string' && path.isAbsolute(value) && value === pendingInput.attachmentPaths?.[i],
        )
      ) {
        pendingInput.localImagePaths = paths;
      }
      continue;
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
  return items;
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
    for (const [index, originalPath] of (item.localImagePaths ?? []).entries()) {
      try {
        const stat = await fs.stat(originalPath);
        if (!stat.isFile() || !stat.size || stat.size > 50 * 1024 * 1024) throw new Error('unsupported attachment size');
        const bytes = await fs.readFile(originalPath);
        const metadata = await sharp(bytes).metadata();
        const mime = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[metadata.format];
        if (!mime) throw new Error('unsupported image format');
        const embedded = parseDataUri(images[index]);
        const embeddedSize = await sharp(embedded.bytes).metadata();
        // Refuse an obviously replaced file rather than silently associating another picture.
        const ratio = (metadata.autoOrient?.width ?? metadata.width) / (metadata.autoOrient?.height ?? metadata.height);
        if (
          Math.abs(
            ratio -
              (embeddedSize.autoOrient?.width ?? embeddedSize.width) / (embeddedSize.autoOrient?.height ?? embeddedSize.height),
          ) > 0.005
        )
          throw new Error('attachment dimensions no longer match');
        if (!bytes.equals(embedded.bytes)) {
          const pixels = (buffer) =>
            sharp(buffer)
              .rotate()
              .flatten({ background: '#ffffff' })
              .toColourspace('srgb')
              .resize(64, 64, { fit: 'fill' })
              .removeAlpha()
              .raw()
              .toBuffer();
          const [originalPixels, sessionPixels] = await Promise.all([pixels(bytes), pixels(embedded.bytes)]);
          const difference =
            originalPixels.reduce((total, value, i) => total + Math.abs(value - sessionPixels[i]), 0) / originalPixels.length;
          // This is only a stale-path guard, never a cross-item deduplication rule.
          if (difference > 8) throw new Error('attachment content no longer matches the session image');
        }
        images[index] = `data:${mime};base64,${bytes.toString('base64')}`;
        if (!bytes.equals(embedded.bytes)) restored++;
      } catch (error) {
        fallback++;
        warn(
          `Line ${item.sourceLine}, image ${index + 1}: original attachment unavailable (${error.code ?? error.message}); using session image bytes, which may have a different hash.`,
        );
      }
    }
    resolved.push({ ...item, images });
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
  let skippedDuplicates = 0;
  let skippedNewMetadata = 0;

  for (const extracted of extractedItems) {
    const parsedImages = extracted.images.map(parseDataUri);
    if (parsedImages.some((image) => !image)) continue;
    const imageHashes = parsedImages.map((image) => crypto.createHash('sha256').update(image.bytes).digest('hex'));
    const itemHash = itemHashFromImageHashes(imageHashes);
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
      storedImageRefs.length !== imageHashes.length ||
      storedImageRefs.some((image, index) => image.imageHash !== imageHashes[index])
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
      } else {
        pending.prompts.push(variant);
      }
      continue;
    }
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

async function requestJson(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  let lastError;
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return response.json();
      const message = await response.text();
      if (![408, 429].includes(response.status) && response.status < 500) {
        throw new NonRetryableRequestError(message || `HTTP ${response.status}`);
      }
      lastError = new Error(message || `HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof NonRetryableRequestError) throw error;
      lastError = error;
      if (error?.name === 'TimeoutError') {
        console.warn(`Request timed out after ${timeoutMs}ms (${attempt}/${REQUEST_ATTEMPTS}): ${url}`);
      }
      if (attempt === REQUEST_ATTEMPTS) break;
    }
    await sleep(400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
  }
  throw new Error(`Request failed after ${REQUEST_ATTEMPTS} attempts (${timeoutMs}ms per attempt): ${url}`, {
    cause: lastError,
  });
}

/** 使用固定 worker 数处理网络任务，避免大量既有图片同时请求 prompt item endpoint。 */
async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

/**
 * Catalog 只保留列表字段，不能用于同图 prompt 去重，也不能重建多图引用。这里仅为本次 JSONL
 * 命中的既有 imageHash 并发读取详情；纯新增导入不额外请求，少量重复图也不会下载全量索引。
 */
async function loadExistingItemsByHash(apiBaseUrl, catalogItems, extractedItems, request = requestJson) {
  const importedHashes = new Set(extractedItems.map(getExtractedItemHash).filter(Boolean));
  const matchedItems = catalogItems.filter((item) => importedHashes.has(item.imageHash));
  const hydratedItems = await mapConcurrent(matchedItems, PROMPT_READ_CONCURRENCY, async (item) => {
    const version = item.promptRevision ? `?v=${encodeURIComponent(item.promptRevision)}` : '';
    const response = await request(`${apiBaseUrl}/api/style-gallery/prompts/${encodeURIComponent(item.slug)}${version}`, {
      headers: { accept: 'application/json' },
    });
    if (!Array.isArray(response.prompts)) {
      throw new Error(`Prompt response for ${item.slug} did not contain a prompt array.`);
    }
    if (
      !response.item ||
      response.item.slug !== item.slug ||
      response.item.imageHash !== item.imageHash ||
      !Array.isArray(response.item.images) ||
      !response.item.images.length
    ) {
      throw new Error(`Prompt response for ${item.slug} did not contain matching image metadata.`);
    }
    const prompts = response.prompts.map((choice) => choice?.prompt).filter((prompt) => typeof prompt === 'string');
    if (!prompts.length) throw new Error(`Prompt response for ${item.slug} did not contain any usable prompts.`);
    return {
      ...item,
      ...response.item,
      prompts,
    };
  });
  return new Map(hydratedItems.map((item) => [item.imageHash, item]));
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
  configureEnvironmentProxy();
  const { apiBaseUrl, dryRun, help, metadataOnly, overwriteTag, promptModel, sessionPath, tags } = parseArgs(
    process.argv.slice(2),
  );
  if (help || !sessionPath) {
    usage();
    process.exit(help ? 0 : 1);
  }
  const token = process.env.STYLE_GALLERY_UPLOAD_TOKEN;
  if (!dryRun && !token) throw new Error('STYLE_GALLERY_UPLOAD_TOKEN is required.');
  const absoluteSessionPath = path.resolve(sessionPath);
  const records = await readRecords(absoluteSessionPath);
  const originals = await resolveOriginalImages(extractItems(records));
  const extractedItems = originals.items;
  console.log(
    `Restored ${originals.restored} original attachment(s); ${originals.fallback} attachment(s) fell back to session images.`,
  );
  const catalogUrl = new URL('/api/style-gallery/catalog', apiBaseUrl);
  // 公网页面依赖长 CDN 缓存降低 Fluid CPU；命令行写入必须绕过旧列表，否则刚导入的 item 会被误判为新增。
  catalogUrl.searchParams.set('_', Date.now().toString());
  const catalog = await requestJson(catalogUrl.toString(), {
    cache: 'no-store',
    headers: { accept: 'application/json', 'cache-control': 'no-cache' },
  });
  const existingByHash = await loadExistingItemsByHash(apiBaseUrl, catalog.items, extractedItems);
  const prepared = await buildImportData(extractedItems, absoluteSessionPath, existingByHash, metadataOnly, promptModel);

  console.log(`Found ${extractedItems.length} image/prompt items.`);
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
  let uploadedKeys = [];
  try {
    console.log(`Computing visual features for ${prepared.items.length} metadata item(s)...`);
    const visualRecords = await buildSourceVisualRecords(prepared.items, prepared.imageBytesByHash);
    const visualRecordsBySlug = new Map();
    for (const record of visualRecords) {
      const current = visualRecordsBySlug.get(record.sourceSlug) ?? [];
      current.push(record);
      visualRecordsBySlug.set(record.sourceSlug, current);
    }
    uploadedKeys = await prepareAndUploadAssets(apiBaseUrl, token, prepared.assets);
    let written = 0;
    let created = 0;
    let updated = 0;
    let addedPrompts = 0;
    let apiDuplicates = 0;
    const itemChunks = chunks(prepared.items, ITEM_BATCH_SIZE);
    for (let index = 0; index < itemChunks.length; index += 1) {
      const itemChunk = itemChunks[index];
      const batchVisualRecords = itemChunk.flatMap((item) => visualRecordsBySlug.get(item.slug) ?? []);
      console.log(`Writing metadata batch ${index + 1}/${itemChunks.length} (${itemChunk.length} item(s))...`);
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
      written += result.written ?? 0;
      created += result.created ?? 0;
      updated += result.updated ?? 0;
      addedPrompts += result.addedPrompts ?? 0;
      apiDuplicates += result.skippedDuplicates ?? 0;
      if (result.visualIndexUpdated === false) {
        console.warn('Warning: metadata was saved but the derived visual index needs to be rebuilt.');
      }
      console.log(
        `Completed metadata batch ${index + 1}/${itemChunks.length}: ${result.created ?? 0} new item(s), ${result.updated ?? 0} existing item(s) updated, ${result.addedPrompts ?? 0} prompt(s) added, ${result.skippedDuplicates ?? 0} duplicate prompt(s).`,
      );
    }
    console.log(`Uploaded ${uploadedKeys.length} missing image assets with concurrency ${UPLOAD_CONCURRENCY}.`);
    console.log(
      `${metadataOnly ? 'Updated' : 'Wrote'} ${written} gallery metadata item(s): ${created} created, ${updated} updated, ${addedPrompts} prompt variant(s) added.`,
    );
    console.log(`Skipped ${prepared.skippedDuplicates + apiDuplicates} duplicate image/prompt records.`);
    if (metadataOnly) console.log(`Skipped ${prepared.skippedNewMetadata} new records because --metadata-only was set.`);
  } catch (error) {
    // 元数据未完成时只清理由本轮新增且未被 catalog 引用的资产，既有 HF 对象不会进入该列表。
    await cleanupAssets(apiBaseUrl, token, uploadedKeys);
    throw error;
  }
  // Tag storage is separate from image metadata. A failed tag write must never roll back imported images.
  try {
    const tagResult = await writeImportedTags(apiBaseUrl, token, prepared.sourceSlugs, tags, overwriteTag);
    if (tags.length)
      console.log(
        `Tags ${tags.map((tag) => `#${tag}`).join(' ')}: ${tagResult.processed} source(s) processed; ${tagResult.changed === null ? 'change count unavailable from this server' : `${tagResult.changed} changed, ${tagResult.processed - tagResult.changed} unchanged`}.`,
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
  resolveOriginalImages,
  writeImportedTags,
  buildImportData,
  extractItems,
  loadExistingItemsByHash,
  parseArgs,
  uniqueImagesByHash,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    // 让 ONNX/Sharp 等原生 worker 自然清理；强制 process.exit() 可能在异常路径触发 mutex teardown 崩溃。
    process.exitCode = 1;
  });
}

/*
npm run import:style-prompts -- <session.jsonl> --prompt-model='gpt-5.6-sol'
npm run import:style-prompts -- <session.jsonl> --tag "溶图" --tag "现实"
npm run import:style-prompts -- <session.jsonl> --tag "溶图" --tag "现实" --overwrite-tag

# 原始附件优先：仅使用同一 turn 中结构化 local_image 与图片包装路径一致的本地文件；不可用时警告并回退内嵌图。
# Codex 可能缩放/重编码内嵌图；导入器不会改写 source 字节。请在临时附件仍存在时导入。
# 标签输出区分 processed / changed / unchanged；重复图片也参与标签修复，但不会虚报为新增。
# --tag 可重复传入，向本次来源（包括已导入的重复图）追加标签，保留已有标签；省略则不读写标签。
# --overwrite-tag 必须配合 --tag：以本次标签完整替换来源标签，适用于同图不同 Prompt 和完全重复的记录。
# 覆盖前读取最新标签；遇到并发修改会停止，请核对后再重跑，不会自动覆盖其他会话的修改。
# 标签使用同一个 Upload Token；标签失败可重跑同一命令，不会重复上传图片或 Prompt。
# --metadata-only 配合 --tag 时只标记已存在的来源；追加每批最多 10000 个，覆盖最多 1000 个，单批原子写入。

# 新版桌面附件包装仅提取 My request 正文；记忆引用块在计算 Prompt ID 前移除，保留 <...> 风格占位符。
# JSONL 的 turn_context 已包含正确模型时，可省略 --prompt-model；该参数用于缺失或手动覆盖来源模型。
# 写入前只核对新建/更新/重复数量时追加 --dry-run；该模式不需要 Upload Token，也不会修改 HF。
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
