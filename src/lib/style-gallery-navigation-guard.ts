/** Protect ephemeral bulk selections without changing shallow search/filter history.
 * Astro 5 treats a cancelled preparation as a full navigation, so ordinary links and
 * traversals are stopped before its router; beforeunload covers full/programmatic exits.
 */
export function guardGalleryNavigation(message: string): () => void {
  let approved = false;
  let restoring = false;
  let replay = false;
  let currentUrl = new URL(location.href);
  let currentIndex: number | undefined = history.state?.index;
  const confirm = () => window.confirm(message);
  const sameDocumentAnchor = (url: URL) =>
    url.origin === location.origin && url.pathname === location.pathname && url.search === location.search;
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const url = new URL(link.href, location.href);
    if (!['http:', 'https:'].includes(url.protocol) || sameDocumentAnchor(url)) return;
    if (!confirm()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    } else approved = true;
  };
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (approved) return;
    event.preventDefault();
    event.returnValue = '';
  };
  const onPreparation = (event: Event) => {
    // Programmatic Astro navigation falls back to the browser's cancellable unload prompt.
    if (!approved) event.preventDefault();
  };
  const onPopState = (event: Event) => {
    const traversal = (event as CustomEvent<PopStateEvent>).detail;
    const nextIndex: number | undefined = traversal.state?.index;
    if (restoring) {
      event.preventDefault();
      restoring = false;
      if (replay && currentIndex !== undefined && nextIndex !== undefined) {
        const delta = replayDelta;
        replay = false;
        approved = true;
        history.go(delta);
      }
      return;
    }
    if (approved) return;
    if (currentIndex === undefined || nextIndex === undefined || nextIndex === currentIndex) return;
    const destination = new URL(location.href);
    if (
      currentUrl.pathname === destination.pathname &&
      currentUrl.search === destination.search &&
      currentUrl.hash !== destination.hash
    ) {
      currentIndex = nextIndex;
      currentUrl = destination;
      return;
    }
    // Restore first while keeping Astro's internal history index unchanged. Only an approved
    // replay reaches its router, so cancelling Back/Forward retains both the URL and selection.
    event.preventDefault();
    replayDelta = nextIndex - currentIndex;
    replay = confirm();
    restoring = true;
    history.go(-replayDelta);
  };
  let replayDelta = 0;
  const updateIndex = () => {
    if (!restoring) {
      currentIndex = history.state?.index;
      currentUrl = new URL(location.href);
    }
  };
  // Hash navigation may push a history entry while keeping this island alive.
  window.addEventListener('hashchange', updateIndex);
  document.addEventListener('click', onClick, true);
  document.addEventListener('astro:before-preparation', onPreparation);
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('gallery:before-history-traverse', onPopState);
  return () => {
    window.removeEventListener('hashchange', updateIndex);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('astro:before-preparation', onPreparation);
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('gallery:before-history-traverse', onPopState);
  };
}
