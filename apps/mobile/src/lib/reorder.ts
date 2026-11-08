// Drag to reorder (the web List's handle): how many places a card dragged by
// `dy` pixels moves among the cards listed with these heights (each including
// the gap after it). It passes a neighbour once it's over more than half of
// it, the same point where the web's live swap happens.
export function dragDelta(heights: number[], from: number, dy: number): number {
  let delta = 0;
  let rest = dy;
  if (dy > 0) {
    for (let i = from + 1; i < heights.length && rest > heights[i] / 2; i++) { rest -= heights[i]; delta++; }
  } else {
    for (let i = from - 1; i >= 0 && -rest > heights[i] / 2; i--) { rest += heights[i]; delta--; }
  }
  return delta;
}
