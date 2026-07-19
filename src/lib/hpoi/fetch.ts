import type { HpoiCollectionResponse, HpoiCollectionState, HpoiProfile } from '@/types/hpoi';
import { HPOI_COLLECTION_STATES } from '@/types/hpoi';
import { createHpoiCollectionUrl, createHpoiProfileUrl } from './constants';
import { isHpoiCollectionPage, parseHpoiCollection, parseHpoiCollectionPageCount, parseHpoiProfile } from './parser';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_COLLECTION_PAGES = 100;
const HPOI_REQUEST_HEADERS = {
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137 Safari/537.36',
};

async function fetchHtml(url: string, body?: URLSearchParams): Promise<string> {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: HPOI_REQUEST_HEADERS,
    body,
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`Hpoi returned HTTP ${response.status}.`);
  return response.text();
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

/**
 * 获取某个 Hpoi 收藏状态的完整条目集合。
 *
 * 第 1 页使用公开收藏页 GET 请求，后续页复用页面滚动加载器的 POST 参数并发获取。页数来自首屏脚本，
 * 同时受 `MAX_COLLECTION_PAGES` 限制，避免上游页面结构异常时发出失控请求。最终按 Hpoi ID 去重并保留首次顺序。
 */
export async function fetchHpoiCollectionState(
  userId: string,
  state: HpoiCollectionState,
): Promise<ReturnType<typeof parseHpoiCollection>> {
  const collectionUrl = createHpoiCollectionUrl(userId, state);
  const initialHtml = await fetchHtml(collectionUrl);
  if (!isHpoiCollectionPage(initialHtml)) throw new Error(`Unexpected Hpoi response for collection state "${state}".`);

  const pageCount = parseHpoiCollectionPageCount(initialHtml);
  if (pageCount > MAX_COLLECTION_PAGES) {
    throw new Error(`Hpoi collection state "${state}" exceeds the ${MAX_COLLECTION_PAGES}-page safety limit.`);
  }

  const endpoint = new URL(collectionUrl);
  endpoint.search = '';
  const remainingPages = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) => {
      const page = index + 2;
      return fetchHtml(endpoint.toString(), createCollectionPageBody(collectionUrl, page, pageCount));
    }),
  );

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
  const profilePromise = fetchHtml(createHpoiProfileUrl(userId)).then((html) => parseHpoiProfile(html, userId));
  const collectionPromises = HPOI_COLLECTION_STATES.map(async (state) => {
    return { state, items: await fetchHpoiCollectionState(userId, state) };
  });

  const [profileResult, ...collectionResults] = await Promise.allSettled([profilePromise, ...collectionPromises]);
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
