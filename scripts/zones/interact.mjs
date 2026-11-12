import { MODULE_ID } from "../config.mjs";
import * as Zones from "./zones.mjs";
import * as HL from "./highlight.mjs";
import { ZoneHighlightLayer } from "./highlight-layer.mjs";
import { pairKey } from "./marks.mjs";
import * as View from "./view.mjs";
import * as Room from "./room.mjs";
import { piecesHtml } from "./signs-core.mjs";

/**
 * Highlights and zone picking, wired (dev/zones-api.md 17-18): the public calls a combat module makes, the module socket that
 * carries a highlight or a pick request to the users it is meant for, and the pointer while a zone is being picked.
 *
 *  - api.highlight(spec) shows a set of zones and borders with colours and labels: on the calling client, and (a GM's call) on the
 *    clients of the users it names. A highlight goes over the socket ONLY to those users (the server honours `recipients`), so a
 *    player's browser never receives what is not meant for it. It belongs to the scene it was made on and is gone when that scene
 *    closes; a client that opens the scene later asks for what is meant for it.
 *  - api.pick(opts) lets this client's user - or, asked by a GM, another user - click one of the allowed zones; the call resolves
 *    with the chosen place, or with why none was chosen.
 *
 *  - The free part of the screen: other interface parts say which edges of the window their bars cover (api.uiInset), the rest
 *    is found by looking (what lies over the map's canvas). The pick's banner keeps clear of what is at the top, zones on offer
 *    that no click can reach (under a bar, off the screen) are counted at the edge they lie beyond and brought in on request
 *    (api.reveal).
 *
 * Highlights and picks are not stored anywhere: they are a show, not a state. Nothing here reads a rule.
 */

const CHANNEL = `module.${MODULE_ID}`;
const STORE = new HL.HighlightStore();
/** What this client sent to others: id -> { h (the cleaned highlight), remote ("all" | [userId]) }. */
const SENT = new Map();
let layer = null, autoId = 0, PICK = null, pickSeq = 0, askSeq = 0;
/** Picks asked of other users: request id -> { user, resolve, timer }. */
const ASKED = new Map();

const L = (k, d) => (d ? game.i18n.format(`MOINENMAPS.Zones.${k}`, d) : game.i18n.localize(`MOINENMAPS.Zones.${k}`));
const me = () => game.user?.id ?? null;
const sceneId = () => canvas.scene?.id ?? null;
const gmIds = () => (game.users?.filter?.((u) => u.isGM) ?? []).map((u) => u.id);
const emit = (msg, recipients = null) => { try { game.socket?.emit(CHANNEL, { t: "zones", scene: sceneId(), b: HL.BOOT, ...msg }, ...(recipients ? [{ recipients }] : [])); } catch ( err ) { console.warn(`${MODULE_ID} | zones: socket`, err); } };
const wire = (h) => ({ id: h.id, zones: h.zones, borders: h.borders, order: h.order });

/* ---------------------------------------------------------------- drawing */

const idOf = (key) => Zones.zonesApi.idOf(key);
function pairOfIds(a, b) { return Zones.zones()?.adj.get(a)?.has(b) ? pairKey(a, b) : null; }

/** What shows now: the highlights, with the zones a running pick offers laid over them where they carry no highlight of their own. */
function shown() {
  const out = STORE.compose(idOf, pairOfIds);
  if ( PICK ) for ( const [id, e] of PICK.allowed ) {
    const has = out.zones.get(id);
    // (an area shown under the pointer - board.mjs pickArea - stays on top of what is on offer)
    if ( has?.of?.startsWith("~area") ) continue;
    if ( !has || e.label ) {
      // (section 40: the signs go with the words they stand for - the label's with the label, the tip's with the tip)
      const signs = { ...(e.label ? e.signs?.label ? { label: e.signs.label } : {} : has?.signs?.label ? { label: has.signs.label } : {}), ...(e.tip ? e.signs?.tip ? { tip: e.signs.tip } : {} : has?.signs?.tip ? { tip: has.signs.tip } : {}) };
      out.zones.set(id, { zone: e.zone, id, color: e.color, style: "fill", label: e.label ?? has?.label ?? null, tip: e.tip ?? has?.tip ?? null, ...(Object.keys(signs).length ? { signs } : {}), of: "~pick" });
    }
  }
  return out;
}

/** Draw again (cheap when nothing changed: the layer keeps what it drew under one key). */
export function redraw() {
  const Z = Zones.zones();
  if ( !canvas?.ready && !layer ) return;
  if ( !layer ) {
    if ( !Z || (!STORE.size && !PICK) ) return;
    layer = new ZoneHighlightLayer();
  }
  const look = Zones.look();
  const marks = new Map();
  for ( const [pk, m] of Zones.marks()?.borders ?? [] ) if ( Number.isFinite(m.x) ) marks.set(pk, { x: m.x, y: m.y });
  layer.render(Z, Z ? shown() : { zones: new Map(), borders: new Map() }, {
    zoom: canvas.stage?.scale.x ?? 1, key: `${STORE.version}|${Zones.zonesApi.version()}|${PICK?.seq ?? 0}`,
    pick: PICK?.allowed ?? null, marks,
    // (a label keeps clear of the badges, icons and passage marks the zones show to this user, and of the tokens this user sees)
    // (section 41: and of the pills the board puts at tokens and on lines - a token's hit chance never lies under a zone's warning)
    blocks: () => ({ boxes: [...(look && Zones.visibleToMe() ? Zones.displayBoxes() : []), ...boardLabelBlocks(), ...uiBlocks()], tokens: tokenBoxes() }),
    zoneAt: (x, y) => Zones.zonesApi.zoneAt(x, y), grid: Zones.gridSize()
  });
}

/** The board's pills as boxes the highlights' labels keep clear of (as hard as a token: a label under a label cannot be read). */
function boardLabelBlocks() {
  try { return (boardLabels() ?? []).map((b) => ({ zone: null, kind: "label", x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 })); } catch { return []; }
}
/**
 * The panels other modules declared (uiAvoid boxes, uiInset bars) as boxes in scene pixels, kind "ui": a warning on a zone keeps
 * out from under them where it can (section 41). Nothing declared: nothing (a table without such modules looks as before).
 */
function uiBlocks() {
  if ( (!AVOIDS.size && !INSETS.size) || typeof canvas?.canvasCoordinatesFromClient !== "function" ) return [];
  const out = [], toScene = (b) => {
    const a = canvas.canvasCoordinatesFromClient({ x: b.x0, y: b.y0 }), c = canvas.canvasCoordinatesFromClient({ x: b.x1, y: b.y1 });
    if ( [a.x, a.y, c.x, c.y].every(Number.isFinite) ) out.push({ zone: null, kind: "ui", x0: a.x, y0: a.y, x1: c.x, y1: c.y });
  };
  try {
    for ( const b of uiAvoids() ) toScene(b);
    const i = uiInsets(), W = vw(), H = vh();
    if ( i && Number.isFinite(W) && Number.isFinite(H) ) {
      if ( i.top > 0 ) toScene({ x0: 0, y0: 0, x1: W, y1: i.top });
      if ( i.bottom > 0 ) toScene({ x0: 0, y0: H - i.bottom, x1: W, y1: H });
      if ( i.left > 0 ) toScene({ x0: 0, y0: 0, x1: i.left, y1: H });
      if ( i.right > 0 ) toScene({ x0: W - i.right, y0: 0, x1: W, y1: H });
    }
  } catch {}
  return out;
}
/** U125 (a): the same panels for the board's token labels (scene px; nothing declared: none) */
export const uiBlocksScene = () => uiBlocks().map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 }));
/** The tokens this user sees, as boxes in scene pixels, where they stand (their documents: not where an animation has them now). */
function tokenBoxes() {
  const g = Zones.gridSize(), out = [];
  for ( const t of canvas.tokens?.placeables ?? [] ) {
    const d = t.document;
    if ( !d || !(t.visible || t.controlled) ) continue;
    out.push({ x0: d.x, y0: d.y, x1: d.x + (d.width ?? 1) * g, y1: d.y + (d.height ?? 1) * g });
  }
  return out;
}
/**
 * A token came, went or moved: the labels take their spots again - once the change is known and once more when the move's animation
 * and the sight that follows it are over. Nothing while no label shows.
 */
let placeTimers = [];
function onTokens(doc, change = null) {
  if ( !layer?.items.length || doc?.parent !== canvas.scene ) return;
  if ( change && !["x", "y", "width", "height", "hidden"].some((k) => k in change) ) return;
  for ( const t of placeTimers ) clearTimeout(t);
  placeTimers = [60, 900].map((ms) => setTimeout(() => layer?.place(), ms));
}

/* ---------------------------------------------------------------- the free part of the screen */

/** What other interface parts declared: id -> spec ({ top, right, bottom, left }, each px | Element | selector | () => px; or a function giving that). */
const INSETS = new Map();
const vw = () => Number(globalThis.innerWidth), vh = () => Number(globalThis.innerHeight);
const hasDom = () => Number.isFinite(vw()) && Number.isFinite(vh()) && typeof globalThis.document?.elementFromPoint === "function" && typeof canvas?.clientCoordinatesFromCanvas === "function";
/** How far an element reaches in from a side of the window (0: not there, not shown). */
function reachOf(side, el) {
  if ( typeof el === "string" ) { try { el = document.querySelector(el); } catch { el = null; } }
  if ( typeof el?.getBoundingClientRect !== "function" ) return 0;
  const r = el.getBoundingClientRect();
  if ( !(r.width > 0 && r.height > 0) ) return 0;
  try { const cs = getComputedStyle(el); if ( cs.visibility === "hidden" || cs.display === "none" ) return 0; } catch {}
  return side === "top" ? r.bottom : side === "bottom" ? vh() - r.top : side === "left" ? r.right : vw() - r.left;
}
function resolveInset(spec) {
  let o = spec;
  if ( typeof o === "function" ) { try { o = o(); } catch { o = null; } }
  if ( !o || typeof o !== "object" ) return null;
  const out = {};
  for ( const s of View.SIDES ) {
    let v = o[s];
    if ( typeof v === "function" ) { try { v = v(); } catch { v = 0; } }
    out[s] = typeof v === "number" ? v : v ? reachOf(s, v) : 0;
  }
  return View.cleanInsets(out);
}
/**
 * Say which edges of the window an interface part covers, so the map's own interface keeps clear of it (the pick's banner, the
 * zones a pick has to bring into view):
 *   uiInset("my-module.dock", { bottom: 180 })                 px in from that side
 *   uiInset("my-module.dock", { bottom: "#my-dock" })          an element (or a selector): measured whenever it is asked, 0 while it is not shown
 *   uiInset("my-module.dock", () => ({ bottom: n }))           worked out whenever it is asked
 *   uiInset("my-module.dock", null)                            taken back
 * Per client, until reload. Returns the function that takes it back.
 */
export function uiInset(id, spec = null) {
  id = String(id ?? "");
  if ( !id ) return () => {};
  // (a running pick lays itself out again: its banner and its chips keep clear of what was just declared)
  const again = () => { const p = PICK; if ( p ) setTimeout(() => layoutPick(p), 0); };
  if ( spec == null || spec === false ) INSETS.delete(id); else INSETS.set(id, spec);
  again();
  return () => { if ( INSETS.get(id) === spec ) { INSETS.delete(id); again(); } };
}
/** The declared insets now, as one: { top, right, bottom, left } in px (`extra`: one more, counted with them). */
export const uiInsets = (extra = null) => View.sumInsets([...[...INSETS.values()].map(resolveInset), View.cleanInsets(extra)]);

/* ---------------------------------------------------------------- boxes the map's floating things keep clear of (section 41) */

/** What other interface parts asked the map to keep clear of: id -> what (an element, a selector, a box, a function, a list of them). */
const AVOIDS = new Map();
/** One "what" as client boxes (an element or a selector: where it is now, nothing while it is absent or not shown). */
function boxesOf(what, depth = 0) {
  if ( what == null || what === false || depth > 3 ) return [];
  if ( typeof what === "function" ) { let v; try { v = what(); } catch { v = null; } return boxesOf(v, depth + 1); }
  if ( Array.isArray(what) ) return what.flatMap((w) => boxesOf(w, depth + 1));
  if ( typeof what === "string" ) {
    let els = [];
    try { els = [...(document.querySelectorAll?.(what) ?? [])]; } catch { els = []; }
    return els.flatMap((e) => boxesOf(e, depth + 1));
  }
  if ( typeof what.getBoundingClientRect === "function" ) {
    if ( what.isConnected === false ) return [];
    try { const cs = getComputedStyle(what); if ( cs.visibility === "hidden" || cs.display === "none" ) return []; } catch {}
    const r = what.getBoundingClientRect();
    const b = Room.cleanBox({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
    return b ? [b] : [];
  }
  const b = Room.cleanBox(what);
  return b ? [b] : [];
}
/**
 * Ask the map's floating things - a menu at a thing (api.menu, the menus of api.onContext), the director's "My view" chip - to keep
 * clear of a part of the screen that is not a bar along an edge (a panel at the side, a banner at the bottom centre, a desk):
 *   uiAvoid("my-module.desk", "#my-desk")                 an element or a selector (every match): measured whenever it is asked
 *   uiAvoid("my-module.note", { x, y, width, height })     a box in client px (also { x0, y0, x1, y1 })
 *   uiAvoid("my-module.all", () => [el, box, ...])         worked out whenever it is asked
 *   uiAvoid("my-module.desk", null)                        taken back
 * Per client, until reload. Returns the function that takes it back. A box that leaves no room is given up as little as it can be:
 * the thing stands where it covers the least of the boxes.
 */
export function uiAvoid(id, what = null) {
  id = String(id ?? "");
  if ( !id ) return () => {};
  if ( what == null || what === false ) AVOIDS.delete(id); else AVOIDS.set(id, what);
  return () => { if ( AVOIDS.get(id) === what ) AVOIDS.delete(id); };
}
/** The boxes asked for, as they are now: [{ id, x0, y0, x1, y1 }] in client px (`extra`: more of them, for this call). */
export function uiAvoids(extra = null) {
  const out = [];
  for ( const [id, what] of AVOIDS ) for ( const b of boxesOf(what) ) out.push({ id, ...b });
  for ( const b of boxesOf(extra) ) out.push({ id: null, ...b });
  return out;
}

/* ---------------------------------------------------------------- the labels of the map, as one layout (section 41) */

/** Where the board's labels stand (board.mjs: token marks' pills, lines' pills): () => [{ x0, y0, x1, y1 }] in scene px. */
let boardLabels = () => [];
export function setBoardLabels(fn) { boardLabels = typeof fn === "function" ? fn : () => []; }
/** The board's labels moved: the highlights' labels take their spots again (soon, once). */
// (after the last change of a burst: while a marked token walks its label moves on every frame; the highlights follow when it stops)
let labelsTimer = 0;
export function boardLabelsMoved() {
  if ( !layer?.items.length ) return;
  clearTimeout(labelsTimer);
  labelsTimer = setTimeout(() => { labelsTimer = 0; try { layer?.place(); } catch {} }, 120);
}
/** The labels of the highlights as they stand now, in scene px: [{ x0, y0, x1, y1 }]. */
export function highlightLabelBoxes() {
  if ( !layer?.root?.visible || !layer.items.length ) return [];
  return layer.items.map((it) => {
    const s = it.c.scale?.x ?? 1, w = (it.w / 2) * s, h = 11 * s, x = it.c.position.x, y = it.c.position.y;
    return { x0: x - w, y0: y - h, x1: x + w, y1: y + h };
  });
}

const CELL = 40;
const ours = (e) => !!e?.closest?.(".mm-z-pickway");
/** The largest stretch of the window with nothing over the map's canvas, found by looking: { x, y, w, h } (to 40 px). null: cannot look. */
function measureFree() {
  const g = freeGrid();
  if ( !g ) return null;
  for ( let i = 0; i < g.free.length; i++ ) g.free[i] = freeCell(g, i);
  return freeRect(g);
}
/** The cells looked at: one per CELL px of the window (null: cannot look). */
function freeGrid() {
  if ( !hasDom() || !canvas?.app?.view ) return null;
  const W = vw(), H = vh(), cols = Math.floor(W / CELL), rows = Math.floor(H / CELL);
  if ( cols < 2 || rows < 2 ) return null;
  return { view: canvas.app.view, W, H, cols, rows, free: new Uint8Array(cols * rows) };
}
/** Whether the map is what a click at the centre of cell `i` reaches (1) or something lies over it (0). */
function freeCell(g, i) {
  const e = document.elementFromPoint(((i % g.cols) + 0.5) * CELL, (Math.floor(i / g.cols) + 0.5) * CELL);
  return e === g.view || ours(e) ? 1 : 0;
}
function freeRect(g) {
  const { W, H, cols, rows } = g, R = View.largestRect(g.free, cols, rows);
  if ( !R ) return null;
  const x = R.c0 * CELL, y = R.r0 * CELL;
  return { x, y, w: (R.c1 === cols - 1 ? W : (R.c1 + 1) * CELL) - x, h: (R.r1 === rows - 1 ? H : (R.r1 + 1) * CELL) - y };
}
/**
 * perf3: the same look as measureFree, spread over frames - at most FREE_SLICE_MS of hit tests per frame. A hit test costs about
 * 0.5 ms on a page with a long chat log (every positioned element of every card is walked), so the ~880 cells of a 1600x900
 * window at once held the page for 400-700 ms; this one is for the look now and then while a pick runs, where nothing waits on
 * the answer. done(rect | null) as measureFree would answer for a window that did not change meanwhile; done(undefined): the window
 * changed size while looking (that lays the pick out anyway). Returns a function that stops it (done is then never called).
 */
const FREE_SLICE_MS = 4;
function measureFreeSoon(done) {
  const g = freeGrid();
  if ( !g ) { queueMicrotask(() => done(null)); return () => {}; }
  let i = 0, stop = false, h = null;
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const later = (fn) => (globalThis.document?.visibilityState === "hidden" || typeof requestAnimationFrame !== "function" ? { t: setTimeout(fn, 0) } : { r: requestAnimationFrame(fn) });
  const step = () => {
    h = null;
    if ( stop ) return;
    if ( vw() !== g.W || vh() !== g.H ) { stop = true; done(undefined); return; }
    const t0 = now();
    while ( i < g.free.length ) { g.free[i] = freeCell(g, i); i++; if ( now() - t0 >= FREE_SLICE_MS ) break; }
    if ( i < g.free.length ) { h = later(step); return; }
    stop = true;
    done(freeRect(g));
  };
  h = later(step);
  return () => { stop = true; if ( h?.t ) clearTimeout(h.t); if ( h?.r && typeof cancelAnimationFrame === "function" ) cancelAnimationFrame(h.r); h = null; };
}
const sameFree = (f, o) => !(!f !== !o || (f && (f.x !== o.x || f.y !== o.y || f.w !== o.w || f.h !== o.h)));
/** The free stretch: the declared insets, narrowed by what was found by looking. */
const safeNow = (extra = null, free = null) => View.safeRect(vw(), vh(), uiInsets(extra), free);
/**
 * The part of the window the map can be seen and clicked in: { x, y, width, height } in client px - the window less the declared
 * insets (uiInset; `inset`: one more for this call), narrowed to the largest stretch nothing lies over (`measure: false`: the
 * declared insets only). null: no window to measure.
 */
export function safeArea({ inset = null, measure = true } = {}) {
  if ( !Number.isFinite(vw()) || !Number.isFinite(vh()) ) return null;
  const r = safeNow(inset, measure ? measureFree() : null);
  return { x: r.x, y: r.y, width: r.w, height: r.h };
}

const toClient = (pt) => canvas.clientCoordinatesFromCanvas(pt);
/** A zone's box in scene px (kept with the zone). */
const BOXES = new WeakMap();
function boxOf(z) {
  let b = BOXES.get(z);
  if ( b ) return b;
  b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for ( const part of z.parts ) for ( let i = 0, r = part[0]; i < r.length; i += 2 ) { b.x0 = Math.min(b.x0, r[i]); b.x1 = Math.max(b.x1, r[i]); b.y0 = Math.min(b.y0, r[i + 1]); b.y1 = Math.max(b.y1, r[i + 1]); }
  BOXES.set(z, b);
  return b;
}
/** Whether a click can reach a zone as the screen is now: some point of it is in the window with nothing over the map there. */
function reachable(z) {
  const view = canvas.app.view, W = vw(), H = vh();
  const hit = (c) => c.x >= 0 && c.y >= 0 && c.x < W && c.y < H && document.elementFromPoint(c.x, c.y) === view;
  if ( hit(toClient(z.label)) ) return true;
  const b = boxOf(z), p = toClient({ x: b.x0, y: b.y0 }), q = toClient({ x: b.x1, y: b.y1 });
  const x0 = Math.max(0, p.x), y0 = Math.max(0, p.y), x1 = Math.min(W, q.x), y1 = Math.min(H, q.y);
  if ( !(x1 - x0 > 4 && y1 - y0 > 4) ) return false;
  const N = 6;
  for ( let j = 0; j < N; j++ ) for ( let i = 0; i < N; i++ ) {
    const c = { x: x0 + ((i + 0.5) * (x1 - x0)) / N, y: y0 + ((j + 0.5) * (y1 - y0)) / N };
    const s = canvas.canvasCoordinatesFromClient(c);
    if ( Zones.zonesApi.zoneAt(s.x, s.y) === z.id && hit(c) ) return true;
  }
  return false;
}

/** Move the view so that what is on the screen shifts by (dx, dy) client px, scaled by k around the client point `about`. */
async function shiftView(dx, dy, k = 1, about = null, animate = true) {
  const st = canvas.stage, s = st.scale.x, vc = { x: st.position?.x ?? vw() / 2, y: st.position?.y ?? vh() / 2 };
  const c = about ?? vc, s2 = s * k;
  // the scene point under `about` stays under it (scaling), then everything shifts
  const wx = st.pivot.x + (c.x - vc.x) / s, wy = st.pivot.y + (c.y - vc.y) / s;
  const to = { x: wx - (c.x + dx - vc.x) / s2, y: wy - (c.y + dy - vc.y) / s2, scale: s2 };
  if ( animate && typeof canvas.animatePan === "function" && (await Zones.drawsFrames()) ) { try { await canvas.animatePan({ ...to, duration: 320 }); return; } catch {} }
  canvas.pan(to);
}

/**
 * Bring zones into the free part of the screen (the declared insets and what lies over the map counted): the view slides - and
 * with `fit`, zooms out when they do not fit as it is - by the least that puts their label points there. One place or a list
 * (anything that names a place). opts: { inset (one more inset for this call), margin (px kept to the edge of the free stretch;
 * default a fifth of it, 140 at most), fit = false, animate = true }. Several zones that do not fit without `fit`: the first is
 * brought in. Resolves with { ok: true, moved } or { ok: false, reason: "noZones" | "noScene" }.
 */
export async function reveal(where, { inset = null, margin = null, fit = false, animate = true } = {}) {
  const Z = Zones.zones();
  if ( !Z || !canvas?.ready || !hasDom() ) return { ok: false, reason: "noScene" };
  const pts = [];
  for ( const w of Array.isArray(where) ? where : [where] ) {
    const p = Zones.placeOf(w && typeof w === "object" && typeof w.spot === "string" && !("level" in w) ? w.spot : w), z = p && p.id >= 0 ? Z.zones[p.id] : null;
    if ( z ) pts.push(toClient(z.label));
  }
  if ( !pts.length ) return { ok: false, reason: "noZones" };
  const safe = safeNow(inset, PICK?.way?.free ?? measureFree());
  const m = Number.isFinite(margin) && margin >= 0 ? margin : Math.min(140, Math.min(safe.w, safe.h) / 5);
  let box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for ( const p of pts ) box = { x0: Math.min(box.x0, p.x), y0: Math.min(box.y0, p.y), x1: Math.max(box.x1, p.x), y1: Math.max(box.y1, p.y) };
  let f = View.fitBox(box, safe, m);
  if ( f.k < 1 && !fit ) f = { ...View.nudge(pts[0], safe, m), k: 1 };
  const moved = Math.abs(f.dx) > 0.5 || Math.abs(f.dy) > 0.5 || f.k < 1;
  if ( moved ) await shiftView(f.dx, f.dy, f.k, { x: safe.x + safe.w / 2, y: safe.y + safe.h / 2 }, animate);
  return { ok: true, moved };
}

/* ---------------------------------------------------------------- highlights */

/**
 * Show a set of zones and borders (highlight.mjs has the shape):
 *   highlight({ id?, zones: [key | spot | { zone, color, style, label, tip }], borders: [key | [a, b] | { border, color, style, label, tip }],
 *               color, style, borderColor, borderStyle, users, order })
 * `users`: absent - this client only; "all"; "gm"; a user id or a list of them (a GM's call; a player's highlight stays on the
 * player's own client). The same `id` again replaces what it showed, for everyone it was shown to. Returns the id, or null when
 * the spec names nothing.
 */
export function highlight(spec) {
  const h = HL.cleanHighlight(spec, me());
  // (the same id with nothing left to show replaces the set too: what stood under it goes, here and where it was sent)
  if ( !h ) { const id = HL.idOf(spec); if ( id != null ) clearHighlights(id); return null; }
  if ( h.users && !game.user?.isGM ) h.users = null;
  h.id ??= `${me() ?? "x"}.${++autoId}`;
  const aud = HL.audience(h.users, me(), gmIds());
  // the users it was shown to before and is not meant for now lose it
  const old = SENT.get(h.id);
  if ( old ) {
    const still = aud.remote === "all" ? null : new Set(aud.remote ?? []);
    const gone = old.remote === "all" ? (aud.remote === "all" ? [] : "all") : old.remote.filter((u) => still && !still.has(u));
    if ( gone === "all" ) emit({ op: "hl", del: [h.id] });
    else if ( gone.length ) emit({ op: "hl", del: [h.id] }, gone);
  }
  if ( aud.remote ) { SENT.set(h.id, { h, remote: aud.remote }); emit({ op: "hl", set: [wire(h)] }, aud.remote === "all" ? null : aud.remote); }
  else SENT.delete(h.id);
  if ( aud.local ) STORE.set(h, null); else STORE.remove({ id: h.id });
  redraw();
  return h.id;
}

/**
 * Take highlights away: clearHighlights(id), clearHighlights({ id }), clearHighlights({ prefix }) (every id that starts with it),
 * clearHighlights() (everything this client made), clearHighlights({ all: true }) (also what others showed here - on this client
 * only). What this client sent to other users goes from their screens too. Returns how many went from this client's screen.
 * Anything else (null, a number, { id: null }) names no set: nothing goes, 0.
 */
export function clearHighlights(o = {}) {
  const f = HL.clearFilter(o);
  if ( !f ) return 0;                                                   // what names no set (null, an id of nothing) takes nothing away
  const match = (id) => (f.id == null || id === f.id) && (f.prefix == null || id.startsWith(f.prefix));
  for ( const [id, s] of [...SENT] ) {
    if ( !match(id) ) continue;
    emit({ op: "hl", del: [id] }, s.remote === "all" ? null : s.remote);
    SENT.delete(id);
  }
  const gone = STORE.remove({ id: f.id ?? null, prefix: f.prefix ?? null, ...(f.all || f.id != null || f.prefix != null ? {} : { from: null }) });
  if ( gone.length ) redraw();
  return gone.length;
}

/** The highlights on this client's screen: [{ id, zones, borders, order, from (null: made here, else the user id of the GM who sent it) }]. */
export const highlights = () => STORE.list().map((h) => ({ id: h.id, zones: h.zones.map((e) => ({ ...e })), borders: h.borders.map((e) => ({ ...e })), order: h.order, from: h.from }));

/**
 * The zones a mover can reach, highlighted with their distance (api.reach counted for the profile): within one movement action
 * in the "move" colour, only with the stress option in the "stress" colour, its own zone outlined; farther zones are left out
 * unless `beyond: true` (grey, dashed). opts: { id = "reach", users, max, beyond, labels = true, order }. Returns the id (null:
 * nowhere to go).
 */
export function showReach(where, profile = {}, { id = "reach", users = null, max = Infinity, beyond = false, labels = true, order = 0 } = {}) {
  const rows = Zones.reach(where, profile, { max });
  const zones = [];
  for ( const r of rows ) {
    const w = r.cost?.within ?? (r.d === 0 ? "free" : "plain");
    if ( w === "no" && !beyond ) continue;
    zones.push({ zone: r.zone, color: w === "free" ? "here" : w === "plain" ? "move" : w === "stress" ? "stress" : "blocked", style: w === "free" ? "outline" : w === "no" ? "dashed" : "fill", label: labels && r.d > 0 ? String(r.d) : null });
  }
  return zones.length ? highlight({ id, zones, users, order }) : null;
}

/* ---------------------------------------------------------------- picking a zone */

/** Put a tip beside the pointer (client px), on the other side of it where it would leave the window. */
export function placeTip(el, at) {
  const r = el.getBoundingClientRect?.() ?? null, w = r?.width || 0, h = r?.height || 0, vw = Number(globalThis.innerWidth) || 1e9, vh = Number(globalThis.innerHeight) || 1e9;
  let x = at.x + 16, y = at.y + 18;
  if ( x + w > vw - 6 ) x = at.x - 12 - w;
  if ( y + h > vh - 6 ) y = at.y - 12 - h;
  el.style.left = `${Math.max(6, x)}px`; el.style.top = `${Math.max(6, y)}px`;
}

/**
 * Let a user pick a zone by clicking it. Resolves - never rejects - with
 *   { ok: true, zone (key), id, spot, place, x, y }                       the place picked and the scene point of the click
 *   { ok: false, reason: "cancelled" | "replaced" | "noZones" | "sceneChanged" | "timeout" | "userGone" | "notGM" | "noScene" }
 * opts: { zones: [key | spot | { zone | spot, label, tip, color }] (absent: any zone), title, hint, color, timeout (ms),
 *         user (a user or user id: ask that user - a GM's call; absent: this client's user),
 *         inset ({ top, right, bottom, left } px: covered edges of the window, on top of what uiInset declared),
 *         reveal (true: zones on offer no click can reach are counted at the edge they lie beyond and brought in on a click there,
 *                 and when none is in reach at the start the nearest comes into view; "fit": at the start the view moves so that all
 *                 of them are in reach; false: the view is left alone), edgePan (false: resting the pointer at such an edge does not slide the map) }
 * A spot string in `zones` ("z3:elevated", "z3:f2") is the place the answer carries; a bare key answers with the zone's ground
 * level. The zones on offer are shown in their colour with their label (a highlight already on a zone stays, unless the entry
 * brings a label of its own); the others are dimmed. A click on a zone on offer picks it; Escape, a right-click or the Cancel
 * button gives it up; a new pick replaces a running one. Right-drag still pans, the wheel still zooms.
 */
export function pick(opts = {}) {
  const user = opts?.user?.id ?? opts?.user ?? null;
  if ( user && user !== me() ) return askUser(user, opts);
  const P = HL.cleanPick(opts);
  if ( !P ) return Promise.resolve({ ok: false, reason: "noZones" });
  // (board.mjs: what a move or an area pick adds under the pointer - this client's own picks only)
  if ( opts?._ext && typeof opts._ext === "object" ) P.ext = opts._ext;
  return pickHere(P);
}
export const picking = () => !!PICK;
/** Give up the pick running on this client (`user`: the pick a GM asked of that user). True when there was one. */
export function cancelPick({ user = null } = {}) {
  const u = user?.id ?? user;
  if ( u && u !== me() ) {
    let any = false;
    for ( const [rid, a] of ASKED ) if ( a.user === u ) { any = true; emit({ op: "pickCancel", rid }, [u]); }
    return any;
  }
  if ( !PICK ) return false;
  endPick({ ok: false, reason: "cancelled" });
  return true;
}

/** The zones a pick offers, by their id now: id -> entry. */
function allowedOf(P) {
  const allowed = new Map();
  if ( P.zones ) for ( const e of P.zones ) { const id = idOf(e.zone); if ( id >= 0 ) allowed.set(id, e); }
  else for ( const z of Zones.zones()?.zones ?? [] ) { const key = Zones.zonesApi.keyOf(z.id); allowed.set(z.id, { zone: key, spot: key, label: null, tip: null, color: P.color }); }
  return allowed;
}

function pickHere(P) {
  if ( PICK ) endPick({ ok: false, reason: "replaced" });
  const Z = Zones.zones();
  if ( !Z || !canvas?.ready ) return Promise.resolve({ ok: false, reason: "noZones" });
  const allowed = allowedOf(P);
  if ( !allowed.size ) return Promise.resolve({ ok: false, reason: "noZones" });
  return new Promise((resolve) => {
    PICK = { P, allowed, resolve, seq: ++pickSeq, offs: [], hover: -1, down: null, rdown: null, raf: 0, at: null, banner: null, tip: null, rid: null, from: null,
      // the way to zones no click can reach: the free stretch found by looking, the zones hidden per side, their chips, the slide
      way: { free: null, safe: null, hidden: [], chips: new Map(), timer: 0, due: 0, push: null, first: true } };
    startPick();
    redraw();
    // (board.mjs: the pick runs - only now is anything said about it to others)
    try { P.ext?.start?.(); } catch ( err ) { console.warn(`${MODULE_ID} | zones: pick`, err); }
  });
}
/** End the pick running on this client when `test(ext)` says so (board.mjs: the mover of a move pick was deleted). True when it ended. */
export function endPickIf(test, result) {
  if ( !PICK ) return false;
  let hit = false;
  try { hit = !!test(PICK.P.ext ?? null); } catch { hit = false; }
  if ( hit ) endPick(result);
  return hit;
}

function endPick(result) {
  const p = PICK;
  if ( !p ) return;
  PICK = null;
  for ( const off of p.offs ) { try { off(); } catch {} }
  cancelAnimationFrame(p.raf);
  clearTimeout(p.way.timer); if ( p.way.push ) cancelAnimationFrame(p.way.push.raf); p.way.push = null;
  for ( const c of p.way.chips.values() ) c.remove();
  p.way.chips.clear();
  p.banner?.remove(); p.tip?.remove();
  document.body.classList.remove("mm-z-picking", "mm-z-pick-ok", "mm-z-pick-no");
  layer?.setHover(-1);
  try { result = p.P.ext?.end?.(result) ?? result; } catch ( err ) { console.warn(`${MODULE_ID} | zones: pick`, err); }
  redraw();
  p.resolve(result);
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const BANNER_TOP = 72, GAP = 8;
/** The interface part an element belongs to, as a box: the piece that sits directly on the page (a bar, a panel), else the element itself. */
function partBox(e) {
  let w = e;
  while ( w.parentElement && w.parentElement !== document.body && w.parentElement.id !== "interface" ) w = w.parentElement;
  const r = w.getBoundingClientRect();
  return r.height > vh() * 0.45 ? e.getBoundingClientRect() : r;
}
/** Does this element draw anything of its own (a fill, an image, a border, a picture, words)? */
function painted(e, cs) {
  if ( /^(img|svg|canvas|video)$/i.test(e.tagName ?? "") ) return true;
  const bg = cs.backgroundColor ?? "";
  if ( bg && bg !== "transparent" && !/,\s*0\)$/.test(bg) ) return true;
  if ( (cs.backgroundImage ?? "none") !== "none" ) return true;
  if ( parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0 ) return true;
  for ( const n of e.childNodes ?? [] ) if ( n.nodeType === 3 && n.nodeValue.trim() ) return true;
  return false;
}
/**
 * The boxes of what is drawn inside a stretch of the window but lets clicks through (pointer-events: none: a tracker bar on a
 * player's screen) - a look by points cannot find those. Whole-window overlays (weather, tints) are left out.
 */
function unseenBoxes(x0, y0, x1, y1, skip) {
  const out = [];
  if ( typeof getComputedStyle !== "function" || !document.body?.children ) return out;
  const view = canvas.app.view, tall = vh() * 0.45;
  let left = 3000;
  const walk = (e) => {
    for ( const c of e.children ?? [] ) {
      if ( --left < 0 ) return;
      if ( c === view || skip(c) ) continue;
      const cs = getComputedStyle(c);
      if ( cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0 ) continue;
      const r = c.getBoundingClientRect();
      const hit = r.width > 0 && r.height > 0 && r.right > x0 && r.left < x1 && r.bottom > y0 && r.top < y1;
      if ( hit && cs.pointerEvents === "none" && r.height < tall && painted(c, cs) ) out.push({ top: r.top, bottom: r.bottom });
      if ( hit || !(r.width > 0 && r.height > 0) ) walk(c);          // a part without a size of its own may still hold placed pieces
    }
  };
  walk(document.body);
  return out;
}
/**
 * Put the banner where nothing else is: under the declared top inset, and below whatever interface part lies at the top middle
 * of the window (a combat tracker, a strip of chips). It stays in the upper half.
 */
function placeBanner(p) {
  const el = p.banner;
  if ( !el || !hasDom() || typeof document.elementsFromPoint !== "function" || typeof el.getBoundingClientRect !== "function" ) return;
  const r = el.getBoundingClientRect(), w = r.width, h = r.height, x0 = (vw() - w) / 2, view = canvas.app.view;
  if ( !(w > 0 && h > 0) ) return;
  const start = Math.max(BANNER_TOP, uiInsets(p.P.inset).top + GAP), maxY = vh() * 0.5;
  const unseen = unseenBoxes(x0, start - GAP, x0 + w, maxY + h, (e) => e === el || ours(e) || e.classList?.contains("mm-z-tip"));
  let y = start;
  for ( let n = 0; n < 8; n++ ) {
    const boxes = [...unseen];
    for ( let j = 0; j < 3; j++ ) for ( let i = 0; i < 7; i++ ) {
      const px = x0 + 2 + ((w - 4) * i) / 6, py = y - GAP + 1 + ((h + 2 * GAP - 2) * j) / 2;      // the gap around it is looked at too
      for ( const e of document.elementsFromPoint(px, py) ) {
        if ( e === view || e === document.body || e === document.documentElement ) break;
        if ( el.contains(e) || ours(e) || e.classList?.contains("mm-z-tip") ) continue;
        const b = partBox(e); boxes.push({ top: b.top, bottom: b.bottom });
        break;
      }
    }
    const next = View.clearY(y, h, boxes, GAP, maxY);
    if ( next === y ) break;
    y = next;
  }
  el.style.top = `${Math.round(y)}px`;
}

const CHEVRON = { top: "fa-chevron-up", bottom: "fa-chevron-down", left: "fa-chevron-left", right: "fa-chevron-right" };
/** Count the zones on offer no click can reach, per side of the free stretch, and show a chip at each such side. */
function updateWay(p) {
  const w = p.way;
  clearTimeout(w.timer); w.timer = 0;
  if ( PICK !== p || !hasDom() ) return;
  const Z = Zones.zones();
  w.safe = safeNow(p.P.inset, w.free);
  w.hidden = [];
  // (any zone may be picked: there is always one in reach - nothing to lead to)
  if ( Z && p.P.zones && p.P.reveal !== false ) for ( const id of p.allowed.keys() ) {
    const z = Z.zones[id];
    if ( !z || reachable(z) ) continue;
    // (its side: the edge of the free stretch its label lies beyond - under a window inside the stretch: the edge it is nearest to)
    const at = toClient(z.label);
    w.hidden.push({ id, at, side: View.sideOf(at, w.safe, true) });
  }
  const count = { top: 0, right: 0, bottom: 0, left: 0 };
  for ( const hd of w.hidden ) count[hd.side]++;
  const s = w.safe, br = p.banner?.getBoundingClientRect?.() ?? null;
  for ( const side of View.SIDES ) {
    let chip = w.chips.get(side);
    if ( !count[side] ) { if ( chip ) { chip.remove(); w.chips.delete(side); } continue; }
    if ( !chip ) {
      chip = document.createElement("button");
      chip.type = "button"; chip.className = `mm-z-pickway mm-z-pickway-${side}`;
      chip.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); leadTo(p, side); });
      document.body.append(chip);
      w.chips.set(side, chip);
    }
    const text = L(`pick.way.${side}`, { n: count[side] });
    if ( chip.dataset.n !== String(count[side]) ) {
      chip.dataset.n = String(count[side]);
      chip.innerHTML = `<i class="fa-solid ${CHEVRON[side]}" inert></i><span>${esc(L("pick.more", { n: count[side] }))}</span>`;
      chip.setAttribute("aria-label", text); chip.dataset.tooltip = text; chip.dataset.tooltipDirection = side === "bottom" ? "UP" : side === "top" ? "DOWN" : side === "left" ? "RIGHT" : "LEFT";
    }
    // on its edge of the free stretch, as near the middle of the window as the stretch lets it; the top one under the banner when that lies there
    const mid = (c, a, len) => Math.min(Math.max(c, a + Math.min(70, len / 2)), a + len - Math.min(70, len / 2));
    let x = mid(vw() / 2, s.x, s.w), y = mid(vh() / 2, s.y, s.h);
    if ( side === "top" ) y = Math.max(s.y, br && br.right > x - 40 && br.left < x + 40 ? br.bottom : 0) + GAP;
    else if ( side === "bottom" ) y = s.y + s.h - GAP;
    else if ( side === "left" ) x = s.x + GAP;
    else x = s.x + s.w - GAP;
    chip.style.left = `${Math.round(x)}px`; chip.style.top = `${Math.round(y)}px`;
  }
  // nothing on offer is in reach when the pick starts: the nearest comes into view (`reveal: "fit"`: all of them, as far as they fit)
  if ( w.first ) {
    w.first = false;
    if ( p.P.zones && p.P.reveal === "fit" ) reveal([...p.allowed.values()].map((e) => e.zone), { inset: p.P.inset, fit: true });
    else if ( w.hidden.length && w.hidden.length === p.allowed.size ) leadTo(p, null);
  }
}
/** Look again a little later (a pan, a bar that opened): once per `ms`, however often it is asked (a sooner asking wins). */
function scheduleWay(p, ms = 150) {
  if ( PICK !== p || !hasDom() ) return;
  const due = Date.now() + ms;
  if ( p.way.timer && p.way.due <= due ) return;
  clearTimeout(p.way.timer);
  p.way.due = due;
  p.way.timer = setTimeout(() => { p.way.timer = 0; updateWay(p); }, ms);
}
/** Bring the nearest hidden zone of a side (null: of any side) into the free stretch. */
function leadTo(p, side) {
  const w = p.way, s = w.safe;
  if ( !s ) return;
  const c = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
  let best = null;
  for ( const hd of w.hidden ) {
    if ( side && hd.side !== side ) continue;
    const d = Math.hypot(hd.at.x - c.x, hd.at.y - c.y);
    if ( !best || d < best.d ) best = { hd, d };
  }
  const key = best ? Zones.zonesApi.keyOf(best.hd.id) : null;
  if ( key ) reveal(key, { inset: p.P.inset }).then(() => scheduleWay(p, 0));
}
/** The banner, the free stretch and the chips, laid out for the screen as it is now. */
function layoutPick(p) {
  if ( PICK !== p || !hasDom() ) return;
  placeBanner(p);
  p.way.free = measureFree();
  updateWay(p);
}
/**
 * The pointer rests at an edge of the free stretch beyond which zones on offer lie hidden: after a moment the map slides that
 * way, slowly at first, for as long as the pointer stays and something is still hidden there.
 */
const PUSH = { band: 44, dwell: 450, ramp: 400, speed: 620 };
function pushAt(p, at) {
  const w = p.way;
  let dir = null;
  if ( at && w.safe && p.P.edgePan !== false && w.hidden.length ) {
    const d = View.pushOf(at, w.safe, PUSH.band), has = (side) => w.hidden.some((hd) => hd.side === side);
    const x = d.x < 0 && has("left") ? -1 : d.x > 0 && has("right") ? 1 : 0, y = d.y < 0 && has("top") ? -1 : d.y > 0 && has("bottom") ? 1 : 0;
    if ( x || y ) dir = { x, y };
  }
  if ( !dir ) { if ( w.push ) { cancelAnimationFrame(w.push.raf); w.push = null; } return; }
  if ( w.push ) { w.push.x = dir.x; w.push.y = dir.y; return; }
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const st = w.push = { x: dir.x, y: dir.y, since: now(), last: now(), raf: 0 };
  const step = () => {
    if ( PICK !== p || w.push !== st || !canvas?.ready ) return;
    const t = now(), dt = Math.min(50, t - st.last), held = t - st.since - PUSH.dwell;
    st.last = t;
    if ( held > 0 ) {
      const k = Math.min(1, held / PUSH.ramp), px = (PUSH.speed * k * k * dt) / 1000, s = canvas.stage.scale.x;
      canvas.pan({ x: canvas.stage.pivot.x + (st.x * px) / s, y: canvas.stage.pivot.y + (st.y * px) / s });
      scheduleWay(p, 120);
      if ( !w.hidden.some((hd) => (st.x < 0 && hd.side === "left") || (st.x > 0 && hd.side === "right") || (st.y < 0 && hd.side === "top") || (st.y > 0 && hd.side === "bottom")) ) { w.push = null; return; }
    }
    st.raf = requestAnimationFrame(step);
  };
  st.raf = requestAnimationFrame(step);
}

function startPick() {
  const p = PICK, view = canvas.app.view;
  // the banner: what is asked, how to answer, a way out
  // (`banner: false`: the caller's own bar says what is asked - an armed action on its dock)
  if ( p.P.banner !== false ) {
    const el = p.banner = document.createElement("div");
    el.className = "mm-z-pick";
    el.setAttribute("role", "status");
    el.innerHTML = `<i class="fa-solid fa-location-crosshairs" inert></i>
      <span class="mm-z-pick-text"><b>${esc(p.P.title ?? L("pick.title"))}</b><small>${esc(p.P.hint ?? L("pick.hint"))}</small></span>
      <button type="button" data-act="cancel">${esc(L("pick.cancel"))} <kbd>Esc</kbd></button>`;
    el.querySelector("button").addEventListener("click", () => endPick({ ok: false, reason: "cancelled" }));
    document.body.append(el);
  }
  document.body.classList.add("mm-z-picking");
  // where the banner has room, which zones no click can reach: now, once more when the other interface parts have answered the
  // pick (a panel that opened), whenever the view or the window changes, and when a look now and then finds the free stretch
  // changed (a panel that opened or closed later)
  if ( hasDom() ) {
    layoutPick(p);
    const again = setTimeout(() => layoutPick(p), 420);
    // (perf3: the look is spread over frames - measureFreeSoon; a stretch found changed is laid out at once, as before)
    let looking = null;
    const watch = setInterval(() => {
      if ( looking ) return;
      looking = { stop: null };
      const me = looking;
      me.stop = measureFreeSoon((f) => { if ( looking === me ) looking = null; if ( f === undefined || PICK !== p ) return; if ( !sameFree(f, p.way.free) ) layoutPick(p); });
    }, 1500);
    const onPan = () => scheduleWay(p), onSize = () => layoutPick(p);
    Hooks.on("canvasPan", onPan);
    window.addEventListener("resize", onSize);
    p.offs.push(() => clearTimeout(again), () => clearInterval(watch), () => { looking?.stop?.(); looking = null; }, () => Hooks.off("canvasPan", onPan), () => window.removeEventListener("resize", onSize));
  }

  const world = (ev) => canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
  const zoneAt = (pt) => Zones.zonesApi.zoneAt(pt.x, pt.y);
  const setHover = (id, at) => {
    const ok = p.allowed.has(id);
    document.body.classList.toggle("mm-z-pick-ok", ok);
    document.body.classList.toggle("mm-z-pick-no", !ok && id >= 0);
    const ext = p.P.ext;
    if ( id < 0 ) { if ( p.hover !== -1 ) { try { ext?.hover?.(null, null); } catch {} } p.hover = -1; layer?.setHover(-1); p.tip?.remove(); p.tip = null; return; }
    if ( !p.tip ) { p.tip = document.createElement("div"); p.tip.className = "mm-z-tip mm-z-pick-tip"; document.body.append(p.tip); p.hover = -2; }
    if ( id !== p.hover ) {
      p.hover = id; layer?.setHover(ok ? id : -1);
      // beside the cursor: the zone's name with what the caller said about it
      const e = ok ? p.allowed.get(id) : null, sh = e ? shown().zones.get(id) : null;
      const label = e?.label ?? sh?.label ?? null, tip = e?.tip ?? sh?.tip ?? null;
      const ls = e?.label ? e.signs?.label : sh?.signs?.label, ts = e?.tip ? e.signs?.tip : sh?.signs?.tip;
      p.tip.classList.toggle("no", !e);
      let more = "";
      try { ext?.hover?.(e, at); more = e ? ext?.tip?.(e) ?? "" : ""; } catch ( err ) { console.warn(`${MODULE_ID} | zones: pick`, err); }
      p.tip.innerHTML = e ? `<b>${esc(L("zone.title", { n: Zones.zoneName(id) }))}</b>${label ? ` · ${piecesHtml(ls, label)}` : ""}${tip ? `<small>${piecesHtml(ts, tip)}</small>` : ""}${more}` : esc(L("pick.notHere"));
    }
    else if ( ok && ext?.move ) { try { ext.move(p.allowed.get(id), at); } catch {} }
    placeTip(p.tip, at);
  };
  const onMove = (ev) => {
    p.at = { x: ev.clientX, y: ev.clientY };
    if ( p.raf ) return;
    p.raf = requestAnimationFrame(() => { p.raf = 0; if ( PICK !== p || !p.at || !canvas.ready ) return; setHover(zoneAt(canvas.canvasCoordinatesFromClient(p.at)), p.at); pushAt(p, p.at); });
  };
  const onLeave = () => { p.at = null; setHover(-1, { x: 0, y: 0 }); pushAt(p, null); };
  // (the map slid under a pointer that did not move: what is under it now)
  const onSlid = () => { if ( p.way.push && p.at && !p.raf ) onMove({ clientX: p.at.x, clientY: p.at.y }); };
  Hooks.on("canvasPan", onSlid);
  p.offs.push(() => Hooks.off("canvasPan", onSlid));
  // a left press is the pick's (no token is selected or dragged under it); a right press still pans when dragged
  const onDown = (ev) => {
    if ( ev.button === 2 ) { p.rdown = { x: ev.clientX, y: ev.clientY }; return; }
    if ( ev.button !== 0 ) return;
    ev.stopImmediatePropagation(); ev.preventDefault();
    p.down = { x: ev.clientX, y: ev.clientY };
  };
  const onUp = (ev) => {
    if ( ev.button === 2 ) {
      const r = p.rdown; p.rdown = null;
      if ( r && Math.hypot(ev.clientX - r.x, ev.clientY - r.y) < 5 && ev.target === view ) {
        // (a right-click on a zone on offer that has another way: the caller is told so - board.mjs pickMove; anywhere else it gives up)
        const pt = world(ev), id = zoneAt(pt), e = p.allowed.get(id);
        if ( e && p.P.ext?.alt?.(e) ) { const place = Zones.placeOf(e.spot) ?? Zones.placeOf(e.zone); endPick({ ok: true, zone: e.zone, id, spot: place?.spot ?? e.zone, place, x: pt.x, y: pt.y, alt: true }); }
        else endPick({ ok: false, reason: "cancelled" });
      }
      return;
    }
    if ( ev.button !== 0 || !p.down ) return;
    const d = p.down; p.down = null;
    if ( Math.hypot(ev.clientX - d.x, ev.clientY - d.y) >= 6 ) return;
    const pt = world(ev), id = zoneAt(pt), e = p.allowed.get(id);
    if ( !e ) return;
    const place = Zones.placeOf(e.spot) ?? Zones.placeOf(e.zone);
    endPick({ ok: true, zone: e.zone, id, spot: place?.spot ?? e.zone, place, x: pt.x, y: pt.y });
  };
  const onKey = (ev) => { if ( ev.key === "Escape" ) { ev.preventDefault(); ev.stopPropagation(); endPick({ ok: false, reason: "cancelled" }); } };
  const onCtx = (ev) => ev.preventDefault();
  view.addEventListener("pointerdown", onDown, true);
  view.addEventListener("pointermove", onMove, { passive: true });
  view.addEventListener("pointerleave", onLeave);
  view.addEventListener("contextmenu", onCtx);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("keydown", onKey, true);
  p.offs.push(
    () => view.removeEventListener("pointerdown", onDown, true), () => view.removeEventListener("pointermove", onMove), () => view.removeEventListener("pointerleave", onLeave),
    () => view.removeEventListener("contextmenu", onCtx), () => window.removeEventListener("pointerup", onUp), () => window.removeEventListener("keydown", onKey, true)
  );
  if ( p.P.timeout ) { const t = setTimeout(() => { if ( PICK === p ) endPick({ ok: false, reason: "timeout" }); }, p.P.timeout); p.offs.push(() => clearTimeout(t)); }
}

/** A GM asks another user to pick: the request goes to that user alone, the answer comes back the same way. */
function askUser(user, opts) {
  if ( !game.user?.isGM ) return Promise.resolve({ ok: false, reason: "notGM" });
  const u = game.users?.get?.(user);
  if ( !u?.active ) return Promise.resolve({ ok: false, reason: "userGone" });
  if ( !HL.cleanPick(opts) ) return Promise.resolve({ ok: false, reason: "noZones" });
  const rid = `${me()}.${++askSeq}`, t = Number(opts.timeout);
  return new Promise((resolve) => {
    const a = { user, resolve, timer: 0 };
    // (the asked client runs the timeout too; this one a little later, in case the answer never comes)
    if ( Number.isFinite(t) && t > 0 ) a.timer = setTimeout(() => answer(rid, { ok: false, reason: "timeout" }), t + 3000);
    ASKED.set(rid, a);
    emit({ op: "pick", rid, pick: { zones: opts.zones ?? null, title: opts.title ?? null, hint: opts.hint ?? null, color: opts.color ?? null, timeout: opts.timeout ?? 0, banner: opts.banner ?? null, reveal: opts.reveal ?? null, edgePan: opts.edgePan ?? null, inset: View.cleanInsets(opts.inset) } }, [user]);
  });
}
function answer(rid, result) {
  const a = ASKED.get(rid);
  if ( !a ) return;
  ASKED.delete(rid);
  clearTimeout(a.timer);
  a.resolve(result);
}

/* ---------------------------------------------------------------- the socket */

/** The server adds the sender's user id. Highlights and pick requests are taken from GMs only; an answer only from the user asked. */
function onSocket(msg, sender) {
  if ( !msg || msg.t !== "zones" ) return;
  const from = sender ? game.users?.get?.(sender) : null, gm = !!from?.isGM;
  if ( msg.op === "hl" ) {
    if ( !gm || msg.scene !== sceneId() ) return;
    let any = false;
    for ( const id of Array.isArray(msg.del) ? msg.del : [] ) { const h = STORE.get(String(id)); if ( h && h.from != null ) { STORE.remove({ id: h.id }); any = true; } }
    for ( const raw of Array.isArray(msg.set) ? msg.set : [] ) {
      const h = HL.cleanHighlight(raw, me());
      if ( !h?.id ) continue;
      h.users = null; h.boot = msg.b ?? null;
      STORE.set(h, sender); any = true;
    }
    if ( any ) redraw();
  }
  // a client opened this scene: it gets again what was meant for it
  else if ( msg.op === "hello" ) {
    // (its client has just opened the scene: what an earlier page load of it showed here, it no longer knows - a reload)
    if ( sender && dropFrom(sender, msg.b ?? null) ) redraw();
    if ( !sender || msg.scene !== sceneId() || !SENT.size ) return;
    const set = [...SENT.values()].filter((s) => s.remote === "all" || s.remote.includes(sender)).map((s) => wire(s.h));
    if ( set.length ) emit({ op: "hl", set }, [sender]);
  }
  else if ( msg.op === "pick" ) {
    if ( !gm || typeof msg.rid !== "string" ) return;
    const reply = (result) => emit({ op: "picked", rid: msg.rid, result }, [sender]);
    const P = msg.scene === sceneId() ? HL.cleanPick(msg.pick) : null;
    if ( !P ) { reply({ ok: false, reason: msg.scene === sceneId() ? "noZones" : "noScene" }); return; }
    const before = PICK;
    pickHere(P).then((r) => { if ( PICK?.rid === msg.rid ) PICK.rid = null; reply(r); });
    if ( PICK && PICK !== before ) { PICK.rid = msg.rid; PICK.from = sender; }
  }
  else if ( msg.op === "pickCancel" ) { if ( gm && PICK && PICK.rid === msg.rid ) endPick({ ok: false, reason: "cancelled" }); }
  else if ( msg.op === "picked" ) { const a = ASKED.get(msg.rid); if ( a && a.user === sender ) answer(msg.rid, msg.result && typeof msg.result === "object" ? msg.result : { ok: false, reason: "cancelled" }); }
}

/** Take away the highlights a user's client showed here (it reloaded or left: it can no longer take them away itself). `keep`:
 *  the page load whose highlights stay (the one that has just said hello). True when something went. */
function dropFrom(uid, keep = undefined) {
  let any = false;
  for ( const h of STORE.list() ) if ( h.from === uid && (keep === undefined || h.boot !== keep) ) { STORE.remove({ id: h.id }); any = true; }
  return any;
}

/* ---------------------------------------------------------------- lifecycle */

function onTearDown() {
  if ( PICK ) endPick({ ok: false, reason: "sceneChanged" });
  // the picks this client asked of other users belonged to this scene: they are told to stop, a late answer is not taken
  for ( const [rid, a] of [...ASKED] ) { emit({ op: "pickCancel", rid }, [a.user]); answer(rid, { ok: false, reason: "sceneChanged" }); }
  // what this client showed to others belonged to this scene
  for ( const [id, s] of SENT ) emit({ op: "hl", del: [id] }, s.remote === "all" ? null : s.remote);
  SENT.clear();
  STORE.remove({});
  for ( const t of placeTimers ) clearTimeout(t);
  placeTimers = [];
  layer?.destroy(); layer = null;
}

export const interactApi = {
  /** Highlight zones and borders for chosen users; take highlights away; what is highlighted here; a mover's reach, highlighted. */
  highlight, clearHighlights, highlights, showReach,
  /** Let a user pick a zone by click (resolves with the place), give a pick up, whether one runs here. */
  pick, cancelPick, picking,
  /** Which edges of the window another interface part covers; the declared insets; the free part of the window; bring zones into it. */
  uiInset, uiInsets, safeArea, reveal,
  /** Parts of the screen the map's menus and its "My view" chip keep clear of (section 41). */
  uiAvoid, uiAvoids,
  HIGHLIGHT_COLORS: HL.COLORS, highlightLib: HL
};

export function registerInteract() {
  Hooks.once("ready", () => game.socket?.on(CHANNEL, onSocket));
  Hooks.on("canvasReady", () => { if ( canvas.scene ) emit({ op: "hello" }); redraw(); });
  Hooks.on("canvasTearDown", onTearDown);
  // the zones were redrawn, their look or their marks changed: the highlights follow
  Hooks.on("moinenMapsZones", (kind) => {
    if ( kind === "section" || !(layer || STORE.size || PICK) ) return;
    // (the zones on offer are kept by id: the GM redrew the lines under a running pick)
    if ( PICK && (kind === "edited" || kind === "loaded") ) {
      PICK.allowed = allowedOf(PICK.P); PICK.seq = ++pickSeq;
      if ( !PICK.allowed.size ) { endPick({ ok: false, reason: "noZones" }); return; }
    }
    redraw();
  });
  // tokens hide what lies under them: the labels step aside
  Hooks.on("updateToken", (doc, change) => onTokens(doc, change));
  Hooks.on("createToken", (doc) => onTokens(doc));
  Hooks.on("deleteToken", (doc) => onTokens(doc));
  // (section 41: the panels stay where they are on the screen while the map slides under them - the labels look again once it stops)
  Hooks.on("canvasPan", () => { if ( AVOIDS.size || INSETS.size ) boardLabelsMoved(); });
  // a user who was asked to pick left; the GM who asked this user left (nobody to answer to); what a user showed here goes with them
  Hooks.on("userConnected", (user, connected) => {
    if ( connected ) return;
    for ( const [rid, a] of [...ASKED] ) if ( a.user === user.id ) answer(rid, { ok: false, reason: "userGone" });
    if ( PICK?.rid && PICK.from === user.id ) endPick({ ok: false, reason: "userGone" });
    if ( dropFrom(user.id) ) redraw();
  });
}
