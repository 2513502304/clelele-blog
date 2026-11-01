/** Back-to-front document order; list presentation is topmost first, like a drawing editor. */
export function createSceneLayers({root, state, getActors, getText, selectActor, selectText, selectBackground, remove, setVisible, canEdit, onError, onChange, onHistory}) {
  // A row must be explicitly activated here. Canvas selection never grants delete authority.
  let signature = '', dragged = null, activeId = null, deleting = false;
  root.tabIndex = 0; root.setAttribute('aria-label', '作品图层');
  function clearActive() { if (activeId !== null) { activeId = null; render(); } }
  async function deleteActive() {
    if (!activeId || deleting || !canEdit()) return;
    const id = activeId; deleting = true;
    try { if (await remove(id)) { if (activeId === id) activeId = null; } }
    finally { deleting = false; render(); root.focus({preventScroll:true}); }
  }
  function order() {
    const actors = getActors(), texts = getText();
    const defaults = [...texts.filter(t => t.placement === 'back').map(t => `text:${t.id}`), ...actors.map(a => `actor:${a.id}`), ...texts.filter(t => t.placement !== 'back').map(t => `text:${t.id}`)];
    const present = new Set(defaults), old = state.layerOrder || defaults;
    state.layerOrder = [...new Set(old.filter(id => present.has(id)))];
    for (const id of defaults) if (!state.layerOrder.includes(id)) {
      if (id.startsWith('text:') && texts.find(t => `text:${t.id}` === id)?.placement === 'back') state.layerOrder.unshift(id);
      else state.layerOrder.push(id);
    }
    return [...state.layerOrder];
  }
  function reorder(id, beforeId) {
    const current = order(); if (id === beforeId || !current.includes(id)) return;
    onHistory('begin'); const frontFirst = current.reverse().filter(key => key !== id);
    const at = beforeId ? frontFirst.indexOf(beforeId) : frontFirst.length;
    frontFirst.splice(at < 0 ? frontFirst.length : at, 0, id); state.layerOrder = frontFirst.reverse();
    onChange(); onHistory('commit'); render();
  }
  function step(id, delta) {
    const rows = order(), index = rows.indexOf(id), next = index + delta;
    if (index < 0 || next < 0 || next >= rows.length) return;
    onHistory('begin'); [rows[index],rows[next]] = [rows[next],rows[index]]; state.layerOrder = rows;
    onChange(); onHistory('commit'); render();
  }
  function render() {
    const actors = getActors(), text = getText(), rows = order().reverse();
    if (activeId && activeId !== 'background' && !rows.includes(activeId)) activeId = null;
    const next = JSON.stringify([rows,activeId,deleting,state.background.type,actors.map(a=>[a.id,a.name,a.visible]),text.map(t=>[t.id,t.text,t.hidden])]);
    if (next === signature) return; signature = next;
    const scroll = root.scrollTop; root.replaceChildren();
    for (const id of [...rows,'background']) {
      const actor = actors.find(a => `actor:${a.id}` === id), layer = text.find(t => `text:${t.id}` === id);
      const background = id === 'background', visible = actor ? actor.visible !== false : !layer?.hidden;
      const row = document.createElement('div'); row.className = 'scene-layer-row'; row.dataset.layerId = id; row.draggable = !background;
      row.classList.toggle('is-active', id === activeId); row.classList.toggle('is-hidden', !visible);
      const pick = document.createElement('button'); pick.className = 'scene-layer-select'; pick.type = 'button';
      const icon = document.createElement('span'), title = document.createElement('span'); icon.className = 'scene-layer-icon'; icon.textContent = background ? '▧' : actor ? '♙' : 'T';
      title.textContent = background ? '背景' : actor?.name || layer?.text.replaceAll('\n',' ') || '文字'; pick.append(icon,title);
      pick.title = background ? '背景固定在最底层；删除后变为透明' : '激活此图层'; pick.setAttribute('aria-pressed',String(id === activeId));
      pick.onclick = () => {
        if (!canEdit()) return;
        activeId = id;
        if (background) selectBackground(); else if (actor) selectActor(actor.id); else selectText(layer.id);
        render(); root.querySelector(`[data-layer-id="${id}"] .scene-layer-select`)?.focus({preventScroll:true});
      };
      row.append(pick);
      if (!background) {
        const eye = document.createElement('button'); eye.type='button'; eye.className='scene-layer-visibility';
        eye.textContent=visible?'隐藏':'显示'; eye.setAttribute('aria-label',`${eye.textContent} ${title.textContent}`); eye.setAttribute('aria-pressed',String(visible));
        eye.onclick=()=>{if(canEdit()) Promise.resolve(setVisible(id,!visible)).then(render).catch(onError);}; row.append(eye);
      }
      const tools = document.createElement('div'); tools.className='scene-layer-tools'; tools.hidden = id !== activeId;
      if (!background) for (const [symbol,delta,label] of [['↑',1,'前移一层'],['↓',-1,'后移一层']]) { const b = document.createElement('button'); b.type='button'; b.textContent=symbol; b.title=label; b.setAttribute('aria-label',label); b.onclick=()=>{if(canEdit())step(id,delta);}; tools.append(b); }
      const del = document.createElement('button'); del.type='button'; del.className='scene-layer-delete'; del.textContent='删除';
      del.disabled = id !== activeId || deleting || (background && state.background.type === 'transparent');
      del.title = '删除选中的图层，可撤销';
      del.onclick=()=>{if(id===activeId)deleteActive().catch(onError);}; tools.append(del); row.append(tools);
      row.ondragstart=e=>{dragged=id;e.dataTransfer.setData('text/plain',id);e.dataTransfer.effectAllowed='move';row.classList.add('dragging');};
      row.ondragover=e=>{if(!dragged)return;e.preventDefault();const lower=e.clientY>row.getBoundingClientRect().top+row.offsetHeight/2;row.classList.toggle('drop-before',!lower);row.classList.toggle('drop-after',lower);};
      row.ondragleave=()=>row.classList.remove('drop-before','drop-after');
      row.ondrop=e=>{e.preventDefault();const lower=e.clientY>row.getBoundingClientRect().top+row.offsetHeight/2;row.classList.remove('drop-before','drop-after');if(dragged&&dragged!==id){const front=order().reverse().filter(key=>key!==dragged);reorder(dragged,lower?front[front.indexOf(id)+1]:id);}dragged=null;};
      row.ondragend=()=>{dragged=null;root.querySelectorAll('.drop-before,.drop-after,.dragging').forEach(n=>n.classList.remove('drop-before','drop-after','dragging'));};
      root.append(row);
    }
    root.scrollTop=scroll;
  }
  return {order,render,step,reorder,clearActive,deleteActive,getActive:()=>activeId};
}
