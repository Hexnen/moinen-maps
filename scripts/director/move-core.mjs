/**
 * DIRECTOR SOURCE "token movement and combat turns", the pure parts (no Foundry; node-testable: dev/director-move.test.mjs).
 * The Foundry side is source-move.mjs.
 */
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------------------------------------------------------------- settings (world, key "dirMove") */

/**
 * move    - follow moving tokens when it matters;
 * turns   - combat turns: the camera goes to the active combatant;
 * banner  - the turn banner ("Round 2 - Kid Thor") on every screen;
 * ownStay - on your own turn the camera stays on your token (no return);
 * party   - the players' own tokens moved by their owners outside combat: "off" | "soft" (a long move as a marker) | "full";
 * moveSq  - the move length (grid squares) at which a move outside combat takes the camera.
 */
export const SET_DEFAULTS = Object.freeze({ move: true, turns: true, banner: true, ownStay: true, party: "soft", moveSq: 8 });
export const PARTY = ["off", "soft", "full"];
export const MOVE_SQ = [8, 2, 40];
export function sanitizeSet(o) {
  const out = { ...SET_DEFAULTS };
  if ( !o || typeof o !== "object" ) return out;
  for ( const k of ["move", "turns", "banner", "ownStay"] ) if ( typeof o[k] === "boolean" ) out[k] = o[k];
  if ( PARTY.includes(o.party) ) out.party = o.party;
  const n = Number(o.moveSq);
  if ( o.moveSq !== null && o.moveSq !== "" && typeof o.moveSq !== "boolean" && Number.isFinite(n) ) out.moveSq = clamp(Math.round(n), MOVE_SQ[1], MOVE_SQ[2]);
  return out;
}

/* ---------------------------------------------------------------- how much a move matters */

/**
 * The weight of a token's move (0 = not an event at all). m = {
 *   d (grid squares travelled), moveSq, combat (a started combat on this scene), active (the token is the active combatant),
 *   player (a player owns the token), byOwner (moved by one of its owners, not by the GM / someone else), forced (pushed: moved by
 *   somebody else or with a "displace" action), teleport, party ("off" | "soft" | "full"), takeAt (the director's take-over weight) }.
 * Returns { w, free }: free = the combat lane paces itself (no cooldown / rest downgrades).
 */
export function moveWeight(m) {
  const d = Math.max(0, Number(m.d) || 0), sq = Math.max(1, Number(m.moveSq) || 8), takeAt = Number.isFinite(m.takeAt) ? m.takeAt : 0.55;
  if ( m.combat && m.active ) return d >= 1 || m.teleport ? { w: 0.75, free: true } : { w: 0, free: false };
  if ( d < 2 && !(m.teleport && d >= 1) ) return { w: 0, free: false };
  let w = 0.1 + 0.55 * d / sq;
  if ( m.forced ) w += 0.15;
  if ( m.teleport ) w += 0.1;
  w = clamp(w, 0, 0.85);
  if ( m.player && m.byOwner && !m.forced ) {
    if ( m.combat ) w *= 0.8;                                         // out of turn (a reaction): a little less
    else if ( m.party === "off" ) w = 0;
    else if ( m.party === "soft" ) w = d >= sq ? Math.min(w, takeAt - 0.01) : 0;   // the party exploring: a long move as a marker, never the camera
  }
  return { w: Math.round(w * 1000) / 1000, free: false };
}

/* ---------------------------------------------------------------- geometry */

/** The flat path of token CENTRES (scene px) from its origin through the waypoints (top-left px; w, h = the token's px size) and its length. */
export function pathOf(origin, waypoints, w, h) {
  const p = [];
  const add = (q) => { if ( !q || !Number.isFinite(q.x) || !Number.isFinite(q.y) ) return; const x = q.x + w / 2, y = q.y + h / 2; if ( p.length && p[p.length - 2] === x && p[p.length - 1] === y ) return; p.push(x, y); };
  add(origin);
  for ( const q of waypoints ?? [] ) add(q);
  let len = 0;
  for ( let i = 2; i + 1 < p.length; i += 2 ) len += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return { p, len };
}
/** The box of a flat path, padded by `pad` px. */
export function pathBox(p, pad = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( let i = 0; i + 1 < p.length; i += 2 ) { x0 = Math.min(x0, p[i]); y0 = Math.min(y0, p[i + 1]); x1 = Math.max(x1, p[i]); y1 = Math.max(y1, p[i + 1]); }
  return Number.isFinite(x0) ? { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad } : null;
}
/** Shortens a flat path to at most `n` points (keeps the ends). */
export function thinPath(p, n = 24) {
  const k = p.length / 2;
  if ( k <= n ) return p.slice();
  const out = [];
  for ( let i = 0; i < n; i++ ) { const j = Math.round(i * (k - 1) / (n - 1)); out.push(p[j * 2], p[j * 2 + 1]); }
  return out;
}

/**
 * Is the scene box fully on this screen, inside `rect` (screen px: the part of the map not under Foundry's interface) less `margin` px,
 * for the camera `view` { x, y (the scene point at the screen centre), scale, vw, vh }?
 */
export function inView(box, view, rect, margin = 0) {
  if ( !box || !view || !rect ) return false;
  const sx = (x) => (x - view.x) * view.scale + view.vw / 2, sy = (y) => (y - view.y) * view.scale + view.vh / 2;
  return sx(box.x0) >= rect.x + margin && sx(box.x1) <= rect.x + rect.w - margin && sy(box.y0) >= rect.y + margin && sy(box.y1) <= rect.y + rect.h - margin;
}

/**
 * The zoom while following a token: about 16 x 10 squares on screen, never far from the player's own zoom (`home`): at most 20 % out,
 * in by part of the director's zoomIn (by the intensity `k`); the player's zoom unchanged with reduced motion.
 */
export function followScale(home, vw, vh, grid, zoomIn = 1.6, k = 1, reduced = false, limits = [0.1, 3]) {
  if ( reduced ) return home;
  const want = Math.min(vw / (grid * 16), vh / (grid * 10));
  const s = clamp(want, home * 0.8, home * (1 + (Math.max(1, zoomIn) - 1) * clamp(k, 0, 1) * 0.6));
  return clamp(s, limits[0], limits[1]);
}

/** A critically damped spring step (one axis): value `x` toward `to` with velocity `v`, smooth time `st` (s), step `dt` (s). Returns [x, v]. */
export function damp(x, to, v, st, dt) {
  const w = 2 / Math.max(0.01, st), q = w * dt, e = 1 / (1 + q + 0.48 * q * q + 0.235 * q * q * q);
  const ch = x - to, t = (v + w * ch) * dt;
  return [to + (ch + t) * e, (v - w * t) * e];
}
export const smooth = (t) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };

/**
 * The follow camera, one frame. st = { x, y, vx, vy (the spring), tx, ty, tvx, tvy (the token's own smoothed velocity), t (ms since
 * the start) } (made by followInit). `live` = the token's centre now (null = not visible here: the spring settles where it was last seen).
 * `from` = the camera when the shot began, `lead` = ms to blend from it into the follow, `scale0`/`scale1` the zoom from/to.
 * Look-ahead: the camera aims a little ahead of the token in its direction of travel (at most `ahead` px). Returns { x, y, scale }.
 */
export function followInit(live, from) {
  const p = live ?? from;
  return { x: p.x, y: p.y, vx: 0, vy: 0, lx: p.x, ly: p.y, tvx: 0, tvy: 0, t: 0, seen: !!live };
}
export function followStep(st, live, dtMs, { from, lead, scale0, scale1, ahead = 150, smoothS = 0.32 }) {
  const dt = clamp(dtMs, 0, 100) / 1000;
  st.t += dtMs;
  if ( live ) {
    if ( dt > 0 && st.seen ) {
      // the token's velocity, smoothed (px/s): waypoint corners do not jerk the aim
      const ivx = (live.x - st.lx) / dt, ivy = (live.y - st.ly) / dt, a = 1 - Math.exp(-dt / 0.18);
      st.tvx += (ivx - st.tvx) * a; st.tvy += (ivy - st.tvy) * a;
    }
    st.lx = live.x; st.ly = live.y; st.seen = true;
  } else { const a = 1 - Math.exp(-dt / 0.12); st.tvx -= st.tvx * a; st.tvy -= st.tvy * a; }
  let ax = st.tvx * 0.4, ay = st.tvy * 0.4;
  const m = Math.hypot(ax, ay);
  if ( m > ahead ) { ax *= ahead / m; ay *= ahead / m; }
  [st.x, st.vx] = damp(st.x, st.lx + ax, st.vx, smoothS, dt);
  [st.y, st.vy] = damp(st.y, st.ly + ay, st.vy, smoothS, dt);
  const e = lead > 0 ? smooth(st.t / lead) : 1;
  return { x: from.x + (st.x - from.x) * e, y: from.y + (st.y - from.y) * e, scale: scale0 + (scale1 - scale0) * e };
}

/* ---------------------------------------------------------------- the turn banner */

/**
 * What the banner says on a turn change: { kick: "round" | "start", round, title: the name (or null: hidden from this user), mine }.
 * prev / cur = Foundry's combat turn states { round, turn, combatantId }.
 */
export function bannerFor(prev, cur, { name, visible, mine } = {}) {
  if ( !cur || !Number.isFinite(cur.round) || cur.round < 1 ) return null;
  const start = !prev || !(prev.round >= 1);
  const newRound = start || cur.round !== prev.round;
  return { kick: start ? "start" : newRound ? "round" : "turn", round: cur.round, title: visible ? name || null : null, mine: !!(visible && mine) };
}
