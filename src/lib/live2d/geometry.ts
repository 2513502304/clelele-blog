export const LIVE2D_MOBILE_BREAKPOINT = 768;
export const LIVE2D_DRAG_THRESHOLD = 6;
export const LIVE2D_NUDGE_STEP = 16;
export const LIVE2D_VIEWPORT_MARGIN = 16;
export const LIVE2D_EXCLUSION_GAP = 8;

export interface Live2DPoint {
  x: number;
  y: number;
}

export interface Live2DSize {
  width: number;
  height: number;
}

export interface Live2DRect extends Live2DPoint, Live2DSize {}

export interface Live2DInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type Live2DPlacementPreset = 'bottom-left' | 'bottom-center' | 'bottom-right';

export type Live2DPlacement =
  | { kind: 'sidebar' }
  | { kind: 'preset'; preset: Live2DPlacementPreset }
  | { kind: 'detached'; x: number; y: number };

export type Live2DNudgeDirection = 'up' | 'right' | 'down' | 'left';

export interface ResolveLive2DPlacementOptions {
  placement: Live2DPlacement;
  viewport: Live2DSize;
  widget: Live2DSize;
  sidebarAnchor?: Live2DRect | null;
  exclusionZones?: readonly Live2DRect[];
  safeArea?: Partial<Live2DInsets>;
  margin?: number;
  exclusionGap?: number;
  mobile?: boolean;
}

export interface ResolvedLive2DPlacement {
  mode: 'widget' | 'collapsed';
  position: Live2DPoint | null;
  residency: Live2DPlacement['kind'] | 'collapsed';
  fallback: 'none' | 'sidebar' | 'collapsed';
}

const ZERO_INSETS: Live2DInsets = { top: 0, right: 0, bottom: 0, left: 0 };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function overlaps(first: Live2DRect, second: Live2DRect): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

function squaredDistance(first: Live2DPoint, second: Live2DPoint): number {
  return (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values.filter(Number.isFinite))];
}

function nearestValidPosition(
  desired: Live2DPoint,
  viewport: Live2DSize,
  widget: Live2DSize,
  exclusions: readonly Live2DRect[],
  safeArea: Live2DInsets,
  margin: number,
  exclusionGap: number,
): Live2DPoint | null {
  const minimumX = safeArea.left + margin;
  const minimumY = safeArea.top + margin;
  const maximumX = viewport.width - safeArea.right - margin - widget.width;
  const maximumY = viewport.height - safeArea.bottom - margin - widget.height;
  if (maximumX < minimumX || maximumY < minimumY) return null;

  const clampedDesired = {
    x: clamp(desired.x, minimumX, maximumX),
    y: clamp(desired.y, minimumY, maximumY),
  };
  const xCandidates = uniqueNumbers([
    clampedDesired.x,
    minimumX,
    maximumX,
    ...exclusions.flatMap((zone) => [zone.x - exclusionGap - widget.width, zone.x + zone.width + exclusionGap]),
  ]).map((x) => clamp(x, minimumX, maximumX));
  const yCandidates = uniqueNumbers([
    clampedDesired.y,
    minimumY,
    maximumY,
    ...exclusions.flatMap((zone) => [zone.y - exclusionGap - widget.height, zone.y + zone.height + exclusionGap]),
  ]).map((y) => clamp(y, minimumY, maximumY));

  const candidates = xCandidates.flatMap((x) => yCandidates.map((y) => ({ x, y })));
  candidates.sort((first, second) => squaredDistance(first, clampedDesired) - squaredDistance(second, clampedDesired));
  return (
    candidates.find((candidate) => {
      const rectangle = { ...candidate, ...widget };
      return exclusions.every((zone) => !overlaps(rectangle, zone));
    }) ?? null
  );
}

function pointForPlacement(
  placement: Live2DPlacement,
  viewport: Live2DSize,
  widget: Live2DSize,
  sidebarAnchor: Live2DRect | null | undefined,
  margin: number,
): Live2DPoint | null {
  if (placement.kind === 'detached') return { x: placement.x, y: placement.y };
  if (placement.kind === 'sidebar') {
    if (!sidebarAnchor) return null;
    return {
      x: sidebarAnchor.x + (sidebarAnchor.width - widget.width) / 2,
      y: sidebarAnchor.y + sidebarAnchor.height - widget.height,
    };
  }

  const y = viewport.height - margin - widget.height;
  if (placement.preset === 'bottom-left') return { x: margin, y };
  if (placement.preset === 'bottom-center') return { x: (viewport.width - widget.width) / 2, y };
  return { x: viewport.width - margin - widget.width, y };
}

function resolveSidebarFallback(
  options: ResolveLive2DPlacementOptions,
  safeArea: Live2DInsets,
  margin: number,
  exclusionGap: number,
): Live2DPoint | null {
  const desired = pointForPlacement({ kind: 'sidebar' }, options.viewport, options.widget, options.sidebarAnchor, margin);
  if (!desired) return null;
  return nearestValidPosition(
    desired,
    options.viewport,
    options.widget,
    options.exclusionZones ?? [],
    safeArea,
    margin,
    exclusionGap,
  );
}

/** Resolves a render-only point; the caller retains the original saved placement for larger future viewports. */
export function resolveLive2DPlacement(options: ResolveLive2DPlacementOptions): ResolvedLive2DPlacement {
  const margin = options.margin ?? LIVE2D_VIEWPORT_MARGIN;
  const exclusionGap = options.exclusionGap ?? LIVE2D_EXCLUSION_GAP;
  const safeArea = { ...ZERO_INSETS, ...options.safeArea };
  const mobile = options.mobile ?? isLive2DMobileViewport(options.viewport.width);
  const hasSidebarAnchor = Boolean(
    options.sidebarAnchor && options.sidebarAnchor.width > 0 && options.sidebarAnchor.height > 0,
  );
  // Mobile drawers do not expose a usable desktop sidebar slot. Keep the saved preference unchanged,
  // but render an explicitly awakened character in the least disruptive corner for this viewport.
  const renderedPlacement =
    mobile && options.placement.kind === 'sidebar' && !hasSidebarAnchor
      ? ({ kind: 'preset', preset: 'bottom-right' } as const)
      : options.placement;
  const desired = pointForPlacement(renderedPlacement, options.viewport, options.widget, options.sidebarAnchor, margin);
  // Detached and preset placements must leave the active sidebar slot available.
  // Sidebar residency may occupy that slot, including when it is the safest fallback.
  const primaryExclusions =
    renderedPlacement.kind === 'sidebar' || !options.sidebarAnchor
      ? (options.exclusionZones ?? [])
      : [...(options.exclusionZones ?? []), options.sidebarAnchor];
  const resolved = desired
    ? nearestValidPosition(desired, options.viewport, options.widget, primaryExclusions, safeArea, margin, exclusionGap)
    : null;

  if (resolved) {
    return { mode: 'widget', position: resolved, residency: renderedPlacement.kind, fallback: 'none' };
  }

  if (!mobile && options.placement.kind !== 'sidebar') {
    const sidebar = resolveSidebarFallback(options, safeArea, margin, exclusionGap);
    if (sidebar) return { mode: 'widget', position: sidebar, residency: 'sidebar', fallback: 'sidebar' };
  }

  return { mode: 'collapsed', position: null, residency: 'collapsed', fallback: 'collapsed' };
}

export function isLive2DMobileViewport(width: number): boolean {
  return width <= LIVE2D_MOBILE_BREAKPOINT;
}

export function classifyLive2DPointerMovement(
  origin: Live2DPoint,
  current: Live2DPoint,
  threshold = LIVE2D_DRAG_THRESHOLD,
): 'interaction' | 'drag' {
  return Math.hypot(current.x - origin.x, current.y - origin.y) > threshold ? 'drag' : 'interaction';
}

export function detachedPlacementFromDrag(origin: Live2DPoint, delta: Live2DPoint): Live2DPlacement {
  return { kind: 'detached', x: origin.x + delta.x, y: origin.y + delta.y };
}

export function nudgeLive2DPlacement(
  renderedPosition: Live2DPoint,
  direction: Live2DNudgeDirection,
  step = LIVE2D_NUDGE_STEP,
): Live2DPlacement {
  const delta = {
    up: { x: 0, y: -step },
    right: { x: step, y: 0 },
    down: { x: 0, y: step },
    left: { x: -step, y: 0 },
  }[direction];
  return { kind: 'detached', x: renderedPosition.x + delta.x, y: renderedPosition.y + delta.y };
}
