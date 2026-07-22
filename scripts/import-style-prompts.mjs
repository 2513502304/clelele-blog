#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const PLACEHOLDER = '[在此处替换为您想要生成的主体内容]';
const DEFAULT_API_BASE_URL = process.env.STYLE_GALLERY_API_BASE_URL ?? 'https://clelele-blog.vercel.app';
const REQUEST_TIMEOUT_MS = positiveInteger(process.env.STYLE_GALLERY_IMPORT_REQUEST_TIMEOUT_MS, 30_000);
const UPLOAD_TIMEOUT_MS = positiveInteger(process.env.STYLE_GALLERY_IMPORT_UPLOAD_TIMEOUT_MS, 120_000);
const REQUEST_ATTEMPTS = positiveInteger(process.env.STYLE_GALLERY_IMPORT_ATTEMPTS, 3);
const UPLOAD_CONCURRENCY = positiveInteger(process.env.STYLE_GALLERY_IMPORT_UPLOAD_CONCURRENCY, 5);

class NonRetryableRequestError extends Error {}

function usage() {
  console.error('Usage: node scripts/import-style-prompts.mjs <codex-session.jsonl> [--metadata-only] [--api-base-url=<url>]');
  console.error('Required environment: STYLE_GALLERY_UPLOAD_TOKEN');
}

function parseArgs(argv) {
  let sessionPath = null;
  let apiBaseUrl = DEFAULT_API_BASE_URL;
  let metadataOnly = false;
  let help = false;
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--metadata-only' || arg === '--update-metadata-only') metadataOnly = true;
    else if (arg.startsWith('--api-base-url=')) apiBaseUrl = arg.slice('--api-base-url='.length);
    else if (!arg.startsWith('--') && !sessionPath) sessionPath = arg;
  }
  return { apiBaseUrl: apiBaseUrl.replace(/\/$/, ''), help, metadataOnly, sessionPath };
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
  for (const { index, record } of records) {
    const payload = record?.payload;
    if (!payload || typeof payload !== 'object') continue;
    if (record.type === 'event_msg' && payload.type === 'user_message' && Array.isArray(payload.images)) {
      const images = payload.images.filter((value) => typeof value === 'string' && value.startsWith('data:image/'));
      if (images.length) {
        pendingInput = {
          images,
          originalPrompt: sanitizeOriginalPrompt(typeof payload.message === 'string' ? payload.message : ''),
          sourceLine: index,
          timestamp: record.timestamp,
        };
      }
      continue;
    }
    if (record.type === 'event_msg' && payload.type === 'agent_message') {
      const message = typeof payload.message === 'string' ? payload.message : payload.message?.content;
      if (pendingInput && typeof message === 'string' && message.includes(PLACEHOLDER)) {
        items.push({ ...pendingInput, prompt: message.trim(), promptLine: index });
        pendingInput = null;
      }
    }
  }
  return items;
}

/**
 * 构造待写入的 v3 item 和缺失资产集合。
 * 同一用户消息中的多张图保持原顺序并归入一个 item；资产 Map 按对象键去重，缩略图只生成一次。
 */
async function buildImportData(extractedItems, sessionPath, existingByHash, metadataOnly) {
  const assets = new Map();
  const items = [];
  let skippedDuplicates = 0;
  let skippedNewMetadata = 0;

  for (const extracted of extractedItems) {
    const parsedImages = extracted.images.map(parseDataUri);
    if (parsedImages.some((image) => !image)) continue;
    const imageHashes = parsedImages.map((image) => crypto.createHash('sha256').update(image.bytes).digest('hex'));
    const itemHash = itemHashFromImageHashes(imageHashes);
    const existing = existingByHash.get(itemHash);
    if (existing && !metadataOnly) skippedDuplicates += 1;
    if (!existing && metadataOnly) {
      skippedNewMetadata += 1;
      continue;
    }

    const shortHash = itemHash.slice(0, 12);
    const date = extracted.timestamp ? new Date(extracted.timestamp) : new Date();
    const slug = existing?.slug ?? `${date.toISOString().slice(0, 10)}-${shortHash}`;
    const title = `Style Prompt ${shortHash}`;
    const imageRefs = [];

    for (let index = 0; index < parsedImages.length; index += 1) {
      const image = parsedImages[index];
      const imageHash = imageHashes[index];
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
        sourceImage: apiImagePath('source', imageName),
        thumbnailImage: apiImagePath('thumb', thumbnailName),
        sourceImageAlt: `${title} reference image ${index + 1}`,
        imageHash,
      });
    }

    if (!existing || metadataOnly) {
      items.push({
        version: 3,
        slug,
        title,
        date: date.toISOString(),
        sourceImage: imageRefs[0].sourceImage,
        thumbnailImage: imageRefs[0].thumbnailImage,
        sourceImageAlt: imageRefs[0].sourceImageAlt,
        prompt: extracted.prompt,
        ...(extracted.originalPrompt ? { originalPrompt: extracted.originalPrompt } : {}),
        imageHash: itemHash,
        images: imageRefs,
        sourceSession: path.basename(sessionPath),
        sourceLine: extracted.sourceLine,
        examples: [],
      });
    }
  }
  return { assets, items, skippedDuplicates, skippedNewMetadata };
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
      if (attempt === REQUEST_ATTEMPTS) break;
    }
    await sleep(400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
  }
  throw new Error(`Request failed after ${REQUEST_ATTEMPTS} attempts: ${url}`, { cause: lastError });
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
    const prepared = await requestJson(`${apiBaseUrl}/api/style-gallery/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'prepare', keys: chunk.map(([key]) => key) }),
    });
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
    await requestJson(`${apiBaseUrl}/api/style-gallery/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cleanup', keys: chunk }),
    }).catch((error) => console.error(`Cleanup warning: ${error.message}`));
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
  const { apiBaseUrl, help, metadataOnly, sessionPath } = parseArgs(process.argv.slice(2));
  if (help || !sessionPath) {
    usage();
    process.exit(help ? 0 : 1);
  }
  const token = process.env.STYLE_GALLERY_UPLOAD_TOKEN;
  if (!token) throw new Error('STYLE_GALLERY_UPLOAD_TOKEN is required.');
  const absoluteSessionPath = path.resolve(sessionPath);
  const records = await readRecords(absoluteSessionPath);
  const extractedItems = extractItems(records);
  const catalog = await requestJson(`${apiBaseUrl}/api/style-gallery/catalog`, { headers: { accept: 'application/json' } });
  const existingByHash = new Map(catalog.items.map((item) => [item.imageHash, item]));
  const prepared = await buildImportData(extractedItems, absoluteSessionPath, existingByHash, metadataOnly);

  console.log(`Found ${extractedItems.length} image/prompt items.`);
  let uploadedKeys = [];
  try {
    uploadedKeys = await prepareAndUploadAssets(apiBaseUrl, token, prepared.assets);
    let written = 0;
    let apiDuplicates = 0;
    for (const itemChunk of chunks(prepared.items, 100)) {
      const result = await requestJson(`${apiBaseUrl}/api/style-gallery/items`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ mode: metadataOnly ? 'upsert' : 'create', items: itemChunk }),
      });
      written += result.written ?? 0;
      apiDuplicates += result.skippedDuplicates ?? 0;
    }
    console.log(`Uploaded ${uploadedKeys.length} missing image assets with concurrency ${UPLOAD_CONCURRENCY}.`);
    console.log(`${metadataOnly ? 'Updated' : 'Wrote'} ${written} gallery metadata items in HF storage.`);
    console.log(`Skipped ${prepared.skippedDuplicates + apiDuplicates} duplicate image/prompt records.`);
    if (metadataOnly) console.log(`Skipped ${prepared.skippedNewMetadata} new records because --metadata-only was set.`);
  } catch (error) {
    // 元数据未完成时只清理由本轮新增且未被 catalog 引用的资产，既有 HF 对象不会进入该列表。
    await cleanupAssets(apiBaseUrl, token, uploadedKeys);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/*
NODE_OPTIONS=--use-env-proxy \
HTTP_PROXY=http://127.0.0.1:7897 \
HTTPS_PROXY=http://127.0.0.1:7897 \
STYLE_GALLERY_UPLOAD_TOKEN='...' \
STYLE_GALLERY_IMPORT_ATTEMPTS=5 \
npm run import:style-prompts -- <session.jsonl>
*/

/*
完整本地功能启动方式（首次运行及 Vercel Development 环境变量变化后，先执行第一行）：
npm exec --yes --package=node@24 --package=vercel -- vercel env pull .env.local --environment=development --yes
npm exec --yes --package=node@24 --package=pnpm@9.15.1 -- pnpm dev --host 127.0.0.1 --port 4324

Astro 会自动读取被 gitignore 的 .env.local。不要把 Upload Token、HF S3 密钥、GitHub OAuth Secret
或 Session Secret 直接写进本文件；Vercel Development 中配置完整后，上述启动方式会启用全部功能。
*/
