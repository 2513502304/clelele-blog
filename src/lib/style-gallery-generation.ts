import { z } from 'zod';

const text = z.string().min(1).max(100_000);
/** Portable receipt: stable identity + exact inputs, with provider-specific data kept out of list metadata. */
export const generationManifestSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,95}$/),
  source: z.object({ slug: z.string().regex(/^[a-z0-9-]+$/), promptId: z.string().regex(/^[a-f0-9]{64}$/), template: text }),
  character: z.object({ name: z.string().min(1).max(100), tag: z.string().min(1).max(100), traits: text }),
  rewrite: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    request: z.unknown(),
    response: z.unknown(),
    prompt: text,
  }),
  generation: z.object({
    provider: z.enum(['openai', 'pixai', 'codex-imagegen']),
    model: z.string().min(1).max(120),
    taskId: z.string().optional(),
    prompt: text,
    parameters: z.record(z.unknown()),
    request: z.unknown(),
    response: z.unknown(),
  }),
  outputs: z
    .array(
      z.object({
        file: z.string().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        providerIndex: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(4),
  createdAt: z.string().datetime(),
});

/** Only the character name changes between providers; all other adapted prompt text stays identical. */
export function providerPrompt(prompt: string, name: string, tag: string): string {
  if (!prompt.includes(name)) throw new Error('Adapted prompt is missing the character name.');
  if (/\[在此处替换/.test(prompt)) throw new Error('Adapted prompt contains an unresolved placeholder.');
  return prompt.replaceAll(name, tag);
}
