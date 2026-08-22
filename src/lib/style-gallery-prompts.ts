import { createHash } from 'node:crypto';
import type { StyleGalleryPromptVariant } from '@/types/style-gallery';

/** 只折叠跨平台换行并去除首尾空白，保留 prompt 内部有意义的排版。 */
export function normalizeStyleGalleryPrompt(prompt: string): string {
  return prompt.replace(/\r\n?/g, '\n').trim();
}

/** 使用规范化全文生成 prompt 的稳定身份，确保 CRLF 与首尾空白不会产生重复候选。 */
export function getStyleGalleryPromptId(prompt: string): string {
  return createHash('sha256').update(normalizeStyleGalleryPrompt(prompt)).digest('hex');
}

/**
 * 为 catalog 中未内联的 prompt 元数据生成稳定修订号。
 * 数量相同但模型、导入时间或正文被修正时，客户端与 CDN 都会改用新的缓存 URL。
 */
export function getStyleGalleryPromptRevision(prompts: readonly StyleGalleryPromptVariant[]): string {
  const canonical = prompts.map(({ id, prompt, model, importedAt }) => ({
    id,
    prompt: normalizeStyleGalleryPrompt(prompt),
    model: model?.trim() || null,
    importedAt,
  }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * 合并 prompt 时以规范化全文去重并保持首次出现顺序。
 * 默认 prompt 因此稳定为数组首项，不会因后续模型重新提取而悄悄改变。
 */
export function mergeStyleGalleryPromptVariants(
  current: readonly StyleGalleryPromptVariant[],
  incoming: readonly StyleGalleryPromptVariant[],
  options: { updateExisting?: boolean } = {},
): { prompts: StyleGalleryPromptVariant[]; added: number; skipped: number } {
  const prompts = [...current];
  const indexByPrompt = new Map(current.map((variant, index) => [normalizeStyleGalleryPrompt(variant.prompt), index] as const));
  let added = 0;
  let skipped = 0;

  for (const variant of incoming) {
    const normalized = normalizeStyleGalleryPrompt(variant.prompt);
    const existingIndex = indexByPrompt.get(normalized);
    if (existingIndex !== undefined) {
      if (options.updateExisting) {
        const existing = prompts[existingIndex];
        prompts[existingIndex] = { ...existing, ...variant, id: existing.id, prompt: existing.prompt };
      }
      skipped += 1;
      continue;
    }
    indexByPrompt.set(normalized, prompts.length);
    prompts.push({ ...variant, id: getStyleGalleryPromptId(normalized), prompt: normalized });
    added += 1;
  }

  return { prompts, added, skipped };
}

export function getPrimaryStyleGalleryPrompt(prompts: readonly StyleGalleryPromptVariant[]): StyleGalleryPromptVariant {
  const primary = prompts[0];
  if (!primary) throw new Error('Style gallery item must contain at least one prompt.');
  return primary;
}
