/**
 * PROGRESS OF LONG JOBS, told truthfully and smoothly (no Foundry here: dev/progress.test.mjs runs it in node).
 *
 * Before: each indicator showed the raw percent of its job's coarse steps - the destruction bake sent 20% after the outlines (1% of
 * its time) and nothing more until the end of its one big part (a 10 s stroke: 20% for 10 s, then 100%); the water sent 5% before its
 * long preparation and 20% after it. Now:
 * - a job counts WORK, in estimated milliseconds: each kind of unit (a chunk, a bake work unit, a water frame...) has a cost per unit,
 *   learned on this client from its own past jobs (`rates`, localStorage), so the percent and the time left mean the same thing;
 * - the percent never goes back and never freezes then jumps: between the reports it creeps on at the measured pace, but never
 *   further than the unit in flight (`grain`) could take it, and a report that comes later than the creep just holds it;
 * - the time left is the work left at the measured pace (blended with the learned one while little is done), its end point
 *   smoothed so the countdown runs steadily instead of jumping with each report; the time spent is shown too.
 * Cost: a few numbers per report; the UI reads `view()` on its own slow timer (4 per second), never per frame.
 */

// (bake work units: core.mjs workOf - a window pixel; bakeOne: a bake of a few strokes in one job, bakePlain: plain looks (a stroke
// from its own data), bakeSub: strokes baked over the older ones they read - about 3x slower per pixel)
const DEFAULT_RATES = { chunk: 25, bakeOne: 0.004, bakePlain: 0.002, bakeSub: 0.006, show: 250, waterPrep: 1500, waterFrame: 120, wait: 0 };
const STORE = "mm-progress-rates";
let rates = null;

const now = () => (globalThis.performance?.now?.() ?? Date.now());
let clock = now;
/** Tests: a fake clock. */
export function setClock(fn) { clock = fn ?? now; }

function loadRates() {
  if ( rates ) return rates;
  rates = { ...DEFAULT_RATES };
  try { const r = JSON.parse(globalThis.localStorage?.getItem(STORE) ?? "null"); if ( r && typeof r === "object" ) for ( const [k, v] of Object.entries(r) ) if ( Number.isFinite(v) && v > 0 ) rates[k] = v; } catch { /* none kept */ }
  return rates;
}
function saveRates() { try { globalThis.localStorage?.setItem(STORE, JSON.stringify(rates)); } catch { /* fine */ } }
export function rateOf(kind) { return loadRates()[kind] ?? 1; }
/** Tests: forget what was learned. */
export function resetRates(r = null) { rates = { ...DEFAULT_RATES, ...(r ?? {}) }; }

/**
 * One job (the destruction of a scene, its water...). `run(kind, units, opts)` opens a stretch of work of that kind; the job's
 * percent is the estimated ms done of the estimated ms planned. A run can be planned ahead (`plan`) and opened later without
 * planning it twice (`preplanned`).
 */
export class Job {
  constructor(key, { title = "", data = null } = {}) {
    this.key = key; this.title = title; this.titleData = data;
    this.t0 = clock(); this.planned = 0; this.done = 0; this.lastAdvance = this.t0;
    this.runs = new Set(); this.stageKey = ""; this.stageData = null;
    this.shown = 0; this.lastView = 0; this.endEst = 0; this.activeMs = 0; this.activeFrom = null;
    this.ended = 0; this.ok = true; this.indeterminate = false;
  }
  /** Work planned ahead (estimated ms of `units` of `kind`). */
  plan(kind, units, par = 1) { if ( units > 0 ) this.planned += units * rateOf(kind) / Math.max(1, par); }
  /**
   * A stretch of work: `set(units done)` (monotonic), `end()` (all of it done). `grain`: the units one report may lag behind (how far the
   * bar may creep on its own); `preplanned`: units of it already in `plan`.
   */
  run(kind, units, { grain = 1, preplanned = 0, par = 1 } = {}) {
    // (`par`: the run is spread over that many workers - the rates are per worker, the wall time is shorter)
    const rate = rateOf(kind) / Math.max(1, par), job = this;
    const t0 = clock();
    this.planned += Math.max(0, units - preplanned) * rate;
    const r = {
      kind, units, rate, grain: Math.min(units, grain), at: 0, open: true,
      set(u) {
        if ( !r.open ) return;
        u = Math.min(r.units, u);
        if ( u <= r.at ) return;
        job.done += (u - r.at) * rate; r.at = u; job.lastAdvance = clock();
      },
      add(u = 1) { r.set(r.at + u); },
      /** More units of this run (more strokes painted while it bakes). */
      grow(u) { if ( u > 0 && r.open ) { r.units += u; job.planned += u * rate; } },
      end() {
        if ( !r.open ) return;
        r.set(r.units); r.open = false; job.runs.delete(r); job.#active();
        // what this kind really took (the time this run was open) against its estimate: the rate is learned per kind
        const k = (job.learn ??= new Map()).get(kind) ?? { ms: 0, est: 0 };
        k.ms += clock() - t0; k.est += r.units * rate; job.learn.set(kind, k);
      }
    };
    this.runs.add(r); this.#active();
    return r;
  }
  /** Work given up (a bake superseded by a newer one): its open runs close and what they had left is no longer planned. */
  drop() {
    for ( const r of this.runs ) r.open = false;
    this.runs.clear(); this.planned = this.done; this.#active();
  }
  /** What is happening now: an i18n key and its data. `indeterminate`: a wait with no measure (the bar runs without a percent). */
  stage(key, data = null, { indeterminate = false } = {}) { this.stageKey = key; this.stageData = data; this.indeterminate = indeterminate; }
  #active() {
    const t = clock();
    if ( this.runs.size && this.activeFrom === null ) this.activeFrom = t;
    else if ( !this.runs.size && this.activeFrom !== null ) { this.activeMs += t - this.activeFrom; this.activeFrom = null; }
  }
  /** Time spent working (waits with nothing in flight do not count for the pace). */
  activeTime(t = clock()) { return this.activeMs + (this.activeFrom !== null ? t - this.activeFrom : 0); }
  /** How much of the pace is measured (0..1): a sixth of the work done, or 1.5 s of it, whichever comes later. */
  confidence(t = clock()) { return this.planned > 0 ? Math.min(1, (this.done / this.planned) * 6, this.activeTime(t) / 1500) : 0; }
  /** The pace: real ms per estimated ms, measured, blended (in log) with 1 while little is done. */
  pace(t = clock()) {
    const a = this.activeTime(t);
    if ( this.done <= 0 || a <= 0 || this.planned <= 0 ) return 1;
    const s = Math.min(50, Math.max(0.02, a / this.done)), c = this.confidence(t);
    return Math.exp(c * Math.log(s));
  }
  /**
   * The state for the UI: frac (smoothed, monotonic 0..1), etaMs (null while it cannot be said), elapsedMs, stage. Call it from a
   * slow timer: each call steps the smoothing by the time since the last.
   */
  view(t = clock()) {
    const elapsedMs = t - this.t0;
    if ( this.ended ) return { key: this.key, frac: this.ok ? 1 : this.shown, etaMs: 0, elapsedMs: this.ended - this.t0, ended: true, ok: this.ok, job: this };
    const pace = this.pace(t), P = Math.max(1, this.planned);
    // the creep: the measured pace carries the bar on between reports, towards what the units in flight can reach - at the pace at
    // first, then ever slower past their expected time (an asymptote: it never stops dead, never passes the report it waits for)
    let reach = 0;
    for ( const r of this.runs ) reach += Math.min(r.units - r.at, r.grain) * r.rate;
    const x = Math.max(0, t - this.lastAdvance) / pace;
    const creep = this.runs.size && reach > 0 ? reach * (1 - Math.exp(-x / reach)) : 0;
    const target = Math.min(0.995, (this.done + creep) / P);
    const dt = this.lastView ? Math.max(0, t - this.lastView) : 1e9;
    this.lastView = t;
    // (a job that grew a lot - many strokes painted on top - starts its bar again rather than standing still for long)
    if ( target < this.shown - 0.3 ) this.shown = target;
    else if ( target > this.shown ) this.shown += (target - this.shown) * (1 - Math.exp(-dt / 220));
    // the time left: the work left at the pace; its end point eased (a countdown, not a jumping number)
    let etaMs = null;
    // (said only once half of the pace is measured: an unlearned prior was 15x off on a first Rebake all)
    const sure = this.runs.size && this.planned > 0 && this.confidence(t) >= 0.5;
    if ( sure ) {
      const end = t + Math.max(0, P - this.done - creep) * pace;
      this.endEst = this.endEst ? this.endEst + (end - this.endEst) * (1 - Math.exp(-dt / 1200)) : end;
      etaMs = Math.max(0, this.endEst - t);
    } else this.endEst = 0;
    return { key: this.key, frac: this.indeterminate && !this.runs.size ? null : this.shown, etaMs, elapsedMs, ended: false, job: this };
  }
  /** Done: what was measured teaches the rate of each kind it ran (the time its runs were open against their estimate, eased). */
  finish(ok = true) {
    if ( this.ended ) return;
    for ( const r of [...this.runs] ) ok ? r.end() : (r.open = false);
    this.runs.clear(); this.#active();
    this.ended = clock(); this.ok = ok;
    if ( ok && this.learn ) {
      loadRates();
      for ( const [k, m] of this.learn ) {
        if ( !rates[k] || m.est <= 0 || m.ms < 300 ) continue;
        const s = Math.min(16, Math.max(1 / 16, m.ms / m.est));
        rates[k] = Math.exp(Math.log(rates[k]) * 0.45 + Math.log(rates[k] * s) * 0.55);
      }
      saveRates();
    }
  }
}

/** "~6 s", "~1 min 20 s" (Polish/English words come from the caller's format). */
export function splitTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return { m: Math.floor(s / 60), s: s % 60, total: s };
}

/**
 * fxs2 (U232 of invincible-plus-ultra): where the floating progress line stands, as its distance from the bottom of the window: over
 * the hotbar (as before) AND over what other modules declared across the bottom (zones uiInset: a combat dock and its armed panel), so
 * a scene opening after a reload in the middle of a fight never lies over the dock. Pure: `hotTop` the hotbar's top (null: none shown),
 * `vh` the window's height, `insetBottom` the declared bottom inset (px from the bottom). -> px from the bottom
 */
export function lineBottom(hotTop, vh, insetBottom = 0, gap = 10) {
  const hot = Number.isFinite(hotTop) && hotTop > 0 && hotTop < vh ? Math.round(vh - hotTop + gap) : 84;
  const ins = Number.isFinite(insetBottom) && insetBottom > 0 ? Math.round(insetBottom + gap) : 0;
  return Math.max(hot, ins);
}
