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
 * a zoom within the band of the player's zoom `base` (the zoom on screen when that holds the pair) that holds the whole box when it fits; when it does not fit even at the band's
 * widest, the TARGET (`focus`, the place the hit lands) stays whole in the frame and the frame leans toward the attacker as far as that
 * allows. `rect` = the free part of the screen (screen px).
 */
export function attackCamera(box, focus, view, rect, base, band = ZOOM_BAND, margin = 0.06) {
  if ( comfortable(box, view, rect, margin) ) return null;
  const mx = 0.12, my = 0.2;                                       // (room around the subject; the bars of a hit cover top and bottom)
  const uw = rect.w * (1 - 2 * mx), uh = rect.h * (1 - 2 * my);
  const bw = Math.max(1, box.x1 - box.x0), bh = Math.max(1, box.y1 - box.y0);
  const fit = Math.min(uw / bw, uh / bh);
  // the zoom on screen stays when it is within the band and holds the pair: no push-in, no pull-out (the steadiest frame)
  const now = clamp(view.scale, base * band[0], base * band[1]);
  const scale = fit >= now ? now : clamp(fit, base * band[0], base * band[1]);
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

/* ---------------------------------------------------------------- framing what a combat module names (dev/zones-api.md 38) */

/**
 * A combat module that runs the fight itself tells the map WHAT to frame (api.frame); the stage decides WHETHER and HOW on this client.
 * The rules, all of them here:
 *   - the zoom is the user's: a frame never changes it;
 *   - a subject that is inside the free part of the screen already moves nothing (FRAME_F of the stretch in from every side);
 *   - else the view slides by the LEAST that brings it FRAME_IN inside; several subjects that fit are brought in together; when they
 *     do not fit at the user's zoom the FIRST one (the focus: where it lands) is kept whole and the frame leans toward the others;
 *   - the user's hand wins (frameGate), and what the camera took the user takes back with "My view" for LINGER_MS after the move.
 */
export const FRAME_F = 0.05, FRAME_IN = 0.14, LINGER_MS = 8000;
export const LEVELS = ["turn", "all"];
const union = (a, b) => (!a ? b : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const okBox = (b) => !!b && [b.x0, b.y0, b.x1, b.y1].every(Number.isFinite) && b.x1 >= b.x0 && b.y1 >= b.y0;

/**
 * The boxes of what a frame names, as THIS client's canvas draws it: boxOf(id) -> a scene box, or null for a token this user is not
 * shown (hidden from it, out of its sight, gone). A token not shown is left out; when the FOCUS (the first) is not shown the answer
 * is null: nothing is framed. So a view never moves toward, or because of, what this user cannot see, whatever the caller named.
 */
export function frameSubjects(ids, boxOf) {
  const list = (Array.isArray(ids) ? ids : []).map((id) => { try { return boxOf(id) ?? null; } catch { return null; } });
  if ( list.length && !list[0] ) return null;
  return list.filter(Boolean);
}
/**
 * Where the view goes for `boxes` (scene boxes, the focus first): null (nothing to frame), { moved: false } (it is on screen), or
 * { moved: true, x, y, scale (= the view's), whole (every box is in), ms }.
 */
export function framePlan(boxes, view, rect, { fit = true, base = 420 } = {}) {
  const list = (Array.isArray(boxes) ? boxes : []).filter(okBox);
  if ( !list.length || !view || !rect || !(view.scale > 0) ) return null;
  const fits = (b) => (b.x1 - b.x0) * view.scale <= rect.w * (1 - 2 * FRAME_IN) && (b.y1 - b.y0) * view.scale <= rect.h * (1 - 2 * FRAME_IN);
  // uxd (U142) fit "near": the focus and, in the order given (nearest first), as many of the others as still fit with it at the
  // user's zoom - those are the subject; the rest is left out (a move pick: the mover and the zones on offer nearest to it)
  const near = (l) => { let u = l[0]; for ( const b of l.slice(1) ) { const n = union(u, b); if ( fits(n) ) u = n; } return u; };
  const focus = list[0], all = fit === "near" ? near(list) : fit ? list.reduce(union, null) : focus;
  const done = (to, whole) => {
    if ( sameView(to, view, 2) ) return { moved: false };
    const screens = Math.hypot(to.x - view.x, to.y - view.y) * view.scale / Math.max(1, Math.hypot(view.vw, view.vh));
    return { moved: true, x: to.x, y: to.y, scale: view.scale, whole, ms: Math.round(clamp(base * (0.75 + 1.6 * screens), base * 0.75, base * 2.2)) };
  };
  if ( comfortable(all, view, rect, FRAME_F) ) return { moved: false };
  if ( fits(all) ) return done(ownHome(view, all, rect, view, FRAME_IN), fit !== "near" || fits(list.reduce(union, null)));
  // they do not fit at the user's zoom: the focus alone decides whether anything moves; then it stays whole, the frame leans to the rest
  if ( comfortable(focus, view, rect, FRAME_F) ) return { moved: false };
  if ( !fits(focus) ) return done(centreFor({ x: (focus.x0 + focus.x1) / 2, y: (focus.y0 + focus.y1) / 2 }, rect, view, view.scale), false);
  const lean = attackCamera(all, focus, view, rect, view.scale, [1, 1], FRAME_F);
  const to = lean ? ownHome(lean, focus, rect, view, FRAME_F) : ownHome(view, focus, rect, view, FRAME_IN);
  return done(to, false);
}

/**
 * uxd (U142): the free stretch a frame works in, narrowed by the boxes other modules asked the map to keep clear of (`uiAvoid`: a GM's
 * desk, a challenges band, a party panel) the way an open window narrows it: for each box that lies over the stretch (the largest
 * first) the largest part of the stretch beside it, above or below it that is still at least `minW` x `minH`; a box that would leave
 * no such part is passed over (the stretch is never given up for a panel). rect { x, y, w, h }, boxes [{ x0, y0, x1, y1 }] (client px).
 */
export function avoidRect(rect, boxes, { minW = 280, minH = 200 } = {}) {
  if ( !rect || !Array.isArray(boxes) || !boxes.length ) return rect;
  let r = { x0: rect.x, y0: rect.y, x1: rect.x + rect.w, y1: rect.y + rect.h };
  const area = (q) => Math.max(0, q.x1 - q.x0) * Math.max(0, q.y1 - q.y0);
  const list = boxes.filter(okBox).slice().sort((p, q) => area(q) - area(p));
  for ( const b of list ) {
    if ( b.x1 <= r.x0 || b.x0 >= r.x1 || b.y1 <= r.y0 || b.y0 >= r.y1 ) continue;
    const parts = [{ ...r, x1: Math.min(r.x1, b.x0) }, { ...r, x0: Math.max(r.x0, b.x1) }, { ...r, y1: Math.min(r.y1, b.y0) }, { ...r, y0: Math.max(r.y0, b.y1) }]
      .filter((q) => q.x1 - q.x0 >= minW && q.y1 - q.y0 >= minH).sort((p, q) => area(q) - area(p));
    if ( parts.length ) r = parts[0];
  }
  return { ...rect, x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 };
}

/**
 * May a frame move this client's view now? null (yes) or the reason it may not:
 *   "off"    the user's switch says never; "level" it is a beat for "all" and the user chose "turn";
 *   "held"   another module holds the camera; "busy" a show or a take-over has the screen;
 *   "hand"   the user is at work on the map, moved the camera a moment ago (`backMs`), or asked for their view back this turn.
 * `hand: true` = the frame answers the user's own act (a unit chosen, a target walked to with Tab): only the switch, a held camera and
 * a busy screen stop it. `out` is kept per turn (the stage's state).
 */
export function frameGate(st, { follow = "all", level = "turn", hand = false, now = 0, backMs = 5000, busy = false, held = false, screen = false } = {}) {
  if ( follow === "off" ) return "off";
  if ( !LEVELS.includes(level) ) return "level";
  if ( level === "all" && follow !== "all" ) return "level";
  if ( held ) return "held";
  if ( screen ) return "busy";
  if ( busy ) return "hand";
  if ( hand ) return null;
  if ( st.out && st.out === st.turn ) return "hand";
  if ( now - st.ownAt < backMs ) return "hand";
  return null;
}
/** A frame is about to move the view: the home is the user's view now unless the camera is already away from it. */
export function frameStart(st, view, hand = false) {
  if ( hand ) return;
  if ( st.home && st.parked ) return;
  st.home = { x: view.x, y: view.y, scale: view.scale }; st.parked = null;
}
/** The move ended: `arrived` false = the user stopped it (the camera is theirs). A hand frame leaves no home: it was the user's own move. */
export function frameEnd(st, to, arrived, hand, now) {
  if ( !arrived ) { ownMove(st, now); return; }
  if ( hand ) { st.parked = null; st.home = null; return; }
  st.parked = { x: to.x, y: to.y, scale: to.scale };
}
/** "My view" was not asked for in time: where the camera stands is the user's view now. */
export function frameSettle(st) { st.parked = null; st.home = null; }

/** A director shot that a driven fight replaces on this client (the combat module frames it itself): `tokens` = the fight's token ids. */
export const DRIVEN_KINDS = Object.freeze(["turn", "attack", "roll", "damage"]);
export function drivenShot(shot, combatId, tokens) {
  if ( !shot || !combatId ) return false;
  if ( shot.lane === `cbt-${combatId}` ) return true;
  if ( DRIVEN_KINDS.includes(shot.kind) ) return true;
  if ( shot.kind === "move" ) return (shot.tokens ?? []).some((id) => tokens.has(id));
  return false;
}
