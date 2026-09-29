import type { APIRoute } from 'astro';
import { z } from 'zod';
import { HfS3ConflictError } from '../../../lib/hf-s3';
import { RequestTooLargeError, readBoundedBody } from '../../../lib/read-bounded-body';
import { isSiteAdmin, rejectCrossOriginMutation } from '../../../lib/site-admin-auth';
import {
  appendSiteAssetHistory,
  assetKeySchema,
  assetSlotSchema,
  profileFieldsSchema,
  type SiteProfile,
} from '../../../lib/site-profile/schema';
import {
  deleteSiteAsset,
  getSiteProfile,
  saveSiteProfile,
  siteProfileStorage,
  uploadSiteAsset,
} from '../../../lib/site-profile/store';
export const prerender = false;
const saveSchema = z.object({
  revision: z.string().uuid(),
  profile: profileFieldsSchema,
  assets: z.record(assetSlotSchema, assetKeySchema),
});
const privateHeaders = { 'Cache-Control': 'private, no-store' };
export const GET: APIRoute = async ({ cookies }) => {
  if (!isSiteAdmin(cookies)) return new Response('Not found.', { status: 404, headers: privateHeaders });
  try {
    return Response.json(await getSiteProfile(true), { headers: privateHeaders });
  } catch {
    return new Response('Profile unavailable.', { status: 503, headers: privateHeaders });
  }
};
export const POST: APIRoute = async ({ cookies, request, url }) => {
  if (!isSiteAdmin(cookies)) return new Response('Not found.', { status: 404, headers: privateHeaders });
  const rejected = rejectCrossOriginMutation(request, url);
  if (rejected) return rejected;
  try {
    if (Number(request.headers.get('content-length')) > 3_100_000) return new Response('Request too large.', { status: 413 });
    if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
      const bytes = await readBoundedBody(request, 3_100_000);
      const form = await new Response(new Uint8Array(bytes).buffer, {
        headers: { 'content-type': request.headers.get('content-type') ?? '' },
      }).formData();
      const file = form.get('file');
      const revision = z.string().uuid().parse(form.get('revision'));
      if (!(file instanceof File) || file.size > 3_000_000) return new Response('请选择不超过 3 MB 的图片。', { status: 400 });
      const latest = await getSiteProfile(true);
      if (latest.revision !== revision || latest.pendingDeletion)
        throw new HfS3ConflictError('资料已更新或有未完成的图片删除，请刷新后重试。');
      if (latest.history.length >= 500) return new Response('历史图片已满，请先删除不再使用的图片。', { status: 409 });
      const asset = await uploadSiteAsset(new Uint8Array(await file.arrayBuffer()), file.name, true);
      let result: SiteProfile;
      try {
        result = await saveSiteProfile(revision, (current) => {
          if (!current) throw new Error('Profile unavailable.');
          return { ...current, history: appendSiteAssetHistory(current, asset) };
        });
      } catch (error) {
        // A known CAS conflict never published this unique key. Uncertain network errors retain bytes for safety.
        if (error instanceof HfS3ConflictError) await siteProfileStorage().delete(asset.key);
        throw error;
      }
      return Response.json({ profile: result, asset }, { headers: privateHeaders });
    }
    const raw = new TextDecoder().decode(await readBoundedBody(request, 128_000));
    if (Buffer.byteLength(raw) > 128_000) return new Response('Request too large.', { status: 413 });
    const input = saveSchema.parse(JSON.parse(raw));
    const result = await saveSiteProfile(input.revision, (current) => {
      if (!current) throw new Error('Profile unavailable.');
      return { ...current, ...input.profile, assets: input.assets };
    });
    return Response.json(result, { headers: privateHeaders });
  } catch (error) {
    return new Response(error instanceof HfS3ConflictError ? error.message : '保存失败，请检查输入后重试。', {
      status:
        error instanceof RequestTooLargeError
          ? 413
          : error instanceof HfS3ConflictError
            ? 409
            : error instanceof z.ZodError || error instanceof SyntaxError
              ? 400
              : 500,
      headers: privateHeaders,
    });
  }
};

/** Delete inactive HF bytes and history together; the durable intent protects retries and concurrent publication. */
export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  if (!isSiteAdmin(cookies)) return new Response('Not found.', { status: 404, headers: privateHeaders });
  const rejected = rejectCrossOriginMutation(request, url);
  if (rejected) return rejected;
  try {
    const input = z
      .object({ revision: z.string().uuid(), key: assetKeySchema })
      .parse(JSON.parse(new TextDecoder().decode(await readBoundedBody(request, 2048))));
    const result = await deleteSiteAsset(input.revision, input.key);
    return Response.json(result, { headers: privateHeaders });
  } catch (error) {
    return new Response(error instanceof HfS3ConflictError ? error.message : '删除失败，请刷新后重试。', {
      status:
        error instanceof HfS3ConflictError
          ? 409
          : error instanceof RequestTooLargeError
            ? 413
            : error instanceof z.ZodError || error instanceof SyntaxError
              ? 400
              : 500,
      headers: privateHeaders,
    });
  }
};
