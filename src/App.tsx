import { useEffect, useRef, useState } from "react";
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
    });
    sceneRef.current = scene;
    return () => {
      sceneRef.current = null;
      scene.dispose();
    };
  }, []);

  return (
    <div className="scene-wrap">
      <div ref={containerRef} className="scene" />
      <div className="hud">
        <div className="score">
          score {score}
          <span className="best">best {best}</span>
        </div>
        {status === "running" && (
          <button
            className="pause-button"
            aria-label={paused ? "resume" : "pause"}
            onClick={() => sceneRef.current?.togglePause()}
          >
            {paused ? "▶" : "II"}
          </button>
        )}
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
