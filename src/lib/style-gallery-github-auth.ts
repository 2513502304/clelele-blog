import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { z } from 'zod';
import type { StyleGalleryViewer } from '@/types/style-gallery';

export const STYLE_GALLERY_SESSION_COOKIE = 'style_gallery_session';
export const STYLE_GALLERY_OAUTH_FLOW_COOKIE = 'style_gallery_oauth_flow';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
const OAUTH_FLOW_MAX_AGE_SECONDS = 10 * 60;
const githubUserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  name: z.string().nullable(),
  avatar_url: z.string().url(),
  html_url: z.string().url(),
});
const oauthTokenSchema = z.object({ access_token: z.string().min(1), token_type: z.string().optional() });
const flowSchema = z.object({
  state: z.string().min(32),
  verifier: z.string().min(43),
  returnTo: z.string().startsWith('/'),
  expiresAt: z.number().int().positive(),
});
const sessionSchema = z.object({
  viewer: z.object({
    id: z.number().int().positive(),
    login: z.string().min(1),
    name: z.string().optional(),
    avatarUrl: z.string().url(),
    profileUrl: z.string().url(),
  }),
  expiresAt: z.number().int().positive(),
});

interface OAuthFlow {
  state: string;
  verifier: string;
  returnTo: string;
  expiresAt: number;
}

function getSessionSecret(): string {
  const secret = process.env.STYLE_GALLERY_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('STYLE_GALLERY_SESSION_SECRET must contain at least 32 characters.');
  }
  return secret;
}

function sign(value: string): string {
  return createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

function encodeSignedJson(value: unknown): string {
  const payload = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function decodeSignedJson(token: string): unknown {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) throw new Error('Malformed signed token.');
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid token signature.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

function cookieOptions(requestUrl: URL, maxAge: number) {
  return {
    httpOnly: true,
    secure: requestUrl.protocol === 'https:',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

/** giscus 的登录态位于第三方 iframe，Gallery 因此使用独立 GitHub OAuth 配置。 */
export function isStyleGalleryGitHubAuthEnabled(): boolean {
  const sessionSecret = process.env.STYLE_GALLERY_SESSION_SECRET;
  return Boolean(
    process.env.STYLE_GALLERY_GITHUB_CLIENT_ID &&
      process.env.STYLE_GALLERY_GITHUB_CLIENT_SECRET &&
      process.env.STYLE_GALLERY_GITHUB_REDIRECT_URI &&
      sessionSecret &&
      sessionSecret.length >= 32,
  );
}

export function normalizeStyleGalleryReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/image-style-prompt-gallery/examples';
  try {
    const parsed = new URL(value, 'https://local.invalid');
    if (parsed.origin !== 'https://local.invalid') return '/image-style-prompt-gallery/examples';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/image-style-prompt-gallery/examples';
  }
}

export function createStyleGalleryOAuthFlow(returnTo: string): OAuthFlow {
  return {
    state: randomBytes(32).toString('base64url'),
    verifier: randomBytes(32).toString('base64url'),
    returnTo: normalizeStyleGalleryReturnTo(returnTo),
    expiresAt: Date.now() + OAUTH_FLOW_MAX_AGE_SECONDS * 1000,
  };
}

export function getStyleGalleryOAuthChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function setStyleGalleryOAuthFlowCookie(cookies: AstroCookies, requestUrl: URL, flow: OAuthFlow): void {
  cookies.set(STYLE_GALLERY_OAUTH_FLOW_COOKIE, encodeSignedJson(flow), cookieOptions(requestUrl, OAUTH_FLOW_MAX_AGE_SECONDS));
}

export function takeStyleGalleryOAuthFlow(cookies: AstroCookies): OAuthFlow | null {
  const token = cookies.get(STYLE_GALLERY_OAUTH_FLOW_COOKIE)?.value;
  cookies.delete(STYLE_GALLERY_OAUTH_FLOW_COOKIE, { path: '/' });
  if (!token) return null;
  try {
    const flow = flowSchema.parse(decodeSignedJson(token));
    return flow.expiresAt > Date.now() ? flow : null;
  } catch {
    return null;
  }
}

export function setStyleGallerySession(cookies: AstroCookies, requestUrl: URL, viewer: StyleGalleryViewer): void {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  cookies.set(
    STYLE_GALLERY_SESSION_COOKIE,
    encodeSignedJson({ viewer, expiresAt }),
    cookieOptions(requestUrl, SESSION_MAX_AGE_SECONDS),
  );
}

export function getStyleGalleryViewer(cookies: AstroCookies): StyleGalleryViewer | null {
  const token = cookies.get(STYLE_GALLERY_SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const session = sessionSchema.parse(decodeSignedJson(token));
    return session.expiresAt > Date.now() ? session.viewer : null;
  } catch {
    return null;
  }
}

export function clearStyleGallerySession(cookies: AstroCookies): void {
  cookies.delete(STYLE_GALLERY_SESSION_COOKIE, { path: '/' });
}

export function getStyleGalleryOAuthRedirectUri(requestUrl: URL): string {
  const configured = process.env.STYLE_GALLERY_GITHUB_REDIRECT_URI?.trim();
  return configured || new URL('/api/style-gallery/auth/github/callback', requestUrl.origin).toString();
}

/** 交换临时 code 后立即读取用户身份；GitHub access token 不进入 cookie、日志或 HF。 */
export async function authenticateStyleGalleryGitHubUser(input: {
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<StyleGalleryViewer> {
  const clientId = process.env.STYLE_GALLERY_GITHUB_CLIENT_ID;
  const clientSecret = process.env.STYLE_GALLERY_GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('GitHub OAuth is not configured.');

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error(`GitHub token exchange failed with ${tokenResponse.status}.`);
  const token = oauthTokenSchema.parse(await tokenResponse.json());

  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token.access_token}`,
      'user-agent': 'clelele-blog-style-gallery',
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!userResponse.ok) throw new Error(`GitHub user lookup failed with ${userResponse.status}.`);
  const user = githubUserSchema.parse(await userResponse.json());
  return {
    id: user.id,
    login: user.login,
    name: user.name ?? undefined,
    avatarUrl: user.avatar_url,
    profileUrl: user.html_url,
  };
}
