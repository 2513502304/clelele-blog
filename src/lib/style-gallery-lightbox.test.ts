import assert from 'node:assert/strict';
import test from 'node:test';
import {
  $imageLightboxData,
  closeModal,
  type ImageLightboxLikeAction,
  navigateImage,
  openModal,
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
