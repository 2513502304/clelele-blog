/** Layout is a browser preference, not artwork: resizing never enters undo or reloads a model. */
export function installWorkspaceLayout(app) {
  const workspace=app.querySelector('.workspace'), key='clelele-studio-panels-v1';
  let settings={left:268,right:330,leftHidden:false,rightHidden:false}, gesture;
  try{Object.assign(settings,JSON.parse(localStorage.getItem(key)||'{}'));}catch{}
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number(v)||a));
  const panelFor=side=>app.querySelector(side==='left'?'#model-panel':'#inspector');
  const isHidden=side=>app.dataset.layout==='canvas'?!panelFor(side).classList.contains('is-open'):settings[side+'Hidden'];
  function apply(){
    const available=Math.max(520,workspace.clientWidth-390);
    settings.left=clamp(settings.left,220,Math.min(430,available-260));settings.right=clamp(settings.right,260,Math.min(490,available-settings.left));
    app.style.setProperty('--library-width',settings.left+'px');app.style.setProperty('--inspector-width',settings.right+'px');
    for(const side of ['left','right']){const hidden=isHidden(side),h=app.querySelector('.panel-resizer.'+side);h?.setAttribute('aria-valuenow',String(settings[side]));h?.setAttribute('aria-valuemin',side==='left'?'220':'260');h?.setAttribute('aria-valuemax',side==='left'?'430':'490');app.dataset[side+'Hidden']=String(hidden);const b=app.querySelector('[data-toggle-panel='+side+']');b.setAttribute('aria-pressed',String(!hidden));b.title=(hidden?'显示':'隐藏')+(side==='left'?'人物侧栏':'画面侧栏');}
  }
  const save=()=>{try{localStorage.setItem(key,JSON.stringify(settings));}catch{}};
  for(const side of ['left','right']){
    const panel=app.querySelector(side==='left'?'#model-panel':'#inspector');
    const toggle=document.createElement('button');toggle.dataset.togglePanel=side;toggle.className='panel-toggle';toggle.innerHTML=side==='left'?'<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>':'<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/></svg>';toggle.setAttribute('aria-label',side==='left'?'显示/隐藏人物侧栏':'显示/隐藏画面侧栏');
    app.querySelector('.variant-switch').append(toggle);
    toggle.onclick=()=>{const show=isHidden(side);if(app.dataset.layout!=='canvas')settings[side+'Hidden']=!show;panel.classList.toggle('is-open',show);apply();save();};
    const handle=document.createElement('div');handle.className='panel-resizer '+side;handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label',side==='left'?'调整人物侧栏宽度':'调整画面侧栏宽度');panel.after(handle);
    const finish=()=>{if(!gesture)return;gesture=null;app.classList.remove('resizing-panels');save();};
    handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();gesture={id:e.pointerId,start:e.clientX,width:settings[side]};handle.setPointerCapture(e.pointerId);app.classList.add('resizing-panels');};
    handle.onpointermove=e=>{if(gesture?.id!==e.pointerId)return;settings[side]=gesture.width+(e.clientX-gesture.start)*(side==='left'?1:-1);apply();};
    for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(type,finish);
    handle.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home'].includes(e.key))return;e.preventDefault();settings[side]=e.key==='Home'?(side==='left'?268:330):settings[side]+(e.key==='ArrowRight'?16:-16)*(side==='left'?1:-1);apply();save();};
    handle.ondblclick=()=>{settings[side]=side==='left'?268:330;apply();save();};
  }
  app.addEventListener('click',e=>{const rail=e.target.closest('button[data-rail],button[data-tab],button[data-actor-page]');if(!rail)return;const side=['model','actions','pose'].includes(rail.dataset.rail||rail.dataset.actorPage)?'left':'right';settings[side+'Hidden']=false;apply();save();});
  // Floating tools can also be opened from the canvas selection or bottom toolbar.
  // Observe only visibility/layout attributes, never artwork or per-frame DOM updates.
  const visibility=new MutationObserver(apply);
  for(const side of ['left','right'])visibility.observe(panelFor(side),{attributes:true,attributeFilter:['class']});
  visibility.observe(app,{attributes:true,attributeFilter:['data-layout']});
  window.addEventListener('resize',apply);apply();
}
