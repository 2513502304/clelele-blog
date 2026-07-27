import { z } from 'zod';

export const live2dDialogueSchema = z.object({
  text: z.string().min(1),
  audio: z.string().min(1).optional(),
});

export const live2dInteractionSchema = z
  .object({
    area: z.string().min(1),
    motionGroup: z.string().min(1).optional(),
    motionIndex: z.number().int().nonnegative().optional(),
    expression: z.string().min(1).optional(),
    // lines/audio 保留为旧 catalog 的兼容格式；新发布数据使用一一对应的 dialogues。
    lines: z.array(z.string().min(1)).min(1).optional(),
    audio: z.string().min(1).optional(),
    dialogues: z.array(live2dDialogueSchema).min(1).optional(),
  })
  .refine((value) => value.lines !== undefined || value.dialogues !== undefined, {
    message: 'Live2D interaction requires lines or dialogues.',
  });

export const live2dCostumeSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  label: z.record(z.string(), z.string().min(1)),
  releaseId: z.string().regex(/^[a-f0-9]{64}$/),
  entryPath: z.string().min(1),
  packageBytes: z.number().int().positive(),
  scale: z.number().positive(),
  position: z.tuple([z.number(), z.number()]),
  interactions: z.array(live2dInteractionSchema),
  provenancePath: z.string().min(1),
});

export const live2dCharacterSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  label: z.record(z.string(), z.string().min(1)),
  costumes: z.array(live2dCostumeSchema).min(1),
});

export const live2dCatalogSchema = z.object({
  version: z.literal(1),
  characters: z.array(live2dCharacterSchema),
});

export type Live2DInteraction = z.infer<typeof live2dInteractionSchema>;
export type Live2DDialogue = z.infer<typeof live2dDialogueSchema>;
export type Live2DCostume = z.infer<typeof live2dCostumeSchema>;
export type Live2DCharacter = z.infer<typeof live2dCharacterSchema>;
export type Live2DCatalog = z.infer<typeof live2dCatalogSchema>;

export const live2dManifestObjectSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  mime: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const live2dPackageManifestSchema = z.object({
  version: z.literal(1),
  releaseId: z.string().regex(/^[a-f0-9]{64}$/),
  entryPath: z.string().min(1),
  totalBytes: z.number().int().positive(),
  objects: z.array(live2dManifestObjectSchema).min(1),
});

export type Live2DManifestObject = z.infer<typeof live2dManifestObjectSchema>;
export type Live2DPackageManifest = z.infer<typeof live2dPackageManifestSchema>;

export const live2dProvenanceSchema = z.object({
  version: z.literal(1),
  releaseId: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.object({
    url: z.string().url(),
    revision: z.string().min(1),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    acquiredAt: z.string().datetime(),
  }),
  converter: z.object({
    repository: z.string().url(),
    commit: z.string().min(1),
    version: z.string().min(1).optional(),
    options: z.record(z.string(), z.unknown()).default({}),
  }),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  licenseReferences: z.array(z.string().url()).min(1),
  publisher: z.string().min(1),
  publishedAt: z.string().datetime(),
});

export type Live2DProvenance = z.infer<typeof live2dProvenanceSchema>;
