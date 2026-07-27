import catalogData from '../../data/live2d/catalog.json';
import { type Live2DCatalog, type Live2DCostume, type Live2DPackageManifest, live2dCatalogSchema } from './types';

export const live2dCatalog: Live2DCatalog = live2dCatalogSchema.parse(catalogData);

export function findLive2DCostume(characterId: string, costumeId: string): Live2DCostume | null {
  const character = live2dCatalog.characters.find((candidate) => candidate.id === characterId);
  return character?.costumes.find((candidate) => candidate.id === costumeId) ?? null;
}

/** Ensures catalog metadata cannot drift from the immutable package manifest it names. */
export function assertCostumeMatchesManifest(costume: Live2DCostume, manifest: Live2DPackageManifest): void {
  if (costume.releaseId !== manifest.releaseId) throw new Error(`Release mismatch for costume ${costume.id}.`);
  if (costume.entryPath !== getLive2DObjectKey(manifest.releaseId, manifest.entryPath)) {
    throw new Error(`Entry path mismatch for costume ${costume.id}.`);
  }
  if (costume.packageBytes !== manifest.totalBytes) throw new Error(`Package size mismatch for costume ${costume.id}.`);
  if (!manifest.objects.some((object) => object.path === manifest.entryPath)) {
    throw new Error(`Entry path is not present in manifest for costume ${costume.id}.`);
  }
}

export function getLive2DObjectKey(releaseId: string, relativePath: string): string {
  return `releases/${releaseId}/${relativePath}`;
}
