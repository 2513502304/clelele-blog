import { describeParameter } from './labels.js';
import { samplePoseTracks } from './pose-timeline.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const el = (tag, cls = '', text) => { const n = document.createElement(tag); n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const svg = (tag, attrs = {}) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const easings = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold', 'bezier', 'hermite'];
const bezier = { type: 'bezier', x1: .25, y1: .1, x2: .75, y2: .9 };

/** Match the timeline's polynomial easing exactly when exposing editable handles. */
function editableEasing(easing) {
  if (typeof easing === 'object') return { ...easing };
  const controls = {
    linear: [1 / 3, 2 / 3], 'ease-in': [0, 1 / 3],
    'ease-out': [2 / 3, 1], 'ease-in-out': [0, 1],
  };
  const [y1, y2] = controls[easing] || controls.linear;
  return { type: 'bezier', x1: 1 / 3, y1, x2: 2 / 3, y2 };
}

/** Timeline and value curves share one ruler. Edits stay local to the selected parameter. */
export function createKeyframeControls({ engine, root, onChange = () => {}, onHistory = () => {}, locale = 'zh' }) {
  const en = locale === 'en', tr = (zh, english) => en ? english : zh;
  const params = engine.getParameters(), parameterMap = new Map(params.map(p => [p.id, p]));
  let parameterId = parameterMap.has('ParamAngleX') ? 'ParamAngleX' : params[0]?.id;
  let selectedId = null, destroyed = false, drag = null, mode = 'curve', zoom = 1, start = 0;
  let keyClipboard = null, ending = false;
  const hiddenTracks = new Set();
  const colorFor = id => `hsl(${[...id].reduce((n,c)=>(n*31+c.charCodeAt(0))%360,0)} 42% 48%)`;
  let selectedPoints = [];
  const pointToken = p => p.id + '/' + p.parameterId;
  const selectPoints = pairs => { selectedPoints=pairs; const last=pairs.at(-1); selectedId=last?.id??null;if(last)parameterId=last.parameterId;lastGraph=''; };
  const selectionPoints = () => selectedPoints.length?selectedPoints:selectedId?[{id:selectedId,parameterId}]:[];
  let lastGraph = '', lastTracks = '', latestMove = null, moving = false, pending = Promise.resolve();
  const label = p => { const d = describeParameter(p.id); return en ? d.en : d.zh; };
  const keys = () => engine.getKeyframes();
  let reference, baseTracks = new Map();
  function syncReference() {
    const current = engine.getMotionReference();
    if (current === reference) return;
    reference = current;
    baseTracks = new Map(current.tracks.map(t=>[t.id,{...t,poses:t.keys.map(k=>({time:k.time,values:{[t.id]:k.value},easing:k.easing}))}]));
    lastGraph = ''; lastTracks = '';
  }
  const track = (id = parameterId) => keys().filter(k => Number.isFinite(k.values[id])).sort((a,b) => a.time - b.time);
  const selected = () => track().find(k => k.id === selectedId);
  const easingOf = k => k?.easings?.[parameterId] ?? k?.easing ?? 'linear';
  const p = () => parameterMap.get(parameterId);
  const extent = () => Math.max(engine.getPlayback().duration, 1);
  const domain = () => extent() / zoom;
  let graphWidth=680, graphHeight=200;
  const left=48, top=30, right=()=>graphWidth-16, bottom=()=>graphHeight-24, plotWidth=()=>right()-left, plotHeight=()=>bottom()-top;
  const x = time => left + (time - start) / domain() * plotWidth();
  const y = value => bottom() - clamp((value - p().min) / (p().max - p().min || 1), 0, 1) * plotHeight();
  const timeAt = xx => clamp(start + (xx - left) / plotWidth() * domain(), 0, 30);
  const valueAt = yy => p().min + clamp((bottom() - yy) / plotHeight(), 0, 1) * (p().max - p().min);
  const button = (text, fn, title = text) => { const n = el('button', '', text); n.type = 'button'; n.title = title; n.onclick = fn; return n; };
  const error = el('span', 'kf-error');
  function change(work) {
    return Promise.resolve(work).then(v => { if (!destroyed) { error.textContent = ''; updateLive(); onChange({type:'keyframes'}); } return v; })
      .catch(e => { if (!destroyed) error.textContent = e.message; return null; });
  }
  async function action(fn) { onHistory('begin'); try { await change(fn()); } finally { onHistory('commit'); } }
  async function patch(fields) { if (!selectedId) return; const id = await engine.updateParameterKeyframe(selectedId, parameterId, fields); if (id) selectPoints([{id,parameterId}]); }
  function add(at = engine.getPlayback().time, value = engine.getParameters().find(item => item.id === parameterId)?.value) {
    return action(async () => { const id=await engine.setKeyframe({time:at, values:{[parameterId]:value}});selectPoints(id?[{id,parameterId}]:[]); });
  }
  function remove() { const pairs=selectionPoints(); if(pairs.length)action(async()=>{await engine.editKeyframePoints(pairs,{remove:true});selectPoints([]);}); }

  root.replaceChildren(); root.className = 'kf-editor';
  const details = el('details','kf-details');
  const summary = el('summary','kf-summary'); summary.append(el('span','','⌁'), el('strong','',tr('动画曲线','Animation curves')), el('span','kf-summary-meta',tr('参数轨道 · 逐帧编辑','Parameter tracks · frame editing')), el('span','kf-chevron','⌃')); details.append(summary);
  const body = el('div','kf-body'); details.append(body); root.append(details);
  const guide=el('p','kf-guide',tr('虚线是当前动作与表情自带的曲线。点击「编辑这条曲线」沿用其关键帧，其他部位保持原样。全部曲线按各自参数范围对齐；左侧刻度及编辑数值属于当前选中的轨道。','Dashed lines show the current motion and expression. Edit a curve to reuse its native keys without changing other parameters. All curves fit their own parameter ranges; the value axis and edit fields belong to the selected track.'));body.append(guide);
  const toolbar = el('div','kf-toolbar');
  const timing=el('div','kf-timing');
  const durationLabel=el('label','',tr('动作时长 / s','Duration / s')),durationInput=el('input');durationInput.type='number';durationInput.min=1/30;durationInput.max=30;durationInput.step=.1;durationInput.className='kf-duration';durationLabel.append(durationInput);
  const stretchLabel=el('label','kf-stretch'),stretchInput=el('input');stretchInput.type='checkbox';stretchInput.checked=true;stretchLabel.append(stretchInput,document.createTextNode(tr('同步缩放关键帧','Scale edited keys')));
  durationInput.title=tr('改变动作的总时长：更长会更慢，更短会更快。勾选下方选项会一起缩放已编辑的关键帧。','Longer duration slows the motion; shorter duration speeds it up. Scale edited keys to keep their timing relative to the motion.');
  durationInput.onchange=()=>action(()=>engine.setDuration(Number(durationInput.value),{scaleKeys:stretchInput.checked}));
  timing.append(durationLabel,stretchLabel);body.append(timing);
  const modes = el('div','kf-modes');
  const curveMode = button(tr('曲线','Curves'),()=>{mode='curve';lastGraph='';updateLive();});
  const keysMode = button(tr('关键帧','Keys'),()=>{mode='keys';lastGraph='';updateLive();});
  const allMode = button(tr('全部曲线','All curves'),()=>{mode='all';lastGraph='';updateLive();});
  modes.append(curveMode,allMode,keysMode);
  const addButton = button(tr('◇ 记录','◇ Record'),()=>add(),tr('在播放头记录选中参数','Record selected parameter at playhead'));
  const seedButton = button(tr('编辑这条曲线','Edit this curve'),()=>action(async()=>{
    await engine.seedMotionTrack(parameterId); selectPoints(track()[0]?[{id:track()[0].id,parameterId}]:[]);
  }),tr('复制选中参数的原始曲线，保留其他动作与表情','Reuse this native parameter curve without replacing other motion/expression channels'));
  seedButton.className='kf-seed';
  const endpoint = button(tr('＋ 结束点','＋ End key'),()=>{const rows=track(),at=Math.min(30,Math.max(engine.getPlayback().time,rows.at(-1)?.time||0)+1);return add(at);},tr('在最后记录的一秒后添加当前值，再上下拖动新关键帧','Add current value one second after the last key, then drag vertically'));
  const fit = button(tr('适应','Fit'),()=>{zoom=1;start=0;lastGraph='';updateLive();});
  const zoomOut = button('−',()=>scaleView(.7)), zoomIn = button('＋',()=>scaleView(1.4));
  const zoomLabel = el('span','kf-zoom','1×');
  const selectAll=button(tr('全选本轨道','Select track'),()=>{selectPoints(track().map(k=>({id:k.id,parameterId})));updateLive();});
  toolbar.append(modes,error,fit,zoomOut,zoomLabel,zoomIn,selectAll,seedButton,addButton,endpoint); body.append(toolbar);
  const content = el('div','kf-content'), tracks = el('div','kf-tracks');
  const select = el('select','kf-track'); select.setAttribute('aria-label',tr('添加或选择参数轨道','Add or select parameter track'));
  const empty = el('option','',tr('＋ 选择参数','＋ Select parameter')); empty.value=''; select.append(empty);
  for(const item of params){const option=el('option','',label(item));option.value=item.id;select.append(option);}
  select.onchange=()=>{if(select.value)focusParameter(select.value);select.value='';};
  const trackList=el('div','kf-track-list');const showAll=button(tr('全部显示','Show all'),()=>{hiddenTracks.clear();lastTracks=lastGraph='';updateLive();});showAll.className='kf-show-all';tracks.append(select,showAll,trackList);content.append(tracks);
  const graphWrap=el('div','kf-graph-wrap');
  const plot=svg('svg',{viewBox:`0 0 ${graphWidth} ${graphHeight}`,class:'kf-plot',tabindex:'0','aria-label':tr('时间与参数曲线，可拖动关键帧和贝塞尔手柄','Time and parameter curves; drag keys and Bezier handles')});
  const grid=svg('g'), curves=svg('g'), points=svg('g'), handles=svg('g'), marker=svg('g',{class:'kf-marker'});
  const markerLine=svg('line',{y1:24,y2:172,class:'kf-playhead'}), markerCap=svg('path',{d:'M -5 19 L 5 19 L 0 25 Z',class:'kf-playhead-cap'});marker.append(markerLine,markerCap);
  const marquee=svg('rect',{class:'kf-marquee',visibility:'hidden'});
  plot.append(grid,curves,points,handles,marker,marquee);graphWrap.append(plot,el('p','kf-instruction',tr('Shift 点选多帧／拖框多选 · 拖动整体平移 · Alt 锁定时间 · 双击添加 · 滚轮缩放','Shift-click or Shift-drag to select keys · Drag moves the selection · Alt locks time · Double-click adds · Wheel zooms')));content.append(graphWrap);
  const properties=el('div','kf-properties');const selectionName=el('strong','kf-selection-name');properties.append(selectionName);
  const fields=el('div','kf-fields');
  function number(title,step){const wrap=el('label','',title),input=el('input');input.type='number';input.step=step;wrap.append(input);fields.append(wrap);return input;}
  const timeInput=number(tr('时间 / s','Time / s'),1/30), valueInput=number(tr('数值','Value'),.01);timeInput.min=0;timeInput.max=30;
  timeInput.onchange=()=>action(()=>patch({time:Number(timeInput.value)}));valueInput.onchange=()=>action(()=>patch({value:Number(valueInput.value)}));properties.append(fields);
  const easingLabel=el('label','kf-easing-label',tr('下一段缓动','Outgoing easing'));const easingSelect=el('select');
  const easeLabels=en?['Linear','Ease in','Ease out','Smooth','Hold','Bezier','Native tangents']:['线性','渐入','渐出','平滑','保持','贝塞尔','原动作切线'];
  easings.forEach((e,i)=>{const o=el('option','',easeLabels[i]);o.value=e;easingSelect.append(o);});
  easingSelect.onchange=()=>action(()=>patch({easing:easingSelect.value==='bezier'?{...bezier}:easingSelect.value==='hermite'?{type:'hermite',outSlope:0,inSlope:0}:easingSelect.value}));easingLabel.append(easingSelect);properties.append(easingLabel);
  const removeButton=button(tr('删除此关键帧','Delete key'),remove);removeButton.className='kf-delete';properties.append(removeButton);content.append(properties);body.append(content);
  // A separate captured gesture resizes only this panel, never the keyframe values.
  const grip=el('div','kf-resize-grip'); grip.tabIndex=0;grip.role='separator';grip.setAttribute('aria-orientation','horizontal');grip.setAttribute('aria-label',tr('拖动调整曲线面板高度','Resize curve panel'));grip.title=tr('上下拖动调整高度；方向键微调，双击恢复','Drag to resize; arrow keys adjust; double-click to reset');
  let resizing=null;
  const setHeight=value=>{const h=clamp(value,100,Math.max(140,Math.min(520,window.innerHeight*.48)));plot.style.height=h+'px';trackList.style.maxHeight=h+'px';grip.setAttribute('aria-valuenow',Math.round(h));};
  grip.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();grip.setPointerCapture(e.pointerId);resizing={y:e.clientY,h:plot.getBoundingClientRect().height};};
  grip.onpointermove=e=>{if(resizing)setHeight(resizing.h+resizing.y-e.clientY);};
  grip.onpointerup=grip.onpointercancel=grip.onlostpointercapture=()=>{resizing=null;};
  grip.ondblclick=()=>{plot.style.height='';trackList.style.maxHeight='';};
  grip.onkeydown=e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();setHeight(plot.getBoundingClientRect().height+(e.key==='ArrowUp'?20:-20));}};
  body.prepend(grip);

  const resize=()=>requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
  const observer=new ResizeObserver(()=>{const box=plot.getBoundingClientRect();if(box.width<1||box.height<1)return;graphWidth=Math.round(box.width);graphHeight=Math.round(box.height);plot.setAttribute('viewBox',`0 0 ${graphWidth} ${graphHeight}`);markerLine.setAttribute('y2',bottom());lastGraph='';updateLive();});observer.observe(plot);
  details.addEventListener('toggle',()=>{root.classList.toggle('expanded',details.open);resize();updateLive();});
  function focusParameter(id){if(!parameterMap.has(id))return;parameterId=id;selectPoints(track()[0]?[{id:track()[0].id,parameterId:id}]:[]);details.open=true;lastGraph='';updateLive();}
  function scaleView(factor,anchor=engine.getPlayback().time){const fraction=(anchor-start)/domain();zoom=clamp(zoom*factor,1,10);start=clamp(anchor-fraction*domain(),0,Math.max(0,extent()-domain()));lastGraph='';updateLive();}
  const coordinates=e=>{const r=plot.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*graphWidth,y:(e.clientY-r.top)/r.height*graphHeight};};
  plot.addEventListener('wheel',e=>{e.preventDefault();if(e.shiftKey){start=clamp(start+e.deltaY/500*domain(),0,extent()-domain());lastGraph='';updateLive();}else scaleView(Math.exp(-e.deltaY*.002),timeAt(coordinates(e).x));},{passive:false});
  plot.ondblclick=e=>{if(e.target.closest('[data-key],[data-handle]'))return;const xy=coordinates(e);add(timeAt(xy.x),mode!=='keys'?valueAt(xy.y):undefined);};
  plot.onpointerdown=e=>{
    if(e.button!==0||ending)return;e.preventDefault();plot.focus({preventScroll:true});plot.setPointerCapture(e.pointerId);
    const target=e.target.closest('[data-key],[data-handle]'),xy=coordinates(e);onHistory('begin');engine.pause();
    if(target?.dataset.key){
      const pair={id:target.dataset.key,parameterId:target.dataset.track},selected=selectionPoints(),already=selected.some(p=>pointToken(p)===pointToken(pair));
      if(e.shiftKey){selectPoints(already?selected.filter(p=>pointToken(p)!==pointToken(pair)):[...selected,pair]);drag={kind:'select'};}
      else {if(!already)selectPoints([pair]);else{parameterId=pair.parameterId;selectedId=pair.id;}
        const all=keys(),origins=selectionPoints().map(p=>({...p,time:all.find(k=>k.id===p.id).time,value:all.find(k=>k.id===p.id).values[p.parameterId]}));
        drag={kind:'key',origins,current:selectionPoints(),x:xy.x,y:xy.y,span:domain(),parameterId};pending=change(engine.seek(all.find(k=>k.id===pair.id).time));}
    }
    else if(target?.dataset.handle){const rows=track(),a=selected(),b=rows[rows.findIndex(k=>k.id===selectedId)+1];if(a&&b)drag={kind:'handle',handle:Number(target.dataset.handle),a:structuredClone(a),b:structuredClone(b)};}
    else if(e.shiftKey){drag={kind:'marquee',x:xy.x,y:xy.y,parameterId,prior:selectionPoints()};marquee.setAttribute('visibility','visible');}
    else{selectPoints([]);drag={kind:'seek'};pending=change(engine.seek(timeAt(xy.x)));}
    updateLive();
  };
  // Coalesce high-frequency pointer samples; one engine edit is in flight, with the latest sample retained.
  async function consumeMove(){if(moving)return;moving=true;while(latestMove&&!destroyed){const sample=latestMove;latestMove=null;await change(sample());}moving=false;}
  plot.onpointermove=e=>{
    // Pointer release closes input immediately, even while the last renderer edit drains.
    if(!drag||ending||!(e.buttons&1))return;const xy=coordinates(e),gesture=drag;
    if(gesture.kind==='key'){
      const min=Math.min(...gesture.origins.map(p=>p.time)),max=Math.max(...gesture.origins.map(p=>p.time));
      const dt=e.altKey?0:clamp(Math.round((xy.x-gesture.x)/plotWidth()*gesture.span*30)/30,-min,30-max);
      const same=gesture.origins.every(p=>p.parameterId===gesture.parameterId),param=parameterMap.get(gesture.parameterId);
      const dv=mode!=='keys'&&same?clamp((gesture.y-xy.y)/plotHeight()*(param.max-param.min),param.min-Math.min(...gesture.origins.map(p=>p.value)),param.max-Math.max(...gesture.origins.map(p=>p.value))):0;
      latestMove=async()=>{const result=await engine.editKeyframePoints(gesture.current.map((pair,i)=>({...pair,time:gesture.origins[i].time+dt,value:gesture.origins[i].value+dv})));gesture.current=result;selectPoints(result);parameterId=gesture.parameterId;selectedId=result.find(p=>p.parameterId===parameterId)?.id??selectedId;};
    }
    else if(gesture.kind==='handle')latestMove=()=>{const {a,b,handle}=gesture,base=editableEasing(easingOf(a)),dt=b.time-a.time;
      if(base.type==='hermite'){if(handle===1)base.outSlope=(valueAt(xy.y)-a.values[parameterId])*3/dt;else base.inSlope=(b.values[parameterId]-valueAt(xy.y))*3/dt;}
      else{const delta=b.values[parameterId]-a.values[parameterId];base[`x${handle}`]=clamp((timeAt(xy.x)-a.time)/dt,0,1);if(Math.abs(delta)>.00001)base[`y${handle}`]=clamp((valueAt(xy.y)-a.values[parameterId])/delta,0,1);}return patch({easing:base});};
    else if(gesture.kind==='marquee'){
      const rect={x:Math.min(gesture.x,xy.x),y:Math.min(gesture.y,xy.y),width:Math.abs(xy.x-gesture.x),height:Math.abs(xy.y-gesture.y)};
      for(const[k,v]of Object.entries(rect))marquee.setAttribute(k,v);
      const found=[...points.querySelectorAll('[data-key]')].filter(dot=>{if(dot.dataset.track!==gesture.parameterId)return false;const b=dot.getBBox(),cx=b.x+b.width/2,cy=b.y+b.height/2;return cx>=rect.x&&cx<=rect.x+rect.width&&cy>=rect.y&&cy<=rect.y+rect.height;}).map(dot=>({id:dot.dataset.key,parameterId:dot.dataset.track}));
      selectPoints([...new Map([...gesture.prior,...found].map(p=>[pointToken(p),p])).values()]);updateLive();return;
    }
    else if(gesture.kind==='seek')latestMove=()=>engine.seek(timeAt(xy.x));else return;
    pending=consumeMove();
  };
  async function end(){if(!drag||ending)return;ending=true;await pending;while(moving)await new Promise(resolve=>setTimeout(resolve,0));drag=null;marquee.setAttribute('visibility','hidden');ending=false;onHistory('commit');updateLive();}
  plot.onpointerup=end;plot.onpointercancel=end;plot.onlostpointercapture=end;
  plot.onkeydown=e=>{
    if((e.ctrlKey||e.metaKey)&&['c','v','d'].includes(e.key.toLowerCase())) {
      e.preventDefault();e.stopPropagation();const key=selected(),command=e.key.toLowerCase();
      if(command==='c'&&key)keyClipboard={value:key.values[parameterId],easing:structuredClone(easingOf(key))};
      else if(command==='v'&&keyClipboard)action(async()=>{selectedId=await engine.setKeyframe({time:engine.getPlayback().time,values:{[parameterId]:keyClipboard.value}});await patch({easing:keyClipboard.easing});});
      else if(command==='d'&&key)action(async()=>{const easing=structuredClone(easingOf(key));selectedId=await engine.setKeyframe({time:key.time+1/30,values:{[parameterId]:key.values[parameterId]}});await patch({easing});});
      return;
    }
    if(['Delete','Backspace'].includes(e.key)){e.preventDefault();e.stopPropagation();remove();}else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();change(engine.seek(engine.getPlayback().time+(e.key==='ArrowRight'?1:-1)/30));}};
  function drawTracks(all){
    const edited=new Set(all.flatMap(k=>Object.keys(k.values)));
    const ids=[...new Set([parameterId,...edited,...reference.tracks.map(t=>t.id)])].filter(id=>parameterMap.has(id));
    const signature=JSON.stringify([ids,parameterId,[...edited],[...hiddenTracks]]);if(signature===lastTracks)return;lastTracks=signature;
    const scroll=trackList.scrollTop;trackList.replaceChildren();
    for(const id of ids){
      const item=el('div','kf-track-item'),visible=el('input');visible.type='checkbox';visible.checked=!hiddenTracks.has(id);visible.setAttribute('aria-label',tr('显示曲线：','Show curve: ')+label(parameterMap.get(id)));
      visible.onchange=()=>{visible.checked?hiddenTracks.delete(id):hiddenTracks.add(id);lastGraph=lastTracks='';updateLive();};
      const row=button(label(parameterMap.get(id)),()=>focusParameter(id),id);row.className='kf-track-row';row.dataset.track=id;row.setAttribute('aria-pressed',String(id===parameterId));
      const dot=el('span','kf-track-dot',edited.has(id)?'◆':'◇');dot.style.color=colorFor(id);row.prepend(dot);row.title+=(edited.has(id)?' · 已微调':' · 原动作');item.append(visible,row);trackList.append(item);
    }trackList.scrollTop=scroll;
  }
  function drawGraph(all){
    grid.replaceChildren();curves.replaceChildren();points.replaceChildren();handles.replaceChildren();
    const nice = value => {const power=10**Math.floor(Math.log10(value)),fraction=value/power;return [1,2,5,10].find(n=>n>=fraction)*power;};
    const timeStep=nice(domain()/Math.max(2,plotWidth()/80)),valueStep=nice((p().max-p().min)/Math.max(2,plotHeight()/38));
    for(let i=Math.ceil(start/(timeStep/5));i<=Math.floor((start+domain())/(timeStep/5));i++){
      const at=i*timeStep/5,xx=x(at),major=i%5===0;grid.append(svg('line',{x1:xx,x2:xx,y1:top,y2:bottom(),class:major?'kf-grid':'kf-grid minor'}));
      if(major){const tick=svg('text',{x:xx,y:16,class:'kf-tick','text-anchor':'middle'});tick.textContent=at.toFixed(timeStep<1?2:1)+'s';grid.append(tick);}
    }
    for(let value=Math.ceil(p().min/valueStep)*valueStep;value<=p().max+.00001;value+=valueStep){const yy=y(value);grid.append(svg('line',{x1:left,x2:right(),y1:yy,y2:yy,class:Math.abs(value)<.00001?'kf-grid zero':'kf-grid'}));if(mode!=='keys'){const tick=svg('text',{x:left-9,y:yy+3.5,class:'kf-tick','text-anchor':'end'});tick.textContent=Number(value.toFixed(2));grid.append(tick);}}
    const visible=[...new Set([parameterId,...all.flatMap(k=>Object.keys(k.values)),...(mode==='all'?reference.tracks.map(t=>t.id):[])])].filter(id=>parameterMap.has(id)&&!hiddenTracks.has(id));
    const rowY=id=>top+12+visible.indexOf(id)*Math.min(24,(plotHeight()-12)/visible.length);
    for(const id of [...visible].reverse()){
      const rows=all.filter(k=>Number.isFinite(k.values[id])).sort((a,b)=>a.time-b.time), active=id===parameterId, param=parameterMap.get(id);
      const yy=value=>mode==='keys'?rowY(id):bottom()-clamp((value-param.min)/(param.max-param.min||1),0,1)*plotHeight();
      if(active||mode==='all'){const base=baseTracks.get(id);if(base){const d=Array.from({length:161},(_,i)=>{const at=start+i/160*domain();return`${i?'L':'M'}${x(at)} ${yy(samplePoseTracks(base.poses,at)[id])}`;}).join(' ');const path=svg('path',{d,fill:'none',class:'kf-native-curve'+(active?' active':''),'data-native-track':id});path.style.stroke=colorFor(id);curves.append(path);
        for(const k of active?base.keys:[]){const xx=x(k.time);if(xx>=left&&xx<=right())points.append(svg('circle',{cx:xx,cy:yy(k.value),r:3,class:'kf-native-point'}));}
      }}
      if(rows.length){const samples=rows.map(k=>({...k,values:{[id]:k.values[id]}}));const d=Array.from({length:121},(_,i)=>{const at=start+i/120*domain();return`${i?'L':'M'}${x(at)} ${yy(samplePoseTracks(samples,at)[id])}`;}).join(' ');curves.append(svg('path',{d,fill:'none',class:active?'kf-curve':'kf-curve kf-ghost'}));}
      for(const k of rows){const xx=x(k.time),v=yy(k.values[id]);if(xx<left-4||xx>right()+4)continue;const chosen=selectionPoints().some(pair=>pair.id===k.id&&pair.parameterId===id);const dot=svg('path',{d:`M ${xx} ${v-5} l 5 5 l -5 5 l -5 -5 Z`,class:`kf-point${chosen?' selected':''}${active?'':' ghost'}`,'data-key':k.id,'data-track':id,tabindex:'0',role:'button','aria-label':`${label(param)} ${k.time.toFixed(2)}s ${k.values[id].toFixed(2)}`});dot.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();selectPoints([{id:k.id,parameterId:id}]);change(engine.seek(k.time));}};points.append(dot);}
    }
    const rows=track(),a=selected(),b=rows[rows.findIndex(k=>k.id===selectedId)+1],selectedEase=easingOf(a),ease=editableEasing(selectedEase);
    if(mode!=='keys'&&!hiddenTracks.has(parameterId)&&selectionPoints().length===1&&a&&b&&selectedEase!=='hold')for(const i of[1,2]){const dt=b.time-a.time,native=ease.type==='hermite',xx=x(a.time+dt*(native?i/3:ease[`x${i}`])),yy=y(native?(i===1?a.values[parameterId]+ease.outSlope*dt/3:b.values[parameterId]-ease.inSlope*dt/3):a.values[parameterId]+(b.values[parameterId]-a.values[parameterId])*ease[`y${i}`]),anchor=i===1?a:b;handles.append(svg('line',{x1:x(anchor.time),y1:y(anchor.values[parameterId]),x2:xx,y2:yy,class:'kf-handle-line'}),svg('circle',{cx:xx,cy:yy,r:6,class:'kf-handle','data-handle':i}));}
  }
  function updateLive(){
    if(destroyed||!p())return;const all=keys(),rows=track();
    selectedPoints=selectedPoints.filter(pair=>all.some(k=>k.id===pair.id&&Number.isFinite(k.values[pair.parameterId])));
    if(selectedId&&!rows.some(k=>k.id===selectedId))selectPoints(selectedPoints);
    root.querySelector('.kf-summary-meta').textContent=tr(`${new Set(all.flatMap(k=>Object.keys(k.values))).size} 条轨道 · ${all.length} 个姿态记录`,`${all.length} pose keys`);
    if(!details.open)return;
    syncReference(); seedButton.hidden=rows.length>0; seedButton.disabled=!baseTracks.has(parameterId);
    root.querySelector('.kf-summary-meta').textContent=tr(`原动作曲线 · ${all.length} 个编辑记录`,`Native curves · ${all.length} edited keys`);
    start=clamp(start,0,Math.max(0,extent()-domain()));drawTracks(all);
    const signature=JSON.stringify([all,parameterId,selectedId,selectedPoints,mode,[...hiddenTracks],zoom,start,extent(),graphWidth,graphHeight]);if(signature!==lastGraph){lastGraph=signature;drawGraph(all);}
    marker.setAttribute('transform',`translate(${x(engine.getPlayback().time)},0)`);marker.style.display=x(engine.getPlayback().time)<left||x(engine.getPlayback().time)>right()?'none':'';
    curveMode.setAttribute('aria-pressed',String(mode==='curve'));allMode.setAttribute('aria-pressed',String(mode==='all'));keysMode.setAttribute('aria-pressed',String(mode==='keys'));zoomLabel.textContent=zoom.toFixed(1)+'×';
    const count=selectionPoints().length,k=selected(),next=k&&rows[rows.findIndex(row=>row.id===k.id)+1];selectionName.textContent=count>1?tr(`已选 ${count} 个节点`,`${count} selected keys`):label(p());
    timeInput.disabled=valueInput.disabled=count!==1||!k;removeButton.disabled=!count;easingSelect.disabled=count!==1||!next;
    removeButton.textContent=count>1?tr(`删除 ${count} 个节点`,`Delete ${count} keys`):tr('删除此关键帧','Delete key');
    if(document.activeElement!==durationInput)durationInput.value=engine.getPlayback().duration.toFixed(3);
    if(document.activeElement!==timeInput)timeInput.value=k?.time.toFixed(3)??'';if(document.activeElement!==valueInput)valueInput.value=k?.values[parameterId]?.toFixed(3)??'';
    valueInput.min=p().min;valueInput.max=p().max;const easing=easingOf(k);easingSelect.value=typeof easing==='object'?easing.type:easing;
  }
  updateLive();
  return{updateLive,focusParameter,destroy(){destroyed=true;observer.disconnect();latestMove=null;root.replaceChildren();}};
}
