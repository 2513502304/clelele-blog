import type { HpoiCollectionResponse, HpoiCollectionState, HpoiProfile } from '@/types/hpoi';
import { HPOI_COLLECTION_STATES } from '@/types/hpoi';
import { createHpoiCollectionUrl, createHpoiProfileUrl } from './constants';
import { isHpoiCollectionPage, parseHpoiCollection, parseHpoiProfile } from './parser';

const REQUEST_TIMEOUT_MS = 10_000;
const HPOI_REQUEST_HEADERS = {
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137 Safari/537.36',
};

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: HPOI_REQUEST_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`Hpoi returned HTTP ${response.status}.`);
  return response.text();
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

/** Fetch an Hpoi profile and all configured collection states in parallel. */
export async function fetchHpoiCollection(userId: string): Promise<HpoiCollectionResponse> {
  const profilePromise = fetchHtml(createHpoiProfileUrl(userId)).then((html) => parseHpoiProfile(html, userId));
  const collectionPromises = HPOI_COLLECTION_STATES.map(async (state) => {
    const html = await fetchHtml(createHpoiCollectionUrl(userId, state));
    if (!isHpoiCollectionPage(html)) throw new Error(`Unexpected Hpoi response for collection state "${state}".`);
    return { state, items: parseHpoiCollection(html) };
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
