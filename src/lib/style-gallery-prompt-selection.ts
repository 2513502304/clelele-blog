export const STYLE_GALLERY_PROMPT_SELECTED_EVENT = 'style-gallery:prompt-selected';

export interface StyleGalleryPromptSelectedDetail {
  slug: string;
  prompt: string;
}

const selectedPromptBySlug = new Map<string, string>();

/** 返回当前页面内最近一次选择，供晚于选择事件 hydration 的 React island 恢复状态。 */
export function getSelectedStyleGalleryPrompt(slug: string): string | undefined {
  return selectedPromptBySlug.get(slug);
}

/**
 * 详情页的 prompt 与 examples 是两个独立 React island。事件负责实时同步，模块内快照负责补偿
 * hydration 先后顺序；状态不写入持久存储，也不会让 Sub-gallery 为每个候选增加网络请求。
 */
export function selectStyleGalleryPrompt(detail: StyleGalleryPromptSelectedDetail): void {
  selectedPromptBySlug.set(detail.slug, detail.prompt);
  window.dispatchEvent(new CustomEvent<StyleGalleryPromptSelectedDetail>(STYLE_GALLERY_PROMPT_SELECTED_EVENT, { detail }));
}
