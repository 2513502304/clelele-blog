import anonManifestData from '../../data/live2d/manifests/9e95d66201f07e339bd5542b1dd0d67ae1bd0b0f9b14a7335ca0bad6bd5916ad.json';
import anonSrManifestData from '../../data/live2d/manifests/63efa2f7902818e27ad2c3ec71b3cbcc6c83ee4b4c8c4176b2e7f764422f3e85.json';
import tomoriManifestData from '../../data/live2d/manifests/c282ced11b66f7f30488ba356deab4bffa3e27a734478b929093140b69ffe349.json';
import tomoriSrManifestData from '../../data/live2d/manifests/d5628c18018a77031a8df09e24002c5b76c3de65378464a755b75a52327b56a0.json';
import { assertCostumeMatchesManifest, live2dCatalog } from './catalog';
import { type Live2DManifestObject, type Live2DPackageManifest, live2dPackageManifestSchema } from './types';

/** Vercel 对流式 Function 响应的当前上限为 20 MB；保持常量而非允许环境变量放大。 */
export const LIVE2D_MAX_ASSET_BYTES = 20_000_000;

const packageManifests = [anonManifestData, anonSrManifestData, tomoriManifestData, tomoriSrManifestData].map((manifest) =>
  live2dPackageManifestSchema.parse(manifest),
);
const manifestByRelease = new Map<string, Live2DPackageManifest>(
  packageManifests.map((manifest) => [manifest.releaseId, manifest]),
);

for (const character of live2dCatalog.characters) {
  for (const costume of character.costumes) {
    const manifest = manifestByRelease.get(costume.releaseId);
    if (!manifest) throw new Error(`Live2D catalog release has no checked-in manifest: ${costume.releaseId}`);
    assertCostumeMatchesManifest(costume, manifest);
  }
}

export type Live2DAssetPathErrorCode = 'invalid-path' | 'unknown-release' | 'not-in-manifest' | 'object-too-large';

export class Live2DAssetPathError extends Error {
  constructor(
    readonly code: Live2DAssetPathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'Live2DAssetPathError';
  }
}

export interface Live2DAssetDescriptor extends Live2DManifestObject {
  key: string;
  releaseId: string;
}

function decodePathOnce(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Live2DAssetPathError('invalid-path', 'Live2D asset path contains invalid percent encoding.');
  }
}

function assertSafeSegments(value: string): string[] {
  if (!value || value.includes('\\') || value.includes('\0') || value.includes('?') || value.includes('#')) {
    throw new Live2DAssetPathError('invalid-path', 'Live2D asset path contains a forbidden separator.');
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Live2DAssetPathError('invalid-path', 'Live2D asset path contains an empty or traversal segment.');
  }
  return segments;
}

/**
 * 对路由 key 只解码一次并拒绝任何可改变目录层级的写法。
 * 返回值始终采用 `releases/<sha256>/<manifest path>` 的唯一形式。
 */
export function normalizeLive2DAssetKey(value: string): string {
  const decoded = decodePathOnce(value);
  if (decoded.startsWith('/') || decoded.endsWith('/')) {
    throw new Live2DAssetPathError('invalid-path', 'Live2D asset path must be relative.');
  }
  const segments = assertSafeSegments(decoded);
  if (segments[0] !== 'releases' || !/^[a-f0-9]{64}$/.test(segments[1] ?? '') || segments.length < 3) {
    throw new Live2DAssetPathError('invalid-path', 'Live2D asset path does not use the immutable release layout.');
  }
  return segments.join('/');
}

function normalizeRelativeManifestPath(value: string): string {
  const decoded = decodePathOnce(value).replace(/^\.\//, '');
  if (decoded.startsWith('/') || decoded.endsWith('/')) {
    throw new Live2DAssetPathError('invalid-path', 'Live2D package path must be relative.');
  }
  return assertSafeSegments(decoded).join('/');
}

export function getLive2DPackageManifest(releaseId: string): Live2DPackageManifest | null {
  return manifestByRelease.get(releaseId) ?? null;
}

/** Resolves only exact members of a catalog-backed, checked-in immutable manifest. */
export function resolveLive2DAsset(value: string): Live2DAssetDescriptor {
  const key = normalizeLive2DAssetKey(value);
  const [, releaseId, ...relativeSegments] = key.split('/');
  const manifest = manifestByRelease.get(releaseId);
  if (!manifest) throw new Live2DAssetPathError('unknown-release', 'Unknown Live2D release.');
  const relativePath = relativeSegments.join('/');
  const object = manifest.objects.find((candidate) => candidate.path === relativePath);
  if (!object) throw new Live2DAssetPathError('not-in-manifest', 'Live2D asset is not present in the release manifest.');
  if (object.size > LIVE2D_MAX_ASSET_BYTES) {
    throw new Live2DAssetPathError('object-too-large', 'Live2D asset exceeds the streaming response limit.');
  }
  return { ...object, key, releaseId };
}

export function resolveLive2DPackageAsset(releaseId: string, relativePath: string): Live2DAssetDescriptor {
  return resolveLive2DAsset(`releases/${releaseId}/${normalizeRelativeManifestPath(relativePath)}`);
}

export function encodeLive2DAssetKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
