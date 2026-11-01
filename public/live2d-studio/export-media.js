// Failed dynamic imports can remain rejected after a sleeping preview server restarts.
// Cache successes, retry one fresh URL, and never create an unbounded retry loop.
const encoderModules = new Map();
async function loadEncoder(file) {
  if (encoderModules.has(file)) return encoderModules.get(file);
  const url = new URL('./vendor/export/' + file, import.meta.url);
  try {
    let module;
    try { module = await import(url.href); }
    catch { url.searchParams.set('retry', Date.now()); module = await import(url.href); }
    encoderModules.set(file, module); return module;
  } catch (cause) {
    throw new Error('导出组件暂时无法读取，请稍后重试；当前作品不会丢失。', {cause});
  }
}

/** Browser-only encoders with bounded frame budgets. No realtime recorder/clock. */
export const EXPORT_LIMITS = Object.freeze({
  still: { maxSide: 8192, maxPixels: 16_777_216 },
  gif: { maxSide: 1280, maxPixels: 1_048_576, maxDuration: 8, maxFps: 25, maxTotalPixels: 96_000_000 },
  mp4: { maxSide: 2048, maxPixels: 2_097_152, maxDuration: 12, maxFps: 30, maxTotalPixels: 180_000_000 },
  maxEncodedBytes: 96 * 1024 * 1024,
});

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
function checkAbort(signal) { if (signal?.aborted) throw new DOMException('已取消导出。', 'AbortError'); }
function dimensions(width, height, limits) {
  const w = Number(width), h = Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) throw new Error('导出宽高必须是正整数。');
  if (Math.max(w, h) > limits.maxSide || w * h > limits.maxPixels) {
    throw new Error(`此格式最多 ${limits.maxSide} px 长边、${(limits.maxPixels / 1_000_000).toFixed(1)} 百万像素，请降低导出尺寸。`);
  }
  return [w, h];
}
function surface(width, height) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法创建导出画布。');
  return { canvas, context };
}
function paintFrame(context, frame, width, height, background) {
  if (!frame || !(frame.width > 0) || !(frame.height > 0)) throw new Error('渲染器没有返回有效画面。');
  if (frame.width !== width || frame.height !== height) throw new Error(`渲染器返回 ${frame.width} × ${frame.height}，目标为 ${width} × ${height}；请按目标尺寸重绘后导出。`);
  // A renderer must rerender the same normalized composition at this size. The
  // copy captures that frame before the caller can reuse its GPU/2D surfaces.
  context.clearRect(0, 0, width, height);
  if (background) { context.fillStyle = background; context.fillRect(0, 0, width, height); }
  context.drawImage(frame, 0, 0, width, height);
}
function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (!blob || blob.type !== type) reject(new Error(`当前浏览器不能编码 ${type}，请选择 PNG。`));
    else resolve(blob);
  }, type, quality));
}

/** A fixed RGB565 lookup prevents the same source color choosing a new palette entry
 * when another pixel becomes the first occurrence of its color bucket in a later frame. */
function gifLookup(palette) {
  const lookup = new Uint8Array(65536);
  for (let bucket = 0; bucket < lookup.length; bucket++) {
    const r = ((bucket >> 11) & 31) * 255 / 31;
    const g = ((bucket >> 5) & 63) * 255 / 63, b = (bucket & 31) * 255 / 31;
    let best = Infinity;
    for (let i = 1; i < palette.length; i++) {
      const color = palette[i], distance = (r - color[0]) ** 2 + (g - color[1]) ** 2 + (b - color[2]) ** 2;
      if (distance < best) { best = distance; lookup[bucket] = i; }
    }
  }
  return lookup;
}
function gifIndices(rgba, lookup) {
  const indexed = new Uint8Array(rgba.length / 4);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    indexed[p] = rgba[i + 3] < 128 ? 0 : lookup[((rgba[i] >> 3) << 11) | ((rgba[i + 1] >> 2) << 5) | (rgba[i + 2] >> 3)];
  }
  return indexed;
}
async function videoConfig(width, height, fps) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.420028']) {
    const config = { codec, width, height, framerate: fps,
      bitrate: Math.min(30_000_000, Math.max(2_000_000, Math.round(width * height * fps * 0.24))),
      latencyMode: 'quality', avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return config; } catch { /* Try the next H.264 profile. */ }
  }
  return null;
}

/** Capabilities reflect the current browser, not merely a menu of file suffixes. */
export async function getExportCapabilities() {
  const { canvas } = surface(2, 2);
  try {
    const still = { png: true, jpeg: false, webp: false };
    for (const name of ['jpeg', 'webp']) still[name] = canvas.toDataURL(`image/${name}`).startsWith(`data:image/${name}`);
    return { ...still, jpg: still.jpeg, gif: true, mp4: Boolean(await videoConfig(640, 480, 24)),
      mp4Reason: typeof VideoEncoder === 'undefined' ? '此浏览器没有 WebCodecs 视频编码器。' : 'MP4 需要浏览器支持 H.264 编码；不支持时可导出 GIF。',
      limits: EXPORT_LIMITS };
  } finally { canvas.width = canvas.height = 1; }
}

/**
 * Same normalized composition, different output pixels. No DOM/UI chrome is
 * captured: "preview" means the actual visible frame dimensions, not a screenshot.
 */
export function getExportDimensions({ mode = 'canvas', ratio, longEdge = 3840, previewWidth, previewHeight, format = 'png' }) {
  let width, height;
  if (mode === 'preview') { width = Math.round(previewWidth); height = Math.round(previewHeight); }
  else {
    if (!(ratio > 0) || !Number.isFinite(ratio)) throw new Error('画布比例无效。');
    width = ratio >= 1 ? Math.round(longEdge) : Math.round(longEdge * ratio);
    height = ratio >= 1 ? Math.round(longEdge / ratio) : Math.round(longEdge);
  }
  const limits = EXPORT_LIMITS[format] ?? EXPORT_LIMITS.still;
  if (format === 'mp4') { width = Math.max(2, Math.round(width / 2) * 2); height = Math.max(2, Math.round(height / 2) * 2); }
  dimensions(width, height, limits);
  return { width, height, mode };
}

/** PNG/WebP preserve alpha; JPEG explicitly flattens onto background (default white). */
export async function exportStill({ format = 'png', width = 3072, height = 3840, renderFrameAt,
  time = 0, quality = 1, background = '#ffffff', signal }) {
  const type = format === 'jpg' ? 'jpeg' : format;
  if (!['png', 'jpeg', 'webp'].includes(type)) throw new Error('请选择 PNG、JPG 或 WebP。');
  dimensions(width, height, EXPORT_LIMITS.still); checkAbort(signal);
  const { canvas, context } = surface(width, height);
  try {
    const frame = await renderFrameAt(time, width, height); checkAbort(signal);
    paintFrame(context, frame, width, height, type === 'jpeg' ? background : null);
    const blob = await canvasBlob(canvas, `image/${type}`, Math.min(1, Math.max(0, quality)));
    checkAbort(signal); return blob;
  } finally { canvas.width = canvas.height = 1; }
}

/**
 * Pull deterministic frames sequentially. renderFrameAt(t,w,h) returns a canvas
 * or ImageBitmap; it owns that object and this module never closes it. Export
 * covers [0,duration), with the last timestamp strictly before the loop boundary.
 * No animation is accumulated as raw RGBA frames; encoded output stays in memory.
 */
export async function exportAnimation({ format = 'gif', width = 768, height = 960, duration = 3, fps = 24,
  renderFrameAt, onProgress = () => {}, signal, background = '#ffffff' }) {
  const limits = EXPORT_LIMITS[format];
  if (!limits || !['gif', 'mp4'].includes(format)) throw new Error('请选择 GIF 或 MP4。');
  dimensions(width, height, limits);
  if (!(duration > 0) || !Number.isFinite(duration) || duration > limits.maxDuration) throw new Error(`此格式时长须在 0–${limits.maxDuration} 秒之间。`);
  if (!(fps >= 1) || !Number.isFinite(fps) || fps > limits.maxFps) throw new Error(`此格式帧率须在 1–${limits.maxFps} fps 之间。`);
  const total = Math.ceil(duration * fps);
  if (width * height * total > limits.maxTotalPixels) throw new Error('这组尺寸、时长和帧率超过本地导出的计算预算，请降低其中一项。');
  checkAbort(signal);
  const { canvas, context } = surface(width, height);
  const progress = (completed, time) => onProgress({ completed, total, progress: completed / total, time, format });
  let encoder = null;
  try {
    if (format === 'gif') {
      const { GIFEncoder, quantize } = await loadEncoder('gifenc-1.0.3.js');
      const gif = GIFEncoder();
      // Build one palette from a bounded, evenly spaced look-ahead. Keeping per-frame
      // palettes made static faces, lettering and backgrounds shimmer as actors moved.
      // Only small color samples survive this pass, never a sequence of full RGBA frames.
      const sampleCount = Math.min(8, total), samplePixels = 16384;
      const samples = new Uint8Array(sampleCount * samplePixels * 4);
      let used = 0;
      for (let sample = 0; sample < sampleCount; sample++) {
        checkAbort(signal);
        const index = sampleCount === 1 ? 0 : Math.round(sample * (total - 1) / (sampleCount - 1));
        const frame = await renderFrameAt(index / fps, width, height); checkAbort(signal);
        paintFrame(context, frame, width, height, null);
        const rgba = context.getImageData(0, 0, width, height).data;
        const stride = Math.max(1, Math.ceil(width * height / samplePixels));
        for (let p = 0; p < width * height; p += stride) {
          const i = p * 4; if (rgba[i + 3] < 128) continue;
          samples[used++] = rgba[i]; samples[used++] = rgba[i + 1]; samples[used++] = rgba[i + 2]; samples[used++] = 255;
        }
        onProgress({ phase: 'palette', completed: sample + 1, total: sampleCount,
          progress: .15 * (sample + 1) / sampleCount, time: index / fps, format });
        await pause();
      }
      checkAbort(signal);
      // A 12-bit training histogram bounds clustering cost; the final mapping retains
      // 16-bit color lookup precision and is identical for every frame.
      const palette = [[0, 0, 0], ...(used ? quantize(samples.slice(0, used), 255, { format: 'rgb444' }) : [[0, 0, 0]])];
      const lookup = gifLookup(palette); checkAbort(signal);
      // GIF has centisecond timing. Distribute rounding across frames instead of
      // truncating every 24-fps frame to 40ms and shortening the entire sequence.
      for (let index = 0; index < total; index++) {
        checkAbort(signal);
        const time = index / fps, frame = await renderFrameAt(time, width, height); checkAbort(signal);
        paintFrame(context, frame, width, height, null);
        const rgba = context.getImageData(0, 0, width, height).data;
        const indexed = gifIndices(rgba, lookup);
        const startCs = Math.round(time * 100), endCs = Math.round(Math.min(duration, (index + 1) / fps) * 100);
        gif.writeFrame(indexed, width, height, { palette: index === 0 ? palette : undefined, delay: Math.max(10, (endCs - startCs) * 10),
          transparent: true, transparentIndex: 0, dispose: 2, repeat: 0 });
        if (gif.bytesView().byteLength > EXPORT_LIMITS.maxEncodedBytes) throw new Error('编码结果超过 96 MiB，已停止以避免继续占用内存。');
        onProgress({ phase: 'encode', completed: index + 1, total, progress: .15 + .85 * (index + 1) / total, time, format }); await pause();
      }
      gif.finish(); checkAbort(signal);
      return new Blob([gif.bytesView()], { type: 'image/gif' });
    }

    if (width % 2 || height % 2) throw new Error('MP4 的宽和高需要是偶数，请使用推荐尺寸。');
    const config = await videoConfig(width, height, fps);
    if (!config) throw new Error('当前浏览器无法以此尺寸编码 H.264 MP4，请降低尺寸或使用 GIF。');
    const { Muxer, ArrayBufferTarget } = await loadEncoder('mp4-muxer-5.2.2.js');
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: 'avc', width, height, frameRate: fps }, fastStart: 'in-memory' });
    let encodingError = null, encodedBytes = 0;
    encoder = new VideoEncoder({ output(chunk, metadata) {
      try {
        encodedBytes += chunk.byteLength;
        if (encodedBytes > EXPORT_LIMITS.maxEncodedBytes) throw new Error('编码结果超过 96 MiB，请缩短时长。');
        muxer.addVideoChunk(chunk, metadata);
      } catch (error) { encodingError = error; }
    }, error(error) { encodingError = error; } });
    encoder.configure(config);
    for (let index = 0; index < total; index++) {
      checkAbort(signal); if (encodingError) throw encodingError;
      // Bounded encoder backlog; only a few frames may be queued at any time.
      while (encoder.encodeQueueSize > 3) { await pause(); checkAbort(signal); if (encodingError) throw encodingError; }
      const time = index / fps, frame = await renderFrameAt(time, width, height); checkAbort(signal);
      paintFrame(context, frame, width, height, background);
      const videoFrame = new VideoFrame(canvas, { timestamp: Math.round(time * 1_000_000),
        duration: Math.round((Math.min(duration, (index + 1) / fps) - time) * 1_000_000) });
      try { encoder.encode(videoFrame, { keyFrame: index % Math.max(1, Math.round(fps * 2)) === 0 }); }
      finally { videoFrame.close(); }
      progress(index + 1, time); await pause();
    }
    await encoder.flush(); if (encodingError) throw encodingError;
    checkAbort(signal); muxer.finalize();
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    if (encoder && encoder.state !== 'closed') encoder.close();
    canvas.width = canvas.height = 1;
  }
}
