import { createHash } from 'node:crypto';
import {
  deleteStyleGalleryObject,
  getStyleGalleryObjectBytes,
  headStyleGalleryObject,
  putStyleGalleryObject,
} from '@lib/hf-s3-presign';
import { mapWithConcurrency } from '@lib/map-with-concurrency';
import { isAuthorizedStyleGalleryRequest } from '@lib/style-gallery-auth';
import {
  getStyleGalleryUploadPartCount,
  getStyleGalleryUploadPartKey,
  isStyleGalleryUploadId,
  MAX_STYLE_GALLERY_UPLOAD_PARTS,
  STYLE_GALLERY_UPLOAD_CHUNK_SIZE,
} from '@lib/style-gallery-chunk-upload';
import {
  getStyleGalleryExampleExtension,
  getStyleGalleryExampleKey,
  MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE,
} from '@lib/style-gallery-example-upload';
import { getStyleGalleryPlatform } from '@lib/style-gallery-platforms';
import { getStyleGalleryCatalog } from '@lib/style-gallery-store';
import type { APIRoute } from 'astro';
import { z } from 'zod';

export const prerender = false;

const imageHashSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const uploadIdSchema = z.string().refine(isStyleGalleryUploadId, 'Invalid style gallery upload ID.');
const uploadPartSchema = z.object({
  index: z
    .number()
    .int()
    .min(0)
    .max(MAX_STYLE_GALLERY_UPLOAD_PARTS - 1),
  size: z.number().int().positive().max(STYLE_GALLERY_UPLOAD_CHUNK_SIZE),
  hash: imageHashSchema,
});
const completeSchema = z.object({
  action: z.literal('complete'),
  uploadId: uploadIdSchema,
  imageHash: imageHashSchema,
  extension: z.enum(['jpg', 'png', 'webp']),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z.number().int().positive().max(MAX_STYLE_GALLERY_EXAMPLE_FILE_SIZE),
  parts: z.array(uploadPartSchema).min(1).max(MAX_STYLE_GALLERY_UPLOAD_PARTS),
});
const abortSchema = z.object({
  action: z.literal('abort'),
  uploadId: uploadIdSchema,
  partCount: z.number().int().min(1).max(MAX_STYLE_GALLERY_UPLOAD_PARTS),
});

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function deleteUploadParts(uploadId: string, partCount: number): Promise<void> {
  const results = await Promise.allSettled(
    Array.from({ length: partCount }, (_, index) => deleteStyleGalleryObject(getStyleGalleryUploadPartKey(uploadId, index))),
  );
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length) throw new Error(`Failed to delete ${failures.length} temporary upload part(s).`);
}

async function handleChunkUpload(request: Request, url: URL): Promise<Response> {
  const uploadId = url.searchParams.get('uploadId') ?? '';
  const partIndex = Number.parseInt(url.searchParams.get('partIndex') ?? '', 10);
  const partCount = Number.parseInt(url.searchParams.get('partCount') ?? '', 10);
  const expectedHash = url.searchParams.get('chunkHash') ?? '';
  if (
    !isStyleGalleryUploadId(uploadId) ||
    !Number.isInteger(partIndex) ||
    !Number.isInteger(partCount) ||
    partCount < 1 ||
    partCount > MAX_STYLE_GALLERY_UPLOAD_PARTS ||
    partIndex < 0 ||
    partIndex >= partCount ||
    !/^[a-f0-9]{64}$/i.test(expectedHash)
  ) {
    return new Response('Invalid upload part metadata.', { status: 400 });
  }

  const contentLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(contentLength) && contentLength > STYLE_GALLERY_UPLOAD_CHUNK_SIZE) {
    return new Response('Upload part is too large.', { status: 413 });
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return new Response('No upload part was provided.', { status: 400 });
  if (bytes.length > STYLE_GALLERY_UPLOAD_CHUNK_SIZE) return new Response('Upload part is too large.', { status: 413 });
  if (hashBytes(bytes) !== expectedHash.toLowerCase()) {
    return new Response('Upload part hash does not match.', { status: 409 });
  }

  const key = getStyleGalleryUploadPartKey(uploadId, partIndex);
  await putStyleGalleryObject(key, bytes, 'application/octet-stream');
  return Response.json({ key, partIndex, size: bytes.length });
}

/**
 * 校验分块 manifest、逐块复核大小与哈希，再在服务端组合并复核完整文件 SHA-256。
 * 正式对象以内容哈希命名，可直接复用已有对象；临时分块无论成功或中止都由调用链清理。
 */
async function handleCompleteUpload(rawBody: unknown): Promise<Response> {
  const body = completeSchema.parse(rawBody);
  const expectedPartCount = getStyleGalleryUploadPartCount(body.size);
  if (body.parts.length !== expectedPartCount)
    return new Response('Upload part count does not match file size.', { status: 409 });
  const parts = [...body.parts].sort((a, b) => a.index - b.index);
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const expectedSize = Math.min(STYLE_GALLERY_UPLOAD_CHUNK_SIZE, body.size - index * STYLE_GALLERY_UPLOAD_CHUNK_SIZE);
    if (part.index !== index || part.size !== expectedSize) {
      return new Response('Upload part manifest is incomplete or inconsistent.', { status: 409 });
    }
  }
  if (getStyleGalleryExampleExtension(body.contentType) !== body.extension) {
    return new Response('Image type does not match its extension.', { status: 400 });
  }

  const finalKey = getStyleGalleryExampleKey(body.imageHash, body.extension);
  if (await headStyleGalleryObject(finalKey)) {
    await deleteUploadParts(body.uploadId, parts.length).catch((error) => {
      console.error('[style-gallery] Failed to clean temporary parts for an existing example:', error);
    });
    return Response.json({ key: finalKey, imageHash: body.imageHash, reused: true });
  }

  const chunks = await mapWithConcurrency(parts, MAX_STYLE_GALLERY_UPLOAD_PARTS, async (part) => {
    const key = getStyleGalleryUploadPartKey(body.uploadId, part.index);
    const bytes = await getStyleGalleryObjectBytes(key);
    if (!bytes) throw new Error(`Upload part ${part.index + 1} is missing.`);
    if (bytes.length !== part.size || hashBytes(bytes) !== part.hash.toLowerCase()) {
      throw new Error(`Upload part ${part.index + 1} failed server-side verification.`);
    }
    return bytes;
  });

  const image = new Uint8Array(body.size);
  let offset = 0;
  for (const chunk of chunks) {
    image.set(chunk, offset);
    offset += chunk.length;
  }
  if (offset !== body.size || hashBytes(image) !== body.imageHash.toLowerCase()) {
    return new Response('Completed image hash does not match the prepared upload.', { status: 409 });
  }

  await putStyleGalleryObject(finalKey, image, body.contentType);
  await deleteUploadParts(body.uploadId, parts.length).catch((error) => {
    console.error('[style-gallery] Example was saved but temporary upload cleanup failed:', error);
  });
  return Response.json({ key: finalKey, imageHash: body.imageHash, reused: false });
}

export const POST: APIRoute = async ({ params, request, url }) => {
  const slug = params.slug;
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) return new Response('Invalid style gallery slug.', { status: 400 });
  if (!isAuthorizedStyleGalleryRequest(request)) return new Response('Invalid upload token.', { status: 401 });

  try {
    const catalog = await getStyleGalleryCatalog();
    if (!catalog.items.some((item) => item.slug === slug))
      return new Response('Style gallery item not found.', { status: 404 });
    if (!getStyleGalleryPlatform(url.searchParams.get('platform') ?? '')) {
      return new Response('Invalid style gallery platform.', { status: 400 });
    }

    if (url.searchParams.get('action') === 'chunk') return await handleChunkUpload(request, url);

    const rawBody = await request.json();
    if (rawBody?.action === 'complete') return await handleCompleteUpload(rawBody);
    if (rawBody?.action === 'abort') {
      const body = abortSchema.parse(rawBody);
      await deleteUploadParts(body.uploadId, body.partCount);
      return Response.json({ deleted: body.partCount });
    }
    return new Response('Invalid upload action.', { status: 400 });
  } catch (error) {
    if (error instanceof z.ZodError) return new Response(error.message, { status: 400 });
    return new Response(error instanceof Error ? error.message : 'Failed to upload style gallery example.', { status: 500 });
  }
};
