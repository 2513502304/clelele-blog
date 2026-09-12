/** Stable shortest-column packing: extending heights cannot move the existing prefix. */
export function getMasonryPositions(heights: readonly number[], columns: number, gap: number) {
  const bottoms = Array.from({ length: Math.max(1, columns) }, () => 0);
  const positions = heights.map((height) => {
    const top = Math.min(...bottoms);
    const column = bottoms.indexOf(top);
    bottoms[column] = top + height + gap;
    return { column, top };
  });
  return { positions, height: Math.max(0, ...bottoms) - (heights.length ? gap : 0) };
}
