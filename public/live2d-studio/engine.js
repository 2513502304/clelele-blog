import { samplePoseTracks } from './pose-timeline.js';
import { motionReference } from './motion-reference.js';
import { editPoseKeys, scalePoseKeys } from './keyframe-edits.js';

import { MODELS, modelLocation } from './model-catalog.js';
import { fetchModelResource } from './model-resource-cache.js';
export { MODELS };

const vendor = new URL('/vendor/ournotes-player-0.1.8/', location.origin);
let runtimePromise;
let corePromise;
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

async function runtime() {
  corePromise ??= new Promise((resolve, reject) => {
    if (globalThis.Live2DCubismCore) return resolve();
    const script = document.createElement('script');
    script.src = new URL('live2dcubismcore.min.js', vendor).href;
    script.onload = () => globalThis.Live2DCubismCore ? resolve() : reject(new Error('Cubism Core did not initialize.'));
    script.onerror = () => { script.remove(); reject(new Error('Local Cubism Core could not load.')); };
    document.head.append(script);
  }).catch((error) => { corePromise = undefined; throw error; });
  await corePromise;
  // Keep the npm browser artifact byte-identical, including its separate license files.
  runtimePromise ??= import(new URL('ournotes-player.live2d.min.js', vendor).href)
    .catch((error) => { runtimePromise = undefined; throw error; });
  return runtimePromise;
}

/**
 * Owns one WebGL context and one 30 Hz clock. All session operations serialize, so exports,
 * loading, parameter updates and rendering cannot mutate the same session concurrently.
 * onFrame is synchronous: consume the source canvas before the browser clears its buffer.
 */
export async function createEngine({ canvas, onFrame = () => {}, onState = () => {}, onStats = () => {} }) {
  const lib = await runtime();
  const gl = canvas.getContext('webgl2', {
    alpha: true, premultipliedAlpha: true, antialias: true,
    depth: false, stencil: false, preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('此创作台需要 WebGL2。');
  let session = null;
  let disposed = false;
  let paused = false;
  let loading = false;
  let modelId = '';
  let controller = new AbortController();
  let loadGeneration = 0;
  let raf = null;
  let clockGeneration = 0;
  let lastTick = 0;
  let tail = Promise.resolve();
  let camera = { zoom: 1, x: 0, y: 0, rotation: 0 };
  let size = { width: 600, height: 750 };
  let overrides = new Map();
  let beforeOverride = new Map();
  let frozenBase = null;
  let manualFrozen = false;
  let selection = { motion: '', expression: '' };
  let playhead = 0;
  let duration = 0;
  let looping = false;
  let speed = 1;
  let motionScale = 1;
  let keyframes = [];
  let referenceCache = null;
  let nextKeyId = 1;
  let seekGeneration = 0;
  let frames = 0;
  let sampleFrames = 0;
  let sampleStart = performance.now();
  let fps = 0;
  let lastStats = -Infinity, lastStatsState = '';
  const active = () => !disposed && !paused && !manualFrozen && !document.hidden && !loading && session && (looping || playhead < duration);
  const enqueue = (work) => {
    const next = tail.then(work);
    tail = next.catch(() => {});
    return next;
  };
  const getStats = () => ({ fps: !active() ? 0 : fps, frames,
    width: canvas.width, height: canvas.height, paused: paused || manualFrozen || (!looping && playhead >= duration), hidden: document.hidden,
    antialias: gl.getContextAttributes()?.antialias ?? false, modelId, loading });
  const stats = () => {
    const now = performance.now();
    const status = getStats(), signature = [status.width, status.height, status.paused, status.hidden, status.modelId, status.loading].join('/');
    if (now - lastStats < 1000 && signature === lastStatsState) return;
    lastStatsState = signature;
    const elapsed = now - sampleStart;
    fps = elapsed > 0 ? (frames - sampleFrames) * 1000 / elapsed : 0;
    sampleStart = now; sampleFrames = frames; lastStats = now;
    onStats(getStats());
  };
  const state = (status, detail = {}) => onState({ status, modelId, loaded: 0, total: 0, message: '', ...detail });
  const stop = () => {
    clockGeneration++;
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
  };
  const fail = (error) => { paused = true; stop(); state('error', { message: error.message || String(error) }); };
  const start = () => {
    if (!active() || raf !== null) return;
    lastTick = performance.now();
    const generation = clockGeneration;
    const tick = async (now) => {
      raf = null;
      if (generation !== clockGeneration || !active()) return;
      const interval = 1000 / 30;
      if (now - lastTick >= interval) {
        // Preserve fractional time, and catch up without extra GPU draws after a short slow frame.
        const steps = Math.min(4, Math.floor((now - lastTick) / interval));
        lastTick = now - ((now - lastTick) % interval);
        try {
          await enqueue(async () => {
            if (generation !== clockGeneration || !active()) return;
            for (let i = 0; i < steps; i++) {
              const next = playhead + speed / 30;
              if (next >= duration) {
                if (looping) { playhead = next % Math.max(duration, 1 / 30); samplePose(playhead); }
                else { playhead = duration; paused = true; samplePose(playhead); stop(); break; }
              } else { playhead = next; samplePose(playhead); }
            }
            draw();
          });
        } catch (error) { if (!disposed) fail(error); }
      }
      if (generation === clockGeneration && active()) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };
  const applySize = () => session?.resize(size.width, size.height);
  const draw = () => { if (session && !disposed) session.render(); };
  const onVisibility = () => { stop(); if (!document.hidden) start(); };
  const onContextLost = (event) => { event.preventDefault(); fail(new Error('WebGL 上下文丢失，请保存作品后刷新创作台。')); };
  document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('webglcontextlost', onContextLost);

  function attach(loaded) {
    const originalGlobals = loaded._globals.bind(loaded);
    loaded._globals = (width, height) => {
      const globals = originalGlobals(width, height);
      const source = globals.unity_MatrixVP;
      const vp = source.slice();
      // Rotate in pixel space before translating in NDC; aspect correction prevents stretching.
      const angle = camera.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
      for (let column = 0; column < 4; column++) {
        const i = column * 4;
        vp[i] = camera.zoom * (c * source[i] + s * height / width * source[i + 1]) + camera.x * source[i + 3];
        vp[i + 1] = camera.zoom * (-s * width / height * source[i] + c * source[i + 1]) + camera.y * source[i + 3];
      }
      return { ...globals, unity_MatrixVP: vp, _Time: [playhead / 20, playhead, playhead * 2, playhead * 3] };
    };
    const character = loaded.character;
    const indices = new Map(character.core.parameters.ids.map((id, index) => [id, index]));
    const originalUpdate = character.modelUpdate.bind(character);
    character.modelUpdate = () => {
      for (const [id, value] of overrides) character.params.value[indices.get(id)] = value;
      originalUpdate();
    };
    character.setLookEnabled(false);
    const originalRender = loaded.render.bind(loaded);
    loaded.render = () => {
      originalRender();
      frames++;
      onFrame(canvas);
      stats();
    };
  }

  /** Flush edited parameters without advancing animation, including Cubism's delayed mesh swap. */
  function refreshParameters(render = true) {
    if (!session) return;
    const ch = session.character;
    ch.forceModelUpdate();
    // Cubism's completion callback restores its pre-expression parameter store. Keep the
    // evaluated frame as the next edit's base; an unrelated slider must not erase the face.
    ch.params.value.set(ch.core.parameters.values);
    // The runtime intentionally double-buffers meshes. Feed the same evaluated result to the
    // second buffer so a paused edit is visible now, with no animation/physics time advancement.
    ch._onDynamicDrawableData(ch.model.dyn);
    ch._renderLateUpdate();
    ch._maskLateUpdate();
    if (render) draw();
  }

  /** Native clip sampling at an editor time, with physics frozen during random access. */
  function samplePose(seconds) {
    if (!session) return;
    const ch = session.character;
    ch.params.value.set(ch.params.def); ch.store.save();
    ch.layer.list = []; ch.layer.finished = true; ch.layer.paused = false;
    ch.playMotion(selection.motion, 0);
    ch.expr.list = []; ch.expr.epv = []; ch.expr.last = -1; ch.ctl.hasAppliedExpression = false;
    if (selection.expression) ch.playExpression(selection.expression, 0);
    const physics = ch.physicsEnabled, breath = ch.breathMotionEnabled;
    const harmonic = [...ch.harmonicTimescales];
    // Editing and export use the same absolute-time clip evaluator. Random idle effects
    // and history-dependent secondary physics are intentionally excluded from this mode.
    ch.setEyeBlinkEnabled(false); ch.blink.phase = 0; ch.eyeOpening = 1;
    ch.harmonicTimescales.fill(0);
    ch.setPhysicsEnabled(false); ch.setBreathMotionEnabled(false);
    try {
      ch.applyStateAtMotionTime(clamp(seconds / motionScale, 0, session.character.clips.get(selection.motion)?.length ?? duration));
      ch.params.value.set(ch.core.parameters.values);
      // Motion clips author facial channels too. An editor's explicitly selected face is
      // a separate layer: evaluate its declared destinations from model defaults, preserving
      // every body parameter it does not declare. Otherwise a smile clip can erase a cry face.
      const expression = ch.expressions.find((item) => item.name === selection.expression);
      for (const destination of expression?.dest ?? []) {
        const { i, v, blend } = destination;
        const baseline = ch.params.def[i];
        const value = blend === 1 ? baseline + v : blend === 2 ? baseline * v : v;
        ch.params.value[i] = clamp(value, ch.params.min[i], ch.params.max[i]);
      }
      const p = ch.core.parameters;
      for (const [id, value] of Object.entries(samplePoseTracks(keyframes, seconds))) {
        const i = p.ids.indexOf(id); if (i >= 0) ch.params.value[i] = clamp(value, p.minimumValues[i], p.maximumValues[i]);
      }
      refreshParameters(false);
    }
    finally { ch.setPhysicsEnabled(physics); ch.harmonicTimescales.splice(0, harmonic.length, ...harmonic); ch.setBreathMotionEnabled(breath); }
    // Native random access only moves clip time. Rebase the end event for a later resume.
    const pm = ch.layer.list.at(-1);
    if (pm) { pm.startTime = ch.loop.time - seconds; pm.fadeInStartTime = pm.startTime; pm.endTime = ch.loop.time + Math.max(0, duration - seconds); }
    ch.ctl.nextMotion = ''; ch.ctl.loopMotion = false;
  }
  function clearManual() { overrides.clear(); beforeOverride.clear(); frozenBase = null; manualFrozen = false; }
  /** Presets replace the base pose, while explicit per-parameter corrections stay on top. */
  function rebaseManual() { beforeOverride.clear(); frozenBase = null; manualFrozen = false; }
  function freeze() {
    paused = true; manualFrozen = true; stop();
  }
  function updateDuration() {
    duration = Math.max(1 / 30, (session?.character.clips.get(selection.motion)?.length ?? 1) * motionScale,
      ...keyframes.map((key) => key.time));
  }
  function safeValues(values) {
    if (!session) return {};
    const p = session.character.core.parameters, clean = {};
    for (const [id, value] of Object.entries(values ?? {})) {
      const i = p.ids.indexOf(id);
      if (i >= 0 && Number.isFinite(Number(value))) clean[id] = clamp(Number(value), p.minimumValues[i], p.maximumValues[i]);
    }
    return clean;
  }
  const getPlayback = () => ({ ...selection, time: playhead, duration, loop: looping, speed, motionScale,
    keyframeCount: keyframes.length,
    playing: !!active(), paused: !active(), frame: Math.round(playhead * 30),
    totalFrames: Math.floor(duration * 30 + 1e-5) + 1, manual: manualFrozen });

  function applySavedState(saved = {}) {
        if (!session) return;
        const playback = saved.playback ?? saved;
        clearManual();
        if (session.motions.includes(playback.motion)) selection.motion = playback.motion;
        if (session.expressions.includes(playback.expression)) selection.expression = playback.expression;
        keyframes = (Array.isArray(saved.keyframes) ? saved.keyframes : []).slice(0, 64).map((key, i) => ({
          id: typeof key.id === 'string' ? key.id : `key-${i + 1}`, time: clamp(finite(key.time, 0), 0, 30),
          values: safeValues(key.values), easing: key.easing ?? 'linear', easings: key.easings && typeof key.easings === 'object' ? structuredClone(key.easings) : {} }));
        nextKeyId = Math.max(1, ...keyframes.map((key) => Number(key.id.replace(/^key-/, '')) + 1).filter(Number.isFinite));
        motionScale=clamp(finite(playback.motionScale,1),.001,900);
        updateDuration(); speed = clamp(finite(playback.speed, 1), .25, 2);
        playhead = clamp(finite(playback.time, 0), 0, duration); looping = !!playback.loop;
        if (saved.camera) camera = { ...camera, ...saved.camera };
        samplePose(playhead);
        const ch = session.character, p = ch.core.parameters;
        for (const [id, value] of Object.entries(saved.poseValues ?? {})) {
          const i = p.ids.indexOf(id); if (i >= 0 && Number.isFinite(value)) ch.params.value[i] = clamp(value, p.minimumValues[i], p.maximumValues[i]);
        }
        frozenBase = ch.params.value.slice();
        for (const [id, value] of Object.entries(saved.manualParameters ?? {})) {
          const i = p.ids.indexOf(id);
          if (i >= 0 && Number.isFinite(value)) overrides.set(id, clamp(value, p.minimumValues[i], p.maximumValues[i]));
        }
        // Explicit playback can animate beneath retained overrides. Preserve that choice;
        // older snapshots without the flag retain the conservative frozen-pose fallback.
        manualFrozen = typeof playback.manual === 'boolean' ? playback.manual : overrides.size > 0;
        paused = playback.paused !== false || manualFrozen;
        refreshParameters(); start();
  }

  const api = {
    cancelLoad() { controller.abort(); },
    async load(id) {
      const location = modelLocation(id); // Validate before touching the current editor.
      if (disposed) throw new Error('Engine disposed.');
      controller.abort(); controller = new AbortController();
      const signal = controller.signal, generation = ++loadGeneration;
      loading = true; stop(); state('loading', { modelId: id });
      return enqueue(async () => {
        const previous = session, previousAssets = session?.assets, previousId = modelId, saved = api.getState();
        let retired = false;
        try {
          signal.throwIfAborted();
          const assets = await lib.AssetStore.fromManifest(location.manifest.href, {
            signal, concurrency: 4, base: location.base, fetch: fetchModelResource,
            onProgress: (loaded, total) => {
              if (generation === loadGeneration && !disposed) state('loading', { modelId: id, loaded, total });
            },
          });
          signal.throwIfAborted();
          state('loading', { modelId: id, message: '资源已就绪，正在建立模型…' });
          // A context supports one native session. Retain the old session through transfer;
          // only retire it for GPU initialization, restoring its exact pose if that fails.
          if (previous) { await previous.dispose(); session = null; retired = true; }
          const loaded = await lib.ModelSession.create({ gl, assets, width: size.width, height: size.height });
          if (signal.aborted || disposed || generation !== loadGeneration) {
            await loaded.dispose(); throw new DOMException('已取消模型切换。', 'AbortError');
          }
          session = loaded; modelId = id; referenceCache = null;
          overrides = new Map(); beforeOverride = new Map(); clearManual();
          selection = { motion: loaded.motion, expression: loaded.expression };
          duration = Math.max(1 / 30, loaded.character.clips.get(selection.motion)?.length ?? 1);
          playhead = 0; looping = false; speed = 1; motionScale = 1; keyframes = []; nextKeyId = 1;
          attach(loaded); applySize();
          // Replacing a costume/character is an edit to this actor, not a new actor.
          // Restore compatible channels before publishing the first new frame. safeValues
          // clamps to the new model's bounds and ignores channels it does not provide.
          if (previous) applySavedState(saved);
          else samplePose(0);
          loading = false; draw();
          state('ready'); start(); return api;
        } catch (error) {
          if (retired && previous && !disposed) {
            if (session) { await session.dispose(); session = null; }
            // No network request during rollback: the prior AssetStore is still in memory.
            session = await lib.ModelSession.create({ gl, assets: previousAssets, width: size.width, height: size.height });
            modelId = previousId; referenceCache = null; attach(session); applySavedState(saved);
          }
          if (generation === loadGeneration && !disposed) {
            loading = false;
            state('error', { modelId: id, message: signal.aborted ? '已取消切换，原人物与编辑已保留。' : error.message || String(error) });
          }
          throw error;
        }
      });
    },
    setSize(cssWidth, cssHeight, dpr = 1) {
      const max = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      size = { width: clamp(Math.round(finite(cssWidth, 600) * finite(dpr, 1)), 1, max[0]),
        height: clamp(Math.round(finite(cssHeight, 750) * finite(dpr, 1)), 1, max[1]) };
      return enqueue(() => { applySize(); draw(); });
    },
    setCamera(update) {
      camera = { zoom: clamp(finite(update.zoom, camera.zoom), 0.25, 6),
        x: finite(update.x, camera.x), y: finite(update.y, camera.y),
        rotation: clamp(finite(update.rotation, camera.rotation), -180, 180) };
      return enqueue(draw);
    },
    getCamera: () => ({ ...camera }),
    setPaused(value) {
      paused = !!value; stop();
      // Publish discrete playback/size changes immediately; continuous FPS samples stay throttled.
      // Reset the sample so a resumed measurement excludes the paused interval.
      fps = 0; sampleFrames = frames; sampleStart = performance.now();
      return enqueue(() => { stats(); start(); });
    },
    getMotions: () => [...(session?.motions ?? [])],
    getExpressions: () => [...(session?.expressions ?? [])],
    /** The runtime's actual selection, including its declared defaults after loading. */
    getSelection: () => ({ ...selection }),
    getDefaults: () => ({ motion: session?.defaultMotion ?? '', expression: session?.defaultExpression ?? '' }),
    resetMotion() { return session ? api.playMotion(session.defaultMotion) : Promise.resolve(); },
    resetExpression() { return session?.defaultExpression ? api.setExpression(session.defaultExpression) : Promise.resolve(); },
    getPlayback,
    setSpeed(value) { speed = clamp(finite(value, 1), .25, 2); return Promise.resolve(getPlayback()); },
    setLoop(value) { looping = !!value; return enqueue(() => { start(); return getPlayback(); }); },
    play() {
      return enqueue(() => {
        if (!session) return;
        manualFrozen = false;
        if (playhead >= duration) { playhead = 0; samplePose(0); draw(); }
        paused = false; stop(); start(); return getPlayback();
      });
    },
    pause() { return api.setPaused(true); },
    seek(seconds) {
      paused = true; stop(); const generation = ++seekGeneration;
      return enqueue(() => {
        if (!session || generation !== seekGeneration) return;
        // Scrubbing changes the underlying animation frame, not the user's unrecorded
        // parameter layer. A base captured at the previous time must not freeze the new frame.
        frozenBase = null; manualFrozen = overrides.size > 0;
        playhead = clamp(finite(seconds, 0), 0, duration); samplePose(playhead); draw();
        return getPlayback();
      });
    },
    /** Export input is real seconds from the animation start. Speed is applied here once. */
    seekForExport(realSeconds, { animate = false } = {}) {
      paused = true; stop();
      return enqueue(() => {
        if (!session) return;
        // Choosing this actor for animation explicitly resumes its preset beneath local
        // edits. Unselected actors are not sampled by the scene and stay completely still.
        if (!animate && manualFrozen && !keyframes.length) { draw(); return getPlayback(); }
        const time = Math.max(0, finite(realSeconds, 0)) * speed;
        playhead = looping ? time % duration : Math.min(time, duration);
        samplePose(playhead); draw(); return getPlayback();
      });
    },
    getParameters() {
      if (!session) return [];
      const p = session.character.core.parameters;
      return p.ids.map((id, i) => ({ id, value: p.values[i],
        min: p.minimumValues[i], max: p.maximumValues[i], default: p.defaultValues[i], edited: overrides.has(id) }));
    },
    playMotion(id) {
      paused = true; stop();
      return enqueue(() => {
        if (!session) return;
        if (!session.motions.includes(id)) throw new Error(`Unknown motion: ${id}`);
        rebaseManual(); looping = false; selection.motion = id; motionScale = 1; updateDuration();
        playhead = 0; samplePose(0); draw(); paused = false; start();
      });
    },
    setExpression(id) {
      paused = true; stop();
      return enqueue(() => {
        if (!session) return;
        if (!session.expressions.includes(id)) throw new Error(`Unknown expression: ${id}`);
        rebaseManual(); looping = false; selection.expression = id; playhead = 0; samplePose(0); draw(); paused = false; start();
      });
    },
    setParameter(id, value) {
      freeze();
      return enqueue(() => {
        if (!session) return;
        if (!frozenBase) frozenBase = session.character.core.parameters.values.slice();
        const params = api.getParameters();
        const p = params.find((item) => item.id === id);
        if (!p || !Number.isFinite(Number(value))) return;
        if (!beforeOverride.has(id)) beforeOverride.set(id, p.value);
        overrides.set(id, clamp(Number(value), p.min, p.max));
        refreshParameters();
      });
    },
    setParameters(values) {
      freeze();
      return enqueue(() => {
        if (!session) return;
        if (!frozenBase) frozenBase = session.character.core.parameters.values.slice();
        const params = new Map(api.getParameters().map((p) => [p.id, p]));
        for (const [id, value] of Object.entries(values ?? {})) {
          const p = params.get(id);
          if (!p || !Number.isFinite(Number(value))) continue;
          overrides.set(id, clamp(Number(value), p.min, p.max));
        }
        refreshParameters();
      });
    },
    resetParameters() {
      paused = true; stop();
      return enqueue(() => {
        if (!session) return;
        const ch = session.character;
        if (frozenBase) ch.params.value.set(frozenBase);
        clearManual(); samplePose(playhead); refreshParameters();
      });
    },
    resetParameter(id) {
      freeze();
      return enqueue(() => {
        if (!session) return;
        const ch = session.character, p = ch.core.parameters, index = p.ids.indexOf(id);
        if (index < 0) return;
        const current = p.values.slice(); overrides.delete(id); beforeOverride.delete(id);
        samplePose(playhead); const baseline = p.values[index];
        ch.params.value.set(current); ch.params.value[index] = baseline; refreshParameters();
      });
    },
    getKeyframes: () => structuredClone(keyframes),
    /** Reference data is cached per selection and never mutates the rendered pose. */
    getMotionReference() {
      const id = selection.motion + '/' + selection.expression + '/' + motionScale;
      if (!session) return { id:'', duration:1, tracks:[] };
      if (referenceCache?.id !== id) {
        const native = motionReference(session.character, selection);
        referenceCache = {...native,id,duration:native.duration*motionScale,tracks:native.tracks.map(t=>({...t,keys:t.keys.map(k=>({...k,time:k.time*motionScale,easing:k.easing?.type==='hermite'?{...k.easing,outSlope:k.easing.outSlope/motionScale,inSlope:k.easing.inSlope/motionScale}:k.easing}))}))};
      }
      return referenceCache;
    },
    /** Stretch the native clip and optionally authored keys without changing playback speed. */
    setDuration(seconds, { scaleKeys = true } = {}) {
      paused=true; stop();
      return enqueue(()=>{
        if(!session)return;
        const target=finite(seconds,duration); if(target<1/30||target>30)throw new Error('动作时长须在 0.034–30 秒之间。');
        const factor=target/duration;
        if(!scaleKeys&&keyframes.some(k=>k.time>target))throw new Error('已有关键帧超出新时长，请勾选同步缩放关键帧。');
        const nativeLength=Math.max(1/30,session.character.clips.get(selection.motion)?.length??1);
        if(scaleKeys)keyframes=scalePoseKeys(keyframes,factor);
        motionScale=scaleKeys?motionScale*factor:target/nativeLength; updateDuration(); playhead=Math.min(playhead*factor,duration);
        samplePose(playhead); draw(); return getPlayback();
      });
    },
    /** Batch moves/deletes never overwrite unselected keys, and render only once. */
    editKeyframePoints(updates, options = {}) {
      paused=true;stop();
      return enqueue(()=>{
        const clean=updates.map(u=>({...u,...(u.value===undefined?{}:{value:safeValues({[u.parameterId]:u.value})[u.parameterId]})}));
        const result=editPoseKeys(keyframes,clean,{...options,nextId:nextKeyId});
        keyframes=result.keys;nextKeyId=result.nextId;
        if(!options.remove)for(const u of updates)overrides.delete(u.parameterId);
        manualFrozen=overrides.size>0;updateDuration();playhead=Math.min(playhead,duration);samplePose(playhead);draw();
        return result.selection;
      });
    },
    /** Copy only the chosen native parameter; other action/expression channels stay native. */
    seedMotionTrack(parameterId) {
      paused = true; stop();
      return enqueue(() => {
        if (keyframes.some(k => parameterId in k.values)) return;
        const track = api.getMotionReference().tracks.find(t => t.id === parameterId);
        if (!track || track.keys.at(-1)?.time > 30) throw new Error('当前动作暂不支持复制为编辑轨道。');
        const fresh = track.keys.filter(k => !keyframes.some(old => Math.abs(old.time-k.time)<1e-6));
        if (keyframes.length + fresh.length > 64) throw new Error('此曲线超过剩余关键帧容量，请先移除不需要的记录。');
        for (const knot of track.keys) {
          let key = keyframes.find(k => Math.abs(k.time-knot.time)<1e-6);
          if (!key) { key={id:`key-${nextKeyId++}`,time:knot.time,values:{},easing:'linear'}; keyframes.push(key); }
          key.values[parameterId]=knot.value;
          key.easings={...key.easings,[parameterId]:{...knot.easing}};
        }
        overrides.delete(parameterId); manualFrozen=overrides.size>0;
        updateDuration(); samplePose(playhead); draw();
      });
    },
    setKeyframe({ id, time = playhead, values, easing } = {}) {
      paused = true; stop();
      return enqueue(() => {
        if (!session) return null;
        const clean = safeValues(values ?? Object.fromEntries(api.getParameters().filter((p) => p.edited).map((p) => [p.id, p.value])));
        if (!Object.keys(clean).length) return null;
        const at = clamp(Math.round(finite(time, playhead) * 30) / 30, 0, 30);
        let key = keyframes.find((key) => key.id === id) ?? keyframes.find((key) => Math.abs(key.time - at) < 1 / 60);
        if (!key) {
          if (keyframes.length >= 64) throw new Error('每人最多保存 64 个姿态关键帧。');
          key = { id: `key-${nextKeyId++}`, time: at, values: {}, easing: easing ?? 'linear' }; keyframes.push(key);
        }
        key.time = at; key.values = { ...key.values, ...clean }; if (easing !== undefined) key.easing = easing;
        for (const parameterId of Object.keys(clean)) overrides.delete(parameterId);
        manualFrozen = overrides.size > 0; updateDuration(); samplePose(playhead); draw();
        return key.id;
      });
    },
    updateKeyframe(id, patch = {}) {
      const key = keyframes.find((key) => key.id === id);
      if (!key) return Promise.resolve(null);
      return api.setKeyframe({ ...key, ...patch, id, values: { ...key.values, ...(patch.values ?? {}) } });
    },
    /** A track edit must not move or delete other parameters captured in the same pose. */
    updateParameterKeyframe(id, parameterId, patch = {}) {
      paused = true; stop();
      return enqueue(() => {
        const original = keyframes.find((key) => key.id === id);
        if (!original || !Number.isFinite(original.values[parameterId])) return null;
        const clean = safeValues({ [parameterId]: patch.value ?? original.values[parameterId] });
        if (!(parameterId in clean)) return null;
        // A value/easing edit preserves exact native or stretched timestamps. Only an
        // explicit time edit snaps to frames; collisions use the same atomic batch path.
        const at = patch.time === undefined ? original.time : Math.round(Number(patch.time) * 30) / 30;
        const result = editPoseKeys(keyframes, [{ id, parameterId, time: at, value: clean[parameterId] }], { nextId: nextKeyId });
        const target = result.keys.find(key => key.id === result.selection[0].id);
        if (patch.easing !== undefined) target.easings[parameterId] = structuredClone(patch.easing);
        keyframes = result.keys; nextKeyId = result.nextId;
        overrides.delete(parameterId); manualFrozen = overrides.size > 0;
        updateDuration(); playhead = Math.min(playhead, duration); samplePose(playhead); draw(); return target.id;
      });
    },
    removeParameterKeyframe(id, parameterId) {
      paused = true; stop();
      return enqueue(() => {
        const key = keyframes.find((key) => key.id === id); if (!key) return;
        delete key.values[parameterId]; if (key.easings) delete key.easings[parameterId];
        if (!Object.keys(key.values).length) keyframes = keyframes.filter((item) => item !== key);
        updateDuration(); playhead = Math.min(playhead, duration); samplePose(playhead); draw();
      });
    },
    removeKeyframe(id) {
      paused = true; stop();
      return enqueue(() => { keyframes = keyframes.filter((key) => key.id !== id); updateDuration();
        playhead = Math.min(playhead, duration); samplePose(playhead); draw(); });
    },
    clearKeyframes() {
      paused = true; stop();
      return enqueue(() => { keyframes = []; updateDuration(); playhead = Math.min(playhead, duration); samplePose(playhead); draw(); });
    },
    getState() {
      const p = session?.character.core.parameters;
      return { schema: 'live2d-prototype.actor/3', modelId, camera: { ...camera }, playback: getPlayback(), keyframes: structuredClone(keyframes),
        manualParameters: Object.fromEntries(overrides),
        poseValues: p ? Object.fromEntries(p.ids.map((id, i) => [id, p.values[i]])) : {} };
    },
    restoreState(saved = {}) { paused = true; stop(); return enqueue(() => applySavedState(saved)); },
    render: () => enqueue(draw),
    /** Temporarily redraw this exact pose at output pixels; always restore the current preview. */
    renderAt(width, height, callback) {
      return enqueue(async () => {
        if (!session) throw new Error('请先加载模型。');
        const max = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
        const w = Math.round(Number(width)), h = Math.round(Number(height));
        if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > max[0] || h > max[1]) {
          throw new Error(`导出尺寸超出此 GPU 的 ${max[0]} × ${max[1]} 限制。`);
        }
        stop();
        try {
          session.resize(w, h); draw();
          return await callback(canvas);
        } finally {
          applySize(); draw(); start();
        }
      });
    },
    getStats,
    async dispose() {
      disposed = true; loadGeneration++; controller.abort(); stop();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      await enqueue(async () => { if (session) await session.dispose(); session = null; });
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
  return api;
}
