import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createHfS3Client, type HfS3Config, HfS3ConflictError } from '@lib/hf-s3';
import { z } from 'zod';

const SESSION_OBJECT_KEY = 'netease-session.v1.enc.json';
const CACHE_TTL_MS = 5 * 60 * 1000;
const STORE_ATTEMPTS = 3;

const sessionSchema = z.object({
  version: z.literal(1),
  cookie: z.string().min(10),
  loginMethod: z.literal('qr'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  account: z
    .object({
      userId: z.number().int().positive().optional(),
      nickname: z.string().min(1).optional(),
    })
    .optional(),
  health: z
    .object({
      checkedAt: z.string().datetime(),
      healthy: z.boolean(),
      message: z.string(),
    })
    .optional(),
});

const encryptedEnvelopeSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('aes-256-gcm'),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  ciphertext: z.string().min(1),
});

export type NeteaseSession = z.infer<typeof sessionSchema>;

export interface PublicNeteaseSessionStatus {
  configured: boolean;
  connected: boolean;
  loginMethod?: 'qr';
  createdAt?: string;
  updatedAt?: string;
  account?: NeteaseSession['account'];
  health?: NeteaseSession['health'];
}

let cache: { session: NeteaseSession | null; expiresAt: number } | null = null;

function encryptionKey(): Buffer {
  const secret = process.env.MUSIC_SESSION_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error('MUSIC_SESSION_ENCRYPTION_KEY must contain at least 32 characters.');
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

function getS3Config(): HfS3Config {
  const accessKeyId = process.env.HF_S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.HF_S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Error('HF S3 credentials are required for the music session store.');
  return {
    accessKeyId,
    secretAccessKey,
    endpoint: new URL(process.env.HF_S3_ENDPOINT ?? 'https://s3.hf.co/clelele0722'),
    bucket: process.env.HF_S3_BUCKET ?? 'raw-datasets',
    // Preview 只读生产会话，便于验收真实播放链路；本地/Development 独立写入，避免测试扫码覆盖线上 Cookie。
    prefix:
      process.env.MUSIC_SESSION_HF_S3_PREFIX ??
      (process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview'
        ? 'private/music-session/production'
        : 'private/music-session/development'),
    region: process.env.HF_S3_REGION ?? 'us-east-1',
  };
}

function client() {
  return createHfS3Client(getS3Config(), { attempts: 3, requestTimeoutMs: 10_000, transferTimeoutMs: 15_000 });
}

/** Cookie 与账号摘要整体加密；HF 对象中不出现任何可识别的网易云会话字段。 */
export function encryptNeteaseSession(session: NeteaseSession): Uint8Array {
  const parsed = sessionSchema.parse(session);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(parsed), 'utf8'), cipher.final()]);
  const envelope = {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  } as const;
  return new TextEncoder().encode(JSON.stringify(envelope));
}

export function decryptNeteaseSession(bytes: Uint8Array): NeteaseSession {
  const envelope = encryptedEnvelopeSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(envelope.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]).toString(
    'utf8',
  );
  return sessionSchema.parse(JSON.parse(plaintext));
}

async function readSnapshot(): Promise<{ session: NeteaseSession | null; etag: string | null }> {
  const snapshot = await client().get(SESSION_OBJECT_KEY, [403, 404]);
  return snapshot ? { session: decryptNeteaseSession(snapshot.bytes), etag: snapshot.etag } : { session: null, etag: null };
}

export function clearNeteaseSessionCache(): void {
  cache = null;
}

export async function getNeteaseSession(options: { fresh?: boolean } = {}): Promise<NeteaseSession | null> {
  if (!options.fresh && cache && cache.expiresAt > Date.now()) return cache.session;
  const snapshot = await readSnapshot();
  cache = { session: snapshot.session, expiresAt: Date.now() + CACHE_TTL_MS };
  return snapshot.session;
}

/** 条件写防止健康检查覆盖刚完成的二维码登录；冲突时重新读取最新会话再执行 mutation。 */
export async function mutateNeteaseSession(
  mutation: (current: NeteaseSession | null) => NeteaseSession,
): Promise<NeteaseSession> {
  for (let attempt = 1; attempt <= STORE_ATTEMPTS; attempt += 1) {
    const snapshot = await readSnapshot();
    const next = sessionSchema.parse(mutation(snapshot.session));
    try {
      await client().put(
        SESSION_OBJECT_KEY,
        encryptNeteaseSession(next),
        'application/json',
        snapshot.etag ? { ifMatch: snapshot.etag } : { ifNoneMatch: '*' },
      );
      cache = { session: next, expiresAt: Date.now() + CACHE_TTL_MS };
      return next;
    } catch (error) {
      if (!(error instanceof HfS3ConflictError) || attempt === STORE_ATTEMPTS) throw error;
    }
  }
  throw new Error('Failed to update the NetEase session.');
}

export function toPublicNeteaseSessionStatus(session: NeteaseSession | null): PublicNeteaseSessionStatus {
  return session
    ? {
        configured: true,
        connected: true,
        loginMethod: session.loginMethod,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        account: session.account,
        health: session.health,
      }
    : { configured: true, connected: false };
}

export function isMusicSessionStoreConfigured(): boolean {
  return Boolean(
    process.env.MUSIC_SESSION_ENCRYPTION_KEY &&
      (process.env.HF_S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID) &&
      (process.env.HF_S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY),
  );
}
