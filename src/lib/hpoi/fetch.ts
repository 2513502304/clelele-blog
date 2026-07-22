import type { HpoiCollectionResponse, HpoiCollectionState, HpoiProfile } from '@/types/hpoi';
import { HPOI_COLLECTION_STATES } from '@/types/hpoi';
import { createHpoiCollectionUrl, createHpoiProfileUrl } from './constants';
import {
  isHpoiCollectionFragment,
  isHpoiCollectionPage,
  isHpoiProfilePage,
  parseHpoiCollection,
  parseHpoiCollectionPageCount,
  parseHpoiProfile,
} from './parser';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REQUEST_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;
const MAX_COLLECTION_PAGES = 100;
const HPOI_REQUEST_HEADERS = {
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137 Safari/537.36',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 每个 Hpoi 页面独立超时并重试，避免一次上游抖动污染整段 CDN 缓存周期。 */
async function fetchHtml(url: string, body?: URLSearchParams, validate?: (html: string) => boolean): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: HPOI_REQUEST_HEADERS,
        body: body ? new URLSearchParams(body) : undefined,
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Hpoi returned HTTP ${response.status}.`);
      const html = await response.text();
      if (validate && !validate(html)) throw new Error('Hpoi returned an unexpected page instead of the requested data.');
      return html;
    } catch (error) {
      lastError = error;
      if (attempt === MAX_REQUEST_ATTEMPTS) break;
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 100));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Hpoi request failed.');
}

function createCollectionPageBody(collectionUrl: string, page: number, pageCount: number): URLSearchParams {
  const params = new URL(collectionUrl).searchParams;
  params.delete('state');
  params.set('page', String(page));
  params.set('pageCount', String(pageCount));
  params.set('tag', '');
  params.set('part', 'true');
  return params;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const failures: unknown[] = [];
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length && failures.length === 0) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(items[index]);
      } catch (error) {
        failures.push(error);
      }
    }
  }
  // 首次失败后不再领取新任务，但要等待已经在途的 worker 收束，避免嵌套 pool 越过并发边界。
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failures.length > 0) throw failures[0];
  return results;
}

/** Hpoi 抓取始终使用当前任务量的一半并发，向上取整且至少保留一个 worker。 */
function getHpoiConcurrency(taskCount: number): number {
  return Math.max(1, Math.ceil(taskCount / 2));
}

/**
 * 获取某个 Hpoi 收藏状态中能够发现的条目集合。
 *
 * 第 1 页使用公开收藏页 GET 请求，后续页复用页面滚动加载器的 POST 参数并发获取。页数来自首屏脚本，
 * 同时受 `MAX_COLLECTION_PAGES` 限制；脚本缺少页数元数据时只能按首屏处理，不能保证发现后续条目。
 * 最终按 Hpoi ID 去重并保留首次顺序。
 */
export async function fetchHpoiCollectionState(
  userId: string,
  state: HpoiCollectionState,
): Promise<ReturnType<typeof parseHpoiCollection>> {
  const collectionUrl = createHpoiCollectionUrl(userId, state);
  const initialHtml = await fetchHtml(collectionUrl, undefined, isHpoiCollectionPage);

  const pageCount = parseHpoiCollectionPageCount(initialHtml);
  if (pageCount > MAX_COLLECTION_PAGES) {
    throw new Error(`Hpoi collection state "${state}" exceeds the ${MAX_COLLECTION_PAGES}-page safety limit.`);
  }

  const endpoint = new URL(collectionUrl);
  endpoint.search = '';
  const pageTasks = Array.from({ length: pageCount - 1 }, (_, index) => index + 2);
  const remainingPages = await mapWithConcurrency(pageTasks, getHpoiConcurrency(pageTasks.length), (page) => {
    return fetchHtml(endpoint.toString(), createCollectionPageBody(collectionUrl, page, pageCount), isHpoiCollectionFragment);
  });

  const items = [initialHtml, ...remainingPages].flatMap(parseHpoiCollection);
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function createFallbackProfile(userId: string): HpoiProfile {
  return {
    userId,
    name: 'Hpoi',
    avatarUrl: null,
    signature: null,
    profileUrl: createHpoiProfileUrl(userId),
    stats: {
      owned: null,
      totalSpent: null,
      amazonChange: null,
      wanted: null,
      preordered: null,
      pendingPayment: null,
    },
  };
}

/**
 * 并发获取公开个人资料与全部收藏状态。
 *
 * 单个状态失败会以 `warnings` 返回，其余状态仍可展示；只有全部收藏状态都失败时才整体报错。
 * 个人资料失败则使用不含统计值的占位资料，不阻断收藏列表。
 */
export async function fetchHpoiCollection(userId: string): Promise<HpoiCollectionResponse> {
  // 创建时立即吸收 rejection；分类抓取可能持续数十秒，不能让 profile 失败在等待期间变成未处理拒绝。
  const profileResultPromise = fetchHtml(createHpoiProfileUrl(userId), undefined, isHpoiProfilePage).then(
    (html) => ({ status: 'fulfilled' as const, value: parseHpoiProfile(html, userId) }),
    (reason) => ({ status: 'rejected' as const, reason }),
  );
  // 分类与各自分页都使用任务量的一半并发，避免失败时所有 worker 在同一时刻同步 retry。
  const collectionResults = await mapWithConcurrency(
    HPOI_COLLECTION_STATES,
    getHpoiConcurrency(HPOI_COLLECTION_STATES.length),
    async (state) => {
      try {
        return { status: 'fulfilled' as const, value: { state, items: await fetchHpoiCollectionState(userId, state) } };
      } catch (reason) {
        return { status: 'rejected' as const, reason };
      }
    },
  );
  const profileResult = await profileResultPromise;
  const warnings: Array<HpoiCollectionState | 'profile'> = [];
  const collections: HpoiCollectionResponse['collections'] = {
    all: [],
    care: [],
    want: [],
    preorder: [],
    buy: [],
    resell: [],
  };

  const profile = profileResult.status === 'fulfilled' ? profileResult.value : createFallbackProfile(userId);
  if (profileResult.status === 'rejected') warnings.push('profile');

  let successfulCollections = 0;
  collectionResults.forEach((result, index) => {
    const state = HPOI_COLLECTION_STATES[index];
    if (result.status === 'fulfilled') {
      collections[state] = result.value.items;
      successfulCollections += 1;
    } else {
      console.warn(`[hpoi] Failed to load collection state "${state}" after retries:`, result.reason);
      warnings.push(state);
    }
  });

  if (successfulCollections === 0) throw new Error('All Hpoi collection requests failed.');

  return {
    profile,
    collections,
    fetchedAt: new Date().toISOString(),
    warnings,
  };
}
