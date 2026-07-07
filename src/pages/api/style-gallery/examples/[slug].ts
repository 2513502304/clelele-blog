import { createHash } from 'node:crypto';
import {
  deleteStyleGalleryObject,
  getStyleGalleryObjectText,
  headStyleGalleryObject,
  putStyleGalleryObject,
} from '@lib/hf-s3-presign';
import { getStyleGalleryItemBySlug } from '@lib/style-gallery';
import {
  getStyleGalleryExampleIdentity,
  getStyleGalleryExamplesManifestKey,
  mergeStyleGalleryExamples,
  normalizeStyleGalleryExamplesManifest,
  type StyleGalleryExamplesManifest,
} from '@lib/style-gallery-examples';
import { getStyleGalleryPlatform } from '@lib/style-gallery-platforms';
import type { APIRoute } from 'astro';
import type { StyleGalleryExample } from '@/types/style-gallery';

export const prerender = false;

const MAX_FILES = 8;
const MAX_FILE_SIZE_BYTES = 12 * 1024 * 1024;
const MAX_MERGE_EXAMPLES = 128;
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/i.test(slug);
}

function getUploadToken(request: Request, formData: FormData): string {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
  const tokenField = formData.get('token');
  return typeof tokenField === 'string' ? tokenField.trim() : '';
}

function getJsonUploadToken(request: Request, body: unknown): string {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
  if (!body || typeof body !== 'object') return '';
  const token = (body as Record<string, unknown>).token;
  return typeof token === 'string' ? token.trim() : '';
}

async function readManifest(slug: string): Promise<StyleGalleryExamplesManifest> {
  const raw = await getStyleGalleryObjectText(getStyleGalleryExamplesManifestKey(slug));
  if (!raw) return normalizeStyleGalleryExamplesManifest(slug, null);
  return normalizeStyleGalleryExamplesManifest(slug, JSON.parse(raw));
}

async function writeManifest(manifest: StyleGalleryExamplesManifest): Promise<void> {
  const body = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  await putStyleGalleryObject(getStyleGalleryExamplesManifestKey(manifest.slug), body, 'application/json; charset=utf-8');
}

function extensionFromFile(file: File): string {
  const extension = IMAGE_EXTENSIONS[file.type];
  if (extension) return extension;
  const match = file.name.toLowerCase().match(/\.(jpe?g|png|webp)$/);
  if (match?.[1]) return match[1] === 'jpeg' ? 'jpg' : match[1];
  throw new Error(`Unsupported image type: ${file.type || file.name}`);
}

function isImageFile(value: FormDataEntryValue): value is File {
  return typeof value === 'object' && value !== null && 'arrayBuffer' in value && 'size' in value && 'type' in value;
}

function getValidatedExamples(value: unknown): StyleGalleryExample[] {
  if (!value || typeof value !== 'object') return [];
  const examples = (value as { examples?: unknown }).examples;
  if (!Array.isArray(examples)) return [];
  if (examples.length > MAX_MERGE_EXAMPLES) {
    throw new Error(`Merge at most ${MAX_MERGE_EXAMPLES} examples at a time.`);
  }
  return normalizeStyleGalleryExamplesManifest('uploaded', { examples }).examples;
}

function getExampleObjectKey(example: StyleGalleryExample, slug: string): string {
  const prefix = '/api/style-gallery/image/';
  if (!example.src.startsWith(prefix)) {
    throw new Error(`Invalid example image URL: ${example.src}`);
  }

  const key = example.src.slice(prefix.length);
  if (!new RegExp(`^examples/[a-z0-9-]+/${slug}/[a-f0-9]{12}\\.(jpg|jpeg|png|webp)$`, 'i').test(key)) {
    throw new Error(`Example image does not belong to ${slug}: ${example.src}`);
  }
  return key;
}

async function validateExampleObjectsExist(examples: StyleGalleryExample[], slug: string): Promise<void> {
  for (const example of examples) {
    const key = getExampleObjectKey(example, slug);
    if (!(await headStyleGalleryObject(key))) {
      throw new Error(`Example image object is missing: ${example.src}`);
    }
  }
}

function assertManifestContainsExamples(
  manifest: StyleGalleryExamplesManifest,
  submittedExamples: StyleGalleryExample[],
): void {
  const savedIdentities = new Set(manifest.examples.map(getStyleGalleryExampleIdentity));
  const missing = submittedExamples.filter((example) => !savedIdentities.has(getStyleGalleryExampleIdentity(example)));
  if (missing.length) {
    throw new Error(
      `Manifest write verification failed for ${missing.length} uploaded example${missing.length > 1 ? 's' : ''}.`,
    );
  }
}

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug;
  if (!slug || !isValidSlug(slug)) return new Response('Invalid style gallery slug.', { status: 400 });
  const item = await getStyleGalleryItemBySlug(slug);
  if (!item) return new Response('Style gallery item not found.', { status: 404 });

  try {
    const manifest = await readManifest(slug);
    return Response.json({
      examples: manifest.examples,
      uploadsEnabled: Boolean(process.env.STYLE_GALLERY_UPLOAD_TOKEN),
      updatedAt: manifest.updatedAt,
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Failed to load style gallery examples.', { status: 500 });
  }
};

export const POST: APIRoute = async ({ params, request }) => {
  const slug = params.slug;
  if (!slug || !isValidSlug(slug)) return new Response('Invalid style gallery slug.', { status: 400 });
  const item = await getStyleGalleryItemBySlug(slug);
  if (!item) return new Response('Style gallery item not found.', { status: 404 });

  const expectedToken = process.env.STYLE_GALLERY_UPLOAD_TOKEN;
  if (!expectedToken) return new Response('Style gallery uploads are disabled.', { status: 503 });

  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      const body = (await request.json()) as unknown;
      const token = getJsonUploadToken(request, body);
      if (token !== expectedToken) return new Response('Invalid upload token.', { status: 401 });

      const submittedExamples = getValidatedExamples(body);
      if (!submittedExamples.length) return new Response('No examples were submitted.', { status: 400 });

      if (typeof body === 'object' && body && (body as Record<string, unknown>).action === 'cleanup') {
        for (const example of submittedExamples) {
          await deleteStyleGalleryObject(getExampleObjectKey(example, slug));
        }
        return Response.json({ deleted: submittedExamples.length });
      }

      await validateExampleObjectsExist(submittedExamples, slug);

      const manifest = await readManifest(slug);
      const nextManifest: StyleGalleryExamplesManifest = {
        version: 1,
        slug,
        examples: mergeStyleGalleryExamples([...manifest.examples, ...submittedExamples]),
        updatedAt: new Date().toISOString(),
      };
      await writeManifest(nextManifest);
      const savedManifest = await readManifest(slug);
      assertManifestContainsExamples(savedManifest, submittedExamples);

      return Response.json({
        examples: savedManifest.examples,
        uploaded: submittedExamples.length,
        skippedDuplicates: submittedExamples.length + manifest.examples.length - savedManifest.examples.length,
        updatedAt: savedManifest.updatedAt,
      });
    }

    const formData = await request.formData();
    const token = getUploadToken(request, formData);
    if (token !== expectedToken) return new Response('Invalid upload token.', { status: 401 });

    const platformValue = formData.get('platform');
    const platform = typeof platformValue === 'string' ? getStyleGalleryPlatform(platformValue) : undefined;
    if (!platform) return new Response('Invalid style gallery platform.', { status: 400 });

    const noteValue = formData.get('note');
    const note = typeof noteValue === 'string' ? noteValue.trim() : '';
    const shouldCommit = formData.get('commit') !== 'false';
    const files = formData.getAll('images').filter(isImageFile);
    if (files.length === 0) return new Response('No images were uploaded.', { status: 400 });
    if (files.length > MAX_FILES) return new Response(`Upload at most ${MAX_FILES} images at a time.`, { status: 400 });

    const manifest = await readManifest(slug);
    const knownExamples = new Set(manifest.examples.map(getStyleGalleryExampleIdentity));
    const uploadedExamples: StyleGalleryExample[] = [];
    let skippedDuplicates = 0;

    for (const file of files) {
      if (!file.type.startsWith('image/')) return new Response(`Unsupported image type: ${file.type}`, { status: 400 });
      if (file.size > MAX_FILE_SIZE_BYTES) return new Response(`Image is too large: ${file.name}`, { status: 400 });

      const bytes = new Uint8Array(await file.arrayBuffer());
      const imageHash = createHash('sha256').update(bytes).digest('hex');
      const key = `examples/${platform.slug}/${slug}/${imageHash.slice(0, 12)}.${extensionFromFile(file)}`;
      const example: StyleGalleryExample = {
        src: `/api/style-gallery/image/${key}`,
        alt: `${item.data.title} ${platform.label} example`,
        model: platform.label,
        note: note || undefined,
        uploadedAt: new Date().toISOString(),
        imageHash,
      };
      const identity = getStyleGalleryExampleIdentity(example);
      if (knownExamples.has(identity)) {
        skippedDuplicates += 1;
        continue;
      }

      await putStyleGalleryObject(key, bytes, file.type || 'application/octet-stream');
      knownExamples.add(identity);
      uploadedExamples.push(example);
    }

    const nextManifest: StyleGalleryExamplesManifest = {
      version: 1,
      slug,
      examples: mergeStyleGalleryExamples([...manifest.examples, ...uploadedExamples]),
      updatedAt: uploadedExamples.length ? new Date().toISOString() : manifest.updatedAt,
    };
    if (shouldCommit && uploadedExamples.length) await writeManifest(nextManifest);

    return Response.json({
      examples: shouldCommit ? nextManifest.examples : uploadedExamples,
      uploaded: uploadedExamples.length,
      skippedDuplicates,
      updatedAt: shouldCommit ? nextManifest.updatedAt : manifest.updatedAt,
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Failed to upload style gallery examples.', { status: 500 });
  }
};
