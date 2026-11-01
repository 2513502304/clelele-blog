import { setControlValue, syncRange, refreshRanges } from './range-controls.js';
import {normalizeLook} from './look-settings.js';
import {createLookPanel} from './look-panel.js';
import {installWorkspaceLayout} from './workspace-layout.js';
import { MODELS, portrait } from './model-catalog.js';
import { createModelPicker } from './model-picker.js';
import { createSceneEngine } from './scene-engine.js';
import { runAnimationPreview } from './animation-preview.js';
import { mergeBackgrounds, backgroundThumbnail, createBackgroundLibrary, BACKGROUND_LIMIT, BACKGROUND_BYTE_LIMIT } from './background-library.js';
import { createSceneLayers } from './scene-layers.js';
import { createPosterEditor } from './poster-panel.js';
import { ensurePosterFonts } from './poster.js';
import { createCompositor } from './compositor.js';
import { createActionControls } from './action-controls.js';
import { storage, createHistory } from './editor-storage.js';
import { createAssetMaintenance } from './asset-maintenance.js';
import { getExportCapabilities, getExportDimensions, exportStill, exportAnimation } from './export-media.js';
import { DEFAULT_EFFECTS, EFFECT_OPTIONS, EFFECT_CONTROLS, normalizeEffects, effectDetails, paintEffects, createEffectClock, isAnimatedEffect, isGpuEffect } from './effects.js';
import { FILTER_DEFINITIONS, getFilterDefinition, getFilterDefaults } from './filter-definitions.js';
import { isEditorEvent, isTextEntry, isNativeUndoEntry, installPlaybackShortcut, installAnnotationOwnership } from './editor-events.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const frame = $('#stage-frame');
const output = $('#output');
const source = $('#model-source');
const app = $('#app');
const compositor = createCompositor({ canvas: output });
const models = Object.fromEntries(MODELS.map(model => [model.id, [model.name, model.costume]]));
const state = {
  model: Object.keys(models)[0], ratio: 4 / 3, quality: 2, ready: false, paused: false,
  target: 'model', background: { type: 'color', color: '#f6f0ec', color2: '#e7ddc9', image: null, scale: 1, x: 0, y: 0 },
  uploadedBackground: null, backgroundLibrary: [],
  look: normalizeLook(), lookRecipe:null, filter: 'original', filterParamsById: {}, strength: .7, exposure: 0, saturation: 1, gradeBackground: false,
  speaker: '千早爱音', dialogue: '', dialogues: {}, textSize: 1, captionExport: true, exporting: false, labelLocale: 'zh',
  preciseSelection: true, effects: { ...DEFAULT_EFFECTS, type: 'none', count: 32, speed: .6, strength: .6, color: '#dc7d9a' },
};
let failedModelId, engine, activeImageURL, resizeFrame, toastTimer, generation = 0;
let comparing = false, layerManager, actionControls, history, restoring = false, selecting = false, exportController, backgroundRequest = 0;
let assetMaintenance, lookPanel;
// A modal owns a frozen editing snapshot; temporary output frames never become the draft.
let exportDialogSession = null, exportOpening = false, exportTask = null;
let exportPreviewTask = null, exportPreviewController = null;
let exportClosingTask = null, pageLeaving = false;
let dialogueActorId, presets = [], effectTime = 0, lastActionRefresh = 0;
const backgroundImages = new Map();
const backgroundLibrary = createBackgroundLibrary({ root: $('#background-library'), storage,
  onUse: id => useSavedBackground(id), onDelete: id => removeSavedBackground(id), onError: handleError });
// One independent FX clock; a frozen pose reuses the compositor texture instead of redrawing Live2D.
const effectClock = createEffectClock({
  isActive: () => state.ready && !state.exporting && !exportDialogSession && !restoring && isAnimatedEffect(state.effects),
  draw(time) { effectTime = time; if (isGpuEffect(state.effects)) compositor.drawCached(time); drawEffects(); },
});
function syncEffects() {
  compositor.setScene({ effects: state.effects, effectTime });
  if (state.ready) compositor.drawCached(effectTime);
  drawEffects(); effectClock.sync();
  $('#effect-play').textContent = state.effects.animate ? 'Ⅱ' : '▶';
  $('#effect-play').setAttribute('aria-pressed', String(state.effects.animate));
  $('#effect-description').textContent = EFFECT_OPTIONS.find(e => e.id === state.effects.type)?.description || '';
}

/** Bound decoded background memory independently of the undo history's immutable asset IDs. */
function cacheBackground(id, image) {
  backgroundImages.delete(id); backgroundImages.set(id, image);
  while (backgroundImages.size > 3) backgroundImages.delete(backgroundImages.keys().next().value);
}
/** Keep the upload as an immutable asset reference even while a preset is displayed. */
function retainBackground() {
  if (state.background.type !== 'image' || !state.background.assetId) return;
  const { assetId, name, scale, x, y } = state.background;
  state.uploadedBackground = { assetId, name: name || state.uploadedBackground?.name || '上传的图片', scale, x, y };
  state.backgroundLibrary = mergeBackgrounds(state.backgroundLibrary, [state.uploadedBackground]);
}
function syncBackgroundUpload() {
  const retained = state.uploadedBackground, active = state.background.type === 'image' && state.background.assetId === retained?.assetId;
  $('#retained-background').hidden = !retained;
  $('#background-name').textContent = retained?.name || '';
  $('#use-uploaded-background').textContent = active ? '正在使用' : '使用这张图片';
  $('#use-uploaded-background').disabled = active;
  $('#upload-drop strong').textContent = '加入背景图片';
  backgroundLibrary.render(state.backgroundLibrary, state.background.type === 'image' ? state.background.assetId : null);
  $('#background-library-count').textContent = `${state.backgroundLibrary.length} / ${BACKGROUND_LIMIT}`;
}
async function readBackgroundImage(assetId) {
  let image = backgroundImages.get(assetId);
  if (!image) {
    const blob = await storage.read('asset:' + assetId);
    if (!blob) throw new Error('背景素材不存在，当前画面已保留。');
    const url = URL.createObjectURL(blob); image = new Image(); image.src = url;
    try { await image.decode(); } finally { URL.revokeObjectURL(url); }
    cacheBackground(assetId, image);
  }
  return image;
}
const posterEditor = createPosterEditor({ onChange() { syncCaption(); syncScene(); layerManager?.render(); history?.schedule(); }, onPreset: applyPosterPreset, onTarget: chooseTarget, getLocale: () => state.labelLocale, onSelectionChange: () => syncSelection() });
const applyBuiltInPreset = posterEditor.applyPreset.bind(posterEditor);
posterEditor.applyPreset = async (...args) => {
  history?.hold();
  try { const result=await applyBuiltInPreset(...args); if(result){state.layerOrder=undefined;layerManager?.render();syncScene();}return result; }
  finally { history?.release(); }
};
layerManager = createSceneLayers({root:$('#scene-layers'),state,getActors:()=>engine?.getActors()||[],getText:()=>posterEditor.getLayers(),
  selectActor: id => safely((async()=>{await engine.selectActor(id);posterEditor.clearSelection();chooseTarget('model');syncActorUI();})()),
  selectText: id => {posterEditor.selectLayer(id,false);chooseTarget('text');setTab('layers');},
  selectBackground: () => { if(state.background.type==='image') chooseTarget('background'); else chooseTarget('none'); },
  remove: deleteLayer, setVisible: setLayerVisible, onError: handleError,
  canEdit: () => state.ready && !state.exporting && !restoring && !history?.held && !history?.busy,
  onChange:syncScene,onHistory:phase=>phase==='begin'?history?.begin():history?.commit()});
$('#select-typography').onclick = () => { posterEditor.selectGroup(); setTab('layers'); notify('整组文字已选中：拖动移动，滚轮缩放。'); };
$('#poster-layer').closest('label').hidden = true;
for(const [id,delta] of [['text-back',-1],['text-front',1]]) $('#' + id).onclick = () => layerManager.step('text:'+posterEditor.getSelected()?.id,delta);
const pointers = new Map();
let textResize = null;
installAnnotationOwnership(app);
installPlaybackShortcut(app, () => state.ready && $('#loading').hidden && !state.exporting && !restoring && !history?.busy && !history?.held, togglePause);


function notify(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}
function handleError(error) { console.error(error); notify(error.message || String(error)); }
function safely(result) { result?.catch?.(handleError); }
function pressed(selector, attribute, value) {
  $$(selector).forEach((button) => button.setAttribute('aria-pressed', String(button.dataset[attribute] === String(value))));
}

/** All style edits draw through the same compositor used by the PNG path. */
function syncScene() {
  compositor.setScene({ ...state, filter: comparing ? 'original' : state.filter,
    look: comparing ? normalizeLook() : state.look, filterParams: comparing ? {} : state.filterParamsById[state.filter], exposure: comparing ? 0 : state.exposure, saturation: comparing ? 1 : state.saturation });
  if (state.ready) safely(engine.render());
  effectClock.sync();
}
function syncCaption() {
  $('#caption').hidden = !Object.values(state.dialogues).some(d => d.text?.trim()) && !posterEditor.hasFrontLayers() && state.effects.type === 'none';
  const layer = $('#caption');
  layer.width = Math.round(frame.clientWidth * 2); layer.height = Math.round(frame.clientHeight * 2);
  const context = layer.getContext('2d'); context.clearRect(0, 0, layer.width, layer.height);

  drawEffects();
  paintCaption(context, layer.width, layer.height);
  syncSelection();
}
function drawEffects() {
  const canvas = $('#decorations'); if (!canvas) return;
  if (!(state.effects.enabled??[state.effects.type]).some(id=>id!=='none'&&!['crt','glitch','neon'].includes(id))) { canvas.hidden = true; return; }
  canvas.hidden = false; const width = Math.round(frame.clientWidth * state.quality), height = Math.round(frame.clientHeight * state.quality);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext('2d'); context.clearRect(0, 0, width, height); paintEffects(context, width, height, state.effects, effectTime);
}
function resize() {
  if (state.exporting) return;
  const well = $('#stage-well'), style = getComputedStyle(well);
  const maxWidth = well.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const maxHeight = well.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const width = Math.max(64, Math.min(maxWidth, maxHeight * state.ratio));
  const height = width / state.ratio;
  frame.style.width = `${width}px`; frame.style.height = `${height}px`;
  safely(engine?.setSize(width, height, state.quality));
  syncCaption();
}
new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(resize); }).observe($('#stage-well'));

function updateZoom() {
  const zoom = state.target === 'model' ? engine?.getCamera().zoom ?? 1 : state.target === 'text' ? posterEditor.getSelected()?.size ?? .12 : state.background.scale;
  $('#zoom-value').textContent = `${Math.round(zoom * 100)}%`;
  setControlValue($('#bg-zoom'), Math.round(state.background.scale * 100));
  $('#bg-zoom-output').textContent = `${Math.round(state.background.scale * 100)}%`;
}
function chooseTarget(target) {
  if (target === 'model' && !engine?.getActors().length) target = 'none';
  if (target === 'none') { state.target = 'none'; frame.dataset.target = 'none'; pressed('[data-target]', 'target', 'none'); $('#gesture-hint').textContent = '点击人物或文字开始编辑'; $('#actions-editor').inert = true; $('#pose-editor').inert = true; $('#actor-rotation').disabled = true; $$('#actor-list [data-actor]').forEach(b => b.setAttribute('aria-pressed','false')); syncSelection(); return; }
  if (target === 'text' && !posterEditor.hasSelection()) { notify('请先在海报面板添加或选择文字。'); setTab('poster'); return; }
  if (target === 'background' && state.background.type !== 'image') {
    notify('加入背景图片后，即可独立移动和缩放背景。'); return;
  }
  state.target = target; frame.dataset.target = target;
  $('#actions-editor').inert = target !== 'model'; $('#pose-editor').inert = target !== 'model'; $('#actor-rotation').disabled = target !== 'model';
  $$('#actor-list [data-actor]').forEach(b => b.setAttribute('aria-pressed', String(target === 'model' && b.dataset.actor === selectedActor()?.id)));
  if (target === 'text') { setTab('poster'); $('#inspector').classList.add('is-open'); safely(engine?.pause()); state.paused = true; updatePlaybackUI(); }
  if (target === 'model') { $('#model-panel').classList.add('is-open'); }
  syncSelection();
  pressed('[data-target]', 'target', target); updateZoom();
  $('#gesture-hint').textContent = target === 'model' ? '拖拽移动 · 滚轮缩放 · 双击复位' : target === 'text' ? '拖动选中文字 · 滚轮调整字号' : '正在编辑背景 · 角色位置保持不变';
  $('#target-badge').textContent = target === 'text' ? 'T 正在移动选中文字' : '✥ 正在移动背景';
}
function camera(patch) { safely(engine?.setCamera(patch)); updateZoom(); }
function resetView() {
  if (state.target === 'none') return;
  if (state.target === 'model') camera({ zoom: 1, x: 0, y: 0 });
  else if (state.target === 'text') { posterEditor.reset(); }
  else { Object.assign(state.background, { scale: 1, x: 0, y: 0 }); syncScene(); }
  updateZoom();
}
function zoomAt(factor, px = frame.clientWidth / 2, py = frame.clientHeight / 2) {
  if (!state.ready || state.exporting || state.target === 'none') return;
  if (state.target === 'text') { posterEditor.zoom(factor); }
  else if (state.target === 'background') {
    state.background.scale = Math.min(4, Math.max(1, state.background.scale * factor)); syncScene();
  } else {
    const old = engine.getCamera(), next = Math.max(.25, Math.min(6, old.zoom * factor));
    const actualFactor = next / old.zoom, nx = px / frame.clientWidth * 2 - 1, ny = 1 - py / frame.clientHeight * 2;
    camera({ zoom: next, x: nx + (old.x - nx) * actualFactor, y: ny + (old.y - ny) * actualFactor });
  }
  updateZoom();
}
function pan(dx, dy) {
  if (!state.ready || state.exporting || state.target === 'none') return;
  if (state.target === 'model') {
    const old = engine.getCamera(); camera({ x: old.x + 2 * dx / frame.clientWidth, y: old.y - 2 * dy / frame.clientHeight });
  } else if (state.target === 'text') { posterEditor.pan(dx / frame.clientWidth, dy / frame.clientHeight); } else {
    // Convert pointer pixels to the compositor's crop-overflow fractions so the image follows the hand.
    const image = state.background.image, cover = Math.max(frame.clientWidth / image.naturalWidth, frame.clientHeight / image.naturalHeight);
    const overflowX = image.naturalWidth * cover * state.background.scale - frame.clientWidth;
    const overflowY = image.naturalHeight * cover * state.background.scale - frame.clientHeight;
    if (overflowX > .1) state.background.x = Math.max(-1, Math.min(1, state.background.x + 2 * dx / overflowX));
    if (overflowY > .1) state.background.y = Math.max(-1, Math.min(1, state.background.y + 2 * dy / overflowY));
    syncScene();
  }
}

// Bind to the actual mounted stage once. No Portal timing or ready-state transition is needed.
frame.addEventListener('wheel', (event) => {
  if (!$('#loading').hidden) return; // Loading controls own their pointer and keyboard input.
  if (event.ctrlKey || event.metaKey || !state.ready || state.exporting || state.target === 'none') return;
  history?.begin(); event.preventDefault();
  const box = frame.getBoundingClientRect();
  zoomAt(Math.exp(-event.deltaY * (event.deltaMode === 1 ? .04 : .0016)), event.clientX - box.left, event.clientY - box.top);
}, { passive: false });
frame.addEventListener('pointerdown', (event) => {
  if (!$('#loading').hidden) return; // Loading controls own their pointer and keyboard input.
  if (textResize) return; // A second touch must not turn an active corner resize into a pan.
  if (event.button !== 0 || !state.ready || state.exporting) return;
  layerManager.clearActive();
  history?.begin();
  frame.focus({ preventScroll: true }); frame.setPointerCapture(event.pointerId);
  // Handles own the gesture before glyph hit-testing; corners can sit in transparent pixels.
  if (state.target === 'text' && !pointers.size) {
    const box=frame.getBoundingClientRect(), point={x:event.clientX-box.left,y:event.clientY-box.top};
    const bounds=posterEditor.getSelectionBounds(box.width,box.height);
    const corner=bounds?.corners.findIndex(p=>Math.hypot(p.x-point.x,p.y-point.y)<14) ?? -1;
    if(corner>=0) {
      const anchor=bounds.corners[(corner+2)%4], end=bounds.corners[corner];
      textResize={pointerId:event.pointerId,anchor,end,box,originals:posterEditor.beginResize()};
      frame.classList.add('resizing-text'); event.preventDefault(); return;
    }
  }
  if (state.preciseSelection && state.target !== 'background' && !posterEditor.isGroupSelected()) {
    selecting = true; pickObject(event).catch(handleError).finally(() => { selecting = false; });
  }
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); frame.classList.add('dragging');
});
frame.addEventListener('pointermove', (event) => {
  if(textResize?.pointerId===event.pointerId) {
    const {anchor,end,box,originals}=textResize, dx=end.x-anchor.x, dy=end.y-anchor.y;
    const factor=((event.clientX-box.left-anchor.x)*dx+(event.clientY-box.top-anchor.y)*dy)/Math.max(1,dx*dx+dy*dy);
    posterEditor.resizeFrom(originals,factor,{x:anchor.x/box.width,y:anchor.y/box.height}); return;
  }
  if (!pointers.has(event.pointerId) || selecting) return;
  const previous = [...pointers.values()], before = pointers.get(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 1) pan(event.clientX - before.x, event.clientY - before.y);
  else if (pointers.size === 2) {
    const next = [...pointers.values()], distance = (p) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    const box = frame.getBoundingClientRect(), midpoint = (p) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
    const oldCenter = midpoint(previous), center = midpoint(next);
    zoomAt(distance(next) / Math.max(1, distance(previous)), center.x - box.left, center.y - box.top);
    pan(center.x - oldCenter.x, center.y - oldCenter.y);
  }
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) frame.addEventListener(name, (event) => {
  if(textResize?.pointerId===event.pointerId){textResize=null;frame.classList.remove('resizing-text');history?.commit();}
  pointers.delete(event.pointerId); if (!pointers.size) { frame.classList.remove('dragging'); history?.commit(); }
});
frame.addEventListener('dblclick', resetView);
frame.addEventListener('keydown', (event) => {
  if (!$('#loading').hidden) return; // Loading controls own their pointer and keyboard input.
  if (!state.ready || state.exporting || event.ctrlKey || event.metaKey) return;
  const moves = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] };
  if (moves[event.key]) { event.preventDefault(); history?.begin(); pan(...moves[event.key].map(value => value * (event.shiftKey ? 4 : 1))); history?.schedule(); }
  else if (['+', '=', '-', '0', ' '].includes(event.key)) {
    event.preventDefault(); if (event.key !== ' ') history?.begin(); if (event.key === '0') resetView();
    else if (event.key === ' ') togglePause(); else zoomAt(event.key === '-' ? 1 / 1.15 : 1.15);
    if (event.key !== ' ') history?.schedule();
  }
});

function populateActions() { actionControls?.refresh(); }
$('#label-locale').onclick = () => {
  state.labelLocale = state.labelLocale === 'zh' ? 'en' : 'zh';
  actionControls?.setLocale(state.labelLocale); posterEditor.refreshLocale?.(); refreshRanges();
  $('#actions-heading').textContent = state.labelLocale === 'zh' ? '动作与表情' : 'Motion & expression';
};
async function loadModel(id) {
  if (!models[id]) { handleError(new Error(`目录中没有此模型：${id}。当前作品保持不变。`)); return; }
  if (state.exporting || restoring) return;
  history?.begin(); // Snapshot before changing selection or disabling controls.
  const request = ++generation; state.ready = false; failedModelId = id;
  $('#model-name').textContent = models[id][0]; $('#costume-name').textContent = models[id][1];
  try {
    await engine.load(id); if (request !== generation) return;
    state.ready = true; failedModelId = null; resize(); syncActorUI(); history?.commit();
  } catch (error) {
    if (request !== generation) return;
    state.ready = engine.serialize().actors.some(actor => !!actor.modelId);
    syncActorUI(); history?.commit();
    if (error.name !== 'AbortError') handleError(error);
  }
}
const modelPicker = createModelPicker({ root:$('#model-list'), search:$('#model-search'), count:$('#model-results'), more:$('#model-more'), select:$('#add-model'), getSelected:()=>state.model });
/** Selection updates controls only; it never recreates a model or resets another actor's pose. */
function syncActorUI() {
  layerManager?.render();
  const actors = engine.getActors(), selected = actors.find((actor) => actor.selected);
  if (selected) {
    state.model = selected.modelId;
    const model = models[selected.modelId] || [selected.name, ''];
    $('#model-name').textContent = model[0]; $('#costume-name').textContent = model[1];
    modelPicker.syncSelection();
  } else {
    $('#model-name').textContent = '尚未添加人物'; $('#costume-name').textContent = '选择模型即可加入画面';
    $$('.model-card').forEach((button) => button.classList.remove('active'));
    if (state.target === 'model') chooseTarget('none');
  }
  $('#actor-list').replaceChildren(...[...actors].reverse().map((actor, i) => {
    const row = document.createElement('div'); row.className = 'actor-row';
    const button = document.createElement('button'); button.className = 'actor-card'; button.dataset.actor = actor.id;
    button.setAttribute('aria-pressed', String(actor.selected && state.target === 'model'));
    const img = document.createElement('img'); img.alt = '';
    const avatar = portrait(actor.modelId); if (avatar) img.src = avatar; else img.hidden = true;
    const copy = document.createElement('span'), name = document.createElement('strong'), note = document.createElement('small');
    name.textContent = models[actor.modelId]?.[0] || actor.name;
    note.textContent = `图层 ${((layerManager?.order() || []).indexOf('actor:'+actor.id))+1} · ${actor.visible === false ? '已隐藏' : actor.selected ? '正在编辑' : '保留姿态'}`;
    copy.append(name, note); button.append(img, copy);
    const visibility = document.createElement('button'); visibility.className = 'actor-visibility'; visibility.dataset.visibility = actor.id;
    visibility.textContent = actor.visible === false ? '显示' : '隐藏'; visibility.title = actor.visible === false ? '显示人物' : '隐藏人物';
    visibility.setAttribute('aria-pressed', String(actor.visible !== false)); row.classList.toggle('is-hidden', actor.visible === false);
    visibility.setAttribute('aria-label', `${visibility.title}：${name.textContent}`);
    row.append(button, visibility); return row;
  }));
  const index = actors.findIndex((actor) => actor.selected);
  $('#actor-count').textContent = `${actors.length} / 3`;
  $('#add-actor').disabled = actors.length >= 3 || !state.ready;
  $('#actor-remove').disabled = !selected || !state.ready;
  $('#actor-back').disabled = index < 0 || !state.ready;
  $('#actor-front').disabled = index < 0 || !state.ready;
  if (state.ready) populateActions();
  const rotation = selected?.camera.rotation || 0; setControlValue($('#actor-rotation'), rotation); $('#actor-rotation-output').textContent = `${Math.round(rotation)}°`;
  if (!state.dialogues[selected?.id] && selected) state.dialogues[selected.id] = { speaker: models[selected.modelId]?.[0] || selected.name, text: '' };
  syncDialogueUI(); updateZoom(); syncSelection();
}
function selectedActor() { return engine.getActors().find((actor) => actor.selected); }
async function actorOperation(operation) {
  if (!state.ready || state.exporting) return;
  history?.hold(); state.ready = false; syncActorUI();
  try { await operation(); return true; }
  catch (error) { handleError(error); $('#loading').hidden = true; return false; }
  finally { state.ready = true; syncActorUI(); history?.release(); }
}
$('#actor-list').onclick = (event) => {
  layerManager.clearActive();
  const eye = event.target.closest('[data-visibility]');
  if (eye) { const actor = engine.getActors().find((item) => item.id === eye.dataset.visibility); safely(actorOperation(() => engine.setActorVisible(actor.id, actor.visible === false))); return; }
  const button = event.target.closest('[data-actor]'); if (button) { chooseTarget('model'); safely(actorOperation(() => engine.selectActor(button.dataset.actor))); }
};
$('#add-actor').onclick = () => safely(actorOperation(() => engine.addActor($('#add-model').value)));
$('#actor-remove').onclick = () => { const actor = selectedActor(); if (actor) safely(deleteLayer('actor:' + actor.id)); };
$('#actor-back').onclick = () => layerManager.step('actor:'+selectedActor().id,-1);
$('#actor-front').onclick = () => layerManager.step('actor:'+selectedActor().id,1);

/** Applying a composition never discards existing actors; excess actors remain editable. */
async function applyPosterPreset(preset) {
  if (!state.ready || state.exporting) return false;
  const before = captureDocument();
  const applied = await actorOperation(async () => {
    state.paused = true; await engine.setPaused(true); updatePlaybackUI();
    const cast = ['adv_live2d_anon_002_casual_spring_01','adv_live2d_soyo_004_casual_spring_01','adv_live2d_tomori_001_casual_spring_01'];
    while (engine.getActors().length < preset.actors.length) await engine.addActor(cast[engine.getActors().length]);
    // Templates have a predictable cast, while actor IDs and compatible pose edits survive.
    for (let i = 0; i < preset.actors.length; i++) {
      const actor = engine.getActors()[i]; await engine.selectActor(actor.id);
      if (actor.modelId !== cast[i]) await engine.load(cast[i]);
    }
    const parts = String(preset.ratio).split(':').map(Number);
    state.ratio = parts.length === 2 ? parts[0] / parts[1] : Number(preset.ratio);
    if (preset.filter) { state.filter = preset.filter; state.strength = preset.filterStrength ?? 1; state.filterParamsById[state.filter] = { ...getFilterDefaults(state.filter), ...preset.filterParams }; setControlValue($('#strength'), state.strength * 100); $('#strength-output').textContent = Math.round(state.strength * 100) + '%'; refreshFilterControls(); }
    retainBackground(); backgroundRequest++;
    Object.assign(state.background, preset.background, {image:null,scale:1,x:0,y:0}); delete state.background.assetId; delete state.background.imageData;
    syncBackgroundUpload();
    $$('#background-options button').forEach((button) => button.classList.remove('selected'));
    $$('#ratios button').forEach((button) => button.classList.toggle('selected', Math.abs(Number(button.dataset.ratio) - state.ratio) < .001));
    $('#frame-label').textContent = String(preset.ratio).replace(':', ' : ');
    resize();
    const actors = engine.getActors();
    for (let i = 0; i < actors.length; i++) await engine.setActorVisible(actors[i].id, i < preset.actors.length);
    for (let i = 0; i < preset.actors.length; i++) { await engine.selectActor(actors[i].id); await engine.setCamera(preset.actors[i]); }
    chooseTarget('model'); syncScene(); syncCaption();
  });
  if (!applied) { await restoreDocument(before); return false; }
  setTab('poster'); notify('构图已应用，可继续单独调整每个人物和文字。'); return true;
}
function updatePlaybackUI() {
  $('#pause').textContent = state.paused ? '▶ 播放' : 'Ⅱ 暂停'; $('#pause').setAttribute('aria-pressed', String(state.paused));
}
function togglePause() {
  state.paused = !engine.getPlayback().paused; safely(state.paused ? engine.pause() : engine.play());
  updatePlaybackUI();
  const stats = engine?.getStats(); if (stats) $('#render-stats').textContent = `${stats.width} × ${stats.height} · ${state.paused ? '已暂停' : '正在播放'}`;
}
$('#model-list').addEventListener('click', (event) => { const button = event.target.closest('[data-model]'); if (button) safely(loadModel(button.dataset.model)); });
$('#retry').onclick = () => safely(loadModel(failedModelId || state.model));
$('#load-cancel').onclick = () => engine?.cancelLoad();
$('#load-keep-current').onclick = () => { $('#loading').hidden = true; syncActorUI(); };
$('#pause').onclick = togglePause;
$('#actor-rotation').oninput = (event) => { const value = Number(event.target.value); camera({ rotation: value }); $('#actor-rotation-output').textContent = `${value}°`; };
$('#precise-selection').onclick = () => { state.preciseSelection = !state.preciseSelection; $('#precise-selection').setAttribute('aria-pressed', String(state.preciseSelection)); };

$('#zoom-in').onclick = () => zoomAt(1.2); $('#zoom-out').onclick = () => zoomAt(1 / 1.2);
$('#zoom-value').onclick = resetView; $('#fit').onclick = resetView;
$$('[data-target]').forEach((button) => button.onclick = () => chooseTarget(button.dataset.target));
$('#guides-toggle').onclick = () => { $('#guides').hidden = !$('#guides').hidden; $('#guides-toggle').setAttribute('aria-pressed', String(!$('#guides').hidden)); };

function setTab(tab) { pressed('[data-rail]', 'rail', tab); if (tab === 'filters') safely(prepareFilterPreviews()); pressed('[data-tab]', 'tab', tab); $$('[data-tab-panel]').forEach((panel) => panel.hidden = panel.dataset.tabPanel !== tab); }
$$('[data-tab]').forEach((button) => button.onclick = () => setTab(button.dataset.tab));
function setActorPage(page) {
  app.dataset.actorPage=page; pressed('[data-actor-page]','actorPage',page);
  $$('[data-actor-panel]').forEach(panel=>panel.hidden=panel.dataset.actorPanel!==page);
  $('#model-panel').classList.add('is-open');
}
$$('[data-actor-page]').forEach(button=>button.onclick=()=>setActorPage(button.dataset.actorPage));
$$('[data-rail]').forEach(button => button.onclick = () => {
  if(['model','actions','pose'].includes(button.dataset.rail)) setActorPage(button.dataset.rail);
  else setTab(button.dataset.rail);
});
$$('[data-ratio]').forEach(button => button.style.setProperty('--ratio', button.dataset.ratio));
$$('.variant-switch [data-layout]').forEach((button) => button.onclick = () => {
  app.dataset.layout = button.dataset.layout; app.dataset.ceVariant = button.dataset.layout === 'rails' ? '工具常驻' : '画布优先';
  pressed('.variant-switch [data-layout]', 'layout', button.dataset.layout);
  $('#model-panel').classList.remove('is-open'); $('#inspector').classList.remove('is-open');
  $('#layout-description').textContent = button.dataset.layout === 'rails' ? '角色、动作和画面设置始终可见。' : '让画布占据空间，需要时再唤出工具。';
  requestAnimationFrame(resize);
});
$('#toggle-model-panel').onclick = () => { $('#model-panel').classList.toggle('is-open'); $('#toggle-model-panel').setAttribute('aria-pressed', String($('#model-panel').classList.contains('is-open'))); };
$$('[data-float-tab]').forEach((button) => button.onclick = () => { $('#inspector').classList.add('is-open'); setTab(button.dataset.floatTab); });
$('#hide-panels').onclick = () => { $('#model-panel').classList.remove('is-open'); $('#inspector').classList.remove('is-open'); $('#toggle-model-panel').setAttribute('aria-pressed', 'false'); };
$('#theme').onclick = () => document.body.classList.toggle('dark');
$('#help').onclick = () => $('#help-dialog').showModal();
$$('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }));

$('#ratios').onclick = (event) => { const button = event.target.closest('[data-ratio]'); if (!button) return;
  state.ratio = Number(button.dataset.ratio); $$('#ratios button').forEach((b) => b.classList.toggle('selected', b === button));
  $('#frame-label').textContent = button.textContent; resize();
};
const backgrounds = {
  paper: { name: '暖纸白', type: 'color', color: '#f6f0ec' }, blush: { name: '晨间粉', type: 'gradient', color: '#f4d2d9', color2: '#e7ddc9' },
  midnight: { name: '暮蓝', type: 'gradient', color: '#283448', color2: '#49536a' }, transparent: { name: '透明', type: 'transparent' },
  mint: { name: '薄荷', type: 'gradient', color: '#dbf3e9', color2: '#b1d2d1' }, lilac: { name: '淡紫', type: 'gradient', color: '#efdef9', color2: '#c9b9e7' },
  sky: { name: '天光', type: 'gradient', color: '#d4eaf8', color2: '#fdf5e4' }, sunset: { name: '日落', type: 'gradient', color: '#f8d79e', color2: '#e9a4ab' },
  peach: { name: '杏桃', type: 'gradient', color: '#f9e2c9', color2: '#f6c5b7' }, matcha: { name: '抹茶', type: 'gradient', color: '#dde5c5', color2: '#9db0a0' },
  ink: { name: '墨色', type: 'gradient', color: '#181b26', color2: '#434558' }, white: { name: '纯白', type: 'color', color: '#ffffff' },
};
$('#background-options').replaceChildren(...Object.entries(backgrounds).map(([id, value]) => {
  const button = document.createElement('button'); button.dataset.background = id; button.setAttribute('aria-label', value.name); button.title = value.name;
  const swatch = document.createElement('i'); if (value.type === 'transparent') swatch.className = 'checker'; else swatch.style.background = value.type === 'gradient' ? `linear-gradient(145deg,${value.color},${value.color2})` : value.color;
  const name = document.createElement('span'); name.textContent = value.name; button.append(swatch, name); return button;
}));
$('#background-options').onclick = (event) => { const button = event.target.closest('[data-background]'); if (!button) return;
  retainBackground(); backgroundRequest++; Object.assign(state.background, backgrounds[button.dataset.background], {image:null}); delete state.background.assetId; delete state.background.imageData;
  syncBackgroundUpload(); layerManager.render();
  $$('#background-options button').forEach((b) => b.classList.toggle('selected', b === button)); chooseTarget('model'); syncScene();
};
$('#reset-background').onclick = () => { Object.assign(state.background, { scale: 1, x: 0, y: 0 }); syncScene(); updateZoom(); };
$('#bg-zoom').oninput = (event) => { state.background.scale = Number(event.target.value) / 100; syncScene(); updateZoom(); };
$('#edit-background').onclick = () => { chooseTarget('background'); $('#background-popover').hidePopover(); };
async function useBackground(file) {
  if (state.exporting || restoring || history?.busy) return;
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { notify('请选择 PNG、JPEG 或 WebP 图片。'); return; }
  if (file.size > 20 * 1024 * 1024) { notify('支持 20 MB 以内的背景图片。'); return; }
  if (state.backgroundLibrary.length >= BACKGROUND_LIMIT) { notify('素材库最多保留12张背景。请先移除一张；移除仍可撤销。'); return; }
  // Legacy entries have no size metadata. Reserve their old 20MB limit conservatively.
  const bytes = state.backgroundLibrary.reduce((sum, item) => sum + (Number.isFinite(item.size) ? item.size : 20 * 1024 * 1024), 0);
  if (bytes + file.size > BACKGROUND_BYTE_LIMIT) { notify('背景素材库上限为100 MB，请先移除不再使用的背景。'); return; }
  const request = ++backgroundRequest; history?.hold();
  const url = URL.createObjectURL(file), image = new Image(); image.src = url;
  let createdAssetId, published = false;
  try {
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 24e6) throw new Error('请使用 2400 万像素以内的背景图片。');
    if (request !== backgroundRequest) { URL.revokeObjectURL(url); return; }
    const thumbnail = await backgroundThumbnail(image);
    if (request !== backgroundRequest) return;
    const assetId = crypto.randomUUID(); createdAssetId = assetId; await storage.write('asset:' + assetId, file);
    await storage.write('thumbnail:' + assetId, thumbnail);
    if (request !== backgroundRequest) return;
    retainBackground();
    const previous = activeImageURL; activeImageURL = url; cacheBackground(assetId, image);
    Object.assign(state.background, { type: 'image', image, assetId, name: file.name, scale: 1, x: 0, y: 0 }); delete state.background.imageData;
    state.backgroundLibrary = mergeBackgrounds(state.backgroundLibrary, [{assetId, name:file.name, size:file.size, width:image.naturalWidth, height:image.naturalHeight}]);
    published = true;
    if (previous) URL.revokeObjectURL(previous);
    retainBackground(); syncBackgroundUpload(); layerManager.render();
    $$('#background-options button').forEach((button) => button.classList.remove('selected'));
    syncScene(); chooseTarget('background'); notify('背景已加入。现在可以拖动与滚轮调整它。');
  } catch (error) { URL.revokeObjectURL(url); handleError(error); }
  finally {
    if (!published) { URL.revokeObjectURL(url); if (createdAssetId) await storage.remove('asset:' + createdAssetId).catch(() => {}); }
    history?.release();
  }
}

// Capacity inspection reads only metadata; large uploaded Blobs stay out of memory.
$('#background-usage').onclick = async () => {
  const button = $('#background-usage'); button.disabled = true;
  try {
    const usage = await assetMaintenance.getUsage();
    $('#background-usage-output').textContent = `${usage.count} 张素材 · ${(usage.knownBytes / 1048576).toFixed(1)} MB` +
      (usage.unknownSizeCount ? `，另有 ${usage.unknownSizeCount} 张旧素材大小未统计` : '') + (usage.complete ? '' : '（部分统计）');
  } catch { $('#background-usage-output').textContent = '暂时无法读取本地容量，作品仍保留。'; }
  finally { button.disabled = false; }
};

$('#background-file').onchange = (event) => { safely(useBackground(event.target.files[0])); event.target.value = ''; };
$('#use-uploaded-background').onclick = () => safely(useSavedBackground(state.uploadedBackground?.assetId));
async function useSavedBackground(assetId) {
  if (!assetId || state.exporting || restoring || history?.busy) return;
  retainBackground();
  const item = state.backgroundLibrary.find(item => item.assetId === assetId); if (!item) return;
  const retained = { ...item }, request = ++backgroundRequest; history?.hold();
  try {
    const image = await readBackgroundImage(retained.assetId);
    if (request !== backgroundRequest) return;
    retainBackground(); Object.assign(state.background, retained, { type: 'image', image }); retainBackground();
    $$('#background-options button').forEach(b => b.classList.remove('selected'));
    syncBackgroundUpload(); layerManager.render(); syncScene(); chooseTarget('background');
  } finally { history?.release(); }
}
function removeSavedBackground(assetId) {
  if (state.exporting || restoring || history?.held || history?.busy || state.background.type !== 'image' || state.background.assetId !== assetId) return;
  history?.begin(); backgroundRequest++;
  state.backgroundLibrary = state.backgroundLibrary.filter(item => item.assetId !== assetId);
  if (state.uploadedBackground?.assetId === assetId) state.uploadedBackground = null;
  if (activeImageURL && state.background.image?.src === activeImageURL) { URL.revokeObjectURL(activeImageURL); activeImageURL = null; }
  state.background = {type:'transparent',image:null,scale:1,x:0,y:0};
  // Keep source bytes for undo/presets; the shared reachability collector reclaims them later.
  backgroundImages.delete(assetId); syncBackgroundUpload(); layerManager.render(); chooseTarget('none'); syncScene(); history?.commit();
  notify('背景已从素材库移除；可以撤销。');
}
for (const target of [$('#upload-drop'), frame]) {
  target.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
  target.addEventListener('drop', (event) => { event.preventDefault(); safely(useBackground(event.dataTransfer.files[0])); });
}
$$('[data-quality]').forEach((button) => button.onclick = () => { state.quality = Number(button.dataset.quality); pressed('[data-quality]', 'quality', state.quality); $('#quality-summary').textContent = state.quality === 2 ? '精细 · 2×' : '轻量 · 1×'; resize(); });
function refreshFilterControls() {
  const definition = getFilterDefinition(state.filter), values = state.filterParamsById[state.filter] ||= getFilterDefaults(state.filter);
  $$('#filters button').forEach(button => button.classList.toggle('selected', button.dataset.filter === state.filter));
  $('#filter-description').textContent = definition.description; $('#filter-summary').textContent = definition.name;
  $('#filter-panel-title').textContent = definition.name; $('#filter-specific-controls').replaceChildren(...definition.controls.map(control => {
    const label = document.createElement('label'); label.className = control.type === 'color' ? 'field' : 'range-field'; label.textContent = control.label;
    const output = document.createElement('output'); output.textContent = String(values[control.key]); const input = document.createElement('input'); input.type = control.type;
    if (control.type === 'range') { input.min = control.min; input.max = control.max; input.step = control.step; }
    setControlValue(input, values[control.key]); input.dataset.filterParameter = control.key; input.setAttribute('aria-label', control.label);
    input.oninput = () => { values[control.key] = control.type === 'color' ? input.value : Number(input.value); output.textContent = input.value; syncScene(); };
    label.append(output, input); return label;
  }));
  refreshRanges($('#filter-popover')); lookPanel?.refresh();
}
$('#filters').replaceChildren(...FILTER_DEFINITIONS.map(definition => {
  const button = document.createElement('button'); button.dataset.filter = definition.id;
  const preview = document.createElement('i'); preview.className = 'filter-sample f-' + definition.id;
  const image = document.createElement('img'); image.alt = ''; image.src = './thumbs/anon.webp'; preview.append(image);
  const name = document.createElement('span'); name.textContent = definition.name; button.append(preview, name); return button;
}));
$('#filters').onclick = event => { const button = event.target.closest('[data-filter]'); if (!button) return;
  state.filter = button.dataset.filter; state.lookRecipe=null; refreshFilterControls(); syncScene();
};
for (const name of ['strength', 'exposure', 'saturation']) $('#' + name).oninput = event => {
  state[name] = Number(event.target.value) / 100; $('#' + name + '-output').textContent = name === 'exposure' ? state[name].toFixed(2) : `${event.target.value}%`; syncScene();
};
$('#grade-background').onchange = event => { state.gradeBackground = event.target.checked; syncScene(); };
$('#reset-filter').onclick = () => { state.filterParamsById[state.filter] = getFilterDefaults(state.filter); Object.assign(state,{strength:.7,exposure:0,saturation:1});
  for (const [id,value] of [['strength',70],['exposure',0],['saturation',100]]) { setControlValue($('#' + id), value); $('#' + id + '-output').textContent = id === 'exposure' ? '0.00' : value + '%'; }
  refreshFilterControls(); syncScene();
};
$('#compare').addEventListener('pointerdown', (event) => { $('#compare').setPointerCapture(event.pointerId); comparing = true; syncScene(); });
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('#compare').addEventListener(name, () => { if (comparing) { comparing = false; syncScene(); } });
$('#compare').addEventListener('keydown', (event) => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); comparing = true; syncScene(); } });
$('#compare').addEventListener('keyup', () => { comparing = false; syncScene(); });
$('#compare').addEventListener('blur', () => { comparing = false; syncScene(); });
function syncDialogueUI() {
  if (!engine) return;
  const actors = engine.getActors();
  if (!actors.some(a => a.id === dialogueActorId)) dialogueActorId = actors.find(a => a.selected)?.id;
  $('#dialogue-actors').replaceChildren(...actors.map(actor => {
    const button = document.createElement('button'); button.textContent = models[actor.modelId]?.[0] || actor.name;
    button.setAttribute('aria-pressed', String(actor.id === dialogueActorId));
    button.onclick = () => { dialogueActorId = actor.id; syncDialogueUI(); }; return button;
  }));
  for (const id of ['speaker','dialogue','clear-dialogue']) $('#' + id).disabled = !actors.length;
  if (!actors.length) { $('#speaker').value = ''; $('#dialogue').value = ''; return; }
  const dialogue = state.dialogues[dialogueActorId] ||= { speaker: actors.find(a => a.id === dialogueActorId)?.name || '', text: '' };
  $('#speaker').value = dialogue.speaker; $('#dialogue').value = dialogue.text;
}
$('#speaker').oninput = (event) => { state.dialogues[dialogueActorId].speaker = event.target.value; syncCaption(); };
$('#dialogue').oninput = (event) => { state.dialogues[dialogueActorId].text = event.target.value; syncCaption(); };
$('#text-size').oninput = (event) => { state.textSize = Number(event.target.value) / 100; $('#text-size-output').textContent = `${event.target.value}%`; syncCaption(); };
$('#caption-export').onchange = (event) => { state.captionExport = event.target.checked; };
$('#clear-dialogue').onclick = () => { state.dialogues[dialogueActorId].text = ''; $('#dialogue').value = ''; syncCaption(); };

/** Render all speakers inside the canvas safe area; preview and export share this layout. */
function paintCaption(context, width, height) {
  const actors = engine?.getActors() || [];
  const linesToDraw = actors.filter(a => a.visible !== false).map(a => state.dialogues[a.id]).filter(d => d?.text?.trim());
  if (!linesToDraw.length) return;
  const boxWidth = width * .86, x = width * .07, fontSize = width * .022 * state.textSize, paddingX = width * .025;
  let bottom = height * .94;
  for (const dialogue of [...linesToDraw].reverse()) {
    context.save(); context.font = `${fontSize}px "寒蝉全圆体", sans-serif`;
    const lines = []; let line = '';
    for (const char of dialogue.text) {
      if (char === '\n' || context.measureText(line + char).width > boxWidth - paddingX * 2) { lines.push(line); line = char === '\n' ? '' : char; } else line += char;
    }
    lines.push(line);
    const maxLines = Math.max(1, Math.floor(height * .65 / linesToDraw.length / (fontSize * 1.6)) - 2);
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] += '…'; }
    const lineHeight = fontSize * 1.6, paddingY = fontSize * .8, boxHeight = paddingY * 2 + lineHeight * (lines.length + (dialogue.speaker ? 1 : 0));
    const y = bottom - boxHeight;
    context.fillStyle = 'rgba(29,27,36,.84)'; context.beginPath(); context.roundRect(x, y, boxWidth, boxHeight, width * .012); context.fill();
    context.strokeStyle = '#ffffff55'; context.lineWidth = width / 800; context.stroke(); context.textBaseline = 'top';
    let textY = y + paddingY;
    if (dialogue.speaker) { context.font = `bold ${fontSize * .86}px "寒蝉全圆体", sans-serif`; context.fillStyle = '#ffb7c9'; context.fillText(dialogue.speaker, x + paddingX, textY); textY += lineHeight; }
    context.font = `${fontSize}px "寒蝉全圆体", sans-serif`; context.fillStyle = '#fff';
    lines.forEach((text, index) => context.fillText(text, x + paddingX, textY + index * lineHeight));
    context.restore(); bottom = y - height * .012;
  }
}
for (const effect of EFFECT_OPTIONS) {
  const button = document.createElement('button'); button.dataset.effect = effect.id; button.setAttribute('aria-pressed', String(state.effects.type === effect.id));
  const preview = document.createElement('i'); preview.className = 'effect-sample effect-' + effect.id;
  const title = document.createElement('span'); title.textContent = effect.name; button.append(preview, title); button.title = effect.description;
  $('.effect-options').append(button);
}
$('#effect-play').onclick = () => { state.effects.animate = !state.effects.animate; syncEffects(); history?.schedule(); };
function syncEffectButtons(){const enabled=state.effects.enabled??[state.effects.type];for(const b of $$('[data-effect]')){b.setAttribute('aria-pressed',String(b.dataset.effect==='none'? !enabled.filter(x=>x!=='none').length:enabled.includes(b.dataset.effect)));b.classList.toggle('editing-effect',b.dataset.effect===state.effects.type);}}
for (const button of $$('[data-effect]')) button.onclick = () => {
 const id=button.dataset.effect, enabled=new Set(state.effects.enabled??[state.effects.type]);enabled.delete('none');
 if(id==='none')enabled.clear();else if(enabled.has(id))enabled.delete(id);else enabled.add(id);
 state.effects.enabled=[...enabled]; state.effects.type=enabled.has(id)?id:([...enabled].at(-1)||'none');
 state.effects.colors??={};state.effects.color=state.effects.colors[state.effects.type]||EFFECT_OPTIONS.find(e=>e.id===state.effects.type)?.color||state.effects.color;
 $('#effect-color').value=state.effects.color;syncEffectButtons();refreshEffectControls();syncEffects();lookPanel?.refresh();
};
for (const [id, key, transform] of [['density', 'count', v => Math.round(v * 1.6)], ['speed', 'speed', v => v / 100 * 4], ['opacity', 'strength', v => v / 100]]) {
  $('#effect-' + id).oninput = event => { state.effects[key] = transform(Number(event.target.value)); $('#effect-' + id + '-output').textContent = event.target.value + '%'; syncEffects(); };
}
/** Build detail controls only on selection/restore, never during a captured range drag. */
function refreshEffectControls() {
 const definition=EFFECT_OPTIONS.find(e=>e.id===state.effects.type), values=effectDetails(state.effects);
 const select=$('#effect-edit-target');if(select){select.replaceChildren(...(state.effects.enabled??[state.effects.type]).filter(id=>id!=='none').map(id=>new Option(EFFECT_OPTIONS.find(e=>e.id===id)?.name,id)));select.value=state.effects.type;select.disabled=!select.options.length;}
 $('#effects-popover h3').textContent=(definition?.name||'动效')+' · 细节';
 const gpu=['crt','glitch','neon'].includes(state.effects.type);$('#effect-color').closest('label').hidden=gpu&&state.effects.type!=='neon';
 $('#effect-density').closest('label').hidden=['none','leak','neon'].includes(state.effects.type);
 $('#effect-specific-controls').replaceChildren(...(EFFECT_CONTROLS[state.effects.type]||[]).map(control=>{
  const label=document.createElement('label');label.className='range-field';label.textContent=control.label;label.title=control.help;
  const output=document.createElement('output'),input=document.createElement('input');input.type='range';input.min=control.min;input.max=control.max;input.step=control.step;setControlValue(input,values[control.key]);input.dataset.effectParameter=control.key;input.setAttribute('aria-label',control.label);output.textContent=Number(input.value).toFixed(2);
  input.oninput=()=>{state.effects.details??={};state.effects.details[state.effects.type]??={};state.effects.details[state.effects.type][control.key]=Number(input.value);output.textContent=Number(input.value).toFixed(2);syncEffects();};
  label.append(output,input);const hint=document.createElement('small');hint.className='effect-help';hint.textContent=control.help;label.append(hint);return label;
 })); refreshRanges($('#effects-popover'));
}
$('#reset-effect').onclick=()=>{state.effects.details??={};delete state.effects.details[state.effects.type];refreshEffectControls();syncEffects();};
$('#effect-color').oninput = event => { state.effects.color = event.target.value;state.effects.colors??={};state.effects.colors[state.effects.type]=state.effects.color; syncEffects(); };

lookPanel=createLookPanel({state,onChange:()=>{compositor.setScene({look:state.look});if(state.ready)compositor.drawCached(effectTime);},onRanges:refreshRanges,onRecipe(recipe){
 state.lookRecipe=recipe.id;state.look=normalizeLook(recipe.look);state.filter=recipe.filter;state.filterParamsById[state.filter]={...getFilterDefaults(state.filter),...recipe.params};state.strength=recipe.strength;state.exposure=0;state.saturation=1;
 state.effects=normalizeEffects({...DEFAULT_EFFECTS,enabled:[...recipe.effects],type:recipe.effects[0]||'none',count:64,speed:.9,strength:.85,color:EFFECT_OPTIONS.find(e=>e.id===recipe.effects[0])?.color||'#eda5bc',...recipe.effectSettings});
 syncAllControls();
}});
$('#effect-edit-target').onchange=e=>{state.effects.type=e.target.value;state.effects.color=state.effects.colors?.[state.effects.type]||EFFECT_OPTIONS.find(e=>e.id===state.effects.type)?.color||'#eda5bc';$('#effect-color').value=state.effects.color;syncEffectButtons();refreshEffectControls();syncEffects();};
installWorkspaceLayout(app);

/** UI selection follows visible pixels, with front lettering above actors and back lettering below. */
async function pickObject(event) {
  const box = frame.getBoundingClientRect(), nx = (event.clientX - box.left) / box.width, ny = (event.clientY - box.top) / box.height;
  for (const key of layerManager.order().reverse()) {
    if (key.startsWith('text:')) { if(posterEditor.selectAt(nx,ny,box.width,box.height,null,key.slice(5))){chooseTarget('text');return;} }
    else { const id=engine.hitTest(nx,ny,key.slice(6)); if(id){posterEditor.clearSelection();await engine.selectActor(id);chooseTarget('model');syncActorUI();return;} }
  }
  posterEditor.clearSelection(); chooseTarget('none'); await engine.pause(); state.paused = true; updatePlaybackUI();
}
function syncSelection() {
  $('#target-badge').textContent = state.target === 'text' ? 'T 正在编辑文字' : '✥ 正在移动背景';
  const canvas = $('#selection-outline'); if (!canvas || !engine) return;
  const w = frame.clientWidth, h = frame.clientHeight;
  canvas.width = Math.max(1, Math.round(w * 2)); canvas.height = Math.max(1, Math.round(h * 2));
  const context = canvas.getContext('2d'); context.scale(2, 2);
  if (state.target !== 'text') return;
  const bounds = posterEditor.getSelectionBounds(w, h); if (!bounds) return;
  context.strokeStyle = '#dc5878'; context.lineWidth = 1.2; context.setLineDash([4, 3]);
  context.beginPath(); bounds.corners.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)); context.closePath(); context.stroke();
  context.setLineDash([]); for (const p of bounds.corners) { context.fillStyle = '#fff'; context.fillRect(p.x - 5, p.y - 5, 10, 10); context.strokeRect(p.x - 5, p.y - 5, 10, 10); }
}
function captureDocument() {
  retainBackground();
  const { ready, exporting, ...saved } = state;
  return { version: 2, savedAt: new Date().toISOString(), scene: exportDialogSession?.scene ?? engine.serialize(),
    state: { ...structuredClone({ ...saved, paused: exportDialogSession?.paused ?? saved.paused, background: { ...state.background, image: null, imageData: undefined } }) },
    poster: posterEditor.getSnapshot(), actorPage: app.dataset.actorPage || 'model', layout: app.dataset.layout, tab: $('[data-tab][aria-pressed=true]')?.dataset.tab,
    dialogueActorId, dark: document.body.classList.contains('dark') };
}
function syncAllControls() {
  syncBackgroundUpload();
  pressed('[data-target]', 'target', state.target); frame.dataset.target = state.target;
  $('#actions-heading').textContent = state.labelLocale === 'zh' ? '动作与表情' : 'Motion & expression';
  pressed('[data-quality]', 'quality', state.quality); pressed('[data-effect]', 'effect', state.effects.type);
  $('#quality-summary').textContent = state.quality === 2 ? '精细 · 2×' : '轻量 · 1×';
  $$('#background-options [data-background]').forEach(button => {
    const preset = backgrounds[button.dataset.background];
    button.classList.toggle('selected', !!preset && preset.type === state.background.type && (preset.type === 'transparent' || (preset.color === state.background.color && (preset.type !== 'gradient' || preset.color2 === state.background.color2))));
  });
  $('#precise-selection').setAttribute('aria-pressed', String(state.preciseSelection));
  for (const key of ['strength', 'exposure', 'saturation']) { setControlValue($('#' + key), state[key] * 100); $('#' + key + '-output').textContent = key === 'exposure' ? state[key].toFixed(2) : Math.round(state[key] * 100) + '%'; }
  $('#grade-background').checked = state.gradeBackground; $('#caption-export').checked = state.captionExport;
  setControlValue($('#text-size'), state.textSize * 100); $('#text-size-output').textContent = Math.round(state.textSize * 100) + '%';
  setControlValue($('#effect-density'), state.effects.count / 1.6); $('#effect-density-output').textContent = Math.round(state.effects.count / 1.6) + '%';
  setControlValue($('#effect-speed'), state.effects.speed / 4 * 100); $('#effect-speed-output').textContent = Math.round(state.effects.speed / 4 * 100) + '%';
  setControlValue($('#effect-opacity'), state.effects.strength * 100); $('#effect-opacity-output').textContent = Math.round(state.effects.strength * 100) + '%';
  $('#effect-color').value = state.effects.color || '#dc7d9a'; syncEffectButtons(); refreshEffectControls(); syncEffects();
  $$('#filters button').forEach(button => button.classList.toggle('selected', button.dataset.filter === state.filter));
  refreshFilterControls();
  $$('#ratios button').forEach(button => button.classList.toggle('selected', Math.abs(Number(button.dataset.ratio) - state.ratio) < .001));
  $('#frame-label').textContent = $('#ratios .selected')?.textContent || `${state.ratio.toFixed(2)} : 1`;
  syncActorUI(); updatePlaybackUI(); syncScene(); resize(); actionControls?.setLocale(state.labelLocale); posterEditor.refreshLocale?.(); refreshRanges();
}
/** Restore atomically while retaining loaded actors, including an older emergency recovery snapshot. */
async function restoreDocument(documentState, { compositionOnly = false, rollbackOnFailure = true } = {}) {
  if (state.exporting) throw new Error('导出完成后再恢复作品。');
  backgroundRequest++; const previousReady = state.ready, before = rollbackOnFailure ? captureDocument() : null;
  restoring = true; state.ready = false; let restored = false;
  try {
    const saved = documentState.state || {}, currentActors = engine.getActors();
    const background = { ...saved.background, image: null };
    // Large images are immutable assets. History stores IDs instead of copying image bytes.
    if (background.imageData && !background.assetId) {
      background.assetId = crypto.randomUUID(); const blob = await (await fetch(background.imageData)).blob();
      await storage.write('asset:' + background.assetId, blob); delete background.imageData;
    }
    if (background.assetId) background.image = await readBackgroundImage(background.assetId);
    await ensurePosterFonts(documentState.poster?.layers || documentState.textLayers || []);
    if (!compositionOnly) await engine.restore(documentState.scene || { actors: documentState.actors, paused: saved.paused });
    else {
      const sourceActors = documentState.scene?.actors || [];
      for (let i = 0; i < currentActors.length; i++) if (sourceActors[i]) { await engine.selectActor(currentActors[i].id); await engine.setCamera(sourceActors[i].camera); }
    }
    const oldDialogues = state.dialogues, retainedUpload = state.uploadedBackground, retainedLibrary = state.backgroundLibrary;
    Object.assign(state, saved, { look:normalizeLook(saved.look), lookRecipe:saved.lookRecipe??null, layerOrder: compositionOnly ? undefined : saved.layerOrder, background, effects: { ...DEFAULT_EFFECTS, ...saved.effects }, filterParamsById: saved.filterParamsById || {}, ready: true, exporting: false });
    state.uploadedBackground = compositionOnly && background.type !== 'image' ? retainedUpload : saved.uploadedBackground ? { ...saved.uploadedBackground } : null;
    state.backgroundLibrary = mergeBackgrounds(compositionOnly ? retainedLibrary : [], saved.backgroundLibrary, [state.uploadedBackground]);
    retainBackground();
    state.dialogues = { ...(saved.dialogues || {}) };
    if (compositionOnly) {
      state.dialogues = { ...oldDialogues };
      const sourceActors = documentState.scene?.actors || [];
      currentActors.forEach((actor, index) => { const dialogue = saved.dialogues?.[sourceActors[index]?.id]; if (dialogue) state.dialogues[actor.id] = { ...dialogue, speaker: models[actor.modelId]?.[0] || actor.name }; });
    } else if (!saved.dialogues && saved.dialogue) {
      const actor = engine.getActors().find(a => a.selected); if (actor) state.dialogues[actor.id] = { speaker: saved.speaker || actor.name, text: saved.dialogue };
    }
    await posterEditor.setSnapshot(documentState.poster || { layers: documentState.textLayers || [], selectedId: documentState.selectedText }, { notify: false });
    layerManager.clearActive();
    dialogueActorId = documentState.dialogueActorId;
    if (!compositionOnly) {
      app.dataset.layout = documentState.layout || 'rails'; app.dataset.ceVariant = app.dataset.layout === 'rails' ? '工具常驻' : '画布优先';
      pressed('.variant-switch [data-layout]', 'layout', app.dataset.layout); document.body.classList.toggle('dark', !!documentState.dark);
    }
    setTab(documentState.tab || 'scene'); setActorPage(documentState.actorPage || 'model'); syncAllControls();
    if (Number.isFinite(documentState.inspectorScroll)) $('.inspector-scroll').scrollTop = documentState.inspectorScroll;
    restored = true;
  } catch (error) {
    if (before) { try { await restoreDocument(before, { rollbackOnFailure: false }); } catch (rollbackError) { console.error('草稿回滚失败', rollbackError); } }
    throw error;
  } finally { state.ready = restored || previousReady || !!engine.getActors().length; restoring = false; }
}
async function saveDraft(snapshot) {
  if (restoring || state.exporting || !state.ready) return;
  $('#draft-status').textContent = '正在保存…';
  try { await storage.write('draft', { ...snapshot, savedAt: new Date().toISOString() }); $('#draft-status').textContent = '草稿已保存在此浏览器'; assetMaintenance?.schedule(); }
  catch (error) { $('#draft-status').textContent = '本地空间不足，草稿未保存'; console.warn(error); }
}
function initializeHistory() {
  history = createHistory({ capture: () => { const snapshot = captureDocument(); delete snapshot.savedAt; return snapshot; }, restore: restoreDocument,
    onChange: ({ undo, redo, busy, held }) => {
      $('#undo').disabled = busy || held || !undo; $('#redo').disabled = busy || held || !redo;
      $('#export-open').disabled = busy || held || state.exporting; $('#export-confirm').disabled = busy || held || state.exporting;
    }, onSave: saveDraft, onError: handleError });
  // Only navigation buttons are excluded. The app also stores data-actor-page;
  // matching that container would silently exclude every edit after a restore.
  const ignores = '#undo,#redo,#export-open,#export-dialog,#presets-open,#help,#theme,#pause,button[data-tab],button[data-float-tab],.variant-switch,#actions-editor,#pose-editor,button[data-actor-page],#timeline-slot,#keyframe-slot,button[data-rail],[data-popup],[data-close-popup],.poster-detail-back,button[data-text-tab],button[data-text-page],#effect-edit-target,[data-toggle-panel],.panel-resizer,.look-back,.effect-detail-launcher,.help-dot,summary,#compare,#precise-selection,#guides-toggle';
  let rangeGesture = null;
  document.addEventListener('pointerdown', event => {
    if (!isEditorEvent(event, app) || !state.ready || restoring || event.target.closest(ignores) || !event.target.closest('button,input,textarea,select,.stage-frame')) return;
    // A new pointer gesture ends the previous edit even when it falls within the typing debounce.
    // Otherwise a quick preset click and slider drag become one surprising undo step.
    history.commit(); history.begin();
    if (event.target.matches('input[type=range]') && rangeGesture === null) { rangeGesture = event.pointerId; history.hold(); }
  }, true);
  for (const name of ['pointerup', 'pointercancel']) document.addEventListener(name, event => {
    if (event.pointerId !== rangeGesture) return;
    rangeGesture = null; history.release();
  });
  window.addEventListener('blur', () => { if (rangeGesture !== null) { rangeGesture = null; history.release(); } });
  document.addEventListener('keydown', event => {
    if (!isEditorEvent(event, app)) return;
    const typing = isTextEntry(event);
    if ((event.metaKey || event.ctrlKey) && (event.code === 'KeyZ' || event.key.toLowerCase() === 'z') && !isNativeUndoEntry(event)) { event.preventDefault(); if (state.exporting || restoring || !state.ready) return; safely(history.travel(event.shiftKey ? 'redo' : 'undo')); return; }
    if (!restoring && !event.target.closest(ignores) && event.target.matches('input,textarea,select')) history.begin();
  }, true);
  for (const name of ['input', 'change', 'pointerup', 'click', 'wheel']) document.addEventListener(name, event => {
    if (!isEditorEvent(event, app) || !state.ready || restoring || state.exporting || event.target.closest(ignores)) return;
    history.schedule();
  }, { passive: true });
  $('#undo').onclick = () => { if (!state.exporting && !restoring && state.ready) safely(history.travel('undo')); }; $('#redo').onclick = () => { if (!state.exporting && !restoring && state.ready) safely(history.travel('redo')); };
  // IndexedDB transactions cannot be trusted during unload; keep a small emergency copy as well.
  window.addEventListener('pagehide', () => { if (state.exporting || restoring || !state.ready) return; try { const snapshot = captureDocument(); if ((snapshot.scene.actors.length || snapshot.scene.emptyScene) && !snapshot.state.background.imageData) localStorage.setItem('clelele-live2d-prototype-draft-v2', JSON.stringify(snapshot)); } catch {} });
}
async function renderPresetList() {
  presets = await storage.read('presets') || [];
  const names = { composition: '构图', pose: '姿态', project: '完整作品' };
  $('#saved-presets').replaceChildren(...presets.map(preset => {
    const row = document.createElement('div'); row.className = 'saved-preset';
    const use = document.createElement('button'); const title = document.createElement('strong'), meta = document.createElement('small');
    title.textContent = preset.name; meta.textContent = `${names[preset.kind]} · ${new Date(preset.createdAt).toLocaleDateString()}`; use.append(title, meta);
    use.onclick = async () => {
      if (preset.kind === 'pose' && !selectedActor()) { notify('先添加一位人物，再应用姿态预设。'); return; }
      history.begin();
      try {
        if (preset.kind === 'pose') { const actor = selectedActor(); await engine.restore({ actors: [{ ...actor, state: preset.pose }], activeId: actor.id, paused: true }, { keepOthers: true }); syncActorUI(); }
        else await restoreDocument(preset.document, { compositionOnly: preset.kind === 'composition' });
        history.commit(); $('#presets-dialog').close(); notify('预设已应用；可以撤销。');
      } catch (error) { handleError(error); }
    };
    const remove = document.createElement('button'); remove.textContent = '删除'; remove.setAttribute('aria-label', `删除预设：${preset.name}`);
    remove.onclick = async () => { presets = presets.filter(p => p.id !== preset.id); await storage.write('presets', presets); await renderPresetList(); };
    row.append(use, remove); return row;
  }));
  if (!presets.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = '还没有保存的预设。先调好画面，把喜欢的设置留在这里。'; $('#saved-presets').append(empty); }
}
$('#presets-open').onclick = () => { if (state.exporting || restoring) return; safely(renderPresetList()); $('#presets-dialog').showModal(); };
$('#preset-save').onclick = async () => {
  if (!state.ready || state.exporting) return;
  const name = $('#preset-name').value.trim(); if (!name) { $('#preset-name').focus(); notify('先给预设起个名字。'); return; }
  const documentState = captureDocument(), kind = $('#preset-kind').value;
  if (kind === 'pose' && !selectedActor()) { notify('先添加一位人物，再保存姿态预设。'); return; }
  const preset = { id: crypto.randomUUID(), name, kind, createdAt: Date.now() };
  if (kind === 'pose') preset.pose = documentState.scene.actors.find(a => a.id === documentState.scene.activeId)?.state;
  else preset.document = documentState;
  try { presets.push(preset); await storage.write('presets', presets); await renderPresetList(); $('#preset-name').value = ''; notify('预设已保存。'); }
  catch (error) { handleError(error); }
};

// Output choices are independent of canvas selection; choosing text must not decide
// which actor moves. Retain these choices across format switches and dialog reopenings.
let exportActorIds;
function renderExportActors() {
  const actors = engine.getActors();
  exportActorIds ??= new Set(actors.filter(actor => actor.visible).map(actor => actor.id));
  const root = $('#export-actors'); root.replaceChildren();
  for (const actor of actors) {
    const label = document.createElement('label'); label.className = 'export-actor';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = actor.id;
    input.checked = actor.visible && exportActorIds.has(actor.id); input.disabled = !actor.visible;
    input.onchange = () => { if (input.checked) exportActorIds.add(actor.id); else exportActorIds.delete(actor.id); clearExportPreview(); describeExport(); };
    const copy = document.createElement('span'); copy.textContent = models[actor.modelId]?.[0] || actor.name;
    const detail = document.createElement('small'); detail.textContent = `${models[actor.modelId]?.[1] || ''}${actor.visible ? '' : ' · 已隐藏，不参与导出'}`;
    copy.append(detail); label.append(input, copy); root.append(label);
  }
}
$('#export-select-all').onclick = () => { exportActorIds = new Set(engine.getActors().filter(a => a.visible).map(a => a.id)); clearExportPreview(); renderExportActors(); describeExport(); };
function exportSettings() {
  const format = $('#export-format').value, animation = ['gif', 'mp4'].includes(format), quality = Number($('#export-quality').value);
  const duration = Math.max(.2, Math.min(format === 'mp4' ? 12 : 8, Number($('#export-duration').value) || 3));
  const fps = Number($('#export-fps').value), factor = quality === 1 ? 1 : quality > .8 ? .75 : .5;
  let longEdge = Math.round(Number($('#export-size').value) * factor);
  if (animation) {
    const frames = Math.ceil(duration * fps), ratioFactor = Math.min(state.ratio, 1 / state.ratio);
    const pixels = format === 'gif' ? Math.min(1048576, 96000000 / frames) : Math.min(2097152, 180000000 / frames);
    longEdge = Math.max(16, Math.floor(Math.min(longEdge, format === 'gif' ? 1280 : 2048, Math.sqrt(pixels / ratioFactor))) - 2);
  }
  const mode = $('#export-area').value;
  // Preview dimensions obey the same animation budget while preserving the exact composition.
  const previewScale = animation ? Math.min(1, longEdge / Math.max(frame.clientWidth, frame.clientHeight)) : 1;
  const dimensions = getExportDimensions({ mode, format, ratio: state.ratio, longEdge,
    previewWidth: frame.clientWidth * previewScale, previewHeight: frame.clientHeight * previewScale });
  const animationActorIds = engine.getActors().filter(a => a.visible && (!exportActorIds || exportActorIds.has(a.id))).map(a => a.id);
  return { format, animation, quality, duration, fps, animationActorIds, ...dimensions };
}
function describeExport() {
  // Clear completion chrome even when dimensions are invalid for the next format.
  const format = $('#export-format').value, animation = ['gif', 'mp4'].includes(format);
  $('#animation-export-options').hidden = !animation;
  $('#animation-preview').hidden = !animation;
  if (!animation) clearExportPreview();
  $('#export-confirm').textContent = `导出 ${format === 'jpeg' ? 'JPG' : format.toUpperCase()}`;
  $('#export-duration').max = format === 'mp4' ? '12' : '8';
  if (!state.exporting) { $('#export-progress').hidden = true; $('#export-cancel').hidden = true; $('#export-status').textContent = ''; }
  try {
    const options = exportSettings();
    $('#animation-export-options').hidden = !options.animation; $('#export-confirm').textContent = `导出 ${options.format === 'jpeg' ? 'JPG' : options.format.toUpperCase()}`;
    $('#export-size').disabled = options.mode === 'preview';
    $('#export-description').textContent = `${options.width} × ${options.height} px${options.animation ? ` · ${options.duration} 秒 · ${options.fps} fps · ${options.animationActorIds.length} 人参与动画` : ''}${state.background.type === 'transparent' && !['jpeg', 'mp4'].includes(options.format) ? ' · 透明背景' : ''}`;
    $('#export-confirm').disabled = state.exporting;
  } catch (error) { $('#export-description').textContent = error.message; $('#export-confirm').disabled = true; }
}
$('#export-open').onclick = () => safely(openExportDialog());
async function openExportDialog() {
  if (!state.ready || state.exporting || restoring || exportOpening || exportDialogSession || history?.busy || history?.held) return;
  exportOpening = true;
  try {
    const capabilities = await getExportCapabilities();
    if (!state.ready || state.exporting || restoring || history?.busy || history?.held) return;
    history?.commit(); history?.cancelPending(); await engine.render();
    exportDialogSession = { scene: engine.serialize(), paused: state.paused, effectTime };
    // Native modal interaction already blocks editing. Also suspend the obscured scene and FX.
    await engine.pause(); effectClock.sync();
    try { localStorage.setItem('clelele-live2d-prototype-draft-v2', JSON.stringify(captureDocument())); } catch {}
    for (const option of $('#export-format').options) { option.disabled = !capabilities[option.value]; if (option.value === 'mp4' && option.disabled) option.textContent = 'MP4 · 当前浏览器不支持'; }
    $('#export-duration').value = Math.min(8, Math.max(.2, engine.getPlayback().duration || 3)).toFixed(1);
    clearExportPreview(); renderExportActors(); describeExport(); $('#export-status').textContent = ''; $('#export-dialog').showModal();
  } catch (error) { await closeExportDialog(); throw error; }
  finally { exportOpening = false; }
}
for (const id of ['export-size','export-format','export-quality','export-area','export-duration','export-fps']) $('#' + id).addEventListener('change', () => { clearExportPreview(); describeExport(); });
$('#export-cancel').onclick = () => exportController?.abort();
$('#export-dialog').addEventListener('cancel', () => { exportController?.abort(); exportPreviewController?.abort(); });
$('#export-dialog').addEventListener('close', () => safely(closeExportDialog()));

function clearExportPreview() {
  if (exportPreviewTask) return;
  const canvas = $('#animation-preview-canvas'); canvas.hidden = true; canvas.width = canvas.height = 1;
  $('#animation-preview-status').textContent = '查看所选人物一起运动的构图。';
}

/** The preview and encoder sample the same complete scene, including frozen actors and overlays. */
async function renderOutputFrame(capture, settings, time, baseEffectTime) {
  effectTime = baseEffectTime + (settings.animation && state.effects.animate ? time : 0);
  compositor.setScene({ effectTime });
  if (settings.animation) await engine.seekForExport(time, settings.animationActorIds);
  else await engine.render();
  const context = capture.getContext('2d'); context.clearRect(0, 0, capture.width, capture.height);
  context.drawImage(output, 0, 0);
  paintEffects(context, capture.width, capture.height, state.effects, effectTime);
  if (state.captionExport) paintCaption(context, capture.width, capture.height);
  return capture;
}

async function stopExportPreview() {
  exportPreviewController?.abort();
  await exportPreviewTask;
}

async function startExportPreview() {
  if (state.exporting || exportPreviewTask || exportClosingTask || !exportDialogSession || !$('#export-dialog').open) return;
  const settings = exportSettings(); if (!settings.animation) return;
  const scale = Math.min(1, 720 / Math.max(settings.width, settings.height));
  settings.width = Math.max(2, Math.round(settings.width * scale)); settings.height = Math.max(2, Math.round(settings.height * scale));
  const controller = new AbortController(); exportPreviewController = controller;
  const task = performAnimationPreview(settings, controller.signal); exportPreviewTask = task;
  try { await task; } finally { if (exportPreviewTask === task) { exportPreviewTask = null; exportPreviewController = null; } }
}

async function performAnimationPreview(settings, signal) {
  const scene = engine.serialize(), baseEffectTime = effectTime;
  const previewSize = { width: frame.clientWidth, height: frame.clientHeight, quality: state.quality };
  const canvas = $('#animation-preview-canvas'), capture = document.createElement('canvas');
  const toggle = $('#animation-preview-toggle'), status = $('#animation-preview-status');
  // The output lock protects all edits and suppresses normal actor/FX clocks; it does not encode a file.
  state.exporting = true; effectClock.sync(); $('.workspace').inert = true; $('.topbar').inert = true;
  $('#export-controls').disabled = true; $('#export-confirm').disabled = true;
  toggle.textContent = '停止预览'; toggle.setAttribute('aria-pressed', 'true');
  canvas.width = capture.width = settings.width; canvas.height = capture.height = settings.height; canvas.hidden = false;
  $('#animation-preview').scrollIntoView({ block: 'nearest' });
  status.textContent = '正在准备预览…';
  const check = () => { if (signal.aborted || pageLeaving) throw new DOMException('已停止预览。', 'AbortError'); };
  try {
    await posterEditor.ready(); await document.fonts.ready; check();
    await engine.pause(); await engine.setSize(settings.width, settings.height, 1); check();
    await runAnimationPreview({ ...settings, signal,
      renderFrameAt: async time => {
        await renderOutputFrame(capture, settings, time, baseEffectTime); check();
        const context = canvas.getContext('2d'); context.clearRect(0, 0, canvas.width, canvas.height);
        if (settings.format === 'mp4') { context.fillStyle = state.background.type === 'transparent' ? '#ffffff' : state.background.color || '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); }
        context.drawImage(capture, 0, 0);
      },
      onTime: time => { status.textContent = `${time.toFixed(1)} / ${settings.duration.toFixed(1)} 秒 · ${settings.animationActorIds.length} 人同步预览`; },
    });
    status.textContent = '预览结束 · 编辑姿态已保留';
  } catch (error) {
    status.textContent = error.name === 'AbortError' ? '已停止 · 编辑姿态已保留' : `预览失败：${error.message}`;
    if (error.name !== 'AbortError') handleError(error);
  } finally {
    try {
      if (!pageLeaving) {
        effectTime = baseEffectTime; effectClock.setTime(effectTime); compositor.setScene({ effectTime });
        await engine.restore(scene); await engine.setSize(previewSize.width, previewSize.height, previewSize.quality);
      }
    } finally {
      capture.width = capture.height = 1; state.exporting = false;
      toggle.textContent = '播放预览'; toggle.setAttribute('aria-pressed', 'false');
      $('#export-controls').disabled = false; $('#export-confirm').disabled = false;
      if (!exportClosingTask) { $('.workspace').inert = false; $('.topbar').inert = false; }
      if (!pageLeaving) { resize(); syncCaption(); effectClock.sync(); }
    }
  }
}
$('#animation-preview-toggle').onclick = () => safely(exportPreviewTask ? stopExportPreview() : startExportPreview());
document.addEventListener('visibilitychange', () => { if (document.hidden) exportPreviewController?.abort(); });

/** A closed modal stays locked until sampling settles and the original editing snapshot is restored. */
async function closeExportDialog() {
  if (exportClosingTask) return exportClosingTask;
  if (!exportDialogSession) return;
  exportController?.abort(); exportPreviewController?.abort();
  $('.workspace').inert = true; $('.topbar').inert = true;
  const task = (async () => {
    await Promise.allSettled([exportPreviewTask, exportTask]);
    const session = exportDialogSession;
    try {
      if (!pageLeaving && session) {
        effectTime = session.effectTime; effectClock.setTime(effectTime); compositor.setScene({ effectTime });
        await engine.restore(session.scene); state.paused = session.paused;
      }
    } finally {
      exportDialogSession = null; clearExportPreview(); $('.workspace').inert = false; $('.topbar').inert = false;
      if (!pageLeaving) { resize(); updatePlaybackUI(); effectClock.sync(); }
    }
  })();
  exportClosingTask = task;
  try { await task; } finally { if (exportClosingTask === task) exportClosingTask = null; }
}

/** Serialize preview-to-export transitions even for callers outside the dialog. */
async function exportPNG() {
  if (exportTask || exportClosingTask) return exportTask;
  await stopExportPreview();
  if (exportTask || exportClosingTask) return exportTask;
  const task = performExport(); exportTask = task;
  try { await task; } finally { if (exportTask === task) exportTask = null; }
}

/** Allocate output-sized render targets once per export, then sample frames without reallocating them. */
async function performExport() {
  if (!state.ready || state.exporting || restoring) return;
  if (history?.held || history?.busy) { notify('素材或预设还在准备，请完成后再导出。'); return; }
  const settings = exportSettings(); history?.commit(); history?.cancelPending();
  // Persist the editing pose before export temporarily samples another frame.
  try { localStorage.setItem('clelele-live2d-prototype-draft-v2', JSON.stringify(captureDocument())); } catch {}
  let scene;
  const preview = { width: frame.clientWidth, height: frame.clientHeight, quality: state.quality };
  const previewEffectTime = effectTime;
  state.exporting = true; effectClock.sync(); exportController = new AbortController(); $('.workspace').inert = true; $('.topbar').inert = true;
  $('#animation-preview-toggle').disabled = true; $('#export-controls').disabled = true; $('#export-confirm').disabled = true; $('#export-progress').hidden = !settings.animation; $('#export-progress').value = 0; $('#export-cancel').hidden = false;
  $('#export-status').textContent = '正在准备目标画质…';
  const capture = document.createElement('canvas'); capture.width = settings.width; capture.height = settings.height;
  try {
    // Lock before the first await so a second export or an unfinished edit cannot change sampled frames.
    await engine.render(); scene = engine.serialize();
    await posterEditor.ready(); await document.fonts.ready; await engine.pause(); await engine.setSize(settings.width, settings.height, 1);
    const renderFrameAt = time => renderOutputFrame(capture, settings, time, previewEffectTime);
    const options = { ...settings, renderFrameAt, signal: exportController.signal, background: state.background.type === 'transparent' ? '#ffffff' : state.background.color || '#ffffff',
      onProgress: ({ phase, completed, total, progress }) => { $('#export-progress').value = progress; $('#export-status').textContent = `${phase === 'palette' ? '正在准备统一色彩' : '正在编码'} ${completed} / ${total} 帧`; } };
    const blob = await (settings.animation ? exportAnimation(options) : exportStill(options));
    const url = URL.createObjectURL(blob), link = document.createElement('a'), extension = settings.format === 'jpeg' ? 'jpg' : settings.format;
    link.href = url; link.download = `clelele-live2d-${settings.width}x${settings.height}.${extension}`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000); $('#export-status').textContent = `已导出 ${settings.width} × ${settings.height} ${extension.toUpperCase()}。`; notify('作品已保存。');
  } catch (error) { $('#export-status').textContent = error.name === 'AbortError' ? '已取消，编辑内容保留。' : `导出失败：${error.message}`; if (error.name !== 'AbortError') handleError(error); }
  finally {
    try { if (!pageLeaving) { effectTime = previewEffectTime; effectClock.setTime(effectTime); compositor.setScene({ effectTime }); if (scene) await engine.restore(scene); await engine.setSize(preview.width, preview.height, preview.quality); } }
    finally { state.exporting = false; exportController = null; if (!exportClosingTask) { $('.workspace').inert = false; $('.topbar').inert = false; } $('#animation-preview-toggle').disabled = false; $('#export-open').disabled = false; $('#export-controls').disabled = false; $('#export-confirm').disabled = false; $('#export-cancel').hidden = true; $('#export-progress').hidden = true; capture.width = capture.height = 1; if (!pageLeaving) { resize(); syncCaption(); effectClock.sync(); safely(saveDraft(captureDocument())); } }
  }
}
$('#export-confirm').onclick = () => safely(exportPNG());

// Native input is the user-edit path; programmatic updates use setControlValue.
document.addEventListener('input', event => syncRange(event.target), true);
for (const button of $$('[data-popup]')) {
  const panel = $('#' + button.dataset.popup); button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', panel.querySelector('h3').textContent);
  button.onclick = () => {
    if (panel.matches(':popover-open')) { panel.hidePopover(); return; }
    if (button.dataset.popup === 'filter-popover') refreshFilterControls();
    if (button.dataset.popup === 'background-popover') { $('#background-color').value = state.background.color || '#ffffff'; $('#background-color2').value = state.background.color2 || '#ffffff'; }
    panel.showPopover(); refreshRanges(panel);
    const bounds = button.getBoundingClientRect(), w = panel.offsetWidth, h = panel.offsetHeight;
    panel.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, innerWidth < 800 ? (innerWidth - w) / 2 : bounds.left - w - 14))}px`;
    panel.style.top = `${Math.max(48, Math.min(innerHeight - h - 12, bounds.top - 10))}px`;
  };
  panel.addEventListener('toggle', event => button.setAttribute('aria-expanded', String(event.newState === 'open')));
}
for (const button of $$('[data-close-popup]')) button.onclick = () => button.closest('[popover]').hidePopover();
for (const [id, key] of [['background-color','color'],['background-color2','color2']]) $('#' + id).oninput = event => {
  state.background[key] = event.target.value;
  if (state.background.type === 'transparent') state.background.type = 'color';
  if (key === 'color2' && state.background.type !== 'image') state.background.type = 'gradient';
  syncScene();
};

let filterPreviewPromise;
/** Render the small preset swatches only when their panel is first opened, using one disposable GL context. */
function prepareFilterPreviews() {
  if (filterPreviewPromise) return filterPreviewPromise;
  filterPreviewPromise = (async () => {
    const image = new Image(); image.src = './thumbs/anon.webp'; await image.decode();
    const source = document.createElement('canvas'); source.width = 144; source.height = 160;
    source.getContext('2d').drawImage(image, 0, 0, 144, 160);
    const canvas = document.createElement('canvas'), preview = createCompositor({ canvas });
    try {
      preview.resize(144, 160);
      for (const definition of FILTER_DEFINITIONS) {
        preview.setScene({filter:definition.id,filterParams:getFilterDefaults(definition.id),strength:1,exposure:0,saturation:1,background:{type:'color',color:'#eee9e5'}});
        preview.draw(source); const image = $(`[data-filter="${definition.id}"] img`); if (image) image.src = canvas.toDataURL('image/webp',.85);
        // Yield between samples; preview generation must never block dragging the actual canvas.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally { preview.dispose(); }
  })().catch(error => { filterPreviewPromise = null; console.warn('滤镜预览暂不可用', error.message); });
  return filterPreviewPromise;
}
let objectClipboard = null;
function copyObject() {
  if (state.target === 'text') { const layer = posterEditor.copySelected(); if (!layer) return false; objectClipboard = {type:'text',layer}; }
  else if (state.target === 'model') {
    const snapshot = engine.serialize(), actor = snapshot.actors.find(a => a.id === snapshot.activeId); if (!actor) return false;
    objectClipboard = {type:'model',actor:structuredClone(actor),dialogue:structuredClone(state.dialogues[actor.id] || {})};
  } else return false;
  notify('已复制选中对象，可在这张画布粘贴。'); return true;
}
async function pasteObject() {
  if (!objectClipboard) return;
  const copy = structuredClone(objectClipboard); history?.hold();
  try {
    if (copy.type === 'text') { await posterEditor.pasteLayer(copy.layer); chooseTarget('text'); }
    else {
      if (engine.getActors().length >= 3) { notify('画布最多同时放置 3 位人物。'); return; }
      await actorOperation(async () => {
        const id = await engine.addActor(copy.actor.modelId), camera = { ...copy.actor.camera, x: copy.actor.camera.x + .08, y: copy.actor.camera.y - .06 };
        await engine.restore({actors:[{...copy.actor,id,camera,state:{...copy.actor.state,camera}}],activeId:id,paused:true},{keepOthers:true});
        state.dialogues[id] = copy.dialogue; chooseTarget('model'); syncCaption();
      });
    }
  } finally { history?.release(); }
}
async function deleteObject() {
  history?.hold();
  try {
    if (state.target === 'text') { posterEditor.deleteSelected(); chooseTarget('none'); }
    else if (state.target === 'model') {
      if (!selectedActor()) return;
      await actorOperation(async () => { const actor = selectedActor(); await engine.removeActor(actor.id); delete state.dialogues[actor.id]; chooseTarget('none'); syncCaption(); });
    }
  } finally { history?.release(); }
}
/** Delete by the list's explicit row ID, never by the canvas's most recent selection. */
async function deleteLayer(id) {
  if (!state.ready || state.exporting || restoring) return false;
  history?.hold();
  try {
    if (id.startsWith('actor:')) {
      const actorId = id.slice(6), wasActive = selectedActor()?.id === actorId;
      const done = await actorOperation(async () => { await engine.removeActor(actorId); delete state.dialogues[actorId]; });
      if (!done) return false;
      if (wasActive && state.target === 'model') chooseTarget('none');
    } else if (id.startsWith('text:')) {
      const textId = id.slice(5), wasActive = posterEditor.getSelected()?.id === textId;
      posterEditor.deleteLayer(textId);
      if (wasActive && state.target === 'text') chooseTarget('none');
    } else if (id === 'background') {
      retainBackground(); backgroundRequest++;
      state.background = { type:'transparent', color:'#ffffff', color2:'#ffffff', image:null, scale:1, x:0, y:0 };
      if (state.target === 'background') chooseTarget('none');
      syncBackgroundUpload();
    }
    syncScene(); syncCaption(); return true;
  } finally { history?.release(); }
}
async function setLayerVisible(id, visible) {
  if (!state.ready || state.exporting || restoring) return;
  if (id.startsWith('actor:')) await actorOperation(() => engine.setActorVisible(id.slice(6), visible));
  else if (id.startsWith('text:')) {
    history?.begin(); posterEditor.setLayerHidden(id.slice(5), !visible); history?.commit();
  }
  syncCaption();
}
async function duplicateObject() { if (copyObject()) await pasteObject(); }
$('#duplicate-object').onclick = () => safely(duplicateObject()); $('#delete-object').onclick = () => safely(deleteObject());
document.addEventListener('keydown', event => {
  if (!isEditorEvent(event, app) || isTextEntry(event)) return;
  if (!state.ready || state.exporting || restoring || history?.held || history?.busy || event.isComposing || document.querySelector('dialog[open]')) return;
  if (event.target.closest('input,textarea,select,[contenteditable=true]')) return;
  if (event.target.closest('#scene-layers') && ['Delete','Backspace'].includes(event.key)) {
    event.preventDefault(); safely(layerManager.deleteActive()); return;
  }
  const key = event.key.toLowerCase(), command = event.ctrlKey || event.metaKey;
  if (command && ['c','v','d'].includes(key) && (objectClipboard || ['model','text'].includes(state.target))) {
    event.preventDefault(); if (key === 'c') copyObject(); else safely(key === 'v' ? pasteObject() : duplicateObject()); return;
  }
  if (['Delete','Backspace'].includes(event.key) && ['model','text'].includes(state.target)) { event.preventDefault(); safely(deleteObject()); return; }
  if (event.key === 'Escape' && !document.querySelector(':popover-open')) { chooseTarget('none'); posterEditor.clearSelection(); return; }
  if (['[',']'].includes(event.key) && state.target === 'model') { event.preventDefault(); layerManager.step('actor:'+selectedActor().id, event.key === '[' ? -1 : 1); }
});
refreshFilterControls(); refreshRanges();

syncScene(); resize();
document.fonts.ready.then(syncCaption);
try {
  engine = await createSceneEngine({ canvas: source,
    onFrame(canvas) {
      compositor.resize(canvas.width, canvas.height);
      compositor.setScene({effectTime});
      if (engine) { const layers=[...engine.getRenderLayers(),...posterEditor.getRenderLayers(canvas.width,canvas.height)], byId=new Map(layers.map(l=>[l.id,l]));
        compositor.drawLayers(layerManager.order().map(id=>byId.get(id)).filter(Boolean));
      } else compositor.draw(canvas);
      if (!state.exporting && !exportDialogSession && engine) { effectClock.sync(); if (performance.now() - lastActionRefresh > 120) { lastActionRefresh = performance.now(); actionControls?.updateLive(); state.paused = !engine.getPlayback().playing; updatePlaybackUI(); } }
    },
    onState(event) {
      const busy = event.status === 'loading'; $('#loading').dataset.status = event.status; $('#loading').hidden = event.status === 'ready';
      $('#load-title').textContent = event.status === 'error' ? '角色载入失败' : '正在准备角色';
      $('#load-message').textContent = event.message || (busy ? '准备模型与原始纹理…' : '');
      $('#retry').hidden = event.status !== 'error';
      $('#load-cancel').hidden = !busy;
      $('#load-keep-current').hidden = event.status !== 'error' || !engine?.serialize().actors.some(a=>a.modelId);
      if (event.status === 'error') failedModelId = event.modelId;
      if (event.total > 0) { $('#load-progress').value = event.loaded / event.total * 100; $('#load-message').textContent = `已读取 ${(event.loaded/1048576).toFixed(1)} / ${(event.total/1048576).toFixed(1)} MB · ${Math.floor(event.loaded/event.total*100)}%`; }
      else $('#load-progress').removeAttribute('value');
      $('#load-progress').hidden = event.status === 'error';
    },
    onStats(stats) { if(engine && !state.exporting && !exportDialogSession){state.paused=!engine.getPlayback().playing;updatePlaybackUI();actionControls?.updateLive();} $('#render-stats').textContent = `${stats.width} × ${stats.height} · ${stats.paused ? '已暂停' : `${Math.round(stats.fps || 0)} fps`}`; },
  });
  actionControls = createActionControls({ engine, root: $('#actions-editor'), fineRoot: $('#pose-editor'), timelineRoot: $('#timeline-slot'), keyframeRoot: $('#keyframe-slot'), locale: state.labelLocale,
    onChange() { state.paused = !engine.getPlayback().playing; updatePlaybackUI(); syncCaption(); refreshRanges($('#actions-editor')); refreshRanges($('#pose-editor')); },
    onHistory(phase) { if (!restoring) phase === 'begin' ? history?.begin() : history?.commit(); } });
  const requestedModel = new URLSearchParams(location.search).get('model');
  if (models[requestedModel]) state.model = requestedModel;
  resize(); await loadModel(state.model);
  let draft;
  try {
    const persisted = await storage.read('draft');
    const backups = ['clelele-live2d-prototype-draft-v1', 'clelele-live2d-prototype-draft-v2'].map(key => {
      try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
    });
    draft = [persisted, ...backups].filter(value => (value?.scene?.actors || value?.actors)?.length || (value?.scene?.emptyScene === true && Array.isArray(value.scene.actors))).sort((a, b) => (Date.parse(b.savedAt) || 0) - (Date.parse(a.savedAt) || 0))[0];
    if (draft) { await restoreDocument(draft); $('#draft-status').textContent = '已恢复上次编辑的草稿'; }
  } catch (error) { $('#draft-status').textContent = '草稿恢复失败，原备份仍保留'; console.warn(error); }
  initializeHistory();
  assetMaintenance = createAssetMaintenance({
    getRoots: () => [captureDocument(), history.getAssetReferences(), presets, objectClipboard],
    isBusy: () => !state.ready || restoring || selecting || state.exporting || history.busy || history.held || history.editing || pointers.size > 0 || !!textResize,
  });
  assetMaintenance.schedule();
  if (!draft) await saveDraft(captureDocument());
} catch (error) { $('#load-title').textContent = '渲染器未能启动'; $('#load-message').textContent = error.message; $('#retry').hidden = false; handleError(error); }

window.addEventListener('pagehide', (event) => { if (event.persisted) return; pageLeaving = true; exportPreviewController?.abort(); exportController?.abort(); backgroundLibrary.dispose(); assetMaintenance?.dispose(); effectClock.dispose(); actionControls?.destroy(); engine?.dispose(); compositor.dispose(); if (activeImageURL) URL.revokeObjectURL(activeImageURL); });
// Diagnostics and explicit controls used by browser regression tests. Keep the name for saved prototype integrations.
window.studioPrototype = { assetMaintenance, effectClock, syncEffects, engine, compositor, posterEditor, layerManager, state, resize, loadModel, exportPNG, captureDocument, restoreDocument, history, actionControls, getStats: () => engine?.getStats() };
