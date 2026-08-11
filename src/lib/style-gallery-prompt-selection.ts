export const STYLE_GALLERY_PROMPT_SELECTED_EVENT = 'style-gallery:prompt-selected';

export interface StyleGalleryPromptSelectedDetail {
  slug: string;
  prompt: string;
}

/**
 * 详情页的 prompt 与 examples 是两个独立 React island；该页面级事件只同步当前选择，
 * 不持久化 prompt，也不会让 Sub-gallery 为每个候选增加网络请求。
 */
export function selectStyleGalleryPrompt(detail: StyleGalleryPromptSelectedDetail): void {
  window.dispatchEvent(new CustomEvent<StyleGalleryPromptSelectedDetail>(STYLE_GALLERY_PROMPT_SELECTED_EVENT, { detail }));
}
