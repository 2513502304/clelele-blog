import { type GenerationJob, publishedOutputs } from './style-gallery-generation-settings';
import { getStoredStyleGalleryItem } from './style-gallery-store';

/** Public example IDs preserve the original provider output slot within a batch. */
export const generationExampleId = (id: string, index: number) => (index ? `${id}-${index + 1}` : id);

/** Private receipts acknowledge a past save. The current item determines whether that output is still in the gallery. */
export async function visibleGenerationHistory(slug: string, jobs: GenerationJob[]): Promise<GenerationJob[]> {
  if (!jobs.some((job) => publishedOutputs(job).length)) return jobs;
  const item = await getStoredStyleGalleryItem(slug, { fresh: true, followRedirect: true });
  return projectPublishedHistory(jobs, new Set(item?.examples.map((e) => e.id)));
}

/** Reconcile individual output slots, including legacy single-output receipts. */
export function projectPublishedHistory(jobs: GenerationJob[], ids: ReadonlySet<string>): GenerationJob[] {
  return jobs.flatMap((job) => {
    const saved = publishedOutputs(job);
    const removed = saved.filter((index) => !ids.has(generationExampleId(job.id, index)));
    if (!removed.length) return [job];
    // Presentation only. Never rewrite receipts, delete draft bytes or turn removed publications back into pending work.
    const discarded = [...new Set([...(job.discarded ?? []), ...removed])];
    if (discarded.length === (job.settings.count ?? 1)) return [];
    return [{ ...job, published: saved.filter((index) => !removed.includes(index)), discarded }];
  });
}
