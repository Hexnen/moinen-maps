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

const DEFAULT_RATES = { chunk: 25, bake: 0.004, show: 250, waterPrep: 1500, waterFrame: 120, wait: 0 };
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
  plan(kind, units) { if ( units > 0 ) this.planned += units * rateOf(kind); }
  /**
   * A stretch of work: `set(units done)` (monotonic), `end()` (all of it done). `grain`: the units one report may lag behind (how far the
   * bar may creep on its own); `preplanned`: units of it already in `plan`.
   */
  run(kind, units, { grain = 1, preplanned = 0 } = {}) {
    const rate = rateOf(kind), job = this;
    (this.learn ??= new Set()).add(kind);
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
      end() { if ( !r.open ) return; r.set(r.units); r.open = false; job.runs.delete(r); job.#active(); }
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
  /** The pace: real ms per estimated ms, measured, blended (in log) with 1 while little is done. */
  pace(t = clock()) {
    const a = this.activeTime(t);
    if ( this.done <= 0 || a <= 0 || this.planned <= 0 ) return 1;
    const s = Math.min(50, Math.max(0.02, a / this.done)), c = Math.min(1, (this.done / this.planned) * 4, a / 2500);
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
    const sure = this.runs.size && this.planned > 0 && (this.activeTime(t) >= 700 && this.done / P >= 0.03);
    if ( sure ) {
      const end = t + Math.max(0, P - this.done - creep) * pace;
      this.endEst = this.endEst ? this.endEst + (end - this.endEst) * (1 - Math.exp(-dt / 1200)) : end;
      etaMs = Math.max(0, this.endEst - t);
    } else this.endEst = 0;
    return { key: this.key, frac: this.indeterminate && !this.runs.size ? null : this.shown, etaMs, elapsedMs, ended: false, job: this };
  }
  /** Done: what was measured teaches the rates of the kinds it ran (one pace for all of them, eased). */
  finish(ok = true) {
    if ( this.ended ) return;
    for ( const r of [...this.runs] ) ok ? r.end() : (r.open = false);
    this.runs.clear(); this.#active();
    this.ended = clock(); this.ok = ok;
    if ( ok && this.learn && this.done > 0 && this.activeMs >= 400 ) {
      const s = Math.min(8, Math.max(0.125, this.activeMs / this.done));
      loadRates();
      for ( const k of this.learn ) if ( rates[k] ) rates[k] = Math.exp(Math.log(rates[k]) * 0.65 + Math.log(rates[k] * s) * 0.35);
      saveRates();
    }
  }
}

/** "~6 s", "~1 min 20 s" (Polish/English words come from the caller's format). */
export function splitTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return { m: Math.floor(s / 60), s: s % 60, total: s };
}
