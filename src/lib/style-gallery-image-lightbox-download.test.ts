import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createImageLightboxDownloadAction } from './image-lightbox-download';

describe('image lightbox download actions', () => {
  it('routes Gallery images through the attachment response', () => {
    assert.deepEqual(createImageLightboxDownloadAction('/api/style-gallery/image/source/example.webp'), {
      href: '/api/style-gallery/image/source/example.webp?download=1',
      filename: 'example.webp',
      opensExternally: false,
    });
  });

  it('uses native download for same-origin images', () => {
    assert.deepEqual(createImageLightboxDownloadAction('https://blog.example/img/example.webp', 'https://blog.example'), {
      href: 'https://blog.example/img/example.webp',
      filename: 'example.webp',
      opensExternally: false,
    });
  });

  it('opens cross-origin images without claiming to download them', () => {
    assert.deepEqual(createImageLightboxDownloadAction('https://cdn.example/img/example.webp', 'https://blog.example'), {
      href: 'https://cdn.example/img/example.webp',
      opensExternally: true,
    });
  });
});
