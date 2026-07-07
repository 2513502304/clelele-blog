import { Icon } from '@iconify/react';
import { mergeStyleGalleryExamples } from '@lib/style-gallery-examples';
import { compareStyleGalleryPlatform, STYLE_GALLERY_PLATFORMS } from '@lib/style-gallery-platforms';
import { openModal } from '@store/modal';
import { useEffect, useMemo, useState } from 'react';
import type { StyleGalleryExample } from '@/types/style-gallery';

interface StyleGalleryExamplesProps {
  slug: string;
  title: string;
  initialExamples: StyleGalleryExample[];
}

interface ExamplesResponse {
  examples?: StyleGalleryExample[];
  uploadsEnabled?: boolean;
  uploaded?: number;
  skippedDuplicates?: number;
}

const TOKEN_STORAGE_KEY = 'style-gallery-upload-token';
const UPLOAD_CONCURRENCY = 5;
const MAX_UPLOAD_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldRetryUpload(status: number): boolean {
  return status === 429 || status >= 500;
}

export default function StyleGalleryExamples({ slug, title, initialExamples }: StyleGalleryExamplesProps) {
  const [examples, setExamples] = useState<StyleGalleryExample[]>(initialExamples);
  const [uploadsEnabled, setUploadsEnabled] = useState(true);
  const [platform, setPlatform] = useState<string>(STYLE_GALLERY_PLATFORMS[0].slug);
  const [note, setNote] = useState('');
  const [token, setToken] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_STORAGE_KEY) ?? '');
    let cancelled = false;
    fetch(`/api/style-gallery/examples/${slug}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Examples request failed with ${response.status}`);
        return response.json() as Promise<ExamplesResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        setExamples(mergeStyleGalleryExamples([...initialExamples, ...(data.examples ?? [])]));
        setUploadsEnabled(data.uploadsEnabled ?? false);
      })
      .catch(() => {
        if (!cancelled) setStatus('Failed to load generated examples');
      });
    return () => {
      cancelled = true;
    };
  }, [initialExamples, slug]);

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
    () =>
      examples.map((example) => ({
        src: example.src,
        alt: example.alt ?? example.model ?? 'Generated example',
      })),
    [examples],
  );

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

  async function cleanupUploadedExamples(uploadedExamples: StyleGalleryExample[]) {
    if (!uploadedExamples.length) return;
    await fetch(`/api/style-gallery/examples/${slug}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action: 'cleanup', examples: uploadedExamples }),
    });
  }

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!files.length || uploading) return;

    setUploading(true);
    setStatus(null);
    const form = event.currentTarget;

    try {
      const selectedFiles = [...files];
      let uploaded = 0;
      let skippedDuplicates = 0;
      let completed = 0;
      let nextFileIndex = 0;
      const uploadedExamples: StyleGalleryExample[] = [];
      const failures: string[] = [];

      async function uploadFile(file: File): Promise<ExamplesResponse> {
        let lastError = '';
        for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
          try {
            const formData = new FormData();
            formData.set('platform', platform);
            formData.set('commit', 'false');
            if (note.trim()) formData.set('note', note.trim());
            formData.append('images', file);

            const response = await fetch(`/api/style-gallery/examples/${slug}`, {
              method: 'POST',
              headers: token ? { authorization: `Bearer ${token}` } : undefined,
              body: formData,
            });
            if (response.ok) return (await response.json()) as ExamplesResponse;

            lastError = await response.text();
            if (!shouldRetryUpload(response.status) || attempt === MAX_UPLOAD_ATTEMPTS) {
              throw new Error(lastError || `Upload failed with ${response.status}`);
            }
          } catch (error) {
            lastError = error instanceof Error ? error.message : 'Upload failed';
            if (attempt === MAX_UPLOAD_ATTEMPTS) throw new Error(lastError);
          }
          await sleep(500 * attempt);
        }
        throw new Error(lastError || 'Upload failed');
      }

      async function worker() {
        while (nextFileIndex < selectedFiles.length) {
          const fileIndex = nextFileIndex;
          nextFileIndex += 1;
          const file = selectedFiles[fileIndex];
          setStatus(`Uploading ${completed}/${selectedFiles.length}`);

          try {
            const data = await uploadFile(file);
            uploaded += data.uploaded ?? 0;
            skippedDuplicates += data.skippedDuplicates ?? 0;
            uploadedExamples.push(...(data.examples ?? []));
          } catch (error) {
            failures.push(`${file.name}: ${error instanceof Error ? error.message : 'Upload failed'}`);
          } finally {
            completed += 1;
            setStatus(`Uploading ${completed}/${selectedFiles.length}`);
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, selectedFiles.length) }, () => worker()));

      if (uploadedExamples.length) {
        setStatus('Saving gallery');
        let mergeResponse: Response;
        try {
          mergeResponse = await fetch(`/api/style-gallery/examples/${slug}`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ examples: uploadedExamples }),
          });
        } catch (error) {
          await cleanupUploadedExamples(uploadedExamples);
          throw error;
        }
        if (!mergeResponse.ok) {
          const message = await mergeResponse.text();
          await cleanupUploadedExamples(uploadedExamples);
          throw new Error(message);
        }

        const mergeData = (await mergeResponse.json()) as ExamplesResponse;
        skippedDuplicates += mergeData.skippedDuplicates ?? 0;
        setExamples(mergeStyleGalleryExamples([...initialExamples, ...(mergeData.examples ?? [])]));
      }

      localStorage.setItem(TOKEN_STORAGE_KEY, token);
      setFiles([]);
      setNote('');
      form.reset();
      setStatus(
        [
          `Uploaded ${uploaded}`,
          skippedDuplicates ? `skipped ${skippedDuplicates} duplicate${skippedDuplicates > 1 ? 's' : ''}` : '',
          failures.length ? `${failures.length} failed` : '',
        ]
          .filter(Boolean)
          .join('; '),
      );
    } catch (error) {
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
        <div className="col-span-2 flex flex-wrap items-center justify-between gap-3 md:col-span-1">
          <p className="text-gray-500 text-xs dark:text-gray-300">
            {files.length ? `${files.length} image${files.length > 1 ? 's' : ''} selected` : status}
          </p>
          <button
            type="submit"
            disabled={!uploadsEnabled || uploading || !files.length}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-gray-950 px-4 font-bold text-sm text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-950 dark:hover:bg-rose-200"
            title={uploadsEnabled ? `Upload examples for ${title}` : 'Uploads disabled'}
          >
            <Icon icon={uploading ? 'ri:loader-4-line' : 'ri:upload-cloud-2-line'} className="size-4" />
            {uploading ? 'Uploading' : 'Upload'}
          </button>
        </div>
      </form>

      {examples.length ? (
        <div className="space-y-6">
          {exampleGroups.map(([platformName, platformExamples]) => (
            <section className="space-y-3" key={platformName}>
              <div className="flex items-center justify-between gap-3 border-rose-100 border-b pb-2 dark:border-gray-800">
                <h3 className="font-black text-gray-900 text-lg dark:text-white">{platformName}</h3>
                <span className="rounded-full bg-sky-50 px-3 py-1 font-bold text-sky-600 text-xs dark:bg-sky-950/50 dark:text-sky-200">
                  {platformExamples.length}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 md:grid-cols-2">
                {platformExamples.map((example) => (
                  <figure
                    key={example.src}
                    className="overflow-hidden rounded-lg border border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-900"
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
                    {(example.note || example.alt) && (
                      <figcaption className="space-y-1 p-3 text-gray-500 text-xs dark:text-gray-300">
                        {example.note && <p>{example.note}</p>}
                        {!example.note && example.alt && <p>{example.alt}</p>}
                      </figcaption>
                    )}
                  </figure>
                ))}
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
