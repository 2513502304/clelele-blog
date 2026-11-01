import { storage, collectAssetReferences, assetSession, ASSET_STORAGE_LOCK, ASSET_SESSION_PREFIX } from './editor-storage.js';

const EMERGENCY_KEYS = ['clelele-live2d-prototype-draft-v1', 'clelele-live2d-prototype-draft-v2'];

/**
 * Idle-only mark/sweep for immutable uploaded backgrounds. getRoots must include
 * current document, history.getAssetReferences(), retained/gallery entries and
 * any pending upload/restore/clipboard references. isBusy covers editing, loading,
 * restore and export. Missing coordination or another open editor means no deletion.
 */
export function createAssetMaintenance({ getRoots, isBusy, graceMs = 120000, maxKeys = 4096, maxDeletes = 64 } = {}) {
  if (typeof getRoots !== 'function' || typeof isBusy !== 'function') throw new TypeError('资产清理需要引用与忙碌状态。');
  maxKeys = Math.max(1, Math.min(4096, Math.floor(Number(maxKeys) || 4096)));
  maxDeletes = Math.max(1, Math.min(256, Math.floor(Number(maxDeletes) || 64)));
  let disposed = false, idleHandle = null, timer = null, running = false;
  function snapshot() {
    if (disposed || isBusy()) return { busy: true, ids: [] };
    const roots = getRoots();
    if (roots?.then) throw new Error('资产引用必须同步读取。');
    return { busy: false, ids: [...collectAssetReferences(roots)] };
  }
  async function hasOtherEditor() {
    const locks = await navigator.locks.query();
    return locks.held.some(lock => lock.name.startsWith(ASSET_SESSION_PREFIX)
      && lock.name !== ASSET_SESSION_PREFIX + assetSession.id);
  }
  function emergencyRoots() {
    // An unreadable backup is uncertainty, never permission to remove its images.
    return EMERGENCY_KEYS.map(key => { const value = localStorage.getItem(key); return value ? JSON.parse(value) : null; });
  }
  /** No Blob reads: unknown legacy asset sizes remain explicitly unknown. */
  async function getUsage() {
    await assetSession.ready;
    const inspect = async () => {
      const rows = await storage.inspectAssets({ maxKeys }), ids = new Set(rows.assets);
      const metadata = rows.metadata.filter(row => ids.has(row.id));
      return { count: rows.assets.length, knownBytes: metadata.reduce((sum, row) => sum + row.size, 0),
        unknownSizeCount: rows.assets.length - metadata.length, complete: rows.complete };
    };
    return navigator.locks ? navigator.locks.request(ASSET_STORAGE_LOCK, { mode: 'shared' }, inspect) : inspect();
  }
  /** Returns a skip reason rather than risking a user's recoverable background. */
  async function collect() {
    const skip = reason => ({ deleted: [], freedBytes: 0, skipped: reason });
    if (disposed || running) return skip('inactive');
    if (!navigator.locks || !await assetSession.ready) return skip('coordination-unavailable');
    if (isBusy()) return skip('busy');
    running = true;
    try {
      return await navigator.locks.request(ASSET_STORAGE_LOCK, { ifAvailable: true }, async lock => {
        if (!lock) return skip('storage-busy');
        if (disposed || isBusy()) return skip('busy');
        // A peer may start undo/restore immediately after replying to a roots
        // request. Skip the entire sweep while it is open, rather than trusting
        // a stale cross-tab snapshot. New session registration needs this same
        // lock in shared mode, so no unexamined editor can enter during deletion.
        if (await hasOtherEditor()) return skip('other-editor-open');
        const rows = await storage.inspectAssets({ maxKeys });
        if (!rows.complete) return skip('scan-limit');
        const local = snapshot();
        if (local.busy) return skip('busy');
        const references = collectAssetReferences([rows.documents, emergencyRoots()]);
        for (const id of [...rows.pins, ...local.ids]) references.add(id);
        const existing = new Set(rows.assets), cutoff = Date.now() - Math.max(0, graceMs);
        // Legacy uploads have no trustworthy lifecycle metadata; preserve them.
        // Saved presets are pinned even after deletion, protecting old open pages
        // that listed a preset before this coordination protocol was introduced.
        const candidates = rows.metadata.filter(row => row.protocol === 1 && Number.isFinite(row.size)
          && row.createdAt <= cutoff && existing.has(row.id) && !references.has(row.id)).slice(0, maxDeletes);
        if (disposed || isBusy()) return skip('busy');
        if (candidates.length) await storage.deleteAssets(candidates.map(row => row.id));
        return { deleted: candidates.map(row => row.id), freedBytes: candidates.reduce((sum, row) => sum + row.size, 0), skipped: null };
      });
    } catch (error) { return { ...skip('uncertain-roots-or-storage'), message: error.message }; }
    finally { running = false; }
  }
  /** Debounced work scheduled by completed edits/saves; no heartbeat or polling loop. */
  function schedule({ delay = Math.max(0, graceMs) + 2000, onComplete = () => {} } = {}) {
    if (disposed) return;
    clearTimeout(timer);
    if (idleHandle !== null) { cancelIdleCallback(idleHandle); idleHandle = null; }
    timer = setTimeout(() => {
      timer = null;
      const run = () => { idleHandle = null; if (!disposed) collect().then(onComplete); };
      if (typeof requestIdleCallback === 'function') idleHandle = requestIdleCallback(run, { timeout: 10000 });
      else run();
    }, delay);
  }
  return { collect, getUsage, schedule, dispose() {
    disposed = true; clearTimeout(timer);
    if (idleHandle !== null) cancelIdleCallback(idleHandle);
  } };
}
