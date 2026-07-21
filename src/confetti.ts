// Confetti for new personal bests — a self-contained 2D-canvas burst, no
// library. Each call creates a full-screen canvas above the UI, animates
// ~150 falling, fluttering rectangles for a few seconds, then removes
// itself. Fire-and-forget: nothing to clean up, nothing to configure.

const COLORS = ["#4ade80", "#86efac", "#f59e0b", "#fbbf24", "#bfe8ec", "#e2e8f0"];

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  angle: number;
  spin: number;
  swayPhase: number;
  color: string;
}

export function fireConfetti(): void {
  // The OS-level "reduce motion" setting is exactly about effects like
  // this one — honor it. The new-best chime still plays, so the moment
  // isn't lost.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:50";
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  document.body.appendChild(canvas);

  // Launched upward from the bottom corners toward the center, like party
  // poppers — reads as a celebration even over a dark scene.
  const pieces: Piece[] = [];
  for (let i = 0; i < 150; i++) {
    const fromLeft = i % 2 === 0;
    pieces.push({
      x: fromLeft ? -10 : w + 10,
      y: h * (0.55 + Math.random() * 0.4),
      vx: (fromLeft ? 1 : -1) * (250 + Math.random() * 450),
      vy: -(500 + Math.random() * 500),
      w: 5 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 12,
      swayPhase: Math.random() * Math.PI * 2,
      color: COLORS[i % COLORS.length],
    });
  }

  const DURATION = 3.2;
  let last = performance.now();
  let age = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    age += dt;
    ctx.clearRect(0, 0, w, h);
    // Fade the whole burst out over the final second.
    ctx.globalAlpha = Math.min(1, Math.max(0, (DURATION - age) / 1));
    for (const p of pieces) {
      p.vy += 700 * dt; // gravity
      p.vx *= 1 - 0.8 * dt; // air drag bleeds off the launch speed
      p.x += (p.vx + Math.sin(age * 6 + p.swayPhase) * 40) * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (age < DURATION) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
    }
  };
  requestAnimationFrame(frame);
}
