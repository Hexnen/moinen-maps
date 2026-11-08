/**
 * Orbit: one shared "Orbit" scene for the whole world. A token thrown (or flown) to orbit from any map really leaves that map and
 * appears there; every map shows, above its top edge, a strip of everyone in orbit, and a click brings a token down onto that map.
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
import { api as moduleApi } from "../attrs.mjs";
import { paintSpace, enlarge, lastLayout } from "./space.mjs";
import { startAmbience, stopAmbience } from "./orbit-ambience.mjs";

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
  await scene.setFlag(MODULE_ID, "orbit", { seed, v: 2, layout: layoutOf.get(seed) ?? null });
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
    return doc.setFlag(MODULE_ID, "orbitReq", { dir: "up", thrown: !!thrown, at: Date.now() });
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
    return doc.setFlag(MODULE_ID, "orbitReq", { dir: "down", scene: sceneId ?? null, alt, at: Date.now() });
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

/* ---------------------------------------------------------------- the strip above each map */

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

const strip = {
  el: null, key: "",
  remove() { this.el?.remove(); this.el = null; this.watch(false); },
  /** Follow the camera every frame it moves (canvasPan does not fire for every camera change): one cheap compare per tick. */
  tick: () => {
    const st = canvas?.stage; if ( !st || !strip.el ) return;
    const k = `${st.position.x.toFixed(1)},${st.position.y.toFixed(1)},${st.scale.x.toFixed(4)},${innerWidth},${innerHeight}`;
    if ( k !== strip.key ) { strip.key = k; strip.place(); }
  },
  watch(on) {
    const tk = canvas?.app?.ticker; if ( !tk ) return;
    tk.remove(this.tick);
    if ( on ) tk.add(this.tick);
  },
  refresh() {
    if ( !canvas?.ready || !canvas.scene || isOrbit(canvas.scene) || !enabled() ) return this.remove();
    const orbit = orbitScene();
    const list = orbit ? orbit.tokens.filter((t) => game.user.isGM || !t.hidden) : [];
    if ( !list.length ) return this.remove();
    if ( !this.el ) {
      this.el = document.createElement("div");
      this.el.id = "mm-orbit-strip";
      this.el.addEventListener("click", (ev) => this.onClick(ev));
      this.el.addEventListener("contextmenu", (ev) => { ev.preventDefault(); orbitScene()?.view(); });
      (document.getElementById("board") ?? document.body).after(this.el);
      this.watch(true);
    }
    const here = canvas.scene.id;
    const chip = (t) => {
      const from = game.scenes.get(t.getFlag(MODULE_ID, "orbitFrom")?.scene ?? "")?.name ?? "?";
      const tip = `${t.name} - ${T("fromMap", { map: from })}${t.isOwner ? `<br>${T("chipLand")}` : ""}`;
      return `<button type="button" class="mm-orbit-chip${t.isOwner ? " own" : ""}${t.hidden ? " hid" : ""}${t.getFlag(MODULE_ID, "orbitFrom")?.scene === here ? " home" : ""}" data-id="${t.id}" data-tooltip="${esc(tip)}">
        <img src="${esc(t.texture.src)}" alt=""><span>${esc(t.name)}</span></button>`;
    };
    this.el.innerHTML = `<button type="button" class="mm-orbit-head" data-view="1" data-tooltip="${esc(T("headTip"))}"><i class="fa-solid fa-earth-europe" inert></i>
      <span>${esc(T("head"))}</span><b>${list.length}</b></button>${list.map(chip).join("")}`;
    this.place();
  },
  /** Keep it on the map's top edge, sized with the map (within limits, so it stays readable zoomed out). */
  place() {
    if ( !this.el || !canvas?.ready ) return;
    const r = canvas.dimensions.sceneRect, p = canvas.clientCoordinatesFromCanvas({ x: r.x + r.width / 2, y: r.y });
    const k = Math.max(0.55, Math.min(1.5, (canvas.stage.scale.x * canvas.grid.size) / 100));
    // above the top edge; when the edge is at (or past) the top of the screen it stays on screen, just inside the map
    const top = Math.max(p.y, this.el.offsetHeight * k + 10);
    this.el.style.left = `${p.x}px`; this.el.style.top = `${top}px`;
    this.el.style.transform = `translate(-50%, calc(-100% - 6px)) scale(${k})`;
    this.el.style.transformOrigin = "50% 100%";
  },
  onClick(ev) {
    const b = ev.target.closest("button"); if ( !b ) return;
    ev.preventDefault();
    if ( b.dataset.view ) return void orbitScene()?.view();
    const t = orbitScene()?.tokens.get(b.dataset.id);
    if ( t?.isOwner ) bringBack(t, canvas.scene.id);
  }
};

/* ---------------------------------------------------------------- Token HUD */

function onTokenHUD(hud, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const t = hud.object, doc = t?.document;
  if ( !root || !doc?.isOwner || !enabled() ) return;
  const col = root.querySelector(".col.left") ?? root.querySelector(".left");
  if ( !col ) return;
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "control-icon mm-orbit-btn";
  if ( !isOrbit(doc.parent) ) {
    btn.innerHTML = `<i class="fa-solid fa-rocket" inert></i>`;
    btn.dataset.tooltip = T("throw");
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const life = moduleApi.zones?.hasLifeSupport?.(t.actor);
      if ( life === false ) ui.notifications.warn(game.i18n.format("MOINENMAPS.Zones.altNoLifeWarn", { name: t.name }));
      hud.close();
      await sendToOrbit(doc, { thrown: true });
    });
    col.append(btn);
    return;
  }
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
  Hooks.on("canvasReady", () => { readyCount++; rememberMap(canvas.scene); back.refresh(); strip.refresh(); if ( isOrbit(canvas.scene) ) { const f = canvas.scene.getFlag(MODULE_ID, "orbit"); startAmbience(canvas.scene, f?.seed ?? 1, f?.layout ?? null, f); } });
  Hooks.on("canvasTearDown", () => { strip.remove(); back.remove(); stopAmbience(); });
  Hooks.on("canvasPan", () => strip.place());
  window.addEventListener("resize", () => strip.place());
  Hooks.on("createToken", onCreateToken);
  Hooks.on("updateToken", onUpdateToken);
  Hooks.on("deleteToken", (doc) => { if ( isOrbit(doc.parent) ) strip.refresh(); });
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
