import { useCallback, useEffect, useRef, useState } from "react";
import { initScene, type SceneHandle } from "./game/scene";
import type { GameStatus } from "./game/state";
import { playBest, setMuted as setAudioMuted } from "./game/audio";
import { fireConfetti } from "./confetti";
import {
  getPlayerId,
  submitScore,
  type LeaderboardResult,
} from "./leaderboard";

// React owns the PAGE: the HUD text, the overlays, and everything
// persistent — localStorage is a page concern, so it lives here, not in
// the game. Data flows out of the 3D world via SceneEvents callbacks, and
// back into it via the SceneHandle.
const BEST_KEY = "colubrid.best";
const MUTED_KEY = "colubrid.muted";
const INTRO_KEY = "colubrid.introSeen";

// The canonical link, for sharing. location.origin would say "localhost"
// in dev — friends should always get the real address.
const SHARE_URL = "https://colubrid.tohirr.xyz";

// localStorage can throw (private browsing, disabled storage) — nothing
// stored here is ever worth crashing the game over.
function loadStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable — the value just won't survive the session
  }
}

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => Number(loadStored(BEST_KEY)) || 0);
  const [status, setStatus] = useState<GameStatus>("running");
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(() => loadStored(MUTED_KEY) === "1");
  // First visit only: an intro card explaining the controls, with the game
  // held paused behind it until the player taps in. Returning players go
  // straight to the snake.
  const [introOpen, setIntroOpen] = useState(
    () => loadStored(INTRO_KEY) !== "1",
  );
  // Share-button feedback when the Web Share sheet isn't available and we
  // fall back to the clipboard.
  const [shareCopied, setShareCopied] = useState(false);
  // The global top 10, shown on the game-over screen — but ONLY when this
  // player is on it. null = not fetched / not good enough / backend away.
  const [leaderboard, setLeaderboard] = useState<LeaderboardResult | null>(
    null,
  );
  // The new-best chime should ring once per run — the moment the record
  // falls — not on every food after it. Refs, not state: these are read
  // inside render-loop callbacks, and nothing on screen depends on them.
  const bestRef = useRef(best);
  const bestAnnouncedRef = useRef(false);
  const scoreRef = useRef(0);
  // What "best" was when the current run began — the confetti condition.
  // bestRef can't serve here: it rises DURING the run, and beating a
  // record you set two seconds ago isn't a new record.
  const runStartBestRef = useRef(best);

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
  // OS "reduce motion" setting: skip the AUTO-playing camera demo (the
  // (i) button still replays it on request — that's user-initiated).
  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
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
    setAudioMuted(muted);
  }, [muted]);

  useEffect(() => {
    const scene = initScene(containerRef.current!, {
      onPause: setPaused,
      onScore: (s) => {
        setScore(s);
        scoreRef.current = s;
        if (s === 0) {
          // Restart — arm the chime and record the target to beat.
          bestAnnouncedRef.current = false;
          runStartBestRef.current = bestRef.current;
        } else if (
          !bestAnnouncedRef.current &&
          bestRef.current > 0 &&
          s > bestRef.current
        ) {
          bestAnnouncedRef.current = true;
          playBest();
        }
        if (s > bestRef.current) {
          bestRef.current = s;
          saveStored(BEST_KEY, String(s));
          setBest(s);
        }
      },
      onStatus: (st) => {
        setStatus(st);
        if (st === "dead") {
          const s = scoreRef.current;
          // Beat the record you WALKED IN with (not one set mid-run) →
          // celebrate. Timed with the overlay, so the confetti frames
          // the final score.
          if (s > 0 && s > runStartBestRef.current) fireConfetti();
          // Report the game either way — plays are counted server-side
          // even at score 0. Rendering decides between the full board
          // (top 10) and the one-line rank tease (below it).
          void submitScore(getPlayerId(), s).then((r) => {
            if (r && r.rank !== null) setLeaderboard(r);
          });
        } else {
          setLeaderboard(null); // stale standings die with the restart
        }
      },
      // Idempotent even outside the demo (setDemoOrbit(false) when already
      // off) — safe to call always.
      onOrbitEngaged: stopOrbitHint,
    });
    sceneRef.current = scene;
    if (loadStored(INTRO_KEY) !== "1") {
      // First visit: hold the world still behind the intro card. Reading
      // storage again (not the introOpen state) keeps this effect
      // independent of render state — it runs once, on mount.
      scene.setPaused(true);
    } else if (isTouchDevice && !reducedMotion) {
      playOrbitHint();
    }
    return () => {
      if (orbitHintTimer.current !== null) clearTimeout(orbitHintTimer.current);
      sceneRef.current = null;
      scene.dispose();
    };
  }, [isTouchDevice, playOrbitHint, stopOrbitHint]);

  const dismissIntro = () => {
    saveStored(INTRO_KEY, "1");
    setIntroOpen(false);
    sceneRef.current?.setPaused(false);
    // The dismissing tap doubles as the audio-unlock gesture, and the
    // orbit demo makes more sense now that the arena is moving.
    if (isTouchDevice && !reducedMotion) playOrbitHint();
  };

  const toggleMute = () => {
    setMuted((m) => {
      saveStored(MUTED_KEY, m ? "0" : "1");
      return !m;
    });
  };

  const shareScore = async () => {
    const text = `I scored ${score} in colubrid 🐍 — beat that: ${SHARE_URL}`;
    try {
      if (navigator.share) {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
        setShareCopied(true);
        window.setTimeout(() => setShareCopied(false), 1600);
      }
    } catch {
      // share sheet dismissed / clipboard refused — nothing to clean up
    }
  };

  return (
    <div className="scene-wrap">
      <div ref={containerRef} className="scene" />
      <div className="hud">
        <div className="score">
          score {score}
          <span className="best">best {best}</span>
        </div>
        <div className="hud-buttons">
          <button
            className="hud-button"
            aria-label={muted ? "unmute sound" : "mute sound"}
            aria-pressed={!muted}
            onClick={toggleMute}
          >
            ♪
          </button>
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
            arena freely. Resume via the ▶ button or the P key. The intro
            card pauses the scene too — suppress this overlay under it. */}
        {paused && status === "running" && !introOpen && (
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
        {introOpen && (
          <button className="intro" onClick={dismissIntro}>
            <span className="intro-title">colubrid</span>
            <span className="intro-tagline">snake, but the grid is a cube</span>
            <span className="intro-rules">
              {isTouchDevice ? (
                <>
                  swipe to steer — the snake goes the way it looks on screen
                  <br />
                  two fingers (or the corner cube) spin the view
                </>
              ) : (
                <>
                  arrows / WASD steer · space &amp; shift go up / down
                  <br />
                  drag to spin the view · P pauses
                </>
              )}
            </span>
            <span className="intro-rules intro-goal">
              eat the glowing gem · a wall lights up when you share a
              coordinate with it — line up all three
            </span>
            <span className="game-over-hint">
              {isTouchDevice ? "tap to play" : "click anywhere to play"}
            </span>
          </button>
        )}
        {status === "dead" && (
          <div
            className="game-over"
            onClick={() => sceneRef.current?.restart()}
          >
            <span className="game-over-title">game over</span>
            <span className="game-over-score">
              score {score} · best {best}
            </span>
            {leaderboard && leaderboard.rank !== null && (
              leaderboard.rank <= 10 ? (
                <ol className="lb">
                  {leaderboard.top.map((entry, i) => (
                    <li
                      key={i}
                      className={entry.you ? "lb-row lb-you" : "lb-row"}
                    >
                      <span className="lb-rank">{i + 1}</span>
                      <span className="lb-name">
                        {entry.emoji} {entry.you ? "You" : entry.name}
                      </span>
                      <span className="lb-score">{entry.score}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                // Off the board: no list, just a quiet target to chase.
                <span className="lb-tease">
                  #{leaderboard.rank} of all players · top 10 starts at{" "}
                  {leaderboard.top[leaderboard.top.length - 1]?.score}
                </span>
              )
            )}
            <button
              className="share-button"
              onClick={(e) => {
                // The whole overlay restarts on tap — sharing shouldn't.
                e.stopPropagation();
                void shareScore();
              }}
            >
              {shareCopied ? "copied!" : "share score"}
            </button>
            <span className="game-over-hint">tap — or press R — to restart</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
