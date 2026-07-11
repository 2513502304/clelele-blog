import { load } from 'cheerio';
import type { HpoiCollectionItem, HpoiProfile, HpoiProfileStats } from '@/types/hpoi';
import { createHpoiProfileUrl, HPOI_ORIGIN } from './constants';

const STAT_FIELDS: Record<string, keyof HpoiProfileStats> = {
  已入手: 'owned',
  历史消费: 'totalSpent',
  日亚涨跌: 'amazonChange',
  想买: 'wanted',
  预订: 'preordered',
  预定: 'preordered',
  待补款: 'pendingPayment',
};

const EMPTY_STATS: HpoiProfileStats = {
  owned: null,
  totalSpent: null,
  amazonChange: null,
  wanted: null,
  preordered: null,
  pendingPayment: null,
};

function cleanText(value: string | undefined): string | null {
  const cleaned = value?.replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function toAbsoluteUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value, HPOI_ORIGIN).toString();
  } catch {
    return null;
  }
}

function toHighResolutionCoverUrl(value: string | undefined): string | null {
  const absoluteUrl = toAbsoluteUrl(value);
  if (!absoluteUrl) return null;

  const url = new URL(absoluteUrl);
  if (url.hostname === 'rfx.hpoi.net' && url.pathname.startsWith('/gk/cover/s/')) {
    url.pathname = url.pathname.replace('/gk/cover/s/', '/gk/cover/n/');
  }
  return url.toString();
}

function parseReleaseDate(value: string | null): string | null {
  const match = value?.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/** Parse the public profile header and collection statistics from an Hpoi profile page. */
export function parseHpoiProfile(html: string, userId: string): HpoiProfile {
  const $ = load(html);
  const stats = { ...EMPTY_STATS };

  $('.hpoi-item-top a').each((_, element) => {
    const label = cleanText($(element).find('.hpoi-stats-title').text());
    const value = cleanText($(element).find('.hpoi-stats-label').text());
    const field = label ? STAT_FIELDS[label] : undefined;
    if (field) stats[field] = value;
  });

  return {
    userId,
    name: cleanText($('.hpoi-user-nickname').first().text()) ?? 'Hpoi',
    avatarUrl: toAbsoluteUrl($('.hpoi-user-avatar img').first().attr('src')),
    signature: cleanText($('.hpoi-user-sign').first().text()),
    profileUrl: createHpoiProfileUrl(userId),
    stats,
  };
}

/** Parse either of Hpoi's current large-card and compact-list collection views. */
export function parseHpoiCollection(html: string): HpoiCollectionItem[] {
  const $ = load(html);
  const items = new Map<string, HpoiCollectionItem>();

  $('.collect-hobby-list-large .item, .collect-hobby-list-small .item').each((_, element) => {
    const item = $(element);
    const cover = item.find('a.cover[href]').first();
    const nameLink = item.find('a.name[href], .name a[href]').first();
    const href = cover.attr('href') ?? nameLink.attr('href');
    const id = href?.match(/(?:^|\/)hobby\/(\d+)/)?.[1];
    if (!id) return;

    const image = item.find('img').first();
    const title =
      cleanText(nameLink.attr('title')) ?? cleanText(nameLink.text()) ?? cleanText(image.attr('alt')) ?? `Hpoi #${id}`;

    const releaseText = cleanText(item.find('.pay').first().text());
    items.set(id, {
      id,
      title,
      imageUrl: toHighResolutionCoverUrl(image.attr('src')),
      detailUrl: `${HPOI_ORIGIN}/hobby/${id}`,
      releaseText,
      releaseDate: parseReleaseDate(releaseText),
      score: cleanText(item.find('.score small').first().text()),
    });
  });

  return [...items.values()];
}

/** Read the lazy-load page count embedded in Hpoi's collection bootstrap script. */
export function parseHpoiCollectionPageCount(html: string): number {
  const $ = load(html);
  for (const script of $('script').toArray()) {
    const match = $(script)
      .text()
      .match(/pageCount\s*:\s*['"](\d+)['"]/);
    if (!match) continue;

    const pageCount = Number.parseInt(match[1], 10);
    if (pageCount > 0) return pageCount;
  }
  return 1;
}

/** Distinguish a valid empty collection from an unrelated block/error page. */
export function isHpoiCollectionPage(html: string): boolean {
  const $ = load(html);
  return $('.hpoi-collect-container').length > 0;
}
