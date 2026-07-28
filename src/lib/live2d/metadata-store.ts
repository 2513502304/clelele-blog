import { createHfS3Client, type HfS3Config, type HfS3ObjectSnapshot } from '../hf-s3';
import { getLive2DPackageManifest, Live2DAssetPathError } from './asset-registry';
import { live2dCatalog } from './catalog';
import { assertLive2DManifestReleaseId } from './package-manifest';
import { type Live2DCatalog, type Live2DPackageManifest, live2dCatalogSchema, live2dPackageManifestSchema } from './types';

export const LIVE2D_CATALOG_KEY = 'catalog.json';
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CATALOG_BYTES = 5_000_000;
const MAX_MANIFEST_BYTES = 1_000_000;
const MAX_MANIFEST_CACHE_ENTRIES = 64;

interface MetadataClient {
  get(key: string, missingStatuses?: readonly number[]): Promise<HfS3ObjectSnapshot | null>;
}

export interface Live2DMetadataStoreOptions {
  client: MetadataClient;
  bootstrapCatalog?: Live2DCatalog;
  now?: () => number;
  catalogTtlMs?: number;
  manifestCacheEntries?: number;
  onDiagnostic?: (message: string, error: unknown) => void;
}

function parseJsonSnapshot<T>(
  snapshot: HfS3ObjectSnapshot,
  maximumBytes: number,
  label: string,
  parse: (value: unknown) => T,
): T {
  if (snapshot.bytes.byteLength > maximumBytes) throw new Error(`${label} exceeds its metadata size limit.`);
  return parse(JSON.parse(new TextDecoder().decode(snapshot.bytes)));
}

function releaseExists(catalog: Live2DCatalog, releaseId: string): boolean {
  return catalog.characters.some(
    (character) =>
      character.voice?.releaseId === releaseId || character.costumes.some((costume) => costume.releaseId === releaseId),
  );
}

/**
 * HF 只保存可变目录和不可变 manifest；模型二进制仍由资产路由按 manifest 精确放行。
 * 目录失败时保留最近一次成功快照，冷启动失败则退回仓库内 bootstrap，避免整个组件消失。
 */
export function createLive2DMetadataStore(options: Live2DMetadataStoreOptions) {
  const now = options.now ?? Date.now;
  const catalogTtlMs = options.catalogTtlMs ?? CATALOG_CACHE_TTL_MS;
  const manifestCacheEntries = options.manifestCacheEntries ?? MAX_MANIFEST_CACHE_ENTRIES;
  if (!Number.isInteger(manifestCacheEntries) || manifestCacheEntries < 1) {
    throw new Error('Live2D manifest cache size must be a positive integer.');
  }
  const bootstrapCatalog = options.bootstrapCatalog ?? live2dCatalog;
  let catalogCache: {
    value: Live2DCatalog;
    expiresAt: number;
    remote: boolean;
  } | null = null;
  let catalogRequest: Promise<Live2DCatalog> | null = null;
  const manifestCache = new Map<string, Live2DPackageManifest>();
  const manifestRequests = new Map<string, Promise<Live2DPackageManifest>>();

  const cacheManifest = (releaseId: string, manifest: Live2DPackageManifest) => {
    manifestCache.delete(releaseId);
    manifestCache.set(releaseId, manifest);
    while (manifestCache.size > manifestCacheEntries) {
      manifestCache.delete(manifestCache.keys().next().value as string);
    }
    return manifest;
  };

  async function readRemoteCatalog(): Promise<Live2DCatalog> {
    const snapshot = await options.client.get(LIVE2D_CATALOG_KEY);
    if (!snapshot) throw new Error('Live2D remote catalog does not exist.');
    return parseJsonSnapshot(snapshot, MAX_CATALOG_BYTES, 'Live2D catalog', (value) => live2dCatalogSchema.parse(value));
  }

  async function getCatalog(): Promise<Live2DCatalog> {
    if (catalogCache && catalogCache.expiresAt > now()) return catalogCache.value;
    if (!catalogRequest) {
      catalogRequest = readRemoteCatalog()
        .then((value) => {
          catalogCache = {
            value,
            expiresAt: now() + catalogTtlMs,
            remote: true,
          };
          return value;
        })
        .catch(() => {
          if (catalogCache) return catalogCache.value;
          catalogCache = {
            value: bootstrapCatalog,
            expiresAt: now() + Math.min(catalogTtlMs, 60_000),
            remote: false,
          };
          return bootstrapCatalog;
        })
        .finally(() => {
          catalogRequest = null;
        });
    }
    return catalogRequest;
  }

  async function getManifest(releaseId: string): Promise<Live2DPackageManifest> {
    const cached = manifestCache.get(releaseId);
    if (cached) return cacheManifest(releaseId, cached);
    const pending = manifestRequests.get(releaseId);
    if (pending) return pending;

    const request = (async () => {
      const catalog = await getCatalog();
      const bootstrap = getLive2DPackageManifest(releaseId);
      if (!releaseExists(catalog, releaseId) && !bootstrap) {
        throw new Live2DAssetPathError('unknown-release', 'Unknown Live2D release.');
      }
      let snapshot: HfS3ObjectSnapshot | null;
      try {
        snapshot = await options.client.get(`manifests/${releaseId}.json`);
      } catch (error) {
        if (bootstrap) return cacheManifest(releaseId, bootstrap);
        throw error;
      }
      if (!snapshot) {
        if (bootstrap) return cacheManifest(releaseId, bootstrap);
        throw new Error(`Live2D manifest is missing for release ${releaseId}.`);
      }
      try {
        const manifest = parseJsonSnapshot(snapshot, MAX_MANIFEST_BYTES, 'Live2D manifest', (value) =>
          live2dPackageManifestSchema.parse(value),
        );
        if (manifest.releaseId !== releaseId) throw new Error(`Live2D manifest key does not match release ${releaseId}.`);
        assertLive2DManifestReleaseId(manifest);
        return cacheManifest(releaseId, manifest);
      } catch (error) {
        if (bootstrap) {
          const message = `Remote Live2D manifest integrity check failed for release ${releaseId}; using bootstrap metadata.`;
          if (options.onDiagnostic) options.onDiagnostic(message, error);
          else console.error(`[Live2D] ${message}`, error);
          return cacheManifest(releaseId, bootstrap);
        }
        throw error;
      }
    })().finally(() => {
      manifestRequests.delete(releaseId);
    });
    manifestRequests.set(releaseId, request);
    return request;
  }

  return { getCatalog, getManifest };
}

export function createLive2DRemoteMetadataStore(config: () => HfS3Config) {
  const store = createLive2DMetadataStore({
    client: {
      get(key, missingStatuses) {
        // 凭证按请求读取，使冷启动缺失凭证也能由 metadata store 回退到 bootstrap。
        return createHfS3Client(config(), {
          attempts: 3,
          transferTimeoutMs: 20_000,
        }).get(key, missingStatuses);
      },
    },
  });
  return {
    getCatalog: store.getCatalog,
    getManifest: store.getManifest,
  };
}
