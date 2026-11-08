/**
 * WEATHER FRAME GUARD (2026-11-08, "responsiveness above everything"): the weather gives way first when this client's frames come
 * late. Each drawn frame's interval is compared with the paced frame time (view-smooth.mjs: k vsyncs) plus half a vsync of slack;
 * the share of late frames (an average over about the last 16 frames) above ENTER lowers the weather's detail `q` steadily
 * (DOWN per second, never below Q_MIN); under LEAVE for HOLD ms it comes back slowly (UP per second). One lone hitch does not move
 * it (one late frame in 16 is 0.06), nor does a stall longer than STALL ms (a tab switch, a load: not a sustained cost).
 * `q` scales the drops' and particles' density (a slot drops out at its own hash: they thin out, none pop as a group) and the
 * width of the ground / haze footprint filter (continuous), so a level change is never a jump.
 * Per client and only what this client draws (like the performance mode); CONFIG.moinenMaps.weatherGuard = false keeps q at 1.
 */
export const GUARD = { alpha: 1 / 16, enter: 0.2, leave: 0.05, down: 0.3, up: 0.1, hold: 2000, qMin: 0.35, stall: 250 };

export class FrameGuard {
  constructor(o = {}) { this.o = { ...GUARD, ...o }; this.q = 1; this.late = 0; this.calm = 0; }

  /** One drawn frame: `dt` ms since the one before, `frame` = the paced frame time, `slack` = how much later counts as late. */
  step(dt, frame, slack) {
    const o = this.o;
    if ( !(dt > 0) || dt > o.stall ) return this.q;
    this.late += ((dt > frame + slack ? 1 : 0) - this.late) * o.alpha;
    if ( this.late > o.enter ) { this.q = Math.max(o.qMin, this.q - o.down * dt / 1000); this.calm = 0; }
    else if ( this.late < o.leave ) { this.calm += dt; if ( this.calm > o.hold && this.q < 1 ) this.q = Math.min(1, this.q + o.up * dt / 1000); }
    else this.calm = 0;
    return this.q;
  }

  reset() { this.q = 1; this.late = 0; this.calm = 0; }
}

/** The paced frame time and slack now (ms), read at most once a second (view-smooth.mjs pacing; 60 fps without it). */
let pace = { at: -1e9, frame: null, slack: 0 };
let override = null;
/** Dev: judge frames against a fixed { frame, slack } (ms) instead of the measured pacing (a recording on a virtual clock); null = measured. */
export const setPacingOverride = (o) => { override = o; };
export function pacing(now = performance.now()) {
  if ( override ) return override;
  if ( now - pace.at < 1000 ) return pace;
  const p = globalThis.game?.modules?.get("moinen-maps")?.api?.view?.pacing?.();
  const period = p?.period ?? null, k = p?.k ?? null;
  // (pacing "foundry": PIXI's own cap decides, k unknown: the cap's frame time, but never shorter than a vsync; the display's rate
  // not measured yet: frame null, the guard waits - it never judges frames against a guessed rate)
  const frame = period ? (k ? period * k : Math.max(period, p?.cap ? 1000 / p.cap : period)) : null;
  pace = { at: now, frame, slack: period ? period * 0.5 : 0 };
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
  if ( T.lastTime !== lastT ) { lastT = T.lastTime; const P = pacing(); if ( P.frame ) G.step(T.elapsedMS, P.frame, P.slack); }
  return G.q;
}
/** The guard's state (api.weather.guard()): q, the late share, the paced frame time. */
export const guardInfo = () => ({ q: +G.q.toFixed(3), late: +G.late.toFixed(3), frame: pace.frame === null ? null : +pace.frame.toFixed(2), slack: +pace.slack.toFixed(2) });
