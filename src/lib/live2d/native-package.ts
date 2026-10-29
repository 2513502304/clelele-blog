import { z } from 'zod';

const part = z.union([
  z.tuple([z.string(), z.string(), z.number().int().nonnegative()]),
  z.tuple([z.string(), z.string(), z.number().int().nonnegative(), z.number().int().nonnegative()]),
]);
const member = z.union([
  z.object({ asset: z.string(), size: z.number().int().nonnegative(), stored: z.number().int().nonnegative().optional() }),
  z.object({ parts: z.array(part).min(1), size: z.number().int().nonnegative() }),
]);

/** The published native format includes game shaders and split, compressed prefab JSON. */
export const nativeModelManifestSchema = z
  .object({
    format: z.union([z.literal(2), z.literal(3)]),
    id: z.string().optional(),
    files: z.record(z.string(), member),
  })
  .passthrough();

/** Enumerate each physical object once; split JSON parts are objects too, not optional metadata. */
export function nativeModelAssets(value: unknown): Array<{ path: string; size: number; decodedSize: number }> {
  const manifest = nativeModelManifestSchema.parse(value);
  const assets = new Map<string, { size: number; decodedSize: number }>();
  for (const file of Object.values(manifest.files)) {
    const parts: Array<[string, number, number]> =
      'parts' in file
        ? file.parts.map(([, asset, size, stored]) => [asset, stored ?? size, size])
        : [[file.asset, file.stored ?? file.size, file.size]];
    for (const [path, size, decodedSize] of parts) {
      if (assets.has(path) && (assets.get(path)?.size !== size || assets.get(path)?.decodedSize !== decodedSize))
        throw new Error(`Conflicting native asset sizes: ${path}`);
      assets.set(path, { size, decodedSize });
    }
  }
  return [...assets].map(([path, sizes]) => ({ path, ...sizes }));
}
