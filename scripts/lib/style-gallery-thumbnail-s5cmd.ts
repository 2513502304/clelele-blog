import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { mapWithConcurrency } from '../../src/lib/map-with-concurrency';
import { encodeStyleGalleryExampleThumbnail } from '../../src/lib/style-gallery-example-thumbnail';
import { getStyleGalleryExampleThumbnailKey, parseStyleGalleryImageApiPath } from '../../src/lib/style-gallery-image-key';

const execute = promisify(execFile);

/** Bulk S3 transfers bypass per-image Node request overhead; use the same encoder as normal uploads. */
export async function backfillThumbnailsWithS5cmd(
  sources: string[],
  apply: boolean,
  concurrency: number,
  hfUpload = false,
): Promise<void> {
  const bucket = process.env.HF_S3_BUCKET ?? 'raw-datasets';
  const prefix = process.env.STYLE_GALLERY_BUCKET_PREFIX ?? 'image-style-prompt-gallery';
  const root = `s3://${bucket}/${prefix}/`;
  const endpoint = process.env.HF_S3_ENDPOINT ?? 'https://s3.hf.co/clelele0722';
  const endpointUrl = new URL(endpoint);
  if (hfUpload && (endpointUrl.origin !== 'https://s3.hf.co' || !/^\/[\w-]+\/?$/.test(endpointUrl.pathname)))
    throw new Error('--hf-upload requires a Hugging Face S3 endpoint with its namespace.');
  const namespace = endpointUrl.pathname.replace(/^\/|\/$/g, '');
  const useHfCredentials = Boolean(process.env.HF_S3_ACCESS_KEY_ID && process.env.HF_S3_SECRET_ACCESS_KEY);
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: useHfCredentials ? process.env.HF_S3_ACCESS_KEY_ID : process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: useHfCredentials ? process.env.HF_S3_SECRET_ACCESS_KEY : process.env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: process.env.HF_S3_REGION ?? 'us-east-1',
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_SESSION_TOKEN: useHfCredentials ? '' : process.env.AWS_SESSION_TOKEN,
  };
  async function run(args: string[]): Promise<string> {
    try {
      const result = await execute(
        's5cmd',
        ['--endpoint-url', endpoint, '--numworkers', String(concurrency), '--retry-count', '3', '--json', ...args],
        { env, maxBuffer: 16 * 1024 * 1024 },
      );
      return result.stdout;
    } catch {
      // Commands contain only public asset paths; credentials stay in the child environment.
      // Avoid relaying SDK diagnostics that might contain signed URLs.
      throw new Error(`s5cmd ${args[0]} failed. Re-run to resume from completed thumbnail objects.`);
    }
  }
  const listing = await run(['ls', `${root}examples/thumbs/*`]);
  const existing = new Set(
    listing
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((row) => row.type === 'file')
      .map((row) => row.key),
  );
  const missing = sources.filter((source) => !existing.has(root + getStyleGalleryExampleThumbnailKey(source)));
  console.log(
    JSON.stringify({
      transport: hfUpload ? 's5cmd-download/hf-upload' : 's5cmd',
      images: sources.length,
      existing: sources.length - missing.length,
      missing: missing.length,
      apply,
    }),
  );
  if (!apply) {
    if (missing.length) process.exitCode = 1;
    return;
  }
  if (!missing.length) return;
  const directory = await mkdtemp(path.join(tmpdir(), 'gallery-s5cmd-thumbnails-'));
  const previewsDirectory = path.join(directory, 'thumbs');
  await mkdir(previewsDirectory, { mode: 0o700 });
  let created = 0,
    originalBytes = 0,
    thumbnailBytes = 0;
  console.log(JSON.stringify({ workDir: directory }));
  for (let offset = 0; offset < missing.length; offset += 128) {
    const batch = missing.slice(offset, offset + 128).map((source) => {
      const key = parseStyleGalleryImageApiPath(source);
      if (!key) throw new Error('Invalid original image path.');
      const thumbnailKey = getStyleGalleryExampleThumbnailKey(source);
      return {
        key,
        thumbnailKey,
        local: path.join(directory, path.basename(key)),
        preview: path.join(previewsDirectory, path.basename(thumbnailKey)),
      };
    });
    const commands = path.join(directory, 'commands.txt');
    await writeFile(
      commands,
      batch
        .map(
          (entry) =>
            `cp --source-region ${JSON.stringify(env.AWS_REGION)} ${JSON.stringify(root + entry.key)} ${JSON.stringify(entry.local)}`,
        )
        .join('\n'),
      { mode: 0o600 },
    );
    await run(['run', commands]);
    await mapWithConcurrency(batch, 4, async (entry) => {
      const bytes = await readFile(entry.local);
      if (createHash('sha256').update(bytes).digest('hex') !== path.basename(entry.key).split('.')[0])
        throw new Error('Downloaded original hash mismatch.');
      const thumbnail = await encodeStyleGalleryExampleThumbnail(bytes);
      await writeFile(entry.preview, thumbnail, { mode: 0o600 });
      originalBytes += bytes.length;
      thumbnailBytes += thumbnail.length;
    });
    if (hfUpload) {
      try {
        // Native HF sync batches publication; never delete thumbnails from earlier batches.
        // Authentication uses the existing hf login, independently of S3 credentials.
        await execute(
          'hf',
          [
            'buckets',
            'sync',
            previewsDirectory,
            `hf://buckets/${namespace}/${bucket}/${prefix}/examples/thumbs`,
            '--no-delete',
          ],
          {
            env: { ...process.env, HF_HUB_DISABLE_PROGRESS_BARS: '1', HF_XET_HIGH_PERFORMANCE: '1' },
            maxBuffer: 16 * 1024 * 1024,
          },
        );
      } catch {
        throw new Error('HF batch upload failed. Check hf authentication and re-run to resume.');
      }
    } else {
      await writeFile(
        commands,
        batch
          .map(
            (entry) =>
              `cp --destination-region ${JSON.stringify(env.AWS_REGION)} --content-type image/webp ${JSON.stringify(entry.preview)} ${JSON.stringify(root + entry.thumbnailKey)}`,
          )
          .join('\n'),
        { mode: 0o600 },
      );
      await run(['run', commands]);
    }
    created += batch.length;
    console.log(JSON.stringify({ created, remaining: missing.length - created, originalBytes, thumbnailBytes }));
    // Delete only this batch's own scratch files after all uploads have succeeded.
    await Promise.all(batch.flatMap((entry) => [unlink(entry.local), unlink(entry.preview)]));
  }
  console.log(JSON.stringify({ verifiedByUpload: created, total: sources.length, originalBytes, thumbnailBytes }));
}
