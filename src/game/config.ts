// The game's coordinate contract. Game logic thinks in CELLS — integer
// lattice addresses — and never in world units. Only rendering code
// converts cells to world positions, via cellToWorld below.

// Cells per side of the (cubic) arena. Odd, so one cell sits dead center —
// a natural spawn point for the snake.
export const GRID_SIZE = 40;

// Edge length of one cell in world units. Everything visual is sized off
// this, so changing it rescales the whole game consistently.
export const CELL = 1;

// Snake speed, in steps per second — THE knob for game pace.
export const SPEED = 4;

// Seconds between game ticks, derived from SPEED — the snake takes one
// step per tick.
export const TICK_SECONDS = 1 / SPEED;

// Progressive difficulty: the first SPEED_GRACE_FOOD pickups play at the
// base SPEED (the settling-in period), then every further food adds
// SPEED_GROWTH_PER_FOOD, topping out at SPEED_MAX_MULTIPLIER × base.
export const SPEED_GRACE_FOOD = 8;
export const SPEED_GROWTH_PER_FOOD = 0.05;
export const SPEED_MAX_MULTIPLIER = 2;

// The actual pace at a given score — everything time-based (tick length,
// wall-warning distance) reads speed through this, so difficulty scaling
// stays consistent in one place.
export function speedForScore(score: number): number {
  const beyondGrace = Math.max(0, score - SPEED_GRACE_FOOD);
  const multiplier = Math.min(
    SPEED_MAX_MULTIPLIER,
    1 + beyondGrace * SPEED_GROWTH_PER_FOOD,
  );
  return SPEED * multiplier;
}

// Wall proximity: how much reaction time the player gets before reaching
// a wall. The warning distance is derived from this and the CURRENT
// speed, so a faster game automatically warns further ahead.
export const WALL_WARN_SECONDS = 1;

// Depth cue: a thin line from the food straight down to the floor, with a
// dot where it lands — reads the food's height and floor position at a
// glance. Matter of taste; flip it off for a cleaner arena.
export const FOOD_DROP_LINE = false;

// Wall behavior — flip to taste, everything else adapts:
//   "solid"  → touching a wall is game over (classic hard mode)
//   "portal" → the snake exits one face and re-enters the opposite one,
//              so only self-collision kills
export const WALL_MODE: "solid" | "portal" = "portal";

// A cell address: each coordinate is an integer in 0..GRID_SIZE-1.
// +x = right, +y = up, +z = toward the default camera (Three.js convention).
export interface Cell {
  x: number;
  y: number;
  z: number;
}

export function isInsideGrid(c: Cell): boolean {
  return (
    c.x >= 0 &&
    c.x < GRID_SIZE &&
    c.y >= 0 &&
    c.y < GRID_SIZE &&
    c.z >= 0 &&
    c.z < GRID_SIZE
  );
}

// Cell → world position of that cell's CENTER. The lattice is centered on
// the world origin: cell (0,0,0) maps to (-4,-4,-4) with GRID_SIZE 9, and
// the center cell (4,4,4) maps to (0,0,0). Centering keeps the camera and
// lights simple — they can all aim at the origin.
export function cellToWorld(c: Cell): [number, number, number] {
  const offset = ((GRID_SIZE - 1) / 2) * CELL;
  return [c.x * CELL - offset, c.y * CELL - offset, c.z * CELL - offset];
}
