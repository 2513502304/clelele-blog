import { MODELS, portrait } from './model-catalog.js';

/** Metadata-only character groups; scrolling reveals thumbnails, never model textures. */
export function createModelPicker({ root, search, count, more, select, getSelected }) {
  const groups = Map.groupBy(MODELS, model => model.name);
  let observer;
  const normalize = text => text.toLocaleLowerCase().replace(/\s+/g, '');
  // Most source portraits are 96 px. Keep them square and small enough for Retina,
  // instead of stretching a face crop into a costume-card-sized image.
  const portraitImage = (model, size) => {
    const image = document.createElement('img'); image.src = portrait(model.id);
    image.alt = ''; image.width = image.height = size; image.loading = 'lazy'; image.decoding = 'async';
    return image;
  };
  const card = model => {
    const button = document.createElement('button'); button.className = 'model-card'; button.dataset.model = model.id;
    const image = portraitImage(model, 48);
    const avatar = document.createElement('span'); avatar.className = 'portrait catalog-portrait'; avatar.append(image);
    const copy = document.createElement('span'); copy.className = 'model-copy'; const title = document.createElement('strong'); title.textContent = model.costume;
    const mark = document.createElement('span'); mark.className = 'model-check'; mark.setAttribute('aria-hidden','true');
    mark.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none"><path d="m3 8 3 3 7-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    copy.append(title); button.append(avatar, copy, mark);
    button.title = `${model.name} · ${model.costume}`;
    return button;
  };
  function syncSelection() {
    for (const button of root.querySelectorAll('[data-model]')) {
      const active = button.dataset.model === getSelected(); button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active));
    }
    for (const group of root.querySelectorAll('.character-group')) group.classList.toggle('selected-character',groups.get(group.dataset.character)?.some(m=>m.id===getSelected())||false);
  }
  function render() {
    observer?.disconnect(); root.replaceChildren();
    const query = normalize(search.value); let total = 0;
    observer = new IntersectionObserver(entries => { for(const entry of entries) if(entry.isIntersecting) entry.target.loadNext?.(); },{root:root.closest('.model-panel'),rootMargin:'160px'});
    for (const [name, models] of groups) {
      const matches = models.filter(m=>normalize(`${m.name} ${m.en} ${m.costume} ${m.id}`).includes(query)); if(!matches.length)continue;
      total += matches.length;
      const group = document.createElement('details'); group.className = 'character-group'; group.dataset.character=name;group.open = !!query || models.some(m=>m.id===getSelected());
      const representative=models.find(m=>m.id===getSelected())||models[0];
      const summary = document.createElement('summary'); const avatar=portraitImage(representative,48);avatar.className='character-avatar';const title = document.createElement('span'); title.textContent=name;
      const amount = document.createElement('small'); amount.textContent=matches.length+' 套'; summary.append(avatar,title,amount);
      const grid = document.createElement('div'); grid.className = 'costume-grid';
      const sentinel = document.createElement('div'); sentinel.className='catalog-sentinel'; sentinel.setAttribute('aria-label','滚动载入更多服装');
      let shown=0;
      sentinel.loadNext=()=>{if(!group.open)return; const next=matches.slice(shown,shown+12);shown+=next.length;grid.append(...next.map(card));syncSelection();if(shown>=matches.length){observer.unobserve(sentinel);sentinel.hidden=true;} };
      group.append(summary,grid,sentinel);root.append(group);
      group.addEventListener('toggle',()=>{if(group.open&&!shown)sentinel.loadNext();});
      if(group.open)sentinel.loadNext();observer.observe(sentinel);
    }
    count.textContent=`${root.children.length} 位人物 · ${total} 套服装`; syncSelection();
  }
  select.replaceChildren(...[...groups].map(([name,models])=>{const group=document.createElement('optgroup');group.label=name;for(const m of models)group.append(new Option(m.costume,m.id));return group;}));
  select.value='adv_live2d_soyo_004_casual_spring_01'; more.hidden=true; more.remove();
  search.addEventListener('input',render); render();
  return {syncSelection};
}
