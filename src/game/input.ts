// Keyboard → movement INTENTS. Keys no longer map to world axes — with an
// orbiting camera, "left" only means something relative to where you're
// looking. Input's job ends at naming the intent; the scene (which knows
// the camera) translates intents into world directions.

export type MoveIntent =
  | "forward" // away from the camera
  | "back" // toward the camera
  | "left"
  | "right"
  | "up" // world up — vertical is unambiguous, camera or not
  | "down";

// Keyed by e.code — the PHYSICAL key, layout-independent ("KeyW" is the
// same spot on QWERTY and AZERTY).
const CODE_TO_INTENT: Record<string, MoveIntent> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "forward",
  ArrowDown: "back",
  KeyA: "left",
  KeyD: "right",
  KeyW: "forward",
  KeyS: "back",
  Space: "up",
  ShiftLeft: "down",
  ShiftRight: "down",
};

// Fallback keyed by e.key — some event sources (notably synthesized
// events from automation tools) leave e.code empty.
const KEY_TO_INTENT: Record<string, MoveIntent> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "forward",
  ArrowDown: "back",
  a: "left",
  d: "right",
  w: "forward",
  s: "back",
  " ": "up",
  Shift: "down",
};

// Wires up the keyboard and returns an unsubscribe function, mirroring the
// initScene pattern: whoever attaches is handed the way to detach.
export function attachInput(
  onIntent: (intent: MoveIntent) => void,
  onRestart: () => void,
): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "KeyR" || e.key.toLowerCase() === "r") {
      onRestart();
      return;
    }
    const intent = CODE_TO_INTENT[e.code] ?? KEY_TO_INTENT[e.key];
    if (!intent) return;
    e.preventDefault(); // arrows and Space scroll the page otherwise
    onIntent(intent);
  };

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
