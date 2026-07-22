import assert from 'node:assert/strict';
import test from 'node:test';
import {
  $imageLightboxData,
  closeModal,
  type ImageLightboxLikeAction,
  navigateImage,
  openModal,
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
