/**
 * COMBAT STAGE, the pure parts (no Foundry; node-testable: dev/director-stage.test.mjs). The Foundry side is source-stage.mjs.
 *
 * In combat the camera does not go home between beats: the active combatant's turn, its move, its attack and the result are one piece of
 * staging (the director's shots of the combat lane), the camera STAYS where the last beat left it and carries straight on to the next
 * combatant. It goes home only when the combat ends, on the player's own turn (home, with their token on screen) or when the player asks
 * (Esc / the "my view" chip). The letterbox comes only for the big beats (a hit). A player who takes the camera is left alone.
 */
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------------------------------------------------------------- settings (world, key "dirStage") */

/**
 * on    - the stage mode (off = every combat beat is an ordinary take-over that returns home);
 * bars  - the letterbox of the combat beats: "hits" (only when an attack hits), "attacks" (every attack), "never";
 * back  - seconds: after the player moved the camera themselves the stage leaves them alone at least this long (and for the rest of that turn).
 */
export const STAGE_DEFAULTS = Object.freeze({ on: true, bars: "hits", back: 5 });
export const BARS = ["hits", "attacks", "never"];
export const BACK = [5, 1, 30];
export function sanitizeStage(o) {
  const out = { ...STAGE_DEFAULTS };
  if ( !o || typeof o !== "object" ) return out;
  if ( typeof o.on === "boolean" ) out.on = o.on;
  if ( BARS.includes(o.bars) ) out.bars = o.bars;
  const n = Number(o.back);
  if ( o.back !== null && o.back !== "" && typeof o.back !== "boolean" && Number.isFinite(n) ) out.back = clamp(Math.round(n), BACK[1], BACK[2]);
  return out;
}

/* ---------------------------------------------------------------- geometry */

/** Scene box -> screen px for the camera `view` { x, y (scene point at the screen centre), scale, vw, vh }. */
export function toScreenBox(box, view) {
  const sx = (x) => (x - view.x) * view.scale + view.vw / 2, sy = (y) => (y - view.y) * view.scale + view.vh / 2;
  return { x0: sx(box.x0), y0: sy(box.y0), x1: sx(box.x1), y1: sy(box.y1) };
}
/**
 * Is the scene box inside the COMFORT zone of the view: the safe `rect` (screen px: the map less Foundry's interface) shrunk by `f` of its
 * width / height on every side. A subject there needs no camera move (the stage's dead zone).
 */
export function comfortable(box, view, rect, f = 0.16) {
  if ( !box || !view || !rect ) return false;
  const s = toScreenBox(box, view), mx = rect.w * f, my = rect.h * f;
  return s.x0 >= rect.x + mx && s.x1 <= rect.x + rect.w - mx && s.y0 >= rect.y + my && s.y1 <= rect.y + rect.h - my;
}
/** The scene point that puts screen point (px, py) of `rect`'s centre... : the camera centre that shows scene point p at the middle of `rect`. */
export function centreFor(p, rect, view, scale) {
  // the safe rect is not centred on the window (sidebar, hotbar): aim the point at the rect's middle, not the window's
  const dx = (rect.x + rect.w / 2) - view.vw / 2, dy = (rect.y + rect.h / 2) - view.vh / 2;
  return { x: p.x - dx / scale, y: p.y - dy / scale, scale };
}
/** Two views about the same (centre within `px` screen px and zoom within 3 %). */
export const sameView = (a, b, px = 6) => !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) * b.scale <= px && Math.abs(a.scale / b.scale - 1) <= 0.03;

/**
 * The calm camera of a turn: none when the combatant is already comfortable on screen at about the stage zoom, else the view that centres
 * it at the stage zoom (`scale`: the player's own zoom). Returns null (stay) or { x, y, scale, ms } (ms: the glide, longer for a longer way).
 */
export function turnCamera(box, view, rect, scale, lead = 850) {
  const zoomOk = Math.abs(view.scale / scale - 1) <= 0.15;
  if ( zoomOk && comfortable(box, view, rect) ) return null;
  const c = centreFor({ x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }, rect, view, scale);
  const screens = Math.hypot(c.x - view.x, c.y - view.y) * view.scale / Math.max(1, Math.hypot(view.vw, view.vh));
  return { ...c, ms: Math.round(clamp(lead * (0.85 + 0.6 * screens), lead * 0.8, lead * 1.6)) };
}
/**
 * The view the player goes back to on their own turn: their home, moved (same zoom) so that their token sits well inside the frame
 * (the comfort zone: `f` of the rect in from every side) when it is not - the smallest shift that does it, so the player's own framing
 * stays as it was, and never a token parked on the edge above the hotbar. `view` carries vw/vh.
 */
export function ownHome(home, tokenBox, rect, view, f = 0.2) {
  const h = { ...view, x: home.x, y: home.y, scale: home.scale };
  if ( !tokenBox || comfortable(tokenBox, h, rect, f) ) return { x: home.x, y: home.y, scale: home.scale };
  const s = toScreenBox(tokenBox, h), zx0 = rect.x + rect.w * f, zx1 = rect.x + rect.w * (1 - f), zy0 = rect.y + rect.h * f, zy1 = rect.y + rect.h * (1 - f);
  // screen px the token has to move (into the zone; centred when it is bigger than the zone)
  const need = (a0, a1, z0, z1) => (a1 - a0 > z1 - z0 ? (z0 + z1) / 2 - (a0 + a1) / 2 : a0 < z0 ? z0 - a0 : a1 > z1 ? z1 - a1 : 0);
  const dx = need(s.x0, s.x1, zx0, zx1), dy = need(s.y0, s.y1, zy0, zy1);
  return { x: home.x - dx / home.scale, y: home.y - dy / home.scale, scale: home.scale };
}

/**
 * THE STAGE ZOOM: a fight keeps about one zoom (the player's own), so the camera does not breathe out and in with every attack.
 * `band` = how far from the player's zoom a beat may go ([out, in], x the player's zoom).
 */
export const ZOOM_BAND = Object.freeze([0.85, 1.12]);
/** The zoom a turn glides at: the zoom now while it is within the band of the player's (no re-zoom after an attack), else theirs. */
export function stageZoom(now, base, band = ZOOM_BAND) {
  if ( !(base > 0) ) return now;
  const k = now / base;
  return k >= band[0] - 1e-6 && k <= band[1] + 1e-6 ? now : base;
}
/**
 * The camera of an attack: null when attacker and target (`box`) are comfortable on screen already (it plays in place), else a view at
 * a zoom within the band of the player's zoom `base` that holds the whole box when it fits; when it does not fit even at the band's
 * widest, the TARGET (`focus`, the place the hit lands) stays whole in the frame and the frame leans toward the attacker as far as that
 * allows. `rect` = the free part of the screen (screen px).
 */
export function attackCamera(box, focus, view, rect, base, band = ZOOM_BAND, margin = 0.06) {
  if ( comfortable(box, view, rect, margin) ) return null;
  const mx = 0.12, my = 0.2;                                       // (room around the subject; the bars of a hit cover top and bottom)
  const uw = rect.w * (1 - 2 * mx), uh = rect.h * (1 - 2 * my);
  const bw = Math.max(1, box.x1 - box.x0), bh = Math.max(1, box.y1 - box.y0);
  const fit = Math.min(uw / bw, uh / bh);
  const scale = clamp(fit, base * band[0], base * band[1]);
  let cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  if ( fit < scale && focus ) {
    const hw = uw / (2 * scale), hh = uh / (2 * scale);
    const keep = (c, a0, a1, half) => (a1 - a0 >= 2 * half ? (a0 + a1) / 2 : clamp(c, a1 - half, a0 + half));
    cx = keep(cx, focus.x0, focus.x1, hw); cy = keep(cy, focus.y0, focus.y1, hh);
  }
  return centreFor({ x: cx, y: cy }, rect, view, scale);
}

/* ---------------------------------------------------------------- the stage of one client */

/**
 * The state of the stage on one client:
 *   combat  - the combat being staged (id) or null;   turn - "round:combatant" of the turn now;
 *   home    - the player's own view (where the camera goes back to), taken when the first beat takes the camera;
 *   parked  - where the last beat LEFT the camera (it is away from home), or null (the camera is home / the player's);
 *   out     - the turn the player stepped out of (Esc, took the camera): its beats come soft;
 *   ownAt   - when the player last moved the camera themselves (ms).
 */
export function newStage() { return { combat: null, turn: null, home: null, parked: null, out: null, ownAt: -Infinity }; }

/** How a combat beat that may take the camera plays on this client: "take" or "soft" (the player is out of the stage for now). */
export function beatForm(st, now, backMs) {
  if ( st.out && st.out === st.turn ) return "soft";
  if ( now - st.ownAt < backMs ) return "soft";
  return "take";
}
/**
 * A beat took the camera: the home is the player's view now, unless the camera is already the stage's (parked, or `onStage`: a beat
 * plays now and this one carries on from it).
 */
export function beatStart(st, view, onStage = false) {
  if ( st.home && (st.parked || onStage) ) return;
  st.home = { x: view.x, y: view.y, scale: view.scale }; st.parked = null;
}
/**
 * A beat ended: why = the director's end reason; taken = the player took the camera during it; view = the camera now.
 * "done" (its time, no return): the camera is parked there. "cut" (Esc / a click): the camera went home, the player is out for this turn.
 * Taken: the camera is the player's (where they put it is their view), out for this turn. Skip / scene / show / error: the camera went
 * back home (or the scene is gone).
 */
export function beatEnd(st, why, taken, view, now) {
  if ( taken ) { st.parked = null; st.home = null; st.ownAt = now; st.out = st.turn; return; }
  if ( why === "done" ) { st.parked = { x: view.x, y: view.y, scale: view.scale }; return; }
  if ( why === "replaced" ) return;
  st.parked = null;
  if ( why === "cut" ) st.out = st.turn;
}
/** The player moved the camera themselves (not a shot): it is theirs; parked or not, their view is now their home. */
export function ownMove(st, now) {
  st.ownAt = now;
  if ( st.parked ) st.out = st.turn;
  st.parked = null; st.home = null;
}
/**
 * The turn changed. Returns what the camera does on this client now: null (nothing), or { home: true } (go home: own turn) when the
 * stage has the camera (parked away, or `onStage`: a beat plays now). `own` = it is this player's own combatant's turn.
 */
export function turnChange(st, turn, own, onStage = false) {
  st.turn = turn;
  if ( st.out && st.out !== turn ) st.out = null;
  return own && st.home && (st.parked || onStage) ? { home: true } : null;
}
/** The combat is over (or the stage switched off): go home when the camera is parked away; the stage forgets everything. */
export function stageEnd(st) {
  const go = st.parked && st.home ? { home: true, to: { ...st.home } } : null;
  Object.assign(st, newStage());
  return go;
}
