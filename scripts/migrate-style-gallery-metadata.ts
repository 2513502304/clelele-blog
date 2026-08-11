import { getStyleGalleryObjectTextSnapshot, putStyleGalleryObject, StyleGalleryObjectConflictError } from '@lib/hf-s3-presign';
import { mapWithConcurrency } from '@lib/map-with-concurrency';
import { styleGalleryCatalogSchema, styleGalleryItemSchema, toStyleGalleryCatalogItem } from '@lib/style-gallery-schema';
import { getStyleGalleryItemKey, STYLE_GALLERY_CATALOG_KEY } from '@lib/style-gallery-store';
import type { StoredStyleGalleryItem, StyleGalleryCatalog } from '@/types/style-gallery';
import { configureEnvironmentProxy } from './lib/environment-proxy.mjs';

interface MigrationOptions {
  attempts: number;
  concurrency: number;
  dryRun: boolean;
  model: string;
  timeoutMs: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv: string[]): MigrationOptions {
  const options: MigrationOptions = {
    attempts: 5,
    concurrency: 16,
    dryRun: true,
    model: 'gpt-5.6-terra',
    timeoutMs: 60_000,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--apply') options.dryRun = false;
    else if (arg.startsWith('--model=')) options.model = arg.slice('--model='.length).trim();
    else if (arg.startsWith('--concurrency=')) options.concurrency = positiveInteger(arg.slice('--concurrency='.length), 16);
    else if (arg.startsWith('--attempts=')) options.attempts = positiveInteger(arg.slice('--attempts='.length), 5);
    else if (arg.startsWith('--timeout-ms=')) options.timeoutMs = positiveInteger(arg.slice('--timeout-ms='.length), 60_000);
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: npm run migrate:style-gallery-metadata -- [--dry-run|--apply] [--model=gpt-5.6-terra] [--concurrency=16] [--attempts=5] [--timeout-ms=60000]',
      );
      process.exit(0);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.model) throw new Error('--model must not be empty.');
  return options;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry<T>(label: string, attempts: number, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempt(s).`, { cause: lastError });
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

async function migrateItem(
  slug: string,
  options: MigrationOptions,
): Promise<{ changed: boolean; item: StoredStyleGalleryItem }> {
  return retry(`Migrate ${slug}`, options.attempts, async () => {
    const key = getStyleGalleryItemKey(slug);
    const snapshot = await getStyleGalleryObjectTextSnapshot(key, options.timeoutMs);
    if (!snapshot.text) throw new Error(`Missing item metadata: ${slug}`);
    if (!snapshot.etag) throw new Error(`HF did not return an ETag for ${slug}.`);
    const raw = JSON.parse(snapshot.text) as { version?: unknown };
    const parsed = styleGalleryItemSchema.parse(raw);
    const item = styleGalleryItemSchema.parse({
      ...parsed,
      prompts: parsed.prompts.map((prompt) => ({ ...prompt, model: prompt.model ?? options.model })),
    });
    const changed = raw.version !== 4 || parsed.prompts.some((prompt) => !prompt.model);
    if (changed && !options.dryRun) {
      try {
        await putStyleGalleryObject(key, encodeJson(item), 'application/json; charset=utf-8', { ifMatch: snapshot.etag });
      } catch (error) {
        if (error instanceof StyleGalleryObjectConflictError) throw error;
        throw error;
      }
    }
    return { changed, item };
  });
}

async function main(): Promise<void> {
  configureEnvironmentProxy();
  const options = parseArgs(process.argv.slice(2));
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const catalogSnapshot = await getStyleGalleryObjectTextSnapshot(STYLE_GALLERY_CATALOG_KEY, options.timeoutMs);
      if (!catalogSnapshot.text || !catalogSnapshot.etag) throw new Error('HF catalog metadata or ETag is missing.');
      const rawCatalog = JSON.parse(catalogSnapshot.text) as { version?: unknown };
      const catalog = styleGalleryCatalogSchema.parse(rawCatalog);
      let completed = 0;
      let changed = 0;

      const migrated = await mapWithConcurrency(catalog.items, options.concurrency, async (entry) => {
        const result = await migrateItem(entry.slug, options);
        completed += 1;
        if (result.changed) changed += 1;
        if (completed % 50 === 0 || completed === catalog.items.length) {
          console.log(`Processed ${completed}/${catalog.items.length} item(s); ${changed} require migration.`);
        }
        return result.item;
      });

      const nextCatalog: StyleGalleryCatalog = {
        version: 4,
        updatedAt: new Date().toISOString(),
        tags: catalog.tags,
        modelTargets: catalog.modelTargets,
        items: migrated.map((item, index) => toStyleGalleryCatalogItem(item, catalog.items[index].exampleCount)),
      };
      const catalogChanged = rawCatalog.version !== 4 || JSON.stringify(catalog) !== JSON.stringify(nextCatalog);
      if (catalogChanged && !options.dryRun) {
        await putStyleGalleryObject(STYLE_GALLERY_CATALOG_KEY, encodeJson(nextCatalog), 'application/json; charset=utf-8', {
          ifMatch: catalogSnapshot.etag,
        });
      }

      console.log(
        `${options.dryRun ? 'Dry run complete' : 'Migration complete'}: ${changed}/${catalog.items.length} item(s), catalog ${catalogChanged ? 'updated' : 'unchanged'}, default model ${options.model}.`,
      );
      return;
    } catch (error) {
      if (options.dryRun || !(error instanceof StyleGalleryObjectConflictError) || attempt === options.attempts) throw error;
      console.warn(`Catalog changed during migration; rebuilding from the latest snapshot (${attempt}/${options.attempts}).`);
      await sleep(250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/*
# 必须先部署能够同时读取 v3/v4 的新版站点，再使用 --apply；省略 --apply 时默认只执行 dry-run。
NODE_OPTIONS=--use-env-proxy \
HTTP_PROXY=http://127.0.0.1:7897 \
HTTPS_PROXY=http://127.0.0.1:7897 \
HF_S3_ACCESS_KEY_ID=$(aws configure get aws_access_key_id --profile hf) \
HF_S3_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key --profile hf) \
npm run migrate:style-gallery-metadata -- --apply --model=gpt-5.6-terra --concurrency=16 --attempts=5 --timeout-ms=60000
*/
