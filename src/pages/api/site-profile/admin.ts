import type { APIRoute } from 'astro';
import { z } from 'zod';
import { HfS3ConflictError } from '../../../lib/hf-s3';
import { RequestTooLargeError, readBoundedBody } from '../../../lib/read-bounded-body';
import { isSiteAdmin, rejectCrossOriginMutation } from '../../../lib/site-admin-auth';
import { appendSiteAssetHistory, assetKeySchema, assetSlotSchema, profileFieldsSchema } from '../../../lib/site-profile/schema';
import { getSiteProfile, saveSiteProfile, uploadSiteAsset } from '../../../lib/site-profile/store';
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
      const asset = await uploadSiteAsset(new Uint8Array(await file.arrayBuffer()), file.name);
      const result = await saveSiteProfile(revision, (current) => {
        if (!current) throw new Error('Profile unavailable.');
        return { ...current, history: appendSiteAssetHistory(current, asset) };
      });
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
