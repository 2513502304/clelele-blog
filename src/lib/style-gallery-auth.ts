import { timingSafeEqual } from 'node:crypto';

export function isAuthorizedStyleGalleryRequest(request: Request, fallbackToken = ''): boolean {
  const expectedToken = process.env.STYLE_GALLERY_UPLOAD_TOKEN;
  if (!expectedToken) return false;
  const authorization = request.headers.get('authorization');
  const suppliedToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : fallbackToken;
  const expected = Buffer.from(expectedToken);
  const supplied = Buffer.from(suppliedToken);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
