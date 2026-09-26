import { z } from 'zod';

const text = z.string().min(1).max(100_000);
// Retain provider-specific fields, but never seal an empty/null payload into immutable provenance.
const rawPayload = z.union([
  z.record(z.unknown()).refine((value) => Object.keys(value).length > 0, 'Raw payload must not be empty.'),
  z.array(z.unknown()).min(1),
]);
/** Portable receipt: stable identity + exact inputs, with provider-specific data kept out of list metadata. */
export const generationManifestSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,95}$/),
  source: z.object({ slug: z.string().regex(/^[a-z0-9-]+$/), promptId: z.string().regex(/^[a-f0-9]{64}$/), template: text }),
  character: z.object({ name: z.string().min(1).max(100), tag: z.string().min(1).max(100), traits: text }),
  rewrite: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    // Validate without reshaping provider JSON: immutable receipts preserve raw field order too.
    request: z
      .record(z.unknown())
      .refine(
        (value) =>
          Array.isArray(value.messages) &&
          value.messages.length > 0 &&
          value.messages.every(
            (message) => message && typeof message.role === 'string' && message.role.length > 0 && message.content != null,
          ),
        'Rewrite request must retain role-bearing messages.',
      ),
    response: rawPayload,
    prompt: text,
  }),
  generation: z.object({
    provider: z.enum(['openai', 'pixai', 'codex-imagegen']),
    model: z.string().min(1).max(120),
    taskId: z.string().optional(),
    prompt: text,
    parameters: z.record(z.unknown()),
    request: rawPayload,
    response: rawPayload,
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
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Latin names need word boundaries; CJK names can directly precede Chinese prose.
  const expression = /[A-Za-z]/.test(name)
    ? new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'g')
    : new RegExp(escaped, 'g');
  if (!expression.test(prompt)) throw new Error('Adapted prompt is missing a complete character name.');
  expression.lastIndex = 0;
  return prompt.replace(expression, () => tag);
}
