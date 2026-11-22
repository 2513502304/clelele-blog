import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import {
  getStyleGalleryObjectTextSnapshot,
  headStyleGalleryObject,
  putStyleGalleryObject,
  StyleGalleryObjectConflictError,
} from './hf-s3-presign';
import { StyleGalleryClientError } from './style-gallery-errors';
import { ProviderRejection, readPixAIResult, submitGeneration, TerminalPixAIError } from './style-gallery-generation-provider';
import {
  availableOutputs,
  type GenerationJob,
  type GenerationRequest,
  publishedOutputs,
} from './style-gallery-generation-settings';

const manifest = (slug: string) => `generation-drafts/${slug}/jobs.json`;
export const draftImageKey = (slug: string, id: string, index = 0) =>
  `generation-drafts/${slug}/${id}${index ? `-${index}` : ''}.image`;

async function snapshot(slug: string) {
  const { text, etag } = await getStyleGalleryObjectTextSnapshot(manifest(slug));
  if (text && !etag) throw new Error('Missing generation manifest revision.');
  return { jobs: (text ? JSON.parse(text) : []) as GenerationJob[], etag };
}
export async function listGenerationJobs(slug: string) {
  return (await snapshot(slug)).jobs;
}

/** Retry only bookkeeping. Cross-instance ETag conflicts must never replay a provider submission. */
async function editJobs(slug: string, edit: (jobs: GenerationJob[]) => GenerationJob[] | null) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { jobs, etag } = await snapshot(slug);
    const next = edit(jobs);
    if (!next) return false;
    try {
      await putStyleGalleryObject(
        manifest(slug),
        Buffer.from(JSON.stringify(next)),
        'application/json',
        etag ? { ifMatch: etag } : { ifNoneMatch: '*' },
      );
      return true;
    } catch (error) {
      if (!(error instanceof StyleGalleryObjectConflictError) || attempt === 5) throw error;
      await delay(50 * (attempt + 1));
    }
  }
  return false;
}

/** The client request ID survives a lost response. Exactly one reservation owns the paid call. */
export async function reserveGeneration(slug: string, request: GenerationRequest) {
  return editJobs(slug, (jobs) => {
    const existing = jobs.find((job) => job.id === request.id);
    if (existing) {
      if (existing.prompt !== request.prompt || JSON.stringify(existing.settings) !== JSON.stringify(request.settings))
        throw new StyleGalleryClientError('Generation ID already has different settings.', 409);
      return null;
    }
    return [{ ...request, created: new Date().toISOString(), state: 'running' }, ...jobs];
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
export async function noteOutput(slug: string, id: string, index: number, published = false) {
  await editJobs(slug, (jobs) => {
    const job = jobs.find((j) => j.id === id);
    if (!job) throw new Error('Missing generation record.');
    const available = availableOutputs(job),
      saved = publishedOutputs(job),
      count = job.settings.count ?? 1;
    if (available.includes(index) && (!published || saved.includes(index))) return null;
    const nextAvailable = [...new Set([...available, index])].sort((a, b) => a - b);
    const nextSaved = published ? [...new Set([...saved, index])] : saved;
    const state = nextSaved.length === count ? 'saved' : nextAvailable.length === count ? 'ready' : job.state;
    return jobs.map((j) => (j === job ? { ...j, available: nextAvailable, published: nextSaved, state } : j));
  });
}
async function keepImage(slug: string, id: string, index: number, bytes: Buffer) {
  const { format } = await sharp(bytes).metadata();
  if (!['png', 'webp', 'jpeg'].includes(format)) throw new Error('Provider returned an unsupported image.');
  await checkpoint(() => putStyleGalleryObject(draftImageKey(slug, id, index), bytes, `image/${format}`));
  await checkpoint(() => noteOutput(slug, id, index));
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
      result.images.map(async (bytes, index) => {
        if (!bytes) throw new Error('Missing batch output.');
        await keepImage(slug, request.id, index, bytes);
      }),
    );
    if (stored.some((r) => r.status === 'rejected') || result.images.length !== (request.settings.count ?? 1))
      await markGeneration(slug, request.id, { state: 'uncertain' });
    return;
  }
  const taskId = result.taskId;
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
    const count = await readPixAIResult(taskId, apiKey, (index, bytes) => keepImage(slug, id, index, bytes), stored);
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
  const missing = Array.from({ length: job.settings.count ?? 1 }, (_, i) => i).filter(
    (i) => !availableOutputs(job).includes(i),
  );
  const exists = await Promise.all(missing.map((i) => headStyleGalleryObject(draftImageKey(slug, job.id, i))));
  for (const [offset, index] of missing.entries()) if (exists[offset]) await noteOutput(slug, job.id, index);
  if (exists.every(Boolean)) return;
  if (job.taskId) await collectPixAI(slug, apiKey, job.id, job.taskId, job.settings.count ?? 1, availableOutputs(job));
  else if (job.state === 'running' && Date.now() - Date.parse(job.created) > 5 * 60_000)
    await markGeneration(slug, job.id, { state: 'uncertain' });
}
