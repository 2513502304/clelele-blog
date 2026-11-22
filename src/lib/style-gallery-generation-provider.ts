import { type GenerationRequest, pixAIVersions } from './style-gallery-generation-settings';

export class ProviderRejection extends Error {}

/** Never retry a paid POST. Only a definitive client rejection or terminal task is marked failed. */
async function providerJson(url: string, key: string | undefined, payload?: object | FormData) {
  if (!key) throw new ProviderRejection('Provider key is missing.');
  const response = await fetch(url, {
    method: payload ? 'POST' : 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(payload ? 240_000 : 30_000),
    headers: { authorization: `Bearer ${key}`, ...(!(payload instanceof FormData) && { 'content-type': 'application/json' }) },
    ...(payload && { body: payload instanceof FormData ? payload : JSON.stringify(payload) }),
  });
  if (!response.ok) {
    const message = `Provider HTTP ${response.status}`;
    if (response.status >= 400 && response.status < 500 && response.status !== 408) throw new ProviderRejection(message);
    throw new Error(message);
  }
  return response.json();
}

export async function submitGeneration(
  { prompt, settings }: GenerationRequest,
  apiKey: string,
  reference?: File,
): Promise<{ images: (Buffer | null)[] } | { taskId: string }> {
  if (settings.platform === 'gpt-image') {
    const { model, quality, size, compression, background } = settings;
    const fields = {
      model,
      quality,
      size,
      prompt,
      n: settings.count ?? 1,
      output_format: settings.format ?? 'png',
      ...(background && { background }),
      ...(compression !== undefined && { output_compression: compression }),
    };
    if (Boolean(settings.referenceHash) !== Boolean(reference)) throw new ProviderRejection('Reference image is missing.');
    const form = new FormData();
    if (reference) {
      for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
      form.append('image', reference);
    }
    const result = await providerJson(
      `https://api.openai.com/v1/images/${reference ? 'edits' : 'generations'}`,
      apiKey,
      reference ? form : fields,
    );
    if (!Array.isArray(result.data) || !result.data.length) throw new Error('Missing generated image.');
    return {
      images: result.data.map((entry: { b64_json?: string } | null) =>
        entry?.b64_json ? Buffer.from(entry.b64_json, 'base64') : null,
      ),
    };
  }
  const result = await pixai(apiKey, '/v2/image/create', {
    modelVersionId: pixAIVersions[settings.model],
    prompt,
    size: settings.size,
    aspectRatio: settings.ratio,
    mode: settings.mode,
    batchSize: settings.count ?? 1,
    promptHelper: settings.helper ?? 'disable',
    ...(settings.seed !== undefined && { seed: settings.seed }),
    ...(settings.negativePrompt && { negativePrompt: settings.negativePrompt }),
    ...(settings.contextImages?.length && { contextImages: settings.contextImages }),
  });
  return { taskId: providerId(result.id ?? result.taskId) };
}

function providerId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(value)) throw new Error('Invalid provider ID.');
  return value;
}
function pixai(apiKey: string, path: string, payload?: object) {
  return providerJson(`https://api.pixai.art${path}`, apiKey, payload);
}

/** An existing private task can be polled again after a server restart or an expired media URL. */
export async function readPixAIResult(
  taskId: string,
  apiKey: string,
  keep: (index: number, bytes: Buffer) => Promise<void>,
  alreadyStored: readonly number[] = [],
): Promise<number | null> {
  const task = await pixai(apiKey, `/v1/task/${providerId(taskId)}`);
  if ((task.id ?? task.taskId) !== taskId) throw new Error('Unexpected provider task.');
  if (['failed', 'error', 'cancelled', 'canceled'].includes(task.status))
    throw new TerminalPixAIError('PixAI generation failed.');
  if (!['completed', 'success', 'succeeded'].includes(task.status)) return null;
  const outputs = task.outputs;
  const batch = outputs?.batch?.map((entry: { mediaId: string }) => entry.mediaId);
  const ids: string[] = outputs?.mediaIds?.length
    ? outputs.mediaIds
    : batch?.length
      ? batch
      : outputs?.mediaId
        ? [outputs.mediaId]
        : [];
  const urls: string[] = outputs?.mediaUrls ?? [];
  const count = ids.length || urls.length;
  if (!count || count > 4) throw new Error('Unrecognized output batch.');
  // Save each successful sibling independently; retrying media reads never submits a generation.
  const results = await Promise.allSettled(
    Array.from({ length: count }, async (_, index) => {
      if (!alreadyStored.includes(index)) await keep(index, await downloadMedia(apiKey, ids[index], urls[index]));
    }),
  );
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
  return count;
}
async function downloadMedia(apiKey: string, mediaId: string | undefined, initialUrl: string | undefined) {
  let url = initialUrl;
  if (mediaId) {
    const media = await pixai(apiKey, `/v1/media/${providerId(mediaId)}`);
    url = (media.urls?.find((v: { variant: string }) => v.variant?.toLowerCase() === 'original') ?? media.urls?.[0])?.url;
  }
  if (!url) throw new Error('Missing media URL.');
  const source = new URL(url);
  if (source.protocol !== 'https:' || source.username || source.password) throw new Error('Invalid media URL.');
  // CDN requests have no API credentials. Accept only PixAI-owned media hosts.
  if (source.hostname !== 'd2doj8oszwtcqy.cloudfront.net' && !/(^|\.)(pixai\.art|pixai\.pics)$/i.test(source.hostname))
    throw new Error('Unknown PixAI media host.');
  const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error('PixAI media download is unavailable.');
  return Buffer.from(await response.arrayBuffer());
}
export class TerminalPixAIError extends Error {}
