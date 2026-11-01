/** Original deterministic scene effects: one clock supplied by the editor/exporter. */
export const EFFECT_OPTIONS = [
  {id:'none',name:'无动效',nameEn:'None',description:'保留纯净的原始画面。'},
  {id:'sakura',name:'花信',nameEn:'Petals',description:'花瓣轻轻转动、飘落，让定格的画面也有风。',color:'#eda5bc'},
  {id:'rain',name:'雨幕',nameEn:'Rain',description:'远近雨线与轻柔水光；不改变人物姿态。',color:'#b6d9ec'},
  {id:'snow',name:'初雪',nameEn:'Snow',description:'大小不一的雪点，分层缓缓落下。',color:'#ffffff'},
  {id:'bokeh',name:'浮光',nameEn:'Bokeh',description:'柔焦光斑缓慢漂移、呼吸，适合温柔的近景。',color:'#ffdaaa'},
  {id:'leak',name:'漏光',nameEn:'Light leak',description:'画面边缘的暖色光漏，随时间舒展。',color:'#ff9569'},
  {id:'sparkle',name:'星尘',nameEn:'Stardust',description:'闪烁星芒与细小光点，点缀人物周围。',color:'#fff4cb'},
  {id:'crt',name:'旧映像',nameEn:'Analog',description:'缓慢滚动的扫描线、轻微色散与画面扰动。',color:'#cbd8ed',gpu:true},
  {id:'glitch',name:'失真',nameEn:'Glitch',description:'短促的水平错位与色彩分离，强度越低越克制。',color:'#c39de9',gpu:true},
  {id:'neon',name:'霓光',nameEn:'Neon pulse',description:'青粉光线缓缓掠过画面，边缘出现呼吸般的色光。',color:'#ef8dd1',gpu:true},
  {id:'speedlines',name:'心跳',nameEn:'Impact',description:'由画面中心向外展开的漫画冲击线。',color:'#604b66'},
  {id:'grid',name:'格线',nameEn:'Grid',description:'静态细网格；与预览用的构图辅助线不同，会随作品导出。'},
  {id:'aurora',name:'极光',nameEn:'Aurora',description:'柔和光带缓慢起伏，留下人物周围的暗部。',color:'#63dac9'},
  {id:'confetti',name:'彩纸',nameEn:'Confetti',description:'多色纸片在不同景深中翻转飘落，像一场演出的安可。',color:'#ee85af'},
];
// Per-effect values are retained separately so changing an effect never destroys its tuning.
const range=(key,label,min,max,value,help)=>({key,label,min,max,step:.01,value,help});
const size=range('size','尺寸',.2,6,1,'越大，粒子或光斑越大；数量保持不变。');
const wind=range('wind','风向与横向速度',-5,5,0,'负值向左，正值向右；零保留轻微自然摇摆。');
const spread=range('spread','扩散范围',.1,4,1,'越大，光场覆盖范围越宽。');
const pulse=range('pulse','呼吸幅度',0,4,1,'零保持稳定；越大，明暗变化越明显。');
export const EFFECT_CONTROLS={
 none:[],sakura:[size,wind,range('spin','旋转速度',0,6,1,'控制花瓣自身翻转，不改变下落速度。')],
 rain:[range('length','雨线长度',.2,8,1,'越大，雨线拖影越长。'),wind,range('ripples','涟漪强度',0,1,.3,'零关闭涟漪；越大，落地水环越明显。')],
 snow:[size,wind],bokeh:[size,wind,pulse],leak:[spread,pulse],sparkle:[size,pulse],
 aurora:[spread,pulse],confetti:[size,wind,range('spin','翻转速度',0,6,1,'控制纸片翻转，不改变落下速度。')],
 speedlines:[range('centerX','冲击中心 · 左右',0,1,.5,'0 在左侧，1 在右侧。'),range('centerY','冲击中心 · 上下',0,1,.5,'0 在上方，1 在下方。'),range('gap','中心留白',.05,.65,.23,'越大，人物周围的空白越宽。'),size,pulse],
 grid:[range('width','线条粗细',.3,4,1,'越大，格线越粗。')],
 crt:[range('chroma','色彩分离',0,8,1,'零关闭色散；越大，红蓝边缘的距离越大。'),range('jitter','水平扰动',0,8,1,'零关闭横向抖动；越大，故障位移越明显。'),range('scan','扫描线',0,6,1,'零关闭扫描线；越大，明暗条纹越强。')],
 glitch:[range('chroma','色彩分离',0,8,1,'红蓝通道分离的距离。'),range('jitter','故障位移',0,8,1,'零关闭横向位移；越大，图像错位越明显。')],
 neon:[range('spread','边缘光范围',.1,4,1,'越大，边缘光越往画面中间扩散。'),range('pulse','呼吸幅度',0,4,1,'零保持稳定的色光；越大，明暗起伏越明显。')],
};
export function effectDetails(settings={}) {
 const values=settings.details?.[settings.type]||{};
 return Object.fromEntries((EFFECT_CONTROLS[settings.type]||[]).map(c=>[c.key,bounded(values[c.key],c.min,c.max,c.value)]));
}
export const DEFAULT_EFFECTS = Object.freeze({type:'none',count:32,speed:.6,strength:.65,seed:17,placement:'front',color:'#edb2c8',animate:true,details:{}});
const bounded=(v,a,b,d)=>Number.isFinite(Number(v))?Math.min(b,Math.max(a,Number(v))):d;
const fract=v=>v-Math.floor(v);
const random=(i,c,s)=>fract(Math.sin(i*127.1+c*311.7+s*13.3)*43758.5453123);
export function normalizeEffects(v={}) {return {colors:Object.fromEntries(Object.entries(v.colors||{}).filter(([k,c])=>EFFECT_OPTIONS.some(e=>e.id===k)&&/^#[0-9a-f]{6}$/i.test(c))),enabled:Array.isArray(v.enabled)?[...new Set(v.enabled.filter(id=>id!=='none'&&EFFECT_OPTIONS.some(e=>e.id===id)))]:undefined,type:EFFECT_OPTIONS.some(x=>x.id===v.type)?v.type:'none',count:Math.round(bounded(v.count,4,160,32)),speed:bounded(v.speed,0,4,.6),strength:bounded(v.strength,0,1,.65),seed:bounded(v.seed,-1e5,1e5,17),placement:v.placement==='back'?'back':'front',color:/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(v.color)?(v.color.length===4?'#'+[...v.color.slice(1)].map(c=>c+c).join(''):v.color):'#edb2c8',animate:v.animate!==false,details:Object.fromEntries(EFFECT_OPTIONS.map(({id})=>[id,effectDetails({...v,type:id})]))};}
export function isAnimatedEffect(settings) {const e=normalizeEffects(settings);return (e.enabled??[e.type]).some(id=>!['none','grid'].includes(id))&&e.speed>0&&e.strength>0&&e.animate;}
export function isGpuEffect(settings) {return (settings?.enabled??[settings?.type]).some(id=>['crt','glitch','neon'].includes(id));}
/** Resolution-independent geometry makes export and preview use the same field. No per-effect RAF. */
export function paintEffects(ctx,w,h,settings=DEFAULT_EFFECTS,time=0,placement='front') {
 if(Array.isArray(settings.enabled)){for(const type of settings.enabled){const color=settings.colors?.[type]??EFFECT_OPTIONS.find(e=>e.id===type)?.color??settings.color;paintEffects(ctx,w,h,{...settings,enabled:undefined,type,color:type===settings.type?settings.color:color,count:Math.min(settings.count,Math.floor(240/Math.max(1,settings.enabled.length)))},time,placement);}return;}
 const e=normalizeEffects(settings);if(!ctx||w<=0||h<=0||e.type==='none'||!e.strength||e.placement!==placement||isGpuEffect(e))return;
 const detail=effectDetails(e),sz=detail.size??1,wind=detail.wind??0,pulse=detail.pulse??1;const t=(Number.isFinite(time)?time:0)*e.speed;ctx.save();
 try{ctx.globalCompositeOperation='source-over';ctx.shadowBlur=0;ctx.fillStyle=ctx.strokeStyle=e.color;
 if(e.type==='grid'){const space=h/Math.max(4,Math.round(e.count/2));ctx.globalAlpha*=e.strength*.3;ctx.lineWidth=h/1400*(detail.width??1);ctx.beginPath();for(let x=space/2;x<w;x+=space){ctx.moveTo(x,0);ctx.lineTo(x,h);}for(let y=space/2;y<h;y+=space){ctx.moveTo(0,y);ctx.lineTo(w,y);}ctx.stroke();return;}
 if(e.type==='leak'){for(let i=0;i<3;i++){const x=(i===1?w:0)+Math.sin(t*.31+i*2)*w*.17,y=h*(.2+i*.3+Math.sin(t*.29+i)*.18),r=h*(.45+Math.sin(t*.22+i)*.1)*(detail.spread??1);const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,e.color+'99');g.addColorStop(.4,e.color+'48');g.addColorStop(1,e.color+'00');ctx.fillStyle=g;ctx.globalAlpha=Math.max(0,Math.min(1,e.strength*(.55+.2*Math.sin(t*.8+i)*pulse)));ctx.fillRect(0,0,w,h);}return;}
 if(e.type==='aurora'){
  // A fixed number of ribbon segments bounds work independently of canvas size.
  ctx.globalCompositeOperation='screen';
  for(let band=0;band<3;band++)for(let i=0;i<48;i++){
   const x=w*i/47,y=h*(.16+band*.18+Math.sin(i*.075+t*.38+band*1.8)*.12),r=h*.2*(detail.spread??1);
   const g=ctx.createLinearGradient(0,y,0,y+r);g.addColorStop(0,e.color+'00');g.addColorStop(.2,e.color+'60');g.addColorStop(1,e.color+'00');
   ctx.globalAlpha=e.strength*Math.max(.05,.22+Math.sin(t*.4+band)*.08*pulse);ctx.fillStyle=g;ctx.fillRect(x-w/48,y,w/24,r);
  }return;
 }
 for(let i=0;i<e.count;i++){const a=random(i,1,e.seed),b=random(i,2,e.seed),c=random(i,3,e.seed);let x=fract(a+t*wind*.04+Math.sin(t*.7+b*6.28)*.025)*w,y=fract(b+t*(.045+c*.04))*h,r=h*(.004+c*.006)*sz;ctx.save();ctx.globalAlpha*=e.strength*(.35+.5*c);
 if(e.type==='rain'){x=fract(a+t*wind*.08)*w;y=fract(b+t*(.28+c*.3))*h;ctx.lineWidth=h*(.0005+c*.0006);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-h*wind*.015,y-h*(.035+c*.045)*detail.length);ctx.stroke();if(detail.ripples>0){const age=fract(t*.7+a*5);ctx.globalAlpha*=detail.ripples*(1-age);ctx.beginPath();ctx.ellipse(a*w,h*(.6+b*.4),h*.03*age,h*.008*age,0,0,Math.PI*2);ctx.stroke();}}
 else if(e.type==='snow'){x=fract(a+t*wind*.03+Math.sin(t*.35+b*9)*.04)*w;y=fract(b+t*(.015+c*.032))*h;r=h*(.0016+c*.004)*sz;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
 else if(e.type==='bokeh'){x=fract(a+t*wind*.02+Math.sin(t*.15+b*9)*.06)*w;y=fract(b-t*(.007+c*.011))*h;r=h*(.018+c*.055)*sz;const g=ctx.createRadialGradient(x,y,r*.05,x,y,r);g.addColorStop(0,e.color+'9a');g.addColorStop(.45,e.color+'45');g.addColorStop(1,e.color+'00');ctx.fillStyle=g;ctx.globalAlpha*=Math.min(1,Math.max(0,.7+Math.sin(t*.6+a*8)*.3*pulse));ctx.fillRect(x-r,y-r,r*2,r*2);}
 else if(e.type==='sparkle'){const twinkle=Math.min(1,Math.max(0,1-pulse*.5+Math.sin(t*(.8+c)+a*12)*pulse*.5));r=h*(.002+c*.007)*sz*(.3+twinkle);ctx.globalAlpha*=twinkle;ctx.translate(x,y);ctx.beginPath();ctx.moveTo(-r*2,0);ctx.quadraticCurveTo(0,0,0,-r*2);ctx.quadraticCurveTo(0,0,r*2,0);ctx.quadraticCurveTo(0,0,0,r*2);ctx.quadraticCurveTo(0,0,-r*2,0);ctx.fill();}
 else if(e.type==='speedlines'){const angle=a*Math.PI*2,inner=detail.gap+b*.16+Math.sin(t*4+c*9)*.035*pulse,outer=.8;ctx.translate(w*detail.centerX,h*detail.centerY);ctx.rotate(angle);ctx.globalAlpha*=Math.min(1,Math.max(0,.5+Math.sin(t*3+b*9)*.25*pulse));ctx.beginPath();ctx.moveTo(h*inner,0);ctx.lineTo(h*outer,-h*(.0008+c*.0015)*sz);ctx.lineTo(h*outer,h*(.0008+c*.0015)*sz);ctx.closePath();ctx.fill();}
 else if(e.type==='confetti'){ctx.translate(x,y);ctx.rotate(a*6.28+t*(.4+b)*(detail.spin??1));ctx.scale(.2+.8*Math.abs(Math.cos(t*(detail.spin??1)+a*7)),1);ctx.fillStyle=[e.color,'#f4da83','#76c8d3','#b79ad9','#f9eee0'][i%5];ctx.fillRect(-r,-r*.4,r*2,r*.8);}
 else{ctx.translate(x,y);ctx.rotate(a*6.28+t*(.5+b)*(detail.spin??1));ctx.scale(.35+.65*Math.abs(Math.cos(t*.8*(detail.spin??1)+a*7)),1);ctx.beginPath();ctx.moveTo(0,-r);ctx.bezierCurveTo(r*1.1,-r*.8,r*.95,r*.7,0,r*1.4);ctx.bezierCurveTo(-r*.95,r*.7,-r*1.1,-r*.8,0,-r);ctx.fill();}ctx.restore();}
 }finally{ctx.restore();}
}
/** One bounded preview clock; hidden/static/export states cancel work, without waking a paused model. */
export function createEffectClock({isActive,draw,fps=24}) {
 let frame=0,last=0,painted=0,time=0,disposed=false;
 function tick(now){frame=0;if(disposed||document.hidden||!isActive()){last=0;return;}if(last)time+=Math.min(.1,(now-last)/1000);last=now;if(now-painted>=1000/fps){painted=now;draw(time);}frame=requestAnimationFrame(tick);}
 const sync=()=>{if(disposed||document.hidden||!isActive()){cancelAnimationFrame(frame);frame=0;last=0;}else if(!frame)frame=requestAnimationFrame(tick);};
 document.addEventListener('visibilitychange',sync);
 return{sync,get time(){return time;},setTime(v){time=Math.max(0,Number(v)||0);last=0;},dispose(){disposed=true;cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',sync);}};
}
