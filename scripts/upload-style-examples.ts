import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createStyleGallerySignedUploadUrl } from '@lib/hf-s3-presign';
import { mapWithConcurrency } from '@lib/map-with-concurrency';
import {
  parseStyleGalleryExampleUploadArgs,
  resolveStyleGalleryUploadTarget,
  type StyleGalleryExampleUploadCliOptions,
} from '@lib/style-gallery-cli-example-upload';
import { getStyleGalleryExampleObjectKey, MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE } from '@lib/style-gallery-example-upload';
import { getStyleGalleryExampleContentType, getStyleGalleryExampleExtension } from '@lib/style-gallery-image-type';
import {
  chunkStyleGalleryRequestItems,
  STYLE_GALLERY_MUTATION_BATCH_SIZE,
  STYLE_GALLERY_PREPARE_BATCH_SIZE,
} from '@lib/style-gallery-request-batches';
import { styleGalleryCatalogSchema, styleGalleryExampleSchema } from '@lib/style-gallery-schema';
import { z } from 'zod';
import type { StyleGalleryExample } from '@/types/style-gallery';

interface LocalImage {
  contentType: string;
  extension: string;
  imageHash: string;
  name: string;
  path: string;
  size: number;
}

interface PreparedImage {
  duplicate: boolean;
  example: StyleGalleryExample;
  exists: boolean;
  file: LocalImage;
  key: string;
}

interface UploadOutcome {
  prepared: PreparedImage;
  error?: Error;
  uploaded: boolean;
}

interface FileFailure {
  error: Error;
  path: string;
}

class HttpRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

const prepareResponseSchema = z.object({
  uploads: z.array(
    z.object({
      imageHash: z.string().regex(/^[a-f0-9]{64}$/i),
      example: styleGalleryExampleSchema,
      duplicate: z.boolean(),
      exists: z.boolean(),
    }),
  ),
});

const mergeResponseSchema = z.object({
  uploaded: z.number().int().nonnegative().optional(),
  skippedDuplicates: z.number().int().nonnegative().optional(),
});

function usage(): void {
  console.log(`Usage:
  npm run upload:style-examples -- --item <slug-or-short-sha> --platform <platform> [options] <image...>

Required:
  -i, --item <value>       Parent item slug, full SHA-256, or unique SHA prefix
  -p, --platform <value>   GPT-Image2 | Nano Banana | PixAI | Midjourney | Flux

Options:
  -n, --note <text>        Shared note stored on every uploaded example (max 500 chars)
  -c, --concurrency <n>    Concurrent HF uploads (default: 5)
      --attempts <n>       Attempts for each API request and each file (default: 3)
      --timeout-ms <n>     Independent timeout for every attempt (default: 120000)
      --api-base-url <url> Gallery API used for prepare/merge metadata
  -h, --help               Show this help

Environment (automatically loaded from .env.local when present):
  STYLE_GALLERY_UPLOAD_TOKEN, HF_S3_ACCESS_KEY_ID, HF_S3_SECRET_ACCESS_KEY,
  HF_S3_ENDPOINT, HF_S3_BUCKET, STYLE_GALLERY_BUCKET_PREFIX, HF_S3_REGION`);
}

function getBearerHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

function isRetryableNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name));
}

async function requestJson(
  url: string,
  init: RequestInit,
  options: Pick<StyleGalleryExampleUploadCliOptions, 'attempts' | 'timeoutMs'>,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs) });
      if (response.ok) return response.json();
      const detail = await response.text().catch(() => '');
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new HttpRequestError(`${response.status}${detail ? ` ${detail}` : ''}`, retryable);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof HttpRequestError ? error.retryable : isRetryableNetworkError(error);
      if (!retryable || attempt === options.attempts) break;
      await sleep(400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
    }
  }
  throw new Error(`Request failed after ${options.attempts} attempt(s): ${url}`, { cause: lastError });
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

/** 只读取文件元数据并流式计算哈希；图片内容不会整体堆积在 Node.js 内存中。 */
async function inspectLocalImage(filePath: string): Promise<LocalImage> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error(`Not a regular file: ${filePath}`);
  if (fileStat.size < 1 || fileStat.size > MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE) {
    throw new Error(`Image size must be between 1 byte and ${MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE} bytes: ${filePath}`);
  }
  const extension = getStyleGalleryExampleExtension('', filePath);
  return {
    contentType: getStyleGalleryExampleContentType(extension),
    extension,
    imageHash: await hashFile(filePath),
    name: path.basename(filePath),
    path: filePath,
    size: fileStat.size,
  };
}

/**
 * 上传前重新读取并校验实际字节，防止首次哈希后文件被替换却仍写入旧哈希对象名。
 * 只保留当前并发 worker 的文件内容；每次网络重试复用不可变字节，但使用独立签名 URL 和 timeout。
 */
async function uploadImageToHf(
  image: LocalImage,
  key: string,
  options: Pick<StyleGalleryExampleUploadCliOptions, 'attempts' | 'timeoutMs'>,
): Promise<void> {
  const bytes = await readFile(image.path);
  if (bytes.byteLength !== image.size || createHash('sha256').update(bytes).digest('hex') !== image.imageHash) {
    throw new Error('Local file changed after it was prepared. Run the command again.');
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const request: RequestInit = {
        method: 'PUT',
        headers: {
          'content-length': image.size.toString(),
          'content-type': image.contentType,
        },
        body: bytes,
        signal: AbortSignal.timeout(options.timeoutMs),
      };
      const response = await fetch(createStyleGallerySignedUploadUrl(key), request);
      if (response.ok) return;
      const detail = await response.text().catch(() => '');
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new HttpRequestError(`${response.status}${detail ? ` ${detail}` : ''}`, retryable);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof HttpRequestError ? error.retryable : isRetryableNetworkError(error);
      if (!retryable || attempt === options.attempts) break;
      await sleep(500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
    }
  }
  throw new Error(`HF upload failed after ${options.attempts} attempt(s).`, { cause: lastError });
}

async function prepareImages(
  slug: string,
  images: LocalImage[],
  token: string,
  options: StyleGalleryExampleUploadCliOptions,
): Promise<PreparedImage[]> {
  const prepared: PreparedImage[] = [];
  for (const batch of chunkStyleGalleryRequestItems(images, STYLE_GALLERY_PREPARE_BATCH_SIZE)) {
    const raw = await requestJson(
      `${options.apiBaseUrl}/api/style-gallery/examples/${slug}`,
      {
        method: 'POST',
        headers: getBearerHeaders(token),
        body: JSON.stringify({
          action: 'prepare',
          platform: options.platform.slug,
          note: options.note,
          files: batch.map((image) => ({
            name: image.name,
            type: image.contentType,
            size: image.size,
            imageHash: image.imageHash,
          })),
        }),
      },
      options,
    );
    const response = prepareResponseSchema.parse(raw);
    if (response.uploads.length !== batch.length) throw new Error('Prepare response does not match the request batch.');
    for (const [index, upload] of response.uploads.entries()) {
      const file = batch[index];
      const key = getStyleGalleryExampleObjectKey(upload.example);
      const expectedKey = `examples/images/${file.imageHash}.${file.extension}`;
      if (
        upload.imageHash !== file.imageHash ||
        upload.example.imageHash !== file.imageHash ||
        upload.example.model !== options.platform.label ||
        key !== expectedKey
      ) {
        throw new Error(`Prepare response is inconsistent for ${file.name}.`);
      }
      prepared.push({ ...upload, file, key });
    }
  }
  return prepared;
}

async function cleanupFailedUpload(
  slug: string,
  token: string,
  example: StyleGalleryExample,
  options: StyleGalleryExampleUploadCliOptions,
): Promise<void> {
  await requestJson(
    `${options.apiBaseUrl}/api/style-gallery/examples/${slug}`,
    {
      method: 'POST',
      headers: getBearerHeaders(token),
      body: JSON.stringify({ action: 'cleanup', examples: [example] }),
    },
    options,
  );
}

/**
 * 正常路径按 128 条提交；失败路径递归二分，确保单条坏 metadata 不会拖累同批其他成功图片。
 */
async function mergePreparedImages(
  slug: string,
  token: string,
  outcomes: UploadOutcome[],
  options: StyleGalleryExampleUploadCliOptions,
): Promise<{ committed: number; duplicates: number; failures: UploadOutcome[] }> {
  let committed = 0;
  let duplicates = 0;
  const failures: UploadOutcome[] = [];

  async function mergeBatch(batch: UploadOutcome[]): Promise<void> {
    try {
      const raw = await requestJson(
        `${options.apiBaseUrl}/api/style-gallery/examples/${slug}`,
        {
          method: 'POST',
          headers: getBearerHeaders(token),
          body: JSON.stringify({ action: 'merge', examples: batch.map((entry) => entry.prepared.example) }),
        },
        options,
      );
      const response = mergeResponseSchema.parse(raw);
      committed += response.uploaded ?? batch.length;
      duplicates += response.skippedDuplicates ?? 0;
    } catch (error) {
      if (batch.length > 1) {
        const middle = Math.ceil(batch.length / 2);
        await mergeBatch(batch.slice(0, middle));
        await mergeBatch(batch.slice(middle));
        return;
      }
      const [failed] = batch;
      failed.error = error instanceof Error ? error : new Error('Metadata merge failed.');
      failures.push(failed);
      if (failed.uploaded) {
        await cleanupFailedUpload(slug, token, failed.prepared.example, options).catch((cleanupError) => {
          console.warn(
            `Cleanup warning for ${failed.prepared.file.name}: ${cleanupError instanceof Error ? cleanupError.message : cleanupError}`,
          );
        });
      }
    }
  }

  for (const batch of chunkStyleGalleryRequestItems(outcomes, STYLE_GALLERY_MUTATION_BATCH_SIZE)) await mergeBatch(batch);
  return { committed, duplicates, failures };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const options = parseStyleGalleryExampleUploadArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const token = process.env.STYLE_GALLERY_UPLOAD_TOKEN;
  if (!token) throw new Error('STYLE_GALLERY_UPLOAD_TOKEN is required in the environment or .env.local.');
  if (!process.env.HF_S3_ACCESS_KEY_ID || !process.env.HF_S3_SECRET_ACCESS_KEY) {
    throw new Error('HF_S3_ACCESS_KEY_ID and HF_S3_SECRET_ACCESS_KEY are required in the environment or .env.local.');
  }

  const catalogUrl = new URL('/api/style-gallery/catalog', options.apiBaseUrl);
  // catalog 在公网有短 CDN 缓存；命令行写入前使用唯一查询参数，避免刚导入的 item 因旧缓存暂时无法定位。
  catalogUrl.searchParams.set('_', Date.now().toString());
  const catalog = styleGalleryCatalogSchema.parse(
    await requestJson(
      catalogUrl.toString(),
      { cache: 'no-store', headers: { accept: 'application/json', 'cache-control': 'no-cache' } },
      options,
    ),
  );
  const target = resolveStyleGalleryUploadTarget(catalog.items, options.itemSelector);
  console.log(`Target: ${target.slug} (${target.imageHash.slice(0, 12)})`);
  console.log(`Platform: ${options.platform.label}; files: ${options.filePaths.length}; concurrency: ${options.concurrency}`);

  const inspectionResults = await mapWithConcurrency(options.filePaths, options.concurrency, async (filePath) => {
    try {
      return { image: await inspectLocalImage(filePath) };
    } catch (error) {
      return { failure: { path: filePath, error: error instanceof Error ? error : new Error('File validation failed.') } };
    }
  });
  const inspectionFailures = inspectionResults.flatMap((result) => (result.failure ? [result.failure] : []));
  const inspected = inspectionResults.flatMap((result) => (result.image ? [result.image] : []));
  if (!inspected.length) {
    for (const failure of inspectionFailures) console.error(`- ${failure.path}: ${failure.error.message}`);
    process.exitCode = 1;
    return;
  }
  const uniqueByHash = new Map<string, LocalImage>();
  for (const image of inspected) {
    if (!uniqueByHash.has(image.imageHash)) uniqueByHash.set(image.imageHash, image);
  }
  const images = [...uniqueByHash.values()];
  const localDuplicates = inspected.length - images.length;
  const prepared = await prepareImages(target.slug, images, token, options);
  const duplicates = prepared.filter((entry) => entry.duplicate);
  const candidates = prepared.filter((entry) => !entry.duplicate);

  let completed = 0;
  const outcomes = await mapWithConcurrency(candidates, options.concurrency, async (entry): Promise<UploadOutcome> => {
    try {
      if (!entry.exists) await uploadImageToHf(entry.file, entry.key, options);
      completed += 1;
      console.log(`[${completed}/${candidates.length}] ${entry.file.name}: ${entry.exists ? 'reused HF object' : 'uploaded'}`);
      return { prepared: entry, uploaded: !entry.exists };
    } catch (error) {
      completed += 1;
      const normalizedError = error instanceof Error ? error : new Error('Upload failed.');
      console.error(`[${completed}/${candidates.length}] ${entry.file.name}: ${normalizedError.message}`);
      return { prepared: entry, uploaded: false, error: normalizedError };
    }
  });

  const successful = outcomes.filter((outcome) => !outcome.error);
  const uploadFailures = outcomes.filter((outcome) => outcome.error);
  await mapWithConcurrency(
    uploadFailures.filter((outcome) => !outcome.prepared.exists),
    options.concurrency,
    async (outcome) => {
      await cleanupFailedUpload(target.slug, token, outcome.prepared.example, options).catch((cleanupError) => {
        console.warn(
          `Cleanup warning for ${outcome.prepared.file.name}: ${cleanupError instanceof Error ? cleanupError.message : cleanupError}`,
        );
      });
    },
  );
  const merged = successful.length
    ? await mergePreparedImages(target.slug, token, successful, options)
    : { committed: 0, duplicates: 0, failures: [] };
  const allFailures: FileFailure[] = [
    ...inspectionFailures,
    ...uploadFailures.flatMap((failure) => (failure.error ? [{ path: failure.prepared.file.path, error: failure.error }] : [])),
    ...merged.failures.flatMap((failure) =>
      failure.error ? [{ path: failure.prepared.file.path, error: failure.error }] : [],
    ),
  ];
  const skippedDuplicates = localDuplicates + duplicates.length + merged.duplicates;

  console.log(
    `Finished: ${merged.committed} added, ${skippedDuplicates} duplicate${skippedDuplicates === 1 ? '' : 's'} skipped, ${allFailures.length} failed.`,
  );
  for (const failure of allFailures) console.error(`- ${failure.path}: ${failure.error.message}`);
  if (allFailures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

/*
NODE_OPTIONS=--use-env-proxy \
HTTP_PROXY=http://127.0.0.1:7897 \
HTTPS_PROXY=http://127.0.0.1:7897 \
npm run upload:style-examples -- --item 2a256d37220e --platform PixAI /path/to/first.webp /path/to/second.webp
*/
