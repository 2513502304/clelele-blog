import { setControlValue, syncRange } from './range-controls.js';
import { groupActions, parseAction, describeParameter } from './labels.js';
import { createKeyframeControls } from './keyframe-controls.js';

const text = {
  zh: { motion: '动作', expression: '表情', play: '播放', pause: '暂停', loop: '循环', reset: '还原当前动作',
    head: '头身', eyes: '眼睛', brows: '眉毛', mouth: '嘴部', arms: '手臂', hands: '手型', armLPad:'左臂位置', armRPad:'右臂位置', raise:'抬起', bend:'弯曲', leftHand:'左手', rightHand:'右手', face: '面部效果', hair: '头发', clothes: '服装',
    fine: '姿态微调', empty: '选择一位人物后开始编辑', frozen: '暂停并微调当前帧；仅覆盖改动的参数，保留动作与表情。',
    safe: '使用模型原始范围；整体倾斜请调整人物旋转。', front: '正面', left: '左', right: '右',
    headPad: '头部方向', bodyPad: '身体方向', eyePad: '视线', browPad: '左右眉高度', mouthPad: '嘴形与开合',
    defaultMotion: '默认动作', defaultExpression: '默认表情', speed: '播放速度',
    start: '回到开头', end: '跳到末帧', previous: '上一帧', next: '下一帧', resetOne: '还原此参数', keyframe: '记录此参数关键帧',
    x: '左右', y: '上下', error: '操作未完成' },
  en: { motion: 'Motion', expression: 'Expression', play: 'Play', pause: 'Pause', loop: 'Loop', reset: 'Reset to motion',
    head: 'Head/body', eyes: 'Eyes', brows: 'Brows', mouth: 'Mouth', arms: 'Arms', hands:'Hands', armLPad:'Left arm', armRPad:'Right arm', raise:'Raise', bend:'Bend', leftHand:'Left hand', rightHand:'Right hand', face: 'Face effects', hair: 'Hair', clothes: 'Clothing',
    fine: 'Fine tuning', empty: 'Select a character to edit', frozen: 'Pause and adjust this frame. Only edited parameters override the motion and expression.',
    safe: 'Original model limits. Use character rotation for a larger tilt.', front: 'Front', left: 'Left', right: 'Right',
    headPad: 'Head direction', bodyPad: 'Body direction', eyePad: 'Gaze', browPad: 'Left/right brow height', mouthPad: 'Mouth shape/opening',
    defaultMotion: 'Default motion', defaultExpression: 'Default expression', speed: 'Playback speed',
    start: 'Go to start', end: 'Go to last frame', previous: 'Previous frame', next: 'Next frame', resetOne: 'Reset parameter', keyframe: 'Keyframe this parameter',
    x: 'Horizontal', y: 'Vertical', error: 'Could not finish this action' },
};
const node = (tag, className, content) => {
  const el = document.createElement(tag); if (className) el.className = className;
  if (content !== undefined) el.textContent = content; return el;
};
const normalize = (id) => id.replace(/^param_?/i, '').replaceAll('_', '').toLowerCase();
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const format = (n) => Number.isFinite(n) ? n.toFixed(2).replace(/\.00$/, '') : '—';

/** Compact semantic selectors, a non-resuming scrubber and range-safe XY/slider pose tools. */
export function createActionControls({ engine, root, fineRoot = root, timelineRoot = root, keyframeRoot = root, onChange = () => {}, onHistory = () => {}, locale = 'zh' }) {
  if (!root) throw new Error('Action controls need a mount element.');
  if (!document.querySelector('link[data-action-controls]')) {
    const style = document.createElement('link'); style.rel = 'stylesheet';
    style.href = new URL('./action-controls.css', import.meta.url).href; style.dataset.actionControls = ''; document.head.append(style);
  }
  let lang = locale === 'en' ? 'en' : 'zh';
  let kind = 'motion';
  let part = 'head';
  let destroyed = false;
  let interacting = false;
  let signature = '', keyframeSignature = '';
  let pending = Promise.resolve();
  let keyedParameters = new Set();
  let updateSelector = () => {};
  let playButton, loopButton, timeline, clock, speedSelect, keyframeEditor, parameterViews = [];
  const t = (key) => text[lang][key];
  const history = () => onHistory('begin');
  const commit = () => pending.catch(() => {}).then(() => onHistory('commit'));
  async function act(label, work, save = true) {
    if (save) history(label);
    try { await work(); if (destroyed) return; onChange({ type: label }); refresh(); }
    catch (error) { const box = root.querySelector('.ac-error'); if (box) box.textContent = error.message || t('error'); }
    finally { if (save) onHistory('commit'); }
  }
  const button = (label, handler, active = false, title = '') => {
    const b = node('button', 'ac-button', label); b.type = 'button'; b.title = title;
    b.setAttribute('aria-pressed', String(active)); b.addEventListener('click', handler); return b;
  };
  function selector(container) {
    const ids = kind === 'motion' ? engine.getMotions() : engine.getExpressions();
    const groups = groupActions(ids, kind);
    const selection = () => {
      const current = engine.getSelection();
      return kind === 'motion' ? current.motion : current.expression;
    };
    const choose = (group, number, direction) => {
      const parsed = parseAction(selection(), kind);
      if (number === undefined) number = parsed.number;
      if (direction === undefined) direction = parsed.direction;
      const item = group.items.find((item) => item.number === number && item.direction === direction) ??
        group.items.find((item) => item.number === number && item.direction === 'C') ??
        group.items.find((item) => item.direction === direction) ?? group.items[0];
      act(kind, () => kind === 'motion' ? engine.playMotion(item.id) : engine.setExpression(item.id));
    };
    const categories = [...new Set(groups.map((group) => lang === 'en' ? group.groupEn : group.groupZh))];
    const list = node('div', 'ac-action-list'), groupButtons = new Map();
    for (const category of categories) {
      const section = node('section', 'ac-category'); section.append(node('h4', '', category));
      const grid = node('div', 'ac-action-grid');
      for (const group of groups.filter((group) => (lang === 'en' ? group.groupEn : group.groupZh) === category)) {
        const control = button(lang === 'en' ? group.en : group.zh, () => choose(group), false, group.items.map((item) => item.id).join('\n'));
        groupButtons.set(group, control); grid.append(control);
      }
      section.append(grid); list.append(section);
    }
    const variants = node('div', 'ac-variants'); container.append(list, variants);
    let chosen, variantSignature = '', numberButtons = new Map(), facingButtons = new Map();
    // Keep the scrollable list, focus and gesture controls mounted when only the selected action changes.
    updateSelector = () => {
      const selected = selection(), parsed = parseAction(selected, kind);
      chosen = groups.find((group) => group.items.some((item) => item.id === selected));
      for (const [group, control] of groupButtons) control.setAttribute('aria-pressed', String(group === chosen));
      const numbers = [...new Set(chosen?.items.map((item) => item.number) ?? [])];
      const facings = ['C', 'L', 'R'].filter((direction) => chosen?.items.some((item) => item.direction === direction && item.number === parsed.number));
      const next = JSON.stringify([numbers, facings]);
      if (variantSignature !== next) {
        variantSignature = next; variants.replaceChildren(); numberButtons = new Map(); facingButtons = new Map();
        if (numbers.length > 1) {
          const row = node('div', 'ac-segment ac-numbers'); row.setAttribute('aria-label', lang === 'en' ? 'Number' : '编号');
          for (const number of numbers) { const control = button(String(number ?? '—'), () => choose(chosen, number)); numberButtons.set(number, control); row.append(control); }
          variants.append(row);
        }
        if (facings.length) {
          const row = node('div', 'ac-segment ac-directions'); row.setAttribute('aria-label', lang === 'en' ? 'Facing' : '朝向');
          for (const direction of facings) { const control = button(t({ C: 'front', L: 'left', R: 'right' }[direction]), () => choose(chosen, undefined, direction)); facingButtons.set(direction, control); row.append(control); }
          variants.append(row);
        }
      }
      variants.hidden = !chosen;
      for (const [number, control] of numberButtons) control.setAttribute('aria-pressed', String(number === parsed.number));
      for (const [direction, control] of facingButtons) control.setAttribute('aria-pressed', String(direction === parsed.direction));
    };
    updateSelector();
  }
  function playback(container) {
    const transport = node('div', 'ac-transport');
    const bar = node('div', 'ac-playback');
    const jump = (label, symbol, time) => { const b = button(symbol, () => act('seek', () => engine.seek(time())), false, t(label)); b.setAttribute('aria-label', t(label)); return b; };
    playButton = button('▶', () => act('playback', () => engine.getPlayback().playing ? engine.pause() : engine.play()));
    playButton.classList.add('ac-main-play');
    loopButton = button('↻', () => act('loop', () => engine.setLoop(!engine.getPlayback().loop)), false, t('loop')); loopButton.setAttribute('aria-label', t('loop'));
    speedSelect = node('select', 'ac-speed'); speedSelect.setAttribute('aria-label', t('speed')); speedSelect.title = t('speed');
    for (const speed of [.25, .5, .75, 1, 1.25, 1.5, 2]) { const option = node('option', '', `${speed}×`); option.value = speed; speedSelect.append(option); }
    speedSelect.onchange = () => act('speed', () => engine.setSpeed(Number(speedSelect.value)));
    bar.append(jump('start', 'Ⅰ‹', () => 0), jump('previous', '‹', () => Math.max(0, engine.getPlayback().time - 1 / 30)),
      playButton, jump('next', '›', () => engine.getPlayback().time + 1 / 30), jump('end', '›Ⅰ', () => engine.getPlayback().duration), loopButton, speedSelect);
    clock = node('output', 'ac-clock');
    timeline = node('input', 'ac-timeline'); timeline.type = 'range'; timeline.min = '0'; timeline.step = String(1 / 30);
    timeline.setAttribute('aria-label', lang === 'en' ? 'Animation time' : '动画时间');
    timeline.addEventListener('pointerdown', (event) => { interacting = true; history('seek'); timeline.setPointerCapture(event.pointerId); engine.pause(); });
    timeline.addEventListener('input', () => {
      if (!interacting) history('seek');
      pending = engine.seek(Number(timeline.value)).then(() => { updateLive(); onChange({ type: 'seek' }); });
      if (!interacting) commit();
    });
    const end = () => { interacting = false; updateLive(); commit(); };
    timeline.addEventListener('pointerup', end); timeline.addEventListener('pointercancel', end);
    transport.append(bar, timeline, clock); container.append(transport);
  }
  const partFor = (p) => {
    const key = normalize(p.id);
    if (/^hand[lr]\d+$/i.test(key)) return 'hands';
    const category = describeParameter(p.id).groupZh;
    if (category === '手臂与手形') return 'arms';
    if (category === '头发与摆动') return 'hair';
    if (category === '服装与配饰') return 'clothes';
    if (/^(?:angle|body|breath|position|chest|shoulder)/.test(key)) return 'head';
    if (/^(?:brow|eyebrow)|eyebrows/.test(key)) return 'brows';
    if (/mouth|teeth/.test(key)) return 'mouth';
    if (/^hand|^arm/.test(key)) return 'arms';
    if (/^eye|^eyelid|guruguru/.test(key)) return 'eyes';
    return 'face';
  };
  function edit(values, label = 'parameters') {
    const apply = engine.setParameters ? engine.setParameters(values) : Promise.all(Object.entries(values).map(([id, value]) => engine.setParameter(id, value)));
    pending = apply.then(() => { updateLive(); onChange({ type: label }); });
    return pending;
  }
  function xyPad(params, xId, yId, title, axesLabel) {
    const px = params.find((p) => normalize(p.id) === xId), py = params.find((p) => normalize(p.id) === yId);
    if (!px || !py || px.min >= px.max || py.min >= py.max) return null;
    const box = node('section', 'ac-pad-wrap'); box.append(node('h4', '', t(title)));
    const pad = node('div', 'ac-pad'); pad.tabIndex = 0; pad.setAttribute('role', 'group'); pad.setAttribute('aria-label', t(title));
    const dot = node('span', 'ac-pad-dot'); const axes = node('span', 'ac-pad-axes', axesLabel || 'Y / X'); pad.append(axes, dot);
    const readout = node('output', 'ac-pad-values'); box.append(pad, readout);
    let down = false;
    const move = (event) => {
      const r = pad.getBoundingClientRect();
      const x = clamp((event.clientX - r.left) / r.width, 0, 1), y = clamp(1 - (event.clientY - r.top) / r.height, 0, 1);
      edit({ [px.id]: px.min + x * (px.max - px.min), [py.id]: py.min + y * (py.max - py.min) });
    };
    pad.addEventListener('pointerdown', (event) => { down = true; interacting = true; history('xy-pad'); pad.setPointerCapture(event.pointerId); move(event); });
    pad.addEventListener('pointermove', (event) => { if (down) move(event); });
    const end = () => { down = false; interacting = false; updateLive(); commit(); };
    pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
    pad.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); history('xy-pad');
      const current = new Map(engine.getParameters().map((p) => [p.id, p]));
      const x = current.get(px.id), y = current.get(py.id), scale = event.shiftKey ? 10 : 1;
      edit({ [px.id]: x.value + ({ ArrowLeft: -1, ArrowRight: 1 }[event.key] ?? 0) * (x.max - x.min) / 100 * scale,
        [py.id]: y.value + ({ ArrowDown: -1, ArrowUp: 1 }[event.key] ?? 0) * (y.max - y.min) / 100 * scale }); commit();
    });
    parameterViews.push((map) => {
      const x = map.get(px.id), y = map.get(py.id); if (!x || !y) return;
      dot.style.left = `${clamp((x.value - x.min) / (x.max - x.min), 0, 1) * 100}%`;
      dot.style.top = `${(1 - clamp((y.value - y.min) / (y.max - y.min), 0, 1)) * 100}%`;
      readout.textContent = `X ${format(x.value)}  ·  Y ${format(y.value)}`;
    });
    return box;
  }
  function fineTuning(container) {
    const all = engine.getParameters();
    const available = ['head', 'eyes', 'brows', 'mouth', 'arms', 'hands', 'face', 'hair', 'clothes'].filter((key) => all.some((p) => partFor(p) === key && describeParameter(p.id).confidence !== 'unknown'));
    if (!available.includes(part)) part = available[0] ?? 'head';
    const heading = node('div', 'ac-fine-heading'); heading.append(node('h3', '', t('fine')),
      button('↺', () => act('reset-parameters', () => engine.resetParameters()), false, t('reset')));
    container.append(heading, node('p', 'ac-note', t('frozen')));
    const tabs = node('div', 'ac-part-tabs');
    for (const key of available) tabs.append(button(t(key), () => { part = key; refresh(true); }, part === key));
    container.append(tabs);
    const params = all.filter((p) => partFor(p) === part && describeParameter(p.id).confidence !== 'unknown');
    const pairs = { head: [['anglex', 'angley', 'headPad'], ['bodyanglex', 'bodyangley', 'bodyPad']],
      eyes: [['eyeballx', 'eyebally', 'eyePad']], brows: [['browly', 'browry', 'browPad']], mouth: [['mouthform', 'mouthopeny', 'mouthPad']], arms: [['arml02','arml01','armLPad'],['armr02','armr01','armRPad']] };
    for (const [x, y, label] of pairs[part] ?? []) { const pad = xyPad(params, x, y, label, part === 'arms' ? `${t('raise')} ↑ · ${t('bend')} →` : undefined); if (pad) container.append(pad); }
    if (part === 'hands') {
      // One-hot model channels: max selects a hand; min hides the others on that side.
      // These are numbered variants, not guessed hand-shape names.
      for (const side of ['l','r']) {
        const options = params.filter(p => new RegExp(`^hand${side}\\d+$`).test(normalize(p.id))).sort((a,b) => Number(normalize(a.id).match(/\d+$/)[0]) - Number(normalize(b.id).match(/\d+$/)[0]));
        if (!options.length) continue;
        const section=node('section','ac-hand-picker'), grid=node('div','ac-hand-options');
        section.append(node('h4','',t(side === 'l' ? 'leftHand' : 'rightHand')));
        for(const option of options){
          const pick=button(String(Number(normalize(option.id).match(/\d+$/)[0])).padStart(2,'0'),()=>act('hand',()=>edit(Object.fromEntries(options.map(p=>[p.id,p.id===option.id?p.max:p.min])))),false,option.id);
          pick.dataset.hand=option.id; grid.append(pick);
          parameterViews.push(map=>pick.setAttribute('aria-pressed',String(Math.abs((map.get(option.id)?.value ?? option.min)-option.max)<.001)));
        }
        section.append(grid);container.append(section);
      }
      container.append(node('p','ac-note',lang==='en'?'Choose a numbered model hand variant. Each side is independent.':'编号对应模型原生手型；左右手独立切换。'));
    }
    const sliders = node('div', 'ac-sliders');
    for (const p of params) {
      const description = describeParameter(p.id); const label = node('label', 'ac-slider'); label.title = p.id;
      const row = node('span', 'ac-slider-label'); row.append(node('span', '', lang === 'en' ? description.en : description.zh));
      const value = node('input','ac-number'); value.type='number'; value.min=String(p.min);value.max=String(p.max);value.step='0.01';
      value.setAttribute('aria-label',lang === 'en' ? description.en : description.zh);
      value.onchange=()=>{if(!Number.isFinite(value.valueAsNumber))return;history();edit({[p.id]:clamp(value.valueAsNumber,p.min,p.max)});commit();};row.append(value);
      const reset = button('↺', (event) => { event.preventDefault(); act('reset-parameter', () => engine.resetParameter(p.id)); }, false, t('resetOne'));
      reset.setAttribute('aria-label', `${lang === 'en' ? description.en : description.zh} · ${t('resetOne')}`);
      const keyframe = button('◇', (event) => { event.preventDefault(); act('keyframe', async () => {
        const current = engine.getParameters().find((item) => item.id === p.id);
        await engine.setKeyframe({ time: engine.getPlayback().time, values: { [p.id]: current.value } }); keyframeEditor?.focusParameter(p.id);
      }); }, false, t('keyframe'));
      keyframe.setAttribute('aria-label', `${lang === 'en' ? description.en : description.zh} · ${t('keyframe')}`);
      row.append(reset, keyframe);
      const input = node('input'); input.type = 'range'; input.min = String(p.min); input.max = String(p.max);
      input.step = String((p.max - p.min) / 200 || .01); input.disabled = p.max <= p.min;
      input.addEventListener('pointerdown', event => { interacting = true; history('slider'); input.setPointerCapture(event.pointerId); });
      input.addEventListener('input', () => { if (!interacting) history('slider'); edit({ [p.id]: Number(input.value) }); if (!interacting) commit(); });
      const end = () => { interacting = false; updateLive(); commit(); };
      input.addEventListener('pointerup', end); input.addEventListener('pointercancel', end);
      label.append(row, input); sliders.append(label);
      parameterViews.push((map) => { const current = map.get(p.id); if (!current) return;
        if(document.activeElement !== value) value.value = format(current.value); if (document.activeElement !== input) setControlValue(input, current.value);
        syncRange(input);
        label.classList.toggle('is-edited', current.edited);
        keyframe.setAttribute('aria-pressed', String(keyedParameters.has(p.id))); });
    }
    if(part === 'hands'){const advanced=node('details','ac-advanced');advanced.append(node('summary','',lang==='en'?'Blend hand channels':'手型通道混合'),sliders);container.append(advanced);}else container.append(sliders); container.append(node('p', 'ac-note', t('safe')));
  }
  function updateLive(force = false) {
    if (destroyed || (document.hidden && force !== true) || !timeline) return;
    const playback = engine.getPlayback();
    playButton.textContent = playback.playing ? 'Ⅱ' : '▶';
    playButton.title = playback.playing ? t('pause') : t('play'); playButton.setAttribute('aria-label', playButton.title);
    playButton.setAttribute('aria-pressed', String(playback.playing));
    loopButton.setAttribute('aria-pressed', String(playback.loop));
    timeline.max = String(playback.duration || 1);
    if (!interacting) setControlValue(timeline, playback.time || 0);
    if (document.activeElement !== speedSelect) speedSelect.value = String(playback.speed ?? 1);
    const time = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
    clock.textContent = `${time(playback.time || 0)} / ${time(playback.duration || 0)}`;
    keyedParameters = new Set(engine.getKeyframes().flatMap((key) => Object.keys(key.values)));
    const map = new Map(engine.getParameters().map((p) => [p.id, p])); parameterViews.forEach((view) => view(map));
    keyframeEditor?.updateLive();
  }
  function refresh(force = false) {
    if (destroyed) return;
    const actor = engine.getActors?.().find((item) => item.selected);
    const nextSignature = JSON.stringify([actor?.id, actor?.modelId, kind, part, lang, engine.getMotions(), engine.getExpressions()]);
    if (!force && signature === nextSignature) { updateSelector(); updateLive(); return; }
    signature = nextSignature;
    const nextKeyframeSignature = JSON.stringify([actor?.id, actor?.modelId, lang]);
    if (keyframeSignature !== nextKeyframeSignature) { keyframeEditor?.destroy(); keyframeEditor = null; keyframeSignature = nextKeyframeSignature; }
    root.classList.add('action-controls'); root.replaceChildren(); parameterViews = [];
    if(fineRoot !== root){fineRoot.replaceChildren();fineRoot.classList.add('action-controls');}
    if (timelineRoot !== root) { timelineRoot.replaceChildren(); timelineRoot.classList.add('action-controls', 'ac-timeline-mount'); }
    if (!engine.getMotions().length) { root.append(node('p', 'ac-note', t('empty'))); return; }
    const tabs = node('div', 'ac-kind-tabs');
    tabs.append(button(t('motion'), () => { kind = 'motion'; refresh(true); }, kind === 'motion'),
      button(t('expression'), () => { kind = 'expression'; refresh(true); }, kind === 'expression'));
    const defaults = node('div', 'ac-defaults'); defaults.append(
      button(t('defaultMotion'), () => act('default-motion', () => engine.resetMotion())),
      button(t('defaultExpression'), () => act('default-expression', () => engine.resetExpression())));
    root.append(tabs, defaults); selector(root); playback(timelineRoot); fineTuning(fineRoot);
    if (!keyframeEditor) keyframeEditor = createKeyframeControls({ engine, root: keyframeRoot, onChange(event) { updateLive(); onChange(event); }, onHistory, locale: lang });
    root.append(node('p', 'ac-error'));
    // Initialize newly created controls even in a background tab. Continuous
    // playback updates still stop while hidden; initialization cannot depend on
    // a later animation frame (the restored model may remain paused).
    updateLive(true);
  }
  // A paused model emits no new frames after a background restore. Refresh its
  // controls once on foregrounding rather than relying on the animation clock.
  document.addEventListener('visibilitychange', updateLive);
  refresh(true);
  return { refresh, updateLive, setLocale(value) { lang = value === 'en' ? 'en' : 'zh'; refresh(true); },
    destroy() { destroyed = true; document.removeEventListener('visibilitychange', updateLive); keyframeEditor?.destroy(); root.replaceChildren(); if (timelineRoot !== root) timelineRoot.replaceChildren(); } };
}
