/**
 * 网易云 Enhanced API 的最小服务端封装。
 *
 * 依赖通过动态 import 延迟到音乐 API Function 中加载，避免把仅服务端使用的
 * 登录与加密实现打进普通页面客户端 bundle。
 */

interface EnhancedApiResponse {
  status: number;
  body: unknown;
  cookie?: string[];
}

type EnhancedApiMethod = (params?: Record<string, unknown>) => Promise<EnhancedApiResponse>;

interface EnhancedApi {
  login_qr_key: EnhancedApiMethod;
  login_qr_create: EnhancedApiMethod;
  login_qr_check: EnhancedApiMethod;
  login_status: EnhancedApiMethod;
  song_url_v1: EnhancedApiMethod;
}

export interface NeteaseQrLogin {
  key: string;
  qrImage: string;
}

export interface NeteaseQrStatus {
  code: number;
  message: string;
  cookie?: string;
}

export interface NeteaseAccountStatus {
  authenticated: boolean;
  userId?: number;
  nickname?: string;
}

export interface NeteaseAudioResolution {
  url: string | null;
  freeTrial: boolean;
  level?: string;
  type?: string;
}

let apiPromise: Promise<EnhancedApi> | null = null;

async function getApi(): Promise<EnhancedApi> {
  if (!apiPromise) {
    apiPromise = import('@neteasecloudmusicapienhanced/api').then((loaded) => {
      const namespace = loaded as unknown as Record<string, unknown>;
      const candidate = (namespace.default ?? namespace['module.exports'] ?? namespace) as Partial<EnhancedApi>;
      const required: (keyof EnhancedApi)[] = [
        'login_qr_key',
        'login_qr_create',
        'login_qr_check',
        'login_status',
        'song_url_v1',
      ];
      if (required.some((name) => typeof candidate[name] !== 'function')) {
        throw new Error('NeteaseCloudMusicApiEnhanced does not expose the required methods.');
      }
      return candidate as EnhancedApi;
    });
  }
  return apiPromise;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function responseBody(response: EnhancedApiResponse): Record<string, unknown> {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`NetEase API request failed with HTTP ${response.status}.`);
  }
  return asRecord(response.body);
}

export async function createNeteaseQrLogin(): Promise<NeteaseQrLogin> {
  const api = await getApi();
  const keyResponse = responseBody(await api.login_qr_key({ timestamp: Date.now() }));
  const key = asRecord(keyResponse.data).unikey;
  if (typeof key !== 'string' || !key) throw new Error('NetEase did not return a QR login key.');

  const qrResponse = responseBody(await api.login_qr_create({ key, qrimg: true, timestamp: Date.now() }));
  const qrImage = asRecord(qrResponse.data).qrimg;
  if (typeof qrImage !== 'string' || !qrImage.startsWith('data:image/')) {
    throw new Error('NetEase did not return a QR image.');
  }
  return { key, qrImage };
}

export async function checkNeteaseQrLogin(key: string): Promise<NeteaseQrStatus> {
  const api = await getApi();
  const body = responseBody(await api.login_qr_check({ key, timestamp: Date.now() }));
  const code = typeof body.code === 'number' ? body.code : 0;
  const cookie = typeof body.cookie === 'string' && body.cookie.includes('MUSIC_U=') ? body.cookie : undefined;
  return {
    code,
    message: typeof body.message === 'string' ? body.message : '',
    cookie,
  };
}

export async function getNeteaseAccountStatus(cookie: string): Promise<NeteaseAccountStatus> {
  const api = await getApi();
  const body = responseBody(await api.login_status({ cookie, timestamp: Date.now() }));
  const data = asRecord(body.data);
  const account = asRecord(data.account);
  const profile = asRecord(data.profile);
  const userId = typeof account.id === 'number' ? account.id : typeof profile.userId === 'number' ? profile.userId : undefined;
  return {
    authenticated: body.code === 200 && Boolean(userId),
    userId,
    nickname: typeof profile.nickname === 'string' ? profile.nickname : undefined,
  };
}

export async function resolveNeteaseAudio(songId: string, cookie: string, level = 'exhigh'): Promise<NeteaseAudioResolution> {
  const api = await getApi();
  const body = responseBody(await api.song_url_v1({ id: songId, level, cookie }));
  const first = Array.isArray(body.data) ? asRecord(body.data[0]) : {};
  return {
    url: typeof first.url === 'string' && first.url ? first.url : null,
    freeTrial: first.freeTrialInfo !== null && first.freeTrialInfo !== undefined,
    level: typeof first.level === 'string' ? first.level : undefined,
    type: typeof first.type === 'string' ? first.type : undefined,
  };
}
