import { deleteStyleGalleryObject, headStyleGalleryObject } from '@lib/hf-s3-presign';
import { mapWithConcurrency } from '@lib/map-with-concurrency';
import { isAuthorizedStyleGalleryRequest } from '@lib/style-gallery-auth';
import { getStyleGalleryClientErrorResponse, StyleGalleryClientError } from '@lib/style-gallery-errors';
import {
  createStyleGalleryExample,
  getStyleGalleryExampleExtension,
  getStyleGalleryExampleKey,
  getStyleGalleryExampleObjectKey,
  MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE,
  MAX_STYLE_GALLERY_EXAMPLE_FILES,
} from '@lib/style-gallery-example-upload';
import {
  appendUniqueStyleGalleryExamples,
  getStyleGalleryExampleIdentity,
  removeStyleGalleryExamples,
} from '@lib/style-gallery-examples';
import { getStyleGalleryPlatform } from '@lib/style-gallery-platforms';
import { STYLE_GALLERY_MUTATION_BATCH_SIZE } from '@lib/style-gallery-request-batches';
import { styleGalleryExampleSchema, styleGalleryVisualRecordInputSchema } from '@lib/style-gallery-schema';
import {
  getStoredStyleGalleryItem,
  getStyleGalleryExampleIndex,
  mutateStyleGalleryVisualIndex,
} from '@lib/style-gallery-store';
import { removeStyleGalleryVisualRecords, upsertStyleGalleryVisualRecords } from '@lib/style-gallery-visual-index';
import { updateStyleGalleryItemExamples } from '@lib/style-gallery-write';
import type { APIRoute } from 'astro';
import { z } from 'zod';
import type { StyleGalleryExample } from '@/types/style-gallery';

export const prerender = false;

const imageHashSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const prepareSchema = z.object({
  token: z.string().optional(),
  action: z.literal('prepare'),
  platform: z.string(),
  note: z.string().max(500).optional(),
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        type: z.string().min(1),
        size: z.number().int().positive().max(MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE),
        imageHash: imageHashSchema,
      }),
    )
    .min(1)
    .max(MAX_STYLE_GALLERY_EXAMPLE_FILES),
});
// merge/cleanup 也重新校验服务端持久化契约，客户端不能把任意平台标签写入 HF metadata。
const examplesSchema = z.array(styleGalleryExampleSchema).min(1).max(STYLE_GALLERY_MUTATION_BATCH_SIZE);
const mergeSchema = z.object({
  token: z.string().optional(),
  action: z.literal('merge'),
  examples: examplesSchema,
  visualRecords: z.array(styleGalleryVisualRecordInputSchema).min(1).max(STYLE_GALLERY_MUTATION_BATCH_SIZE),
});
const cleanupSchema = z.object({ token: z.string().optional(), action: z.literal('cleanup'), examples: examplesSchema });
const idsSchema = z
  .array(z.string().regex(/^[a-z0-9-]+$/i))
  .min(1)
  .max(STYLE_GALLERY_MUTATION_BATCH_SIZE);
const updateSchema = z.object({ token: z.string().optional(), ids: idsSchema, platform: z.string() });
const deleteSchema = z.object({ token: z.string().optional(), ids: idsSchema });

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/i.test(slug);
}

async function getItem(slug: string) {
  return getStoredStyleGalleryItem(slug);
}

async function validateExampleObjectsExist(examples: StyleGalleryExample[]): Promise<void> {
  await mapWithConcurrency(examples, 8, async (example) => {
    let key: string;
    try {
      key = getStyleGalleryExampleObjectKey(example);
    } catch (error) {
      throw new StyleGalleryClientError(error instanceof Error ? error.message : 'Invalid example image metadata.', 400, {
        cause: error,
      });
    }
    if (!(await headStyleGalleryObject(key))) {
      throw new StyleGalleryClientError(`Example image object is missing: ${example.src}`, 409);
    }
  });
}

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug;
  if (!slug || !isValidSlug(slug)) return new Response('Invalid style gallery slug.', { status: 400 });
  try {
    const item = await getItem(slug);
    if (!item) return new Response('Style gallery item not found.', { status: 404 });
    return Response.json({
      examples: item.examples,
      uploadsEnabled: Boolean(process.env.STYLE_GALLERY_UPLOAD_TOKEN),
      updatedAt: item.updated,
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Failed to load style gallery examples.', { status: 500 });
  }
};

export const POST: APIRoute = async ({ params, request }) => {
  const slug = params.slug;
  if (!slug || !isValidSlug(slug)) return new Response('Invalid style gallery slug.', { status: 400 });
  try {
    const item = await getItem(slug);
    if (!item) return new Response('Style gallery item not found.', { status: 404 });
    const rawBody = await request.json();
    if (!isAuthorizedStyleGalleryRequest(request, rawBody?.token))
      return new Response('Invalid upload token.', { status: 401 });

    if (rawBody?.action === 'prepare') {
      // prepare 只分配元数据并检查内容哈希对象是否已存在，不在请求体内传输图片字节。
      const body = prepareSchema.parse(rawBody);
      const platform = getStyleGalleryPlatform(body.platform);
      if (!platform) return new Response('Invalid style gallery platform.', { status: 400 });
      const known = new Set(item.examples.map(getStyleGalleryExampleIdentity));
      const prepared = body.files.map((file) => {
        const extension = getStyleGalleryExampleExtension(file.type, file.name);
        const example = createStyleGalleryExample(item.title, platform, file.imageHash, extension, body.note);
        const identity = getStyleGalleryExampleIdentity(example);
        const duplicate = known.has(identity);
        known.add(identity);
        return { ...file, key: getStyleGalleryExampleKey(file.imageHash, extension), example, duplicate };
      });
      const existence = await mapWithConcurrency(prepared, 8, (entry) => headStyleGalleryObject(entry.key));
      return Response.json({
        uploads: prepared.map((entry, index) => ({
          imageHash: entry.imageHash,
          example: entry.example,
          duplicate: entry.duplicate,
          exists: existence[index],
        })),
      });
    }

    if (rawBody?.action === 'cleanup') {
      // 只删除未被总览索引引用的对象，避免失败补偿误删其他 item 正在使用的同哈希图片。
      const body = cleanupSchema.parse(rawBody);
      const index = await getStyleGalleryExampleIndex({ fresh: true });
      const referenced = new Set(index.groups.flatMap((group) => group.examples.map((example) => example.src)));
      const removable = body.examples.filter((example) => !referenced.has(example.src));
      await mapWithConcurrency(removable, 8, (example) => deleteStyleGalleryObject(getStyleGalleryExampleObjectKey(example)));
      return Response.json({ deleted: removable.length, retained: body.examples.length - removable.length });
    }

    // 图片全部写入并经 HEAD 校验后，才提交 item、catalog 计数和示例总览索引。
    const body = mergeSchema.parse(rawBody);
    assertExampleVisualRecords(slug, body.examples, body.visualRecords);
    await validateExampleObjectsExist(body.examples);
    let added = 0;
    const result = await updateStyleGalleryItemExamples(slug, (examples) => {
      const merged = appendUniqueStyleGalleryExamples(examples, body.examples);
      added = merged.length - examples.length;
      return merged;
    });
    let visualIndexUpdated = true;
    try {
      await mutateStyleGalleryVisualIndex((current) => upsertStyleGalleryVisualRecords(current, body.visualRecords));
    } catch (error) {
      // 示例真相源已提交成功；派生索引失败时保留图片并明确报告，后续全量重建可无损恢复。
      visualIndexUpdated = false;
      console.error('[style-gallery] Examples were saved but the visual index update failed.', error);
    }
    return Response.json({
      examples: result.item.examples,
      uploaded: added,
      skippedDuplicates: body.examples.length - added,
      updatedAt: result.item.updated,
      visualIndexUpdated,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return new Response(error.message, { status: 400 });
    const clientErrorResponse = getStyleGalleryClientErrorResponse(error);
    if (clientErrorResponse) return clientErrorResponse;
    return new Response(error instanceof Error ? error.message : 'Failed to update style gallery examples.', { status: 500 });
  }
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const slug = params.slug;
  if (!slug || !isValidSlug(slug)) return new Response('Invalid style gallery slug.', { status: 400 });
  try {
    const rawBody = await request.json();
    if (!isAuthorizedStyleGalleryRequest(request, rawBody?.token))
      return new Response('Invalid upload token.', { status: 401 });
    const body = updateSchema.parse(rawBody);
    const platform = getStyleGalleryPlatform(body.platform);
    if (!platform) return new Response('Invalid style gallery platform.', { status: 400 });
    const selectedIds = new Set(body.ids);
    const result = await updateStyleGalleryItemExamples(
      slug,
      (examples, item) => {
        const found = examples.filter((example) => selectedIds.has(example.id));
        if (found.length !== selectedIds.size) throw new StyleGalleryClientError('One or more examples were not found.', 404);
        const updated = examples.map((example) =>
          selectedIds.has(example.id)
            ? { ...example, alt: `${item.title} ${platform.label} example`, model: platform.label }
            : example,
        );
        const identities = updated.map(getStyleGalleryExampleIdentity);
        if (new Set(identities).size !== identities.length) {
          throw new StyleGalleryClientError(
            'Changing platform would duplicate an existing image in the destination platform.',
            409,
          );
        }
        return updated;
      },
      { catalogMode: 'preserve-count' },
    );
    return Response.json({ examples: result.item.examples, updatedAt: result.item.updated });
  } catch (error) {
    if (error instanceof z.ZodError) return new Response(error.message, { status: 400 });
    const clientErrorResponse = getStyleGalleryClientErrorResponse(error);
    if (clientErrorResponse) return clientErrorResponse;
    return new Response(error instanceof Error ? error.message : 'Failed to update style gallery examples.', { status: 500 });
  }
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const slug = params.slug;
  if (!slug || !isValidSlug(slug)) return new Response('Invalid style gallery slug.', { status: 400 });
  try {
    const rawBody = await request.json();
    if (!isAuthorizedStyleGalleryRequest(request, rawBody?.token))
      return new Response('Invalid upload token.', { status: 401 });
    const body = deleteSchema.parse(rawBody);
    const selectedIds = new Set(body.ids);
    let removed: StyleGalleryExample[] = [];
    const result = await updateStyleGalleryItemExamples(slug, (examples) => {
      removed = examples.filter((example) => selectedIds.has(example.id));
      // DELETE 必须可安全重试：首次响应丢失后，同一请求再次到达时缺失 ID 视为已删除。
      return removeStyleGalleryExamples(examples, selectedIds);
    });
    const referenced = new Set(result.index.groups.flatMap((group) => group.examples.map((example) => example.src)));
    // 先提交删除后的元数据，再清理成为孤儿的图片；对象清理失败不会复活已删除的示例记录。
    const orphaned = removed.filter((example) => !referenced.has(example.src));
    let visualIndexUpdated = true;
    try {
      await mutateStyleGalleryVisualIndex((current) =>
        removeStyleGalleryVisualRecords(
          current,
          (record) => record.kind === 'example' && record.sourceSlug === slug && selectedIds.has(record.imageId),
        ),
      );
    } catch (error) {
      // 过期记录不会在客户端当前 example 数据中命中；记录错误供维护者重建索引，不复活已删除 metadata。
      visualIndexUpdated = false;
      console.error('[style-gallery] Examples were deleted but visual index cleanup failed.', error);
    }
    await mapWithConcurrency(orphaned, 8, (example) =>
      deleteStyleGalleryObject(getStyleGalleryExampleObjectKey(example)).catch((error) => {
        console.error('[style-gallery] Failed to remove an unreferenced example object:', error);
      }),
    );
    return Response.json({
      examples: result.item.examples,
      deleted: removed.length,
      updatedAt: result.item.updated,
      visualIndexUpdated,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return new Response(error.message, { status: 400 });
    const clientErrorResponse = getStyleGalleryClientErrorResponse(error);
    if (clientErrorResponse) return clientErrorResponse;
    return new Response(error instanceof Error ? error.message : 'Failed to delete style gallery examples.', { status: 500 });
  }
};

function assertExampleVisualRecords(
  slug: string,
  examples: StyleGalleryExample[],
  records: z.infer<typeof styleGalleryVisualRecordInputSchema>[],
): void {
  const expected = new Map(examples.map((example) => [example.id, example.imageHash]));
  const actual = new Set<string>();
  for (const record of records) {
    if (record.kind !== 'example' || record.sourceSlug !== slug || expected.get(record.imageId) !== record.feature.imageHash) {
      throw new StyleGalleryClientError('Example visual records do not match submitted examples.', 400);
    }
    actual.add(record.imageId);
  }
  if (records.length !== expected.size || actual.size !== expected.size) {
    throw new StyleGalleryClientError('Every submitted example must include one visual feature.', 400);
  }
}
