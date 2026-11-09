/**
 * FRAME GUARD, shared (2026-11-09: moved out of weather/guard.mjs unchanged, used by the weather and the fire): a layer gives way
 * when this client's frames come late, and only for as long as they do: it always comes back to full.
 *
 * LATE: a drawn frame whose interval is over the paced frame time (view-smooth.mjs: k vsyncs; with Foundry's own cap, the cap's
 * frame time rounded UP to whole vsyncs: 60 fps on 165 Hz is 3 vsyncs, 18.2 ms) plus a slack of half a vsync, at least 4 ms (but
 * under a vsync): the timestamp jitter of a fast or variable-rate display is never a late frame, one missed vsync always is. The
 * vsync is the display's real one (vsyncFloor: the shortest recurring rAF interval, kept STICKY: stickyVsync), never an estimate that
 * an overload stretches.
 * Each late frame counts the frames' worth it lost (one missed vsync at 60 Hz: 1; at 3 vsyncs a frame: a third; a long hitch up
 * to 3), so a few long hitches weigh like many short misses. Two shares, each averaged over a fixed TIME (so 60 and 144 Hz behave
 * alike in seconds, every frame weighing the same): a FAST one over ~0.4 s and a SLOW one over ~2 s, outside overloads only (the
 * background noise).
 *  - DOWN: the fast share over ENTER (about a third of the frames' time lost; random background noise of 1 frame in 10 stays well
 *    under it; 2026-11-09: and over the measured NOISE by Z of its spread - up to a fifth of the frames late at random, from Foundry
 *    or the browser, never lowers it at any rate, and without noise ENTER is exactly 0.3 as before) lowers the detail `q` by a STEP (CUT, CUT_HARD when nearly every frame is late), glided over a fraction of a second,
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
 *  - ONE GUARD FOR THE CLIENT (2026-11-09): the weather and the fire both follow the same q (guardQ; each maps it to its own detail).
 *    Two guards would see the same late frames: both would step down on the same frame (twice the cut before either was seen) and,
 *    each with its own back-off, probe upwards twice as often (measured offline: the late share under a lasting load 16 -> 47 % at
 *    165 Hz with two guards taking turns); one guard steps, waits, caps and backs off once for everything this client draws.
 */
import { vsyncsPerFrame } from "./view-smooth.mjs";

export const GUARD = {
  tauF: 400, tauS: 2000, enter: 0.3, resume: 0.1, cut: 0.12, cutHard: 0.25, hard: 0.7, down: 0.6, wait: 700, up: 0.25, hold: 1500,
  ease: 500, qMin: 0.35, stall: 250, probe: 8000, margin: 0.08, b0: 6000, bMax: 16000, forget: 30000,
  tauN: 6000, z: 4, noiseCap: 0.25, enterMax: 0.6
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
    const a = Math.min(1, frame / o.tauF);
    this.late += (late - this.late) * a;
    // ENTER over the NOISE: the background's own late frames (their mean and spread, measured outside overloads over ~6 s) make the
    // fast share wander by chance (at 60 Hz with 1 frame in 5 late: +-0.06 around 0.2, over 0.3 every few seconds); an overload is a
    // share over that noise by z of its spreads (the fast share's own: sqrt(var x a / (2 - a))), never under ENTER. No noise: ENTER.
    const nm = Math.min(o.noiseCap, this.nm), sd = Math.sqrt(Math.max(0, this.n2 - this.nm * this.nm) * a / (2 - a));
    const E = Math.min(o.enterMax, Math.max(o.enter, nm + o.z * sd));
    // (the level q was at when late frames began: the share crosses ENTER a moment later, q may have risen further by then)
    if ( this.late > nm + 0.08 && !this.onset ) { this.onset = true; this.qOn = this.q; } else if ( this.late < nm + 0.04 ) this.onset = false;
    // a step down under way: q glides to its target (DOWN per second)
    if ( this.q > this.tgt ) this.q = Math.max(this.tgt, this.q - o.down * dt / 1000);
    if ( this.late > E ) {
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
    if ( this.late < E - o.enter * 0.5 ) this.trip = false;
    // (the slow share and the noise only outside an overload: they measure the background, not the overload just gone)
    this.slow += (late - this.slow) * Math.min(1, frame / o.tauS);
    const b = Math.min(1, frame / o.tauN); this.nm += (late - this.nm) * b; this.n2 += (late * late - this.n2) * b;
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
    this.onset = false; this.qOn = 1; this.nm = 0; this.n2 = 0;
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

/**
 * STICKY VSYNC (2026-11-09): the display's period as the guard keeps it. vsyncFloor alone drifted up under a constant CPU overload:
 * once its 120 intervals held no single-vsync one (~3 s at 165 Hz with 26 ms of work a frame) it read the overloaded interval as the
 * display's (24.2 ms) and the guard went blind (stopped at q 0.52). Now a SHORTER or equal recurring period is taken at once (a faster
 * display, or the same), a LONGER one only when it lasted LONG ms without the period kept recurring AND the frames' main-thread work
 * does not explain it (the median work of a frame - from its vsync to the end of the task that ran its callbacks - under half the
 * longer period); a longer period that is a whole multiple of the kept one (what an overload makes, and also a 120 -> 60 Hz throttle)
 * must last LONG_X ms. A window moved to a 60 Hz monitor, a laptop throttling its display: taken after a few / 20 seconds.
 * `st` = { period, longAt } (kept between reads), `cand` = vsyncFloor now, `busy` = the frames' median work (ms) or null.
 */
export const STICK = { long: 4000, longX: 20000, explain: 0.5 };
export function stickyVsync(st, cand, busy, now, o = STICK) {
  if ( !cand ) return st.period;
  if ( !st.period || cand <= st.period * 1.08 ) { st.period = cand; st.longAt = null; return cand; }
  st.longAt ??= now;
  const r = cand / st.period, multiple = Math.abs(r - Math.round(r)) < 0.06 * Math.round(r);
  // (only time the work does not explain counts: a CPU overload restarts the wait)
  if ( busy !== null && busy > o.explain * cand ) st.longAt = now;
  else if ( now - st.longAt >= (multiple ? o.longX : o.long) ) { st.period = cand; st.longAt = null; }
  return st.period;
}

/* the raw rAF intervals (a no-op callback each vsync, only while a guarded layer asks for q: stops 1.5 s after the last ask) and each
   frame's main-thread work (a message posted from the callback runs after the frame's callbacks and its drawing calls) */
const rafIv = [], rafBusy = []; let rafLast = null, rafOn = false, rafAsked = -1e9, chan = null;
function rafLoop(t) {
  if ( rafLast !== null ) { const d = t - rafLast; if ( d > 2 && d < 60 ) { rafIv.push(d); if ( rafIv.length > 120 ) rafIv.shift(); } }
  rafLast = t;
  if ( globalThis.MessageChannel ) {
    if ( !chan ) { chan = new MessageChannel(); chan.port1.onmessage = (e) => { const b = performance.now() - e.data; if ( b >= 0 && b < 250 ) { rafBusy.push(b); if ( rafBusy.length > 120 ) rafBusy.shift(); } }; }
    chan.port2.postMessage(t);
  }
  if ( performance.now() - rafAsked < 1500 ) requestAnimationFrame(rafLoop); else { rafOn = false; rafLast = null; }
}
export function rafWatch() {
  rafAsked = performance.now();
  if ( !rafOn && globalThis.requestAnimationFrame ) { rafOn = true; requestAnimationFrame(rafLoop); }
}

/**
 * The paced frame time and slack now (ms), read at most once a second: view-smooth's mode and Foundry's cap, with the display's real
 * vsync (vsyncFloor kept sticky: stickyVsync; view-smooth's own estimate until there are enough intervals).
 */
let pace = { at: -1e9, frame: null, slack: 0, period: null };
const vs = { period: null, longAt: null };
const median = (a) => { if ( a.length < 8 ) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
let override = null;
/** Dev: judge frames against a fixed { frame, slack } (ms) instead of the measured pacing (a recording on a virtual clock); null = measured. */
export const setPacingOverride = (o) => { override = o; };
export function pacing(now = performance.now()) {
  if ( override ) return override;
  if ( now - pace.at < 1000 ) return pace;
  const p = globalThis.game?.modules?.get("moinen-maps")?.api?.view?.pacing?.();
  const period = stickyVsync(vs, vsyncFloor(rafIv), median(rafBusy), now) ?? p?.period ?? null;
  const k = !p || !period ? null : p.mode === "foundry" ? null : vsyncsPerFrame(p.mode, p.cap, period);
  pace = { at: now, period, ...lateTest({ period, k, cap: p?.cap ?? 0 }) };
  return pace;
}
/** Dev: the vsync as kept, and the frames' median main-thread work (ms). */
export const vsyncInfo = () => ({ period: vs.period, longAt: vs.longAt, busy: median(rafBusy), floor: vsyncFloor(rafIv) });
/** The pacing as last measured (for a guard's info: never re-measures). */
export const lastPacing = () => pace;
/** The frame / slack frames are judged against now (the dev override when set, else as last measured). */
export const paceNow = () => override ?? pace;

/**
 * THE client's guard (the weather's and the fire's detail): stepped once per drawn frame (the first caller in a frame steps it), from
 * the canvas ticker's real elapsed time. `who` names the layer asking; guardOff(who): that layer keeps full detail (its CONFIG switch),
 * and the guard starts over unless another layer asked for q within the last half second (then it goes on for that one).
 */
export const G = new FrameGuard();
let lastT = -1;
const asked = new Map();
export function guardQ(who) {
  const T = globalThis.canvas?.app?.ticker; if ( !T ) return G.q;
  asked.set(who, performance.now());
  rafWatch();
  if ( T.lastTime !== lastT ) { lastT = T.lastTime; const P = pacing(); if ( P.frame ) G.step(T.elapsedMS, P.frame, P.slack); }
  return G.q;
}
export function guardOff(who) {
  asked.delete(who);
  const now = performance.now();
  for ( const t of asked.values() ) if ( now - t < 500 ) return;
  G.reset();
}
