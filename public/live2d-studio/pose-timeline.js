const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Bounded easing keeps edited poses inside their original parameter ranges. */
export function easeProgress(progress, easing = 'linear') {
  const t = clamp(progress, 0, 1);
  if (t === 0 || t === 1) return t;
  if (easing === 'hold') return t >= 1 ? 1 : 0;
  if (easing === 'ease-in') return t * t;
  if (easing === 'ease-out') return 1 - (1 - t) ** 2;
  if (easing === 'ease-in-out') return t * t * (3 - 2 * t);
  if (easing && typeof easing === 'object' && easing.type === 'bezier') {
    const x1 = clamp(Number(easing.x1) || 0, 0, 1), x2 = clamp(Number(easing.x2) || 0, 0, 1);
    const y1 = clamp(Number(easing.y1) || 0, 0, 1), y2 = clamp(Number(easing.y2) || 0, 0, 1);
    const bezier = (u, a, b) => 3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u * u * b + u ** 3;
    let lo = 0, hi = 1;
    for (let i = 0; i < 20; i++) { const middle = (lo + hi) / 2; if (bezier(middle, x1, x2) < t) lo = middle; else hi = middle; }
    return clamp(bezier((lo + hi) / 2, y1, y2), 0, 1);
  }
  return t;
}

/** Independent parameter tracks; omitted parameters keep their native motion/expression values. */
export function samplePoseTracks(keyframes, seconds) {
  const tracks = new Map();
  for (const key of [...keyframes].sort((a, b) => a.time - b.time)) {
    for (const [id, value] of Object.entries(key.values ?? {})) {
      if (!Number.isFinite(value)) continue;
      if (!tracks.has(id)) tracks.set(id, []);
      tracks.get(id).push({ key, value });
    }
  }
  const values = {};
  for (const [id, entries] of tracks) {
    if (seconds <= entries[0].key.time) { values[id] = entries[0].value; continue; }
    const last = entries.at(-1);
    if (seconds >= last.key.time) { values[id] = last.value; continue; }
    const right = entries.findIndex((entry) => entry.key.time > seconds);
    const a = entries[right - 1], b = entries[right];
    const ratio = (seconds - a.key.time) / (b.key.time - a.key.time);
    const easing = a.key.easings?.[id] ?? a.key.easing;
    if (easing?.type === 'hermite') {
      // Native Unity tangents preserve overshoot and equal-valued endpoints.
      const t=ratio, dt=b.key.time-a.key.time;
      values[id]=(2*t**3-3*t*t+1)*a.value+(t**3-2*t*t+t)*dt*easing.outSlope+(-2*t**3+3*t*t)*b.value+(t**3-t*t)*dt*easing.inSlope;
    } else values[id] = a.value + (b.value - a.value) * easeProgress(ratio, easing);
  }
  return values;
}
