interface PromptWithModel {
  id: string;
  model?: string;
}

export interface StyleGalleryPromptGroup<T extends PromptWithModel> {
  model?: string;
  prompts: Array<{ prompt: T; modelIndex: number }>;
}

/**
 * 按模型首次出现顺序分组，并为同模型内的 prompt 独立编号。
 * 未知模型统一进入一个分组，避免候选增多后平铺成难以辨认的长列表。
 */
export function groupStyleGalleryPromptsByModel<T extends PromptWithModel>(
  prompts: readonly T[],
): StyleGalleryPromptGroup<T>[] {
  const groups = new Map<string, StyleGalleryPromptGroup<T>>();
  for (const prompt of prompts) {
    const model = prompt.model?.trim() || undefined;
    const key = model ?? '';
    let group = groups.get(key);
    if (!group) {
      group = { model, prompts: [] };
      groups.set(key, group);
    }
    group.prompts.push({ prompt, modelIndex: group.prompts.length + 1 });
  }
  return [...groups.values()];
}
