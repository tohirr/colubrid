import { GRID_SIZE, WALL_MODE, isInsideGrid, type Cell } from "./config";

// Pure game logic — no Three.js, no DOM, no timers. Just data and the
// rules for advancing it one tick. You could run this in a terminal or a
// unit test unchanged; that separation is what keeps snake logic simple
// (integer math) while the renderer worries about pixels.

export type GameStatus = "running" | "dead";
export type DeathCause = "wall" | "self";

export interface GameState {
  // Head first, tail last. The snake IS this array — rendering just
  // draws one cube per entry.
  snake: Cell[];
  // The unit step (exactly one axis, ±1) applied to the head every tick.
  direction: Cell;
  // Latest legal key press, applied at the START of the next tick. Queuing
  // (instead of changing direction immediately) means two quick presses
  // between ticks can't turn the snake back into its own neck.
  queuedDirection: Cell | null;
  food: Cell;
  score: number;
  status: GameStatus;
  // What ended the run — lets the renderer show the right kind of death
  // (e.g. paint the offending wall red). Null while running.
  deathCause: DeathCause | null;
}

const START_LENGTH = 3;

export function createGame(): GameState {
  const c = Math.floor(GRID_SIZE / 2);
  // Head at the center cell, body trailing in -x, so the opening move is +x.
  const snake: Cell[] = [];
  for (let i = 0; i < START_LENGTH; i++) {
    snake.push({ x: c - i, y: c, z: c });
  }
  return {
    snake,
    direction: { x: 1, y: 0, z: 0 },
    queuedDirection: null,
    food: randomEmptyCell(snake),
    score: 0,
    status: "running",
    deathCause: null,
  };
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function isReversal(a: Cell, b: Cell): boolean {
  return a.x === -b.x && a.y === -b.y && a.z === -b.z;
}

// Rejection sampling: roll random cells until one is free. With a 13³ grid
// (2197 cells) and a snake dozens long, misses are rare — this only gets
// slow if the snake ever fills a meaningful fraction of the arena.
function randomEmptyCell(occupied: Cell[]): Cell {
  while (true) {
    const c: Cell = {
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_SIZE),
      z: Math.floor(Math.random() * GRID_SIZE),
    };
    if (!occupied.some((o) => sameCell(o, c))) return c;
  }
}

// Record a direction request from input. Reversals are ignored — in 3D
// there are 6 directions, and exactly one of them (straight back into your
// neck) is instant death through no fault of the player.
export function queueDirection(state: GameState, dir: Cell): void {
  // Compare against what the snake will ACTUALLY be doing when this
  // input takes effect — the already-queued direction wins over current.
  const basis = state.queuedDirection ?? state.direction;
  if (isReversal(dir, basis) || sameCell(dir, basis)) return;
  state.queuedDirection = dir;
}

// Advance the world by one tick: apply queued steering, move the head one
// cell, kill on wall/self collision, eat or drag the tail along.
export function tick(state: GameState): void {
  if (state.status !== "running") return;

  if (state.queuedDirection) {
    state.direction = state.queuedDirection;
    state.queuedDirection = null;
  }

  const head = state.snake[0];
  const next: Cell = {
    x: head.x + state.direction.x,
    y: head.y + state.direction.y,
    z: head.z + state.direction.z,
  };

  if (WALL_MODE === "portal") {
    // Walls teleport: leave through one face, re-enter the opposite one.
    // The +GRID_SIZE makes JS's remainder behave for -1 (-1 % n is -1 in
    // JS, not n-1 — a classic wrap-around bug).
    next.x = (next.x + GRID_SIZE) % GRID_SIZE;
    next.y = (next.y + GRID_SIZE) % GRID_SIZE;
    next.z = (next.z + GRID_SIZE) % GRID_SIZE;
  } else if (!isInsideGrid(next)) {
    state.status = "dead";
    state.deathCause = "wall";
    return;
  }

  const ate = sameCell(next, state.food);

  // Self-collision. Normally the tail tip vacates its cell this very tick,
  // so moving into it is legal — but when eating, the tail STAYS (that's
  // what growing means), so the whole body is solid.
  const solid = ate ? state.snake : state.snake.slice(0, -1);
  if (solid.some((c) => sameCell(c, next))) {
    state.status = "dead";
    state.deathCause = "self";
    return;
  }

  state.snake.unshift(next);
  if (ate) {
    // Growth is simply "don't pop the tail this tick."
    state.score += 1;
    state.food = randomEmptyCell(state.snake);
  } else {
    state.snake.pop();
  }
}
