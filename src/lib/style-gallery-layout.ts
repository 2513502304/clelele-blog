/** Keep row-major column assignment identical to grid view, with independent natural-height columns. */
export function getMasonryPositions(heights: readonly number[], columns: number, gap: number) {
  const bottoms = Array.from({ length: Math.max(1, columns) }, () => 0);
  const positions = heights.map((height, index) => {
    const column = index % bottoms.length;
    const top = bottoms[column];
    bottoms[column] = top + height + gap;
    return { column, top };
  });
  return { positions, height: Math.max(0, ...bottoms) - (heights.length ? gap : 0) };
}
