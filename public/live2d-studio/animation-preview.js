/** One shared clock with no queued frames: slow devices skip preview frames instead of
 * building up work. Sample times stay on the encoder's frame grid; encoding is unchanged. */
export async function runAnimationPreview({ duration, fps, renderFrameAt, onTime = () => {}, signal }) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fps) || fps <= 0) {
    throw new Error('预览时长与帧率必须大于零。');
  }
  const interval = 1000 / Math.min(15, fps), finalFrame = Math.ceil(duration * fps) - 1;
  const started = performance.now();
  let previousFrame = -1, frames = 0;
  const check = () => { if (signal?.aborted) throw new DOMException('已停止预览。', 'AbortError'); };
  const wait = milliseconds => new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new DOMException('已停止预览。', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
  while (true) {
    check();
    const frameStart = performance.now(), elapsed = (frameStart - started) / 1000;
    const frame = Math.min(finalFrame, Math.floor(elapsed * fps));
    if (frame !== previousFrame) {
      await renderFrameAt(frame / fps); check();
      frames++; previousFrame = frame; onTime(frame / fps);
    }
    if (elapsed >= duration) return { frames };
    await wait(Math.max(1, interval - (performance.now() - frameStart)));
  }
}
