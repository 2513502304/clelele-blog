/** The prototype annotation surface is a separate editor, including before its textbox opens. */
export function isAnnotationActive() {
  const shadow=document.querySelector('ce-annotate-host')?.shadowRoot;
  return !!shadow?.querySelector('.ce-annotate-toggle[aria-pressed="true"]');
}

export function installAnnotationOwnership(root) {
  const guard=event=>{
    if(!isAnnotationActive() || !event.composedPath().includes(root))return;
    // Leave the overlay's own enter/exit keys available while swallowing stale workbench focus.
    if(event.key==='Escape' || event.key==='Tab' || (event.ctrlKey && event.key.toLowerCase()==='a'))return;
    event.preventDefault();event.stopImmediatePropagation();
  };
  document.addEventListener('keydown',guard,true);document.addEventListener('keyup',guard,true);
  return ()=>{document.removeEventListener('keydown',guard,true);document.removeEventListener('keyup',guard,true);};
}

/** Retargeted Shadow DOM events from the annotation UI never belong to the editor. */
export function isEditorEvent(event, root) {
  return !!root && event.composedPath().includes(root) && !isAnnotationActive();
}

export function isTextEntry(event) {
  return event.composedPath().some(node => node instanceof Element &&
    node.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'));
}

/** Text editors keep native undo; ranges, checkboxes and selectors use scene history. */
export function isNativeUndoEntry(event) {
  return event.composedPath().some(node => node instanceof Element &&
    node.matches('textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"],input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"],input[type="password"],input[type="number"]'));
}

/** Capture Space before a focused action button synthesizes another click on keyup. */
export function installPlaybackShortcut(root, canPlay, toggle) {
  let consumed = false;
  const keydown = event => {
    if (event.code !== 'Space' && event.key !== ' ') return;
    if (!isEditorEvent(event, root) || isTextEntry(event) || event.isComposing ||
      event.altKey || event.ctrlKey || event.metaKey ||
      event.composedPath().some(node => node instanceof Element && node.matches('#compare,dialog'))) return;
    event.preventDefault(); event.stopImmediatePropagation();
    // Loading/transactions must suppress the button click too, even when playback is unavailable.
    if (!event.repeat) { consumed = true; if (canPlay()) toggle(); }
  };
  const keyup = event => {
    if (!consumed || (event.code !== 'Space' && event.key !== ' ')) return;
    consumed = false; event.preventDefault(); event.stopImmediatePropagation();
  };
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('keyup', keyup, true);
  return () => { document.removeEventListener('keydown', keydown, true); document.removeEventListener('keyup', keyup, true); };
}
