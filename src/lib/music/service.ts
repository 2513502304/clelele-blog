import { getNeteaseAccountStatus, resolveNeteaseAudio } from './netease-api';
import { getNeteaseSession, mutateNeteaseSession, type NeteaseSession } from './session-store';

const AUDIO_CACHE_TTL_MS = 5 * 60 * 1000;
const SONG_ID_PATTERN = /^\d{1,20}$/;
const audioCache = new Map<string, { url: string; expiresAt: number }>();

export interface MusicSessionHealthResult {
  healthy: boolean;
  message: string;
  account?: NeteaseSession['account'];
}

export function isValidNeteaseSongId(value: string): boolean {
  return SONG_ID_PATTERN.test(value);
}

export function getFallbackMetingApiUrl(): URL {
  return new URL(process.env.MUSIC_FALLBACK_METING_API ?? 'https://163.hyc.moe/');
}

export function createFallbackAudioUrl(songId: string): string {
  if (!isValidNeteaseSongId(songId)) throw new Error('Invalid NetEase song ID.');
  const url = getFallbackMetingApiUrl();
  url.search = new URLSearchParams({ server: 'netease', type: 'url', id: songId }).toString();
  return url.toString();
}

function normalizeAudioUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.toString();
  } catch {
    return null;
  }
}

export async function resolveAuthenticatedAudioUrl(songId: string): Promise<string | null> {
  if (!isValidNeteaseSongId(songId)) return null;
  const session = await getNeteaseSession();
  if (!session) return null;
  const level = process.env.MUSIC_NETEASE_AUDIO_LEVEL?.trim() || 'exhigh';
  const cacheKey = `${session.updatedAt}:${level}:${songId}`;
  const cached = audioCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const resolved = await resolveNeteaseAudio(songId, session.cookie, level);
  if (!resolved.url || resolved.freeTrial) return null;
  const url = normalizeAudioUrl(resolved.url);
  if (!url) return null;
  audioCache.set(cacheKey, { url, expiresAt: Date.now() + AUDIO_CACHE_TTL_MS });
  return url;
}

export async function checkMusicSessionHealth(): Promise<MusicSessionHealthResult> {
  const session = await getNeteaseSession({ fresh: true });
  if (!session) return { healthy: false, message: '尚未建立网易云登录会话。' };

  let healthy = false;
  let message = '';
  let account: NeteaseSession['account'];
  try {
    const status = await getNeteaseAccountStatus(session.cookie);
    healthy = status.authenticated;
    account = status.userId || status.nickname ? { userId: status.userId, nickname: status.nickname } : undefined;
    message = healthy ? '网易云登录状态有效。' : '网易云登录状态已失效，需要重新扫码。';

    const probeSongId = process.env.MUSIC_NETEASE_HEALTHCHECK_SONG_ID?.trim();
    if (healthy && probeSongId && isValidNeteaseSongId(probeSongId)) {
      const probe = await resolveNeteaseAudio(
        probeSongId,
        session.cookie,
        process.env.MUSIC_NETEASE_AUDIO_LEVEL?.trim() || 'exhigh',
      );
      healthy = Boolean(probe.url && !probe.freeTrial);
      message = healthy ? '网易云登录状态与完整音源解析均正常。' : '登录有效，但健康检查歌曲只返回试听或空音源。';
    }
  } catch (error) {
    healthy = false;
    message = error instanceof Error ? `健康检查失败：${error.message}` : '网易云健康检查失败。';
  }

  const checkedAt = new Date().toISOString();
  await mutateNeteaseSession((current) => {
    if (!current) return session;
    return {
      ...current,
      account: account ?? current.account,
      health: { checkedAt, healthy, message },
    };
  });
  return { healthy, message, account: account ?? session.account };
}
