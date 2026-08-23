import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getStyleGalleryClipboardImage } from './style-gallery-visual-clipboard';

function clipboardItem(file: File) {
  return { kind: 'file', type: file.type, getAsFile: () => file };
}

describe('style gallery visual-search clipboard images', () => {
  it('selects the first supported clipboard image without reading unrelated text items', () => {
    const image = new File(['png'], 'clipboard.png', { type: 'image/png' });
    const result = getStyleGalleryClipboardImage({
      files: [],
      items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }, clipboardItem(image)],
    });

    assert.deepEqual(result, { status: 'accepted', file: image });
  });

  it('falls back to clipboard files and reports unsupported image formats', () => {
    const avif = new File(['avif'], 'clipboard.avif', { type: 'image/avif' });
    assert.deepEqual(getStyleGalleryClipboardImage({ files: [avif], items: [] }), {
      status: 'unsupported',
      mimeType: 'image/avif',
    });
  });

  it('leaves non-image clipboard content untouched', () => {
    assert.deepEqual(
      getStyleGalleryClipboardImage({
        files: [],
        items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
      }),
      { status: 'empty' },
    );
  });
});
