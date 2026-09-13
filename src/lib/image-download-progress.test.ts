import assert from 'node:assert/strict';
import test from 'node:test';
import { type ImageDownloadProgress, readImageDownload } from './image-download-progress';

test('download progress reports actual bytes and preserves the image body', async () => {
  const progress: ImageDownloadProgress[] = [];
  const blob = await readImageDownload(
    new Response('image', { headers: { 'content-length': '5' } }),
    new AbortController().signal,
    (value) => progress.push(value),
  );
  assert.equal(await blob.text(), 'image');
  assert.deepEqual(progress.at(-1), { received: 5, total: 5 });
});

test('missing, compressed and understated lengths never claim a false percentage', async () => {
  const cases: HeadersInit[] = [
    {},
    { 'content-length': '2' },
    { 'content-length': '20' },
    { 'content-length': '20', 'content-encoding': 'gzip' },
  ];
  for (const headers of cases) {
    const progress: ImageDownloadProgress[] = [];
    await readImageDownload(new Response('image', { headers }), new AbortController().signal, (value) => progress.push(value));
    assert.deepEqual(progress.at(-1), { received: 5, total: undefined });
  }
});

test('aborted and oversized streams are cancelled instead of retained as blobs', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    readImageDownload(new Response('image'), controller.signal, () => undefined),
    { name: 'AbortError' },
  );
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { 'content-length': String(65 * 1024 * 1024) } },
  );
  await assert.rejects(
    readImageDownload(response, new AbortController().signal, () => undefined),
    /budget/,
  );
  assert.equal(cancelled, true);
});

test('aborting a stalled independent stream cancels its pending read', { timeout: 1000 }, async () => {
  let started: () => void = () => undefined;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      pull() {
        started();
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  const controller = new AbortController();
  const download = readImageDownload(response, controller.signal, () => undefined);
  await reading;
  controller.abort();
  await assert.rejects(download, { name: 'AbortError' });
  assert.equal(cancelled, true);
});
