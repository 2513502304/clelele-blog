import { createHash } from 'node:crypto';
import { fetchHfS3Read } from '@lib/hf-s3';
import {
  createStyleGallerySignedImageUrl,
  deleteStyleGalleryObject,
  getStyleGalleryObjectBytes,
  putStyleGalleryObject,
} from '@lib/hf-s3-presign';
import { rejectCrossOriginMutation } from '@lib/site-admin-auth';
import { isAuthorizedStyleGalleryRequest } from '@lib/style-gallery-auth';
import { StyleGalleryClientError } from '@lib/style-gallery-errors';
import { ensureStyleGalleryExampleThumbnail } from '@lib/style-gallery-example-thumbnail';
import { createStyleGalleryExample, getStyleGalleryExampleObjectKey } from '@lib/style-gallery-example-upload';
import { getStyleGalleryExampleIdentity } from '@lib/style-gallery-examples';
import {
  decideOutput,
  draftImageKey,
  listGenerationJobs,
  noteOutput,
  recoverGeneration,
  releasePublication,
  removeDraftFiles,
  reserveGeneration,
  resumeDraftCleanup,
  runReservedGeneration,
} from '@lib/style-gallery-generation-jobs';
import {
  availableOutputs,
  type GenerationJob,
  generationRequest,
  publishedOutputs,
} from '@lib/style-gallery-generation-settings';
import { getStyleGalleryViewer } from '@lib/style-gallery-github-auth';
import { getStyleGalleryPlatform } from '@lib/style-gallery-platforms';
import { getStoredStyleGalleryItem, getStyleGalleryVisualIndex, mutateStyleGalleryVisualIndex } from '@lib/style-gallery-store';
import { findAccountWork, rememberAccountWork } from '@lib/style-gallery-studio-account';
import { rememberStudioSource, studioOwner } from '@lib/style-gallery-studio-owner';
import { upsertStyleGalleryVisualRecords } from '@lib/style-gallery-visual-index';
import { updateStyleGalleryItemExamples } from '@lib/style-gallery-write';
import { waitUntil } from '@vercel/functions';
import type { APIContext } from 'astro';
import sharp from 'sharp';
import { z } from 'zod';

export const prerender = false;
const headers = { 'cache-control': 'private, no-store', vary: 'Cookie, Authorization, X-API-Key, X-Gallery-Provider' };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
async function findJob(slug: string, id: string) {
  const job = (await listGenerationJobs(slug)).find((entry) => entry.id === id);
  if (!job) throw new StyleGalleryClientError('Unknown generation.', 404);
  return job;
}

let publicationWarmup: Promise<void> | undefined;
/** Share read-only preparation across previews. An interrupted warmup falls back to the normal confirmation path. */
function warmPublication() {
  if (publicationWarmup) return publicationWarmup;
  publicationWarmup = Promise.allSettled([
    getStyleGalleryVisualIndex(),
    import('@lib/style-gallery-visual-embedding').then((module) => module.warmStyleGalleryVisualModel()),
  ])
    .then(() => undefined)
    .finally(() => {
      publicationWarmup = undefined;
    });
  return publicationWarmup;
}

/** Only the persisted server-side prompt, model and original bytes may be published. */
async function publish(slug: string, scope: string, job: GenerationJob, index: number, reviewedHash: string) {
  const timings: string[] = [];
  let started = performance.now();
  function finishStage(name: string) {
    const now = performance.now();
    timings.push(`${name};dur=${(now - started).toFixed(1)}`);
    started = now;
  }
  if (!availableOutputs(job).includes(index)) throw new StyleGalleryClientError('Image is not ready.', 409);
  const saved = publishedOutputs(job).includes(index);
  const [item, bytes] = await Promise.all([
    getStoredStyleGalleryItem(slug, { fresh: true }),
    saved ? null : getStyleGalleryObjectBytes(draftImageKey(scope, job.id, index)),
  ]);
  if (!item) throw new StyleGalleryClientError('Item no longer exists.', 404);
  if (saved) return json({ examples: item.examples });
  finishStage('draft');
  if (!bytes) throw new Error('Missing draft.');
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== reviewedHash) throw new StyleGalleryClientError('Preview does not match original.', 409);
  // The native gallery runtime has the model weights. Phones only digest the reviewed bytes.
  const { computeStyleGalleryVisualFeatureFromBytes } = await import('@lib/style-gallery-visual-feature-node');
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
  const preparation = warmPublication();
  const attempt = await decideOutput(scope, job.id, index, 'publish');
  // Content-addressed assets are independent. Commit metadata only after all three are ready.
  const [feature] = await Promise.all([
    computeStyleGalleryVisualFeatureFromBytes(bytes, hash),
    putStyleGalleryObject(getStyleGalleryExampleObjectKey(example), bytes, `image/${format}`),
    ensureStyleGalleryExampleThumbnail(example.src, bytes),
  ]).catch(async (error) => {
    await releasePublication(scope, job.id, index, attempt);
    throw error;
  });
  finishStage('assets');
  const identity = getStyleGalleryExampleIdentity(example);
  let rejectedByTransform = false;
  const { item: updated } = await updateStyleGalleryItemExamples(slug, (examples) => {
    // Request IDs originate in browsers. Only an exact match can repair an interrupted confirmation.
    const previous = examples.find((entry) => entry.id === example.id);
    if (previous) {
      if (
        previous.imageHash !== hash ||
        previous.model !== example.model ||
        previous.note !== job.prompt ||
        JSON.stringify(previous.generation) !== JSON.stringify(job.settings)
      ) {
        rejectedByTransform = true;
        throw new StyleGalleryClientError('This example ID already belongs to another generation.', 409);
      }
      return examples;
    }
    const existing = examples.find((entry) => getStyleGalleryExampleIdentity(entry) === identity);
    if (!existing) return [...examples, example];
    rejectedByTransform = true;
    throw new StyleGalleryClientError('This image already belongs to another example on this platform.', 409);
  }).catch(async (error) => {
    if (rejectedByTransform && error instanceof StyleGalleryClientError)
      await releasePublication(scope, job.id, index, attempt);
    throw error;
  });
  finishStage('metadata');
  // The same stable example ID repairs an interrupted visual-index write on confirmation retry.
  await preparation;
  await mutateStyleGalleryVisualIndex((index) =>
    upsertStyleGalleryVisualRecords(index, [{ feature, kind: 'example', sourceSlug: slug, imageId: example.id }]),
  );
  finishStage('visual');
  await noteOutput(scope, job.id, index, true);
  finishStage('receipt');
  const response = json({ examples: updated.examples });
  response.headers.set('Server-Timing', timings.join(', '));
  return response;
}

interface StudioAccess {
  owner: string;
  slug: string;
  scope: string;
  platform: 'gpt-image' | 'pixai';
  apiKey: string;
  viewerId?: number;
}
function privateRoute(handle: (access: StudioAccess, request: Request) => Promise<Response>) {
  return async ({
    params,
    request,
    cookies,
  }: Pick<APIContext, 'params' | 'request'> & Partial<Pick<APIContext, 'cookies'>>) => {
    if (!params.slug || !/^[a-z0-9-]{1,160}$/i.test(params.slug)) return json({ error: 'Invalid item.' }, 400);
    const slug = params.slug;
    try {
      const viewer = cookies && getStyleGalleryViewer(cookies);
      if (viewer && request.method === 'POST' && rejectCrossOriginMutation(request, new URL(request.url)))
        return json({ error: 'Invalid request origin.' }, 403);
      const auth = studioOwner(request);
      if (auth) return await handle({ ...auth, slug, scope: `${slug}/${auth.owner}`, viewerId: viewer?.id }, request);
      if (!viewer || request.headers.get('x-gallery-review-session') !== '1')
        return json({ error: 'A private workspace identity is required.' }, 401);
      let id = new URL(request.url).searchParams.get('preview');
      if (request.method === 'POST') {
        const body = await request.clone().json();
        if (body.action !== 'confirm' && body.action !== 'discard')
          return json({ error: 'Provider credentials required.' }, 403);
        id = body.id;
      }
      if (!id || !z.string().uuid().safeParse(id).success) return json({ error: 'Select a review output.' }, 400);
      const work = await findAccountWork(viewer.id, slug, request.headers.get('x-gallery-provider'), id);
      if (!work) return json({ error: 'Unknown generation.' }, 404);
      return await handle({ ...work, slug, scope: `${slug}/${work.owner}`, apiKey: '' }, request);
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
  if (!preview) {
    const jobs = await listGenerationJobs(scope);
    resumeDraftCleanup(scope, jobs);
    return json({ jobs });
  }
  const job = await findJob(scope, z.string().uuid().parse(preview));
  const index = z.coerce
    .number()
    .int()
    .min(0)
    .max(3)
    .parse(new URL(request.url).searchParams.get('index') ?? 0);
  if (!availableOutputs(job).includes(index)) return json({ error: 'Preview is not ready.' }, 409);
  const thumbStyle = new URL(request.url).searchParams.get('thumb');
  if (thumbStyle === '1' || thumbStyle === 'fit') {
    const originalKey = draftImageKey(scope, job.id, index),
      key = thumbStyle === 'fit' ? `${originalKey}.fit.webp` : `${originalKey}.thumb.webp`;
    let thumb = await getStyleGalleryObjectBytes(key);
    if (!thumb) {
      const bytes = await getStyleGalleryObjectBytes(originalKey);
      if (!bytes) throw new Error('Missing draft.');
      const image = sharp(bytes).rotate();
      const resized =
        thumbStyle === 'fit'
          ? image.resize(360, 540, { fit: 'inside', withoutEnlargement: true })
          : image.resize(144, 108, { fit: 'cover' });
      thumb = await resized.webp({ quality: 76 }).toBuffer();
      await putStyleGalleryObject(key, thumb, 'image/webp');
      // A discard may have removed the original and existing thumbnails while Sharp was still encoding.
      if ((await findJob(scope, job.id)).discarded?.includes(index)) {
        await deleteStyleGalleryObject(key);
        return json({ error: 'Output was discarded.' }, 409);
      }
    }
    return new Response(Uint8Array.from(thumb), { headers: { ...headers, 'content-type': 'image/webp' } });
  }
  // Stream the private original for review, download and a byte-for-byte confirmation.
  const response = await fetchHfS3Read(createStyleGallerySignedImageUrl(draftImageKey(scope, job.id, index)), {
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error('Missing image.');
  if (!publishedOutputs(job).includes(index)) waitUntil(warmPublication());
  return new Response(response.body, {
    headers: { ...headers, 'content-type': response.headers.get('content-type') ?? 'application/octet-stream' },
  });
});

export const POST = privateRoute(async ({ slug, scope, owner, platform, apiKey, viewerId }, request) => {
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
    if (await reserveGeneration(scope, input, viewerId)) {
      // Node keeps the operation alive independently of the HTTP client. On Vercel extend the invocation as well.
      waitUntil(
        runReservedGeneration(scope, input, apiKey, reference).catch(() =>
          console.error('[style-gallery] Generation interrupted; retained draft for recovery.'),
        ),
      );
    }
    const job = await findJob(scope, input.id);
    // Retrying an acknowledged create can repair discovery, but cannot attach somebody else's earlier job.
    if (viewerId && job.reviewAccount === viewerId) await rememberAccountWork(viewerId, { slug, platform, owner, id: job.id });
    return json({ job }, 202);
  }
  if (body?.action === 'confirm' && !isAuthorizedStyleGalleryRequest(request))
    return json({ error: 'Invalid gallery upload token.', code: 'invalid_upload_token' }, 403);
  const job = await findJob(scope, z.string().uuid().parse(body?.id));
  if (body.action === 'discard') {
    const index = z.number().int().min(0).max(3).parse(body.index);
    if (!job.discarded?.includes(index)) {
      // Older confirmations may have committed the public example before writing their private receipt.
      const exampleId = index ? `${job.id}-${index + 1}` : job.id;
      const item = await getStoredStyleGalleryItem(slug, { fresh: true });
      const existing = item?.examples.find(
        (example) =>
          example.id === exampleId &&
          example.note === job.prompt &&
          JSON.stringify(example.generation) === JSON.stringify(job.settings),
      );
      if (existing) {
        const bytes = await getStyleGalleryObjectBytes(draftImageKey(scope, job.id, index));
        if (!bytes || createHash('sha256').update(bytes).digest('hex') === existing.imageHash)
          throw new StyleGalleryClientError('This output is already in the sub-gallery.', 409);
      }
    }
    await decideOutput(scope, job.id, index, 'discard');
    await removeDraftFiles(scope, job.id, index);
    return json({ discarded: index });
  }
  if (body.action === 'sync') {
    await recoverGeneration(scope, job, apiKey);
    return json({ job: await findJob(scope, job.id) });
  }
  if (body.action === 'confirm')
    return publish(
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
    );
  return json({ error: 'Unknown action.' }, 400);
});
