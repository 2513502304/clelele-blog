import assert from 'node:assert/strict';
import test from 'node:test';
import { $activeModal } from './modal';
import { $backgroundLive2DPaused, $backgroundPagePaused, registerPageOverlay } from './page-activity';

test('studio keeps its model active while nested dialogs and fullscreen overlays pause background work', () => {
  const stopPage = $backgroundPagePaused.subscribe(() => {});
  const stopModel = $backgroundLive2DPaused.subscribe(() => {});
  try {
    for (const type of ['search', 'drawer', 'codeFullscreen', 'diagramFullscreen', 'imageLightbox'] as const) {
      $activeModal.set({ type });
      assert.equal($backgroundPagePaused.get(), true);
      assert.equal($backgroundLive2DPaused.get(), true);
    }
    $activeModal.set({ type: 'live2dStudio' });
    const closeStudio = registerPageOverlay(true);
    assert.equal($backgroundPagePaused.get(), true);
    assert.equal($backgroundLive2DPaused.get(), false);
    const closeChild = registerPageOverlay();
    const closeGrandchild = registerPageOverlay();
    closeGrandchild();
    closeGrandchild();
    assert.equal($backgroundLive2DPaused.get(), true);
    closeChild();
    assert.equal($backgroundLive2DPaused.get(), false);
    closeStudio();
    $activeModal.set({ type: null });
    assert.equal($backgroundPagePaused.get(), false);
    assert.equal($backgroundLive2DPaused.get(), false);
    const closeIndependent = registerPageOverlay();
    assert.equal($backgroundPagePaused.get(), true);
    closeIndependent();
    assert.equal($backgroundPagePaused.get(), false);
  } finally {
    $activeModal.set({ type: null });
    stopPage();
    stopModel();
  }
});
