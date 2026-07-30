import { isValidNeteaseSongId } from './service';

function upgradeHttpUrl(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.toString();
  } catch {
    return value;
  }
}

function extractNeteaseSongId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const id = new URL(value).searchParams.get('id');
    return id && isValidNeteaseSongId(id) ? id : null;
  } catch {
    return null;
  }
}

/** 保留上游 metadata，仅将网易云音频入口改写到不暴露 Cookie 的同源解析路由。 */
export function rewriteMetingSongs(raw: unknown, server: string): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((value) => {
    if (typeof value !== 'object' || value === null) return value;
    const song = { ...(value as Record<string, unknown>) };
    song.pic = upgradeHttpUrl(song.pic);
    song.lrc = upgradeHttpUrl(song.lrc);
    if (server === 'netease') {
      const songId = extractNeteaseSongId(song.url);
      if (songId) song.url = `/api/music/stream?id=${encodeURIComponent(songId)}`;
    } else {
      song.url = upgradeHttpUrl(song.url);
    }
    return song;
  });
}
