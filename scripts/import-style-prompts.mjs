#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { computeStyleGalleryVisualFeaturesFromBytes } from '../src/lib/style-gallery-visual-feature-node.ts';
import { configureEnvironmentProxy } from './lib/environment-proxy.mjs';

const PLACEHOLDER = '[在此处替换为您想要生成的主体内容]';
const DEFAULT_API_BASE_URL = process.env.STYLE_GALLERY_API_BASE_URL ?? 'https://clelele-blog.vercel.app';
const REQUEST_TIMEOUT_MS = positiveInteger(process.env.STYLE_GALLERY_IMPORT_REQUEST_TIMEOUT_MS, 30_000);
const UPLOAD_TIMEOUT_MS = positiveInteger(process.env.STYLE_GALLERY_IMPORT_UPLOAD_TIMEOUT_MS, 300_000);
const REQUEST_ATTEMPTS = positiveInteger(process.env.STYLE_GALLERY_IMPORT_ATTEMPTS, 3);
const UPLOAD_CONCURRENCY = positiveInteger(process.env.STYLE_GALLERY_IMPORT_UPLOAD_CONCURRENCY, 5);
// API 单批上限就是 100；默认填满可避免常见的 50-100 条 session 重复改写全量 catalog/视觉索引。
const ITEM_BATCH_SIZE = Math.min(positiveInteger(process.env.STYLE_GALLERY_IMPORT_ITEM_BATCH_SIZE, 100), 100);
const VISUAL_INFERENCE_BATCH_SIZE = Math.min(positiveInteger(process.env.STYLE_GALLERY_VISUAL_INFERENCE_BATCH_SIZE, 8), 16);

class NonRetryableRequestError extends Error {}

function usage() {
  console.error(
    'Usage: node scripts/import-style-prompts.mjs <codex-session.jsonl> [--dry-run] [--metadata-only] [--prompt-model=<name>] [--api-base-url=<url>]',
  );
  console.error('Required for writes: STYLE_GALLERY_UPLOAD_TOKEN');
}

function parseArgs(argv) {
  let sessionPath = null;
  let apiBaseUrl = DEFAULT_API_BASE_URL;
  let metadataOnly = false;
  let promptModel = null;
  let dryRun = false;
  let help = false;
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--metadata-only' || arg === '--update-metadata-only') metadataOnly = true;
    else if (arg.startsWith('--prompt-model=')) promptModel = arg.slice('--prompt-model='.length).trim() || null;
    else if (arg.startsWith('--api-base-url=')) apiBaseUrl = arg.slice('--api-base-url='.length);
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else if (!sessionPath) sessionPath = arg;
    else throw new Error(`Unexpected positional argument: ${arg}`);
  }
  return { apiBaseUrl: apiBaseUrl.replace(/\/$/, ''), dryRun, help, metadataOnly, promptModel, sessionPath };
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
  return prompt
    .replace(/\[\$([^\]\s]+)\]\((?:file:\/\/)?(?:~|\/Users|\/home)[^)]*\/SKILL\.md\)/g, '/$1')
    .replace(/(?:file:\/\/)?(?:~|\/Users|\/home)\/[^\s)]+\/([^/\s)]+)\/SKILL\.md/g, '/$1')
    .trim();
}

/** 单图沿用图片哈希；多图按用户输入顺序拼接各图哈希后再次计算，作为组合 item 的稳定身份。 */
function itemHashFromImageHashes(imageHashes) {
  if (imageHashes.length === 1) return imageHashes[0];
  return crypto.createHash('sha256').update(imageHashes.join('\n')).digest('hex');
}

function normalizePrompt(prompt) {
  return prompt.replace(/\r\n?/g, '\n').trim();
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
 * 从 Codex JSONL 的 canonical `event_msg` 中提取图片与最终 prompt 配对。
 *
 * 同一内容还可能出现在 `response_item`、`task_complete` 或压缩记录中；这里不读取这些副本，避免重复导入
 * base64 图片。最近一条带图 user_message 会与随后第一条包含占位符的 agent_message 配对，成功后立即清空。
 */
function extractItems(records) {
  const items = [];
  let pendingInput = null;
  let currentModel = null;
  for (const { index, record } of records) {
    const payload = record?.payload;
    if (!payload || typeof payload !== 'object') continue;
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
    if (record.type === 'event_msg' && payload.type === 'agent_message') {
      const message = typeof payload.message === 'string' ? payload.message : payload.message?.content;
      if (pendingInput && typeof message === 'string' && message.includes(PLACEHOLDER)) {
        items.push({ ...pendingInput, prompt: normalizePrompt(message), promptLine: index });
        pendingInput = null;
      }
    }
  }
  return items;
}

/**
 * 构造待写入的 v4 item 和缺失资产集合。
 * 同图不同 prompt 合并为有序变体；既有图片不重新生成或上传资产。
 */
async function buildImportData(extractedItems, sessionPath, existingByHash, metadataOnly, promptModelOverride) {
  const assets = new Map();
  const imageBytesByHash = new Map();
  const itemsByHash = new Map();
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
    const normalizedPrompt = normalizePrompt(extracted.prompt);
    const existingPrompts = existing ? [existing.prompt, ...(existing.additionalPrompts ?? [])] : [];
    if (existing && !metadataOnly && existingPrompts.some((prompt) => normalizePrompt(prompt) === normalizedPrompt)) {
      skippedDuplicates += 1;
      continue;
    }

    const shortHash = itemHash.slice(0, 12);
    const date = extracted.timestamp ? new Date(extracted.timestamp) : new Date();
    const slug = existing?.slug ?? `${date.toISOString().slice(0, 10)}-${shortHash}`;
    const title = existing?.title ?? `Style Prompt ${shortHash}`;
    const imageRefs = [];

    for (let index = 0; index < parsedImages.length; index += 1) {
      const image = parsedImages[index];
      const imageHash = imageHashes[index];
      imageBytesByHash.set(imageHash, image.bytes);
      const imageName = `${imageHash.slice(0, 12)}.${image.extension}`;
      const thumbnailName = `${imageHash.slice(0, 12)}.webp`;
      const sourceKey = `source/${imageName}`;
      const thumbnailKey = `thumb/${thumbnailName}`;
      if (!existing) assets.set(sourceKey, { body: image.bytes, contentType: image.mime });
      if (!existing && !assets.has(thumbnailKey)) {
        const thumbnail = await sharp(image.bytes)
          .resize({ width: 720, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
        assets.set(thumbnailKey, { body: thumbnail, contentType: 'image/webp' });
      }
      imageRefs.push({
        sourceImage: apiImagePath('source', imageName),
        thumbnailImage: apiImagePath('thumb', thumbnailName),
        sourceImageAlt: `${title} reference image ${index + 1}`,
        imageHash,
      });
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
      sourceImage: existing?.sourceImage ?? imageRefs[0].sourceImage,
      thumbnailImage: existing?.thumbnailImage ?? imageRefs[0].thumbnailImage,
      sourceImageAlt: existing?.sourceImageAlt ?? imageRefs[0].sourceImageAlt,
      prompts: [variant],
      imageHash: itemHash,
      images: imageRefs,
      examples: [],
    });
  }
  return { assets, imageBytesByHash, items: [...itemsByHash.values()], skippedDuplicates, skippedNewMetadata };
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
    item.images.map((image) => ({
      feature: featureByHash.get(image.imageHash),
      kind: 'source',
      sourceSlug: item.slug,
      imageId: image.imageHash,
    })),
  );
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
  const { apiBaseUrl, dryRun, help, metadataOnly, promptModel, sessionPath } = parseArgs(process.argv.slice(2));
  if (help || !sessionPath) {
    usage();
    process.exit(help ? 0 : 1);
  }
  const token = process.env.STYLE_GALLERY_UPLOAD_TOKEN;
  if (!dryRun && !token) throw new Error('STYLE_GALLERY_UPLOAD_TOKEN is required.');
  const absoluteSessionPath = path.resolve(sessionPath);
  const records = await readRecords(absoluteSessionPath);
  const extractedItems = extractItems(records);
  const catalog = await requestJson(`${apiBaseUrl}/api/style-gallery/catalog`, { headers: { accept: 'application/json' } });
  const existingByHash = new Map(catalog.items.map((item) => [item.imageHash, item]));
  const prepared = await buildImportData(extractedItems, absoluteSessionPath, existingByHash, metadataOnly, promptModel);

  console.log(`Found ${extractedItems.length} image/prompt items.`);
  if (dryRun) {
    const updates = prepared.items.filter((item) => existingByHash.has(item.imageHash)).length;
    console.log(
      `Dry run: ${prepared.items.length - updates} new item(s), ${updates} existing item(s) with candidate prompts, ${prepared.skippedDuplicates} exact duplicate(s), ${prepared.assets.size} asset object(s) would be prepared.`,
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
}

export { buildImportData, extractItems, parseArgs };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

/*
npm run import:style-prompts -- <session.jsonl> --prompt-model='gpt-5.6-sol'

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
