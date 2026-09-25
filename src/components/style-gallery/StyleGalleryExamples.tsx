import { useGalleryMarquee } from '@hooks/useGalleryMarquee';
import { Icon } from '@iconify/react';
import { downloadStyleGalleryImages } from '@lib/style-gallery-batch-download';
import { getReusableStyleGalleryImageUrl } from '@lib/style-gallery-image-client';
import {
  createStyleGalleryCopyAction,
  createStyleGalleryDeleteAction,
  getStyleGalleryLightboxElementId,
  locateStyleGalleryElement,
  type StyleGalleryLightboxActionLabels,
} from '@lib/style-gallery-lightbox-actions';
import { STYLE_GALLERY_EXAMPLE_LIGHTBOX_PREFETCH } from '@lib/style-gallery-lightbox-prefetch';
import {
  getStyleGalleryManagementToken,
  rememberStyleGalleryManagementToken,
  STYLE_GALLERY_TOKEN_CHANGED_EVENT,
} from '@lib/style-gallery-management-token';
import { groupStyleGalleryExamplesByPlatform, STYLE_GALLERY_PLATFORMS } from '@lib/style-gallery-platforms';
import { loadStyleGalleryPromptChoices } from '@lib/style-gallery-prompt-client';
import {
  getSelectedStyleGalleryPrompt,
  STYLE_GALLERY_PROMPT_SELECTED_EVENT,
  type StyleGalleryPromptSelectedDetail,
} from '@lib/style-gallery-prompt-selection';
import {
  chunkStyleGalleryRequestItems,
  STYLE_GALLERY_MUTATION_BATCH_SIZE,
  STYLE_GALLERY_PREPARE_BATCH_SIZE,
} from '@lib/style-gallery-request-batches';
import { getStyleGallerySourceHash } from '@lib/style-gallery-source-groups';
import { fetchWithRetry, sha256, uploadFile } from '@lib/style-gallery-upload-client';
import type { StyleGalleryVisualFeature } from '@lib/style-gallery-visual-types';
import { openModal } from '@store/modal';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StyleGalleryExample, StyleGalleryExampleView, StyleGalleryImageDimensions } from '@/types/style-gallery';
import GallerySelectionDock from './GallerySelectionDock';
import {
  createStyleGalleryLightboxLikeAction,
  StyleGalleryLikeButton,
  type StyleGalleryLikeLabels,
  useStyleGalleryLikes,
} from './StyleGalleryLikeButton';
import StyleGallerySharedImage from './StyleGallerySharedImage';

interface StyleGalleryExamplesProps {
  locale: string;
  slug: string;
  title: string;
  prompt: string;
  promptCount: number;
  promptRevision: string;
  initialExamples: StyleGalleryExampleView[];
  uploadsEnabled: boolean;
  likeLabels: StyleGalleryLikeLabels;
  lightboxActionLabels: StyleGalleryLightboxActionLabels;
}

interface ExamplesResponse {
  examples?: StyleGalleryExample[];
  uploadsEnabled?: boolean;
  uploaded?: number;
  skippedDuplicates?: number;
  visualIndexUpdated?: boolean;
}

interface PreparedUpload {
  imageHash: string;
  example: StyleGalleryExample;
  duplicate: boolean;
  exists: boolean;
}

async function computeExampleVisualFeature(file: File, imageHash: string): Promise<StyleGalleryVisualFeature> {
  // 与视觉筛选器共用同一浏览器懒加载边界。上传表单服务端渲染时绝不能把 ONNX 运行时带进 Function。
  if (import.meta.env.SSR) throw new Error('Visual feature extraction is only available in the browser.');
  const { computeStyleGalleryVisualFeatureFromFile } = await import('@lib/style-gallery-visual-feature-browser');
  return computeStyleGalleryVisualFeatureFromFile(file, imageHash);
}

interface FileProgress {
  id: string;
  name: string;
  loaded: number;
  total: number;
  state: 'hashing' | 'ready' | 'uploading' | 'processing' | 'saving' | 'done' | 'skipped' | 'failed';
}

interface SelectedUpload {
  id: string;
  file: File;
  imageHash: string;
  dimensions?: StyleGalleryImageDimensions;
}

const UPLOAD_CONCURRENCY = 5;
/**
 * 单个 prompt item 的 Sub-gallery 管理器。
 * 支持小文件直传、大文件分块、并发文件任务、逐文件失败隔离，以及带令牌的批量改平台/删除操作。
 */
export default function StyleGalleryExamples({
  locale,
  slug,
  title,
  prompt,
  promptCount,
  promptRevision,
  initialExamples,
  uploadsEnabled,
  likeLabels,
  lightboxActionLabels,
}: StyleGalleryExamplesProps) {
  const zh = locale.startsWith('zh');
  const ja = locale.startsWith('ja');
  const selectionText = {
    start: zh ? '选择图片' : ja ? '画像を選択' : 'Select images',
    exit: zh ? '退出多选' : ja ? '選択を終了' : 'Exit selection',
    all: zh ? '全选图片' : ja ? 'すべて選択' : 'Select all',
    clear: zh ? '清空选择' : ja ? '選択をクリア' : 'Clear selection',
    platform: zh ? '目标平台' : ja ? '移動先プラットフォーム' : 'Destination platform',
    change: zh ? '更改平台' : ja ? 'プラットフォーム変更' : 'Change platform',
    download: zh ? '下载' : ja ? 'ダウンロード' : 'Download',
    downloading: zh ? '正在下载' : ja ? 'ダウンロード中' : 'Downloading',
    remove: zh ? '删除' : ja ? '削除' : 'Delete',
    group: zh ? '选择此组' : ja ? 'グループを選択' : 'Select group',
    hint: zh
      ? '拖动框选；Ctrl / Shift / ⌘ 追加选择。可滚轮浏览。'
      : ja
        ? 'ドラッグで選択。Ctrl / Shift / ⌘ で追加。スクロール可。'
        : 'Drag to select; Ctrl / Shift / ⌘ adds. Scroll while dragging.',
  };
  const [examples, setExamples] = useState<StyleGalleryExample[]>(initialExamples);
  const likes = useStyleGalleryLikes(Object.fromEntries(initialExamples.map((example) => [example.id, example.likeCount])));
  const [platform, setPlatform] = useState<string>(STYLE_GALLERY_PLATFORMS[0].slug);
  const [note, setNote] = useState('');
  const [token, setToken] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [fileProgress, setFileProgress] = useState<FileProgress[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPlatform, setBulkPlatform] = useState<string>(STYLE_GALLERY_PLATFORMS[0].slug);
  const [mutating, setMutating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const marquee = useGalleryMarquee({
    enabled: selectionMode && !mutating && !downloading,
    selected: selectedIds,
    onChange: setSelectedIds,
  });
  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };
  const activePrompt = useRef(prompt);
  // 记录浏览器已经解码成功的高清示例，Lightbox 可复用同一 URL；ref 更新不会扰动图片网格。
  const loadedExampleSources = useRef(new Set<string>());

  useEffect(() => {
    const syncToken = () => setToken(getStyleGalleryManagementToken());
    syncToken();
    window.addEventListener(STYLE_GALLERY_TOKEN_CHANGED_EVENT, syncToken);
    return () => window.removeEventListener(STYLE_GALLERY_TOKEN_CHANGED_EVENT, syncToken);
  }, []);

  useEffect(() => {
    activePrompt.current = getSelectedStyleGalleryPrompt(slug) ?? prompt;
    const handlePromptSelection = (event: Event) => {
      const detail = (event as CustomEvent<StyleGalleryPromptSelectedDetail>).detail;
      if (detail?.slug === slug) activePrompt.current = detail.prompt;
    };
    window.addEventListener(STYLE_GALLERY_PROMPT_SELECTED_EVENT, handlePromptSelection);
    return () => window.removeEventListener(STYLE_GALLERY_PROMPT_SELECTED_EVENT, handlePromptSelection);
  }, [prompt, slug]);

  const exampleGroups = useMemo(() => groupStyleGalleryExamplesByPlatform(examples), [examples]);

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

  function openExampleLightbox(example: StyleGalleryExample, platformExamples: StyleGalleryExample[]) {
    // 导航数组只包含当前视觉分组；平台内部仍保持上传顺序。
    const sourceThumbnail = [...document.querySelectorAll<HTMLImageElement>('main img')].find(
      (image) => image.complete && image.naturalWidth > 0 && /\/(source|thumb)\//.test(image.currentSrc || image.src),
    );
    const source = {
      hash: getStyleGallerySourceHash({ sourceSlug: slug, sourceTitle: title }),
      href: window.location.pathname,
      thumbnail: sourceThumbnail?.currentSrc || sourceThumbnail?.src,
    };
    const lightboxImages = platformExamples.map((candidate) => ({
      id: candidate.id,
      gallerySourceSlug: slug,
      generationPrompt: candidate.note,
      src: candidate.src,
      resolvedSrc: getReusableStyleGalleryImageUrl(candidate.src, loadedExampleSources.current.has(candidate.src)),
      alt: candidate.alt ?? candidate.model ?? 'Generated example',
      source,
      like: createStyleGalleryLightboxLikeAction(candidate.id, likes, likeLabels),
      copy: createStyleGalleryCopyAction(
        () => activePrompt.current,
        lightboxActionLabels,
        promptCount > 1 ? { promptCount, getPrompts: () => loadStyleGalleryPromptChoices(slug, promptRevision) } : undefined,
      ),
      delete: createStyleGalleryDeleteAction(
        candidate.id,
        candidate.alt ?? candidate.model ?? 'generated example',
        uploadsEnabled && Boolean(token.trim()) && !mutating,
        () => deleteLightboxExample(candidate.id),
        lightboxActionLabels,
      ),
      locate: {
        run: () => locateStyleGalleryElement(getStyleGalleryLightboxElementId('detail-example', candidate.id)),
      },
    }));
    const currentIndex = Math.max(
      0,
      platformExamples.findIndex((candidate) => candidate.id === example.id),
    );
    openModal('imageLightbox', {
      src: example.src,
      alt: example.alt ?? example.model ?? 'Generated example',
      images: lightboxImages,
      currentIndex,
      prefetch: STYLE_GALLERY_EXAMPLE_LIGHTBOX_PREFETCH,
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
    rememberStyleGalleryManagementToken(token);
    return data.examples ?? [];
  }

  async function deleteLightboxExample(id: string): Promise<boolean> {
    if (!uploadsEnabled || !token.trim() || mutating) return false;
    setMutating(true);
    setStatus('Deleting selected example');
    try {
      await apiMutation('DELETE', { ids: [id] });
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setStatus('Example deleted');
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to delete example');
      throw error;
    } finally {
      setMutating(false);
    }
  }

  /** 批量管理在客户端拆成有界请求；已成功的批次立即反映到 UI，失败时只保留尚未处理的选择。 */
  async function mutateSelectedExamples(method: 'PATCH' | 'DELETE', ids: string[], platform?: string) {
    for (const idBatch of chunkStyleGalleryRequestItems(ids, STYLE_GALLERY_MUTATION_BATCH_SIZE)) {
      await apiMutation(method, { ids: idBatch, platform });
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const id of idBatch) next.delete(id);
        return next;
      });
    }
  }

  async function updateSelectedPlatform() {
    if (!selectedIds.size || mutating) return;
    setMutating(true);
    setStatus(
      zh
        ? `正在更改 ${selectedIds.size} 张图片的平台`
        : ja
          ? `${selectedIds.size} 件のプラットフォームを変更中`
          : `Moving ${selectedIds.size} selected examples`,
    );
    try {
      await mutateSelectedExamples('PATCH', [...selectedIds], bulkPlatform);
      setStatus(zh ? '已更改所选图片的平台' : ja ? '選択した画像を更新しました' : 'Selected examples updated');
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
      !window.confirm(
        zh
          ? `永久删除选中的 ${selectedIds.size} 张图片？`
          : ja
            ? `選択した ${selectedIds.size} 件を完全に削除しますか？`
            : `Permanently delete ${selectedIds.size} selected examples?`,
      )
    )
      return;
    setMutating(true);
    setStatus(
      zh
        ? `正在删除 ${selectedIds.size} 张图片`
        : ja
          ? `${selectedIds.size} 件を削除中`
          : `Deleting ${selectedIds.size} selected examples`,
    );
    try {
      await mutateSelectedExamples('DELETE', [...selectedIds]);
      setStatus(zh ? '已删除所选图片' : ja ? '選択した画像を削除しました' : 'Selected examples deleted');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to delete examples');
    } finally {
      setMutating(false);
    }
  }

  async function downloadSelectedExamples() {
    if (!selectedIds.size || downloading || mutating) return;
    const selected = examples.filter((example) => selectedIds.has(example.id));
    setDownloading(true);
    setStatus(`${selectionText.downloading} 0 / ${selected.length}`);
    try {
      const result = await downloadStyleGalleryImages(selected, {
        onProgress: (completed, total) => setStatus(`${selectionText.downloading} ${completed} / ${total}`),
      });
      if (result.failed.length) {
        setStatus(
          zh
            ? `已下载 ${result.downloaded} 张；${result.failed.length} 张失败，可重试`
            : ja
              ? `${result.downloaded} 件ダウンロード、${result.failed.length} 件失敗（再試行可）`
              : `Downloaded ${result.downloaded}; ${result.failed.length} failed and can be retried`,
        );
      } else {
        setStatus(
          zh
            ? `已下载 ${result.downloaded} 张图片`
            : ja
              ? `${result.downloaded} 件ダウンロードしました`
              : `Downloaded ${result.downloaded} selected examples`,
        );
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to download selected examples');
    } finally {
      setDownloading(false);
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
    for (const exampleBatch of chunkStyleGalleryRequestItems(uploadedExamples, STYLE_GALLERY_MUTATION_BATCH_SIZE)) {
      const response = await fetchWithRetry(`/api/style-gallery/examples/${slug}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'cleanup', examples: exampleBatch }),
      });
      if (!response.ok) throw new Error((await response.text()) || `Cleanup failed with ${response.status}`);
    }
  }

  async function prepareUploads(selected: SelectedUpload[]): Promise<{
    prepared: Array<PreparedUpload | null>;
    localDuplicateCount: number;
  }> {
    const prepared: Array<PreparedUpload | null> = Array.from({ length: selected.length }, () => null);
    const firstIndexByHash = new Map<string, number>();
    const uniqueEntries: Array<{ index: number; entry: SelectedUpload }> = [];

    for (const [index, entry] of selected.entries()) {
      if (firstIndexByHash.has(entry.imageHash)) continue;
      firstIndexByHash.set(entry.imageHash, index);
      uniqueEntries.push({ index, entry });
    }

    // prepare 会为每个文件执行 HF HEAD；限制同时在途的批次数，避免大选择集瞬间放大外部请求。
    const batches = chunkStyleGalleryRequestItems(uniqueEntries, STYLE_GALLERY_PREPARE_BATCH_SIZE);
    let nextBatchIndex = 0;
    async function prepareWorker() {
      while (nextBatchIndex < batches.length) {
        const batch = batches[nextBatchIndex];
        nextBatchIndex += 1;
        const response = await fetchWithRetry(`/api/style-gallery/examples/${slug}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            action: 'prepare',
            platform,
            note: note.trim() || undefined,
            files: batch.map(({ entry }) => ({
              name: entry.file.name,
              type: entry.file.type,
              size: entry.file.size,
              imageHash: entry.imageHash,
              dimensions: entry.dimensions,
            })),
          }),
        });
        if (!response.ok) throw new Error((await response.text()) || 'Failed to prepare uploads');
        const uploads = ((await response.json()) as { uploads: PreparedUpload[] }).uploads;
        if (uploads.length !== batch.length) throw new Error('Upload preparation returned an inconsistent result count.');
        for (const [batchIndex, upload] of uploads.entries()) prepared[batch[batchIndex].index] = upload;
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, batches.length) }, prepareWorker));
    return { prepared, localDuplicateCount: selected.length - uniqueEntries.length };
  }

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!files.length || uploading) return;
    setUploading(true);
    setStatus('Hashing selected images');
    const form = event.currentTarget;
    const selected: SelectedUpload[] = files.map((file, index) => ({ id: `${index}-${file.name}`, file, imageHash: '' }));
    setFileProgress(selected.map(({ id, file }) => ({ id, name: file.name, loaded: 0, total: file.size, state: 'hashing' })));

    const uploadedExamples: StyleGalleryExample[] = [];
    try {
      let nextHashIndex = 0;
      async function hashWorker() {
        while (nextHashIndex < selected.length) {
          const entry = selected[nextHashIndex];
          nextHashIndex += 1;
          entry.imageHash = await sha256(entry.file);
          // Capture display orientation once while preparing the upload, never during gallery rendering.
          const bitmap = await createImageBitmap(entry.file);
          try {
            entry.dimensions = { width: bitmap.width, height: bitmap.height };
          } finally {
            bitmap.close();
          }
          updateFileProgress(entry.id, { state: 'ready' });
        }
      }
      await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, selected.length) }, hashWorker));

      setStatus('Checking existing examples');
      const { prepared, localDuplicateCount } = await prepareUploads(selected);

      let nextUploadIndex = 0;
      const uploadFailures: string[] = [];
      const examplesToCommit: StyleGalleryExample[] = [];
      const visualRecordById = new Map<string, StyleGalleryVisualFeature>();
      const featureFailureIndexes = new Set<number>();
      let committedCount = 0;
      let mergeDuplicateCount = 0;
      setStatus('Computing visual search features');
      // 本地特征必须先于图片上传完成。某个文件无法解码时只标记该文件失败，不产生待清理的 HF 孤儿对象。
      for (const [index, upload] of prepared.entries()) {
        if (!upload || upload.duplicate) continue;
        const entry = selected[index];
        try {
          updateFileProgress(entry.id, { state: 'processing', loaded: entry.file.size });
          visualRecordById.set(upload.example.id, await computeExampleVisualFeature(entry.file, entry.imageHash));
          // 特征计算不是网络上传进度；重置为 0，避免总进度先显示 100% 再在上传开始时倒退。
          updateFileProgress(entry.id, { state: 'ready', loaded: 0 });
        } catch (error) {
          prepared[index] = null;
          featureFailureIndexes.add(index);
          updateFileProgress(entry.id, { state: 'failed' });
          uploadFailures.push(
            `${entry.file.name}: ${error instanceof Error ? error.message : 'Visual feature extraction failed'}`,
          );
        }
      }

      // 固定数量 worker 从共享游标领取文件；失败文件只记录自身错误，成功文件仍进入本批元数据提交。
      async function uploadWorker() {
        while (nextUploadIndex < selected.length) {
          const index = nextUploadIndex;
          nextUploadIndex += 1;
          const entry = selected[index];
          const upload = prepared[index];
          if (!upload) {
            // null 同时表示本地重复和特征提取失败；失败项已写入终态，不能再覆盖成带勾的 skipped。
            if (!featureFailureIndexes.has(index)) {
              updateFileProgress(entry.id, { state: 'skipped', loaded: entry.file.size });
            }
            continue;
          }
          if (upload.duplicate) {
            updateFileProgress(entry.id, { state: 'skipped', loaded: entry.file.size });
            continue;
          }
          if (!upload.exists) {
            updateFileProgress(entry.id, { state: 'uploading' });
            const extension = upload.example.src.split('.').pop() ?? 'jpg';
            try {
              await uploadFile(
                `/api/style-gallery/examples/${slug}/upload?platform=${encodeURIComponent(platform)}`,
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
        // 所有成功文件完成服务端组合后再拆批 merge，避免 catalog 引用尚未存在的图片对象。
        setStatus('Saving sub-gallery');
        for (const exampleBatch of chunkStyleGalleryRequestItems(examplesToCommit, STYLE_GALLERY_MUTATION_BATCH_SIZE)) {
          const mergeResponse = await fetchWithRetry(`/api/style-gallery/examples/${slug}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({
              action: 'merge',
              examples: exampleBatch,
              visualRecords: exampleBatch.map((example) => ({
                feature: visualRecordById.get(example.id),
                kind: 'example',
                sourceSlug: slug,
                imageId: example.id,
              })),
            }),
          });
          if (!mergeResponse.ok) throw new Error(await mergeResponse.text());
          const mergeData = (await mergeResponse.json()) as ExamplesResponse;
          committedCount += mergeData.uploaded ?? exampleBatch.length;
          mergeDuplicateCount += mergeData.skippedDuplicates ?? 0;
          setExamples(mergeData.examples ?? []);
          if (mergeData.visualIndexUpdated === false) {
            uploadFailures.push('Visual search index update failed; the saved images require an index rebuild');
          }
          const committedIds = new Set(exampleBatch.map((example) => example.id));
          for (let index = uploadedExamples.length - 1; index >= 0; index -= 1) {
            if (committedIds.has(uploadedExamples[index].id)) uploadedExamples.splice(index, 1);
          }
        }
      }

      setFileProgress((current) =>
        current.map((item) => (item.state === 'saving' ? { ...item, state: 'done' as const } : item)),
      );

      try {
        rememberStyleGalleryManagementToken(token);
      } catch {
        // 浏览器存储不可用不应把已经完成的上传误报为失败。
      }
      const skipped = localDuplicateCount + prepared.filter((upload) => upload?.duplicate).length + mergeDuplicateCount;
      const statusParts = [
        `Added ${committedCount} example${committedCount === 1 ? '' : 's'}`,
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

  const selectionActions = (
    <>
      <button
        type="button"
        disabled={mutating || downloading}
        onClick={() => setSelectedIds(new Set(examples.map((example) => example.id)))}
        className="h-9 rounded-lg border border-border px-3 text-sm"
      >
        {selectionText.all}
      </button>
      <button
        type="button"
        disabled={mutating || downloading || !selectedIds.size}
        onClick={() => setSelectedIds(new Set())}
        className="h-9 rounded-lg border border-border px-3 text-sm"
      >
        {selectionText.clear}
      </button>
      <span className="mr-auto font-bold text-sm tabular-nums">
        {zh ? `已选择 ${selectedIds.size} 项` : ja ? `${selectedIds.size} 件選択中` : `${selectedIds.size} selected`}
      </span>
      {uploadsEnabled && (
        <>
          <select
            value={bulkPlatform}
            disabled={!selectedIds.size || mutating}
            onChange={(event) => setBulkPlatform(event.currentTarget.value)}
            aria-label={selectionText.platform}
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
            disabled={!selectedIds.size || mutating || downloading}
            onClick={updateSelectedPlatform}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-950 px-3 font-bold text-sm text-white disabled:opacity-50 dark:bg-white dark:text-gray-950"
          >
            <Icon icon="ri:swap-2-line" className="size-4" />
            {selectionText.change}
          </button>
        </>
      )}
      <button
        type="button"
        disabled={!selectedIds.size || mutating || downloading}
        onClick={() => void downloadSelectedExamples()}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-sky-200 px-3 font-bold text-sky-600 text-sm disabled:opacity-50 dark:border-sky-900 dark:text-sky-300"
      >
        <Icon
          icon={downloading ? 'ri:loader-4-line' : 'ri:download-2-line'}
          className={`size-4 ${downloading ? 'animate-spin' : ''}`}
        />
        {downloading ? selectionText.downloading : selectionText.download}
      </button>
      {uploadsEnabled && (
        <button
          type="button"
          disabled={!selectedIds.size || mutating || downloading}
          onClick={deleteSelectedExamples}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 font-bold text-red-500 text-sm disabled:opacity-50 dark:border-red-950"
        >
          <Icon icon="ri:delete-bin-line" className="size-4" />
          {selectionText.remove}
        </button>
      )}
    </>
  );
  return (
    <section
      ref={marquee.rootRef}
      className="rounded-lg border border-rose-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950"
    >
      {marquee.overlay}
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
          <textarea
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
            rows={3}
            className="max-h-64 min-h-24 w-full resize-y overflow-y-auto rounded-lg border border-sky-100 bg-white px-3 py-2 text-gray-900 text-sm outline-none dark:border-gray-800 dark:bg-gray-900 dark:text-white"
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
          <div
            data-gallery-management
            className="sticky top-3 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-white/95 p-3 shadow-md backdrop-blur dark:border-rose-900 dark:bg-gray-950/95"
          >
            <button
              type="button"
              onClick={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
              disabled={mutating || downloading}
              className="h-9 rounded-lg border border-border px-3 text-sm"
            >
              {selectionMode ? selectionText.exit : selectionText.start}
            </button>
            {selectionMode && selectionActions}
          </div>
          {selectionMode && (
            <GallerySelectionDock count={selectedIds.size} locale={locale}>
              {selectionActions}
              <p className="text-muted-foreground text-xs">{selectionText.hint}</p>
              <button
                type="button"
                disabled={mutating || downloading}
                onClick={exitSelection}
                className="h-9 rounded-lg border border-border px-3 text-sm"
              >
                {selectionText.exit}
              </button>
            </GallerySelectionDock>
          )}
          {exampleGroups.map(([platformName, platformExamples]) => (
            <section className="space-y-3" key={platformName}>
              <div className="flex items-center justify-between gap-3 border-rose-100 border-b pb-2 dark:border-gray-800">
                <h3 className="font-black text-gray-900 text-lg dark:text-white">{platformName}</h3>
                <div className="flex items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-muted-foreground text-xs">
                    <input
                      type="checkbox"
                      checked={platformExamples.every((example) => selectedIds.has(example.id))}
                      onChange={() => {
                        setSelectionMode(true);
                        toggleGroup(platformExamples);
                      }}
                      className="size-4 accent-rose-500"
                    />
                    {selectionText.group}
                  </label>
                  <span className="rounded-full bg-sky-50 px-3 py-1 font-bold text-sky-600 text-xs dark:bg-sky-950/50 dark:text-sky-200">
                    {platformExamples.length}
                  </span>
                </div>
              </div>
              <div
                data-gallery-marquee-area
                className="grid grid-cols-4 gap-3 md:grid-cols-2 [@media(min-width:769px)_and_(max-width:1279px)]:grid-cols-3"
              >
                {platformExamples.map((example) => {
                  return (
                    <figure
                      key={example.src}
                      data-gallery-selection-id={example.id}
                      data-selected={selectedIds.has(example.id)}
                      id={getStyleGalleryLightboxElementId('detail-example', example.id)}
                      tabIndex={-1}
                      className="w-full min-w-0 overflow-hidden rounded-lg border border-gray-100 bg-gray-50 [contain-intrinsic-size:auto_420px] [content-visibility:auto] dark:border-gray-800 dark:bg-gray-900"
                    >
                      {/* 全局 reset 让 figure 使用 fit-content，因此 figure 与内层都必须显式占满 grid track；否则未加载的 1x1 img 会让整张卡片收缩。 */}
                      <div className="relative aspect-square w-full overflow-hidden bg-gray-100 dark:bg-gray-900">
                        <button
                          type="button"
                          onClick={() => openExampleLightbox(example, platformExamples)}
                          className="group absolute inset-0 block h-full w-full cursor-zoom-in overflow-hidden text-left"
                          aria-label={`Open ${example.alt ?? example.model ?? 'generated example'} preview`}
                        >
                          <StyleGallerySharedImage
                            source={example.src}
                            loadedSources={loadedExampleSources.current}
                            alt={example.alt ?? example.model ?? 'Generated example'}
                            width={1}
                            height={1}
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover transition duration-200 group-hover:scale-105"
                          />
                        </button>
                        <label className="absolute top-2 left-2 flex size-8 cursor-pointer items-center justify-center rounded-md bg-white/90 shadow dark:bg-gray-950/90">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(example.id)}
                            disabled={mutating}
                            onChange={() => {
                              setSelectionMode(true);
                              toggleExample(example.id);
                            }}
                            aria-label={`Select ${example.alt ?? 'generated example'}`}
                            className="size-4 accent-rose-500"
                          />
                        </label>
                        <StyleGalleryLikeButton
                          exampleId={example.id}
                          controller={likes}
                          labels={likeLabels}
                          className="absolute right-2 bottom-1.5 z-10"
                        />
                      </div>
                      {example.note && (
                        <figcaption className="my-3 line-clamp-3 whitespace-pre-wrap break-words px-3 text-gray-500 text-xs dark:text-gray-300">
                          {example.note}
                        </figcaption>
                      )}
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
