// Touch → raw swipe vectors. With screen-mapped steering the swipe's
// MEANING depends on the camera, which input code can't know — so unlike
// the keyboard (which emits fixed intents), touch reports the raw screen
// delta and lets the scene translate it.
//
// Gesture contract: ONE finger swipes steer the snake; TWO fingers belong
// to the camera (OrbitControls rotates/zooms), and the view-cube corner
// belongs to the gizmo (the shouldIgnore predicate). We abandon a swipe
// the moment a second finger lands.

const MIN_SWIPE_PX = 24;

export function attachTouch(
  element: HTMLElement,
  onSwipe: (dx: number, dy: number) => void,
  shouldIgnore: (x: number, y: number) => boolean = () => false,
): () => void {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    if (e.touches.length !== 1 || shouldIgnore(t.clientX, t.clientY)) {
      tracking = false; // camera gesture or gizmo territory
      return;
    }
    tracking = true;
    startX = t.clientX;
    startY = t.clientY;
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.hypot(dx, dy) >= MIN_SWIPE_PX) onSwipe(dx, dy);
  };

  element.addEventListener("touchstart", onTouchStart);
  element.addEventListener("touchend", onTouchEnd);
  return () => {
    element.removeEventListener("touchstart", onTouchStart);
    element.removeEventListener("touchend", onTouchEnd);
  };
}
