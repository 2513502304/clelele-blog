import { createEngine, MODELS } from './engine.js';

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Up to three real model sessions. Only the selected actor animates; every source frame is
 * copied synchronously to its own 2D snapshot before WebGL discards its drawing buffer.
 * `canvas` belongs to this transparent 2D composite, never to a WebGL session.
 */
export async function createSceneEngine({ canvas, onFrame = () => {}, onState = () => {}, onStats = () => {} }) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('多人画布需要新的 2D canvas，请保存作品后刷新创作台。');
  let actors = [];
  let activeId = null;
  let nextId = 1;
  let paused = false;
  let disposed = false;
  let size = { cssWidth: 600, cssHeight: 750, dpr: 1 };
  let pixels = { width: 600, height: 750 };
  let tail = Promise.resolve();
  let suppress = 0;
  let exportReservations = 0;
  let lastStats = -Infinity, lastStatsState = '';
  let loadRequest = 0;
  const active = () => actors.find((actor) => actor.id === activeId);
  const enqueue = (work) => {
    const next = tail.then(() => { if (disposed) throw new Error('Scene engine disposed.'); return work(); });
    tail = next.catch(() => {});
    return next;
  };
  const withActive = (method, ...args) => {
    const actor = active();
    if (!actor) return Promise.resolve();
    return enqueue(() => actor.engine?.[method](...args));
  };
  const getStats = () => {
    const actor = active();
    const stats = actor?.engine?.getStats() ?? {
      fps: 0, frames: 0, width: pixels.width, height: pixels.height, modelId: '', loading: false,
    };
    const effectivePaused = paused || !actor?.visible || !!stats.paused;
    return { ...stats, paused: effectivePaused, globalPaused: paused,
      fps: effectivePaused || document.hidden ? 0 : stats.fps,
      actorCount: actors.length, activeActorId: activeId };
  };
  const reportStats = (force = false) => {
    const now = performance.now();
    const status = getStats(), signature = [status.width,status.height,status.paused,status.hidden,status.activeActorId,status.loading].join('/');
    if (!force && now - lastStats < 1000 && signature === lastStatsState) return;
    lastStatsState=signature;lastStats = now; onStats(status);
  };
  const ensureCompositeSize = () => {
    if (canvas.width !== pixels.width) canvas.width = pixels.width;
    if (canvas.height !== pixels.height) canvas.height = pixels.height;
  };
  function compose() {
    if (disposed || suppress) return;
    ensureCompositeSize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Array order is the layer stack: index zero is behind every later actor.
    for (const actor of actors) {
      if (actor.visible && actor.hasFrame) ctx.drawImage(actor.snapshot, 0, 0, canvas.width, canvas.height);
    }
    onFrame(canvas);
  }
  const stopActors = () => actors.map((actor) => actor.engine?.setPaused(true)).filter(Boolean);
  async function applyPlayback() {
    // Pause all first, then resume at most one, so selection never has two live clocks.
    await Promise.all(stopActors());
    const selected = active();
    if (!paused && selected?.engine && selected.visible && !selected.loading && !disposed) await selected.engine.setPaused(false);
    // Pausing stops frame callbacks, so publish the final state without waiting for another frame.
    reportStats(true);
  }
  function capture(actor, source) {
    if (disposed) return;
    if (actor.snapshot.width !== source.width) actor.snapshot.width = source.width;
    if (actor.snapshot.height !== source.height) actor.snapshot.height = source.height;
    actor.snapshotCtx.clearRect(0, 0, source.width, source.height);
    actor.snapshotCtx.drawImage(source, 0, 0);
    actor.hasFrame = true; actor.revision = (actor.revision || 0) + 1;
    if (!actor.loading) compose();
  }
  async function makeActor() {
    const source = document.createElement('canvas');
    const snapshot = document.createElement('canvas');
    const actor = { id: `actor-${nextId++}`, modelId: '', name: '人物', source, snapshot,
      snapshotCtx: snapshot.getContext('2d'), engine: null, hasFrame: false, loading: false, visible: true,
      camera: { zoom: 1, x: 0, y: 0, rotation: 0 }, request: 0, pendingModelId: '', progress: { loaded: 0, total: 0 } };
    if (!actor.snapshotCtx) throw new Error('无法创建人物快照画布。');
    actors.push(actor); activeId = actor.id;
    try {
      actor.engine = await createEngine({ canvas: source,
        onFrame: (frame) => capture(actor, frame),
        onState: (state) => {
          if (disposed) return;
          // A background context failure is global; loading progress belongs only to the selection.
          if (state.status === 'error' && !actor.loading) onState({ ...state, actorId: actor.id });
          else if (actor.id === activeId && state.modelId === actor.pendingModelId) {
            if (state.status === 'loading') actor.progress = { loaded: state.loaded, total: state.total };
            // Publish ready only once metadata, snapshots and the active clock are all current.
            if (state.status !== 'ready') onState({ ...state, actorId: actor.id });
          }
        },
        onStats: () => { if (actor.id === activeId && !suppress) reportStats(); },
      });
      await actor.engine.setPaused(true);
      await actor.engine.setSize(size.cssWidth, size.cssHeight, size.dpr);
      return actor;
    } catch (error) {
      actors = actors.filter((item) => item !== actor);
      if (activeId === actor.id) activeId = actors.at(-1)?.id ?? null;
      await actor.engine?.dispose();
      throw error;
    }
  }
  function beginLoad(actor, modelId, request) {
    actor.loading = true; actor.pendingModelId = modelId; actor.request = request;
    actor.engine.setPaused(true);
    // Calling the underlying load now aborts its previous fetch immediately. The engine's own
    // queue protects its GL context; this scene's queue protects composites and multi-actor export.
    const promise = actor.engine.load(modelId);
    promise.catch(() => {});
    return promise;
  }
  async function completeLoad(actor, modelId, request, promise) {
    try {
      await promise;
      if (actor.request !== request || disposed) return;
      actor.modelId = modelId;
      actor.name = MODELS.find((model) => model.id === modelId)?.name ?? modelId;
      actor.loading = false;
      pixels = { width: actor.source.width, height: actor.source.height };
      await applyPlayback(); compose();
      if (actor.id === activeId) onState({ status: 'ready', modelId, ...actor.progress, message: '', actorId: actor.id });
    } catch (error) {
      if (actor.request !== request || disposed) return;
      actor.loading = false;
      await applyPlayback(); compose();
      throw error;
    }
  }
  const api = {
    cancelLoad() { active()?.engine?.cancelLoad(); },
    load(modelId) {
      // Reject stale catalog choices before marking the current actor as loading.
      if (!MODELS.some(model => model.id === modelId)) return Promise.reject(new Error(`找不到模型：${modelId}`));
      const request = ++loadRequest;
      const actor = active();
      const eager = actor?.engine && !exportReservations ? beginLoad(actor, modelId, request) : null;
      return enqueue(async () => {
        if (!actor && request !== loadRequest) return api;
        const target = actor ?? await makeActor();
        if (eager) await completeLoad(target, modelId, request, eager);
        else {
          // Pending replacements collapse to the newest request before any model transfer starts.
          if (request !== loadRequest) return api;
          await completeLoad(target, modelId, request, beginLoad(target, modelId, request));
        }
        return api;
      });
    },
    addActor(modelId) {
      return enqueue(async () => {
        if (actors.length >= 3) throw new Error('画布最多同时放置 3 位人物。');
        await Promise.all(stopActors());
        const actor = await makeActor();
        try {
          const request = ++loadRequest;
          await completeLoad(actor, modelId, request, beginLoad(actor, modelId, request));
          return actor.id;
        } catch (error) {
          actors = actors.filter((item) => item !== actor);
          activeId = actors.at(-1)?.id ?? null;
          await actor.engine.dispose(); await applyPlayback(); compose();
          throw error;
        }
      });
    },
    removeActor(id) {
      return enqueue(async () => {
        const index = actors.findIndex((actor) => actor.id === id);
        if (index < 0) return;
        const [actor] = actors.splice(index, 1);
        if (activeId === id) activeId = actors[Math.min(index, actors.length - 1)]?.id ?? null;
        await actor.engine.dispose(); await applyPlayback(); compose();
      });
    },
    selectActor(id) {
      if (!actors.some((actor) => actor.id === id)) return Promise.reject(new Error('找不到这位人物。'));
      activeId = id;
      stopActors();
      return enqueue(async () => { await applyPlayback(); compose(); });
    },
    moveActor(id, delta) {
      return enqueue(() => {
        const index = actors.findIndex((actor) => actor.id === id);
        if (index < 0 || !Number.isFinite(Number(delta))) return;
        const target = clamp(index + Math.sign(Number(delta)), 0, actors.length - 1);
        if (index === target) return;
        [actors[index], actors[target]] = [actors[target], actors[index]]; compose();
      });
    },
    /** Visibility keeps the decoded session and cached frame; selecting never changes it. */
    setActorVisible(id, value) {
      return enqueue(async () => {
        const actor = actors.find((item) => item.id === id);
        if (!actor) return;
        actor.visible = !!value;
        await applyPlayback(); compose();
      });
    },
    getActors: () => actors.map((actor) => ({ id: actor.id, modelId: actor.modelId || actor.pendingModelId,
      name: actor.name, selected: actor.id === activeId, visible: actor.visible,
      paused: paused || !actor.visible || actor.id !== activeId || actor.loading || !actor.engine || actor.engine.getStats().paused,
      camera: { ...actor.camera } })),
    setSize(cssWidth, cssHeight, dpr = 1) {
      const next = { cssWidth: Math.max(1, finite(cssWidth, size.cssWidth)),
        cssHeight: Math.max(1, finite(cssHeight, size.cssHeight)), dpr: Math.max(0.1, finite(dpr, size.dpr)) };
      return enqueue(async () => {
        size = next; suppress++;
        try {
          await Promise.all(actors.map((actor) => actor.engine.setSize(size.cssWidth, size.cssHeight, size.dpr)));
          const source = active()?.source;
          pixels = { width: source?.width ?? Math.round(size.cssWidth * size.dpr),
            height: source?.height ?? Math.round(size.cssHeight * size.dpr) };
        } finally { suppress--; compose(); reportStats(true); }
      });
    },
    setCamera(update) {
      const actor = active();
      if (!actor) return Promise.resolve();
      actor.camera = { zoom: clamp(finite(update.zoom, actor.camera.zoom), 0.25, 6),
        x: finite(update.x, actor.camera.x), y: finite(update.y, actor.camera.y),
        rotation: clamp(finite(update.rotation, actor.camera.rotation ?? 0), -180, 180) };
      const next = { ...actor.camera };
      return enqueue(() => actor.engine.setCamera(next));
    },
    getCamera: () => ({ ...(active()?.camera ?? { zoom: 1, x: 0, y: 0, rotation: 0 }) }),
    setPaused(value) {
      paused = !!value; stopActors();
      return enqueue(applyPlayback);
    },
    getMotions: () => active()?.engine?.getMotions() ?? [],
    getExpressions: () => active()?.engine?.getExpressions() ?? [],
    getSelection: () => active()?.engine?.getSelection() ?? { motion: '', expression: '' },
    getDefaults: () => active()?.engine?.getDefaults() ?? { motion: '', expression: '' },
    getPlayback: () => ({ ...(active()?.engine?.getPlayback() ?? { time: 0, duration: 0, loop: false, playing: false, paused: true }),
      playing: !paused && !!active()?.visible && !!active()?.engine?.getPlayback().playing }),
    getParameters: () => active()?.engine?.getParameters() ?? [],
    setParameter(...args) { paused = true; stopActors(); return withActive('setParameter', ...args); },
    setParameters(...args) { paused = true; stopActors(); return withActive('setParameters', ...args); },
    resetParameter(...args) { paused = true; stopActors(); return withActive('resetParameter', ...args); },
    resetParameters: () => withActive('resetParameters'),
    playMotion: (...args) => runSelection('playMotion', ...args),
    setExpression: (...args) => runSelection('setExpression', ...args),
    resetMotion: () => runSelection('resetMotion'),
    resetExpression: () => runSelection('resetExpression'),
    setLoop: (...args) => withActive('setLoop', ...args),
    setSpeed: (...args) => withActive('setSpeed', ...args),
    getKeyframes: () => active()?.engine?.getKeyframes() ?? [],
    setDuration(...args) { paused=true;stopActors();return withActive('setDuration',...args); },
    editKeyframePoints(...args) { paused=true;stopActors();return withActive('editKeyframePoints',...args); },
    getMotionReference: () => active()?.engine?.getMotionReference() ?? { id:'', duration:1, tracks:[] },
    seedMotionTrack(...args) { paused=true; stopActors(); return withActive('seedMotionTrack',...args); },
    setKeyframe(...args) { paused = true; stopActors(); return withActive('setKeyframe', ...args); },
    updateKeyframe(...args) { paused = true; stopActors(); return withActive('updateKeyframe', ...args); },
    updateParameterKeyframe(...args) { paused = true; stopActors(); return withActive('updateParameterKeyframe', ...args); },
    removeParameterKeyframe(...args) { paused = true; stopActors(); return withActive('removeParameterKeyframe', ...args); },
    removeKeyframe(...args) { paused = true; stopActors(); return withActive('removeKeyframe', ...args); },
    clearKeyframes() { paused = true; stopActors(); return withActive('clearKeyframes'); },
    seek(seconds) { paused = true; stopActors(); return withActive('seek', seconds); },
    /** Sample selected actors at one shared export time; omitted actors keep their exact pose. */
    seekForExport(seconds, actorIds = [activeId]) {
      const selected = new Set(actorIds); paused = true;
      return enqueue(async () => {
        await Promise.all(stopActors());
        suppress++;
        try {
          // Compose once after all selected sessions arrive at this timestamp. Never publish
          // a half-updated multi-person frame; hidden actors do not consume sampling work.
          for (const actor of actors) if (actor.visible && selected.has(actor.id)) {
            await actor.engine.seekForExport(seconds, { animate: true });
          }
        } finally { suppress--; compose(); }
      });
    },
    play() { return runSelection('play'); },
    pause() { return api.setPaused(true); },
    /** Hit-test normalized 0..1 canvas coordinates against cached alpha, front layer first. */
    getRenderLayers: () => actors.filter(actor => actor.visible && actor.hasFrame).map(actor => ({ id: `actor:${actor.id}`, kind: 'actor', canvas: actor.snapshot, revision: actor.revision })),
    hitTest(nx, ny, onlyId) {
      if (!Number.isFinite(nx) || !Number.isFinite(ny) || nx < 0 || nx >= 1 || ny < 0 || ny >= 1) return null;
      for (const actor of [...actors].reverse()) {
        if (!actor.visible || !actor.hasFrame || (onlyId && actor.id !== onlyId)) continue;
        const x = Math.min(actor.snapshot.width - 1, Math.floor(nx * actor.snapshot.width));
        const y = Math.min(actor.snapshot.height - 1, Math.floor(ny * actor.snapshot.height));
        if (actor.snapshotCtx.getImageData(x, y, 1, 1).data[3] > 16) return actor.id;
      }
      return null;
    },
    /** Version 3 adds speed/keyframes; version 2 and camera/model/visibility-only saves still load. */
    serialize() {
      // Distinguish an intentionally empty composition from an old unload snapshot taken
      // after disposal, so restoring a text/background-only work cannot revive deleted actors.
      return { schema: 'live2d-prototype.scene/3', emptyScene: !disposed && actors.length === 0, activeId, actorIds: actors.map((actor) => actor.id), paused,
        actors: actors.map((actor) => ({ id: actor.id, modelId: actor.modelId, name: actor.name,
          visible: actor.visible, camera: { ...actor.camera }, state: actor.engine?.getState() })) };
    },
    restore(snapshot, { keepOthers = false } = {}) {
      const missing = (snapshot?.actors || []).find(row => !MODELS.some(model => model.id === row.modelId));
      if (missing) return Promise.reject(new Error(`作品使用了目录中缺少的模型：${missing.modelId}。当前作品保持不变。`));
      paused = true; stopActors();
      return enqueue(async () => {
        const input = Array.isArray(snapshot?.actors) ? snapshot.actors : [];
        const rows = (Array.isArray(snapshot?.actorIds) ? snapshot.actorIds.map((id) => input.find((row) => row.id === id)).filter(Boolean) : input).slice(0, 3);
        const wanted = new Set(rows.map((row) => row.id));
        suppress++;
        try {
          if (!keepOthers) {
            const removed = actors.filter((actor) => !wanted.has(actor.id));
            actors = actors.filter((actor) => wanted.has(actor.id));
            await Promise.all(removed.map((actor) => actor.engine.dispose()));
          }
          const restored = [];
          for (const row of rows) {
            if (!MODELS.some((model) => model.id === row.modelId)) continue;
            let actor = actors.find((item) => item.id === row.id);
            if (!actor) {
              if (actors.length >= 3) continue;
              actor = await makeActor();
              if (typeof row.id === 'string') actor.id = row.id;
            }
            if (actor.modelId !== row.modelId) {
              const request = ++loadRequest;
              await completeLoad(actor, row.modelId, request, beginLoad(actor, row.modelId, request));
            }
            actor.visible = row.visible !== false;
            if (typeof row.name === 'string' && row.name.trim()) actor.name = row.name;
            actor.camera = { zoom: clamp(finite(row.camera?.zoom, 1), .25, 6), x: finite(row.camera?.x, 0),
              y: finite(row.camera?.y, 0), rotation: clamp(finite(row.camera?.rotation, 0), -180, 180) };
            const legacyParameters = Array.isArray(row.parameters) ? row.parameters : [];
            const legacyPose = Object.fromEntries(legacyParameters.filter((p) => typeof p.id === 'string' && Number.isFinite(p.value)).map((p) => [p.id, p.value]));
            const saved = row.state ?? { playback: { ...(row.playback ?? row), ...(row.selection ?? {}),
              paused: true, manual: legacyParameters.length > 0 }, poseValues: legacyPose,
              manualParameters: Object.fromEntries(legacyParameters.filter((p) => p.edited && Number.isFinite(p.value)).map((p) => [p.id, p.value])) };
            await actor.engine.restoreState({ ...saved, camera: actor.camera });
            restored.push(actor);
          }
          actors = [...restored, ...actors.filter((actor) => !restored.includes(actor))];
          const selectedId = snapshot?.activeId ?? snapshot?.selectedActorId ?? rows.find((row) => row.selected)?.id;
          activeId = actors.some((actor) => actor.id === selectedId) ? selectedId : actors[0]?.id ?? null;
          nextId = Math.max(nextId, ...actors.map((actor) => Number(actor.id.replace(/^actor-/, '')) + 1).filter(Number.isFinite));
          paused = snapshot?.paused !== false;
        } finally { suppress--; await applyPlayback(); compose(); }
      });
    },
    render: () => enqueue(compose),
    /** Re-render every real session at output pixels; previews are never upscaled for export. */
    renderAt(width, height, callback) {
      exportReservations++;
      const operation = enqueue(async () => {
        const w = Math.round(Number(width)), h = Math.round(Number(height));
        if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) throw new Error('无效的导出尺寸。');
        const output = document.createElement('canvas'); output.width = w; output.height = h;
        const outputCtx = output.getContext('2d');
        if (!outputCtx) throw new Error('无法创建导出画布。');
        suppress++;
        try {
          await Promise.all(stopActors());
          for (const actor of actors) {
            if (!actor.visible) continue;
            if (disposed) throw new Error('Scene engine disposed.');
            await actor.engine.renderAt(w, h, (source) => {
              // This copy happens before the source WebGL buffer can be discarded. Each
              // actor's renderAt restores its preview, while the dedicated export survives.
              outputCtx.drawImage(source, 0, 0);
            });
          }
          if (disposed) throw new Error('Scene engine disposed.');
          onFrame(output);
          return await callback(output);
        } finally {
          suppress--; compose(); await applyPlayback();
        }
      });
      return operation.finally(() => { exportReservations--; });
    },
    getStats,
    async dispose() {
      if (disposed) return;
      // Mark disposed before awaiting: no late source frame can republish a retired scene.
      disposed = true;
      for (const actor of actors) actor.engine?.setPaused(true);
      const disposals = actors.map((actor) => actor.engine?.dispose());
      await tail;
      await Promise.all(disposals);
      actors = []; activeId = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
  function runSelection(method, ...args) {
    const actor = active();
    if (!actor) return Promise.resolve();
    paused = false; stopActors();
    return enqueue(async () => {
      await actor.engine[method](...args);
      await applyPlayback();
    });
  }
  return api;
}
