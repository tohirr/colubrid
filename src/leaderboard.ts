// Client side of the leaderboard. A page concern like localStorage, so it
// lives next to App, not in src/game/.
//
// Identity: a random UUID minted on first visit and kept in localStorage —
// that's the whole "account". The server derives the gamer name and emoji
// from it deterministically; this file never needs to know them.

const PID_KEY = "colubrid.pid";

export interface LeaderboardEntry {
  name: string;
  emoji: string;
  score: number;
  you: boolean;
}

export interface LeaderboardResult {
  rank: number | null; // 1-based; null if the player isn't on the board
  top: LeaderboardEntry[];
}

export function getPlayerId(): string {
  try {
    let id = localStorage.getItem(PID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(PID_KEY, id);
    }
    return id;
  } catch {
    // Storage unavailable: a per-session id. Scores still count today,
    // they just won't accumulate across visits.
    return `session-${Math.random().toString(36).slice(2, 14)}`;
  }
}

// Reports a finished game and returns the standings — or null if the
// backend is unreachable, unconfigured, or slow. Null means "no
// leaderboard this time", never an error the game has to care about.
export async function submitScore(
  playerId: string,
  score: number,
): Promise<LeaderboardResult | null> {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch("/api/score", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId, score }),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return (await res.json()) as LeaderboardResult;
  } catch {
    return null;
  }
}
