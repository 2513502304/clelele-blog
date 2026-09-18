export type SelectionRect = { left: number; top: number; right: number; bottom: number };

/** Positive-area intersections avoid selecting a neighbour merely touching the rubber-band edge. */
export function intersectsSelection(a: SelectionRect, b: SelectionRect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** A drag starts a fresh selection unless a modifier was held at pointer-down. */
export function combineGallerySelection(base: Iterable<string>, hits: Iterable<string>, append: boolean, limit = Infinity) {
  return new Set([...new Set([...(append ? base : []), ...hits])].slice(0, limit));
}
