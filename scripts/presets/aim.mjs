import { MODULE_ID } from "../config.mjs";
import { sharedNow } from "../shared-clock.mjs";
import { view as viewOf } from "../view-angle.mjs";
import { trackMarkers } from "../workspace/markers.mjs";
import * as Core from "./core.mjs";
import * as U from "./ui-core.mjs";
import * as S from "./store.mjs";

/**
 * DESTRUCTION PRESETS, aiming on the map (P7, GM): while the Presets tool is in hand, ONE gesture fires the armed pad -
 *   point (bomb): click; drag to set the direction it falls from     throw (grenade): drag from the thrower to where it lands
 *   line (guns): drag the line the burst walks (started on a token: the shooter)      run (heli): drag the strafing run
 * THE SHOOTER of a gun (a firearm, ui-core isFirearm): the GM chooses a source token per gun and scene (the bar's Shooter, or S over a
 * token); its muzzle flashes and its rounds fly from it, and it wins over a token the drag starts on (a target). With none chosen a
 * line dragged out of a token makes that token the shooter for the burst (a run never). A soft ring marks the chosen one while the
 * tool is in hand. No shooter, no muzzle flash.
 * A GHOST follows the pointer before the release: the exact plan the release will fire (the expander with the next seed), drawn
 * as soft feathered shapes in the oblique view (craters round on the map, ground rings and smoke squashed, the throw's arc lifted).
 * Keys while the tool is in hand: 1-9 / Shift+1-9 arm a pad, [ ] size, Esc cancels a gesture, Alt held repeats the last firing's
 * seed, Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) take back / fire again the last firing across all layers.
 * Nothing here exists until the tool is picked: the listeners and the ghost are made on activate() and gone on deactivate().
 * Also: the test fire's DRY RUN (dryRun: the ghost played on its timeline, on this client only, nothing written) and the outline
 * of a firing (outline: the firings list's hover).
 */
const api = () => game.modules.get(MODULE_ID)?.api?.presets;
let active = false, listeners = null, layer = null, gfx = null, raf = 0;
let down = null, cursor = null, alt = false, seed = newSeed(), lastSeed = null, busy = false, fadeAt = 0;
let quiet = null;            // where the last firing was released: the ghost stays away until the pointer leaves it (never over a real firing)
let flash = null;            // { box, gfx, raf } the dry run / outline overlay (also when the tool is not in hand)
let picking = false;         // choosing the armed gun's shooter: the next click on a token (Esc / a click off the tokens cancels)
const SRC_INK = 0xffb347;    // the shooter's ring (the presets' own colour)

function newSeed() { return (Math.random() * 4294967296) >>> 0; }
const worldPoint = (ev) => canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
const typing = (ev) => { const t = ev.target; return t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName)); };

/** The world a ghost / dry run is expanded in (as write.mjs envOf, without loading the writer). */
function env() {
  const r = canvas.dimensions?.sceneRect ?? { x: 0, y: 0, width: 1e6, height: 1e6 };
  let dir = 0, speed = 0;
  try { dir = game.settings.get(MODULE_ID, "fireWindDir"); speed = game.settings.get(MODULE_ID, "fireWind"); } catch { /* not registered */ }
  return { grid: canvas.grid?.size ?? 100, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, now: Math.round(sharedNow()), wind: { dir, speed } };
}
const seedNow = () => ((alt || !S.bar().vary) && lastSeed !== null ? lastSeed : seed);

/** The plan of the armed pad for a gesture (null when it cannot be expanded). */
function planOf(def, gesture, s = seedNow()) {
  try { return Core.expand(U.effective(def), gesture, U.fireOpts(def, S.bar(), s), env()); } catch { return null; }
}

/* ---------------------------------------------------------------- drawing (soft: feathered rings, a light blur, never an edge) */

function makeLayer(z = 905) {
  const box = new PIXI.Container(); box.eventMode = "none"; box.zIndex = z;
  const g = new PIXI.Graphics(), src = new PIXI.Graphics(); box.addChild(src, g);
  try { const f = new PIXI.BlurFilter(3, 2); f.padding = 24; box.filters = [f]; } catch { /* no filters: still soft (feathered) */ }
  canvas.interface.sortableChildren = true; canvas.interface.addChild(box);
  trackMarkers(box, { ring: true });
  return { box, g, src };
}
/** Draw shapes into a Graphics; `k(s)` the alpha factor of a shape (the dry run's time), default 1. */
function draw(g, shapes, k = () => 1) {
  g.clear();
  for ( const s of shapes ) {
    const f = k(s); if ( f <= 0.004 ) continue;
    if ( s.k === "disc" ) {
      const y = s.y - (s.z ?? 0);
      for ( const [m, a] of U.FEATHER ) g.beginFill(s.c, s.a * a * f).drawEllipse(s.x, y, s.r * m, s.r * m * s.sq).endFill();
    } else if ( s.k === "ring" ) {
      const y = s.y - (s.z ?? 0);
      for ( const [m, a] of U.RING_FEATHER ) g.lineStyle(s.w * m, s.c, s.a * a * f).drawEllipse(s.x, y, s.r, s.r * s.sq);
      g.lineStyle(0);
    } else if ( s.k === "dots" ) {
      const z = canvas.stage.scale.x || 1, r = Math.max(1.5, s.r / z);
      s.pts.forEach((p, i) => { const u = i / Math.max(1, s.pts.length - 1); g.beginFill(s.c, s.a * f * (0.45 + 0.55 * u)).drawCircle(p[0], p[1], r * (0.7 + 0.5 * u)).endFill(); });
    }
  }
}

/** The armed gun's shooter (null: none, or not a gun). */
const shooter = (def = S.armed()) => S.shooterOf(S.srcToken(def));
/** The soft rings round the shooter (and, while choosing one, round the token under the pointer). */
function srcShapes() {
  const def = S.armed(); if ( !U.isFirearm(def) ) return [];
  const out = [], grid = canvas.grid?.size ?? 100, ring = (t, a) => ({ id: t.id, k: "ring", x: t.x, y: t.y, r: t.r + grid * 0.12, sq: 1, z: 0, w: grid * 0.09, c: SRC_INK, a, t: 0, d: 1 });
  const s = shooter(def);
  if ( s ) out.push(ring(s, 0.55));
  if ( picking && cursor ) { const h = tokenAt(cursor); if ( h && h.id !== s?.id ) out.push(ring(h, 0.4)); }
  return out;
}

function aimShapes() {
  if ( !cursor || picking ) return [];
  if ( quiet && !down ) {
    if ( Math.hypot(cursor[0] - quiet[0], cursor[1] - quiet[1]) < (canvas.grid?.size ?? 100) * 0.75 ) return [];
    quiet = null; fadeAt = performance.now();
  }
  const def = S.armed(); if ( !def ) return [];
  const grid = canvas.grid?.size ?? 100;
  const g = down ? U.gestureOf(def.gesture, down.p, cursor, grid, down.token, shooter(def)) : U.gestureOf(def.gesture, cursor, cursor, grid, null, shooter(def));
  const plan = planOf(def, g); if ( !plan ) return [];
  const shapes = U.ghostOf(plan, viewOf());
  // before a drag of a line / run / throw: a soft reticle where it starts
  if ( !down && def.gesture !== "point" ) shapes.push({ k: "disc", x: cursor[0], y: cursor[1], r: grid * 0.3, sq: viewOf().squash, z: 0, c: U.INK.aim, a: 0.35, t: 0, d: 1 });
  return shapes;
}

let shown = null, outAt = 0, srcT = 0;
const srcFade = new Map();   // the shooter rings on show: token id -> { s (its shape), v (its fade 0..1) }  // the shapes last drawn, and when they began to fade out (released, cancelled, the pointer gone)
const smooth = (u) => u * u * (3 - 2 * u);
function redraw() {
  raf = 0;
  if ( !active || !gfx ) return;
  const now = performance.now(), sh = aimShapes();
  // the shooter's ring (and while choosing, the ring under the pointer): steady while the tool is in hand, each ring with its own fade
  // in and out (220 ms, never tied to the pointer or to the ghost's fades)
  const dt = srcT ? Math.min(50, now - srcT) : 16, want = new Map(srcShapes().map((x) => [x.id, x]));
  srcT = now;
  for ( const [id, x] of want ) { const f = srcFade.get(id); if ( f ) f.s = x; else srcFade.set(id, { s: x, v: 0 }); }
  let moving = false;
  for ( const [id, f] of srcFade ) {
    f.v = want.has(id) ? Math.min(1, f.v + dt / 220) : Math.max(0, f.v - dt / 220);
    if ( f.v <= 0 ) srcFade.delete(id); else if ( f.v < 1 ) moving = true;
  }
  const fades = [...srcFade.values()];
  draw(gfx.src, fades.map((f) => f.s), (x) => smooth(srcFade.get(x.id)?.v ?? 0));
  if ( moving ) raf ||= requestAnimationFrame(redraw); else if ( !fades.length ) srcT = 0;
  if ( sh.length ) {
    shown = sh; outAt = 0;
    draw(gfx.g, sh);
    // fade in (no pop): over 180 ms from when it was shown
    const u = Math.min(1, (now - fadeAt) / 180);
    gfx.g.alpha = smooth(u);
    if ( u < 1 ) raf ||= requestAnimationFrame(redraw);
  } else if ( shown ) {
    // fade out over 220 ms (no pop either)
    if ( !outAt ) outAt = now;
    const u = Math.min(1, (now - outAt) / 220);
    draw(gfx.g, shown, () => 1 - smooth(u));
    if ( u < 1 ) raf ||= requestAnimationFrame(redraw); else { shown = null; gfx.g.clear(); }
  } else gfx.g.clear();
}
const schedule = () => { if ( !raf ) raf = requestAnimationFrame(redraw); };

/* ---------------------------------------------------------------- the gesture */

function tokenAt(p) {
  const hit = (canvas.tokens?.placeables ?? []).filter((t) => t.visible && t.bounds?.contains(p[0], p[1])).at(-1);
  return S.shooterOf(hit ?? null);
}
function onDown(ev) {
  if ( ev.button !== 0 || !active || down || ev.target !== canvas.app?.view ) return;
  ev.stopImmediatePropagation(); ev.preventDefault();
  const p = worldPoint(ev), at = [p.x, p.y], def = S.armed();
  if ( picking ) {
    // choosing the shooter: a token takes it, a click off the tokens leaves it as it was
    const t = tokenAt(at); setPicking(false);
    if ( t && U.isFirearm(def) ) S.setSrc(def, t.id);
    quiet = at; schedule(); return;
  }
  down = { p: at, token: def && (def.gesture === "throw" || def.gesture === "line") ? tokenAt(at) : null };
  cursor = at; schedule();
}
function onMove(ev) {
  if ( !active ) return;
  const p = worldPoint(ev);
  if ( !cursor ) fadeAt = performance.now();
  cursor = [p.x, p.y];
  if ( alt !== ev.altKey ) alt = ev.altKey;
  schedule();
}
async function onUp(ev) {
  if ( ev.button !== 0 || !down ) return;
  const d = down; down = null;
  const p = worldPoint(ev), up = [p.x, p.y], def = S.armed();
  if ( !def || busy ) { schedule(); return; }
  const g = U.gestureOf(def.gesture, d.p, up, canvas.grid?.size ?? 100, d.token, shooter(def));
  // (the pointer is where it was released: a last move the browser coalesced away must not leave the quiet zone at once)
  quiet = up; cursor = up;
  const s = (ev.altKey || !S.bar().vary) && lastSeed !== null ? lastSeed : seed;
  busy = true;
  try {
    const r = await api()?.fire(U.effective(def), g, U.fireOpts(def, S.bar(), s));
    if ( r ) { lastSeed = s; if ( S.bar().vary ) seed = newSeed(); Hooks.callAll(S.HOOK, "fired", r.id); }
  } finally { busy = false; schedule(); }
}
function cancel() { if ( down ) { down = null; schedule(); } }

function onKey(e) {
  if ( !active || typing(e) ) return;
  if ( e.key === "Alt" ) { alt = e.type === "keydown"; schedule(); return; }
  if ( e.type !== "keydown" ) return;
  const k = e.key.toLowerCase();
  if ( (e.ctrlKey || e.metaKey) && !e.altKey && (k === "z" || k === "y") ) {
    e.preventDefault(); e.stopPropagation();
    if ( down ) return;
    // (the panel's firings list and its "fire again" follow once the stacks have moved)
    Promise.resolve(k === "y" || e.shiftKey ? api()?.redo() : api()?.undo()).finally(() => Hooks.callAll(S.HOOK, "fired", null));
    return;
  }
  if ( e.ctrlKey || e.metaKey || e.altKey ) return;
  if ( e.key === "Escape" && down ) { e.preventDefault(); e.stopPropagation(); cancel(); return; }
  if ( e.key === "Escape" && picking ) { e.preventDefault(); e.stopPropagation(); setPicking(false); return; }
  // S: the token under the pointer becomes the armed gun's shooter (S on the shooter itself: no shooter)
  if ( e.code === "KeyS" && !down ) {
    // (only over a token while a gun is armed: else S stays Foundry's - the canvas pans)
    const def = S.armed(), t = U.isFirearm(def) && cursor ? tokenAt(cursor) : null; if ( !t ) return;
    e.preventDefault(); e.stopImmediatePropagation();
    setPicking(false);
    S.setSrc(def, t.id === S.srcToken(def)?.id ? null : t.id);
    return;
  }
  if ( e.key === "[" || e.key === "]" ) {
    e.preventDefault(); e.stopPropagation();
    const b = S.bar(); S.setBar({ size: Math.round(Math.min(U.SIZE.max, Math.max(U.SIZE.min, b.size + (e.key === "]" ? 0.1 : -0.1))) * 100) / 100 });
    return;
  }
  const i = U.padOfKey(e.code, e.shiftKey);
  if ( i >= 0 ) {
    const pad = S.pads()[i]; if ( !pad ) return;
    e.preventDefault(); e.stopPropagation();
    if ( pad.id !== S.bar().pad ) S.setBar({ pad: pad.id });
  }
}

/* ---------------------------------------------------------------- the tool */

function build() {
  gfx = makeLayer();
  const view = canvas.app.view;
  listeners = { down: onDown, move: onMove, up: onUp, cancel, key: onKey, leave: () => { if ( !down ) { cursor = null; schedule(); } }, setting: () => schedule() };
  window.addEventListener("pointerdown", listeners.down, true);
  view.addEventListener("pointermove", listeners.move);
  view.addEventListener("pointerleave", listeners.leave);
  window.addEventListener("pointerup", listeners.up);
  window.addEventListener("pointercancel", listeners.cancel);
  window.addEventListener("blur", listeners.cancel);
  window.addEventListener("keydown", listeners.key, true);
  window.addEventListener("keyup", listeners.key, true);
  listeners.hook = Hooks.on(S.HOOK, listeners.setting);
  // (the shooter's ring follows its token; a deleted shooter's ring goes)
  listeners.tok = Hooks.on("refreshToken", (t) => { if ( t.id === S.srcToken(S.armed())?.id ) schedule(); });
  listeners.del = Hooks.on("deleteToken", () => schedule());
  document.body.classList.add("mm-aiming-preset");
}
function unbuild() {
  if ( listeners ) {
    const v = canvas.app?.view;
    window.removeEventListener("pointerdown", listeners.down, true); v?.removeEventListener("pointermove", listeners.move);
    v?.removeEventListener("pointerleave", listeners.leave);
    window.removeEventListener("pointerup", listeners.up); window.removeEventListener("pointercancel", listeners.cancel);
    window.removeEventListener("blur", listeners.cancel); window.removeEventListener("keydown", listeners.key, true);
    window.removeEventListener("keyup", listeners.key, true);
    Hooks.off(S.HOOK, listeners.hook); Hooks.off("refreshToken", listeners.tok); Hooks.off("deleteToken", listeners.del);
    listeners = null;
  }
  cancelAnimationFrame(raf); raf = 0;
  if ( gfx && !gfx.box.destroyed ) gfx.box.destroy({ children: true });
  gfx = null; down = null; cursor = null; quiet = null; shown = null; outAt = 0; srcFade.clear(); srcT = 0;
  if ( picking ) { picking = false; document.body.classList.remove("mm-picking-src"); Hooks.callAll(S.HOOK, "picking", false); }
  document.body.classList.remove("mm-aiming-preset");
}
/** The Presets tool in hand (true) or put down (false). GM only. */
export function setActive(on) {
  on = !!on && !!game.user?.isGM && !!canvas?.ready;
  if ( on === active ) return;
  active = on;
  if ( on ) build(); else unbuild();
}
export const isActive = () => active;
/** Choosing the armed gun's shooter on the map (the bar's Shooter button): on / off. */
export function setPicking(on) {
  on = !!on && active && U.isFirearm(S.armed());
  if ( on === picking ) return;
  picking = on;
  document.body.classList.toggle("mm-picking-src", on);
  Hooks.callAll(S.HOOK, "picking", on);
  schedule();
}
export const isPicking = () => picking;
/** A new canvas while the tool is in hand: the ghost and listeners again on it. */
export function onCanvasReady() { stopFlash(); if ( active ) { unbuild(); if ( canvas.ready ) build(); else active = false; } }
export function onTearDown() { stopFlash(); if ( active ) unbuild(); }
/** The seed the next firing uses, and the last one (tests). */
export const seeds = () => ({ next: seed, last: lastSeed, alt });

/* ---------------------------------------------------------------- dry run and outline (the panel) */

function stopFlash() {
  if ( !flash ) return;
  cancelAnimationFrame(flash.raf);
  if ( !flash.box.destroyed ) flash.box.destroy({ children: true });
  flash = null;
}
/** The test gesture of a preset at the middle of the view. */
function testGesture(def) {
  const c = canvas.stage.pivot, g = canvas.grid?.size ?? 100, x = Math.round(c.x), y = Math.round(c.y);
  if ( def.gesture === "throw" ) return { a: [x - 2.5 * g, y + g], b: [x, y], from: [x - 2.5 * g, y + g] };
  if ( def.gesture === "line" ) return { a: [x - 3 * g, y], b: [x + 3 * g, y], from: null };
  if ( def.gesture === "run" ) return { a: [x - 5 * g, y - g], b: [x + 5 * g, y + g], from: null };
  return { a: [x, y], b: null, from: null };
}
/**
 * TEST FIRE (GM, this client only; nothing is written, nothing is sent): the preset's plan at the middle of the view, played as its
 * ghost on its own timeline (each part swells in at its moment and fades), and the presets hook ("firing" / "impact" / "part" with
 * `test: true`) called on this client so the layers that play pending parts can show them locally. Returns the plan or null.
 */
export function dryRun(def) {
  if ( !canvas?.ready || !game.user?.isGM ) return null;
  stopFlash();
  const plan = planOf(def, testGesture(def), newSeed()); if ( !plan ) return null;
  const shapes = U.ghostOf(plan, viewOf()), from = -(def.preroll ?? 0), end = U.dryEnd(shapes), t0 = performance.now() - from;
  const L = makeLayer(906);
  flash = { ...L, raf: 0 };
  const rec = { id: `test-${plan.seed}`, test: true, ...plan, t0: Math.round(sharedNow() - from) };
  const call = (kind, data) => { try { Hooks.callAll(api()?.HOOK ?? "moinenMapsPresets", kind, { fid: rec.id, rec, test: true, ...data }); } catch { /* a listener failed */ } };
  call("firing", { late: 0 });
  const parts = [{ part: "impact", t: 0 }];
  for ( const [part, list] of Object.entries(plan.pending) ) list.forEach((item, i) => parts.push({ part, i, item, t: item.at ?? 0 }));
  parts.sort((a, b) => a.t - b.t);
  const tick = () => {
    if ( !flash ) return;
    const now = performance.now() - t0;
    while ( parts.length && parts[0].t <= now ) { const p = parts.shift(); if ( p.part === "impact" ) call("impact", { t: rec.t0 }); else call("part", { part: p.part, i: p.i, item: p.item, t: rec.t0 + p.t, late: 0 }); }
    draw(flash.g, shapes, (s) => U.dryAlpha(s, now));
    if ( now > end + 200 ) { call("gone", {}); stopFlash(); return; }
    flash.raf = requestAnimationFrame(tick);
  };
  flash.raf = requestAnimationFrame(tick);
  return plan;
}
/** Outline a firing record on the map (the firings list's hover), null to hide. */
export function outline(rec) {
  stopFlash();
  if ( !rec || !canvas?.ready ) return;
  const g = canvas.grid?.size ?? 100, v = viewOf(), shapes = [];
  if ( rec.walk?.hits?.length ) for ( const h of rec.walk.hits ) shapes.push({ k: "disc", x: h[0], y: h[1], r: g * 0.3 * (rec.size ?? 1), sq: 1, z: 0, c: U.INK.aim, a: 0.4, t: 0, d: 1 });
  else if ( Array.isArray(rec.at) ) shapes.push({ k: "disc", x: rec.at[0], y: rec.at[1], r: g * 1.4 * (rec.size ?? 1), sq: v.squash, z: 0, c: U.INK.aim, a: 0.45, t: 0, d: 1 });
  const L = makeLayer(906);
  flash = { ...L, raf: 0 };
  const t0 = performance.now();
  const tick = () => { if ( !flash ) return; const u = Math.min(1, (performance.now() - t0) / 160); draw(flash.g, shapes, () => u * u * (3 - 2 * u)); if ( u < 1 ) flash.raf = requestAnimationFrame(tick); };
  tick();
}
