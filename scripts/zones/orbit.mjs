/**
 * Orbit: one shared "Orbit" scene for the whole world. A token thrown (or flown) to orbit from any map really leaves that map and
 * appears there; on every map the GM sees, docked at the top of the screen, a strip of everyone in orbit, and a click brings a token down
 * onto that map (players see no strip).
 *
 * - The Orbit scene is made on demand by a GM: its background is procedural pixel-art space (space.mjs), painted at a low art
 *   resolution, enlarged with hard edges and uploaded once as a PNG into the world folder; the seed sits in the scene flag (v 2: the
 *   planet's layout incl. its longitude `lo`, so the live drifting clouds of orbit-clouds.mjs need no check of the picture).
 * - No socket: a player asks by setting a one-off request flag on a token they own (`orbitReq: {dir, scene, at}`; the old `alt` /
 *   `land` flags still work) and
 *   the active GM's client does the move (create on the other scene, delete here), so it works with only the GM online to act.
 * - The token keeps where it came from (`orbitFrom`: scene, x, y, elevation); coming back to that same map lands it there, any
 *   other map lands it at the middle of the top edge, on the first free square.
 * - A player whose own character goes up or down follows it to the other scene (client setting `orbitFollow`).
 */
import { MODULE_ID } from "../config.mjs";
import { put } from "../flag-diff.mjs";
import { api as moduleApi } from "../attrs.mjs";
import { paintSpace, enlarge, lastLayout } from "./space.mjs";
import { startAmbience, stopAmbience } from "./orbit-ambience.mjs";
import { fightSpot, listSpot } from "./orbit-dock.mjs";

const ART = 6;            // scene pixels per art pixel
const GRID = 100, COLS = 30, ROWS = 18;
const T = (k, d) => (d ? game.i18n.format(`MOINENMAPS.Orbit.${k}`, d) : game.i18n.localize(`MOINENMAPS.Orbit.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The world's Orbit scene (null until a GM makes it). */
export const orbitScene = () => game.scenes?.find((s) => !!s.getFlag(MODULE_ID, "orbit")) ?? null;
export const isOrbit = (scene) => !!scene?.getFlag?.(MODULE_ID, "orbit");
const enabled = () => { try { return game.settings.get(MODULE_ID, "orbit") !== false; } catch { return true; } };
/** The one client that does the moves. */
const iAmTheGM = () => !!game.user?.isGM && (game.users.activeGM ? game.users.activeGM.isSelf : true);

/* ---------------------------------------------------------------- the scene and its picture */

const picker = () => foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;

/** Paint the space picture for a seed and upload it; returns its path. */
async function makeBackground(seed) {
  const w = (COLS * GRID) / ART, h = (ROWS * GRID) / ART;
  const big = enlarge(paintSpace(seed, w, h), w, h, ART);
  layoutOf.set(seed, JSON.parse(JSON.stringify(lastLayout)));   // where its planet / moon are: saved in the scene flag for the ambience
  const cv = document.createElement("canvas");
  cv.width = big.width; cv.height = big.height;
  cv.getContext("2d").putImageData(new ImageData(big.data, big.width, big.height), 0, 0);
  const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
  const dir = `worlds/${game.world.id}/moinen-maps`, FP = picker();
  try { await FP.createDirectory("data", dir, {}); } catch { /* it exists already */ }
  const res = await FP.upload("data", dir, new File([blob], `orbit-space-${seed}.png`, { type: "image/png" }), {}, { notify: false });
  if ( !res?.path ) throw new Error(res?.message ?? "upload failed");
  return res.path;
}

/** Set the scene's picture (v14 keeps it on the first level; older data on the scene). */
async function setBackground(scene, src) {
  const lv = scene.levels?.contents?.[0];
  if ( lv ) await lv.update({ "background.src": src, "background.color": "#04030a" });
  else await scene.update({ "background.src": src, backgroundColor: "#04030a" });
}

const layoutOf = new Map();
let making = null;
/** The Orbit scene, made now when the world has none (GM only). */
export async function ensureOrbitScene() {
  const have = orbitScene();
  if ( have || !game.user.isGM ) return have;
  making ??= (async () => {
    const seed = Math.floor(Math.random() * 2 ** 31);
    const src = await makeBackground(seed);
    const scene = await Scene.implementation.create({
      name: T("sceneName"), width: COLS * GRID, height: ROWS * GRID, padding: 0, grid: { size: GRID, type: CONST.GRID_TYPES.SQUARE, alpha: 0.06 },
      tokenVision: false, fog: { exploration: false }, navigation: true,
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED },
      flags: { [MODULE_ID]: { orbit: { seed, v: 2, layout: layoutOf.get(seed) ?? null } } }
    });
    await setBackground(scene, src);
    ui.notifications.info(T("made"));
    return scene;
  })().finally(() => { making = null; });
  return making;
}

/** Paint a new sky for the Orbit scene (GM). */
export async function regenerate(seed = Math.floor(Math.random() * 2 ** 31)) {
  const scene = await ensureOrbitScene();
  if ( !scene || !game.user.isGM ) return null;
  const src = await makeBackground(seed);
  // the flag first: the canvas redrawn for the new picture already finds the new planet (the live clouds paint that planet)
  await scene.update(put({}, `flags.${MODULE_ID}.orbit`, scene.flags?.[MODULE_ID]?.orbit, { seed, v: 2, layout: layoutOf.get(seed) ?? null }));
  await setBackground(scene, src);
  return src;
}

/* ---------------------------------------------------------------- moving tokens up and down */

/** Grid squares a scene's tokens cover, as "col,row" keys. */
function taken(scene, g) {
  const out = new Set();
  for ( const t of scene.tokens ) {
    const c0 = Math.floor(t.x / g), r0 = Math.floor(t.y / g);
    for ( let c = 0; c < Math.max(1, Math.round(t.width)); c++ ) for ( let r = 0; r < Math.max(1, Math.round(t.height)); r++ ) out.add(`${c0 + c},${r0 + r}`);
  }
  return out;
}
const fits = (busy, c, r, w, h) => { for ( let i = 0; i < w; i++ ) for ( let j = 0; j < h; j++ ) if ( busy.has(`${c + i},${r + j}`) ) return false; return true; };

/** A free spot in orbit: rows across the upper sky (the planet fills the bottom), from the middle outwards. */
function orbitSlot(scene, data) {
  const g = scene.grid.size, busy = taken(scene, g), w = Math.max(1, Math.round(data.width)), h = Math.max(1, Math.round(data.height));
  const cols = Math.floor(scene.width / g), mid = Math.floor(cols / 2);
  for ( const r of [5, 3, 7, 2, 9, 1, 11] ) for ( let k = 0; k < cols; k++ ) {
    const c = mid + (k % 2 ? (k + 1) / 2 : -k / 2);
    if ( c >= 1 && c + w < cols && fits(busy, c, r, w, h) ) return { x: c * g, y: r * g };
  }
  return { x: mid * g, y: 5 * g };
}

/** Where a token lands on a map it did not come from: the middle of the top edge, the first free square near it. */
function landingSlot(scene, data) {
  const g = scene.grid.size, d = scene.dimensions, rect = d.sceneRect, busy = taken(scene, g);
  const w = Math.max(1, Math.round(data.width)), h = Math.max(1, Math.round(data.height));
  const c0 = Math.floor(rect.x / g), cols = Math.floor(rect.width / g), r0 = Math.floor(rect.y / g), mid = c0 + Math.floor((cols - w) / 2);
  for ( let r = r0; r < r0 + 4; r++ ) for ( let k = 0; k < cols; k++ ) {
    const c = mid + (k % 2 ? (k + 1) / 2 : -k / 2);
    if ( c >= c0 && c + w <= c0 + cols && fits(busy, c, r, w, h) ) return { x: c * g, y: r * g };
  }
  return { x: mid * g, y: r0 * g };
}

const busyIds = new Set();
/** A token that moves keeps its place in combat: its combatants point at the new token before the old one is deleted. */
async function keepCombatants(oldDoc, made) {
  for ( const c of game.combats ?? [] ) for ( const cb of c.combatants ) {
    if ( cb.tokenId !== oldDoc.id || cb.sceneId !== oldDoc.parent?.id ) continue;
    try { await cb.update({ tokenId: made.id, sceneId: made.parent.id }); } catch ( err ) { console.warn(`${MODULE_ID} | orbit: combatant`, err); }
  }
}
const flagsOf = (data) => ((data.flags ??= {})[MODULE_ID] ??= {});

/** Throw a token to orbit: it leaves its map and appears on the Orbit scene (a player's call becomes a request to the GM). */
export async function sendToOrbit(token, { thrown = false } = {}) {
  const doc = token?.document ?? token;
  if ( !doc?.parent || isOrbit(doc.parent) || !enabled() ) return null;
  if ( !iAmTheGM() ) {
    if ( !doc.isOwner ) return null;
    if ( !game.users.activeGM ) ui.notifications.warn(T("noGM"));
    // (put: a request still stored is REPLACED, never merged with this one - an old down request's scene / alt would stay on it)
    return doc.update(put({}, `flags.${MODULE_ID}.orbitReq`, doc.flags?.[MODULE_ID]?.orbitReq, { dir: "up", thrown: !!thrown, at: Date.now() }));
  }
  if ( busyIds.has(doc.uuid) ) return null;
  busyIds.add(doc.uuid);
  try {
    const orbit = await ensureOrbitScene();
    if ( !orbit ) return null;
    const from = doc.parent, data = doc.toObject();
    delete data._id;
    const f = flagsOf(data);
    delete f.floor; delete f.land; delete f.orbitReq;
    f.alt = "orbit";
    f.orbitFrom = { scene: from.id, x: doc.x, y: doc.y, elevation: doc.elevation ?? 0, thrown: !!thrown, at: Date.now() };
    Object.assign(data, orbitSlot(orbit, data), { elevation: 0 });
    const [made] = await orbit.createEmbeddedDocuments("Token", [data], { mmOrbit: { dir: "up", from: from.id } });
    if ( made ) { await keepCombatants(doc, made); await from.deleteEmbeddedDocuments("Token", [doc.id], { mmOrbit: { dir: "up", to: orbit.id } }); }
    return made ?? null;
  } finally { busyIds.delete(doc.uuid); }
}

/** Bring a token down from orbit onto a map (its own map by default, then the active scene), at an altitude ("ground" by default). */
export async function bringBack(token, sceneId = null, alt = "ground") {
  const doc = token?.document ?? token;
  if ( !doc?.parent || !isOrbit(doc.parent) ) return null;
  if ( !iAmTheGM() ) {
    if ( !doc.isOwner ) return null;
    if ( !game.users.activeGM ) ui.notifications.warn(T("noGM"));
    return doc.update(put({}, `flags.${MODULE_ID}.orbitReq`, doc.flags?.[MODULE_ID]?.orbitReq, { dir: "down", scene: sceneId ?? null, alt, at: Date.now() }));
  }
  if ( busyIds.has(doc.uuid) ) return null;
  busyIds.add(doc.uuid);
  try {
    const from = doc.getFlag(MODULE_ID, "orbitFrom") ?? {};
    const target = [sceneId, from.scene].map((id) => id && game.scenes.get(id)).find((s) => s && !isOrbit(s))
      ?? game.scenes.find((s) => s.active && !isOrbit(s)) ?? null;
    if ( !target ) { ui.notifications.warn(T("noMap")); await doc.update({ [`flags.${MODULE_ID}.-=land`]: null, [`flags.${MODULE_ID}.-=orbitReq`]: null, [`flags.${MODULE_ID}.alt`]: "orbit" }); return null; }
    const data = doc.toObject();
    delete data._id;
    const f = flagsOf(data);
    delete f.orbitFrom; delete f.land; delete f.floor; delete f.orbitReq;
    if ( alt && alt !== "ground" && alt !== "orbit" ) f.alt = alt; else delete f.alt;
    const home = target.id === from.scene && Number.isFinite(from.x);
    Object.assign(data, home ? { x: from.x, y: from.y, elevation: from.elevation ?? 0 } : { ...landingSlot(target, data), elevation: 0 });
    const [made] = await target.createEmbeddedDocuments("Token", [data], { mmOrbit: { dir: "down", from: doc.parent.id } });
    if ( made ) { await keepCombatants(doc, made); await doc.parent.deleteEmbeddedDocuments("Token", [doc.id], { mmOrbit: { dir: "down", to: target.id } }); }
    return made ?? null;
  } finally { busyIds.delete(doc.uuid); }
}

/** The GM's client answers the players' requests (flags on their own tokens). */
function onUpdateToken(doc, changed) {
  const fm = changed.flags?.[MODULE_ID];
  if ( isOrbit(doc.parent) ) queueMicrotask(() => strip.refresh());
  if ( !fm || !iAmTheGM() || !enabled() ) return;
  if ( fm.orbitReq ) return void serve(doc);
  if ( !isOrbit(doc.parent) ) { if ( fm.alt === "orbit" ) guarded(doc, () => sendToOrbit(doc)); return; }
  if ( "land" in fm && fm.land !== undefined ) return void guarded(doc, () => bringBack(doc, fm.land || null));
  const alt = "-=alt" in fm ? "ground" : fm.alt;
  if ( alt && alt !== "orbit" ) guarded(doc, () => bringBack(doc, null, alt));
}
/** A request flag that is left over (the move failed or did nothing) is cleared, so asking again works. */
const clearReq = (doc) => (doc.parent?.tokens.get(doc.id) && (doc.getFlag(MODULE_ID, "orbitReq") || doc.getFlag(MODULE_ID, "land") !== undefined)
  ? doc.update({ [`flags.${MODULE_ID}.-=orbitReq`]: null, [`flags.${MODULE_ID}.-=land`]: null }).catch(() => null) : null);
/** Run a move; on an error the GM is told and the request cleared. */
async function guarded(doc, fn) {
  try { const made = await fn(); if ( !made ) await clearReq(doc); }
  catch ( err ) { console.error(`${MODULE_ID} | orbit`, err); ui.notifications.error(T("failed", { name: doc.name })); await clearReq(doc); }
}
/** A player's request (a one-off value: asking again always changes it, so it never sticks). */
function serve(doc) {
  const r = doc.getFlag(MODULE_ID, "orbitReq");
  if ( !r ) return;
  if ( r.dir === "up" && !isOrbit(doc.parent) ) return void guarded(doc, () => sendToOrbit(doc, { thrown: !!r.thrown }));
  if ( r.dir === "down" && isOrbit(doc.parent) ) return void guarded(doc, () => bringBack(doc, r.scene || null, r.alt || "ground"));
  clearReq(doc);
}
/** Requests made while no GM was online: the GM who comes in serves them. */
function sweep() {
  if ( !iAmTheGM() || !enabled() ) return;
  for ( const s of game.scenes ) for ( const t of s.tokens ) if ( t.getFlag(MODULE_ID, "orbitReq") ) serve(t);
}

/** A player follows their own character up to orbit and back down. */
function onCreateToken(doc, options) {
  if ( isOrbit(doc.parent) ) strip.refresh();
  const o = options?.mmOrbit;
  if ( !o || game.user.isGM || !doc.actor || game.user.character !== doc.actor ) return;
  let follow = true; try { follow = game.settings.get(MODULE_ID, "orbitFollow"); } catch { /* default on */ }
  if ( follow && canvas.scene?.id === o.from ) doc.parent.view();
}

/* ---------------------------------------------------------------- the GM's strip at the top of the screen */

/** The last map (not the Orbit scene) this browser showed: where "back" goes. */
const LAST_KEY = "mm-orbit-last-map";
const lastMap = () => { try { const id = sessionStorage.getItem(LAST_KEY) ?? localStorage.getItem(LAST_KEY); const s = id && game.scenes.get(id); return s && !isOrbit(s) ? s : null; } catch { return null; } };
const rememberMap = (scene) => { if ( !scene || isOrbit(scene) ) return; try { sessionStorage.setItem(LAST_KEY, scene.id); localStorage.setItem(LAST_KEY, scene.id); } catch { /* blocked */ } };

/** On the Orbit scene: a bar at the top of the screen with one click back to the last map (or the active scene). */
const back = {
  el: null,
  remove() { this.el?.remove(); this.el = null; },
  refresh() {
    if ( !canvas?.ready || !isOrbit(canvas.scene) ) return this.remove();
    const target = lastMap() ?? game.scenes.find((s) => s.active && !isOrbit(s)) ?? null;
    if ( !target ) return this.remove();
    if ( !this.el ) {
      this.el = document.createElement("div");
      this.el.id = "mm-orbit-back";
      this.el.addEventListener("click", (ev) => { const b = ev.target.closest("button[data-scene]"); if ( !b ) return; ev.preventDefault(); game.scenes.get(b.dataset.scene)?.view(); });
      (document.getElementById("board") ?? document.body).after(this.el);
    }
    this.el.innerHTML = `<button type="button" data-scene="${target.id}" data-tooltip="${esc(T("backTip"))}"><i class="fa-solid fa-arrow-left" inert></i>
      <i class="fa-solid fa-earth-europe" inert></i><span>${esc(T("back", { map: target.name }))}</span></button>`;
  }
};

/** The GM's strip of everyone in orbit: docked at the top of the screen (screen-fixed, it never follows the camera), shown to the GM only.
 * Players get no strip at all (nothing about who is in orbit reaches them through it); they go up with the altitude picker's Orbit
 * and come down with the Token HUD button on the Orbit scene, and follow their own character there (orbitFollow).
 * Where: 16 px from the top (like the scene controls and navigation), centred on the free strip of screen between the scene
 * navigation and the sidebar, never wider than it (it wraps to a second row instead). When the Invincible Plus Ultra initiative bar
 * is up at the top (it publishes its bottom edge as data-icbar-bottom on <html>, its centre / width as --icbar-cx / --icbar-maxw on
 * its root), the strip sits centred under it. dock() measures this only when something it depends on changes: the bar (a
 * MutationObserver), the sidebar / navigation size (a ResizeObserver: collapse, expand) and the window size. No camera, ticker or
 * per-frame work.
 * fxm2 (U201): WHILE A FIGHT RUNS on this map (a started combat of this scene) the strip folds to one small button - the globe and the
 * count, the names in its tooltip - in the initiative bar's own row (orbit-dock.mjs fightSpot), never over the map, and a click on it
 * only opens the list under it: the portraits (bring one down here) and "show the Orbit scene" are a second, deliberate click, and
 * a right click does nothing. Outside a fight it is the strip as before. */
const inFight = () => { try { const c = game.combats?.viewed ?? game.combat; return !!c?.started && (!c.scene || c.scene.id === canvas?.scene?.id); } catch { return false; } };
const strip = {
  el: null, mo: null, ro: null, bar: null, key: "", fight: false, open: false,
  onResize: () => strip.dock(),
  onAway: (ev) => { if ( strip.open && strip.el && !strip.el.contains(ev.target) ) strip.setOpen(false); },
  remove() {
    this.mo?.disconnect(); this.ro?.disconnect(); this.mo = this.ro = this.bar = null; this.key = ""; this.open = false;
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("pointerdown", this.onAway, true);
    this.el?.remove(); this.el = null; this.html = "";
  },
  /** fxm2: the initiative bar as drawn - the union of its visible parts (its root may span more than it shows) - or null. */
  barBox(bar) {
    if ( !bar ) return null;
    let u = null;
    for ( const e of bar.querySelectorAll(":scope > *") ) {
      const r = e.getBoundingClientRect(); if ( !(r.width > 0 && r.height > 0) ) continue;
      u = u ? { x0: Math.min(u.x0, r.left), y0: Math.min(u.y0, r.top), x1: Math.max(u.x1, r.right), y1: Math.max(u.y1, r.bottom) } : { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
    }
    if ( !u ) { const r = bar.getBoundingClientRect(); if ( r.width > 0 && r.height > 0 ) u = { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }; }
    return u;
  },
  /** fxm2: what the folded button keeps clear of: Foundry's columns and top row, and the panels other modules declared. */
  avoidBoxes() {
    const out = [];
    for ( const q of ["#sidebar", "#scene-controls", "#scene-navigation", "#players"] ) { const r = document.querySelector(q)?.getBoundingClientRect(); if ( r && r.width > 0 && r.height > 0 ) out.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }); }
    try { for ( const b of moduleApi.zones?.uiAvoids?.() ?? [] ) out.push(b); } catch { /* no zones api */ }
    return out;
  },
  /** The free strip of screen at the top: right of the scene controls and the navigation, left of the sidebar. */
  freeArea() {
    const W = window.innerWidth, R = (q) => { const r = document.querySelector(q)?.getBoundingClientRect(); return r && r.width > 0 && r.height > 0 ? r : null; };
    const ctl = R("#scene-controls"), nav = R("#scene-navigation .scene-navigation-menu") ?? R("#scene-navigation li.scene"), side = R("#sidebar");
    let lo = Math.max(0, ctl && ctl.right < W * 0.4 ? ctl.right : 0, nav && nav.top < 120 && nav.right < W * 0.5 ? nav.right : 0) + 12;
    let hi = (side && side.left > W * 0.4 ? side.left : W) - 12;
    if ( hi - lo < 240 ) { lo = Math.max(0, (ctl?.right ?? 0) + 12); hi = Math.max(lo + 240, hi); }
    return { lo, hi };
  },
  /** Place it: under the initiative bar when that shows, else at the top of the free area (only writes what changed). */
  dock() {
    const el = this.el; if ( !el ) return;
    const bar = document.getElementById("invincible-combat-bar");
    if ( bar && bar !== this.bar ) { this.bar = bar; this.mo?.observe(bar, { attributes: true, attributeFilter: ["style"] }); }
    const under = Number(document.documentElement.dataset.icbarBottom) || 0;
    const bcx = under > 0 ? parseFloat(bar?.style.getPropertyValue("--icbar-cx")) : NaN, bw = parseFloat(bar?.style.getPropertyValue("--icbar-maxw"));
    if ( this.fight ) {
      const head = el.querySelector(".mm-orbit-head")?.getBoundingClientRect();
      const at = fightSpot(this.barBox(bar), { w: head?.width || 48, h: head?.height || 30 }, this.avoidBoxes(), window.innerWidth, window.innerHeight);
      const k = `f|${at.x}|${at.y}`;
      if ( k !== this.key ) {
        this.key = k; el.dataset.where = at.where;
        el.style.top = `${at.y}px`; el.style.left = `${at.x}px`; el.style.maxWidth = "";
      }
      this.placeList();
      return;
    }
    let top = 16, cx, w;
    if ( Number.isFinite(bcx) ) { top = under + 8; cx = bcx; w = bw > 0 ? bw : 480; }
    else { const { lo, hi } = this.freeArea(); cx = (lo + hi) / 2; w = hi - lo; }
    const k = `${Math.round(top)}|${Math.round(cx)}|${Math.round(w)}`;
    if ( k === this.key ) return;
    this.key = k;
    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(cx)}px`;
    el.style.maxWidth = `${Math.max(160, Math.round(w))}px`;
  },
  refresh() {
    if ( !game.user?.isGM || !canvas?.ready || !canvas.scene || isOrbit(canvas.scene) || !enabled() ) return this.remove();
    const orbit = orbitScene();
    const list = orbit ? orbit.tokens.contents : [];
    if ( !list.length ) return this.remove();
    if ( !this.el ) {
      this.el = document.createElement("div");
      this.el.id = "mm-orbit-strip";
      this.el.addEventListener("click", (ev) => this.onClick(ev));
      this.el.addEventListener("contextmenu", (ev) => { ev.preventDefault(); if ( !this.fight ) orbitScene()?.view(); });   // (fxm2: never in a fight)
      document.addEventListener("pointerdown", this.onAway, true);
      (document.getElementById("board") ?? document.body).after(this.el);
      this.mo = typeof MutationObserver === "function" ? new MutationObserver(() => this.dock()) : null;
      this.mo?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-icbar-bottom"] });
      this.ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.dock()) : null;
      for ( const id of ["sidebar", "scene-navigation"] ) { const n = document.getElementById(id); if ( n ) this.ro?.observe(n); }
      window.addEventListener("resize", this.onResize);
      this.dock();
    }
    const here = canvas.scene.id;
    const chip = (t) => {
      const from = game.scenes.get(t.getFlag(MODULE_ID, "orbitFrom")?.scene ?? "")?.name ?? "?";
      const tip = `${t.name} - ${T("fromMap", { map: from })}<br>${T("chipLand")}`;
      return `<button type="button" class="mm-orbit-chip${t.hidden ? " hid" : ""}${t.getFlag(MODULE_ID, "orbitFrom")?.scene === here ? " home" : ""}" data-id="${t.id}" data-tooltip="${esc(tip)}">
        <img src="${esc(t.texture.src)}" alt=""><span>${esc(t.name)}</span></button>`;
    };
    const fight = inFight();
    if ( fight !== this.fight ) { this.fight = fight; this.key = ""; this.open = false; }
    this.el.classList.toggle("is-fight", fight);
    this.el.classList.toggle("is-open", fight && this.open);
    let html;
    if ( fight ) {
      // (folded: the globe and the count; the names in the tooltip; the list - portraits and "show the Orbit scene" - opens under it)
      const names = list.map((t) => esc(t.name)).join(", ");
      // fxn2 (U210): no tooltip on the button while its list is open (it covered the list); the portraits' tips go to the left
      this.headTip = T("fightTip", { names });
      html = `<button type="button" class="mm-orbit-head" data-toggle="1" aria-expanded="${this.open}" aria-label="${esc(T("head"))}: ${list.length}"${this.open ? "" : ` data-tooltip="${esc(this.headTip)}"`}><i class="fa-solid fa-earth-europe" inert></i><b>${list.length}</b></button>
        <div class="mm-orbit-list">${list.map(chip).join("").replaceAll('class="mm-orbit-chip', 'data-tooltip-direction="LEFT" class="mm-orbit-chip')}<button type="button" class="mm-orbit-view" data-view="1"><i class="fa-solid fa-arrow-right-to-bracket" inert></i><span>${esc(T("viewScene"))}</span></button></div>`;
    } else {
      html = `<button type="button" class="mm-orbit-head" data-view="1" data-tooltip="${esc(T("headTip"))}"><i class="fa-solid fa-earth-europe" inert></i>
      <span>${esc(T("head"))}</span><b>${list.length}</b></button>${list.map(chip).join("")}`;
    }
    // (written only when it changed: the tracker's renders refresh it often - a rewrite under the pointer would drop its tooltip)
    if ( html !== this.html ) { this.html = html; this.el.innerHTML = html; this.key = ""; }
    this.dock();
  },
  onClick(ev) {
    const b = ev.target.closest("button"); if ( !b ) return;
    ev.preventDefault();
    if ( b.dataset.toggle ) return void this.setOpen(!this.open);
    if ( this.fight ) this.setOpen(false);
    if ( b.dataset.view ) return void orbitScene()?.view();
    const t = orbitScene()?.tokens.get(b.dataset.id);
    if ( t && game.user.isGM ) bringBack(t, canvas.scene.id);
  },
  /** fxn2 (U210): open / close the folded button's list. Open: the button's tooltip goes (it lay over the list) and the list is placed
   *  clear of the bar and the panels (orbit-dock.mjs listSpot); closed: the tooltip comes back. */
  setOpen(open) {
    const el = this.el; if ( !el ) return;
    this.open = !!open;
    el.classList.toggle("is-open", this.open);
    const head = el.querySelector(".mm-orbit-head");
    if ( head ) {
      head.setAttribute("aria-expanded", String(this.open));
      if ( this.open ) { head.removeAttribute("data-tooltip"); try { if ( game.tooltip?.element === head ) game.tooltip.deactivate(); } catch { /* none */ } }
      else if ( this.fight && this.headTip ) head.dataset.tooltip = this.headTip;
    }
    this.placeList();
  },
  placeList() {
    const el = this.el, list = el?.querySelector(".mm-orbit-list");
    if ( !list || !this.fight || !this.open ) return;
    const lr = list.getBoundingClientRect(), hr = el.querySelector(".mm-orbit-head")?.getBoundingClientRect(), sr = el.getBoundingClientRect();
    if ( !hr || !(lr.width > 0) ) return;
    const at = listSpot({ x0: hr.left, y0: hr.top, x1: hr.right, y1: hr.bottom }, { w: lr.width, h: lr.height }, this.avoidBoxes(), this.barBox(this.bar), window.innerWidth, window.innerHeight);
    list.dataset.where = at.where;
    list.style.right = "auto";
    list.style.left = `${Math.round(at.x - sr.left)}px`;
    list.style.top = `${Math.round(at.y - sr.top)}px`;
  }
};

/* ---------------------------------------------------------------- Token HUD */

function onTokenHUD(hud, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const t = hud.object, doc = t?.document;
  if ( !root || !doc?.isOwner || !enabled() ) return;
  // going up is the altitude picker's "Orbit" (zones); only the way down needs a button of its own (the Orbit scene has no zones)
  if ( !isOrbit(doc.parent) ) return;
  const col = root.querySelector(".col.left") ?? root.querySelector(".left");
  if ( !col ) return;
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "control-icon mm-orbit-btn";
  // in orbit: come down - onto the map it came from (first), or any other map this user can see
  btn.innerHTML = `<i class="fa-solid fa-person-falling" inert></i>`;
  btn.dataset.tooltip = T("land");
  btn.addEventListener("click", (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const old = root.querySelector(".mm-orbit-pick"); if ( old ) return void old.remove();
    const home = doc.getFlag(MODULE_ID, "orbitFrom")?.scene;
    const maps = game.scenes.filter((s) => !isOrbit(s) && (game.user.isGM || s.visible || s.active || s.id === home)).sort((a, b) => (b.id === home) - (a.id === home) || (b.active - a.active) || a.name.localeCompare(b.name));
    const pick = document.createElement("div");
    pick.className = "mm-z-altpick mm-orbit-pick";
    pick.innerHTML = maps.slice(0, 30).map((s) => `<button type="button" data-scene="${s.id}"><i class="fa-solid ${s.id === home ? "fa-house" : s.active ? "fa-bullseye" : "fa-map"}" inert></i>
      <span><b>${esc(s.name)}</b><small>${esc(s.id === home ? T("home") : s.active ? T("active") : T("map"))}</small></span></button>`).join("");
    pick.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-scene]"); if ( !b ) return;
      e.preventDefault(); e.stopPropagation();
      pick.remove(); hud.close();
      await bringBack(doc, b.dataset.scene);
    });
    btn.after(pick);
  });
  col.append(btn);
}

/* ---------------------------------------------------------------- wiring */

export const orbitApi = { scene: orbitScene, ensure: ensureOrbitScene, regenerate, send: sendToOrbit, land: bringBack, isOrbit, refresh: () => strip.refresh() };

let readyCount = 0;
export function registerOrbit() {
  moduleApi.orbit = orbitApi;
  Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "orbit", { name: "MOINENMAPS.Orbit.setting", hint: "MOINENMAPS.Orbit.settingHint", scope: "world", config: true, type: Boolean, default: true, onChange: () => strip.refresh() });
    game.settings.register(MODULE_ID, "orbitFollow", { name: "MOINENMAPS.Orbit.follow", hint: "MOINENMAPS.Orbit.followHint", scope: "client", config: true, type: Boolean, default: true });
  });
  Hooks.once("ready", () => { const m = game.modules.get(MODULE_ID); if ( m ) { m.api ??= moduleApi; m.api.orbit ??= orbitApi; } setTimeout(sweep, 1500); });
  Hooks.on("canvasReady", () => { readyCount++; rememberMap(canvas.scene); back.refresh(); strip.refresh(); setTimeout(() => strip.refresh(), 1200); if ( isOrbit(canvas.scene) ) { const f = canvas.scene.getFlag(MODULE_ID, "orbit"); startAmbience(canvas.scene, f?.seed ?? 1, f?.layout ?? null, f); } });
  Hooks.on("canvasTearDown", () => { strip.remove(); back.remove(); stopAmbience(); });
  Hooks.on("createToken", onCreateToken);
  Hooks.on("updateToken", onUpdateToken);
  Hooks.on("deleteToken", (doc) => { if ( isOrbit(doc.parent) ) strip.refresh(); });
  // fxm2 (U201): a fight starting or ending on this map folds or unfolds the strip
  // (and the tracker's render: the combat a client views is settled only after the scene's canvasReady)
  for ( const h of ["combatStart", "deleteCombat", "createCombat", "renderCombatTracker"] ) Hooks.on(h, () => strip.refresh());
  Hooks.on("updateCombat", (c, changed) => { if ( "active" in changed || "scene" in changed || "round" in changed || "started" in changed ) strip.refresh(); });
  Hooks.on("updateScene", (scene, changed) => {
    if ( !isOrbit(scene) ) return;
    strip.refresh();
    // a new sky on the scene being looked at: the ambience stops at once (its clouds belong to the old planet) and starts again with the
    // canvas redrawn for the new picture - or, if no redraw comes (only the flag changed), on its own a moment later
    if ( changed.flags?.[MODULE_ID]?.orbit && canvas?.ready && canvas.scene?.id === scene.id ) {
      stopAmbience();
      const n = readyCount;
      setTimeout(() => {
        if ( readyCount !== n || !canvas?.ready || canvas.scene?.id !== scene.id ) return;
        const f = scene.getFlag(MODULE_ID, "orbit"); startAmbience(scene, f?.seed ?? 1, f?.layout ?? null, f);
      }, 2000);
    }
  });
  Hooks.on("renderTokenHUD", onTokenHUD);
}
