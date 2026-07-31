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
  song_url: EnhancedApiMethod;
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
      const required: (keyof EnhancedApi)[] = ['login_qr_key', 'login_qr_create', 'login_qr_check', 'login_status', 'song_url'];
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
  return parseNeteaseAccountStatus(body);
}

/** Enhanced API 会把 `/login/status` 的原始响应包在 `data` 中，兼容直接响应便于后续升级依赖。 */
export function parseNeteaseAccountStatus(value: unknown): NeteaseAccountStatus {
  const body = asRecord(value);
  const nested = asRecord(body.data);
  const payload = Object.keys(nested).length > 0 ? nested : body;
  const account = asRecord(payload.account);
  const profile = asRecord(payload.profile);
  const userId = typeof account.id === 'number' ? account.id : typeof profile.userId === 'number' ? profile.userId : undefined;
  return {
    authenticated: payload.code === 200 && Boolean(userId),
    userId,
    nickname: typeof profile.nickname === 'string' ? profile.nickname : undefined,
  };
}

const AUDIO_BITRATE_BY_LEVEL: Readonly<Record<string, number>> = {
  standard: 128_000,
  higher: 192_000,
  exhigh: 320_000,
  lossless: 999_000,
  hires: 999_000,
  jyeffect: 999_000,
  sky: 999_000,
  jymaster: 999_000,
};

/** `song_url` 使用码率而非级别；未知或超高规格安全回退到旧接口支持的最高档。 */
export function getNeteaseAudioBitrate(level: string): number {
  return AUDIO_BITRATE_BY_LEVEL[level] ?? AUDIO_BITRATE_BY_LEVEL.lossless;
}

export async function resolveNeteaseAudio(songId: string, cookie: string, level = 'exhigh'): Promise<NeteaseAudioResolution> {
  const api = await getApi();
  // `song_url_v1` 依赖进程启动时写入 /tmp 的 XEAPI 公钥，不适合 Vercel 的无状态 Function。
  // 经典 `song_url` 同样接受 MUSIC_U Cookie，并且不需要额外的临时运行时初始化。
  const body = responseBody(await api.song_url({ id: songId, br: getNeteaseAudioBitrate(level), cookie }));
  const first = Array.isArray(body.data) ? asRecord(body.data[0]) : {};
  return {
    url: typeof first.url === 'string' && first.url ? first.url : null,
    freeTrial: first.freeTrialInfo !== null && first.freeTrialInfo !== undefined,
    level: typeof first.level === 'string' ? first.level : level,
    type: typeof first.type === 'string' ? first.type : undefined,
  };
}
