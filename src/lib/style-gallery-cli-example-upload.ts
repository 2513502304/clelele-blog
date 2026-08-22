import path from 'node:path';
import { parseArgs } from 'node:util';
import { getStyleGalleryPlatform, STYLE_GALLERY_PLATFORMS, type StyleGalleryPlatform } from '@lib/style-gallery-platforms';
import type { StyleGalleryCatalogItem } from '@/types/style-gallery';

const DEFAULT_API_BASE_URL = 'https://clelele-blog.vercel.app';
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface StyleGalleryExampleUploadCliOptions {
  apiBaseUrl: string;
  attempts: number;
  concurrency: number;
  filePaths: string[];
  help: boolean;
  itemSelector: string;
  note?: string;
  platform: StyleGalleryPlatform;
  timeoutMs: number;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function normalizeApiBaseUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('--api-base-url must use HTTP or HTTPS.');
  return url.toString().replace(/\/$/, '');
}

/**
 * 解析本地示例上传参数。密钥只从环境变量读取，不提供命令行参数，避免进入 shell history。
 * `.env.local` 由 package script 在启动时加载。
 */
export function parseStyleGalleryExampleUploadArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): StyleGalleryExampleUploadCliOptions {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      'api-base-url': { type: 'string' },
      attempts: { type: 'string' },
      concurrency: { type: 'string', short: 'c' },
      help: { type: 'boolean', short: 'h' },
      item: { type: 'string', short: 'i' },
      note: { type: 'string', short: 'n' },
      platform: { type: 'string', short: 'p' },
      'timeout-ms': { type: 'string' },
    },
  });

  const help = values.help ?? false;
  const itemSelector = values.item?.trim() ?? '';
  const platform = getStyleGalleryPlatform(values.platform ?? '');
  const note = values.note?.trim() || undefined;

  if (!help) {
    if (!itemSelector) throw new Error('--item is required.');
    if (!platform) {
      throw new Error('--platform must be one of GPT-Image, Nano Banana, PixAI, Midjourney, NovelAI, or Flux.');
    }
    if (!positionals.length) throw new Error('At least one local image path is required.');
    if (note && note.length > 500) throw new Error('--note must contain at most 500 characters.');
  }

  return {
    apiBaseUrl: normalizeApiBaseUrl(values['api-base-url'] ?? env.STYLE_GALLERY_API_BASE_URL ?? DEFAULT_API_BASE_URL),
    attempts: positiveInteger(values.attempts, DEFAULT_ATTEMPTS, '--attempts'),
    concurrency: positiveInteger(values.concurrency, DEFAULT_CONCURRENCY, '--concurrency'),
    filePaths: positionals.map((filePath) => path.resolve(filePath)),
    help,
    itemSelector,
    note,
    platform: platform ?? STYLE_GALLERY_PLATFORMS[0],
    timeoutMs: positiveInteger(values['timeout-ms'], DEFAULT_TIMEOUT_MS, '--timeout-ms'),
  };
}

/**
 * 支持完整 slug、完整 SHA-256 和唯一 SHA 前缀。slug 后缀也参与匹配，兼容页面上展示的 12 位图片 ID。
 */
export function resolveStyleGalleryUploadTarget(
  items: readonly StyleGalleryCatalogItem[],
  selector: string,
): StyleGalleryCatalogItem {
  const normalized = selector.trim().toLowerCase();
  const exactSlug = items.find((item) => item.slug.toLowerCase() === normalized);
  if (exactSlug) return exactSlug;

  if (!/^[a-f0-9]{6,64}$/.test(normalized)) {
    throw new Error(`Unknown item "${selector}". Use a full slug or at least 6 hexadecimal SHA-256 characters.`);
  }

  const matches = items.filter((item) => {
    const hash = item.imageHash.toLowerCase();
    const slug = item.slug.toLowerCase();
    return hash.startsWith(normalized) || slug.endsWith(`-${normalized}`);
  });
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new Error(`No style gallery item matches "${selector}".`);
  throw new Error(`Item selector "${selector}" is ambiguous. Matching slugs: ${matches.map((item) => item.slug).join(', ')}`);
}
