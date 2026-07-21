// The leaderboard backend — a single Vercel serverless function. The
// client POSTs { playerId, score } after every game; this records the
// play, keeps each player's best in a Redis sorted set, and answers with
// the top 10 plus the caller's rank. The game never blocks on it: if this
// endpoint is down or unconfigured, the client just skips the leaderboard.
//
// Storage is Upstash Redis (Vercel marketplace, free tier). Data layout:
//   lb:top          — sorted set: member = playerId, score = their best
//   player:{id}     — hash: name, emoji, best, plays, firstSeen, lastSeen
//   plays:{date}    — counter: total games finished that day
// The player hashes + daily counters are the "analytics": open the Upstash
// data browser to see who plays and how often. Nothing else is collected —
// the playerId is a random UUID minted by the browser, tied to nothing.

import { Redis } from "@upstash/redis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// Identities are DERIVED from the playerId, not stored: the same id always
// hashes to the same name and emoji, so there's no assignment step and no
// race. Players never pick these — they're just stable, human-readable
// labels for the leaderboard.
const ADJECTIVES = [
  "Turbo", "Sneaky", "Cosmic", "Silent", "Neon", "Mighty", "Pixel", "Shadow",
  "Golden", "Frozen", "Blazing", "Lucky", "Quantum", "Wobbly", "Feral", "Dizzy",
];
const NOUNS = [
  "Mamba", "Viper", "Cobra", "Python", "Boa", "Adder", "Krait", "Taipan",
  "Serpent", "Sidewinder", "Rattler", "Racer", "Copperhead", "Kingsnake",
  "Garter", "Anaconda",
];
const EMOJI = [
  "🐍", "🦎", "🐢", "🐸", "🦖", "🦕", "🐉", "🐊", "🐙", "🦑", "🦂", "🐝",
  "🐞", "🦋", "🐌", "🦔", "🦉", "🦅", "🦜", "🐬", "🦈", "🐋", "🐆", "🐅",
  "🦓", "🦒", "🦘", "🦬", "🐃", "🐫", "🦩", "🦚",
];

// FNV-1a: a tiny, well-distributed string hash — plenty for picking names.
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function identityFor(playerId: string): { name: string; emoji: string } {
  const h = fnv1a(playerId);
  return {
    name:
      ADJECTIVES[h % ADJECTIVES.length] +
      NOUNS[(h >>> 4) % NOUNS.length],
    emoji: EMOJI[(h >>> 8) % EMOJI.length],
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  // Support both env spellings: the Upstash marketplace integration
  // injects UPSTASH_REDIS_REST_*; older Vercel KV setups inject KV_REST_API_*.
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return res.status(503).json({ error: "leaderboard not configured" });
  }
  const redis = new Redis({ url, token });

  const { playerId, score } = (req.body ?? {}) as {
    playerId?: unknown;
    score?: unknown;
  };
  if (
    typeof playerId !== "string" ||
    playerId.length < 8 ||
    playerId.length > 64 ||
    typeof score !== "number" ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > 5000 // nobody legitimately eats 5000 gems; drop garbage
  ) {
    return res.status(400).json({ error: "bad request" });
  }

  const you = identityFor(playerId);
  const now = Date.now();
  const day = new Date().toISOString().slice(0, 10);

  // Record the play (this is the whole analytics story: a per-player
  // counter with timestamps, and a per-day global counter).
  const pipeline = redis.pipeline();
  pipeline.hincrby(`player:${playerId}`, "plays", 1);
  pipeline.hsetnx(`player:${playerId}`, "firstSeen", now);
  pipeline.hset(`player:${playerId}`, {
    lastSeen: now,
    name: you.name, // stored only so the data browser is readable
    emoji: you.emoji,
  });
  pipeline.incr(`plays:${day}`);
  if (score > 0) {
    // GT: only ever raise a player's entry — replaying can't lower it.
    pipeline.zadd("lb:top", { gt: true }, { score, member: playerId });
    pipeline.zremrangebyrank("lb:top", 0, -101); // keep top 100, tidy forever
  }
  await pipeline.exec();

  // Standings, after this game is counted.
  const [flat, zeroRank] = await Promise.all([
    redis.zrange<string[]>("lb:top", 0, 9, { rev: true, withScores: true }),
    redis.zrevrank("lb:top", playerId),
  ]);

  // withScores returns a flat [member, score, member, score, …] list.
  const top: Array<{ name: string; emoji: string; score: number; you: boolean }> =
    [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const member = String(flat[i]);
    const id = identityFor(member);
    top.push({
      name: id.name,
      emoji: id.emoji,
      score: Number(flat[i + 1]),
      you: member === playerId,
    });
  }

  return res.status(200).json({
    rank: zeroRank === null ? null : zeroRank + 1,
    top,
  });
}
