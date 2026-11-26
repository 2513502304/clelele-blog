import { createHash } from 'node:crypto';
import { fetchHfS3Read } from '@lib/hf-s3';
import { createStyleGallerySignedImageUrl, getStyleGalleryObjectBytes, putStyleGalleryObject } from '@lib/hf-s3-presign';
import { isAuthorizedStyleGalleryRequest } from '@lib/style-gallery-auth';
import { StyleGalleryClientError } from '@lib/style-gallery-errors';
import { ensureStyleGalleryExampleThumbnail } from '@lib/style-gallery-example-thumbnail';
import { createStyleGalleryExample, getStyleGalleryExampleObjectKey } from '@lib/style-gallery-example-upload';
import { getStyleGalleryExampleIdentity } from '@lib/style-gallery-examples';
import {
  draftImageKey,
  listGenerationJobs,
  noteOutput,
  recoverGeneration,
  reserveGeneration,
  runReservedGeneration,
} from '@lib/style-gallery-generation-jobs';
import {
  availableOutputs,
  type GenerationJob,
  generationRequest,
  publishedOutputs,
} from '@lib/style-gallery-generation-settings';
import { getStyleGalleryPlatform } from '@lib/style-gallery-platforms';
import { getStoredStyleGalleryItem, mutateStyleGalleryVisualIndex } from '@lib/style-gallery-store';
import { rememberStudioSource, studioOwner } from '@lib/style-gallery-studio-owner';
import { upsertStyleGalleryVisualRecords } from '@lib/style-gallery-visual-index';
import { updateStyleGalleryItemExamples } from '@lib/style-gallery-write';
import { waitUntil } from '@vercel/functions';
import type { APIContext } from 'astro';
import sharp from 'sharp';
import { z } from 'zod';

export const prerender = false;
const headers = { 'cache-control': 'private, no-store', vary: 'Authorization, X-API-Key, X-Gallery-Provider' };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
async function findJob(slug: string, id: string) {
  const job = (await listGenerationJobs(slug)).find((entry) => entry.id === id);
  if (!job) throw new StyleGalleryClientError('Unknown generation.', 404);
  return job;
}

/** Only the persisted server-side prompt, model and original bytes may be published. */
async function publish(slug: string, scope: string, job: GenerationJob, index: number, reviewedHash: string) {
  const item = await getStoredStyleGalleryItem(slug, { fresh: true });
  if (!item) throw new StyleGalleryClientError('Item no longer exists.', 404);
  if (publishedOutputs(job).includes(index)) return item.examples;
  if (!availableOutputs(job).includes(index)) throw new StyleGalleryClientError('Image is not ready.', 409);
  const bytes = await getStyleGalleryObjectBytes(draftImageKey(scope, job.id, index));
  if (!bytes) throw new Error('Missing draft.');
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== reviewedHash) throw new StyleGalleryClientError('Preview does not match original.', 409);
  // The native gallery runtime has the model weights. Phones only digest the reviewed bytes.
  const { computeStyleGalleryVisualFeatureFromBytes } = await import('@lib/style-gallery-visual-feature-node');
  const feature = await computeStyleGalleryVisualFeatureFromBytes(bytes, hash);
  const { format, width, height, autoOrient } = await sharp(bytes).metadata();
  if (!width || !height || !['png', 'jpeg', 'webp'].includes(format)) throw new Error('Invalid original.');
  const platform = getStyleGalleryPlatform(job.settings.platform);
  if (!platform) throw new Error('Invalid platform.');
  const example = createStyleGalleryExample(item.title, platform, hash, format === 'jpeg' ? 'jpg' : format);
  Object.assign(example, {
    id: index ? `${job.id}-${index + 1}` : job.id,
    generation: job.settings,
    note: job.prompt,
    dimensions: autoOrient ?? { width, height },
    uploadedAt: job.created,
  });
  await putStyleGalleryObject(getStyleGalleryExampleObjectKey(example), bytes, `image/${format}`);
  await ensureStyleGalleryExampleThumbnail(example.src, bytes);
  const identity = getStyleGalleryExampleIdentity(example);
  const { item: updated } = await updateStyleGalleryItemExamples(slug, (examples) => {
    // Request IDs originate in browsers. Only an exact match can repair an interrupted confirmation.
    const previous = examples.find((entry) => entry.id === example.id);
    if (previous) {
      if (
        previous.imageHash !== hash ||
        previous.model !== example.model ||
        previous.note !== job.prompt ||
        JSON.stringify(previous.generation) !== JSON.stringify(job.settings)
      )
        throw new StyleGalleryClientError('This example ID already belongs to another generation.', 409);
      return examples;
    }
    const existing = examples.find((entry) => getStyleGalleryExampleIdentity(entry) === identity);
    if (!existing) return [...examples, example];
    throw new StyleGalleryClientError('This image already belongs to another example on this platform.', 409);
  });
  // The same stable example ID repairs an interrupted visual-index write on confirmation retry.
  await mutateStyleGalleryVisualIndex((index) =>
    upsertStyleGalleryVisualRecords(index, [{ feature, kind: 'example', sourceSlug: slug, imageId: example.id }]),
  );
  await noteOutput(scope, job.id, index, true);
  return updated.examples;
}

interface StudioAccess {
  owner: string;
  slug: string;
  scope: string;
  platform: 'gpt-image' | 'pixai';
  apiKey: string;
}
function privateRoute(handle: (access: StudioAccess, request: Request) => Promise<Response>) {
  return async ({ params, request }: Pick<APIContext, 'params' | 'request'>) => {
    const auth = studioOwner(request);
    if (!auth) return json({ error: 'A provider API key is required.' }, 401);
    if (!params.slug || !/^[a-z0-9-]{1,160}$/i.test(params.slug)) return json({ error: 'Invalid item.' }, 400);
    try {
      // Possession of the same provider credential grants access across devices. Persist only the derived namespace.
      return await handle({ ...auth, slug: params.slug, scope: `${params.slug}/${auth.owner}` }, request);
    } catch (error) {
      if (error instanceof StyleGalleryClientError) return json({ error: error.message }, error.status);
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return json({ error: 'Invalid generation request.' }, 400);
      return json({ error: 'The generation record could not be accessed. Retry this operation.' }, 503);
    }
  };
}

export const GET = privateRoute(async ({ scope }, request) => {
  const preview = new URL(request.url).searchParams.get('preview');
  if (!preview) return json({ jobs: await listGenerationJobs(scope) });
  const job = await findJob(scope, z.string().uuid().parse(preview));
  const index = z.coerce
    .number()
    .int()
    .min(0)
    .max(3)
    .parse(new URL(request.url).searchParams.get('index') ?? 0);
  if (!availableOutputs(job).includes(index)) return json({ error: 'Preview is not ready.' }, 409);
  if (new URL(request.url).searchParams.get('thumb') === '1') {
    const originalKey = draftImageKey(scope, job.id, index),
      key = `${originalKey}.thumb.webp`;
    let thumb = await getStyleGalleryObjectBytes(key);
    if (!thumb) {
      const bytes = await getStyleGalleryObjectBytes(originalKey);
      if (!bytes) throw new Error('Missing draft.');
      thumb = await sharp(bytes).rotate().resize(144, 108, { fit: 'cover' }).webp({ quality: 72 }).toBuffer();
      await putStyleGalleryObject(key, thumb, 'image/webp');
    }
    return new Response(Uint8Array.from(thumb), { headers: { ...headers, 'content-type': 'image/webp' } });
  }
  // Stream the private original for review, download and a byte-for-byte confirmation.
  const response = await fetchHfS3Read(createStyleGallerySignedImageUrl(draftImageKey(scope, job.id, index)), {
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error('Missing image.');
  return new Response(response.body, {
    headers: { ...headers, 'content-type': response.headers.get('content-type') ?? 'application/octet-stream' },
  });
});

export const POST = privateRoute(async ({ slug, scope, owner, platform, apiKey }, request) => {
  const body = await request.json();
  if (body?.action === 'create') {
    const input = generationRequest.parse(body);
    if (platform !== input.settings.platform) return json({ error: 'Key and generation platform must match.' }, 400);
    const item = await getStoredStyleGalleryItem(slug, { fresh: true });
    if (!item) return json({ error: 'Unknown item.' }, 404);
    let reference: File | undefined;
    if (input.settings.platform === 'gpt-image' && input.settings.referenceHash) {
      const hash = input.settings.referenceHash;
      const image = item.images.find((image) => image.imageHash === hash);
      if (!image) throw new StyleGalleryClientError('Reference image does not belong to this item.', 400);
      const key = image.sourceImage.slice('/api/style-gallery/image/'.length);
      const bytes = await getStyleGalleryObjectBytes(key);
      if (!bytes || bytes.byteLength >= 50 * 1024 * 1024)
        throw new StyleGalleryClientError('Reference image is missing or exceeds 50 MiB.', 400);
      const { format } = await sharp(bytes).metadata();
      reference = new File([Uint8Array.from(bytes)], `reference.${format}`, { type: `image/${format}` });
    }
    await rememberStudioSource(owner, slug);
    if (await reserveGeneration(scope, input)) {
      // Node keeps the operation alive independently of the HTTP client. On Vercel extend the invocation as well.
      waitUntil(
        runReservedGeneration(scope, input, apiKey, reference).catch(() =>
          console.error('[style-gallery] Generation interrupted; retained draft for recovery.'),
        ),
      );
    }
    return json({ job: await findJob(scope, input.id) }, 202);
  }
  if (body?.action === 'confirm' && !isAuthorizedStyleGalleryRequest(request))
    return json({ error: 'Invalid gallery upload token.', code: 'invalid_upload_token' }, 403);
  const job = await findJob(scope, z.string().uuid().parse(body?.id));
  if (body.action === 'sync') {
    await recoverGeneration(scope, job, apiKey);
    return json({ job: await findJob(scope, job.id) });
  }
  if (body.action === 'confirm')
    return json({
      examples: await publish(
        slug,
        scope,
        job,
        z
          .number()
          .int()
          .min(0)
          .max(3)
          .parse(body.index ?? 0),
        z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(body.imageHash),
      ),
    });
  return json({ error: 'Unknown action.' }, 400);
});
