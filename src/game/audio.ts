// Sound, synthesized from scratch with the Web Audio API — no audio files.
// Every sound here is built the same way: an OscillatorNode (a raw tone)
// shaped by a GainNode envelope (its loudness over time). Short envelopes
// are the whole trick — a 150ms blip reads as "pop", the same tone held
// for a second reads as "alarm".
//
// Like state.ts, this module knows nothing about Three.js or React. The
// scene calls the play functions at event moments; App owns the mute
// button and persistence.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

// Browsers refuse to make sound until the user has interacted with the
// page (autoplay policy) — an AudioContext created before that starts
// "suspended". We create it lazily on the first play call and nudge
// resume() each time; by the time anything is worth hearing (first food),
// the player has long since swiped or pressed a key.
function ensureContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null; // ancient browser
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx.state === "running" ? ctx : null;
}

export function setMuted(next: boolean): void {
  muted = next;
  // setTargetAtTime instead of assigning .value: a tiny ramp (~30ms)
  // avoids the audible click a hard gain jump produces mid-waveform.
  if (ctx && master) {
    master.gain.setTargetAtTime(next ? 0 : 1, ctx.currentTime, 0.01);
  }
}

// One enveloped tone: start at `freq`, optionally glide to `endFreq`,
// while the volume decays exponentially to silence over `duration`.
function blip(
  type: OscillatorType,
  freq: number,
  endFreq: number,
  duration: number,
  volume: number,
  startDelay = 0,
) {
  const c = ensureContext();
  if (!c || !master) return;
  const t0 = c.currentTime + startDelay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq !== freq) {
    osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + duration);
  }
  gain.gain.setValueAtTime(volume, t0);
  // Exponential decay can't reach true zero — land near it, then stop.
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + duration);
  // Once stopped, an oscillator is dead; disconnecting frees the graph.
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

// Eat: a bright two-note pop. The pitch climbs a little as the score
// grows — the same audio cue as the speed ramp, so your ears learn the
// pace of the run. Caps out so late game doesn't squeak.
export function playEat(score: number): void {
  const base = 420 * Math.pow(2, Math.min(score, 24) / 48);
  blip("sine", base, base * 1.5, 0.12, 0.25);
  blip("sine", base * 2, base * 2, 0.08, 0.12, 0.04); // sparkle on top
}

// Death: a falling groan — the classic "power down". Low triangle sweep,
// with a second detuned voice underneath for a bit of roughness.
export function playDeath(): void {
  blip("triangle", 220, 55, 0.6, 0.3);
  blip("sawtooth", 110, 40, 0.6, 0.12);
}

// New personal best, announced the moment it's beaten: a quick rising
// major arpeggio. Deliberately short — it plays mid-run.
export function playBest(): void {
  blip("sine", 523, 523, 0.09, 0.16); // C5
  blip("sine", 659, 659, 0.09, 0.16, 0.07); // E5
  blip("sine", 784, 784, 0.14, 0.18, 0.14); // G5
}
