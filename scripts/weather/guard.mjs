/**
 * WEATHER FRAME GUARD (2026-11-08, "responsiveness above everything"; recovery reworked 2026-11-09): the weather gives way
 * when this client's frames come late, and only for as long as they do: it always comes back to full. The guard itself (the late
 * test, the display's real vsync, the steps down, the recovery, no pumping) is scripts/frame-guard.mjs, shared with the fire's guard
 * since 2026-11-09 (moved there unchanged): ONE guard for the client, the weather and the fire each map its q to their own detail
 * (two guards would both cut on the same late frames and, each with its own back-off, probe upwards twice as often).
 * `q` scales the drops' and particles' density (a slot drops out at its own hash: they thin out, none pop as a group), the ground's
 * glints (each glint cycle has its own gate hash, fading over 0.15 of q), the wind's fine ground detail (blade streaks eased to their
 * mean, the light dashes on water faded), the haze's dither noise (eased to its mean) and the sand haze's lit / shadow sides (each
 * faded out over a span of q, its noise skipped below), the clouds' field resolution and godray samples, their bodies' finest rim octave
 * and the godrays' ring of taps (6 -> 3, blended), and the tornado's art budget and ray-march steps (all continuous), so a level
 * change is never a jump; under q 0.7 the lens copies the frame under the glass every other frame (a big drop refracts a frame-old
 * copy). Every one is exactly the full look at q = 1. Not scaled: the steam (under 0.07 ms GPU; measured 2026-11-09, dev/weather-q.mjs). Per client and only what this client draws (like the performance mode); CONFIG.moinenMaps.weatherGuard = false keeps q at 1,
 * CONFIG.moinenMaps.weatherQ = 0.35..1 holds it at that value (dev: the look and cost at a guard level, dev/weather-q.mjs).
 */
import { G, guardQ, guardOff, lastPacing } from "../frame-guard.mjs";
export { FrameGuard, GUARD, lateTest, vsyncFloor, pacing, setPacingOverride } from "../frame-guard.mjs";

/** The weather's detail now: the client's one guard (frame-guard.mjs: shared with the fire), for every weather layer of this client. */
export function weatherQ() {
  const C = globalThis.CONFIG?.moinenMaps, fq = C?.weatherQ;
  if ( typeof fq === "number" ) return Math.min(1, Math.max(0.35, fq));   // (dev: a fixed q, the detail at a guard level without a load)
  if ( C?.weatherGuard === false ) { guardOff("weather"); return 1; }
  return guardQ("weather");
}
/** The guard's state (api.weather.guard()): q, the fast and slow late shares, the cap and its back-off, the paced frame time. */
export const guardInfo = () => { const pace = lastPacing(); return {
  q: +G.q.toFixed(3), late: +G.late.toFixed(3), slow: +G.slow.toFixed(3), cap: G.t < G.ceilTo ? +G.ceil.toFixed(3) : 1,
  capFor: Math.max(0, Math.round(G.ceilTo - G.t)), trips: G.trips,
  frame: pace.frame === null ? null : +pace.frame.toFixed(2), slack: +pace.slack.toFixed(2),
  vsync: pace.period ? +pace.period.toFixed(2) : null
}; };
