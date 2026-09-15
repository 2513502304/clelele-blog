import {
  getStyleGalleryUploadPartCount,
  STYLE_GALLERY_DIRECT_UPLOAD_MAX_SIZE,
  STYLE_GALLERY_UPLOAD_CHUNK_SIZE,
} from './style-gallery-chunk-upload';
import { getStyleGalleryExampleContentType } from './style-gallery-image-type';

interface UploadedPart {
  index: number;
  size: number;
  hash: string;
}
const MAX_UPLOAD_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const RAW_UPLOAD_TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldRetryUpload(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
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

export async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function uploadWithProgress(
  url: string,
  body: Blob,
  token: string,
  onProgress: (loaded: number, total: number) => void,
  contentType = 'application/octet-stream',
  onUploaded?: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.timeout = RAW_UPLOAD_TIMEOUT_MS;
    request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.setRequestHeader('Content-Type', contentType);
    request.upload.onprogress = (event) => onProgress(event.loaded, event.lengthComputable ? event.total : body.size);
    if (onUploaded) request.upload.onload = onUploaded;
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

/** 每个分块独立计算超时和重试次数，某个文件失败不会消耗其他并发文件的重试预算。 */
async function uploadWithProgressAndRetry(
  url: string,
  body: Blob,
  token: string,
  onProgress: (loaded: number, total: number) => void,
  contentType = 'application/octet-stream',
  onUploaded?: () => void,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      await uploadWithProgress(url, body, token, onProgress, contentType, onUploaded);
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

async function uploadFileDirectly(
  endpoint: string,
  file: File,
  imageHash: string,
  extension: string,
  token: string,
  onProgress: (loaded: number, total: number) => void,
  onProcessing: () => void,
): Promise<void> {
  const contentType = getStyleGalleryExampleContentType(extension);
  const query = new URLSearchParams({
    action: 'direct',
    imageHash,
  });
  await uploadWithProgressAndRetry(`${endpoint}&${query}`, file, token, onProgress, contentType, onProcessing);
}

async function uploadFileInChunks(
  endpoint: string,
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
          contentType: getStyleGalleryExampleContentType(extension),
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

/** 小文件跳过 HF 临时对象；大文件仍按有界请求分块并由 complete 阶段复核完整内容。 */
export async function uploadFile(
  endpoint: string,
  file: File,
  imageHash: string,
  extension: string,
  token: string,
  onProgress: (loaded: number, total: number) => void,
  onProcessing: () => void,
): Promise<void> {
  if (file.size <= STYLE_GALLERY_DIRECT_UPLOAD_MAX_SIZE) {
    return uploadFileDirectly(endpoint, file, imageHash, extension, token, onProgress, onProcessing);
  }
  return uploadFileInChunks(endpoint, file, imageHash, extension, token, onProgress, onProcessing);
}
