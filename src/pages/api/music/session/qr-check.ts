import { isMusicAdmin, rejectCrossOriginMutation } from '@lib/music/admin-auth';
import { checkNeteaseQrLogin, getNeteaseAccountStatus, type NeteaseAccountStatus } from '@lib/music/netease-api';
import { mutateNeteaseSession } from '@lib/music/session-store';
import type { APIRoute } from 'astro';
import { z } from 'zod';

export const prerender = false;

const bodySchema = z.object({ key: z.string().min(8).max(256) });

export const POST: APIRoute = async ({ cookies, request, url }) => {
  const originError = rejectCrossOriginMutation(request, url);
  if (originError) return originError;
  if (!isMusicAdmin(cookies)) return new Response('Not found.', { status: 404 });
  try {
    const { key } = bodySchema.parse(await request.json());
    const result = await checkNeteaseQrLogin(key);
    if (result.code !== 803 || !result.cookie) {
      return Response.json(
        { code: result.code, message: result.message },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const accountStatus = await getNeteaseAccountStatus(result.cookie).catch(
      (): NeteaseAccountStatus => ({ authenticated: true }),
    );
    const now = new Date().toISOString();
    const session = await mutateNeteaseSession((current) => ({
      version: 1,
      cookie: result.cookie as string,
      loginMethod: 'qr',
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      account:
        accountStatus.userId || accountStatus.nickname
          ? { userId: accountStatus.userId, nickname: accountStatus.nickname }
          : current?.account,
      health: {
        checkedAt: now,
        healthy: accountStatus.authenticated,
        message: accountStatus.authenticated ? '二维码登录成功。' : '二维码登录完成，但账号状态验证失败。',
      },
    }));
    return Response.json(
      {
        code: 803,
        message: '二维码登录成功。',
        session: {
          connected: true,
          updatedAt: session.updatedAt,
          account: session.account,
          health: session.health,
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) return new Response(error.message, { status: 400 });
    console.error('[music] Failed to check the NetEase QR login.', error);
    return new Response('Failed to check the NetEase QR login.', { status: 503 });
  }
};
