import { FONT_OPTIONS, paintTextLayers, ensurePosterFonts, getTextLayerBounds } from './poster.js';

/** Move controls once; thumbnails use the same font and painter as the exported artwork. */
export function installTextInspector(detail,{apply}){
 const $=s=>detail.querySelector(s), pages={};
 const strip=document.createElement('div');strip.className='text-style-strip';strip.setAttribute('aria-label','文字样式预设');
 const presets=[
 ['刊头','Aa',{font:'serif',style:'fill',color:'#63394b',tracking:-.025,lineHeight:1}],
 ['霓虹','NEON',{font:'condensed',style:'neon',color:'#fff4ff',accent:'#f05cbc',glow:.35,tracking:.04}],
 ['漫画','POP!',{font:'rounded',style:'comic',color:'#ffdf65',accent:'#28202c',stroke:.1,tracking:.02}],
 ['签名','Love',{font:'script',style:'fill',color:'#8c4b6c',italic:false,tracking:0}],
 ['渐变','HUE',{font:'condensed',style:'fill',color:'#ff809a',gradient:true,gradientColor:'#7978dd',tracking:.04}],
 ['纸签','NOTE',{font:'rounded',style:'fill',color:'#47343e',backgroundShape:'rounded',backgroundColor:'#fff0cc',backgroundOpacity:.95,padding:.16}],
 ['贴纸','HEY!',{font:'rounded',style:'comic',color:'#e56691',accent:'#ffffff',stroke:.11,shadowOpacity:.3,shadowDistance:.06}],
 ['字幕','STORY',{font:'rounded',style:'shadow',color:'#ffffff',backgroundShape:'rounded',backgroundColor:'#211b22',backgroundOpacity:.65,padding:.14}],
 ['手书','春日来信',{font:'brush',style:'fill',color:'#783f51',tracking:.04}],
 ['题签','我们的故事',{font:'xiaowei',style:'fill',color:'#f7f0e5',backgroundShape:'box',backgroundColor:'#863c54',padding:.24}],
 ['气泡','一起演奏！',{font:'kuaile',style:'comic',color:'#ffffff',accent:'#28202c',stroke:.04,backgroundShape:'bubble',backgroundColor:'#f4b9cf',padding:.2}],
 ['圆体','每个小小瞬间',{font:'chill',style:'fill',color:'#385f63',backgroundShape:'marker',backgroundColor:'#cde5d3',padding:.12}],
 ];
 const neutral={gradient:false,backgroundShape:'none',shadowOpacity:0,bold:false,italic:false,stroke:0,glow:0,tracking:0,lineHeight:1.05};
 const samples=[];
 for(const[name,sample,settings]of presets){
  const b=document.createElement('button'),canvas=document.createElement('canvas'),label=document.createElement('small');
  b.type='button';b.setAttribute('aria-label',name+'文字样式');label.textContent=name;canvas.setAttribute('aria-hidden','true');
  b.append(canvas,label);b.onclick=()=>apply({...neutral,...settings});strip.append(b);
  samples.push({canvas,layer:{...neutral,...settings,text:sample}});
 }
 const tabs=document.createElement('div');tabs.className='text-subtabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','文字属性');
 const content=document.createElement('div');content.className='text-property-pages';
 for(const[key,label]of [['font','字体'],['color','颜色'],['effects','效果'],['background','背景'],['position','位置']]){
  const page=document.createElement('section');page.className='text-property-page';page.id='text-page-'+key;page.setAttribute('role','tabpanel');page.setAttribute('aria-label',label);page.hidden=key!=='font';pages[key]=page;content.append(page);
  const b=document.createElement('button');b.textContent=label;b.setAttribute('role','tab');b.setAttribute('aria-controls',page.id);b.setAttribute('aria-selected',String(!page.hidden));b.dataset.textPage=key;b.onclick=()=>{for(const[k,p]of Object.entries(pages))p.hidden=k!==key;for(const t of tabs.children)t.setAttribute('aria-selected',String(t===b));};tabs.append(b);
 }
 const fontSelect=$('#poster-font');
 const move=(key,ids)=>ids.forEach(id=>{const input=$('#poster-'+id);if(input)pages[key].append(input.closest('label'));});
 move('font',['font','size','italic','align','tracking','lineHeight']);move('color',['color','opacity']);move('effects',['style','accent','stroke','glow']);move('position',['layer','x','y','rotation']);
 const fontGrid=document.createElement('div');fontGrid.className='text-font-grid';fontGrid.setAttribute('aria-label','字体');
 fontSelect.closest('label').hidden=true;
 for(const font of FONT_OPTIONS){const b=document.createElement('button'),sample=document.createElement('strong'),label=document.createElement('small');b.type='button';b.dataset.fontChoice=font.id;sample.textContent=({serif:'Bodoni',condensed:'HEADLINE',script:'Signature',rounded:'Soft days'})[font.id]||font.label;label.textContent=font.label;b.title=font.name;sample.style.fontFamily=`"${font.family}", "寒蝉全圆体", sans-serif`;sample.style.fontWeight=font.weight;b.append(sample,label);b.onclick=()=>{fontSelect.value=font.id;fontSelect.dispatchEvent(new Event('input',{bubbles:true}));};fontGrid.append(b);}
 pages.font.prepend(fontGrid);
 const bold=document.createElement('label');bold.className='check-field';bold.innerHTML='<input type="checkbox" id="poster-bold">加粗';pages.font.querySelector('#poster-italic').closest('label').before(bold);
 const preview=document.createElement('canvas');preview.className='text-live-preview';preview.setAttribute('aria-label','当前文字样式预览');pages.font.prepend(preview);
 const range=(key,label,min,max,value)=>`<label class="range-field">${label}<output id="poster-${key}-output"></output><input type="range" id="poster-${key}" min="${min}" max="${max}" value="${value}" step="1"></label>`;
 pages.color.insertAdjacentHTML('beforeend','<label class="check-field"><input type="checkbox" id="poster-gradient">双色渐变</label><label class="field">渐变终点<input type="color" id="poster-gradientColor" value="#8785df"></label>');
 const palette=document.createElement('div');palette.className='text-palette';palette.setAttribute('aria-label','常用文字颜色');
 for(const color of ['#ffffff','#f6eee4','#1e1a23','#663c50','#b33f64','#e96b8f','#f3b2c6','#ffdf65','#c48f48','#398e79','#53b6c8','#6e89d3','#9673cf','#b9b1c6']){const b=document.createElement('button');b.type='button';b.style.background=color;b.title=color;b.setAttribute('aria-label','文字颜色 '+color);b.dataset.textColor=color;b.onclick=()=>{const input=$('#poster-color');input.value=color;input.dispatchEvent(new Event('input',{bubbles:true}));};palette.append(b);}pages.color.prepend(palette);
 pages.effects.insertAdjacentHTML('beforeend',range('shadowOpacity','投影不透明度',0,100,0)+range('shadowBlur','投影柔和度',0,60,10)+range('shadowDistance','投影距离',0,60,3)+range('shadowAngle','投影方向',-180,180,45));
 pages.background.innerHTML='<label class="field">背景形状<select id="poster-backgroundShape"><option value="none">无</option><option value="box">方框</option><option value="rounded">圆角纸签</option><option value="bubble">对话气泡</option><option value="marker">记号笔</option></select></label><label class="field">背景颜色<input id="poster-backgroundColor" type="color" value="#fff0cc"></label>'+range('backgroundOpacity','背景不透明度',0,100,90)+range('padding','文字边距',0,50,16);
 pages.position.append($('#text-drag'));pages.position.insertAdjacentHTML('beforeend','<p class="hint">画布上拖动文字可移动，拖动四角可缩放。前后关系也可在图层列表中调整。</p>');
 detail.querySelectorAll('.two-fields,.text-finish,.hint').forEach(el=>{if(!el.classList.contains('hint')||!el.closest('.text-property-page'))el.remove();});
 detail.append(strip,tabs,content);
 let previewLayer=null,previewTimer=0,previewVersion=0,lastPreview='',samplesReady=false;
 /** Fit actual glyph bounds, including shadows, without changing the user's font size. */
 function paintPreview(canvas,source){
  canvas.width=400;canvas.height=180;const ctx=canvas.getContext('2d');
  ctx.fillStyle=['neon','shadow'].includes(source.style)?'#322c3a':'#eee6e2';ctx.fillRect(0,0,400,180);
  const layer={...source,text:String(source.text||'文字 Aa').slice(0,40),size:.3,x:.5,y:.2,rotation:0,placement:'front',align:'center',opacity:1,hidden:false};
  const bounds=getTextLayerBounds(ctx,400,180,layer);if(!bounds)return;
  const scale=Math.min(1,350/Math.max(1,bounds.width),130/Math.max(1,bounds.height));
  ctx.save();ctx.translate(200,90);ctx.scale(scale,scale);ctx.translate(-bounds.x-bounds.width/2,-bounds.y-bounds.height/2);paintTextLayers(ctx,400,180,[layer],'front');ctx.restore();
 }
 const observer=new IntersectionObserver(async entries=>{
  if(!entries.some(e=>e.isIntersecting))return;
  if(!samplesReady){samplesReady=true;try{await ensurePosterFonts(samples.map(s=>s.layer));for(const s of samples)paintPreview(s.canvas,s.layer);}catch(error){samplesReady=false;console.error(error);}}
  refreshPreview(previewLayer);
 });observer.observe(strip);
 function refreshPreview(layer){
  previewLayer=layer?{...layer}:null;
  if(!layer||detail.hidden)return;
  const key=JSON.stringify(layer);if(key===lastPreview)return;
  clearTimeout(previewTimer);const version=++previewVersion;
  previewTimer=setTimeout(async()=>{try{await ensurePosterFonts([layer]);if(version!==previewVersion)return;paintPreview(preview,layer);lastPreview=key;}catch(error){console.error(error);}},80);
 }
 return {refreshPreview,sync(layer){for(const key of ['gradient','bold'])$('#poster-'+key).checked=!!layer[key];for(const button of fontGrid.children)button.setAttribute('aria-pressed',String(button.dataset.fontChoice===layer.font));for(const button of palette.children)button.setAttribute('aria-pressed',String(button.dataset.textColor===layer.color));refreshPreview(layer);}};
}
