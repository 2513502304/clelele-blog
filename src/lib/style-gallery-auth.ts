import { timingSafeEqual } from 'node:crypto';

/**
 * 校验 Gallery 写操作的共享令牌。优先读取 Bearer header，并兼容旧 JSON body 中的 token；
 * 长度一致后使用常量时间比较，服务端未配置令牌时所有写入默认关闭。
 */
export function isAuthorizedStyleGalleryRequest(request: Request, fallbackToken: unknown = ''): boolean {
  const expectedToken = process.env.STYLE_GALLERY_UPLOAD_TOKEN;
  if (!expectedToken) return false;
  const authorization = request.headers.get('authorization');
  const suppliedToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : typeof fallbackToken === 'string'
      ? fallbackToken
      : '';
  const expected = Buffer.from(expectedToken);
  const supplied = Buffer.from(suppliedToken);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
