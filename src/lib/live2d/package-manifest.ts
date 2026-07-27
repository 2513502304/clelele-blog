import { createHash } from 'node:crypto';
import { lstat, open, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { type Live2DManifestObject, type Live2DPackageManifest, live2dPackageManifestSchema } from './types';

const MIME_BY_EXTENSION: Record<string, string> = {
  '.json': 'application/json',
  '.moc': 'application/octet-stream',
  '.mtn': 'application/octet-stream',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

const REFERENCE_KEYS = new Set(['model', 'physics', 'pose', 'file']);

export interface BuildLive2DManifestOptions {
  entryPath?: string;
  approvedAudio?: ReadonlySet<string>;
}

function normalizeRelativePath(value: string): string {
  if (value.includes('\\')) throw new Error(`Backslashes are not allowed in package paths: ${value}`);
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('/') || value.startsWith('//')) {
    throw new Error(`External or absolute package path is not allowed: ${value}`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`Package path escapes its root: ${value}`);
  }
  return normalized.replace(/^\.\//, '');
}

function addReference(references: Map<string, string>, value: string): void {
  const normalized = normalizeRelativePath(value);
  const previous = references.get(normalized);
  if (previous !== undefined && previous !== value) {
    throw new Error(`Duplicate package paths after normalization: ${previous} and ${value}`);
  }
  references.set(normalized, value);
}

function collectReferences(value: unknown, references: Map<string, string>, parentKey = ''): void {
  if (typeof value === 'string') {
    if (REFERENCE_KEYS.has(parentKey) || parentKey === 'textures') addReference(references, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, references, parentKey);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) collectReferences(child, references, key.toLowerCase());
}

/** Always removes core sound bindings; approved audio is packaged separately for catalog interactions. */
function stripCoreAudio(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stripCoreAudio(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      if (key.toLowerCase() === 'sound') return [];
      return [[key, stripCoreAudio(child)]];
    }),
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 根据规范化后的入口与有序对象元数据计算稳定 releaseId。 */
export function calculateLive2DReleaseId(entryPath: string, objects: readonly Live2DManifestObject[]): string {
  const normalizedEntryPath = normalizeRelativePath(entryPath);
  const normalizedObjects = objects.map((object) => ({ ...object, path: normalizeRelativePath(object.path) }));
  normalizedObjects.sort((left, right) => left.path.localeCompare(right.path));

  for (let index = 1; index < normalizedObjects.length; index += 1) {
    if (normalizedObjects[index - 1].path === normalizedObjects[index].path) {
      throw new Error(`Duplicate package path after normalization: ${normalizedObjects[index].path}`);
    }
  }

  return sha256(stableJson({ entryPath: normalizedEntryPath, objects: normalizedObjects }));
}

/** 校验 manifest 声明的 releaseId 确实由其不可变内容计算得到。 */
export function assertLive2DManifestReleaseId(manifest: Live2DPackageManifest): void {
  const expectedReleaseId = calculateLive2DReleaseId(manifest.entryPath, manifest.objects);
  if (manifest.releaseId !== expectedReleaseId) {
    throw new Error(`Manifest releaseId mismatch: expected ${expectedReleaseId}, received ${manifest.releaseId}.`);
  }
}

async function assertRegularContainedFile(rootRealPath: string, absolutePath: string): Promise<void> {
  const stat = await lstat(absolutePath);
  if (!stat.isFile()) throw new Error(`Package member is not a regular file: ${absolutePath}`);
  if (stat.isSymbolicLink()) throw new Error(`Package member is a symbolic link: ${absolutePath}`);
  if (stat.nlink !== 1) throw new Error(`Package member has multiple hard links: ${absolutePath}`);
  const memberRealPath = await realpath(absolutePath);
  if (memberRealPath !== rootRealPath && !memberRealPath.startsWith(`${rootRealPath}${path.sep}`)) {
    throw new Error(`Package member resolves outside its root: ${absolutePath}`);
  }
}

async function readNoFollow(absolutePath: string): Promise<Uint8Array> {
  const flags =
    process.platform === 'win32'
      ? 'r'
      : (await import('node:constants')).O_RDONLY | (await import('node:constants')).O_NOFOLLOW;
  const handle = await open(absolutePath, flags);
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(relativeDirectory: string): Promise<void> {
    const entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory.split(path.sep).join('/'), entry.name);
      if (entry.isDirectory()) await visit(relativePath);
      else files.push(relativePath);
    }
  }
  await visit('');
  return files;
}

/** Builds a deterministic manifest from a converted Cubism 2 package without mutating the source directory. */
export async function buildLive2DPackageManifest(
  packageRoot: string,
  options: BuildLive2DManifestOptions = {},
): Promise<{ manifest: Live2DPackageManifest; transformedFiles: Map<string, Uint8Array> }> {
  const rootRealPath = await realpath(packageRoot);
  const entryPath = normalizeRelativePath(options.entryPath ?? 'model.json');
  const approvedAudio = new Set([...(options.approvedAudio ?? [])].map(normalizeRelativePath));
  const sourceEntry = JSON.parse(await readFile(path.join(rootRealPath, entryPath), 'utf8')) as unknown;
  const references = new Map<string, string>();
  collectReferences(sourceEntry, references);
  addReference(references, entryPath);
  // Approval controls package inclusion only; model-level sound bindings are always stripped below.
  for (const audioPath of approvedAudio) addReference(references, audioPath);

  const availableFiles = await listFiles(rootRealPath);
  const caseFolded = new Map<string, string>();
  for (const relativePath of availableFiles) {
    const normalized = normalizeRelativePath(relativePath);
    const folded = normalized.toLocaleLowerCase('en-US');
    const previous = caseFolded.get(folded);
    if (previous && previous !== normalized) throw new Error(`Case-colliding package paths: ${previous} and ${normalized}`);
    caseFolded.set(folded, normalized);
  }

  const transformedFiles = new Map<string, Uint8Array>();
  const objects: Live2DManifestObject[] = [];
  const sanitizedEntry = new TextEncoder().encode(`${JSON.stringify(stripCoreAudio(sourceEntry), null, 2)}\n`);
  for (const relativePath of [...references.keys()].sort((left, right) => left.localeCompare(right))) {
    const absolutePath = path.join(rootRealPath, ...relativePath.split('/'));
    await assertRegularContainedFile(rootRealPath, absolutePath);
    const extension = path.extname(relativePath).toLowerCase();
    const mime = MIME_BY_EXTENSION[extension];
    if (!mime) throw new Error(`Unsupported package file type: ${relativePath}`);
    const bytes = relativePath === entryPath ? sanitizedEntry : await readNoFollow(absolutePath);
    transformedFiles.set(relativePath, bytes);
    objects.push({ path: relativePath, size: bytes.byteLength, mime, sha256: sha256(bytes) });
  }

  const releaseId = calculateLive2DReleaseId(entryPath, objects);
  const manifest = live2dPackageManifestSchema.parse({
    version: 1,
    releaseId,
    entryPath,
    totalBytes: objects.reduce((total, object) => total + object.size, 0),
    objects,
  });
  return { manifest, transformedFiles };
}

export function serializeLive2DManifest(manifest: Live2DPackageManifest): string {
  const parsed = live2dPackageManifestSchema.parse(manifest);
  assertLive2DManifestReleaseId(parsed);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}
