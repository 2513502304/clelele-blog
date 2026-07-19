import { Icon } from '@iconify/react';
import { getStyleGalleryUploadPartCount, STYLE_GALLERY_UPLOAD_CHUNK_SIZE } from '@lib/style-gallery-chunk-upload';
import { compareStyleGalleryPlatform, STYLE_GALLERY_PLATFORMS } from '@lib/style-gallery-platforms';
import { openModal } from '@store/modal';
import { useEffect, useMemo, useState } from 'react';
import type { StyleGalleryExample } from '@/types/style-gallery';

interface StyleGalleryExamplesProps {
  slug: string;
  title: string;
  initialExamples: StyleGalleryExample[];
  uploadsEnabled: boolean;
}

interface ExamplesResponse {
  examples?: StyleGalleryExample[];
  uploadsEnabled?: boolean;
  uploaded?: number;
  skippedDuplicates?: number;
}

interface PreparedUpload {
  imageHash: string;
  example: StyleGalleryExample;
  duplicate: boolean;
  exists: boolean;
}

interface FileProgress {
  id: string;
  name: string;
  loaded: number;
  total: number;
  state: 'hashing' | 'ready' | 'uploading' | 'processing' | 'saving' | 'done' | 'skipped' | 'failed';
}

interface UploadedPart {
  index: number;
  size: number;
  hash: string;
}

const TOKEN_STORAGE_KEY = 'style-gallery-upload-token';
const UPLOAD_CONCURRENCY = 5;
const MAX_UPLOAD_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const RAW_UPLOAD_TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldRetryUpload(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!shouldRetryUpload(response.status) || attempt === MAX_UPLOAD_ATTEMPTS) return response;
      lastError = new Error(`Request failed with ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_UPLOAD_ATTEMPTS) break;
    }
    await sleep(500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
  }
  throw lastError instanceof Error ? lastError : new Error('Request failed');
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function uploadWithProgress(
  url: string,
  body: Blob,
  token: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.timeout = RAW_UPLOAD_TIMEOUT_MS;
    request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.upload.onprogress = (event) => onProgress(event.loaded, event.lengthComputable ? event.total : body.size);
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else
        reject(
          Object.assign(new Error(request.responseText || `Upload failed with ${request.status}`), { status: request.status }),
        );
    };
    request.onerror = () => reject(new TypeError('Network error while uploading'));
    request.ontimeout = () => reject(new DOMException('Upload timed out', 'TimeoutError'));
    request.send(body);
  });
}

async function uploadWithProgressAndRetry(
  url: string,
  body: Blob,
  token: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      await uploadWithProgress(url, body, token, onProgress);
      return;
    } catch (error) {
      lastError = error;
      const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0;
      if ((status && !shouldRetryUpload(status)) || attempt === MAX_UPLOAD_ATTEMPTS) break;
      onProgress(0, body.size);
      await sleep(500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Upload failed');
}

async function uploadFileInChunks(
  slug: string,
  platform: string,
  file: File,
  imageHash: string,
  extension: string,
  token: string,
  onProgress: (loaded: number, total: number) => void,
  onProcessing: () => void,
): Promise<void> {
  const uploadId = crypto.randomUUID();
  const partCount = getStyleGalleryUploadPartCount(file.size);
  const parts: UploadedPart[] = [];
  const endpoint = `/api/style-gallery/examples/${slug}/upload?platform=${encodeURIComponent(platform)}`;

  try {
    for (let index = 0; index < partCount; index += 1) {
      const offset = index * STYLE_GALLERY_UPLOAD_CHUNK_SIZE;
      const chunk = file.slice(offset, Math.min(file.size, offset + STYLE_GALLERY_UPLOAD_CHUNK_SIZE));
      const chunkHash = await sha256(chunk);
      const query = new URLSearchParams({
        action: 'chunk',
        uploadId,
        partIndex: index.toString(),
        partCount: partCount.toString(),
        chunkHash,
      });
      await uploadWithProgressAndRetry(`${endpoint}&${query}`, chunk, token, (loaded) =>
        onProgress(offset + loaded, file.size),
      );
      parts.push({ index, size: chunk.size, hash: chunkHash });
      onProgress(offset + chunk.size, file.size);
    }

    onProcessing();
    const response = await fetchWithRetry(
      endpoint,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'complete',
          uploadId,
          imageHash,
          extension,
          contentType: file.type,
          size: file.size,
          parts,
        }),
      },
      RAW_UPLOAD_TIMEOUT_MS,
    );
    if (!response.ok) throw new Error((await response.text()) || `Upload completion failed with ${response.status}`);
  } catch (error) {
    await fetchWithRetry(
      endpoint,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'abort', uploadId, partCount }),
      },
      RAW_UPLOAD_TIMEOUT_MS,
    ).catch(() => undefined);
    throw error;
  }
}

export default function StyleGalleryExamples({ slug, title, initialExamples, uploadsEnabled }: StyleGalleryExamplesProps) {
  const [examples, setExamples] = useState<StyleGalleryExample[]>(initialExamples);
  const [platform, setPlatform] = useState<string>(STYLE_GALLERY_PLATFORMS[0].slug);
  const [note, setNote] = useState('');
  const [token, setToken] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [fileProgress, setFileProgress] = useState<FileProgress[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPlatform, setBulkPlatform] = useState<string>(STYLE_GALLERY_PLATFORMS[0].slug);
  const [mutating, setMutating] = useState(false);

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_STORAGE_KEY) ?? '');
  }, []);

  const exampleGroups = useMemo(
    () =>
      [
        ...examples.reduce((groups, example) => {
          const platformName = example.model?.trim() || 'Other';
          const platformExamples = groups.get(platformName) ?? [];
          platformExamples.push(example);
          groups.set(platformName, platformExamples);
          return groups;
        }, new Map<string, StyleGalleryExample[]>()),
      ].sort(([platformA], [platformB]) => compareStyleGalleryPlatform(platformA, platformB)),
    [examples],
  );

  const lightboxImages = useMemo(
    () => examples.map((example) => ({ src: example.src, alt: example.alt ?? example.model ?? 'Generated example' })),
    [examples],
  );

  const aggregateProgress = useMemo(() => {
    const total = fileProgress.reduce((sum, item) => sum + item.total, 0);
    const loaded = fileProgress.reduce((sum, item) => {
      if (['processing', 'saving', 'done', 'skipped'].includes(item.state)) return sum + item.total;
      return sum + item.loaded;
    }, 0);
    return { loaded, total, percent: total ? Math.round((loaded / total) * 100) : 0 };
  }, [fileProgress]);

  const uploadDisabledReason = !uploadsEnabled
    ? 'Uploads are disabled because STYLE_GALLERY_UPLOAD_TOKEN is not configured on the server.'
    : !token.trim()
      ? 'Enter the upload token to continue.'
      : !files.length
        ? 'Select one or more images to upload.'
        : null;

  function updateFileProgress(id: string, update: Partial<FileProgress>) {
    setFileProgress((current) => current.map((item) => (item.id === id ? { ...item, ...update } : item)));
  }

  function openExampleLightbox(example: StyleGalleryExample) {
    const currentIndex = Math.max(
      0,
      lightboxImages.findIndex((image) => image.src === example.src),
    );
    openModal('imageLightbox', {
      src: example.src,
      alt: example.alt ?? example.model ?? 'Generated example',
      images: lightboxImages,
      currentIndex,
    });
  }

  async function apiMutation(method: 'PATCH' | 'DELETE', body: { ids: string[]; platform?: string }) {
    const response = await fetchWithRetry(`/api/style-gallery/examples/${slug}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error((await response.text()) || `Request failed with ${response.status}`);
    const data = (await response.json()) as ExamplesResponse;
    setExamples(data.examples ?? []);
    setSelectedIds(new Set());
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  }

  async function updateSelectedPlatform() {
    if (!selectedIds.size || mutating) return;
    setMutating(true);
    setStatus(`Moving ${selectedIds.size} selected example${selectedIds.size === 1 ? '' : 's'}`);
    try {
      await apiMutation('PATCH', { ids: [...selectedIds], platform: bulkPlatform });
      setStatus('Selected examples updated');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to update examples');
    } finally {
      setMutating(false);
    }
  }

  async function deleteSelectedExamples() {
    if (
      !selectedIds.size ||
      mutating ||
      !window.confirm(`Delete ${selectedIds.size} selected example${selectedIds.size === 1 ? '' : 's'} permanently?`)
    )
      return;
    setMutating(true);
    setStatus(`Deleting ${selectedIds.size} selected example${selectedIds.size === 1 ? '' : 's'}`);
    try {
      await apiMutation('DELETE', { ids: [...selectedIds] });
      setStatus('Selected examples deleted');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to delete examples');
    } finally {
      setMutating(false);
    }
  }

  function toggleExample(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(groupExamples: StyleGalleryExample[]) {
    setSelectedIds((current) => {
      const next = new Set(current);
      const selectAll = groupExamples.some((example) => !next.has(example.id));
      for (const example of groupExamples) selectAll ? next.add(example.id) : next.delete(example.id);
      return next;
    });
  }

  async function cleanupUploadedExamples(uploadedExamples: StyleGalleryExample[]) {
    if (!uploadedExamples.length) return;
    await fetchWithRetry(`/api/style-gallery/examples/${slug}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action: 'cleanup', examples: uploadedExamples }),
    });
  }

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!files.length || uploading) return;
    setUploading(true);
    setStatus('Hashing selected images');
    const form = event.currentTarget;
    const selected = files.map((file, index) => ({ id: `${index}-${file.name}`, file, imageHash: '' }));
    setFileProgress(selected.map(({ id, file }) => ({ id, name: file.name, loaded: 0, total: file.size, state: 'hashing' })));

    const uploadedExamples: StyleGalleryExample[] = [];
    try {
      let nextHashIndex = 0;
      async function hashWorker() {
        while (nextHashIndex < selected.length) {
          const entry = selected[nextHashIndex];
          nextHashIndex += 1;
          entry.imageHash = await sha256(entry.file);
          updateFileProgress(entry.id, { state: 'ready' });
        }
      }
      await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, selected.length) }, hashWorker));

      setStatus('Checking existing examples');
      const prepareResponse = await fetchWithRetry(`/api/style-gallery/examples/${slug}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          action: 'prepare',
          platform,
          note: note.trim() || undefined,
          files: selected.map(({ file, imageHash }) => ({ name: file.name, type: file.type, size: file.size, imageHash })),
        }),
      });
      if (!prepareResponse.ok) throw new Error((await prepareResponse.text()) || 'Failed to prepare uploads');
      const prepared = ((await prepareResponse.json()) as { uploads: PreparedUpload[] }).uploads;

      let nextUploadIndex = 0;
      const uploadFailures: string[] = [];
      const examplesToCommit: StyleGalleryExample[] = [];
      async function uploadWorker() {
        while (nextUploadIndex < selected.length) {
          const index = nextUploadIndex;
          nextUploadIndex += 1;
          const entry = selected[index];
          const upload = prepared[index];
          if (upload.duplicate) {
            updateFileProgress(entry.id, { state: 'skipped', loaded: entry.file.size });
            continue;
          }
          if (!upload.exists) {
            updateFileProgress(entry.id, { state: 'uploading' });
            const extension = upload.example.src.split('.').pop() ?? 'jpg';
            try {
              await uploadFileInChunks(
                slug,
                platform,
                entry.file,
                entry.imageHash,
                extension,
                token,
                (loaded, total) => updateFileProgress(entry.id, { state: 'uploading', loaded, total }),
                () => updateFileProgress(entry.id, { state: 'processing', loaded: entry.file.size }),
              );
              uploadedExamples.push(upload.example);
            } catch (error) {
              updateFileProgress(entry.id, { state: 'failed' });
              uploadFailures.push(`${entry.file.name}: ${error instanceof Error ? error.message : 'Upload failed'}`);
              continue;
            }
          }
          examplesToCommit.push(upload.example);
          updateFileProgress(entry.id, { state: 'saving', loaded: entry.file.size });
        }
      }
      await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, selected.length) }, uploadWorker));

      if (examplesToCommit.length) {
        setStatus('Saving sub-gallery');
        const mergeResponse = await fetchWithRetry(`/api/style-gallery/examples/${slug}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ action: 'merge', examples: examplesToCommit }),
        });
        if (!mergeResponse.ok) {
          const message = await mergeResponse.text();
          throw new Error(message);
        }
        const mergeData = (await mergeResponse.json()) as ExamplesResponse;
        setExamples(mergeData.examples ?? []);
        uploadedExamples.length = 0;
      }

      setFileProgress((current) =>
        current.map((item) => (item.state === 'saving' ? { ...item, state: 'done' as const } : item)),
      );

      try {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
      } catch {
        // Upload success must not be reported as a failure when browser storage is unavailable.
      }
      const skipped = prepared.filter((upload) => upload.duplicate).length;
      const statusParts = [
        `Added ${examplesToCommit.length} example${examplesToCommit.length === 1 ? '' : 's'}`,
        skipped ? `skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}` : '',
        uploadFailures.length ? `${uploadFailures.length} failed: ${uploadFailures.join('; ')}` : '',
      ].filter(Boolean);
      setStatus(statusParts.join('; '));
      if (!uploadFailures.length) {
        setFiles([]);
        setNote('');
        form.reset();
      }
    } catch (error) {
      await cleanupUploadedExamples(uploadedExamples).catch(() => undefined);
      setStatus(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="rounded-lg border border-rose-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="font-bold text-rose-500 text-sm">Generated examples</p>
          <h2 className="font-black text-2xl text-gray-950 dark:text-white">Sub-gallery</h2>
        </div>
        <span className="rounded-full bg-rose-50 px-3 py-1 font-bold text-rose-500 text-xs dark:bg-rose-950/40 dark:text-rose-200">
          {examples.length}
        </span>
      </div>

      <form
        onSubmit={handleUpload}
        className="mb-5 grid grid-cols-[1fr_1fr] gap-3 rounded-lg border border-sky-100 bg-sky-50/60 p-3 md:grid-cols-1 dark:border-sky-950/60 dark:bg-sky-950/20"
      >
        <label className="space-y-1 font-bold text-gray-500 text-xs dark:text-gray-300">
          <span>Platform</span>
          <select
            value={platform}
            onChange={(event) => setPlatform(event.currentTarget.value)}
            className="h-10 w-full rounded-lg border border-sky-100 bg-white px-3 text-gray-900 text-sm outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-white"
          >
            {STYLE_GALLERY_PLATFORMS.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 font-bold text-gray-500 text-xs dark:text-gray-300">
          <span>Upload token</span>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.currentTarget.value)}
            className="h-10 w-full rounded-lg border border-sky-100 bg-white px-3 text-gray-900 text-sm outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-white"
            autoComplete="off"
          />
        </label>
        <label className="space-y-1 font-bold text-gray-500 text-xs dark:text-gray-300">
          <span>Images</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={(event) => setFiles([...(event.currentTarget.files ?? [])])}
            className="block h-10 w-full rounded-lg border border-sky-100 bg-white px-3 py-2 text-gray-900 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-gray-950 file:px-3 file:py-1 file:font-bold file:text-white dark:border-gray-800 dark:bg-gray-900 dark:text-white dark:file:bg-white dark:file:text-gray-950"
          />
        </label>
        <label className="space-y-1 font-bold text-gray-500 text-xs dark:text-gray-300">
          <span>Note</span>
          <input
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
            className="h-10 w-full rounded-lg border border-sky-100 bg-white px-3 text-gray-900 text-sm outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-white"
          />
        </label>

        {fileProgress.length > 0 && (
          <div className="col-span-2 space-y-2 md:col-span-1" aria-live="polite">
            <div className="flex items-center justify-between text-gray-500 text-xs dark:text-gray-300">
              <span>{status}</span>
              <span className="font-mono tabular-nums">{aggregateProgress.percent}%</span>
            </div>
            <progress
              className="h-2 w-full overflow-hidden rounded-full accent-rose-500"
              value={aggregateProgress.loaded}
              max={aggregateProgress.total || 1}
            />
            <div className="grid max-h-28 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto md:grid-cols-1">
              {fileProgress.map((item) => (
                <div key={item.id} className="flex min-w-0 items-center gap-2 text-xs">
                  <Icon
                    icon={
                      item.state === 'failed'
                        ? 'ri:error-warning-line'
                        : item.state === 'done' || item.state === 'skipped'
                          ? 'ri:check-line'
                          : 'ri:loader-4-line'
                    }
                    className={`size-3.5 shrink-0 ${['hashing', 'uploading', 'processing', 'saving'].includes(item.state) ? 'animate-spin' : ''}`}
                  />
                  <span className="truncate">{item.name}</span>
                  <span className="ml-auto shrink-0 text-gray-400">{item.state}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="col-span-2 flex flex-wrap items-center justify-between gap-3 md:col-span-1">
          <p className="text-gray-500 text-xs dark:text-gray-300">
            {uploadDisabledReason || (files.length ? `${files.length} image${files.length > 1 ? 's' : ''} selected` : status)}
          </p>
          <button
            type="submit"
            disabled={Boolean(uploadDisabledReason) || uploading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-gray-950 px-4 font-bold text-sm text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-950 dark:hover:bg-rose-200"
            title={uploadDisabledReason ?? `Upload examples for ${title}`}
          >
            <Icon
              icon={uploading ? 'ri:loader-4-line' : 'ri:upload-cloud-2-line'}
              className={`size-4 ${uploading ? 'animate-spin' : ''}`}
            />
            {uploading ? 'Uploading' : 'Upload'}
          </button>
        </div>
      </form>

      {examples.length ? (
        <div className="space-y-6">
          {uploadsEnabled && (
            <div className="sticky top-3 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-white/95 p-3 shadow-md backdrop-blur dark:border-rose-900 dark:bg-gray-950/95">
              <span className="mr-auto font-bold text-sm tabular-nums">{selectedIds.size} selected</span>
              <select
                value={bulkPlatform}
                disabled={!selectedIds.size || mutating}
                onChange={(event) => setBulkPlatform(event.currentTarget.value)}
                aria-label="Destination platform"
                className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm outline-none disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950"
              >
                {STYLE_GALLERY_PLATFORMS.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {item.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!selectedIds.size || mutating}
                onClick={updateSelectedPlatform}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-950 px-3 font-bold text-sm text-white disabled:opacity-50 dark:bg-white dark:text-gray-950"
              >
                <Icon icon="ri:swap-2-line" className="size-4" />
                Change platform
              </button>
              <button
                type="button"
                disabled={!selectedIds.size || mutating}
                onClick={deleteSelectedExamples}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 font-bold text-red-500 text-sm disabled:opacity-50 dark:border-red-950"
              >
                <Icon icon="ri:delete-bin-line" className="size-4" />
                Delete
              </button>
            </div>
          )}
          {exampleGroups.map(([platformName, platformExamples]) => (
            <section className="space-y-3" key={platformName}>
              <div className="flex items-center justify-between gap-3 border-rose-100 border-b pb-2 dark:border-gray-800">
                <h3 className="font-black text-gray-900 text-lg dark:text-white">{platformName}</h3>
                <div className="flex items-center gap-2">
                  {uploadsEnabled && (
                    <label className="inline-flex cursor-pointer items-center gap-2 text-muted-foreground text-xs">
                      <input
                        type="checkbox"
                        checked={platformExamples.every((example) => selectedIds.has(example.id))}
                        onChange={() => toggleGroup(platformExamples)}
                        className="size-4 accent-rose-500"
                      />
                      Select group
                    </label>
                  )}
                  <span className="rounded-full bg-sky-50 px-3 py-1 font-bold text-sky-600 text-xs dark:bg-sky-950/50 dark:text-sky-200">
                    {platformExamples.length}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 md:grid-cols-2">
                {platformExamples.map((example) => {
                  return (
                    <figure
                      key={example.src}
                      className="relative overflow-hidden rounded-lg border border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-900"
                    >
                      <button
                        type="button"
                        onClick={() => openExampleLightbox(example)}
                        className="group block w-full cursor-zoom-in overflow-hidden text-left"
                        aria-label={`Open ${example.alt ?? example.model ?? 'generated example'} preview`}
                      >
                        <img
                          src={example.src}
                          alt={example.alt ?? example.model ?? 'Generated example'}
                          loading="lazy"
                          className="aspect-square w-full object-cover transition duration-200 group-hover:scale-105"
                        />
                      </button>
                      {uploadsEnabled && (
                        <label className="absolute top-2 left-2 flex size-8 cursor-pointer items-center justify-center rounded-md bg-white/90 shadow dark:bg-gray-950/90">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(example.id)}
                            disabled={mutating}
                            onChange={() => toggleExample(example.id)}
                            aria-label={`Select ${example.alt ?? 'generated example'}`}
                            className="size-4 accent-rose-500"
                          />
                        </label>
                      )}
                      <figcaption className="space-y-2 p-3 text-gray-500 text-xs dark:text-gray-300">
                        {example.note && <p>{example.note}</p>}
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-rose-200 border-dashed bg-rose-50/60 p-6 text-gray-500 text-sm dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-300">
          Generated examples created from this prompt will appear here after they are added manually.
        </div>
      )}
    </section>
  );
}
