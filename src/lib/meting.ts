/**
 * Meting API client — resolves music platform URLs to playable audio streams.
 *
 * Ported from Shoka player.js URL parsing + Meting API integration.
 * Supports NetEase Cloud Music and QQ Music.
 */

import { fetchWithRetry } from './fetch-with-retry';

const DEFAULT_API = '/api/music/meting';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export interface MetingSong {
  name: string;
  artist: string;
  url: string;
  pic: string;
  lrc: string;
}

interface ParsedUrl {
  server: string;
  type: string;
  id: string;
}

// URL parsing rules (ported from Shoka player.js:30-47)
const URL_RULES: [RegExp, string, string][] = [
  [/music\.163\.com.*song.*id=(\d+)/, 'netease', 'song'],
  [/music\.163\.com.*album.*id=(\d+)/, 'netease', 'albumlist'],
  [/music\.163\.com.*playlist.*id=(\d+)/, 'netease', 'playlist'],
  [/music\.163\.com.*discover\/toplist.*id=(\d+)/, 'netease', 'playlist'],
  [/y\.qq\.com.*song\/(\w+)/, 'tencent', 'song'],
  [/y\.qq\.com.*album\/(\w+)/, 'tencent', 'albumlist'],
  [/y\.qq\.com.*playsquare\/(\w+)/, 'tencent', 'playlist'],
  [/y\.qq\.com.*playlist\/(\w+)/, 'tencent', 'playlist'],
];

/** Parse a music platform URL into server/type/id triple. */
export function parseMusicUrl(url: string): ParsedUrl | null {
  for (const [regex, server, type] of URL_RULES) {
    const match = url.match(regex);
    if (match?.[1]) {
      return { server, type, id: match[1] };
    }
  }
  return null;
}

interface CacheEntry {
  data: MetingSong[];
  timestamp: number;
}

function getCacheKey(server: string, type: string, id: string, apiUrl: string): string {
  return `meting:v4:${apiUrl}:${server}:${type}:${id}`;
}

function resolveApiUrl(apiUrl: string): URL {
  const base = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  return new URL(apiUrl, base);
}

function getFromCache(key: string): MetingSong[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      localStorage.removeItem(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function setCache(key: string, data: MetingSong[]): void {
  try {
    const entry: CacheEntry = { data, timestamp: Date.now() };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable — non-critical, skip silently
  }
}

function upgradeSameHostUrl(value: unknown, apiUrl: string): string {
  if (typeof value !== 'string') return '';
  try {
    const source = new URL(value);
    const api = new URL(apiUrl);
    // Several Meting deployments still serialize their own resolver links as HTTP. Upgrading only
    // the same host avoids mixed-content failures without rewriting third-party CDN URLs.
    if (api.protocol === 'https:' && source.protocol === 'http:' && source.hostname === api.hostname) {
      source.protocol = 'https:';
      return source.href;
    }
  } catch {
    // Consumers surface malformed provider URLs; the remaining metadata is still useful.
  }
  return value;
}

function normalizeMetingSong(obj: unknown, apiUrl: string): MetingSong | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name : typeof o.title === 'string' ? o.title : null;
  const artist = typeof o.artist === 'string' ? o.artist : typeof o.author === 'string' ? o.author : null;
  if (!name || !artist || typeof o.url !== 'string') return null;
  const url = upgradeSameHostUrl(o.url, apiUrl);
  if (!url.trim()) return null;

  return {
    name,
    artist,
    url,
    pic: upgradeSameHostUrl(o.pic, apiUrl),
    lrc: upgradeSameHostUrl(o.lrc, apiUrl),
  };
}

/** Fetch songs from Meting API for a single parsed URL. */
export async function fetchMeting(server: string, type: string, id: string, apiUrl?: string): Promise<MetingSong[]> {
  const resolvedApiUrl = resolveApiUrl(apiUrl || DEFAULT_API);
  const cacheKey = getCacheKey(server, type, id, resolvedApiUrl.href);
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const url = new URL(resolvedApiUrl);
  const params = new URLSearchParams({ server, type, id });
  url.search = params.toString();
  const response = await fetchWithRetry(url, {
    statusError: (failedResponse) => new Error(`Meting API error: ${failedResponse.status}`),
  });
  if (!response.ok) throw new Error(`Meting API error: ${response.status}`);

  const data: unknown = await response.json();
  if (!Array.isArray(data)) return [];
  const songs = data
    .map((song) => normalizeMetingSong(song, resolvedApiUrl.href))
    .filter((song): song is MetingSong => Boolean(song));
  if (songs.length > 0) setCache(cacheKey, songs);
  return songs;
}

/** Resolve multiple music URLs into a flat song list. */
export async function resolvePlaylist(urls: string[], apiUrl?: string): Promise<MetingSong[]> {
  const results = await Promise.allSettled(
    urls.map((url) => {
      const parsed = parseMusicUrl(url);
      if (!parsed) return Promise.resolve([]);
      return fetchMeting(parsed.server, parsed.type, parsed.id, apiUrl);
    }),
  );

  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}
