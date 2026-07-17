import type { Cell } from "./config";

// Screen-mapped steering: a swipe means "move the way the swipe LOOKS on
// screen." The scene projects each world axis into screen space every time
// a swipe arrives; this pure module just picks the winner.

export const AXIS_DIRECTIONS: readonly Cell[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

export interface ProjectedAxis {
  axis: Cell;
  // This axis's direction in screen pixels, as the player currently sees
  // it (y grows downward, like all screen coordinates).
  sx: number;
  sy: number;
}

// Score each axis by the dot product of the swipe with its UNnormalized
// screen projection: that's alignment × visibility in one number. An axis
// pointing into the screen projects short and can't win even if aligned —
// which is the rule "rotate the view to steer in depth" falling out of
// the math for free. Null when nothing scores positive (degenerate swipe).
export function pickDirection(
  dx: number,
  dy: number,
  axes: readonly ProjectedAxis[],
): Cell | null {
  let best: Cell | null = null;
  let bestScore = 0;
  for (const a of axes) {
    const score = dx * a.sx + dy * a.sy;
    if (score > bestScore) {
      bestScore = score;
      best = a.axis;
    }
  }
  return best;
}
