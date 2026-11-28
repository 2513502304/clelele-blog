import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { waitUntil } from '@vercel/functions';
import sharp from 'sharp';
import {
  deleteStyleGalleryObject,
  getStyleGalleryObjectTextSnapshot,
  headStyleGalleryObject,
  putStyleGalleryObject,
  StyleGalleryObjectConflictError,
} from './hf-s3-presign';
import { mapWithConcurrency } from './map-with-concurrency';
import { StyleGalleryClientError } from './style-gallery-errors';
import { ProviderRejection, readPixAIResult, submitGeneration, TerminalPixAIError } from './style-gallery-generation-provider';
import {
  type GenerationJob,
  type GenerationRequest,
  publishedOutputs,
  receivedOutputs,
} from './style-gallery-generation-settings';

const taskReceipt = (scope: string, id: string) => `generation-drafts/${scope}/${id}.task`;
const manifest = (slug: string) => `generation-drafts/${slug}/jobs.json`;
export const draftImageKey = (slug: string, id: string, index = 0) =>
  `generation-drafts/${slug}/${id}${index ? `-${index}` : ''}.image`;

/** Request-local revision for conditional updates of one private workspace. */
export async function readGenerationManifest(slug: string) {
  const { text, etag } = await getStyleGalleryObjectTextSnapshot(manifest(slug));
  if (text && !etag) throw new Error('Missing generation manifest revision.');
  return { scope: slug, jobs: (text ? JSON.parse(text) : []) as GenerationJob[], etag };
}
export async function listGenerationJobs(slug: string) {
  return (await readGenerationManifest(slug)).jobs;
}

/** Retry only bookkeeping. Cross-instance ETag conflicts must never replay a provider submission. */
export type GenerationManifest = Awaited<ReturnType<typeof readGenerationManifest>>;

async function editJobs(slug: string, edit: (jobs: GenerationJob[]) => GenerationJob[] | null, cursor?: GenerationManifest) {
  // Only a successful conditional write advances the caller's revision. Conflicts always reload and reapply.
  if (cursor && cursor.scope !== slug) throw new Error('Generation manifest scope mismatch.');
  for (let attempt = 0; attempt < 6; attempt++) {
    const { jobs, etag } = attempt === 0 && cursor?.etag ? cursor : await readGenerationManifest(slug);
    const next = edit(jobs);
    if (!next) return false;
    try {
      const nextEtag = await putStyleGalleryObject(
        manifest(slug),
        Buffer.from(JSON.stringify(next)),
        'application/json',
        etag ? { ifMatch: etag } : { ifNoneMatch: '*' },
      );
      if (cursor) Object.assign(cursor, { jobs: next, etag: nextEtag });
      return true;
    } catch (error) {
      if (!(error instanceof StyleGalleryObjectConflictError) || attempt === 5) throw error;
      await delay(50 * (attempt + 1));
    }
  }
  return false;
}

/** The client request ID survives a lost response. Exactly one reservation owns the paid call. */
export async function reserveGeneration(slug: string, request: GenerationRequest, reviewAccount?: number) {
  return editJobs(slug, (jobs) => {
    const existing = jobs.find((job) => job.id === request.id);
    if (existing) {
      if (existing.prompt !== request.prompt || JSON.stringify(existing.settings) !== JSON.stringify(request.settings))
        throw new StyleGalleryClientError('Generation ID already has different settings.', 409);
      return null;
    }
    return [{ ...request, reviewAccount, created: new Date().toISOString(), state: 'running' }, ...jobs];
  });
}

export async function markGeneration(
  slug: string,
  id: string,
  patch: Partial<Pick<GenerationJob, 'state' | 'taskId' | 'error'>>,
) {
  return editJobs(slug, (jobs) => {
    const job = jobs.find((entry) => entry.id === id);
    // A late worker may finish after another tab has already confirmed the same image.
    if (!job || job.state === 'saved' || (job.state === 'ready' && patch.state !== 'saved')) return null;
    return jobs.map((entry) => (entry === job ? { ...entry, ...patch } : entry));
  });
}

async function checkpoint<T>(write: () => Promise<T>) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write();
    } catch (error) {
      if (attempt >= 4) throw error;
      await delay(attempt * 500);
    }
  }
}

/** Merge a single output checkpoint without losing results saved concurrently in another tab. */
export async function noteOutput(slug: string, id: string, index: number, published = false, cursor?: GenerationManifest) {
  let retained = true;
  await editJobs(
    slug,
    (jobs) => {
      const job = jobs.find((j) => j.id === id);
      if (!job) throw new Error('Missing generation record.');
      const available = receivedOutputs(job),
        saved = publishedOutputs(job),
        count = job.settings.count ?? 1;
      if (index < 0 || index >= count) throw new Error('Output index exceeds the requested batch.');
      if (job.discarded?.includes(index)) {
        if (!published) {
          retained = false;
          return null;
        }
        throw new StyleGalleryClientError('This output was discarded.', 409);
      }
      if (available.includes(index) && (!published || saved.includes(index))) return null;
      const nextAvailable = [...new Set([...available, index])].sort((a, b) => a - b);
      const nextSaved = published ? [...new Set([...saved, index])] : saved;
      const requested = Array.from({ length: count }, (_, i) => i);
      const state = requested.every((i) => nextSaved.includes(i) || job.discarded?.includes(i))
        ? 'saved'
        : requested.every((i) => nextAvailable.includes(i))
          ? 'ready'
          : job.state;
      const publishAttempts = { ...job.publishAttempts };
      if (published) delete publishAttempts[index];
      return jobs.map((j) =>
        j === job
          ? {
              ...j,
              available: nextAvailable,
              published: nextSaved,
              publishAttempts,
              publishing: j.publishing?.filter((i) => !nextSaved.includes(i)),
              state,
            }
          : j,
      );
    },
    cursor,
  );
  return retained;
}

/** A conditional manifest write chooses between publication and deletion before either can touch public metadata. */
export async function decideOutput(
  scope: string,
  id: string,
  index: number,
  action: 'publish' | 'discard',
  cursor?: GenerationManifest,
) {
  const attempt = randomUUID();
  await editJobs(
    scope,
    (jobs) => {
      const job = jobs.find((j) => j.id === id);
      if (!job || !receivedOutputs(job).includes(index)) throw new StyleGalleryClientError('Image is not ready.', 409);
      const discarded = job.discarded?.includes(index);
      const saving = publishedOutputs(job).includes(index) || job.publishing?.includes(index);
      if ((discarded && action === 'publish') || (saving && action === 'discard'))
        throw new StyleGalleryClientError('This output already has another review decision.', 409);
      if (discarded || publishedOutputs(job).includes(index)) return null;
      const field = action === 'discard' ? 'discarded' : 'publishing';
      // Materialize legacy implicit index 0 before adding the first per-output decision.
      const next = { ...job, available: receivedOutputs(job), [field]: [...new Set([...(job[field] ?? []), index])] };
      if (action === 'discard') next.cleanupPending = [...(job.cleanupPending ?? []), index];
      else next.publishAttempts = { ...job.publishAttempts, [index]: [...(job.publishAttempts?.[index] ?? []), attempt] };
      const saved = publishedOutputs(job);
      if (action === 'discard' && saved.length && saved.length + (next.discarded?.length ?? 0) === (job.settings.count ?? 1))
        next.state = 'saved';
      return jobs.map((j) => (j === job ? next : j));
    },
    cursor,
  );
  return attempt;
}

/** Release only this rejected attempt. A concurrent or ambiguous publication keeps its reservation. */
export async function releasePublication(scope: string, id: string, index: number, attempt: string) {
  await editJobs(scope, (jobs) => {
    const job = jobs.find((j) => j.id === id);
    if (!job?.publishAttempts?.[index]?.includes(attempt)) return null;
    const attempts = job.publishAttempts[index].filter((v) => v !== attempt);
    return jobs.map((j) =>
      j !== job
        ? j
        : {
            ...j,
            publishAttempts: { ...j.publishAttempts, [index]: attempts },
            publishing: attempts.length ? j.publishing : j.publishing?.filter((i) => i !== index),
          },
    );
  });
}

/** The tombstone remains authoritative even if physical cleanup must be retried. */
export async function removeDraftFiles(scope: string, id: string, index: number) {
  const key = draftImageKey(scope, id, index);
  await Promise.all([key, `${key}.thumb.webp`, `${key}.fit.webp`].map(deleteStyleGalleryObject));
  await editJobs(scope, (jobs) => {
    const job = jobs.find((j) => j.id === id);
    if (!job?.cleanupPending?.includes(index)) return null;
    return jobs.map((j) => (j === job ? { ...j, cleanupPending: j.cleanupPending?.filter((i) => i !== index) } : j));
  });
}

/** Finish interrupted deletes on normal history visits, without making the discarded pixels reviewable. */
export function resumeDraftCleanup(scope: string, jobs: GenerationJob[]) {
  const pending = jobs.flatMap((j) => (j.cleanupPending ?? []).map((index) => ({ id: j.id, index })));
  if (pending.length)
    waitUntil(
      mapWithConcurrency(pending, 2, async ({ id, index }) => {
        await removeDraftFiles(scope, id, index).catch(() => console.warn('[style-gallery] Private cleanup pending.'));
      }),
    );
}
async function keepImage(slug: string, id: string, index: number, bytes: Buffer) {
  const { format } = await sharp(bytes).metadata();
  if (!['png', 'webp', 'jpeg'].includes(format)) throw new Error('Provider returned an unsupported image.');
  await checkpoint(() => putStyleGalleryObject(draftImageKey(slug, id, index), bytes, `image/${format}`));
  // A simultaneous provider recovery can finish writing bytes just after the user discards them.
  if (!(await checkpoint(() => noteOutput(slug, id, index)))) await removeDraftFiles(slug, id, index);
}

export async function runReservedGeneration(slug: string, request: GenerationRequest, apiKey: string, reference?: File) {
  let result: Awaited<ReturnType<typeof submitGeneration>>;
  try {
    result = await submitGeneration(request, apiKey, reference);
  } catch (error) {
    await checkpoint(() =>
      markGeneration(
        slug,
        request.id,
        error instanceof ProviderRejection ? { state: 'failed', error: error.message } : { state: 'uncertain' },
      ),
    );
    return;
  }
  if ('images' in result) {
    const stored = await Promise.allSettled(
      result.images.slice(0, request.settings.count ?? 1).map(async (bytes, index) => {
        if (!bytes) throw new Error('Missing batch output.');
        await keepImage(slug, request.id, index, bytes);
      }),
    );
    if (stored.some((r) => r.status === 'rejected') || result.images.length !== (request.settings.count ?? 1))
      await markGeneration(slug, request.id, { state: 'uncertain' });
    return;
  }
  const taskId = result.taskId;
  // This independent receipt survives a manifest CAS failure immediately after the provider accepts a paid task.
  await checkpoint(() => putStyleGalleryObject(taskReceipt(slug, request.id), Buffer.from(taskId), 'text/plain'));
  await checkpoint(() => markGeneration(slug, request.id, { taskId }));
  // Persist the provider ID before waiting. A later visit can resume a longer task.
  for (let attempt = 0; attempt < 18; attempt++) {
    await delay(5000);
    if (await collectPixAI(slug, apiKey, request.id, taskId, request.settings.count ?? 1)) break;
  }
}

async function collectPixAI(
  slug: string,
  apiKey: string,
  id: string,
  taskId: string,
  expected: number,
  stored: readonly number[] = [],
) {
  try {
    const count = await readPixAIResult(
      taskId,
      apiKey,
      (index, bytes) => (index < expected ? keepImage(slug, id, index, bytes) : Promise.resolve()),
      stored,
    );
    if (count === null) return false;
    if (count !== expected) await markGeneration(slug, id, { state: 'uncertain', error: 'Provider returned a partial batch.' });
    return true;
  } catch (error) {
    if (!(error instanceof TerminalPixAIError)) throw error;
    await markGeneration(slug, id, { state: 'failed', error: error.message });
    return true;
  }
}

/** Recovery polls are read-only upstream, including after an ambiguous synchronous OpenAI response. */
export async function recoverGeneration(slug: string, job: GenerationJob, apiKey: string) {
  if (job.state !== 'running' && job.state !== 'uncertain') return;
  const missing = Array.from({ length: job.settings.count ?? 1 }, (_, i) => i).filter((i) => !receivedOutputs(job).includes(i));
  const exists = await Promise.all(missing.map((i) => headStyleGalleryObject(draftImageKey(slug, job.id, i))));
  for (const [offset, index] of missing.entries()) if (exists[offset]) await noteOutput(slug, job.id, index);
  if (exists.every(Boolean)) return;
  const taskId =
    job.taskId ??
    (job.settings.platform === 'pixai' ? (await getStyleGalleryObjectTextSnapshot(taskReceipt(slug, job.id))).text : null);
  if (taskId) await collectPixAI(slug, apiKey, job.id, taskId, job.settings.count ?? 1, receivedOutputs(job));
  else if (job.state === 'running' && Date.now() - Date.parse(job.created) > 5 * 60_000)
    await markGeneration(slug, job.id, { state: 'uncertain' });
}
