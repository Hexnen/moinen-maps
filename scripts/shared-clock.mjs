/**
 * A SHARED WALL CLOCK for moments stored in scene flags (destruction entries, a Detonate): milliseconds since 1970 on the server's
 * clock, so a stored moment means the same after a reload, a world relaunch or a server restart.
 *
 * Why not `game.time.serverTime`: in v14 it is `Date.now() - <the moment the WORLD was launched>` on the server (dist/components/
 * activity.mjs), i.e. uptime. A moment saved as uptime lies hours in the future (or past) after the next launch, so an entry waited
 * hidden "until then" and the damage looked gone after a restart.
 *
 * The clock is this client's `Date.now()` corrected by `skew` (server minus client): coarse from the HTTP Date header of a cheap
 * request (1 s resolution, used only when the client is off by more than that), refined by the scene's `_stats.modifiedTime` whenever
 * an update arrives (the server stamps it with its own Date.now(); the sample is late by the one-way latency, so the largest
 * recent sample is the best estimate). Pure parts (`classify`, `refine`) are node-tested (dev/shared-clock.test.mjs).
 */

/** A shared moment never lies more than this far ahead (ms); anything later is stale (a clock gone wrong) and counts as long past. */
export const FUTURE_SLACK = 5000;
/** Stored moments below this are LEGACY uptime values (`game.time.serverTime` before this fix): long past, shown settled. */
export const LEGACY_BELOW = 1e12;   // 2001-09-09

/**
 * How long ago a stored moment was, as the comparisons need it: `age = now - t` (negative: still ahead, at most FUTURE_SLACK).
 * A missing, legacy (uptime) or far-future moment is Infinity: settled, never waited for.
 */
export function ageOf(t, nowMs) {
  if ( !Number.isFinite(t) || t < LEGACY_BELOW ) return Infinity;
  const age = nowMs - t;
  return age < -FUTURE_SLACK ? Infinity : age;
}

/** One modifiedTime sample (server ms) received at client time `clientMs`: the new skew estimate (max of the recent ones). */
export function refine(samples, serverMs, clientMs, keep = 8) {
  if ( !Number.isFinite(serverMs) || serverMs < LEGACY_BELOW ) return samples.length ? Math.max(...samples) : null;
  samples.push(serverMs - clientMs);
  while ( samples.length > keep ) samples.shift();
  return Math.max(...samples);
}

let skew = 0, coarse = null, wired = false;
const samples = [];

/** Now on the shared clock (ms since 1970, server time). The first call wires the calibration. */
export const sharedNow = () => { if ( !wired ) initSharedClock(); return Date.now() + skew; };
export const clockInfo = () => ({ skew, coarse, samples: [...samples] });

/** A modifiedTime stamped by the server just now (an update hook): refine the skew. Ignored when it disagrees with the coarse
 * estimate by more than the Date header's resolution plus a generous latency (an old stamp, a document not just written). */
export function sample(serverMs) {
  if ( !Number.isFinite(serverMs) ) return;
  const s = serverMs - Date.now();
  if ( coarse !== null && Math.abs(s - coarse) > 3000 ) return;
  const v = refine(samples, serverMs, Date.now());
  if ( v !== null ) skew = v;
}

/** The coarse correction: the server's HTTP Date header (1 s resolution). Only a client off by more than ~1.5 s is corrected. */
export async function calibrate() {
  try {
    const t0 = Date.now();
    const r = await fetch(`${foundry.utils.getRoute("icons/svg/d20.svg")}?mm=${t0}`, { method: "HEAD", cache: "no-store" });
    const t1 = Date.now(), d = Date.parse(r.headers.get("date") ?? "");
    if ( !Number.isFinite(d) ) return;
    coarse = d + 500 - (t0 + t1) / 2;                 // the header truncates to the second: its middle
    if ( Math.abs(coarse) > 1500 + (t1 - t0) && !samples.length ) skew = Math.round(coarse);
  } catch ( err ) { /* offline / blocked: the client clock as it is */ }
}

/** Wire the refinement: every scene update carries a fresh server stamp. */
export function initSharedClock() {
  if ( wired ) return;
  wired = true;
  calibrate();
  Hooks.on("updateScene", (doc) => sample(doc?._stats?.modifiedTime));
}
