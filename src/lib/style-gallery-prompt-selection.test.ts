import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getSelectedStyleGalleryPrompt,
  STYLE_GALLERY_PROMPT_SELECTED_EVENT,
  type StyleGalleryPromptSelectedDetail,
  selectStyleGalleryPrompt,
} from './style-gallery-prompt-selection';

describe('style gallery prompt selection', () => {
  it('retains the latest prompt for islands that subscribe after the event', () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const eventTarget = new EventTarget();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: eventTarget });
    let observed: StyleGalleryPromptSelectedDetail | undefined;
    eventTarget.addEventListener(STYLE_GALLERY_PROMPT_SELECTED_EVENT, (event) => {
      observed = (event as CustomEvent<StyleGalleryPromptSelectedDetail>).detail;
    });

    try {
      const detail = { slug: 'prompt-selection-test', prompt: 'Selected prompt variant' };
      selectStyleGalleryPrompt(detail);
      assert.deepEqual(observed, detail);
      assert.equal(getSelectedStyleGalleryPrompt(detail.slug), detail.prompt);
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });
});
