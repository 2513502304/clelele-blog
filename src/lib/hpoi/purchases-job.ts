import { randomUUID } from 'node:crypto';
import { HfS3ConflictError } from '../hf-s3';
import { type HpoiPurchase, type HpoiPurchaseReference, type HpoiPurchaseStore, hpoiPurchaseSchema } from './purchases-schema';
import type { HpoiPurchaseStorage } from './purchases-store';

export interface HpoiPurchaseSource {
  verifyOwner(signal: AbortSignal): Promise<void>;
  discover(
    page: number,
    knownPages: number | null,
    signal: AbortSignal,
  ): Promise<{ references: HpoiPurchaseReference[]; pages: number }>;
  read(reference: HpoiPurchaseReference, signal: AbortSignal): Promise<HpoiPurchase>;
}

const LEASE_MS = 60_000;
const REQUEST_BUDGET_MS = 20_000;
const MAX_STEPS = 3;

/** Starting a new refresh retains the last successful snapshot; an interrupted job resumes by default. */
export async function startHpoiPurchaseJob(
  store: HpoiPurchaseStorage,
  source: HpoiPurchaseSource,
  sourceUserId: string,
  restartJobId?: string,
) {
  await source.verifyOwner(AbortSignal.timeout(REQUEST_BUDGET_MS));
  return store.edit((current) => {
    if (restartJobId) {
      if (current?.job?.id !== restartJobId) throw new HfS3ConflictError('同步任务已更新，请重新载入。');
      if (current.job.lease && current.job.lease.until > Date.now())
        throw new HfS3ConflictError('同步正在其他窗口推进，请稍后重试。');
    } else if (current?.job) return null;
    return {
      version: 1,
      revision: randomUUID(),
      sourceUserId,
      snapshot: current?.snapshot ?? null,
      job: {
        id: randomUUID(),
        startedAt: new Date().toISOString(),
        references: [],
        records: [],
        next: 0,
        discovery: { page: 1, pages: null },
        discovered: false,
        error: null,
        lease: null,
      },
    };
  });
}

/** Advance at most three upstream tasks under one deadline; every result is checkpointed before continuing. */
export async function advanceHpoiPurchaseJob(store: HpoiPurchaseStorage, source: HpoiPurchaseSource, jobId: string) {
  const signal = AbortSignal.timeout(REQUEST_BUDGET_MS);
  await source.verifyOwner(signal);
  const token = randomUUID();
  let current = await store.edit((value) => {
    if (!value?.job || value.job.id !== jobId) throw new HfS3ConflictError('同步任务已更新，请重新载入。');
    if (value.job.lease && value.job.lease.until > Date.now())
      throw new HfS3ConflictError('同步正在其他窗口推进，请稍后重试。');
    return { ...value, job: { ...value.job, error: null, lease: { token, until: Date.now() + LEASE_MS } } };
  });
  async function checkpoint(
    mutate: (value: HpoiPurchaseStore, job: NonNullable<HpoiPurchaseStore['job']>) => HpoiPurchaseStore,
  ) {
    current = await store.edit((value) => {
      if (!value?.job || value.job.id !== jobId || value.job.lease?.token !== token)
        throw new HfS3ConflictError('同步任务已在其他窗口更新。');
      return mutate(value, value.job);
    });
  }
  try {
    for (let step = 0; step < MAX_STEPS && !signal.aborted; step++) {
      const job = current?.job;
      if (!job) break;
      if (!job.discovered) {
        const page = await source.discover(job.discovery.page, job.discovery.pages, signal);
        if (page.pages < 0 || page.pages > 100 || (job.discovery.pages !== null && page.pages !== job.discovery.pages))
          throw new Error('Inconsistent Hpoi pagination.');
        if (page.references.length === 0 && job.discovery.page < page.pages) throw new Error('Empty intermediate page.');
        const references = new Map(job.references.map((entry) => [entry.figureId, entry]));
        for (const reference of page.references) {
          const previous = references.get(reference.figureId);
          if (previous?.itemId && reference.itemId && previous.itemId !== reference.itemId)
            throw new Error('Inconsistent Hpoi discovery identity.');
          if (!previous) references.set(reference.figureId, reference);
        }
        if (references.size > 10_000) throw new Error('Hpoi purchase record limit exceeded.');
        await checkpoint((value, activeJob) => ({
          ...value,
          job: {
            ...activeJob,
            references: [...references.values()],
            discovery: { page: job.discovery.page + 1, pages: page.pages },
            discovered: job.discovery.page >= page.pages,
          },
        }));
      } else if (job.next < job.references.length) {
        const expected = job.references[job.next];
        const record = hpoiPurchaseSchema.parse(await source.read(expected, signal));
        if (
          record.figureId !== expected.figureId ||
          (expected.itemId && record.itemId !== expected.itemId) ||
          job.records.some((entry) => entry.collectionId === record.collectionId)
        )
          throw new Error('Inconsistent Hpoi purchase identity.');
        await checkpoint((value, activeJob) => ({
          ...value,
          job: { ...activeJob, records: [...activeJob.records, record], next: job.next + 1 },
        }));
      }
      const finished = current?.job;
      if (finished?.discovered && finished.next === finished.references.length) {
        await checkpoint((value, activeJob) => ({
          ...value,
          snapshot: { fetchedAt: new Date().toISOString(), records: activeJob.records },
          job: null,
        }));
        break;
      }
    }
  } catch (error) {
    if (error instanceof HfS3ConflictError) throw error;
    // Do not persist upstream response text, cookies, purchase values or stack traces as an error.
    await checkpoint((value, activeJob) => ({
      ...value,
      job: { ...activeJob, error: activeJob.discovered ? 'upstream' : 'discovery' },
    }));
  } finally {
    current = await store.edit((value) => {
      if (value?.job?.id !== jobId || value.job.lease?.token !== token) return null;
      return { ...value, job: { ...value.job, lease: null } };
    });
  }
  return current;
}
