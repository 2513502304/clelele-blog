/** Browser-local drafts and reusable presets; no image or editing data leaves this device. */
const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('clelele-live2d-prototype', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('documents');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
export const ASSET_STORAGE_LOCK = 'clelele-live2d-prototype-storage';
const sessionId = crypto.randomUUID();
export const ASSET_SESSION_PREFIX = 'clelele-live2d-prototype-session:';
/** A live lease has no timer. A suspended/unresponsive editor makes collection skip. */
export const assetSession = { id: sessionId, ready: Promise.resolve(false) };
if (navigator.locks) {
  assetSession.ready = navigator.locks.request(ASSET_STORAGE_LOCK, { mode: 'shared' }, () => new Promise(resolve => {
    navigator.locks.request(ASSET_SESSION_PREFIX + sessionId, () => {
      resolve(true);
      return new Promise(release => window.addEventListener('pagehide', event => { if (!event.persisted) release(); }));
    }).catch(() => resolve(false));
  })).catch(() => false);
}
/** Bound reference traversal; uncertain or malformed roots abort collection, never imply no references. */
export function collectAssetReferences(roots, maxNodes = 100000) {
  const ids = new Set(), seen = new Set(), stack = [roots];
  let nodes = 0;
  while (stack.length) {
    const value = stack.pop();
    if (++nodes > maxNodes) throw new Error('资产引用过多，暂不清理。');
    if (!value || typeof value !== 'object' || seen.has(value) || value instanceof Blob) continue;
    seen.add(value);
    if (value instanceof Set) { for (const id of value) if (typeof id === 'string') ids.add(id.replace(/^asset:/, '')); continue; }
    for (const [key, item] of Object.entries(value)) {
      if (key === 'assetId' && typeof item === 'string' && item) ids.add(item.replace(/^asset:/, ''));
      else if (item && typeof item === 'object') stack.push(item);
    }
  }
  return ids;
}
async function transaction(mode, operation) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('documents', mode);
    let request;
    try { request = operation(tx.objectStore('documents')); }
    catch (error) { tx.abort(); reject(error); return; }
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('本地保存被中止'));
  });
}
async function coordinatedTransaction(mode, operation) {
  await assetSession.ready;
  return navigator.locks ? navigator.locks.request(ASSET_STORAGE_LOCK, { mode: 'shared' }, () => transaction(mode, operation)) : transaction(mode, operation);
}
const assetMetadataKey = key => 'asset-meta:' + key.slice(6);
export const storage = {
  read: (key) => coordinatedTransaction('readonly', (store) => store.get(key)),
  write: (key, value) => coordinatedTransaction('readwrite', store => {
    const request = store.put(value, key);
    if (String(key).startsWith('asset:') && value instanceof Blob) {
      store.put({ id: key.slice(6), size: value.size, createdAt: Date.now(), sessionId, protocol: 1 }, assetMetadataKey(key));
    }
    // Old open pages can keep a previously listed preset in memory. Preserve those
    // assets permanently rather than guessing whether an uncoordinated page is gone.
    if (key === 'presets') for (const id of collectAssetReferences(value)) store.put(true, 'asset-pin:' + id);
    return request;
  }),
  remove: (key) => coordinatedTransaction('readwrite', store => {
    const request = store.delete(key);
    if (String(key).startsWith('asset:')) { store.delete(assetMetadataKey(key)); store.delete('thumbnail:' + key.slice(6)); }
    return request;
  }),
  /** Read keys and small metadata only; existing Blob records are never deserialized. */
  async inspectAssets({ maxKeys = 4096 } = {}) {
    const db = await database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('documents', 'readonly'), store = tx.objectStore('documents');
      const result = { assets: [], metadata: [], pins: [], documents: [], complete: true, scanned: 0 };
      const cursor = store.openKeyCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result; if (!entry) return;
        if (++result.scanned > maxKeys) { result.complete = false; return; }
        const key = String(entry.key);
        if (key.startsWith('asset:')) result.assets.push(key.slice(6));
        else if (key.startsWith('asset-pin:')) result.pins.push(key.slice(10));
        else if (key.startsWith('thumbnail:')) { /* Owned by the source asset; never read Blob previews during capacity checks. */ }
        else { const read = store.get(entry.key); read.onsuccess = () => {
          if (key.startsWith('asset-meta:')) result.metadata.push(read.result);
          else result.documents.push(read.result);
        }; }
        entry.continue();
      };
      tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  },
  /** Caller owns the exclusive coordination lock and has rechecked every editor's roots. */
  deleteAssets: ids => transaction('readwrite', store => {
    for (const id of ids) { store.delete('asset:' + id); store.delete('asset-meta:' + id); store.delete('thumbnail:' + id); }
    return store.count();
  }),
};

/** Keep one undo entry per gesture, never one entry for every range input event. */
export function createHistory({ capture, restore, onChange, onSave, onError }) {
  const undo = [], redo = [];
  let baseline = null, busy = false, timer, holds = 0;
  const update = () => onChange({ undo: undo.length, redo: redo.length, busy, held: holds > 0 });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const api = {
    begin() { if (!busy && !baseline) baseline = capture(); },
    hold() { clearTimeout(timer); api.begin(); holds++; update(); },
    release() { holds = Math.max(0, holds - 1); if (!holds) api.commit(); else update(); },
    cancelPending() { clearTimeout(timer); },
    commit() {
      clearTimeout(timer);
      if (busy || holds) return;
      const after = capture();
      if (baseline && !same(baseline, after)) {
        undo.push(baseline); if (undo.length > 30) undo.shift(); redo.length = 0;
      }
      baseline = null; update(); onSave(after);
    },
    schedule() { clearTimeout(timer); timer = setTimeout(api.commit, 500); },
    async travel(direction) {
      if (busy || holds) return;
      api.commit();
      const from = direction === 'undo' ? undo : redo, to = direction === 'undo' ? redo : undo;
      if (!from.length) return;
      const before = capture(), next = from.at(-1);
      busy = true; update();
      try { await restore(next); from.pop(); to.push(before); onSave(capture()); }
      catch (error) { onError(error); }
      finally { busy = false; baseline = null; update(); }
    },
    clear() { undo.length = 0; redo.length = 0; baseline = null; update(); },
    get busy() { return busy; },
    get held() { return holds > 0; },
    get editing() { return baseline !== null; },
    get length() { return { undo: undo.length, redo: redo.length }; },
    /** A detached set exposes no mutable snapshots and includes an in-progress gesture. */
    getAssetReferences() { return collectAssetReferences([undo, redo, baseline]); },
  };
  return api;
}
