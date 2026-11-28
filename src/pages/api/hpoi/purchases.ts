import { hpoiConfig } from '@constants/site-config';
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { HfS3ConflictError } from '../../../lib/hf-s3';
import { advanceHpoiPurchaseJob, startHpoiPurchaseJob } from '../../../lib/hpoi/purchases-job';
import { type HpoiPurchaseStore, hpoiRecordId } from '../../../lib/hpoi/purchases-schema';
import { createHpoiPurchaseSource } from '../../../lib/hpoi/purchases-source';
import { createHpoiPurchaseStore } from '../../../lib/hpoi/purchases-store';
import { RequestTooLargeError, readBoundedBody } from '../../../lib/read-bounded-body';
import { isSiteAdmin, rejectCrossOriginMutation } from '../../../lib/site-admin-auth';

export const prerender = false;
const headers = {
  'Cache-Control': 'private, no-store',
  'CDN-Cache-Control': 'no-store',
  Vary: 'Cookie',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }).strict(),
  z.object({ action: z.literal('restart'), jobId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('advance'), jobId: z.string().uuid() }).strict(),
]);
const enabled = () => Boolean(hpoiConfig && process.env.HPOI_PURCHASES_BUCKET?.trim());
const canRefresh = () => Boolean(process.env.HPOI_PURCHASES_COOKIE?.trim());

/** Expose the owner view only, never storage paths, signed URLs, cookies or upstream response/error bodies. */
function view(value: HpoiPurchaseStore | null) {
  return {
    configured: enabled(),
    canRefresh: canRefresh(),
    snapshot: value?.snapshot ?? null,
    job: value?.job
      ? {
          id: value.job.id,
          done: value.job.next,
          total: value.job.references.length,
          phase: value.job.discovered ? 'details' : 'discovery',
          error: Boolean(value.job.error),
          busy: Boolean(value.job.lease && value.job.lease.until > Date.now()),
        }
      : null,
  };
}

/** Reading the saved snapshot performs no Hpoi requests and never starts a refresh. */
export const GET: APIRoute = async ({ cookies, url }) => {
  if (!isSiteAdmin(cookies)) return new Response('Not found.', { status: 404, headers });
  const figureId = url.searchParams.get('figureId');
  if (figureId !== null && !hpoiRecordId.safeParse(figureId).success)
    return new Response('Invalid figure ID.', { status: 400, headers });
  if (!enabled() || !hpoiConfig) return Response.json(figureId ? { records: [] } : view(null), { headers });
  try {
    const result = await createHpoiPurchaseStore(hpoiConfig.userId).read();
    if (figureId)
      return Response.json(
        { records: result?.value.snapshot?.records.filter((entry) => entry.figureId === figureId) ?? [] },
        { headers },
      );
    return Response.json(view(result?.value ?? null), { headers });
  } catch {
    return new Response('Private purchase cache unavailable.', { status: 503, headers });
  }
};

/** The browser supplies only an action/job token; source accounts, IDs and credentials stay server-controlled. */
export const POST: APIRoute = async ({ cookies, request, url }) => {
  if (!isSiteAdmin(cookies)) return new Response('Not found.', { status: 404, headers });
  const originError = rejectCrossOriginMutation(request, url);
  if (originError) return new Response('Invalid request origin.', { status: 403, headers });
  if (!enabled() || !canRefresh() || !hpoiConfig)
    return new Response('Private purchase sync is not configured.', { status: 503, headers });
  try {
    const input = inputSchema.parse(JSON.parse(new TextDecoder().decode(await readBoundedBody(request, 1_024))));
    const source = createHpoiPurchaseSource(hpoiConfig.userId, process.env.HPOI_PURCHASES_COOKIE ?? '');
    const store = createHpoiPurchaseStore(hpoiConfig.userId);
    const result =
      input.action === 'advance'
        ? await advanceHpoiPurchaseJob(store, source, input.jobId)
        : await startHpoiPurchaseJob(store, source, hpoiConfig.userId, input.action === 'restart' ? input.jobId : undefined);
    return Response.json(view(result), { headers });
  } catch (error) {
    const status =
      error instanceof HfS3ConflictError
        ? 409
        : error instanceof RequestTooLargeError
          ? 413
          : error instanceof z.ZodError || error instanceof SyntaxError
            ? 400
            : 503;
    return new Response(
      status === 409 ? 'Sync is active or changed; reload before continuing.' : 'Private purchase sync paused.',
      { status, headers },
    );
  }
};
