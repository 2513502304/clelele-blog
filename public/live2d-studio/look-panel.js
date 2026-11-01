import { setControlValue } from './range-controls.js';
import { LOOK_CONTROLS, LOOK_RECIPES, normalizeLook } from './look-settings.js';
/** Persistent controls retain pointer capture; refresh values without replacing sliders. */
export function createLookPanel({state,onChange,onRecipe,onRanges}) {
 const $=s=>document.querySelector(s), panel=$('[data-tab-panel="filters"]'), editor=$('#filter-popover');
 editor.removeAttribute('popover');editor.className='look-editor';editor.hidden=true;
 const overview=[...panel.children].filter(el=>el!==editor);
 const heading=editor.querySelector('.popover-heading');heading.innerHTML='<button type="button" class="look-back">‹ 风格库</button><strong id="filter-panel-title">调整画面</strong><span class="look-active-count"></span>';
 const setView=open=>{editor.hidden=!open;overview.filter(el=>el.parentElement===panel).forEach(el=>el.hidden=open);panel.closest(".inspector-scroll").scrollTop=0;};
 heading.querySelector('button').onclick=()=>setView(false);
 const adjust=$('#adjust-filter');adjust.removeAttribute('data-popup');adjust.onclick=()=>setView(true);
 const restore=document.createElement('button');restore.className='look-restore';restore.textContent='还原配方';restore.title='恢复这套配方的色彩、光感、质感与动效；不修改人物、文字和背景';restore.onclick=()=>{const recipe=LOOK_RECIPES.find(r=>r.id===state.lookRecipe);if(recipe){onRecipe(recipe);refresh();}};heading.append(restore);
 $('#reset-filter').textContent='重置基础成像';
 const common=document.createElement('div');common.className='look-groups';
 const ground=document.createElement('details');ground.className='look-group';ground.open=true;
 ground.innerHTML='<summary>配方背景<small>保留原有背景</small></summary><label class="check-field"><input type="checkbox" data-look="groundEnabled">使用配方背景</label><div class="look-ground-colors"><label>上方<input type="color" data-look="ground" aria-label="配方背景上方"></label><label>下方<input type="color" data-look="ground2" aria-label="配方背景下方"></label></div><p class="hint">关闭后回到你的舞台背景。上传的图片和位置始终保留。</p>';
 for(const input of ground.querySelectorAll('input'))input.oninput=()=>{state.look=normalizeLook({...state.look,[input.dataset.look]:input.type==='checkbox'?input.checked:input.value});onChange();};
 common.append(ground);
 for(const [id,title,controls] of LOOK_CONTROLS){
  const group=document.createElement('details');group.className='look-group';group.open=id==='color';group.innerHTML=`<summary>${title}<small>独立调整</small></summary>`;
  for(const [key,label,min,max] of controls){
   const row=document.createElement('label');row.className='look-range';row.innerHTML=`<span>${label}</span><output></output><input type="range" min="${min}" max="${max}" step=".01" data-look="${key}" aria-label="${label}">`;
   row.querySelector('input').oninput=e=>{state.look=normalizeLook({...state.look,[key]:Number(e.target.value)});updateOutputs();onChange();};group.append(row);
  }
  if(id==='light')for(const [key,title] of [['lightColor','底光颜色'],['rimColor','轮廓光颜色']]){const label=document.createElement('label');label.className='look-color';label.innerHTML=`${title}<input type="color" data-look="${key}" aria-label="${title}">`;label.lastChild.oninput=e=>{state.look=normalizeLook({...state.look,[key]:e.target.value});onChange();};group.append(label);}
  common.append(group);
 }
 const basis=document.createElement('details');basis.className='look-group';basis.innerHTML='<summary>基础成像<small id="look-basis-name"></small></summary>';basis.append($('#filter-specific-controls'),editor.querySelector('.adjustment-section'));common.prepend(basis);
 const dynamic=document.createElement('details');dynamic.className='look-group';dynamic.open=true;dynamic.innerHTML='<summary>动态叠层<small>可同时开启</small></summary>';
 dynamic.append($('.effect-options'),$('.effect-transport'));
 const fx=$('#effects-popover');fx.removeAttribute('popover');fx.className='effect-tuning';fx.hidden=true;fx.querySelector('[data-close-popup]').remove();
 const launcher=panel.querySelector('[data-popup="effects-popover"]');launcher.removeAttribute('data-popup');launcher.className='effect-detail-launcher';launcher.onclick=()=>fx.hidden=!fx.hidden;
 const selector=document.createElement('label');selector.className='field';selector.innerHTML='正在调整<select id="effect-edit-target" aria-label="选择要调整的动效"></select>';dynamic.append(selector,launcher,fx);common.append(dynamic);editor.append(common);
 const footer=document.createElement('div');footer.className='look-footer';footer.innerHTML='<label class="look-range"><span>叠加调整强度</span><output></output><input type="range" data-look="mix" min="0" max="1" step=".01" aria-label="叠加调整强度"></label><button class="look-neutral">清除叠加调整</button>';
 footer.querySelector('input').oninput=e=>{state.look=normalizeLook({...state.look,mix:Number(e.target.value)});updateOutputs();onChange();};
 footer.querySelector('button').onclick=()=>{state.look=normalizeLook();refresh();onChange();};editor.append(footer);
 const recipes=document.createElement('div');recipes.className='look-recipes';
 for(const recipe of LOOK_RECIPES){const b=document.createElement('button');b.dataset.lookRecipe=recipe.id;b.style.setProperty('--recipe-color',recipe.color);b.innerHTML=`<span class="recipe-art"><img src="./thumbs/look-${recipe.id}.webp?v=16" alt="" loading="lazy"><i>${recipe.name.slice(0,2)}</i></span><strong>${recipe.name}</strong><small>${recipe.effects.length+Object.keys(recipe.look).length} 项组合</small>`;b.onclick=()=>{onRecipe(recipe);refresh();};recipes.append(b);}
 const title=document.createElement('div');title.className='section-title';title.innerHTML=`<h2>光影配方</h2><span class="source">RECIPES / ${LOOK_RECIPES.length}</span>`;
 panel.prepend(title,recipes);overview.push(title,recipes);
 // The effect library now belongs to the common adjustment page, not a second exclusive picker.
 for(const el of overview)if(el.tagName==='DIV'&&el.classList.contains('section-title')&&el.textContent.includes('动态氛围'))el.remove();
 function updateOutputs(){const look=normalizeLook(state.look);for(const input of editor.querySelectorAll('[data-look]')){if(input.type==='range')input.previousElementSibling.textContent=Math.round(look[input.dataset.look]*100)+'%';}const n=LOOK_CONTROLS.flatMap(g=>g[2]).filter(([key])=>look[key]!==0).length+(state.effects.enabled??[state.effects.type]).filter(x=>x!=='none').length;heading.querySelector('.look-active-count').textContent=n+' 项调整';}
 function refresh(){for(const b of recipes.children)b.setAttribute('aria-pressed',String(b.dataset.lookRecipe===state.lookRecipe));const recipe=LOOK_RECIPES.find(r=>r.id===state.lookRecipe);restore.hidden=!recipe;heading.querySelector('strong').textContent=recipe?.name||'调整画面';const look=normalizeLook(state.look);for(const input of editor.querySelectorAll('[data-look]')){if(input.type==='checkbox')input.checked=look[input.dataset.look];else setControlValue(input,look[input.dataset.look]);}$('#look-basis-name').textContent=$('#filter-summary').textContent;updateOutputs();onRanges?.(editor);}
 return {refresh,open:()=>setView(true),showEffect:()=>{setView(true);dynamic.open=true;fx.hidden=false;}};
}
