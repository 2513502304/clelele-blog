import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyLive2DPointerMovement,
  detachedPlacementFromDrag,
  isLive2DMobileViewport,
  LIVE2D_DRAG_THRESHOLD,
  type Live2DPlacement,
  nudgeLive2DPlacement,
  type ResolveLive2DPlacementOptions,
  resolveLive2DPlacement,
} from './geometry';

const baseGeometry: Omit<ResolveLive2DPlacementOptions, 'placement' | 'viewport'> = {
  widget: { width: 180, height: 260 },
  sidebarAnchor: { x: 900, y: 180, width: 240, height: 420 },
  margin: 16,
  exclusionGap: 0,
};

describe('Live2D placement geometry', () => {
  it('clamps only the rendered point and restores the saved point in a larger viewport', () => {
    const placement: Live2DPlacement = { kind: 'detached', x: 900, y: 300 };
    const wide = resolveLive2DPlacement({
      ...baseGeometry,
      sidebarAnchor: null,
      placement,
      viewport: { width: 1280, height: 720 },
    });
    const narrow = resolveLive2DPlacement({
      ...baseGeometry,
      sidebarAnchor: null,
      placement,
      viewport: { width: 760, height: 600 },
    });
    const wideAgain = resolveLive2DPlacement({
      ...baseGeometry,
      sidebarAnchor: null,
      placement,
      viewport: { width: 1280, height: 720 },
    });

    assert.deepEqual(wide.position, { x: 900, y: 300 });
    assert.deepEqual(narrow.position, { x: 564, y: 300 });
    assert.deepEqual(wideAgain.position, wide.position);
    assert.deepEqual(placement, { kind: 'detached', x: 900, y: 300 });
  });

  it('makes sidebar residency follow the current anchor while detached placement stays viewport-relative', () => {
    const firstAnchor = resolveLive2DPlacement({
      ...baseGeometry,
      placement: { kind: 'sidebar' },
      viewport: { width: 1280, height: 720 },
    });
    const movedAnchor = resolveLive2DPlacement({
      ...baseGeometry,
      sidebarAnchor: { x: 760, y: 120, width: 300, height: 480 },
      placement: { kind: 'sidebar' },
      viewport: { width: 1280, height: 720 },
    });
    const detached = resolveLive2DPlacement({
      ...baseGeometry,
      sidebarAnchor: { x: 760, y: 120, width: 300, height: 480 },
      placement: { kind: 'detached', x: 200, y: 100 },
      viewport: { width: 1280, height: 720 },
    });

    assert.deepEqual(firstAnchor.position, { x: 930, y: 340 });
    assert.deepEqual(movedAnchor.position, { x: 820, y: 340 });
    assert.deepEqual(detached.position, { x: 200, y: 100 });
  });

  it('avoids fixed controls and safe-area insets at the nearest valid point', () => {
    const resolved = resolveLive2DPlacement({
      ...baseGeometry,
      placement: { kind: 'detached', x: 380, y: 300 },
      viewport: { width: 800, height: 640 },
      safeArea: { left: 24, bottom: 20 },
      exclusionZones: [{ x: 360, y: 280, width: 100, height: 180 }],
      exclusionGap: 8,
    });

    assert.equal(resolved.mode, 'widget');
    assert.deepEqual(resolved.position, { x: 468, y: 300 });
  });

  it('falls back to sidebar or the collapsed wake control when no detached rectangle fits', () => {
    const sidebarFallback = resolveLive2DPlacement({
      ...baseGeometry,
      placement: { kind: 'detached', x: 100, y: 100 },
      viewport: { width: 1280, height: 720 },
      exclusionZones: [{ x: 0, y: 0, width: 800, height: 720 }],
    });
    assert.equal(sidebarFallback.fallback, 'sidebar');
    assert.equal(sidebarFallback.residency, 'sidebar');

    const collapsed = resolveLive2DPlacement({
      ...baseGeometry,
      placement: { kind: 'detached', x: 100, y: 100 },
      viewport: { width: 320, height: 300 },
      widget: { width: 300, height: 280 },
      sidebarAnchor: null,
      safeArea: { left: 20, right: 20 },
    });
    assert.deepEqual(collapsed, { mode: 'collapsed', position: null, residency: 'collapsed', fallback: 'collapsed' });

    const mobileWithDesktopAnchor = resolveLive2DPlacement({
      ...baseGeometry,
      placement: { kind: 'detached', x: 100, y: 100 },
      viewport: { width: 768, height: 640 },
      exclusionZones: [{ x: 0, y: 0, width: 768, height: 640 }],
    });
    assert.equal(mobileWithDesktopAnchor.fallback, 'collapsed');
  });

  it('discriminates click interactions from drags and detaches above the threshold', () => {
    assert.equal(classifyLive2DPointerMovement({ x: 10, y: 10 }, { x: 10 + LIVE2D_DRAG_THRESHOLD, y: 10 }), 'interaction');
    assert.equal(classifyLive2DPointerMovement({ x: 10, y: 10 }, { x: 17, y: 10 }), 'drag');
    assert.deepEqual(detachedPlacementFromDrag({ x: 200, y: 100 }, { x: 20, y: -10 }), {
      kind: 'detached',
      x: 220,
      y: 90,
    });
  });

  it('routes presets and keyboard nudges through the same validation path', () => {
    const preset = resolveLive2DPlacement({
      ...baseGeometry,
      placement: { kind: 'preset', preset: 'bottom-right' },
      viewport: { width: 800, height: 640 },
    });
    assert.deepEqual(preset.position, { x: 604, y: 364 });

    assert.ok(preset.position);
    const nudgedPlacement = nudgeLive2DPlacement(preset.position, 'right');
    const nudged = resolveLive2DPlacement({
      ...baseGeometry,
      placement: nudgedPlacement,
      viewport: { width: 800, height: 640 },
    });
    assert.deepEqual(nudged.position, preset.position);
  });

  it('uses the repository mobile breakpoint inclusively', () => {
    assert.equal(isLive2DMobileViewport(769), false);
    assert.equal(isLive2DMobileViewport(768), true);
  });
});
