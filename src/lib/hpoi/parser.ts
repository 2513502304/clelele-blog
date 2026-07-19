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

/** 解析 Hpoi 公开个人页中的基础资料和“我的收藏/我的预定”汇总统计。 */
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

/**
 * 兼容 Hpoi 当前的大卡片和紧凑列表两种公开收藏视图。
 *
 * 小图路径 `/gk/cover/s/` 会提升为同源的普通清晰度 `/gk/cover/n/`；条目按 Hpoi ID 去重，
 * 同时保留原始出荷文案和供稳定排序使用的 ISO 日期。
 */
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

/** 读取 Hpoi 收藏页初始化脚本中的懒加载总页数；未找到时按仅有首屏处理。 */
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

/** 通过页面容器区分“有效但为空的收藏页”和拦截页、错误页等非预期响应。 */
export function isHpoiCollectionPage(html: string): boolean {
  const $ = load(html);
  return $('.hpoi-collect-container').length > 0;
}
