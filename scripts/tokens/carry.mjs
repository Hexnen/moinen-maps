/**
 * CARRY A TOKEN WITH A DESTRUCTION STROKE (runtime). The pure parts (pick, click / drag, the path -> position clock, the pose, the `tk`
 * record) are in carry-core.mjs; the format of `tk` and the gesture are described there.
 *
 * Playback (every client, from display.enter's hook): the token's DISPLAY position follows the stroke's path in step with the entry's
 * front (the same clock: entry start + the front's delay, the path's own times), leaning and stretched as it is flung, with a puff at
 * lift-off and landing and a little dust behind it. Only the visuals move: the mesh (and with it the dynamic ring) and the token
 * container (bars, nameplate), the way token-drop.mjs's Drop does (the base transform Foundry set is captured part by part when Foundry's
 * refresh flags say it reset that part; the pose is re-applied in the `refreshToken` hook in the same frame; restored at the end by
 * Foundry's own refresh routines). The offset is always "where the carry wants the token" minus "where Foundry has it", so a document
 * that moves meanwhile (the hand-over at the end) never pops.
 *
 * The end: "moves for real" (default): the GM client that painted the stroke (and only it, only for a stroke that has just been painted
 * or redone; replays are visual only) updates the token document to tk.x1, tk.y1 when the path ends; every client keeps the token on the
 * path end until its document is there, then glides the little that is left. "returns": the token glides back to where it really is.
 * One ticker listener, only while a carry runs; nothing is allocated per frame.
 *
 * SUPERHERO (the "plough"): a carry stroke may also hold `tk.hit`, the tokens the carried one ploughs through (plough-core.mjs computes it once,
 * when the stroke is committed; every client plays the record). Each pushed token is one more Carry of the same class (so it shares the
 * pose, the dust, the hand-over and the z-order treatment of the carried one) whose timeline is its recorded centre path, starting at the
 * moment of contact; it has no real move of its own: the carried token's Carry moves every document in ONE batched update.
 */
import { reducedMotion, dbg } from "../config.mjs";
import { perfMode } from "../perf-mode.mjs";
import { restoreExact, tokenBusy, claimToken, releaseToken } from "../token-drop.mjs";
import { Emitter, artPx } from "./pixels.mjs";
import { tokenFxOn } from "./settings.mjs";
import * as C from "./carry-core.mjs";
import * as X from "./plough-core.mjs";
import * as Front from "./carry-front.mjs";
const FRONT_GRACE_MS = 300;    // the token stays in front at least this long after its carry ends, and until the stroke's entry has ended (Front.release)

const ACTIVE = new Map();      // Token -> Carry
const SEEN = new Map();        // stroke id -> the entry start already played (a stroke has several areas: one carry)
const DUST = [0xd8ccb4, 0xb8a990, 0x8f816c, 0xc9bca2];
const D_ = { x: 0, y: 0, ux: 0, uy: 0, sp: 0 }, P_ = { sx: 1, sy: 1, rot: 0, lift: 0, k: 0 };   // scratch (one carry steps at a time)
const stats = { played: 0, moved: 0, visual: 0, skipped: 0, unmoved: 0, pushed: 0 };
let ticking = false;

function tick(frames) {
  const dt = Math.min(frames / 60, 0.05), now = performance.now();
  for ( const c of ACTIVE.values() ) c.update(dt, now);          // (a carry that ends deletes itself: safe while iterating a Map)
  if ( !ACTIVE.size ) { canvas.app?.ticker?.remove(tick); ticking = false; }
}
function startTicker() { if ( !ticking && canvas.app?.ticker ) { canvas.app.ticker.add(tick); ticking = true; } }

function sortNextTo(obj, token, step) {
  const m = token.mesh;
  Object.assign(obj, { elevation: m?.elevation ?? token.document.elevation ?? 0, sortLayer: m?.sortLayer ?? 700, sort: (m?.sort ?? 0) + step, _lastSortedIndex: 0 });
  canvas.primary.addChild(obj);
}

/** A deterministic phase (0..2pi) from an id: the same wobble on every client. */
function phaseOf(id) { let h = 2166136261; for ( let i = 0; i < id.length; i++ ) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return ((h >>> 0) % 6283) / 1000; }

/** Is this token being dragged by a user right now? (Foundry's own drag: we do not fight it.) */
const dragged = (token) => { try { return !!token?.isDragged; } catch { return false; } };

/** May the pushed token's document be moved to its recorded end? It is there, still where the plough found it, not locked and not being dragged. */
function pushable(scene, h) {
  const d = scene.tokens.get(h.id);
  if ( !d || d.locked ) return false;
  if ( Math.abs(d.x - h.x0) > 2 || Math.abs(d.y - h.y0) > 2 ) return false;
  return !dragged(d.object);
}

class Carry {
  /** `o`: { objId, tk, tl, t0 (when the path's clock starts, performance.now ms), real, visual, live (is the stroke's entry still running? the front is held till it is not) } */
  constructor(token, o) {
    Object.assign(this, o);
    this.token = token; this.doc = token.document; this.dead = false; this.moved = false;
    const { width, height } = this.doc.getSize();
    this.W = width; this.H = height; this.S = height;
    const n = o.tl.n;
    // a carried token starts at the grab point's token centre; a pushed one at its recorded first point (the contact), its timeline is absolute
    this.C0x = this.hit ? o.tl.X[0] : this.tk.x0 + width / 2; this.C0y = this.hit ? o.tl.Y[0] : this.tk.y0 + height / 2;
    this.endX = this.hit ? o.tl.X[n - 1] : this.C0x + o.tl.dx; this.endY = this.hit ? o.tl.Y[n - 1] : this.C0y + o.tl.dy;
    this.D = o.D ?? o.tl.D;                                 // the CARRIER's run (the hand-over clock of everyone)
    this.tOff = this.hit ? o.tl.tt[0] : 0;                  // the moment this body's own run begins
    this.Dl = o.tl.tt[n - 1] - this.tOff;                   // ... and how long it lasts
    this.ph = this.hit ? phaseOf(this.doc.id) : 0;          // a pushed token's jitter (the same on every client)
    this.pushed = [];                                       // the Carries of the tokens this one ploughs
    this.base = null; this.off = { x: 0, y: 0 };
    this.mode = this.tk.e ? "return" : "real";
    if ( this.mode === "return" ) this.real = false;                          // (a returning token never moves for real)
    if ( this.hit ) this.real = false;                        // (only the carried token's Carry moves documents)
    this.waitFrom = 0; this.arrivedAt = 0; this.lastEl = -1e9; this.lastDust = 0; this.started = false; this.landed = false;
    this.root = null; this.em = null;
    if ( this.visual ) {
      Hooks.callAll("moinenMapsTokenFxBusy", token);        // an idle pose of tokens/fx.mjs lets go first (restoreExact)
      claimToken(token);
      this.capture();
      this.root = new PIXI.Container(); this.root.eventMode = "none"; sortNextTo(this.root, token, 2);
      this.em = new Emitter(this.root);
    }
    this.tag = `carry:${this.objId}`;
    Front.hold(this.doc.id, this.tag);                      // above every layer of the destruction (and the editor's overlay) for the whole carry
    Front.release(this.doc.id, "grab");                     // (the editor held it from the press)
    ACTIVE.set(token, this);
    startTicker();
  }

  capture(parts = { pos: true, scale: true, rot: true }) {
    const t = this.token, m = t.mesh;
    if ( !m || m.destroyed ) return;
    const b = this.base ??= { px: 0, py: 0, cx: 0, cy: 0, sx: 1, sy: 1, rot: 0 };
    if ( parts.pos ) { b.px = m.position.x; b.py = m.position.y; b.cx = t.position.x; b.cy = t.position.y; }
    if ( parts.scale ) { b.sx = m.scale.x; b.sy = m.scale.y; }
    if ( parts.rot ) b.rot = m.rotation;
  }

  /** Foundry has just refreshed the token: its mesh and container hold their own values again (the hand-over at the end). */
  refreshed(flags) {
    if ( this.dead || !this.visual ) return;
    const f = flags ?? {}, all = !this.base || !flags || f.refreshTransform || f.refresh || f.redraw;
    this.capture({ pos: all || f.refreshPosition, scale: all || f.refreshMesh || f.refreshSize, rot: all || f.refreshRotation });
    this.step(performance.now());
    this.apply();
  }

  update(dt, now) {
    const t = this.token;
    if ( this.dead ) return;
    if ( t.destroyed || !t.mesh || t.mesh.destroyed || !canvas.tokens?.get(this.doc.id) ) return this.end(false);
    if ( !this.step(now) ) return this.end(true);
    if ( this.visual ) { this.apply(); this.emit(dt, now); this.em.update(dt); }
  }

  /** The offset and the pose at `now`. False when the carry is over. */
  step(now) {
    const el = now - this.t0, tl = this.tl, D = this.D, le = el - this.tOff;
    this.lastEl = le;                                       // (this body's own clock: 0 at its lift-off / contact)
    // the real move: when the path ends, once, by the GM that painted it
    if ( this.real && !this.moved && el >= D + 40 ) this.move();
    if ( !this.visual ) return el < D + 400;
    const b = this.base; if ( !b ) return true;
    C.displacementAt(tl, el, D_);                           // (a pushed token's timeline is on the carrier's clock: it holds before the contact)
    C.poseAt(le, this.Dl, D_, this.S, P_);
    if ( this.hit && P_.k ) { P_.rot = P_.rot * 1.35 + 0.05 * D_.sp * Math.sin(le * 0.04 + this.ph); P_.sx *= 1 + 0.03 * D_.sp * Math.sin(le * 0.05 + this.ph * 2); }   // knocked: leans harder, shivers
    const after = el - D, hold = this.mode === "return" ? C.HOLD_RETURN_MS : C.LAND_MS;
    const arrived = Math.abs(b.px - this.endX) < 3 && Math.abs(b.py - this.endY) < 3;
    if ( this.mode !== "return" && after >= hold ) {
      if ( !this.waitFrom ) this.waitFrom = now;
      if ( arrived && !this.arrivedAt ) this.arrivedAt = now;
    }
    const waited = this.waitFrom ? (this.arrivedAt || now) - this.waitFrom : 0;
    const w = C.weightAt(el, D, this.mode, arrived, waited);
    if ( w.done ) return false;
    // the token is where the front is (the displacement), plus what lies between where it was grabbed and where it really is (blended in
    // over the lift-off, glided out at the end); the displayed position is base + offset
    const ws = C.startWeight(el);
    this.off.x = ((this.C0x - b.px) * ws + D_.x) * w.w;
    this.off.y = ((this.C0y - b.py) * ws + D_.y) * w.w;
    if ( w.w < 1 ) { const s = Math.max(0, 1 - (1 - w.w) * 3); P_.sx = 1 + (P_.sx - 1) * s; P_.sy = 1 + (P_.sy - 1) * s; P_.rot *= s; P_.lift *= s; }
    return true;
  }

  apply() {
    const t = this.token, m = t.mesh, b = this.base, p = P_, o = this.off;
    if ( !b || !m || m.destroyed ) return;
    // the squash is along the screen's axes: a rotated mesh squashes uniformly
    const rotated = Math.abs(b.rot) > 0.001, u = Math.sqrt(p.sx * p.sy), sx = rotated ? u : p.sx, sy = rotated ? u : p.sy;
    const ry = -this.H / 2 * sy, c = Math.cos(p.rot), s = Math.sin(p.rot);
    m.position.set(b.px - ry * s + o.x, b.py + this.H / 2 + ry * c + o.y + p.lift);
    m.scale.set(b.sx * sx, b.sy * sy);
    m.rotation = b.rot + p.rot;
    t.position.set(b.cx + o.x, b.cy + o.y + p.lift);
  }

  /** Puffs at lift-off and landing, dust behind it while it flies (not in performance mode Low, not for a token this client cannot see). */
  emit(dt, now) {
    const el = this.lastEl, em = this.em, t = this.token;
    if ( perfMode() === "low" || !t.visible ) return;
    const ap = em.ap, gx = this.C0x + D_.x, gy = this.C0y + D_.y + this.H * 0.42, W = this.W;
    if ( !this.started && el >= 0 ) { this.started = true; this.puff(gx, gy, this.hit ? 10 : 8, W, ap); }      // (a pushed token: the impact)
    if ( el >= 0 && el < this.Dl && now - this.lastDust > 38 ) {
      this.lastDust = now;
      for ( let i = 0; i < 2; i++ ) em.add(gx + (Math.random() - 0.5) * W * 0.3, gy + (Math.random() - 0.5) * W * 0.08, -D_.ux * ap * (6 + 10 * Math.random()) + (Math.random() - 0.5) * ap * 8, -D_.uy * ap * 6 - ap * (2 + 6 * Math.random()),
        { life: 0.35 + 0.3 * Math.random(), drag: 3, g: -ap * 3, color: DUST[(Math.random() * 4) | 0], size: Math.random() < 0.3 ? 2 : 1 });
    }
    if ( !this.landed && el >= this.Dl ) { this.landed = true; this.puff(gx, gy, 12, W, ap); }
  }

  puff(gx, gy, n, W, ap) {
    for ( let i = 0; i < n; i++ ) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5, sp = ap * (10 + 14 * Math.random());
      this.em.add(gx + Math.cos(a) * W * 0.25, gy + Math.sin(a) * W * 0.08, Math.cos(a) * sp, Math.sin(a) * sp * 0.35 - ap * 5,
        { life: 0.4 + 0.3 * Math.random(), drag: 3, g: -ap * 3, color: DUST[i & 3], size: Math.random() < 0.3 ? 2 : 1 });
    }
  }

  /**
   * The token documents at the path's end (the painting GM only): the carried token and every token it ploughed, in ONE batched update.
   * A pushed token that is gone, that someone moved meanwhile or that a user is dragging right now stays where it is.
   */
  move() {
    this.moved = true;
    const doc = this.doc, scene = doc?.parent;
    if ( !game.user.isGM || !scene?.tokens?.has(doc.id) ) return;
    const ups = [{ _id: doc.id, x: this.tk.x1, y: this.tk.y1, action: "displace" }];
    for ( const h of this.hits ?? [] ) { if ( pushable(scene, h) ) ups.push({ _id: h.id, x: h.x1, y: h.y1, action: "displace" }); else stats.skipped++; }
    stats.moved++;
    Promise.resolve(scene.updateEmbeddedDocuments("Token", ups, { animate: false, diff: false })).catch((err) => { stats.unmoved++; console.warn("moinen-maps | carry: the token did not move", err); });
  }

  /** `commit`: the carry ran its course (or the scene went away): a pending real move is made first. */
  end(commit = true) {
    if ( this.dead ) return;
    this.dead = true;
    if ( commit && this.real && !this.moved ) this.move();
    ACTIVE.delete(this.token);
    Front.release(this.doc.id, this.tag, FRONT_GRACE_MS, this.live);
    if ( this.visual ) {
      releaseToken(this.token);
      this.em?.clear();
      if ( this.root && !this.root.destroyed ) this.root.destroy({ children: true });
      restoreExact(this.token);
    }
    if ( !ACTIVE.size && ticking ) { canvas.app?.ticker?.remove(tick); ticking = false; }
  }
}

/* ================================================================== the API for destruction.mjs */

/**
 * A stroke with a carried token enters (display.enter, every client, every area of the stroke: the first call per stroke and start
 * counts). `geo` { ap, ox, oy } the art grid; `k` the entry clock's factor; `delay` the front's delay (ms); `real`: this client painted
 * the stroke just now (or redid it): the token document really moves at the end.
 */
export function play({ objId, tk, start, k = 1, delay = 40, geo, real = false, live = null }) {
  if ( !C.validTk(tk) || !canvas?.ready ) return false;
  const seen = SEEN.get(objId);
  if ( seen !== undefined && Math.abs(seen - start) < 1500 ) return false;
  SEEN.set(objId, start);
  if ( SEEN.size > 200 ) SEEN.delete(SEEN.keys().next().value);
  const token = canvas.tokens?.get(tk.id);
  const tl = C.buildTimeline(tk, { ...geo, k });
  if ( !token || !tl ) { stats.skipped++; return false; }
  ACTIVE.get(token)?.end(true);                                        // two strokes on one token: the first lands where it was going
  const visual = canShow(token);
  stats.played++; if ( visual ) stats.visual++;
  const lead = new Carry(token, { objId, tk, tl, t0: start + delay, real: !!real && game.user.isGM, visual, live });
  // SUPERHERO: the tokens it ploughs ride ahead of it (each is a Carry of its own; the lead moves all the documents)
  const hits = X.hitsOf(tk);
  if ( hits.length ) {
    lead.hits = hits;
    for ( const h of hits ) {
      const pt = canvas.tokens?.get(h.id), htl = X.buildHitTimeline(h, { k });
      if ( !pt || !htl || pt === token || !canShow(pt) || dragged(pt) ) continue;
      ACTIVE.get(pt)?.end(true);
      lead.pushed.push(new Carry(pt, { objId, tk, tl: htl, t0: start + delay, real: false, visual: true, hit: h, D: tl.D, live }));
      stats.pushed++;
    }
  }
  return true;
}

/** May this client pose the token's mesh (the effects are on, no other effect holds it)? */
const canShow = (token) => tokenFxOn() && !reducedMotion() && !tokenBusy(token) && !!token.mesh && !token.mesh.destroyed;

/** The stroke is gone (undo, clear): its carries stop where they are (no real move). */
export function cancel(objId) {
  for ( const c of [...ACTIVE.values()] ) if ( c.objId === objId ) c.end(false);
  SEEN.delete(objId);
}
/** Has a carry of this stroke been started on this client? */
export const started = (objId) => SEEN.has(objId);
export function cancelAll() { for ( const c of [...ACTIVE.values()] ) c.end(false); SEEN.clear(); }

/**
 * Undo of a stroke (GM): the carry stops and every token that is still where the stroke took it (the carried one and the ploughed ones)
 * goes back to its start, in one batched update. A token the GM moved meanwhile, or that is gone, stays.
 */
export function undo(tk, objId) {
  cancel(objId);
  if ( !game.user.isGM || !C.validTk(tk) || tk.e ) return false;
  const scene = canvas.scene; if ( !scene ) return false;
  const ups = [], at = (d, x, y) => Math.abs(d.x - x) <= 2 && Math.abs(d.y - y) <= 2;
  const doc = scene.tokens.get(tk.id);
  if ( doc && at(doc, tk.x1, tk.y1) ) ups.push({ _id: doc.id, x: tk.x0, y: tk.y0, action: "displace" });
  for ( const h of X.hitsOf(tk) ) { const d = scene.tokens.get(h.id); if ( d && !d.locked && at(d, h.x1, h.y1) && !dragged(d.object) ) ups.push({ _id: d.id, x: h.x0, y: h.y0, action: "displace" }); }
  if ( !ups.length ) return false;
  scene.updateEmbeddedDocuments("Token", ups, { animate: false, diff: false }).catch((err) => console.warn("moinen-maps | carry: undo", err));
  return true;
}

/* ================================================================== the plough's input (the painting GM, once, when the stroke is committed) */

/** Is the token a disc for the plough (gridless ellipse, hex) or a square (the grid cell, a rectangle)? */
function isRound(doc) {
  const g = doc.parent?.grid ?? canvas.grid;
  if ( g?.isGridless ) return doc.shape === CONST.TOKEN_SHAPES?.ELLIPSE_1 || doc.shape === CONST.TOKEN_SHAPES?.ELLIPSE_2;
  return !!g?.isHexagonal;
}
const rowOf = (doc) => { const { width, height } = doc.getSize(); return { id: doc.id, x: doc.x, y: doc.y, w: width, h: height, round: isRound(doc) }; };

/**
 * `tk.hit` for a carry record: the tokens of the scene as they are now, minus the locked ones and the ones hidden from the players (a
 * hidden token that flew would give itself away), against the carried token's path. `snap` { grid, fn } | null, `rect` the scene rect.
 * Returns the array (empty when nothing is in the way).
 */
export function ploughOf(tk, { geo, snap = null, rect = null }) {
  const doc = canvas.scene?.tokens?.get(tk.id); if ( !doc || !canvas.tokens?.placeables ) return [];
  const others = [];
  for ( const t of canvas.tokens.placeables ) {
    const d = t.document; if ( !d || t.destroyed || d.id === tk.id || d.locked || d.hidden ) continue;
    others.push(rowOf(d));
  }
  return X.ploughRecord({ tk, geo, carrier: rowOf(doc), others, rect, snap: snap ? { grid: snap.grid ?? canvas.grid.size, fn: snap.fn, gx: 0, gy: 0 } : null });
}

/** Foundry refreshed a token. */
export function onRefreshToken(token, flags) { Front.onRefresh(token); ACTIVE.get(token)?.refreshed(flags); }

export function registerCarry() {
  Hooks.on("refreshToken", onRefreshToken);
  Hooks.on("canvasTearDown", () => { for ( const c of [...ACTIVE.values()] ) c.end(true); SEEN.clear(); Front.clear(); });
  Hooks.on("deleteToken", (doc) => { for ( const [t, c] of [...ACTIVE] ) if ( t.document === doc ) c.end(false); });
}

export const _carryStats = () => ({ ...stats, active: ACTIVE.size, ticking });
export const _carryState = () => [...ACTIVE.values()].map((c) => ({ id: c.doc.id, objId: c.objId, el: Math.round(c.lastEl), off: { ...c.off }, moved: c.moved, real: c.real, visual: c.visual, mode: c.mode, D: Math.round(c.D), hit: !!c.hit, pushed: c.pushed.length }));
