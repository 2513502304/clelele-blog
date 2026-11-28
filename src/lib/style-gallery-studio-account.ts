import { visibleGenerationHistory } from '@lib/style-gallery-published-history';
import { getStyleGalleryObjectTextSnapshot, putStyleGalleryObject, StyleGalleryObjectConflictError } from './hf-s3-presign';
import { mapWithConcurrency } from './map-with-concurrency';
import { listGenerationJobs, resumeDraftCleanup } from './style-gallery-generation-jobs';
import type { GenerationPlatform } from './style-gallery-generation-settings';

interface AccountWork {
  slug: string;
  platform: GenerationPlatform;
  owner: string;
  id: string;
}
const accountKey = (viewerId: number) => `generation-drafts/accounts/${viewerId}/works.json`;

async function snapshot(viewerId: number) {
  const { text, etag } = await getStyleGalleryObjectTextSnapshot(accountKey(viewerId));
  if (text && !etag) throw new Error('Missing account index revision.');
  return { works: (text ? JSON.parse(text) : []) as AccountWork[], etag };
}

/** Link one verified generation. Account sessions never inherit the rest of a provider key's history. */
export async function rememberAccountWork(viewerId: number, work: AccountWork) {
  for (let attempt = 0; ; attempt++) {
    const { works, etag } = await snapshot(viewerId);
    const old = works.find((w) => w.slug === work.slug && w.platform === work.platform && w.id === work.id);
    if (old) {
      if (old.owner !== work.owner) throw new Error('Conflicting account work.');
      return;
    }
    try {
      await putStyleGalleryObject(
        accountKey(viewerId),
        Buffer.from(JSON.stringify([work, ...works])),
        'application/json',
        etag ? { ifMatch: etag } : { ifNoneMatch: '*' },
      );
      return;
    } catch (err) {
      if (!(err instanceof StyleGalleryObjectConflictError) || attempt >= 5) throw err;
    }
  }
}

export async function findAccountWork(viewerId: number, slug: string, platform: string | null, id: string) {
  return (await snapshot(viewerId)).works.find((w) => w.slug === slug && w.platform === platform && w.id === id);
}

/** Read each private job manifest once, selecting only the jobs linked to this account. */
export async function listAccountSources(viewerId: number) {
  const groups = new Map<string, { slug: string; platform: GenerationPlatform; ids: Set<string> }>();
  for (const { slug, platform, owner, id } of (await snapshot(viewerId)).works) {
    const scope = `${slug}/${owner}`;
    const group = groups.get(scope) ?? { slug, platform, ids: new Set<string>() };
    group.ids.add(id);
    groups.set(scope, group);
  }
  return mapWithConcurrency([...groups], 3, async ([scope, { slug, platform, ids }]) => {
    const jobs = (await listGenerationJobs(scope)).filter((job) => ids.has(job.id));
    resumeDraftCleanup(scope, jobs);
    return { slug, platform, jobs: await visibleGenerationHistory(slug, jobs) };
  });
}
