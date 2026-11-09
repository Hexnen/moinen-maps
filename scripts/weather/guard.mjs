/**
 * WEATHER FRAME GUARD (2026-11-08, "responsiveness above everything"; recovery reworked 2026-11-09): the weather gives way first
 * when this client's frames come late, and only for as long as they do: it always comes back to full.
 *
 * LATE: a drawn frame whose interval is over the paced frame time (view-smooth.mjs: k vsyncs; with Foundry's own cap, the cap's
 * frame time rounded UP to whole vsyncs: 60 fps on 165 Hz is 3 vsyncs, 18.2 ms) plus a slack of half a vsync, at least 4 ms (but
 * under a vsync): the timestamp jitter of a fast or variable-rate display is never a late frame, one missed vsync always is. The
 * vsync is the display's real one (vsyncFloor: the shortest recurring rAF interval), never an estimate that an overload stretches.
 * Each late frame counts the frames' worth it lost (one missed vsync at 60 Hz: 1; at 3 vsyncs a frame: a third; a long hitch up
 * to 3), so a few long hitches weigh like many short misses. Two shares, each averaged over a fixed TIME (so 60 and 144 Hz behave
 * alike in seconds, every frame weighing the same): a FAST one over ~0.4 s and a SLOW one over ~2 s, outside overloads only (the
 * background noise).
 *  - DOWN: the fast share over ENTER (about a third of the frames' time lost; random background noise of 1 frame in 10 stays well
 *    under it) lowers the detail `q` by a STEP (CUT, CUT_HARD when nearly every frame is late), glided over a fraction of a second,
 *    then WAITs to see what it did before the next step (never below Q_MIN): late frames go on for a moment after the cost has
 *    dropped, and a steady fall overshot to the floor each time. One lone hitch does not move it, nor does a stall over STALL ms (a
 *    tab switch, a load: not a sustained cost).
 *  - UP: once there is no overload, the time without one counts towards HOLD (fully while the slow share is under RESUME, at a
 *    quarter while it is higher: background noise from Foundry or the browser slows the return, it never blocks it, and a single
 *    late frame never resets it); then q rises smoothly back to 1 (UP per second, eased in).
 *  - NO PUMPING: an overload that comes back within PROBE ms of q rising was caused by the rise: q is then capped a little under the
 *    level it had when late frames began (MARGIN; twice that when it happens again under a cap) for a back-off that doubles with
 *    each repeat (B0 .. BMAX ms), then it tries again. After FORGET ms at full the back-off is forgotten. So a load that has really
 *    gone gets full detail back in a few seconds (at most a back-off later after a lasting one), a lasting one is held steady under
 *    it.
 * `q` scales the drops' and particles' density (a slot drops out at its own hash: they thin out, none pop as a group), the width of
 * the ground / haze footprint filter and the tornado's art budget and ray-march steps (all continuous), so a level change is never a
 * jump. Per client and only what this client draws (like the performance mode); CONFIG.moinenMaps.weatherGuard = false keeps q at 1.
 */
import { vsyncsPerFrame } from "../view-smooth.mjs";

export const GUARD = {
  tauF: 400, tauS: 2000, enter: 0.3, resume: 0.1, cut: 0.12, cutHard: 0.25, hard: 0.7, down: 0.6, wait: 700, up: 0.25, hold: 1500,
  ease: 500, qMin: 0.35, stall: 250, probe: 8000, margin: 0.08, b0: 6000, bMax: 16000, forget: 30000
};

export class FrameGuard {
  constructor(o = {}) { this.o = { ...GUARD, ...o }; this.reset(); }

  /** One drawn frame: `dt` ms since the one before, `frame` = the paced frame time, `slack` = how much later counts as late. */
  step(dt, frame, slack) {
    const o = this.o;
    if ( !(dt > 0) || dt > o.stall ) return this.q;
    // (how late: the frames' worth lost, so a frame 3 frames late weighs 3 and one vsync over a 3-vsync frame a third; at most 3)
    const late = dt > frame + slack ? Math.min(3, (dt - frame) / frame) : 0;
    this.t += dt;
    this.late += (late - this.late) * Math.min(1, frame / o.tauF);
    // (the level q was at when late frames began: the share crosses ENTER a moment later, q may have risen further by then)
    if ( this.late > 0.08 && !this.onset ) { this.onset = true; this.qOn = this.q; } else if ( this.late < 0.04 ) this.onset = false;
    // a step down under way: q glides to its target (DOWN per second)
    if ( this.q > this.tgt ) this.q = Math.max(this.tgt, this.q - o.down * dt / 1000);
    if ( this.late > o.enter ) {
      // an overload: caused by the last rise when it comes within PROBE of it (then hold q under that level for a back-off)
      if ( !this.trip ) {
        this.trip = true; this.trips++;
        if ( this.t - this.upAt < o.probe ) {
          this.back = Math.min(o.bMax, this.back ? this.back * 2 : o.b0);
          // (again while a cap holds: that cap was still too high, so the new one goes twice as far under)
          const qOn = Math.min(this.q, this.qOn);
          this.ceil = Math.max(o.qMin, this.t < this.ceilTo ? Math.min(this.ceil, qOn) - 2 * o.margin : qOn - o.margin);
          this.ceilTo = this.t + this.back;
        }
      }
      // one step down (bigger when nearly every frame is late), then WAIT to see what it did before the next: the frames come late
      // for a while after the cost has dropped (the GPU's queue), so a steady fall would overshoot to the floor every time
      if ( this.t >= this.waitTo && this.q > o.qMin ) {
        this.tgt = Math.max(o.qMin, this.q - (this.late > o.hard ? o.cutHard : o.cut));
        this.waitTo = this.t + (this.q - this.tgt) / o.down * 1000 + o.wait;
      }
      this.calm = 0;
      return this.q;
    }
    if ( this.late < o.enter * 0.5 ) this.trip = false;
    // (the slow share only outside an overload: it measures the background noise, not the overload just gone)
    this.slow += (late - this.slow) * Math.min(1, frame / o.tauS);
    this.calm += dt * (this.slow < o.resume ? 1 : 0.25);
    const cap = this.t < this.ceilTo ? this.ceil : 1;
    if ( this.calm > o.hold && this.q < cap && this.q <= this.tgt ) {
      const ease = Math.min(1, (this.calm - o.hold) / o.ease);
      this.q = this.tgt = Math.min(cap, this.q + o.up * ease * dt / 1000); this.upAt = this.t;
      this.trip = false;   // (a rise opens a new episode: an overload after it is a new trip, whatever the share did meanwhile)
    }
    if ( this.q >= 1 ) { this.full += dt; if ( this.full > o.forget ) this.back = 0; } else this.full = 0;
    return this.q;
  }

  reset() {
    this.q = 1; this.late = 0; this.slow = 0; this.calm = 0; this.t = 0; this.trip = false; this.trips = 0;
    this.upAt = -1e9; this.ceil = 1; this.ceilTo = -1e9; this.back = 0; this.full = 0; this.tgt = 1; this.waitTo = -1e9;
    this.onset = false; this.qOn = 1;
  }
}

/**
 * The late-frame test for a pacing ({ period, k, cap } from view-smooth's pacingInfo, period = vsync ms): { frame, slack } (ms), or
 * frame null while the display's rate is not measured yet (the guard waits: it never judges frames against a guessed rate).
 */
export function lateTest(p) {
  const period = p?.period ?? null, k = p?.k ?? null;
  if ( !period ) return { frame: null, slack: 0 };
  // (pacing "foundry": PIXI's own cap decides, k unknown: the cap's frame time in whole vsyncs, never under one)
  const frame = k ? period * k : p?.cap ? Math.max(1, Math.ceil(1000 / p.cap / period - 0.1)) * period : period;
  return { frame, slack: Math.max(period * 0.5, Math.min(4, period * 0.9)) };
}

/**
 * The display's vsync period (ms) from raw requestAnimationFrame intervals: the SHORTEST interval that recurs (at least `min` of them
 * within 8 %), not their middle. Under a GPU overload most intervals stretch to whole multiples of the vsync, and their middle (what
 * view-smooth paces with) climbs to the overloaded frame time itself, so frames judged against it never count as late and the guard
 * would let the detail back up while the load lasts; a few single-vsync intervals still come through even then (measured at 165 Hz
 * with every weather pass drawn 30 times: 35 of ~120), and they are the display's real rate. null = not enough intervals yet.
 */
export function vsyncFloor(intervals, min = 4) {
  const s = intervals.filter((d) => d > 2 && d < 60).sort((a, b) => a - b);
  for ( let i = 0; i + min <= s.length; i++ ) {
    let j = i; while ( j < s.length && s[j] <= s[i] * 1.08 ) j++;
    if ( j - i >= min ) { let m = 0; for ( let x = i; x < j; x++ ) m += s[x]; return m / (j - i); }
  }
  return null;
}

/* the raw rAF intervals (a no-op callback each vsync, only while a weather layer asks for q: stops 1.5 s after the last ask) */
const rafIv = []; let rafLast = null, rafOn = false, rafAsked = -1e9;
function rafLoop(t) {
  if ( rafLast !== null ) { const d = t - rafLast; if ( d > 2 && d < 60 ) { rafIv.push(d); if ( rafIv.length > 120 ) rafIv.shift(); } }
  rafLast = t;
  if ( performance.now() - rafAsked < 1500 ) requestAnimationFrame(rafLoop); else { rafOn = false; rafLast = null; }
}
function rafWatch() {
  rafAsked = performance.now();
  if ( !rafOn && globalThis.requestAnimationFrame ) { rafOn = true; requestAnimationFrame(rafLoop); }
}

/**
 * The paced frame time and slack now (ms), read at most once a second: view-smooth's mode and Foundry's cap, with the display's real
 * vsync (vsyncFloor; view-smooth's own estimate until there are enough intervals).
 */
let pace = { at: -1e9, frame: null, slack: 0, period: null };
let override = null;
/** Dev: judge frames against a fixed { frame, slack } (ms) instead of the measured pacing (a recording on a virtual clock); null = measured. */
export const setPacingOverride = (o) => { override = o; };
export function pacing(now = performance.now()) {
  if ( override ) return override;
  if ( now - pace.at < 1000 ) return pace;
  const p = globalThis.game?.modules?.get("moinen-maps")?.api?.view?.pacing?.();
  const period = vsyncFloor(rafIv) ?? p?.period ?? null;
  const k = !p || !period ? null : p.mode === "foundry" ? null : vsyncsPerFrame(p.mode, p.cap, period);
  pace = { at: now, period, ...lateTest({ period, k, cap: p?.cap ?? 0 }) };
  return pace;
}

/**
 * The weather's detail now, ONE guard for every weather layer of this client (the display, the tornadoes): stepped once per drawn
 * frame (the first caller in a frame steps it), from the canvas ticker's real elapsed time.
 */
const G = new FrameGuard();
let lastT = -1;
export function weatherQ() {
  if ( globalThis.CONFIG?.moinenMaps?.weatherGuard === false ) { G.reset(); return 1; }
  const T = globalThis.canvas?.app?.ticker; if ( !T ) return G.q;
  rafWatch();
  if ( T.lastTime !== lastT ) { lastT = T.lastTime; const P = pacing(); if ( P.frame ) G.step(T.elapsedMS, P.frame, P.slack); }
  return G.q;
}
/** The guard's state (api.weather.guard()): q, the fast and slow late shares, the cap and its back-off, the paced frame time. */
export const guardInfo = () => ({
  q: +G.q.toFixed(3), late: +G.late.toFixed(3), slow: +G.slow.toFixed(3), cap: G.t < G.ceilTo ? +G.ceil.toFixed(3) : 1,
  capFor: Math.max(0, Math.round(G.ceilTo - G.t)), trips: G.trips,
  frame: pace.frame === null ? null : +pace.frame.toFixed(2), slack: +pace.slack.toFixed(2),
  vsync: pace.period ? +pace.period.toFixed(2) : null
});
