import assert from 'node:assert/strict';
import test from 'node:test';
import { createStyleGallerySourceLightboxData } from '@lib/style-gallery-lightbox-actions';
import {
  $imageLightboxData,
  closeModal,
  type ImageLightboxLikeAction,
  navigateImage,
  openModal,
  removeImageFromLightbox,
  syncImageLightboxLikes,
  updateImageLightboxLike,
} from '@store/modal';

function likeAction(exampleId: string): ImageLightboxLikeAction {
  return {
    exampleId,
    liked: false,
    likeCount: 0,
    pending: false,
    authEnabled: true,
    viewerAuthenticated: true,
    labels: { like: 'Like', unlike: 'Unlike', loginRequired: 'Login', unavailable: 'Unavailable' },
    toggle: async () => ({ liked: true, likeCount: 1 }),
  };
}

test('builds source-image lightbox navigation without generated-example mutations', async () => {
  const data = createStyleGallerySourceLightboxData(
    [
      {
        id: 'first',
        src: '/source/first.webp',
        previewSrc: '/thumb/first.webp',
        alt: 'First',
        getPrompt: () => 'first prompt',
      },
      {
        id: 'second',
        src: '/source/second.webp',
        alt: 'Second',
        getPrompt: () => 'second prompt',
      },
    ],
    'second',
    { copyPrompt: 'Copy', copiedPrompt: 'Copied', copyFailed: 'Failed' },
  );

  assert.equal(data.currentIndex, 1);
  assert.equal(data.src, '/source/second.webp');
  assert.equal(data.images[0].previewSrc, '/thumb/first.webp');
  assert.equal(await data.images[0].copy?.getText(), 'first prompt');
  assert.equal(data.images[0].like, undefined);
  assert.equal(data.images[0].delete, undefined);
});

test('keeps an updated like state when navigating away from an image and back', () => {
  openModal('imageLightbox', {
    src: '/first.webp',
    alt: 'First',
    currentIndex: 0,
    images: [
      { src: '/first.webp', alt: 'First', like: likeAction('first') },
      { src: '/second.webp', alt: 'Second', like: likeAction('second') },
    ],
  });

  assert.equal(updateImageLightboxLike('first', { liked: true, likeCount: 1, pending: false }), true);
  assert.equal(navigateImage(1), true);
  assert.equal(navigateImage(-1), true);

  const data = $imageLightboxData.get();
  assert.equal(data?.images[0].like?.liked, true);
  assert.equal(data?.images[0].like?.likeCount, 1);
  closeModal();
});

test('synchronizes viewer hydration and external mutations into an open lightbox', () => {
  const action = likeAction('first');
  action.authEnabled = false;
  action.viewerAuthenticated = false;
  action.pending = true;
  openModal('imageLightbox', {
    src: '/first.webp',
    alt: 'First',
    currentIndex: 0,
    images: [{ src: '/first.webp', alt: 'First', like: action }],
  });

  assert.equal(
    syncImageLightboxLikes(() => ({
      liked: true,
      likeCount: 4,
      pending: false,
      authEnabled: true,
      viewerAuthenticated: true,
    })),
    true,
  );

  const synced = $imageLightboxData.get()?.images[0].like;
  assert.deepEqual(
    synced && {
      liked: synced.liked,
      likeCount: synced.likeCount,
      pending: synced.pending,
      authEnabled: synced.authEnabled,
      viewerAuthenticated: synced.viewerAuthenticated,
    },
    { liked: true, likeCount: 4, pending: false, authEnabled: true, viewerAuthenticated: true },
  );
  assert.equal(synced?.toggle, action.toggle);
  closeModal();
});

test('removes an async-deleted image without losing the current lightbox focus', () => {
  openModal('imageLightbox', {
    src: '/second.webp',
    alt: 'Second',
    currentIndex: 1,
    images: [
      { id: 'first', src: '/first.webp', alt: 'First' },
      { id: 'second', src: '/second.webp', alt: 'Second' },
      { id: 'third', src: '/third.webp', alt: 'Third' },
    ],
  });

  assert.equal(removeImageFromLightbox('first'), true);
  assert.equal($imageLightboxData.get()?.src, '/second.webp');
  assert.equal($imageLightboxData.get()?.currentIndex, 0);

  assert.equal(removeImageFromLightbox('second'), true);
  assert.equal($imageLightboxData.get()?.src, '/third.webp');
  assert.equal(removeImageFromLightbox('third'), true);
  assert.equal($imageLightboxData.get(), null);
});
