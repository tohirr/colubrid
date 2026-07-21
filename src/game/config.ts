// The game's coordinate contract. Game logic thinks in CELLS — integer
// lattice addresses — and never in world units. Only rendering code
// converts cells to world positions, via cellToWorld below.

// Cells per side of the (cubic) arena. Odd, so one cell sits dead center —
// a natural spawn point for the snake. Sized for the FIRST minute of play:
// at 40 the food averaged ~30 steps away and new players quit before their
// first bite; at 21 the arena still reads as a big open volume but a
// beginner reaches food in a handful of turns.
export const GRID_SIZE = 31;

// Edge length of one cell in world units. Everything visual is sized off
// this, so changing it rescales the whole game consistently.
export const CELL = 1;

// Snake speed, in steps per second — THE knob for game pace.
export const SPEED = 4.5;

// Seconds between game ticks, derived from SPEED — the snake takes one
// step per tick.
export const TICK_SECONDS = 1 / SPEED;

// Progressive difficulty: the first SPEED_GRACE_FOOD pickups play at the
// base SPEED (the settling-in period), then every further food adds
// SPEED_GROWTH_PER_FOOD, topping out at SPEED_MAX_MULTIPLIER × base.
export const SPEED_GRACE_FOOD = 6;
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

// BEGINNER RAMP — the hard part of 3D snake is the last mile: matching all
// THREE coordinates exactly. Two training wheels ease that in, and both
// remove themselves as the score climbs:
//
// 1. The eat zone. Early food is "big": the snake eats by getting NEAR it
//    (Chebyshev distance ≤ radius — a cube-shaped zone, 3³ cells at radius
//    1), not by hitting the exact cell. After a few foods, exact hits only.
export const EAT_RADIUS_UNTIL_FOOD = 10;
export function eatRadiusForScore(score: number): number {
  return score < EAT_RADIUS_UNTIL_FOOD ? 1 : 0;
}

// 2. Near spawning. The first food appears a short walk from the head, so
//    the first win comes in the opening seconds; each food after spawns a
//    little further out until the whole arena is in play.
export function foodSpawnRangeForScore(score: number): number {
  return 8 + score * 4; // ≥ GRID_SIZE means "anywhere"
}

// Wall proximity: how much reaction time the player gets before reaching
// a wall. The warning distance is derived from this and the CURRENT
// speed, so a faster game automatically warns further ahead.
export const WALL_WARN_SECONDS = 1;

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
