import { getStyleGalleryViewer, isStyleGalleryGitHubAuthEnabled } from '@lib/style-gallery-github-auth';
import type { AstroCookies } from 'astro';

const DEFAULT_SITE_ADMIN_GITHUB_ID = 129171955;

/**
 * 返回站点 owner 的 GitHub 数字 ID。
 *
 * `MUSIC_ADMIN_GITHUB_ID` 是旧版唯一管理功能留下的名称；读取时继续回退到它，避免已有部署升级后失去管理权限。
 */
export function getSiteAdminGitHubId(): number {
  const configured = process.env.SITE_ADMIN_GITHUB_ID ?? process.env.MUSIC_ADMIN_GITHUB_ID;
  const parsed = Number.parseInt(configured ?? String(DEFAULT_SITE_ADMIN_GITHUB_ID), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('SITE_ADMIN_GITHUB_ID must be a positive GitHub user ID.');
  }
  return parsed;
}

export function isSiteAdmin(cookies: AstroCookies): boolean {
  return getStyleGalleryViewer(cookies)?.id === getSiteAdminGitHubId();
}

export function isSiteAdminLoginConfigured(): boolean {
  return isStyleGalleryGitHubAuthEnabled();
}

/** 写操作仅接受同源浏览器请求；没有 Origin 的服务端和测试请求仍交由身份校验处理。 */
export function rejectCrossOriginMutation(request: Request, requestUrl: URL): Response | null {
  const origin = request.headers.get('origin');
  return origin && origin !== requestUrl.origin ? new Response('Invalid request origin.', { status: 403 }) : null;
}
