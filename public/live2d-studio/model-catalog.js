/** Resolve source IDs through the widget's immutable HF catalog. The snapshot
 * supplies labels/portraits only. Only published outfits are offered for loading.
 */
const [labelsResponse, publishedResponse] = await Promise.all([
  fetch(new URL('./model-catalog.json', import.meta.url)),
  fetch('/api/live2d/catalog?native=1', { signal: AbortSignal.timeout(30000) }),
]);
if (!labelsResponse.ok || !publishedResponse.ok) throw Error('角色目录暂时无法读取，请重试。');
const labels = await labelsResponse.json();
const published = await publishedResponse.json();
const locations = new Map();
for (const character of published.characters ?? []) {
  for (const costume of character.costumes ?? []) {
    if (/^releases\/[a-f0-9]{64}\/model\.native\.json$/.test(costume.entryPath)) {
      locations.set(costume.id, new URL(`/api/live2d-assets/${costume.entryPath}`, location.origin));
    }
  }
}
const costumeId = id => `our-notes-${id.replaceAll('_', '-')}`;
const costumeWords = { caretaker:'照护员', hat:'帽子', mask:'面具', silhouette:'剪影', tracksuit:'运动服', suits:'西装', sweat:'卫衣', virtual:'虚拟形象', soundonly:'仅语音', nose:'鼻饰', detective:'侦探', idol:'偶像', hairdown:'散发', twintails:'双马尾', swimsuit:'泳装', glasses:'眼镜' };
export const MODELS = labels.models.filter(model => locations.has(costumeId(model.id))).map(model => ({
  ...model, costume: model.costume.split(' · ').map(word => costumeWords[word] || word).join(' · '),
}));
if (!MODELS.length) throw Error('Our Notes 模型目录尚未就绪，请稍后重试。');
export const modelById = new Map(MODELS.map(model => [model.id, model]));

/** Traffic stays on the allowlisted site gateway; no localhost proxy bridge. */
export function modelLocation(id) {
  const manifest = locations.get(costumeId(id));
  if (!modelById.has(id) || !manifest) throw Error(`目录中没有此模型：${id}。当前作品保持不变。`);
  return { manifest, base: new URL('./', manifest).href };
}

/** Small portraits never initialize extra WebGL/model sessions. */
export function portrait(id) {
  return modelById.has(id) ? `./thumbs/catalog/${id}.webp` : null;
}
