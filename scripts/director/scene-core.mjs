/**
 * DIRECTOR - SCENE TRANSITIONS, the pure parts (no Foundry, no DOM; node-testable: dev/director-scene.test.mjs).
 *
 * When a player arrives on a map (a scene other than the one this browser tab showed last) the director plays an ARRIVAL:
 *   - a DIP: the screen goes dark the moment the old scene is torn down and comes back up when the new one is ready (and the module's
 *     own baked layers have had their reveal, so nothing pops in under the player's eyes) - never later than a short cap: the load
 *     itself is never waited on or slowed;
 *   - a TITLE CARD with the scene's name as the navigation bar shows it (never more than Foundry itself shows the player);
 *   - an ESTABLISHING SHOT: the camera starts wide (on what this player may see) and glides into the player's own view; on the Orbit
 *     scene it starts close and pulls back (going up), on a landing it starts high and comes down.
 * Everything is per client: every player's load takes its own time, so each plays its arrival when its own canvas is ready.
 */
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------------------------------------------------------------- settings (world) */

/** [default, lo, hi] of the numbers. */
export const NUM = {
  cardMs: [2800, 1200, 8000],      // how long the title card stays (full form)
  glideMs: [3000, 1000, 8000],     // the establishing shot's glide into the player's own view
  holdMs: [900, 0, 2500]           // the dip waits at most this long after the scene is ready (for the module's reveal / the title)
};
export const BOOLS = { on: true, card: true, shot: true, dip: true, login: true };
/** names: "nav" = what the navigation bar shows the player (navigation name, else the name); "navOnly" = only a navigation name. */
export const STRS = { names: ["nav", "navOnly"] };
export const DEFAULTS = Object.freeze({ ...Object.fromEntries(Object.entries(NUM).map(([k, v]) => [k, v[0]])), ...BOOLS, names: "nav" });

export function cleanSettings(o) {
  const out = { ...DEFAULTS };
  if ( !o || typeof o !== "object" ) return out;
  for ( const [k, [, lo, hi]] of Object.entries(NUM) ) { const n = Number(o[k]); if ( o[k] !== null && o[k] !== "" && typeof o[k] !== "boolean" && Number.isFinite(n) ) out[k] = clamp(n, lo, hi); }
  for ( const k of Object.keys(BOOLS) ) if ( typeof o[k] === "boolean" ) out[k] = o[k];
  for ( const [k, list] of Object.entries(STRS) ) if ( list.includes(o[k]) ) out[k] = o[k];
  return out;
}

/** A scene's own options (flag dirScene): { title, sub, off }. Text is trimmed and cut to a sane length. */
export function cleanSceneFlag(f) {
  const s = (v, n) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, n) : "");
  if ( !f || typeof f !== "object" ) return { title: "", sub: "", off: false };
  return { title: s(f.title, 120), sub: s(f.sub, 120), off: f.off === true };
}

/* ---------------------------------------------------------------- what the card says */

/**
 * The title card's text: { title, sub }. `scene` = { name, navName, orbit } (plain values), `flag` = cleanSceneFlag(), `names` the policy.
 * The GM's own card title wins; else the navigation name; else the scene's name - which the navigation bar already shows to every
 * player viewing the scene ("nav"), or nothing ("navOnly"). The Orbit scene is the module's own: its name is public.
 */
export function titleOf(scene, flag, names = "nav") {
  const f = cleanSceneFlag(flag), nav = String(scene?.navName ?? "").trim(), name = String(scene?.name ?? "").trim();
  let title = f.title || nav;
  if ( !title && (names !== "navOnly" || scene?.orbit) ) title = name;
  return { title: title.slice(0, 120), sub: f.sub };
}

/* ---------------------------------------------------------------- whether and how */

/**
 * What this client plays on a canvasReady: "full" | "soft" | "none". ctx = {
 *   killed, settings (cleanSettings), sceneOff (the scene's flag), mode (the director mode of this client: "full" | "soft" | "bar" | "off"),
 *   fresh (a scene this tab did not show last), first (the first scene of this tab: a login / a new tab), busy (the player is at work),
 *   screen (someone else owns the screen: a show / a shot), k (the effective intensity), forced (the GM's test) }.
 */
export function decideArrival(ctx) {
  if ( ctx.killed ) return "none";
  const s = ctx.settings ?? DEFAULTS;
  if ( !ctx.forced ) {
    if ( !s.on || ctx.sceneOff || !ctx.fresh ) return "none";
    if ( ctx.first && !s.login ) return "none";
  }
  if ( ctx.mode === "off" || ctx.mode === "bar" ) return ctx.forced ? "full" : "none";
  if ( ctx.mode === "soft" || ctx.busy || ctx.screen || !(ctx.k >= 0.15) ) return "soft";
  return "full";
}

/** The dip (dark between the scenes) on a tear-down: only for a real change of scene, never for a redraw of the same one. */
export function dipOnTearDown({ killed, settings, mode, from, to, nextOff, native }) {
  const s = settings ?? DEFAULTS;
  if ( killed || !s.on || !s.dip || !to || from === to || nextOff || native ) return false;
  return mode === "full" || mode === "soft";
}

/**
 * The camera's start of the establishing shot. `home` = the player's own view { x, y, scale } (where Foundry put it), `vw`, `vh` the
 * screen (px), `box` = what this player may see (scene px; the whole scene without token vision, the reach of their vision with it;
 * null = nothing to show wide), `move` = "establish" | "rise" (into orbit: start close, pull back) | "descend" (a landing: start high,
 * come down) | "none", `k` the intensity 0..1, `limits` the zoom range. Returns { x, y, scale, move } (move "none" = no camera at all).
 */
export function startView({ home, vw, vh, box = null, clip = null, move = "establish", k = 1, reduced = false, limits = [0.1, 3] }) {
  const q = clamp(Number(k) || 0, 0, 1);
  const none = { x: home.x, y: home.y, scale: home.scale, move: "none" };
  if ( reduced || move === "none" || q < 0.15 ) return none;
  const lim = (s) => clamp(s, limits[0], limits[1]);
  if ( move === "rise" ) return { x: home.x, y: home.y, scale: lim(home.scale * (1 + 0.85 * q)), move };
  if ( move === "descend" ) return { x: home.x, y: home.y, scale: lim(home.scale * (1 - 0.62 * q)), move };
  if ( !box || !(box.x1 > box.x0) || !(box.y1 > box.y0) ) return none;
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0, fit = Math.min(vw / (bw * 1.12), vh / (bh * 1.12));
  // wide: the whole of what may be seen when it fits between 0.4x and 0.78x of the player's zoom; a small area: a gentle pull-in
  const wide = clamp(fit, home.scale * 0.4, home.scale * 0.78);
  const scale = lim(lerp(home.scale, wide, q));
  const c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  // the start frames the box's middle but leans toward the player's view, so the glide reads as one move into it (not a sweep across)
  const lean = fit >= home.scale * 0.78 ? 0.7 : 0.35;
  return inside({ x: lerp(c.x, home.x, lean), y: lerp(c.y, home.y, lean), scale, move: "establish" }, clip, vw, vh, home.scale);
}

/**
 * Keep a wide start on the map: never so far out that the empty canvas around the scene shows (unless the player's own view already
 * does), and the centre pulled in so the frame stays inside `clip` (the scene rect) where it can.
 */
function inside(v, clip, vw, vh, homeScale) {
  if ( !clip || !(clip.x1 > clip.x0) || !(clip.y1 > clip.y0) ) return v;
  const W = clip.x1 - clip.x0, H = clip.y1 - clip.y0;
  const scale = Math.max(v.scale, Math.min(homeScale, Math.max(vw / W, vh / H)));
  const hw = vw / (2 * scale), hh = vh / (2 * scale);
  const x = W >= 2 * hw ? clamp(v.x, clip.x0 + hw, clip.x1 - hw) : (clip.x0 + clip.x1) / 2;
  const y = H >= 2 * hh ? clamp(v.y, clip.y0 + hh, clip.y1 - hh) : (clip.y0 + clip.y1) / 2;
  return { ...v, x, y, scale };
}

/** The glide's length (ms): the setting, a little longer for a big change of zoom or place, never under 1 s. */
export function glideMs(start, home, base = DEFAULTS.glideMs, vw = 1600) {
  if ( start.move === "none" ) return 0;
  const zoom = Math.abs(Math.log(start.scale / home.scale)) / Math.log(2.5);
  const way = Math.hypot(start.x - home.x, start.y - home.y) * home.scale / Math.max(400, vw);
  return Math.round(clamp(base * (0.8 + 0.25 * Math.min(1, zoom) + 0.15 * Math.min(1, way)), 1000, 9000));
}

/**
 * The arrival's timeline (ms from the moment the scene is ready): { veilAt (the dip starts to lift), veilMs (its fade), cardAt, cardOut,
 * glideAt, glideEnd, end }. `wait` = how long the module's reveal still needs (ms, 0 = ready), capped by holdMs; `veil` = a dip is up.
 */
export function timeline({ form, settings, glide = 0, wait = 0, veil = true, card = true, reduced = false }) {
  const s = settings ?? DEFAULTS, soft = form === "soft";
  const veilAt = veil ? Math.round(clamp(Math.max(soft ? 120 : 380, wait), 0, Math.max(soft ? 120 : 380, s.holdMs))) : 0;
  const veilMs = !veil ? 0 : soft ? 450 : reduced ? 900 : 1100;
  const cardAt = !card ? -1 : veil ? 120 : 250;
  const cardMs = soft ? Math.min(s.cardMs, 2600) : s.cardMs;
  const cardOut = card ? cardAt + cardMs : -1;
  const glideAt = veilAt, glideEnd = glideAt + (soft ? 0 : glide);
  const end = Math.max(glideEnd, cardOut + 700, veilAt + veilMs);
  return { veilAt, veilMs, cardAt, cardOut, glideAt, glideEnd, end };
}

/** Grow a box by `m` on every side and cut it to `clip` (both scene px); null when nothing is left. */
export function clipBox(b, clip, m = 0) {
  if ( !b ) return null;
  const o = { x0: Math.max(clip.x0, b.x0 - m), y0: Math.max(clip.y0, b.y0 - m), x1: Math.min(clip.x1, b.x1 + m), y1: Math.min(clip.y1, b.y1 + m) };
  return o.x1 > o.x0 && o.y1 > o.y0 ? o : null;
}
