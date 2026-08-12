interface PromptWithModel {
  id: string;
  model?: string;
}

export interface StyleGalleryPromptGroup<T extends PromptWithModel> {
  model?: string;
  prompts: Array<{ prompt: T; modelIndex: number }>;
}

export interface StyleGalleryPromptDisclosureState {
  expandedModels: Set<string>;
  expandedPromptIds: Set<string>;
}

/** 将 catalog 中的 prompt 版本纳入客户端缓存键，避免同一图片新增 prompt 后继续复用旧响应。 */
export function getStyleGalleryPromptCacheKey(slug: string, promptCount: number): string {
  return `${slug}:${promptCount}`;
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

/**
 * 切换模型分组时重置该组内部状态：展开后直接显示首个 prompt，折叠后清除该组的展开记录。
 * 其他模型分组保持原状，允许用户同时比较多个模型的候选结果。
 */
export function toggleStyleGalleryPromptModel(
  current: StyleGalleryPromptDisclosureState,
  model: string,
  promptIds: readonly string[],
): StyleGalleryPromptDisclosureState {
  const expandedModels = new Set(current.expandedModels);
  const expandedPromptIds = new Set(current.expandedPromptIds);
  const isExpanded = expandedModels.has(model);

  for (const promptId of promptIds) expandedPromptIds.delete(promptId);
  if (isExpanded) expandedModels.delete(model);
  else {
    expandedModels.add(model);
    if (promptIds[0]) expandedPromptIds.add(promptIds[0]);
  }

  return { expandedModels, expandedPromptIds };
}
