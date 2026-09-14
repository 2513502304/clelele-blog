import { STYLE_GALLERY_UPLOAD_TOKEN_STORAGE_KEY } from './style-gallery-lightbox-actions';

export const STYLE_GALLERY_TOKEN_CHANGED_EVENT = 'style-gallery:token-changed';
let sessionToken = '';

/** Upload and tag editors share the existing browser credential, including storage-restricted tabs. */
export function getStyleGalleryManagementToken(): string {
  try {
    sessionToken = localStorage.getItem(STYLE_GALLERY_UPLOAD_TOKEN_STORAGE_KEY) ?? sessionToken;
  } catch {
    /* Keep the in-memory credential. */
  }
  return sessionToken;
}

/** Call after authentication succeeds; a mistyped token must not replace the working upload credential. */
export function rememberStyleGalleryManagementToken(token: string): void {
  sessionToken = token.trim();
  try {
    localStorage.setItem(STYLE_GALLERY_UPLOAD_TOKEN_STORAGE_KEY, sessionToken);
  } catch {
    /* Reuse until this tab closes. */
  }
  window.dispatchEvent(new Event(STYLE_GALLERY_TOKEN_CHANGED_EVENT));
}
