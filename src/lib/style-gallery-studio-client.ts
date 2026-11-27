import type { GenerationPlatform } from './style-gallery-generation-settings';

const sessionKeys = new Map<GenerationPlatform, string>();
export function readProviderKey(platform: GenerationPlatform) {
  try {
    return localStorage.getItem(`gallery-generation:key:${platform}`) ?? '';
  } catch {
    return sessionKeys.get(platform) ?? '';
  }
}
export function rememberProviderKey(platform: GenerationPlatform, value: string) {
  sessionKeys.set(platform, value);
  try {
    const name = `gallery-generation:key:${platform}`;
    if (value) localStorage.setItem(name, value);
    else localStorage.removeItem(name);
  } catch {
    /* Storage-restricted browsers can still generate in this tab. */
  }
}

export async function studioRequest(
  url: string,
  platform: GenerationPlatform,
  apiKey: string,
  body?: object,
  signal?: AbortSignal,
  uploadToken?: string,
  invalidUploadMessage?: string,
) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    cache: 'no-store',
    redirect: 'error',
    signal,
    headers: {
      'x-gallery-provider': platform,
      ...(apiKey ? { 'x-api-key': apiKey } : { 'x-gallery-review-session': '1' }),
      ...(uploadToken && { authorization: `Bearer ${uploadToken}` }),
      ...(body && { 'content-type': 'application/json' }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (response.status === 403 && data?.code === 'invalid_upload_token' && invalidUploadMessage)
      throw new Error(invalidUploadMessage);
    throw new Error(data?.error ?? `HTTP ${response.status}`);
  }
  return response;
}

/** Older workbenches already persisted a per-item draft, even before server-side discovery existed. */
export function legacyStudioSources(platform: GenerationPlatform) {
  const slugs = new Set<string>();
  try {
    for (const key of Object.keys(localStorage)) {
      const match = /^gallery-generation:([a-z0-9-]{1,160})(?::(gpt-image|pixai):request)?$/.exec(key);
      if (!match) continue;
      if (match[2] === platform) slugs.add(match[1]);
      else if (!match[2]) {
        try {
          if (JSON.parse(localStorage.getItem(key) ?? 'null')?.settings?.platform === platform) slugs.add(match[1]);
        } catch {
          /* Ignore a malformed legacy draft. */
        }
      }
    }
  } catch {
    /* Remote receipts also work with restricted browser storage. */
  }
  return [...slugs];
}

/** Notify other open inboxes without putting a credential, prompt or image into browser events. */
export function notifyStudioChange() {
  try {
    localStorage.setItem('gallery-generation:changed', crypto.randomUUID());
  } catch {
    /* Optional cross-tab refresh. */
  }
}

/** Only bytes displayed to the reviewer may be acknowledged by the publication endpoint. */
export async function confirmStudioOutput(
  slug: string,
  platform: GenerationPlatform,
  apiKey: string,
  id: string,
  index: number,
  bytes: Blob,
  uploadToken: string,
  invalidMessage: string,
) {
  const digest = await crypto.subtle.digest('SHA-256', await bytes.arrayBuffer());
  const imageHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  const result = await (
    await studioRequest(
      `/api/style-gallery/generations/${encodeURIComponent(slug)}`,
      platform,
      apiKey,
      { action: 'confirm', id, index, imageHash },
      undefined,
      uploadToken.trim(),
      invalidMessage,
    )
  ).json();
  notifyStudioChange();
  return result;
}

/** Discard only this private output. Other tabs refresh their own authorized list. */
export async function discardStudioOutput(
  slug: string,
  platform: GenerationPlatform,
  apiKey: string,
  id: string,
  index: number,
) {
  await studioRequest(`/api/style-gallery/generations/${encodeURIComponent(slug)}`, platform, apiKey, {
    action: 'discard',
    id,
    index,
  });
  notifyStudioChange();
}
