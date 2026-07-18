import { useCallback, useEffect, useRef, useState } from "react";
import { initScene, type SceneHandle } from "./game/scene";
import type { GameStatus } from "./game/state";

// React owns the PAGE: the HUD text, the game-over overlay, and now the
// high score — persistence is a page concern, so localStorage lives here,
// not in the game. Data flows out of the 3D world via SceneEvents
// callbacks, and back into it via the SceneHandle.
const BEST_KEY = "colubrid.best";

function loadBest(): number {
  // localStorage can throw (private browsing, disabled storage) — a high
  // score is never worth crashing the game over.
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value: number) {
  try {
    localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // storage unavailable — the score just won't survive the session
  }
}

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(loadBest);
  const [status, setStatus] = useState<GameStatus>("running");
  const [paused, setPaused] = useState(false);
  // Two-finger orbit isn't discoverable on a touchscreen. On every load
  // there, the camera auto-pans for a few seconds with a caption
  // explaining the gesture — cut short the instant the player orbits for
  // real, or after ORBIT_HINT_MS if they don't. An (i) button bottom-left
  // replays it on demand too.
  const ORBIT_HINT_MS = 6000;
  const [isTouchDevice] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(pointer: coarse)").matches,
  );
  const [orbitHintPlaying, setOrbitHintPlaying] = useState(false);
  const orbitHintTimer = useRef<number | null>(null);

  const stopOrbitHint = useCallback(() => {
    if (orbitHintTimer.current !== null) {
      clearTimeout(orbitHintTimer.current);
      orbitHintTimer.current = null;
    }
    setOrbitHintPlaying(false);
    sceneRef.current?.setDemoOrbit(false);
  }, []);

  const playOrbitHint = useCallback(() => {
    setOrbitHintPlaying(true);
    sceneRef.current?.setDemoOrbit(true);
    orbitHintTimer.current = window.setTimeout(stopOrbitHint, ORBIT_HINT_MS);
  }, [stopOrbitHint]);

  useEffect(() => {
    const scene = initScene(containerRef.current!, {
      onPause: setPaused,
      onScore: (s) => {
        setScore(s);
        // Functional update: this callback fires from the render loop,
        // outside React's world, so read `best` through setState rather
        // than closing over a stale value.
        setBest((b) => {
          if (s <= b) return b;
          saveBest(s);
          return s;
        });
      },
      onStatus: setStatus,
      // Idempotent even outside the demo (setDemoOrbit(false) when already
      // off) — safe to call always.
      onOrbitEngaged: stopOrbitHint,
    });
    sceneRef.current = scene;
    if (isTouchDevice) playOrbitHint();
    return () => {
      if (orbitHintTimer.current !== null) clearTimeout(orbitHintTimer.current);
      sceneRef.current = null;
      scene.dispose();
    };
  }, [isTouchDevice, playOrbitHint, stopOrbitHint]);

  return (
    <div className="scene-wrap">
      <div ref={containerRef} className="scene" />
      <div className="hud">
        <div className="score">
          score {score}
          <span className="best">best {best}</span>
        </div>
        <div className="hud-buttons">
          {isTouchDevice && (
            <button
              className="hud-button"
              aria-label={
                orbitHintPlaying ? "stop orbit hint" : "show orbit hint"
              }
              aria-pressed={orbitHintPlaying}
              onClick={() =>
                orbitHintPlaying ? stopOrbitHint() : playOrbitHint()
              }
            >
              i
            </button>
          )}
          {status === "running" && (
            <button
              className="hud-button"
              aria-label={paused ? "resume" : "pause"}
              onClick={() => sceneRef.current?.togglePause()}
            >
              {paused ? "▶" : "II"}
            </button>
          )}
        </div>
        {/* Deliberately NOT a tap-anywhere-to-resume overlay: while paused
            the canvas stays interactive, so you can orbit and inspect the
            arena freely. Resume via the ▶ button or the P key. */}
        {paused && status === "running" && (
          <div className="paused-overlay">
            <span className="game-over-title paused-title">paused</span>
            <span className="game-over-hint">
              ▶ or P resumes · look around freely
            </span>
          </div>
        )}
        {isTouchDevice && orbitHintPlaying && (
          <div className="orbit-hint-caption" onClick={stopOrbitHint}>
            <span className="orbit-hint-text">
              use two fingers to orbit or zoom the cube
            </span>
          </div>
        )}
        {status === "dead" && (
          <button
            className="game-over"
            onClick={() => sceneRef.current?.restart()}
          >
            <span className="game-over-title">game over</span>
            <span className="game-over-score">
              score {score} · best {best}
            </span>
            <span className="game-over-hint">tap — or press R — to restart</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default App;
