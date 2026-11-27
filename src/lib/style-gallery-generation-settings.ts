import { z } from 'zod';

export const openAIModels = [
  'gpt-image-2.6-sunburst',
  'gpt-image-2.6-flare',
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare',
  'gpt-image-2',
  'gpt-image-1.5',
  'gpt-image-1-mini',
] as const;
export const openAISizes = [
  '1024x1024',
  '1024x1536',
  '1536x1024',
  'auto',
  '1536x864',
  '864x1536',
  '2048x2048',
  '2560x1440',
  '3840x2160',
  '2160x3840',
] as const;
export const openAIQualities = ['low', 'medium', 'high', 'auto', 'xhigh', 'max'] as const;
export const pixAIModels = ['Tsubaki.3', 'Tsubaki.2'] as const;
export const pixAIVersions = { 'Tsubaki.3': '2024383379556065549', 'Tsubaki.2': '1983308862240288769' };
export const pixAISizes = ['1k', '1.5k'] as const;
export const pixAIRatios = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '3:5', '5:3', '1:3', '3:1'] as const;
export const pixAIModes = ['pro', 'ultra', 'standard', 'lite'] as const;
export const outputFormats = ['png', 'jpeg', 'webp'] as const;
export const backgrounds = ['auto', 'opaque', 'transparent'] as const;
export const imageCounts = [1, 2, 3, 4] as const;
export function sizesFor(model: string) {
  return model.startsWith('gpt-image-1') ? openAISizes.slice(0, 4) : openAISizes;
}
export function qualitiesFor(model: string) {
  return /^gpt-image-2[.]/.test(model) ? openAIQualities : openAIQualities.slice(0, 4);
}
export function backgroundsFor(model: string, format: string) {
  return model === 'gpt-image-2' || format === 'jpeg' ? backgrounds.slice(0, 2) : backgrounds;
}
export function modesFor(model: string) {
  return model === 'Tsubaki.2' ? pixAIModes : pixAIModes.slice(0, 2);
}
export function acceptsNegative(mode: string) {
  return mode === 'pro' || mode === 'ultra';
}

export const generationSettings = z
  .discriminatedUnion('platform', [
    z.object({
      platform: z.literal('gpt-image'),
      model: z.enum(openAIModels),
      size: z.enum(openAISizes),
      quality: z.enum(openAIQualities),
      format: z.enum(outputFormats).optional(),
      compression: z.number().int().min(0).max(100).optional(),
      background: z.enum(backgrounds).optional(),
      count: z.number().int().min(1).max(4).optional(),
      referenceHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    }),
    z.object({
      platform: z.literal('pixai'),
      model: z.enum(pixAIModels),
      size: z.enum(pixAISizes),
      ratio: z.enum(pixAIRatios),
      mode: z.enum(pixAIModes),
      count: z.union([z.literal(1), z.literal(4)]).optional(),
      seed: z.number().int().min(0).max(4294967295).optional(),
      negativePrompt: z.string().max(32000).optional(),
      helper: z.enum(['disable', 'enable', 'low', 'medium']).optional(),
      contextImages: z
        .array(z.string().regex(/^[0-9]{1,24}$/))
        .max(3)
        .optional(),
    }),
  ])
  .refine(
    (s) =>
      s.platform === 'gpt-image'
        ? sizesFor(s.model).includes(s.size) &&
          qualitiesFor(s.model).includes(s.quality) &&
          backgroundsFor(s.model, s.format ?? 'png').includes(s.background ?? 'auto') &&
          ((s.format ?? 'png') !== 'png' || s.compression === undefined)
        : modesFor(s.model).includes(s.mode) &&
          (s.model === 'Tsubaki.3' || !s.contextImages?.length) &&
          (acceptsNegative(s.mode) || !s.negativePrompt),
    'Settings are incompatible with this model or output format.',
  );
export type GenerationSettings = z.infer<typeof generationSettings>;
export type GenerationPlatform = GenerationSettings['platform'];
export const generationRequest = z.object({
  id: z.string().uuid(),
  prompt: z
    .string()
    .min(1)
    .max(32000)
    .refine((value) => Boolean(value.trim())),
  settings: generationSettings,
});
export type GenerationRequest = z.infer<typeof generationRequest>;
export interface GenerationJob extends GenerationRequest {
  created: string;
  state: 'running' | 'ready' | 'saved' | 'failed' | 'uncertain';
  available?: number[];
  published?: number[];
  /** Per-output decisions survive retries and concurrent actions in other tabs. */
  publishing?: number[];
  discarded?: number[];
  taskId?: string;
  error?: string;
}
export function defaultSettings(platform: GenerationPlatform): GenerationSettings {
  return platform === 'pixai'
    ? { platform, model: 'Tsubaki.3', size: '1k', ratio: '1:1', mode: 'pro' }
    : { platform, model: openAIModels[0], size: 'auto', quality: 'high' };
}

/** Exact submitted settings for receipts and sub-gallery captions, in provider terminology. */
export function generationCaption(s: GenerationSettings): string {
  return [s.model, s.size, ...(s.platform === 'pixai' ? [s.ratio, s.mode] : [s.quality])].join(' · ');
}

/** Earlier single-image receipts predate explicit output indices. */
export function receivedOutputs(job: GenerationJob) {
  return job.available ?? (job.state === 'ready' || job.state === 'saved' ? [0] : []);
}
export function availableOutputs(job: GenerationJob) {
  return receivedOutputs(job).filter((i) => !job.discarded?.includes(i));
}
export function publishedOutputs(job: GenerationJob) {
  return job.published ?? (job.state === 'saved' ? [0] : []);
}
