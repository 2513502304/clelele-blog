import { load } from 'cheerio';
import { isAllowedHpoiImageUrl } from './image';
import { isHpoiDetailPage, parseHpoiDetailScore } from './parser';

/** Public Hpoi reads only; validate each redirect before following it. Never forward credentials. */
export async function readHpoiSource(url: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let current = new URL(url);
      for (let redirects = 0; redirects < 4; redirects++) {
        if (
          current.protocol !== 'https:' ||
          current.username ||
          current.password ||
          current.port ||
          !(current.hostname === 'www.hpoi.net' || isAllowedHpoiImageUrl(current.href))
        )
          throw new Error('Invalid Hpoi source');
        const response = await fetch(current, {
          redirect: 'manual',
          signal: AbortSignal.timeout(20_000),
          headers: {
            referer: 'https://www.hpoi.net/',
            'user-agent': 'Mozilla/5.0',
            accept: '*/*',
          },
        });
        const location = response.headers.get('location');
        if (response.status >= 300 && response.status < 400 && location) {
          await response.body?.cancel();
          current = new URL(location, current);
          continue;
        }
        if (!response.ok) throw new Error(`Hpoi HTTP ${response.status}`);
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Empty Hpoi response');
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 24 * 1024 * 1024) {
            await reader.cancel();
            throw new Error('Hpoi response too large');
          }
          chunks.push(value);
        }
        return Buffer.concat(chunks);
      }
      throw new Error('Too many Hpoi redirects');
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw new Error('Hpoi source unavailable');
}

export function officialImages(html: string): string[] {
  const $ = load(html);
  return [
    ...new Set(
      $(html.includes('{av-masonry-loaded}') ? 'a[href]' : '.light-gallery-masonry a[href]')
        .map((_, e) => $(e).attr('href'))
        .get()
        .filter((url) => isAllowedHpoiImageUrl(url) && new URL(url).pathname.startsWith('/gk/pic/n/')),
    ),
  ];
}

/** Official galleries paginate in groups of 12; the public parameter really is spelled `ndoeId`. */
export async function readHpoiGallery(id: string) {
  const html = (await readHpoiSource(`https://www.hpoi.net/hobby/${id}`)).toString();
  if (!isHpoiDetailPage(html)) throw new Error('Unexpected Hpoi detail page');
  const $ = load(html);
  const cover = $('img')
    .map((_, e) => $(e).attr('src'))
    .get()
    .find((url) => isAllowedHpoiImageUrl(url) && url.includes('/gk/cover/n/'));
  if (!cover) throw new Error('Hpoi cover missing');
  const node = html.match(/fn\.init\(fn,\s*(\d+),\s*\d+\)/)?.[1];
  const urls = officialImages(html);
  if (urls.length >= 12) {
    if (!node) throw new Error('Hpoi gallery pagination missing');
    for (let offset = 12; ; offset += 12) {
      if (offset > 240) throw new Error('Hpoi gallery exceeds safety limit');
      const fragment = (
        await readHpoiSource(
          `https://www.hpoi.net/hobby/gallery/${node}?ndoeId=${node}&itemId=${id}&action=official&offset=${offset}&items=12`,
        )
      ).toString();
      if (!fragment.includes('{av-masonry-loaded}')) throw new Error('Unexpected Hpoi gallery page');
      const next = officialImages(fragment);
      if (next.some((url) => urls.includes(url))) throw new Error('Repeated Hpoi gallery page');
      urls.push(...next);
      if (next.length < 12) break;
    }
  }
  return { cover, urls, score: parseHpoiDetailScore(html) };
}
