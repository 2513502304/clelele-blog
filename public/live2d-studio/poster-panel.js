import { setControlValue } from './range-controls.js';
import { installTextInspector } from './text-inspector.js';
import { FONT_OPTIONS, POSTER_PRESETS, paintTextLayers, ensurePosterFonts, getTextLayerBounds } from './poster.js';

/** Keep text editing independent of animation. Text layers keep cached surfaces until their content or output size changes. */
export function createPosterEditor({ onChange = () => {}, onPreset, onTarget = () => {}, onSelectionChange = () => {}, getLocale = () => document.documentElement.lang }) {
  const $ = (selector) => document.querySelector(selector);
  let layers = [], selectedId = null, serial = 0, version = 0, cacheKey = '';
  let fontRequest = 0, applying = false;
  let detailOpen = false;
  const cache = document.createElement('canvas'), renderCaches = new Map();
  let groupSelection = false;
  const hitCanvas = document.createElement('canvas');
  const hitContext = hitCanvas.getContext('2d', { willReadFrequently: true });
  const english = () => String(getLocale()).toLowerCase().startsWith('en');
  const t = (zh, en) => english() ? en : zh;
  const active = () => layers.find((layer) => layer.id === selectedId);
  const panel = $('[data-tab-panel="poster"]'), detail = $('#text-editor');
  const detailHeading = document.createElement('div'); detailHeading.className = 'section-title poster-detail-heading';
  const backButton = document.createElement('button'); backButton.type = 'button'; backButton.className = 'text-btn poster-detail-back';
  const detailTitle = document.createElement('h2'); detailHeading.append(backButton, detailTitle);
  const layerActions = $('#text-remove').parentElement;
  detail.prepend(detailHeading, layerActions);
  const overview = [...panel.children].filter((element) => element !== detail);
  function syncView() {
    const showing = Boolean(detailOpen && active());
    detail.hidden = !showing; for (const element of overview) element.hidden = showing;
    panel.dataset.posterView = showing ? 'detail' : 'overview';
    backButton.textContent = t('← 返回海报', '← Back to posters');
    detailTitle.textContent = t('编辑文字', 'Edit text');
  }
  backButton.onclick = () => { detailOpen = false; syncView(); panel.scrollIntoView({ block: 'nearest' }); };
  const textInspector=installTextInspector(detail,{apply(settings){if(!active())return;Object.assign(active(),settings);refresh();changed();fontsChanged().catch(error);}});
  const extraDefaults={gradientColor:'#8785df',backgroundShape:'none',backgroundColor:'#fff0cc',shadowOpacity:0,shadowBlur:.1,shadowDistance:.03,shadowAngle:45,backgroundOpacity:.9,padding:.16};
  const fields = ['text', 'font', 'color', 'style', 'align', 'accent','gradientColor','backgroundShape','backgroundColor'];
  const sliders = ['size', 'tracking', 'lineHeight', 'x', 'y', 'rotation', 'opacity', 'stroke', 'glow','shadowOpacity','shadowBlur','shadowDistance','shadowAngle','backgroundOpacity','padding'];
  const error = (reason) => { console.error(reason); $('#toast').textContent = reason.message || String(reason); $('#toast').hidden = false; };
  const changed = () => { version++; cacheKey = ''; textInspector.refreshPreview(active()); onChange(); };
  async function fontsChanged() {
    const request = ++fontRequest;
    await ensurePosterFonts(layers);
    if (request === fontRequest) changed();
  }
  function syncList() {
    $('#text-layers').replaceChildren(...[...layers].reverse().map((layer) => {
      const button = document.createElement('button'); button.dataset.textLayer = layer.id;
      button.setAttribute('aria-pressed', String(layer.id === selectedId));
      const mark = document.createElement('span'); mark.className = 'text-swatch'; mark.style.color = layer.color; mark.textContent = 'T';
      const copy = document.createElement('span'), title = document.createElement('strong'), note = document.createElement('small');
      title.textContent = layer.text.replaceAll('\n', ' ') || t('空白文字', 'Empty text');
      const font = FONT_OPTIONS.find((font) => font.id === layer.font);
      note.textContent = `${english() ? font?.labelEn || '' : font?.label || ''} · ${t('在图层面板调整遮挡','Arrange in Layers')}`;
      copy.append(title, note); button.append(mark, copy); return button;
    }));
    $('#text-add').disabled = layers.length >= 8;
    const index = layers.findIndex((layer) => layer.id === selectedId);
    $('#text-back').disabled = index < 0; $('#text-front').disabled = index < 0;
    $('#text-remove').disabled = index < 0;
  }
  function syncFields() {
    const layer = active(); syncView();
    if (!layer) return;
    for (const key of fields) $('#poster-' + key).value = layer[key] ?? (extraDefaults[key]??(key==='accent'?'#362633':''));
    $('#poster-italic').checked=!!layer.italic;textInspector.sync(layer);
    $('#poster-layer').value = layer.placement;
    for (const key of sliders) {
      const value = ['rotation','shadowAngle'].includes(key) ? (layer[key]??extraDefaults[key]??0) : (layer[key] ?? extraDefaults[key] ?? (key === 'lineHeight' ? 1.05 : key==='stroke'?(layer.style==='outline'?.018:.06):key==='glow'?.18:0)) * 100;
      setControlValue($('#poster-' + key), value);
      $('#poster-' + key + '-output').textContent = `${Math.round(value * 10) / 10}${['rotation','shadowAngle'].includes(key) ? '°' : '%'}`;
    }
    for (const [key, visible] of [['accent',['comic','neon'].includes(layer.style)], ['stroke',['comic','outline'].includes(layer.style)], ['glow',layer.style==='neon']]) {
      $('#poster-'+key).closest('label').hidden=!visible;
    }
  }
  function refresh() { syncList(); syncFields(); }
  function select(id, reveal = false) {
    groupSelection = false;
    selectedId = layers.some((layer) => layer.id === id) ? id : null;
    if (!selectedId) detailOpen = false;
    else if (reveal) detailOpen = true;
    refresh();
    if (reveal && selectedId) {
      $('[data-tab="poster"]')?.click();
      $('#inspector')?.classList.add('is-open');
      $('#text-editor')?.scrollIntoView({ block: 'nearest' });
    }
    onSelectionChange(active() ? { ...active() } : null);
    if (reveal && selectedId) onTarget('text');
  }
  for (const font of FONT_OPTIONS) $('#poster-font').add(new Option(english() ? font.labelEn : font.label, font.id));
  for (const field of fields) $('#poster-' + field).addEventListener('input', (event) => {
    if (!active()) return;
    active()[field] = event.target.value; syncList(); if(field==='style'||field==='font')syncFields(); else if(field==='color')textInspector.sync(active()); changed();
    if (field === 'font' || field === 'text') fontsChanged().catch(error);
  });
  $('#poster-gradient').onchange=event=>{if(active()){active().gradient=event.target.checked;changed();}};
  $('#poster-italic').onchange=event=>{if(active()){active().italic=event.target.checked;changed();}};
  $('#poster-bold').onchange=event=>{if(active()){active().bold=event.target.checked;changed();}};
  $('#poster-layer').onchange = (event) => { if (!active()) return; active().placement = event.target.value; syncList(); changed(); };
  for (const key of sliders) $('#poster-' + key).addEventListener('input', (event) => {
    if (!active()) return;
    const value = Number(event.target.value); active()[key] = ['rotation','shadowAngle'].includes(key) ? value : value / 100;
    $('#poster-' + key + '-output').textContent = `${value}${['rotation','shadowAngle'].includes(key) ? '°' : '%'}`;
    changed();
  });
  $('#text-layers').onclick = (event) => { const button = event.target.closest('[data-text-layer]'); if (!button) return;
    select(button.dataset.textLayer, true);
  };
  $('#text-add').onclick = () => {
    if (layers.length >= 8) return;
    while (layers.some((layer) => layer.id === `custom-${serial + 1}`)) serial++;
    const layer = { id: `custom-${++serial}`, text: t('我们的故事', 'Your story'), font: 'serif', color: '#8a4660', size: .12,
      x: .08, y: .12, placement: 'front', opacity: 1, rotation: 0, align: 'left', tracking: 0, lineHeight: 1.05, style: 'fill' };
    layers.push(layer); select(layer.id, true); changed(); fontsChanged().catch(error);
  };
  $('#text-remove').onclick = () => api.deleteSelected();
  for (const [id, direction] of [['text-back', -1], ['text-front', 1]]) $('#' + id).onclick = () => {
    const index = layers.findIndex((layer) => layer.id === selectedId), next = index + direction;
    if (index < 0 || next < 0 || next >= layers.length) return;
    [layers[index], layers[next]] = [layers[next], layers[index]]; refresh(); changed();
  };
  $('#text-drag').onclick = () => onTarget('text');
  const api = {
    async applyPreset(id) {
      const preset = POSTER_PRESETS.find((item) => item.id === id); if (!preset || applying) return;
      applying = true;
      const buttons = [...document.querySelectorAll('[data-poster-preset]')];
      buttons.forEach((button) => { button.disabled = true; });
      try {
        // Commit scene and text as one operation; a busy model/export must not accept half a preset.
        await ensurePosterFonts(preset.layers);
        if (!(await onPreset(preset))) return;
        layers = structuredClone(preset.layers); selectedId = layers[0]?.id; detailOpen = false; refresh(); changed();
        document.querySelectorAll('[data-poster-preset]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.posterPreset === id)));
        return true;
      } finally { applying = false; buttons.forEach((button) => { button.disabled = false; }); }
    },
    paint(context, width, height, placement) { paintTextLayers(context, width, height, layers, placement); },
    underlay(width, height) {
      if (!layers.some((layer) => layer.placement === 'back' && layer.text.trim())) return { underlay: null };
      const key = `${version}/${width}/${height}`;
      if (key !== cacheKey) {
        cache.width = width; cache.height = height;
        paintTextLayers(cache.getContext('2d'), width, height, layers, 'back'); cacheKey = key;
      }
      return { underlay: cache, underlayVersion: key };
    },
    hasFrontLayers: () => layers.some((layer) => layer.placement === 'front' && layer.text.trim()),
    hasSelection: () => !!active(),
    getSelected: () => active() ? { ...active() } : null,
    getLayers: () => structuredClone(layers),
    selectLayer: (id, reveal = true) => select(id, reveal),
    selectGroup() { if (!layers.length) return; selectedId = layers[0].id; groupSelection = true; detailOpen = false; syncView(); onTarget('text'); onSelectionChange(); },
    isGroupSelected: () => groupSelection,
    setPlacement(id, placement) { const layer = layers.find(l => l.id === id); if (layer) { layer.placement = placement; refresh(); changed(); } },
    getRenderLayers(width, height) {
      for (const id of renderCaches.keys()) if (!layers.some(l => l.id === id)) renderCaches.delete(id);
      return layers.filter(l => !l.hidden).map(layer => {
        const key = JSON.stringify([layer,width,height]); let cached = renderCaches.get(layer.id);
        if (!cached) { cached = {canvas:document.createElement('canvas')}; renderCaches.set(layer.id,cached); }
        if (cached.key !== key) { cached.canvas.width = width; cached.canvas.height = height; paintTextLayers(cached.canvas.getContext('2d'),width,height,[layer],layer.placement); cached.key = key; }
        return {id:`text:${layer.id}`,kind:'text',canvas:cached.canvas,revision:key};
      });
    },
    getSnapshot: () => ({ layers: structuredClone(layers), selectedId, detailOpen, groupSelection }),
    async setSnapshot(snapshot, { notify = true } = {}) {
      const request = ++fontRequest;
      const restored = Array.isArray(snapshot?.layers) ? structuredClone(snapshot.layers).slice(0, 8) : [];
      await ensurePosterFonts(restored);
      if (request !== fontRequest) return false;
      layers = restored; selectedId = restored.some((layer) => layer.id === snapshot?.selectedId) ? snapshot.selectedId : null;
      detailOpen = Boolean(selectedId && snapshot?.detailOpen); groupSelection = Boolean(snapshot?.groupSelection);
      version++; cacheKey = ''; refresh();
      onSelectionChange(active() ? { ...active() } : null);
      if (notify) onChange();
      return true;
    },
    /** Hit actual glyph alpha, including back text obscured by a model. */
    selectAt(normalizedX, normalizedY, width, height, placement, onlyId) {
      if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY) || width <= 0 || height <= 0) return null;
      const scale = Math.min(1, 2048 / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
      hitCanvas.width = w; hitCanvas.height = h;
      const x = Math.round(normalizedX * w), y = Math.round(normalizedY * h);
      const ordered = [...layers.filter((layer) => layer.placement === 'back'), ...layers.filter((layer) => layer.placement === 'front')]
        .filter((layer) => (!placement || layer.placement === placement) && (!onlyId || layer.id === onlyId)).reverse();
      if (x >= 0 && x < w && y >= 0 && y < h) for (const layer of ordered) {
        if (layer.hidden || layer.opacity === 0 || !String(layer.text ?? '').trim()) continue;
        const bounds = getTextLayerBounds(hitContext, w, h, layer);
        if (!bounds || x < bounds.x - 2 || x > bounds.x + bounds.width + 2 || y < bounds.y - 2 || y > bounds.y + bounds.height + 2) continue;
        hitContext.clearRect(0, 0, w, h);
        paintTextLayers(hitContext, w, h, [layer], layer.placement);
        const left = Math.max(0, x - 1), top = Math.max(0, y - 1);
        const pixels = hitContext.getImageData(left, top, Math.min(3, w - left), Math.min(3, h - top)).data;
        if (pixels.some((value, index) => index % 4 === 3 && value > 12)) { select(layer.id, true); return { ...layer }; }
      }
      if(!onlyId) select(null); return null;
    },
    clearSelection() { select(null); },
    openDetails() { if (active()) { detailOpen = true; select(selectedId, true); } },
    showOverview() { detailOpen = false; syncView(); },
    copySelected() { return active() ? structuredClone(active()) : null; },
    /** Paste a text-layer payload, never arbitrary properties/DOM from a clipboard. */
    pasteLayer(payload) {
      if (!payload || typeof payload.text !== 'string' || layers.length >= 8) return null;
      while (layers.some((layer) => layer.id === `custom-${serial + 1}`)) serial++;
      const number = (key, fallback, min, max) => Number.isFinite(Number(payload[key])) ? Math.max(min, Math.min(max, Number(payload[key]))) : fallback;
      const layer = { id: `custom-${++serial}`, text: payload.text.slice(0, 200),
        font: FONT_OPTIONS.some((font) => font.id === payload.font) ? payload.font : 'serif',
        color: /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(payload.color) ? payload.color : '#8a4660', bold:!!payload.bold,
        size: number('size', .12, .005, .5), x: number('x', .08, -.5, 1.2) + .025, y: number('y', .12, -.5, 1.2) + .025,
        rotation: number('rotation', 0, -180, 180), opacity: number('opacity', 1, 0, 1),
        tracking: number('tracking', 0, -.08, .4), lineHeight: number('lineHeight', 1.05, .7, 2),
        align: ['left','center','right'].includes(payload.align) ? payload.align : 'left',
        placement: payload.placement === 'back' ? 'back' : 'front', style: ['fill','outline','shadow','comic','neon'].includes(payload.style) ? payload.style : 'fill',
        accent:/^#[0-9a-f]{6}$/i.test(payload.accent)?payload.accent:'#362633',stroke:number('stroke',payload.style==='outline'?.018:.06,0,.25),glow:number('glow',.18,0,.5),italic:!!payload.italic,gradient:!!payload.gradient,gradientColor:/^#[0-9a-f]{6}$/i.test(payload.gradientColor)?payload.gradientColor:'#8785df',backgroundShape:['box','rounded','bubble','marker'].includes(payload.backgroundShape)?payload.backgroundShape:'none',backgroundColor:/^#[0-9a-f]{6}$/i.test(payload.backgroundColor)?payload.backgroundColor:'#fff0cc',shadowOpacity:number('shadowOpacity',0,0,1),shadowBlur:number('shadowBlur',.1,0,.6),shadowDistance:number('shadowDistance',.03,0,.6),shadowAngle:number('shadowAngle',45,-180,180),backgroundOpacity:number('backgroundOpacity',.9,0,1),padding:number('padding',.16,0,.5) };
      layers.push(layer); select(layer.id, true); changed(); fontsChanged().catch(error); return layer.id;
    },
    duplicateSelected() { return api.pasteLayer(api.copySelected()); },
    setLayerHidden(id, hidden) {
      const layer = layers.find(item => item.id === id); if (!layer) return;
      layer.hidden = !!hidden; refresh(); changed();
    },
    deleteSelected() { return api.deleteLayer(selectedId); },
    /** Explicit-ID deletion keeps an unrelated canvas selection intact. */
    deleteLayer(id) {
      const index = layers.findIndex((layer) => layer.id === id); if (index < 0) return null;
      const deleted = layers[index].id; layers.splice(index, 1);
      if (deleted === selectedId) select(null); else refresh();
      changed(); return deleted;
    },
    getSelectionBounds(width, height) {
      if (!groupSelection) return getTextLayerBounds(hitContext, width, height, active());
      const boxes=layers.map(l=>getTextLayerBounds(hitContext,width,height,l)).filter(Boolean); if(!boxes.length)return null;
      const x=Math.min(...boxes.map(b=>b.x)), y=Math.min(...boxes.map(b=>b.y)), right=Math.max(...boxes.map(b=>b.x+b.width)), bottom=Math.max(...boxes.map(b=>b.y+b.height));
      return {x,y,width:right-x,height:bottom-y,corners:[{x,y},{x:right,y},{x:right,y:bottom},{x,y:bottom}]};
    },
    refreshLocale() {
      for (const option of $('#poster-font').options) { const font = FONT_OPTIONS.find((item) => item.id === option.value); option.textContent = english() ? font?.labelEn || option.value : font?.label || option.value; }
      for (const button of document.querySelectorAll('[data-poster-preset]')) {
        const preset = POSTER_PRESETS.find((item) => item.id === button.dataset.posterPreset); if (!preset) continue;
        button.title = english() ? preset.descriptionEn : preset.description;
        button.querySelector('span').textContent = english() ? preset.nameEn : preset.name;
      }
      refresh();
    },
    pan(dx, dy) { if (!active()) return; for(const layer of groupSelection ? layers : [active()]) { layer.x += dx; layer.y += dy; } syncFields(); changed(); },
    /** Resize from a gesture snapshot around the opposite corner, including rotated text. */
    beginResize() { return structuredClone(groupSelection ? layers.filter(l=>!l.hidden) : active() ? [active()] : []); },
    resizeFrom(originals, factor, anchor) {
      if (!originals.length || !Number.isFinite(factor)) return;
      factor = Math.min(...originals.map(l=>.5/l.size), Math.max(...originals.map(l=>.005/l.size), factor));
      for (const source of originals) {
        const layer=layers.find(l=>l.id===source.id); if (!layer) continue;
        layer.size=source.size*factor;
        layer.x=anchor.x+(source.x-anchor.x)*factor;
        layer.y=anchor.y+(source.y-anchor.y)*factor;
      }
      syncFields(); changed();
    },
    zoom(factor) {
      if (!active()) return;
      const chosen=groupSelection ? layers : [active()];
      factor=Math.min(...chosen.map(l=>.5/l.size),Math.max(Math.max(...chosen.map(l=>.005/l.size)),factor));
      const bounds=api.getSelectionBounds($('#output').width || 1000,$('#output').height || 1000), cx=(bounds.x+bounds.width/2)/($('#output').width || 1000), cy=(bounds.y+bounds.height/2)/($('#output').height || 1000);
      for(const layer of chosen){layer.size*=factor;if(groupSelection){layer.x=cx+(layer.x-cx)*factor;layer.y=cy+(layer.y-cy)*factor;}}
      syncFields(); changed();
    },
    reset() { if (!active()) return; Object.assign(active(), { x: .08, y: .12, size: .12, rotation: 0 }); syncFields(); changed(); },
    ready: () => ensurePosterFonts(layers),
  };
  let presetGroup=0;
  const categories=document.createElement('nav');categories.className='preset-categories';categories.setAttribute('aria-label','按人物数量浏览排版');
  for(const [count,label] of [[0,'全部'],[1,'单人'],[2,'双人'],[3,'多人']]){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.presetGroup=count;button.setAttribute('aria-pressed',String(!count));
    button.onclick=()=>{presetGroup=count;for(const b of categories.children)b.setAttribute('aria-pressed',String(Number(b.dataset.presetGroup)===count));for(const card of $('#poster-presets').children)card.hidden=count>0 && Number(card.dataset.people)!==count;};categories.append(button);
  }
  $('#poster-presets').before(categories);overview.push(categories);
  for (const preset of POSTER_PRESETS) {
    const button = document.createElement('button'); button.dataset.posterPreset = preset.id; button.dataset.people = preset.actors.length; button.setAttribute('aria-pressed', 'false');
    button.title = english() ? preset.descriptionEn : preset.description;
    // These small previews were exported from the exact real-model compositions, with no extra live sessions.
    const image = document.createElement('img'); image.src = `./thumbs/poster-${preset.id}.webp?v=16`; image.alt = english() ? preset.descriptionEn : preset.description;
    image.onerror = () => {
      // New recipes show their real typography/background until model thumbnails
      // are captured. This fallback never pretends to render missing characters.
      const preview = document.createElement('canvas'); preview.width = 240;
      const [a,b] = preset.ratio.split(':').map(Number); preview.height = Math.round(240*b/a);
      preview.setAttribute('aria-label', t('排版与背景预览', 'Typography and background preview'));
      preview.style.width = '100%'; preview.style.height = 'auto'; image.replaceWith(preview);
      ensurePosterFonts(preset.layers).then(() => {
        const context = preview.getContext('2d'), gradient = context.createLinearGradient(0,0,preview.width,preview.height);
        gradient.addColorStop(0,preset.background.color); gradient.addColorStop(1,preset.background.color2 || preset.background.color);
        context.fillStyle = gradient; context.fillRect(0,0,preview.width,preview.height);
        paintTextLayers(context,preview.width,preview.height,preset.layers,'back'); paintTextLayers(context,preview.width,preview.height,preset.layers,'front');
      }).catch(error);
    };
    const name = document.createElement('span'); name.textContent = english() ? preset.nameEn : preset.name;
    button.append(image, name); button.onclick = () => api.applyPreset(preset.id).catch(error);
    $('#poster-presets').append(button);
  }
  refresh(); return api;
}
