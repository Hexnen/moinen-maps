import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as Model from "./model.mjs";
import * as Geo from "./geometry.mjs";
import { ZoneDisplay, numeral } from "./display.mjs";
import { passageMarks } from "./place.mjs";
import { preset, presets, zonesText } from "./presets.mjs";
import * as Editor from "./editor.mjs";
import * as Styles from "./styles.mjs";
import * as Marks from "./marks.mjs";
import * as Link from "./link.mjs";
import * as Keys from "./keys.mjs";
import * as Places from "./places.mjs";
import * as Borders from "./borders.mjs";
import * as States from "./states.mjs";
import * as Moves from "./moves.mjs";
import { quake, stopQuakes } from "./quake.mjs";
import * as FireMod from "../fire/fire.mjs";
import * as WaterMod from "../water/water.mjs";
import * as DestMod from "../destruction/destruction.mjs";
import { interactApi, registerInteract } from "./interact.mjs";
import { boardApi, registerBoard, flashToken } from "./board.mjs";

/**
 * Zones of the open scene. The GM draws loose pencil lines (scripts/zones/editor.mjs); every area the lines close off is a zone
 * (scripts/zones/geometry.mjs). Zones count movement the Year Zero way: the distance between two tokens is the number of zone
 * borders on the shortest route. The scene's preset (scripts/zones/presets.mjs) says what a distance costs: the badges of a selected
 * token's surroundings and the token ruler's label show it.
 *
 * Inside the Zones workspace section the GM sees the raw pencil lines; everywhere else (and for players) only the finished zones.
 * Public API: `game.modules.get("moinen-maps").api.zones`. Hook "moinenMapsZones" with ("loaded" | "edited" | "params" | "section").
 *
 * For other modules (a combat engine): stable zone keys (keys.mjs), places in three dimensions, the two distances, routes and
 * borders as data (places.mjs), and the hook "moinenMapsZoneEvent" (type, payload) - a token entered / left a zone, a zone's or a
 * border's state changed. All of it is described in dev/zones-api.md.
 *
 * Package M2 (same file, "play state" and "movement" below): borders as a wall with an optional door, each with its own Armor and
 * state (borders.mjs); the zone-state registry and temporary edges (states.mjs); a write path for the active GM's client where
 * every write returns its inverse (`apply`); movement from a mover profile, a listener asked before every step of a move, group
 * and forced moves, free spots, cost confirmation on a dragged token (moves.mjs). The map stores, reports and draws; what a state,
 * a wall or a step DOES to a character is the combat module's.
 */

let wreckedBefore = null;   // the zones wrecked at the last relink (null: just loaded - nothing quakes)
let S = null, Z = null, M = null, M0 = null, LS = null, MAP = new Map(), linkTimer = 0, display = null, saveTimer = 0, inSection = false, hover = -1, hoverRaf = 0, hoverAt = null;
let saveSceneId = null, lastSaved = "";
// K: the zones' stable keys now (keys.mjs resolve); ver: counts every change of the zones or their marks (what caches hang on);
// QC: the lookups of this state (places.mjs makeCache); TP: token id -> { stamp, place }; LAST: token id -> the place last told;
// SNAP: the zone and border states last told
// RS: the registry's states laid onto the zones (zone id -> [state]); ED: the temporary edges that join zones now ({ live, links })
let K = null, ver = 0, QC = null, SNAP = null, RS = new Map(), ED = { live: [], links: new Map() }, GR = null;
const TP = new Map(), LAST = new Map();
export const EVENT_HOOK = "moinenMapsZoneEvent";
const undo = [], redo = [];
const UNDO_MAX = 60;

export const tell = (kind) => Hooks.callAll("moinenMapsZones", kind);
export const state = () => S;
export const zones = () => Z;
/** The marks laid onto the zones now: { borders: Map pair -> {kind, x, y, a, b}, zones: Map id -> props } - the GM's own marks with what
 *  the map's layers say on top (link.mjs). `ownMarks` only the GM's, `mapStates` only the layers' (id -> props). */
export const marks = () => M;
export const ownMarks = () => M0;
export const mapStates = () => MAP;
/** A zone's name as the map writes it (1, I or A: the look's numeral format). */
export const zoneName = (id) => numeral(id + 1, look()?.numFormat ?? "arabic");
/** The numeral format the map writes zone numbers in now: "arabic" | "padded" | "roman" | "letters" | "kanji". */
export const numberFormat = () => look()?.numFormat ?? "arabic";
/** A number as the map writes zone numbers (`format`: one of Model.NUM_FORMATS; default: the format in force). null: not a number from 1. */
export const numeralOf = (n, format = null) => { const v = Math.floor(Number(n)); return Number.isFinite(v) && v >= 1 ? numeral(v, Model.NUM_FORMATS.includes(format) ? format : numberFormat()) : null; };
export const editing = () => inSection && !!game.user?.isGM;
export const gridSize = () => canvas.dimensions?.size ?? canvas.grid?.size ?? 100;
const sceneRect = () => { const r = canvas.dimensions?.sceneRect; return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; };

/* ---------------------------------------------------------------- settings */

function registerSettings() {
  const R = (k, type, def, onChange) => game.settings.register(MODULE_ID, k, { scope: "client", config: false, type, default: def, onChange });
  R("zonesDistances", Boolean, true, () => { refresh(); tell("params"); });
  R("zonesEraser", Number, 0.5, () => tell("params"));
  R("zonesRuler", Boolean, true, () => tell("params"));
  R("zonesQuake", Boolean, true);
  // world defaults: look presets saved by the GM, the default look preset and movement preset (scenes may pick their own)
  const W = (k, type, def) => game.settings.register(MODULE_ID, k, { scope: "world", config: false, type, default: def, onChange: () => { refresh(); tell("params"); } });
  W("zonesStyles", Object, { list: [] });
  W("zonesStyleDefault", String, "classic");
  W("zonesPresetDefault", String, "invincible");
  // zone states read from the fire, destruction and water layers (and fires of the zones painted on the fire layer)
  game.settings.register(MODULE_ID, "zonesLink", { scope: "world", config: false, type: Boolean, default: true, onChange: () => { relink(); refresh(); tell("params"); announce("layers"); } });
}
export const setting = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };

/** The look in force on this scene: its own ("custom"), a look preset it picked, or the world's default; "who" is always its own. */
export function look() {
  if ( !S ) return null;
  const from = S.lookFrom ?? Styles.worldStyle();
  if ( from === "custom" ) return S.look;
  const st = Styles.style(from) ?? Styles.style("classic");
  return Model.cleanLook({ ...st.look, who: S.look.who });
}
/** The movement preset in force: the scene's own pick or the world's default. */
export function movePreset() {
  const id = S?.preset ?? Styles.worldPreset();
  return preset(id) ? id : "invincible";
}

/* ---------------------------------------------------------------- the zones of the lines */

/**
 * PERF (perf-arrival, 2026-11-09): the zones worked out from the same lines are the same (buildZones is pure, its result is never
 * changed): the last few are kept by their input, with their sample points, so a scene seen before in this session skips the geometry
 * in its canvasReady (street: ~20 ms in node, x2-4 on a slow client).
 */
const built = new Map(), BUILT_MAX = 6;
function rebuild() {
  const g = gridSize();
  // smoothing works on screen-sized steps of the line (scene pixels), so it looks the same on small- and large-grid maps
  const step = Math.max(3, Math.min(g * 0.15, 12));
  const edge = sceneRect();
  const key = S && S.strokes.size ? JSON.stringify([g, step, S.smooth, S.snap, edge, [...S.strokes.values()]]) : null;
  let hit = key ? built.get(key) : null;
  if ( hit ) { built.delete(key); built.set(key, hit); Z = hit.Z; }
  else {
    const lines = S ? [...S.strokes.values()].map((p) => Geo.smoothLine(p, S.smooth, step)) : [];
    // a zone is at least one grid square; the scene's edge closes zones where lines reach it
    Z = S && S.strokes.size ? Geo.buildZones(lines, { snap: S.snap * g, merge: 0.5, minArea: g * g, edge }) : null;
    if ( key ) { built.set(key, hit = { Z, LS: null }); if ( built.size > BUILT_MAX ) built.delete(built.keys().next().value); }
  }
  // walls and zone marks keep to the border / zone their point lies on, whatever the zones are numbered now
  LS = hit?.LS ?? null;
  remark();
  if ( hit && LS && hit.Z === Z ) hit.LS = LS;
}
/**
 * The marks, keys, registry states and edges laid onto the zones as they are (no geometry is worked out again). `readLayers` false:
 * what the map's layers show is kept as it was read last (a change of play state does not change the layers).
 */
function remark(readLayers = true) {
  M0 = Marks.resolve(Z, S?.walls, S?.marks, zoneAtNow, markTol(), S?.plays);
  K = Keys.resolve(Z, S?.keys, S?.keyNext, zoneAtNow);
  RS = Z ? States.resolveStates(S?.states, zoneAtNow) : new Map();
  ED = Z ? States.resolveEdges(S?.edges, (key) => K.idOf.get(key) ?? -1) : { live: [], links: new Map() };
  relink(readLayers);
}

/* ---------------------------------------------------------------- states from the map's layers (fire, destruction, water) */

/** What the layers hold now, in the form link.mjs reads. */
function layers() {
  const rect = canvas.dimensions?.sceneRect ?? { x: 0, y: 0 };
  let fire = null, water = null, dest = null;
  try { fire = FireMod.list(); } catch {}
  try { const w = WaterMod.state(); if ( w?.masks && w.enabled !== false ) water = { px: w.px, w: w.w, h: w.h, masks: w.masks, rect }; } catch {}
  try { const d = DestMod.state(); if ( d?.mask ) dest = { mask: d.mask, mw: d.mw, mh: d.mh, mpx: d.mpx, rect }; } catch {}
  return { fire, water, dest };
}
export const linkOn = () => setting("zonesLink", true) !== false;
/** The GM's marks with the layers' states on top. */
function relink(readLayers = true) {
  ver++;
  if ( readLayers ) MAP = new Map();
  if ( readLayers && Z && linkOn() ) {
    LS ??= Link.samplesOf(Z, (x, y) => Geo.zoneAt(Z, x, y), gridSize() / 4);
    try { MAP = Link.derive(LS, layers()); } catch ( err ) { console.warn(`${MODULE_ID} | zones: reading the layers`, err); }
  }
  const zones = new Map(M0?.zones ?? []);
  // the registry's states that the map knows how to show read as zone properties (states.mjs propsOf)
  for ( const [id, recs] of RS ) { const p = States.propsOf(recs); if ( Object.keys(p).length ) zones.set(id, States.mergeProps(zones.get(id), p)); }
  for ( const [id, p] of MAP ) zones.set(id, Link.merge(zones.get(id), p));
  M = { borders: M0?.borders ?? new Map(), zones };
  // a zone that has just become wrecked quakes (on every client: each one sees the marks or the layer change)
  // (remembered as scene points, not zone ids: editing the lines renumbers the zones; at most 3 at once, only where zones show)
  const wrecked = [...zones].filter(([, p]) => p?.wrecked).map(([id]) => id);
  if ( wreckedBefore && Z && setting("zonesQuake", true) !== false && visibleToMe() ) {
    const was = new Set(wreckedBefore.map(([x, y]) => Geo.zoneAt(Z, x, y)));
    let n = 0;
    for ( const id of wrecked ) if ( !was.has(id) && n < 3 ) {
      const z = Z.zones.find((q) => q.id === id);
      if ( z ) { n++; quake(z, { grid: gridSize(), inside: (x, y) => Geo.zoneAt(Z, x, y) === id }); }
    }
  }
  wreckedBefore = Z ? wrecked.map((id) => Z.zones.find((q) => q.id === id)?.label).filter(Boolean).map((l) => [l.x, l.y]) : null;
}
/** A layer changed: read it again (debounced: a stroke may fire several hooks). */
function onLayer(kind) {
  if ( !S || !["edited", "loaded", "gone"].includes(kind) ) return;
  clearTimeout(linkTimer);
  linkTimer = setTimeout(() => {
    linkTimer = 0;
    if ( !S ) return;
    // PERF (ultra1-zones): fire, smoke, dust and destruction change many times a second under heavy use, the zone states they give
    // seldom do: when the layers say the same as before, nothing to draw or tell (the marks M are made again only from the same parts)
    const before = mapKey(MAP), Mb = M, vb = ver;
    relink();
    if ( Mb && mapKey(MAP) === before ) { M = Mb; ver = vb; return; }
    refresh(); tell("linked"); announce("layers");
  }, 150);
}
const mapKey = (m) => JSON.stringify([...m]);

/** The burning fire strokes that lie (mostly) in a zone: their ids. A stroke reaching into other zones stays unless half of it is here. */
function fireStrokesIn(id) {
  if ( !LS ) return [];
  const fire = (() => { try { return FireMod.list(); } catch { return []; } })();
  const here = Link.fireIn(LS.get(id) ?? [], fire);
  if ( !here.length ) return [];
  const total = new Map();
  for ( const pts of LS.values() ) for ( const f of Link.fireIn(pts, here.map((h) => h.s)) ) total.set(f.s.id, (total.get(f.s.id) ?? 0) + f.hits);
  return here.filter((h) => h.hits / (total.get(h.s.id) || 1) >= 0.5).map((h) => h.s.id);
}
/** Put out the fire painted in a zone (the fire layer lets it sink and smoke away). `kept` (a list): the strokes as they were, added. */
function putOutMap(id, kept = null) { return putOutStrokes(fireStrokesIn(id), kept); }
/** Put out strokes of the fire layer by id; `kept` (a list) gets the records of the ones that went, as they were before. -> how many */
function putOutStrokes(ids, kept = null) {
  if ( !ids.length ) return 0;
  try {
    const want = new Set(ids), recs = kept ? FireMod.list().filter((s) => want.has(s.id)).map(copy) : null;
    const n = FireMod.remove(ids);
    if ( n && recs ) kept.push(...recs);
    return n;
  } catch { return 0; }
}
/** Paint a fire into a zone on the fire layer: one blob around its middle, its level from the Intensity. */
function paintMap(id, intensity) {
  const z = Z?.zones.find((q) => q.id === id), api = moduleApi.fire;
  if ( !z || !api?.paint ) return null;
  try { return api.paint([[Math.round(z.label.x), Math.round(z.label.y)]], { radius: Math.round(Math.max(gridSize() * 0.4, Math.min(z.label.r * 0.85, gridSize() * 1.3))), level: intensity >= 10 ? 3 : intensity >= 8 ? 2 : 1, smoke: 2 }); }
  catch ( err ) { console.warn(`${MODULE_ID} | zones: painting fire`, err); return null; }
}
const markTol = () => gridSize() * 0.35;

/**
 * One language of zones for the table (dev/zones-api.md 31), per client until reload: what a combat module asks the zones to
 * show while it runs, on top of the scene's look - `numbers: "always"` (every zone carries its number badge, whatever the look
 * says), `distances: false` (no distance badges or bands around a selected token: a badge is always the zone's number),
 * `show: true` (the zones show on this client even where the scene keeps them to the GM).
 *   present({ numbers, distances, show })     present(null): as the scene says     present(): what is in force (or null)
 */
let PRESENT = null;
export function present(o) {
  if ( o === undefined ) return PRESENT ? { ...PRESENT } : null;
  const next = o && typeof o === "object" ? { numbers: ["always", "hover", "never"].includes(o.numbers) ? o.numbers : null, distances: o.distances === false ? false : null, show: o.show === true } : null;
  const none = !next || (next.numbers == null && next.distances == null && !next.show);
  if ( JSON.stringify(none ? null : next) === JSON.stringify(PRESENT) ) return present();
  PRESENT = none ? null : next;
  altBadges(); refresh(); tell("params");
  return present();
}
/** The look as it is drawn on this client: the look in force with what present() asks on top. */
const shownLook = () => { const l = look(); return l && PRESENT?.numbers ? { ...l, numbers: PRESENT.numbers } : l; };

/** Who sees the finished zones: always the GM drawing them, else as the scene says. */
export function visibleToMe() {
  if ( !S || !Z ) return false;
  if ( editing() ) return true;
  if ( PRESENT?.show ) return true;
  const who = look().who;
  return who === "all" || (who === "gm" && game.user.isGM);
}

/** The one token selected (and owned) on this client, or null. */
function selectedToken() {
  const c = canvas.tokens?.controlled ?? [];
  return c.length === 1 && c[0].isOwner ? c[0] : null;
}

/**
 * Where a token document stands: its stored position. While a move plays, Foundry v14 slides the document's own x / y along
 * with the picture (they pass through other zones on the way), so everything that asks "where is it" reads the stored one.
 */
const sx = (d) => d._source?.x ?? d.x, sy = (d) => d._source?.y ?? d.y;
/** A token's centre where it stands (its document, not the animation). */
export function tokenCenter(t) {
  const d = t.document, g = gridSize();
  return { x: sx(d) + (d.width * g) / 2, y: sy(d) + (d.height * g) / 2 };
}

export function movesOf(actor) {
  const p = preset(movePreset());
  try { return p?.moves(actor) ?? []; } catch { return []; }
}

/** Draw again: the zones, and the distances around the selected token. */
export function refresh() {
  if ( !display ) return;
  display.visible = visibleToMe();
  if ( !display.root.visible ) return;
  let dist = null, bands = null, here = -1;
  const t = setting("zonesDistances", true) && DRIVER?.distances !== false && PRESENT?.distances !== false ? selectedToken() : null;
  // Sky High and Orbit are off the map (one zone of their own): no distances on the map from there
  if ( t && Z && !Places.AREAS.includes(rawAlt(t.document)) ) {
    const c = tokenCenter(t);
    here = Geo.zoneAt(Z, c.x, c.y);
    if ( here >= 0 ) {
      // each way of moving counts its own route past the walls (marks.mjs); the preset picks the cheapest and says what it costs
      const D = Places.movesFrom(cache(), here), p = preset(movePreset()), moves = movesOf(t.actor);
      // a token up on a floor (or on the roof of a building with floors) walks down first
      const v = Marks.vertical(M, here, t.document.getFlag(MODULE_ID, "floor"), altOf(t.document));
      dist = new Map(); bands = p ? new Map() : null;
      for ( const z of Z.zones ) {
        const dd = z.id === here ? Marks.distancesTo(D, z.id) : Marks.addVertical(Marks.distancesTo(D, z.id), v), b = p?.band(dd, moves);
        if ( b ) { bands.set(z.id, b); if ( b.d != null ) dist.set(z.id, b.d); }
        else if ( dd.walk != null ) dist.set(z.id, dd.walk);
      }
    }
  }
  display.hoverId = hover;
  display.render(Z, shownLook(), gridSize(), { dist, bands, here, hover, editing: editing(), zoom: canvas.stage.scale.x, marks: M, terrainText: wreckText, passages: passages() });
}
/** The passages (temporary edges) as the display marks them: every end that lies in a zone of the map now. */
function passages() {
  if ( !S?.edges.length || !Z ) return null;
  const byId = new Map(Z.zones.map((z) => [z.id, z]));
  return passageMarks(S.edges, (key) => K.idOf.get(key) ?? -1, (id) => byId.get(id)?.label ?? null);
}
/** What sits on the zones now (badges, icon rows, passage marks), as boxes in scene pixels (display.mjs boxes): for the highlights' labels. */
export const displayBoxes = () => display?.boxes() ?? [];

/* ---------------------------------------------------------------- numbers on hover */

/** The zone under the cursor (numbers "hover", border highlight): one check per frame at most, a redraw only when it changes. */
function onHoverMove(ev) {
  const L = shownLook();
  if ( !(L?.numbers === "hover" || L?.hoverHi) || !display?.root.visible ) return;
  hoverAt = { x: ev.clientX, y: ev.clientY };
  if ( hoverRaf ) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    if ( !hoverAt || !canvas.ready ) return;
    const p = canvas.canvasCoordinatesFromClient(hoverAt);
    setHover(Geo.zoneAt(Z, p.x, p.y));
  });
}
// numbers on hover need the badges again; the highlight alone only redraws its own layer
function setHover(id) { if ( id === hover ) return; hover = id; if ( shownLook()?.numbers === "hover" ) refresh(); else display?.drawHover(id); }
const onHoverLeave = () => { hoverAt = null; if ( hover >= 0 ) setHover(-1); iconTip(null); };

/** What a zone icon means, shown next to the cursor while it rests on the icon. */
let tipEl = null, tipRaf = 0, tipAt = null;
function onIconMove(ev) {
  if ( !display?.root.visible || !(M?.zones.size || S?.edges.length) ) { if ( tipEl ) iconTip(null); return; }
  tipAt = { x: ev.clientX, y: ev.clientY };
  if ( tipRaf ) return;
  tipRaf = requestAnimationFrame(() => {
    tipRaf = 0;
    if ( !tipAt || !display ) return;
    const r = canvas.app.view.getBoundingClientRect();
    iconTip(display.iconAt(tipAt.x - r.left, tipAt.y - r.top), tipAt);
  });
}
function iconTip(hit, at) {
  if ( !hit ) { tipEl?.remove(); tipEl = null; return; }
  const p = M?.zones.get(hit.z.id) ?? {}, ZL = (k) => game.i18n.localize(`MOINENMAPS.Zones.${k}`);
  const text = hit.key === "passage" ? `${States.EDGE_KINDS.includes(hit.pass.kind) ? ZL(`edge.kind.${hit.pass.kind}`) : hit.pass.kind} ↔ ${spotText(hit.end.far)}`
    : hit.key === "fire" ? `${ZL("state.fire")}: ${p.fire}`
    : hit.key === "terrain" ? `${ZL("terrain.label")}: ${ZL(`terrain.${p.terrain}`)}${wreckText(p.terrain) && p.terrain !== "none" ? ` (${wreckText(p.terrain)})` : ""}`
    : hit.key === "building" && p.floors && !p.wrecked ? `${ZL("feat.building")} · ${game.i18n.format("MOINENMAPS.Zones.floorsTip", { n: p.floors + 1 })}`
    : ZL(Marks.FEATURES.includes(hit.key) ? `feat.${hit.key}` : `state.${hit.key}`);
  if ( !tipEl ) { tipEl = document.createElement("div"); tipEl.className = "mm-z-tip"; document.body.append(tipEl); }
  tipEl.textContent = `${zoneName(hit.z.id)} · ${text}`;
  tipEl.style.left = `${at.x + 14}px`; tipEl.style.top = `${at.y + 16}px`;
}

/** A spot in words: "Zone 5", "Zone 5, elevated", an off-map area, or a zone that is gone. */
function spotText(spot) {
  const [k, lvl] = String(spot ?? "").split(":"), ZL = (key) => game.i18n.localize(`MOINENMAPS.Zones.${key}`);
  if ( k[0] === "@" ) return ZL(`area.${k.slice(1)}`);
  const id = K?.idOf.get(k) ?? -1;
  const where = id >= 0 ? game.i18n.format("MOINENMAPS.Zones.zone.title", { n: zoneName(id) }) : ZL("edge.gone");
  return lvl ? `${where}, ${/^fd+$/.test(lvl) ? game.i18n.format("MOINENMAPS.Zones.floorN", { n: lvl.slice(1) }) : ZL(`reg.at.${lvl}`)}` : where;
}

/* ---------------------------------------------------------------- lifecycle */

function onCanvasReady() {
  teardown();
  if ( !canvas.scene ) return;
  S = Model.load(canvas.scene);
  lastSaved = JSON.stringify(Model.encode(S));
  display = new ZoneDisplay();
  hover = -1;
  canvas.app.view.addEventListener("pointermove", onHoverMove, { passive: true });
  canvas.app.view.addEventListener("pointerleave", onHoverLeave);
  canvas.app.view.addEventListener("pointermove", onIconMove, { passive: true });
  rebuild(); refresh();
  Editor.onCanvasReady();
  tell("loaded");
  prime();
}

function teardown() {
  flushSave();
  clearTimeout(saveTimer); saveTimer = 0;
  Editor.teardown();
  canvas.app?.view?.removeEventListener("pointermove", onHoverMove);
  canvas.app?.view?.removeEventListener("pointerleave", onHoverLeave);
  canvas.app?.view?.removeEventListener("pointermove", onIconMove);
  cancelAnimationFrame(tipRaf); tipRaf = 0; iconTip(null);
  cancelAnimationFrame(hoverRaf); hoverRaf = 0; hoverAt = null; hover = -1;
  display?.destroy(); display = null;
  clearTimeout(linkTimer); linkTimer = 0;
  S = Z = M = M0 = LS = K = QC = SNAP = GR = null; MAP = new Map(); RS = new Map(); ED = { live: [], links: new Map() }; wreckedBefore = null; stopQuakes();
  TP.clear(); LAST.clear();
  undo.length = redo.length = 0;
}

function onUpdateScene(scene, changed, _o, userId) {
  if ( scene.id !== canvas.scene?.id || !S ) return;
  const f = changed.flags?.[MODULE_ID];
  if ( !f || !(Model.FLAG in f || `-=${Model.FLAG}` in f) ) return;
  if ( userId === game.user.id ) return;
  S = Model.load(scene);
  lastSaved = JSON.stringify(Model.encode(S));
  rebuild(); refresh(); tell("loaded"); announce("sync");
}

/* ---------------------------------------------------------------- editing (GM) */

const snapshot = () => JSON.stringify(Model.encode(S));
// (the play state - border states, registry states, edges - is not the editor's to undo: it stays as it is now)
const restore = (text) => {
  const now = S;
  S = Model.load({ flags: { [MODULE_ID]: { [Model.FLAG]: JSON.parse(text) } } });
  if ( now ) for ( const k of Model.PLAY_FIELDS ) S[k] = now[k];
};

/**
 * Change the lines: `fn(strokes, S)` edits a copy (a Map id -> points) and returns true when it changed something. One undo step.
 */
export function edit(fn) {
  if ( !game.user.isGM || !S ) return false;
  const before = snapshot();
  const next = Model.canonical(S);
  // the zones as they are keep their keys through whatever this edit does to the lines (keys.mjs)
  pinKeys(next);
  if ( !fn(next.strokes, next) ) return false;
  undo.push(before); if ( undo.length > UNDO_MAX ) undo.shift();
  redo.length = 0;
  S = Model.canonical(next);
  rebuild(); pinKeys(S); refresh(); scheduleSave(); tell("edited"); announce("edit");
  return true;
}

/** Write the keys of the zones as they are now into a state (GM; saved with it). */
function pinKeys(st) {
  if ( !Z ) return;
  const r = Keys.pin(Z, st.keys, st.keyNext, zoneAtNow);
  st.keys = r.anchors; st.keyNext = r.next;
  if ( st === S ) K = Keys.resolve(Z, S.keys, S.keyNext, zoneAtNow);
}

export function undoEdit() { const s = undo.pop(); if ( !s || !S ) return false; redo.push(snapshot()); restore(s); rebuild(); refresh(); scheduleSave(); tell("edited"); announce("edit"); return true; }
export function redoEdit() { const s = redo.pop(); if ( !s || !S ) return false; undo.push(snapshot()); restore(s); rebuild(); refresh(); scheduleSave(); tell("edited"); announce("edit"); return true; }
export const canUndo = () => undo.length > 0;
export const canRedo = () => redo.length > 0;

/** A new pencil line. */
export function addStroke(pts) {
  if ( !Array.isArray(pts) || pts.length < 4 ) return false;
  return edit((st, s) => { st.set(s.next++, pts.slice()); return true; });
}

/** Cut the lines along an eraser trail of radius r (scene pixels): every piece of line within r goes, the rest stays as pieces. */
export function eraseAlong(trail, r) {
  return edit((st, s) => {
    let changed = false;
    const near = (x, y) => {
      if ( trail.length === 2 ) return Math.hypot(x - trail[0], y - trail[1]) <= r;
      for ( let i = 2; i < trail.length; i += 2 ) {
        const ax = trail[i - 2], ay = trail[i - 1], bx = trail[i], by = trail[i + 1];
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
        const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
        if ( Math.hypot(x - ax - dx * t, y - ay - dy * t) <= r ) return true;
      }
      return false;
    };
    const step = Math.max(1, r / 3);
    for ( const [id, p] of [...st] ) {
      // densify, so a cut lands within a third of the eraser of where it was meant
      const d = [p[0], p[1]];
      for ( let i = 2; i < p.length; i += 2 ) {
        const ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
        for ( let k = 1; k <= n; k++ ) d.push(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
      }
      const pieces = []; let cur = [], hit = false;
      for ( let i = 0; i < d.length; i += 2 ) {
        if ( near(d[i], d[i + 1]) ) { hit = true; if ( cur.length >= 4 ) pieces.push(cur); cur = []; }
        else cur.push(d[i], d[i + 1]);
      }
      if ( cur.length >= 4 ) pieces.push(cur);
      if ( !hit ) continue;
      changed = true;
      st.delete(id);
      for ( const q of pieces ) st.set(s.next++, Geo.simplify(q, 0.6));
    }
    return changed;
  });
}

/** Trim: keep only the lines that bound zones (everything sticking out goes). */
export function trim() {
  if ( !Z ) return false;
  // a line that ends on the map's edge is pushed a little past it, so it still meets the edge after the flag's rounding
  const r = sceneRect(), out = (p) => {
    if ( !r ) return p;
    for ( const i of [0, p.length - 2] ) {
      if ( Math.abs(p[i] - r.x) < 1 ) p[i] = r.x - 2; else if ( Math.abs(p[i] - r.x - r.width) < 1 ) p[i] = r.x + r.width + 2;
      if ( Math.abs(p[i + 1] - r.y) < 1 ) p[i + 1] = r.y - 2; else if ( Math.abs(p[i + 1] - r.y - r.height) < 1 ) p[i + 1] = r.y + r.height + 2;
    }
    return p;
  };
  const core = Z.core.map((p) => out(Geo.simplify(p, 0.3))).filter((p) => p.length >= 4);
  return edit((st, s) => {
    const before = JSON.stringify([...st.values()]);
    st.clear();
    for ( const p of core ) st.set(s.next++, p);
    return JSON.stringify([...st.values()]) !== before;
  });
}

export const clearAll = () => edit((st) => { if ( !st.size ) return false; st.clear(); return true; });

/**
 * Scene settings: preset (movement; null / "" = the world's default), lookFrom (null / "" = world default, a look preset id, "custom"),
 * snap, smooth, look. Changing the look (other than who sees it) while following a preset turns this scene's look into its own copy.
 */
export function setParams(patch) {
  if ( !game.user.isGM || !S ) return;
  const next = Model.canonical(S);
  if ( "preset" in patch && (!patch.preset || preset(patch.preset)) ) next.preset = patch.preset || null;
  if ( "lookFrom" in patch && (!patch.lookFrom || patch.lookFrom === "custom" || Styles.style(patch.lookFrom)) ) {
    // switching to its own look starts from the look it shows now
    if ( patch.lookFrom === "custom" && next.lookFrom !== "custom" ) next.look = Model.cleanLook({ ...look(), who: next.look.who });
    next.lookFrom = patch.lookFrom || null;
  }
  if ( patch.smooth != null ) next.smooth = Math.min(1, Math.max(0, Number(patch.smooth) || 0));
  if ( patch.snap != null ) next.snap = Math.min(Model.LIMITS.snap[1], Math.max(Model.LIMITS.snap[0], Number(patch.snap) || 0));
  if ( patch.look ) {
    const own = Object.keys(patch.look).some((k) => k !== "who");
    if ( own && next.lookFrom !== "custom" ) { next.look = Model.cleanLook({ ...lookOf(next), who: next.look.who }); next.lookFrom = "custom"; }
    next.look = Model.cleanLook({ ...next.look, ...patch.look });
  }
  if ( JSON.stringify(Model.encode(next)) === snapshot() ) return;
  const snapChanged = next.snap !== S.snap || next.smooth !== S.smooth;
  // joining and smoothing move the zones' outlines: their keys are written down first, and again for what comes out
  if ( snapChanged ) pinKeys(next);
  S = Model.canonical(next);
  if ( snapChanged ) { rebuild(); pinKeys(S); }
  refresh(); scheduleSave(); tell("params");
  if ( snapChanged ) announce("edit");
}

function lookOf(st) { const keep = S; S = st; try { return look(); } finally { S = keep; } }

function scheduleSave(ms = 400) {
  clearTimeout(saveTimer);
  saveSceneId = canvas.scene?.id ?? null;
  saveTimer = setTimeout(() => { saveTimer = 0; save(); }, ms);
}

export async function save() {
  if ( !game.user.isGM || !S ) return;
  const scene = game.scenes.get(saveSceneId) ?? canvas.scene;
  if ( !scene ) return;
  const payload = Model.encode(S), text = JSON.stringify(payload);
  if ( text === lastSaved ) return;
  lastSaved = text;
  try { await scene.update({ [`flags.${MODULE_ID}.${Model.FLAG}`]: payload }); }
  catch ( err ) { lastSaved = ""; console.warn(`${MODULE_ID} | could not save the zones`, err); }
}

function flushSave() { if ( !saveTimer ) return; clearTimeout(saveTimer); saveTimer = 0; save(); }

/* ---------------------------------------------------------------- the section (raw lines inside, finished zones outside) */

export function setInSection(on) {
  on = !!on;
  if ( on === inSection ) return;
  inSection = on;
  refresh(); Editor.redraw(); tell("section");
}

/* ---------------------------------------------------------------- the token ruler: distance in zones */

/**
 * Zones between the explicit waypoints of a token's move, each leg counted on the shortest route; null when a point lies outside
 * every zone (the ruler then keeps its own label).
 */
function legsInZones(waypoint) {
  const pts = [];
  for ( let w = waypoint; w; w = w.previous ) if ( w === waypoint || w.explicit || !w.previous ) pts.unshift(w.center);
  const tot = { walk: 0, air: 0, through: 0, swim: 0, swing: 0 };
  for ( let i = 1; i < pts.length; i++ ) {
    const a = Geo.zoneAt(Z, pts[i - 1].x, pts[i - 1].y), b = Geo.zoneAt(Z, pts[i].x, pts[i].y);
    if ( a < 0 || b < 0 ) return null;
    const dd = Marks.distancesTo(Places.movesFrom(cache(), a), b);
    for ( const k in tot ) tot[k] = tot[k] == null || dd[k] == null ? undefined : tot[k] + dd[k];
  }
  return tot;
}

function patchRuler() {
  const cls = CONFIG.Token?.rulerClass;
  const proto = cls?.prototype;
  if ( !proto || typeof proto._getWaypointLabelContext !== "function" || proto._mmZones ) return;
  const orig = proto._getWaypointLabelContext;
  proto._mmZones = true;
  proto._getWaypointLabelContext = function(waypoint, state) {
    const ctx = orig.call(this, waypoint, state);
    try {
      if ( !ctx || !Z || !setting("zonesRuler", true) || DRIVER?.distances === false || !visibleToMe() || !waypoint.previous ) return ctx;
      const dd = legsInZones(waypoint);
      if ( dd == null ) return ctx;
      const band = preset(movePreset())?.band(dd, movesOf(this.token?.actor));
      const n = band ? band.d : dd.walk;
      const total = n == null ? game.i18n.localize("MOINENMAPS.Zones.noWay") : zonesText(n);
      ctx.cost = { total, units: band?.cost && n != null ? `· ${band.cost}` : "" };
      ctx.distance = { total };
      ctx.cssClass = `${ctx.cssClass ?? ""} mm-zones-label`;
    } catch ( err ) { console.warn(`${MODULE_ID} | zones ruler label`, err); }
    return ctx;
  };
}

/* ---------------------------------------------------------------- marks: walls, zone features and states (GM) */

const pairAt = (x, y) => { const nb = Marks.nearestBorder(Z, x, y, markTol()); return nb ? Marks.pairKey(nb.a, nb.b) : null; };

/** The border between two zones near a scene point (`tol` scene px), with its kind: { a, b, x, y, kind } or null. */
export function borderAt(x, y, tol = markTol()) {
  const nb = Marks.nearestBorder(Z, x, y, tol);
  if ( !nb ) return null;
  // (kind: the border as built, what the menu marks; now: what it amounts to at the moment - borders.mjs)
  const m = M?.borders.get(Marks.pairKey(nb.a, nb.b));
  return { ...nb, kind: m?.base ?? m?.kind ?? "open", now: m?.kind ?? "open", ...Borders.partsOf(m?.wall ? m : null) };
}

/** Mark the border nearest to a scene point: open, door, locked, wall, outer, reinforced. One undo step. */
export function setBorder(x, y, kind) {
  if ( !Z || !Marks.BORDER_KINDS.includes(kind) ) return false;
  const nb = Marks.nearestBorder(Z, x, y, markTol());
  if ( !nb ) return false;
  const key = Marks.pairKey(nb.a, nb.b);
  return edit((_st, s) => {
    const before = JSON.stringify(s.walls);
    s.walls = s.walls.filter(([wx, wy]) => pairAt(wx, wy) !== key);
    if ( kind !== "open" ) s.walls.push([nb.x, nb.y, kind]);
    if ( JSON.stringify(s.walls) === before ) return false;
    // a border marked anew is as built: what happened to the old one in play goes with it
    s.plays = s.plays.filter(([px, py]) => pairAt(px, py) !== key);
    return true;
  });
}

/**
 * Build a border from the GM's editor: spec = { kind?, wall?: null | { armor, outer }, door?: null | { armor, state } } laid over
 * the border as it is built (borders.mjs buildFrom). One undo step, like every other mark the GM makes on the map (the combat
 * module's buildBorder() goes through apply() instead: no undo step, an inverse). What happened to the border in play stays where
 * it still fits (an Armor changed under a breached wall leaves it breached). `border`: a border key, a border object or [a, b].
 */
export function editBorder(border, spec = {}) {
  if ( !game.user.isGM || !S || !Z ) return false;
  const P = pairOf(border);
  if ( !P ) return false;
  const m = M0?.borders.get(P.pk) ?? null, raw = Borders.buildFrom(m, spec);
  if ( raw === undefined ) return false;
  const at = m ?? Places.pairsOf(cache()).get(P.pk), prev = Borders.playOf(m);
  const nextPlay = raw ? Borders.normPlay(Borders.model(...raw), prev) : null;
  return edit((_st, s) => {
    const before = JSON.stringify([s.walls, s.plays]);
    s.walls = s.walls.filter(([x, y]) => pairAt(x, y) !== P.pk);
    s.plays = s.plays.filter(([x, y]) => pairAt(x, y) !== P.pk);
    if ( raw ) s.walls.push([r1(at.x), r1(at.y), ...raw]);
    if ( raw && nextPlay ) s.plays.push([r1(at.x), r1(at.y), nextPlay]);
    return JSON.stringify([s.walls, s.plays]) !== before;
  });
}

/** A point inside a zone to keep its mark on: where its mark is now, else `prefer` when it lies in the zone, else the label spot. */
function zonePoint(id, prefer) {
  for ( const [x, y] of S.marks ) if ( Geo.zoneAt(Z, x, y) === id ) return [x, y];
  if ( prefer && Geo.zoneAt(Z, prefer.x, prefer.y) === id ) return [prefer.x, prefer.y];
  const z = Z.zones.find((q) => q.id === id);
  return z ? [z.label.x, z.label.y] : null;
}

/** Write the props of some zones (id -> props; empty props drop the mark). One undo step (`via` play: none, a combat module's write). */
function writeZones(map, prefer, via = edit) {
  if ( !Z || !map.size ) return false;
  const at = new Map([...map.keys()].map((id) => [id, zonePoint(id, prefer)]));
  const body = (s) => {
    const before = JSON.stringify(s.marks);
    s.marks = s.marks.filter(([x, y]) => !map.has(Geo.zoneAt(Z, x, y)));
    for ( const [id, p] of map ) { const c = Marks.cleanProps(p); if ( Object.keys(c).length && at.get(id) ) s.marks.push([...at.get(id), c]); }
    return JSON.stringify(s.marks) !== before;
  };
  return via === edit ? edit((_st, s) => body(s)) : via(body);
}

/** Change a zone's features / attributes / states: { building, floors, tall, water, terrain, empty, tags: [..], wrecked, fire (0..12), dark, ice, flooded, lowgrav }. GM only. */
export function setZone(id, patch, at = null, via = edit, layer = null) {
  // the GM check comes first: the fire below is painted on / put out of the fire layer before the marks are written
  if ( !game.user.isGM || !S || !Z || id < 0 ) return false;
  // fire set from the menu: a new fire is painted on the fire layer too, a fire put out goes out there as well
  if ( "fire" in patch && linkOn() ) {
    const was = M?.zones.get(id)?.fire ?? 0, onMap = MAP.get(id)?.fire ?? 0, now = Number(patch.fire) || 0;
    // (`layer`: what was done on the fire layer, for the inverse of a combat action - { back: the strokes put out, as they were,
    // out: the ids of the strokes painted })
    const paint = () => { const st = paintMap(id, now); if ( layer && typeof st?.id === "string" ) layer.out.push(st.id); };
    if ( !was && now ) paint();
    else if ( was && !now ) putOutMap(id, layer?.back);
    // lowered below what the painted fire reads as: the zone shows the higher of the two, so put that fire out and paint it
    // again no higher than the new Intensity (below 6 only the zone's own mark stays)
    else if ( onMap > now ) { putOutMap(id, layer?.back); if ( now >= 6 ) paint(); }
  }
  return writeZones(new Map([[id, { ...(M0?.zones.get(id) ?? {}), ...patch }]]), at, via);
}

/** Clear the states (not the features) of one zone, or of every zone (end of the scene): the GM's marks, the fires painted on the
 *  map, and the registry's states (a GM action; nothing clears them on its own). */
export function clearStates(id = null) {
  // (the GM check comes before the fires on the map are put out)
  if ( !game.user.isGM || !S || !Z ) return false;
  const map = new Map();
  for ( const [zid, p] of M0?.zones ?? [] ) if ( (id == null || zid === id) && Marks.hasStates(p) ) map.set(zid, Marks.withoutStates(p));
  // the fires painted on the map go out with the states (wreckage and water stay: they are the map)
  let out = 0;
  if ( linkOn() ) for ( const [zid, p] of M?.zones ?? [] ) if ( (id == null || zid === id) && p.fire ) out += putOutMap(zid);
  const marks = writeZones(map);
  const reg = play((s) => {
    const keep = s.states.filter(([x, y]) => id != null && zoneAtNow(x, y) !== id);
    if ( keep.length === s.states.length ) return false;
    s.states = keep; return true;
  });
  return marks || reg || out > 0;
}

/** One round of fire (book: Fire Spreading): a D6 for every burning zone, the result written and told in the chat. */
export async function fireRound() {
  if ( !game.user.isGM || !Z || !M ) return null;
  // a combat module that runs the rules runs the fire too (dev/zones-api.md 19): the map rolls, writes and posts nothing
  if ( DRIVER ) {
    if ( typeof DRIVER.fireRound === "function" ) return DRIVER.fireRound();
    ui.notifications.info(game.i18n.format("MOINENMAPS.Zones.driven.fire", { by: DRIVER.title }));
    return null;
  }
  const { log } = Marks.fireRound(Z, M);
  const L = (k, d) => game.i18n.format(`MOINENMAPS.Zones.fire.${k}`, d ?? {});
  if ( !log.length ) { ui.notifications.info(L("none")); return log; }
  // write only the GM's own marks (what the layers say is read from them again); fires on the map go out / are painted too
  const own = new Map();
  for ( const r of log ) {
    if ( r.out ) { const p = { ...(M0.zones.get(r.id) ?? {}) }; delete p.fire; own.set(r.id, p); if ( linkOn() ) putOutMap(r.id); }
    else if ( r.to != null ) {
      const f = M.zones.get(r.id)?.fire ?? 6;
      own.set(r.to, { ...(own.get(r.to) ?? M0.zones.get(r.to) ?? {}), fire: f });
      if ( linkOn() ) paintMap(r.to, f);
    }
  }
  writeZones(own);
  const num = zoneName;
  const rows = log.map((r) => {
    const d = { n: num(r.id), r: r.roll, to: r.to != null ? num(r.to) : "" };
    return `<li>${r.out ? L("out", d) : r.to != null ? L("spread", d) : r.roll >= 5 ? L("blocked", d) : L("stays", d)}</li>`;
  });
  await ChatMessage.create({ speaker: { alias: game.i18n.localize("MOINENMAPS.Zones.fire.title") }, content: `<ul class="mm-z-fire">${rows.join("")}</ul>` });
  return log;
}

/* ---------------------------------------------------------------- who runs the rules (dev/zones-api.md 19; combat-spec gap G-Z9) */

/**
 * The map keeps a few rule mechanics of its own for tables that play without a combat module: the fire round (it rolls a D6 per
 * burning zone, writes the result and posts it), the wrecking table shown beside a zone's terrain, and the distance badges that
 * say what a move costs. A combat module that runs the rules takes them over on its client:
 *   rulesDriver({ id, title, fireRound?: async () => any, wreck?: { terrain: [strength, bonus] } | (terrain) => string | null, distances?: bool })
 *   rulesDriver(false)       back to the map's own (also: rulesDriver(false, id) - only when that driver is the one in charge)
 * While one is set: fireRound() and its buttons run the driver's `fireRound` (no such function: the buttons go and a call does
 * nothing but say who runs the fire); the numbers beside a terrain are the driver's `wreck` (none given: the map's table, as a
 * reference only); `distances: false` takes the map's own distance badges and ruler label away (the driver highlights instead).
 * Per client, not stored. Nothing else changes: what the map stores, reports and draws stays as it is.
 */
let DRIVER = null;
export function rulesDriver(opts, only = null) {
  if ( opts === false || opts == null ) { if ( only != null && DRIVER?.id !== only ) return false; DRIVER = null; }
  else {
    const id = String(opts.id ?? "driver");
    DRIVER = { id, title: String(opts.title ?? game.modules?.get?.(id)?.title ?? id), fireRound: typeof opts.fireRound === "function" ? opts.fireRound : null, wreck: opts.wreck ?? null, distances: opts.distances !== false };
  }
  if ( S ) { refresh(); tell("params"); }
  return !!DRIVER;
}
/** Who runs the rules on this client: { id, title, fireRound: bool, distances: bool } or null (the map's own mechanics). */
export const drivenBy = () => (DRIVER ? { id: DRIVER.id, title: DRIVER.title, fireRound: !!DRIVER.fireRound, distances: DRIVER.distances } : null);
/** Whether the fire round can be run from the map's buttons: always without a driver, with one only when it gave the routine. */
export const fireRoundOn = () => !DRIVER || !!DRIVER.fireRound;
/** What is written beside a terrain: "4/+1" (minimum Strength / attack bonus) - the driver's table when it gave one, else the map's. */
export function wreckText(terrain) {
  if ( !terrain ) return "";
  const W = DRIVER?.wreck;
  if ( typeof W === "function" ) { try { const s = W(terrain); return s == null ? "" : String(s); } catch { return ""; } }
  const row = W && typeof W === "object" ? W[terrain] : Marks.WRECK[terrain];
  if ( Array.isArray(row) ) return `${row[0]}/+${row[1]}`;
  return terrain === "none" ? "\u2014" : "";
}

/* ---------------------------------------------------------------- token altitude (Invincible: ground, elevated, Sky High, Orbit) */

export const ALTS = ["ground", "elevated", "sky", "orbit"];
const OFF_MAP = new Set(["sky", "orbit"]);
/** A token's altitude (its flag; "ground" when unset). */
export const altOf = (doc) => { const a = doc?.getFlag?.(MODULE_ID, "alt"); return ALTS.includes(a) ? a : "ground"; };
/** What the token's `alt` flag says, the values the HUD does not offer included (underground, another dimension, a chase: places.mjs). */
function rawAlt(doc) { const a = doc?.getFlag?.(MODULE_ID, "alt"); return Places.ALT_VALUES.includes(a) ? a : "ground"; }
export async function setAltitude(token, alt) {
  const doc = token?.document ?? token;
  if ( !doc?.isOwner || !ALTS.includes(alt) ) return;
  const k = `flags.${MODULE_ID}`;
  // (the "in the air above a rooftop" note belongs to the altitude it was set for: setLevel)
  return doc.update({ [`${k}.-=air`]: null, ...(alt === "ground" ? { [`${k}.-=alt`]: null } : { [`${k}.alt`]: alt }) });
}

/**
 * What moving between two altitudes costs (book, Movement): ground <-> elevated a quick action (or as part of a move, no action of
 * its own); to or from Sky High or Orbit one full action - straight between any two levels (orbit to the ground is one full action).
 */
export function altCost(from, to) {
  if ( from === to ) return "here";
  return OFF_MAP.has(from) || OFF_MAP.has(to) ? "full" : "quick";
}
/** Life Support (or a spacesuit, which the GM judges): a power by that name keeps a character alive in orbit. */
export function hasLifeSupport(actor) {
  const n = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  return !!actor?.items?.some((i) => ["lifesupport", "podtrzymywaniezycia"].some((w) => n(i.name).startsWith(w)));
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** A small tag on a token that is not on the ground (only where the zones show). */
function altBadge(t) {
  if ( !t || t.destroyed ) return;
  const alt = altOf(t.document), fl = floorOf(t), show = (alt !== "ground" || fl > 0) && !!Z && visibleToMe();
  if ( !show ) { if ( t._mmAlt ) { t._mmAlt.destroy({ children: true }); t._mmAlt = null; } return; }
  const roof = alt === "elevated" && Marks.floorsOf(M, zoneOfToken(t)) > 0;
  const text = fl > 0 && alt === "ground" ? `▦ ${game.i18n.format("MOINENMAPS.Zones.floorN", { n: fl })}`
    : roof ? `▲ ${game.i18n.localize("MOINENMAPS.Zones.roof")}` : `▲ ${game.i18n.localize(`MOINENMAPS.Zones.altShort.${alt}`)}`;
  if ( t._mmAlt?.destroyed ) t._mmAlt = null;
  if ( !t._mmAlt ) {
    const c = new PIXI.Container(); c.eventMode = "none";
    c.addChild(new PIXI.Graphics(), new PIXI.Text("", { fontFamily: "Signika, sans-serif", fontWeight: "700", fontSize: 13, fill: 0xf3e7c9 }));
    c.children[1].anchor.set(0.5); c.children[1].resolution = 3;
    t._mmAlt = t.addChild(c);
  }
  const [G, T] = t._mmAlt.children;
  T.text = text;
  const w = T.width + 12, col = alt === "ground" ? 0xf2c14e : alt === "elevated" ? 0x5cc8ff : alt === "sky" ? 0xc38bff : 0xe06666;
  G.clear().lineStyle({ width: 1.5, color: col }).beginFill(0x15110f, 0.85).drawRoundedRect(-w / 2, -10, w, 20, 9).endFill();
  const s = Math.max(0.6, Math.min(2, t.w / 100));
  t._mmAlt.scale.set(s);
  t._mmAlt.position.set(t.w / 2, -4 * s);
}
const altBadges = () => { for ( const t of canvas.tokens?.placeables ?? [] ) altBadge(t); };
const zoneOfToken = (t) => { const c = tokenCenter(t); return Geo.zoneAt(Z, c.x, c.y); };
/** The floor a token stands on (0: the ground floor or not in a building with floors). */
function floorOf(t) {
  const f = Math.round(Number(t?.document?.getFlag?.(MODULE_ID, "floor")) || 0);
  return f > 0 && Z && Marks.floorsOf(M, zoneOfToken(t)) >= f ? f : 0;
}
/** Put a token on a floor of its building: 0 the ground floor, 1..n a floor, n + 1 the rooftop (elevated). */
export async function setFloor(token, f) {
  const doc = token?.document ?? token;
  if ( !doc?.isOwner ) return;
  const t = doc.object, n = t ? Marks.floorsOf(M, zoneOfToken(t)) : 0;
  f = Math.max(0, Math.min(n + 1, Math.round(Number(f) || 0)));
  const k = `flags.${MODULE_ID}`;
  if ( f === 0 ) return doc.update({ [`${k}.-=floor`]: null, [`${k}.-=alt`]: null, [`${k}.-=air`]: null });
  if ( f > n ) return doc.update({ [`${k}.-=floor`]: null, [`${k}.alt`]: "elevated", [`${k}.-=air`]: null });
  return doc.update({ [`${k}.floor`]: f, [`${k}.-=alt`]: null, [`${k}.-=air`]: null });
}

/** Token HUD: a button that cycles the altitude (only where the zones show). */
function onTokenHUD(hud, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const t = hud.object;
  if ( !root || !t?.document?.isOwner || !Z || !visibleToMe() ) return;
  const col = root.querySelector(".col.right") ?? root.querySelector(".right");
  if ( !col ) return;
  const icon = { ground: "fa-person", elevated: "fa-building-user", sky: "fa-cloud", orbit: "fa-earth-americas" };
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "control-icon mm-z-alt";
  const show = () => {
    const a = altOf(t.document), fl = floorOf(t);
    btn.innerHTML = `<i class="fa-solid ${fl && a === "ground" ? "fa-stairs" : icon[a]}"></i>`;
    const where = fl && a === "ground" ? game.i18n.format("MOINENMAPS.Zones.floorN", { n: fl }) : game.i18n.localize(`MOINENMAPS.Zones.alt.${a}`);
    btn.dataset.tooltip = game.i18n.format("MOINENMAPS.Zones.altHud", { a: where });
    btn.classList.toggle("active", a !== "ground" || fl > 0);
  };
  show();
  // a click opens the four levels, each with what getting there costs from here (book: Movement, vertical movement)
  btn.addEventListener("click", (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const old = root.querySelector(".mm-z-altpick");
    if ( old ) { old.remove(); return; }
    const a = altOf(t.document), life = hasLifeSupport(t.actor), n = Marks.floorsOf(M, zoneOfToken(t)), fl = floorOf(t);
    const AL = (k, d) => (d ? game.i18n.format(`MOINENMAPS.Zones.${k}`, d) : game.i18n.localize(`MOINENMAPS.Zones.${k}`));
    const item = (key, ic, name, cost, on, warn = "") => `<button type="button" data-alt="${key}" class="${on ? "on" : ""}${warn ? " warn" : ""}"><i class="fa-solid ${ic}" inert></i>
        <span><b>${esc(name)}</b><small>${esc(cost)}${warn ? ` · ${esc(warn)}` : ""}</small></span></button>`;
    const off = (k) => item(k, icon[k], AL(`alt.${k}`), AL(`altCost.${altCost(a, k)}`), a === k, k === "orbit" && !life ? AL("altNoLife") : "");
    let html;
    if ( n > 0 && !OFF_MAP.has(a) ) {
      // inside a building with floors: the ground floor, every floor, the rooftop - each floor a vertical zone of movement
      const cur = a === "elevated" ? n + 1 : fl;
      const lvl = (i) => { const d = Math.abs(i - cur); return d ? AL("altCost.zones", { n: zonesText(d) }) : AL("altCost.here"); };
      const rows = [item("floor:0", "fa-door-open", AL("groundFloor"), lvl(0), cur === 0)];
      for ( let i = 1; i <= n; i++ ) rows.push(item(`floor:${i}`, "fa-stairs", AL("floorN", { n: i }), lvl(i), cur === i));
      rows.push(item(`floor:${n + 1}`, "fa-building-user", AL("roof"), lvl(n + 1), cur === n + 1));
      html = `${rows.reverse().join("")}<hr>${off("sky")}${off("orbit")}`;
    } else html = ALTS.map(off).join("");
    const pick = document.createElement("div");
    pick.className = "mm-z-altpick";
    pick.innerHTML = html;
    pick.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-alt]"); if ( !b ) return;
      e.preventDefault(); e.stopPropagation();
      const k = b.dataset.alt;
      pick.remove();
      if ( k.startsWith("floor:") ) { await setFloor(t, Number(k.slice(6))); show(); return; }
      if ( k === "orbit" && !hasLifeSupport(t.actor) ) ui.notifications.warn(game.i18n.format("MOINENMAPS.Zones.altNoLifeWarn", { name: t.name }));
      if ( t.document.getFlag(MODULE_ID, "floor") ) await t.document.unsetFlag(MODULE_ID, "floor");
      // Orbit goes through the orbit module when it is on (a request that never sticks; the token really moves)
      if ( k === "orbit" && moduleApi.orbit && game.settings.get(MODULE_ID, "orbit") !== false ) {
        // (it changes no flag here, so the hold of tactical play is asked by hand: tactical({ levels: true }))
        if ( levelHeld(t.document) ) { askLevel(t.document, { alt: "orbit", floor: null, air: null }, () => moduleApi.orbit.send(t)); return; }
        await moduleApi.orbit.send(t); show(); return;
      }
      await setAltitude(t, k);
      show();
    });
    btn.after(pick);
  });
  btn.addEventListener("contextmenu", async (ev) => { ev.preventDefault(); ev.stopPropagation(); await setFloor(t, 0); await setAltitude(t, "ground"); show(); });
  col.append(btn);
}

/* ---------------------------------------------------------------- places, distances and events for other modules (dev/zones-api.md) */

const zoneAtNow = (x, y) => Geo.zoneAt(Z, x, y);
const keyOfId = (id) => K?.keyOf.get(id) ?? null;
/** The lookups of the zones as they are now (kept until the zones or their marks change). */
function cache() { if ( !QC || QC.Z !== Z || QC.M !== M ) QC = Places.makeCache(Z, M, { states: RS, own: M0?.zones, map: MAP, links: ED.links }); return QC; }
const mkPlace = (o) => Object.freeze(Places.makePlace(M, keyOfId, o));

/** A token's place (its document's position and flags, not the animation); null for a token of another scene. Kept per token. */
function placeOfDoc(doc) {
  if ( !doc || !S || doc.parent !== canvas.scene ) return null;
  const fl = doc.flags?.[MODULE_ID] ?? {};
  const stamp = `${ver}|${sx(doc)}|${sy(doc)}|${doc.width}|${doc.height}|${fl.alt ?? ""}|${fl.floor ?? ""}|${fl.air === true ? 1 : 0}`;
  const hit = TP.get(doc.id);
  if ( hit?.stamp === stamp ) return hit.place;
  const g = gridSize();
  const place = mkPlace({ id: Geo.zoneAt(Z, sx(doc) + (doc.width * g) / 2, sy(doc) + (doc.height * g) / 2), alt: rawAlt(doc), floor: fl.floor, air: fl.air === true });
  TP.set(doc.id, { stamp, place });
  return place;
}

/**
 * A place from whatever a caller has: a token (placeable or document), a zone key or spot string ("z3", "z3:elevated", "z3:f2",
 * "@sky"), a zone id (its ground level), a place, or { x, y, level, floor, airborne } / { zone, level, floor, area, airborne }.
 * null when it names nothing (an unknown key).
 */
export function placeOf(w) {
  if ( w == null || !S ) return null;
  if ( typeof w === "number" ) return mkPlace({ id: Z?.zones[w] ? w : -1 });
  if ( typeof w === "string" ) {
    const s = Places.parseSpot(w);
    if ( !s ) return null;
    if ( s.key[0] === "@" ) return mkPlace({ alt: s.alt });
    const id = K?.idOf.get(s.key);
    return id == null ? null : mkPlace({ id, alt: s.alt, floor: s.floor });
  }
  if ( typeof w !== "object" ) return null;
  const doc = w.document ?? w;
  if ( doc.documentName === "Token" ) return placeOfDoc(doc);
  const alt = Places.AREAS.includes(w.area) ? w.area : w.level === "floor" ? "ground" : (w.level ?? "ground");
  let id = -1;
  if ( typeof w.zone === "string" && w.zone[0] !== "@" ) { id = K?.idOf.get(w.zone) ?? -1; if ( id < 0 ) return null; }
  else if ( Number.isFinite(w.x) && Number.isFinite(w.y) ) id = Geo.zoneAt(Z, w.x, w.y);
  else if ( Number.isInteger(w.id) && Z?.zones[w.id] ) id = w.id;
  return mkPlace({ id, alt, floor: w.floor, air: w.airborne === true });
}

/** The number of a zone as its badge shows it ("3", "III", "C", "03"), for whatever names a place; null: no such zone. */
export function nameOf(w) {
  const p = placeOf(w);
  return p && p.id >= 0 ? zoneName(p.id) : null;
}
/**
 * A zone named in words, as the map's own tips and menus name it: "Zone 3" in the user's language with the badge's numeral.
 * `level: true` adds the level of a place that is not on the ground ("Zone 3, floor 2"). An off-map area: its name. null: no such zone.
 */
export function titleOf(w, { level = false } = {}) {
  const p = placeOf(w);
  if ( !p ) return null;
  const ZL = (k, d) => (d ? game.i18n.format(`MOINENMAPS.Zones.${k}`, d) : game.i18n.localize(`MOINENMAPS.Zones.${k}`));
  if ( p.area ) return ZL(`place.${p.area}`);
  if ( p.id < 0 ) return null;
  const title = ZL("zone.title", { n: zoneName(p.id) });
  if ( !level || p.level === "ground" ) return title;
  return ZL("place.at", { zone: title, level: p.level === "floor" ? ZL("place.floor", { n: p.floor }) : ZL(`place.${p.level === "elevated" ? (p.roof ? "roof" : "air") : p.level}`) });
}

/** The tokens in a zone: [{ token: TokenDocument, place }]. A bare zone key or id means every level of it; a place, a spot or a
 *  token means that level only (the book's "same zone"), unless `anyLevel`. The ground level alone: "z3:ground" (the ground
 *  spot "z3" is the bare key), a place, or { anyLevel: false }. */
function tokensInZone(w, { anyLevel = null } = {}) {
  const at = placeOf(w);
  if ( !at || at.zone == null ) return [];
  const bare = typeof w === "number" || (typeof w === "string" && w[0] !== "@" && !w.includes(":"));
  const all = at.area ? false : (anyLevel ?? bare);
  const out = [];
  for ( const doc of canvas.scene?.tokens ?? [] ) {
    const p = placeOfDoc(doc);
    if ( p && (all ? !p.area && p.zone === at.zone : p.spot === at.spot) ) out.push({ token: doc, place: p });
  }
  return out;
}

function zonesWithin(w, n, { way = "range" } = {}) {
  const at = placeOf(w);
  if ( !at || at.id < 0 ) return [];
  return Places.within(cache(), at.id, n, way).map((r) => ({ zone: keyOfId(r.id), id: r.id, d: r.d }));
}
function borderBetween(a, b) {
  const p = placeOf(a), q = placeOf(b);
  return p && q && p.id >= 0 && q.id >= 0 && p.id !== q.id ? Places.borderInfo(cache(), keyOfId, p.id, q.id) : null;
}
function bordersOf(w) {
  const p = placeOf(w);
  if ( !p || p.id < 0 ) return [];
  return [...(Z.adj.get(p.id)?.keys() ?? [])].map((b) => Places.borderInfo(cache(), keyOfId, p.id, b));
}
function zoneInfo(w) { const p = placeOf(w); return p && p.id >= 0 ? Places.zoneInfo(cache(), keyOfId, p.id) : null; }

/**
 * Put a token on a level without moving it on the map: { level: "ground" | "underground" | "elevated" | "floor", floor, airborne }
 * or { area: "sky" | "orbit" | "dimension" | "chase" } (or a spot string; its zone part is not used). Elevated above a standing
 * building is its rooftop unless `airborne: true`. Owners only. (Orbit through the orbit scene: api.orbit.send, as the HUD does.)
 */
export async function setLevel(token, to) {
  const doc = token?.document ?? token;
  if ( !doc?.isOwner || to == null ) return;
  const s = typeof to === "string" ? Places.parseSpot(to) : null;
  const o = typeof to === "string" ? (s ? { area: Places.areaOfKey(s.key), level: s.floor ? "floor" : s.alt, floor: s.floor } : null) : to;
  if ( !o ) return;
  const k = `flags.${MODULE_ID}`, set = {};
  const put = (name, v) => { if ( v == null ) set[`${k}.-=${name}`] = null; else set[`${k}.${name}`] = v; };
  let alt = null, floor = null, air = null;
  if ( Places.AREAS.includes(o.area) ) alt = o.area;
  else if ( o.level === "underground" ) alt = "underground";
  else if ( o.level === "elevated" ) { alt = "elevated"; if ( o.airborne === true ) air = true; }
  else if ( o.level === "floor" ) {
    const n = placeOfDoc(doc)?.id >= 0 ? Marks.floorsOf(M, placeOfDoc(doc).id) : 0, f = Math.round(Number(o.floor) || 0);
    if ( f > 0 && f <= n ) floor = f;
  } else if ( o.level !== "ground" && o.level != null ) return;
  put("alt", alt); put("floor", floor); put("air", air);
  return doc.update(set);
}

/* ---- events: Hooks.on("moinenMapsZoneEvent", (type, payload) => ...) on every client */

const emit = (type, payload) => Hooks.callAll(EVENT_HOOK, type, { type, scene: canvas.scene?.id ?? null, version: ver, ...payload });

/** Tell where a token is now, if that is not where it was last told to be: "tokenLeft" then "tokenEntered". */
function syncToken(doc, cause, userId = null, move = null) {
  const to = placeOfDoc(doc);
  if ( !to ) return;
  const from = LAST.get(doc.id) ?? null;
  LAST.set(doc.id, to);
  if ( Places.placeSig(from) === Places.placeSig(to) ) return;
  if ( !from && cause !== "create" ) return;          // first sight of a token that was already there
  const d = { token: doc.id, uuid: doc.uuid, actor: doc.actorId ?? null, from, to, zoneChanged: from?.zone !== to.zone, levelChanged: !from || from.level !== to.level || from.floor !== to.floor || from.airborne !== to.airborne, cause, userId, move };
  if ( from ) emit("tokenLeft", d);
  emit("tokenEntered", d);
}
function dropToken(doc, userId = null) {
  const from = LAST.get(doc.id) ?? null;
  LAST.delete(doc.id); TP.delete(doc.id);
  if ( from ) emit("tokenLeft", { token: doc.id, uuid: doc.uuid, actor: doc.actorId ?? null, from, to: null, zoneChanged: true, levelChanged: true, cause: "delete", userId });
}

/** The states of the zones and borders now, by stable key. */
function stateSnap() {
  const zs = new Map(), bs = new Map();
  if ( Z && K ) {
    for ( const z of Z.zones ) { const recs = RS.get(z.id) ?? NONE; zs.set(K.keyOf.get(z.id), { id: z.id, props: M?.zones.get(z.id) ?? {}, recs, sig: States.statesSig(recs) }); }
    for ( const [pk, p] of Places.pairsOf(cache()) ) {
      const ka = K.keyOf.get(p.a), kb = K.keyOf.get(p.b), m = M?.borders.get(pk);
      bs.set(Places.borderKey(ka, kb), { zones: [ka, kb], kind: m?.kind ?? "open", sig: Borders.sigOf(m), m: m?.wall ? m : null });
    }
  }
  const es = new Map((S?.edges ?? []).map((e) => [e.id, e]));
  return { zs, bs, es };
}
const NONE = Object.freeze([]);
const propKeys = (a, b) => {
  const out = [];
  for ( const k of new Set([...Object.keys(a), ...Object.keys(b)]) ) if ( (Array.isArray(a[k]) ? a[k].join() : a[k]) !== (Array.isArray(b[k]) ? b[k].join() : b[k]) ) out.push(k);
  return out;
};
/** Take the first picture of a scene (nothing is told: it has just been opened). */
function prime() {
  SNAP = stateSnap();
  LAST.clear();
  for ( const doc of canvas.scene?.tokens ?? [] ) { const p = placeOfDoc(doc); if ( p ) LAST.set(doc.id, p); }
}
/**
 * The zones or their marks changed (`source`: "edit" this GM's own change, "sync" the scene flag written by another client,
 * "layers" the fire / destruction / water layers): tell every zone and border whose state is not what it was, then every token
 * that is not where it was.
 */
function announce(source) {
  if ( !S ) return;
  const was = SNAP ?? { zs: new Map(), bs: new Map(), es: new Map() }, now = SNAP = stateSnap();
  for ( const [key, n] of now.zs ) {
    const o = was.zs.get(key);
    const changed = o ? propKeys(o.props, n.props) : Object.keys(n.props);
    // ("states": the registry's records of the zone changed - one came, went, or had its level, end or exemptions changed)
    if ( (o?.sig ?? "") !== n.sig ) changed.push("states");
    if ( o && !changed.length ) continue;
    emit("zoneChanged", { zone: key, id: n.id, before: o ? o.props : null, after: n.props, changed, added: !o, removed: false, source, statesBefore: o ? o.recs : NONE, statesAfter: n.recs });
  }
  for ( const [key, o] of was.zs ) if ( !now.zs.has(key) ) emit("zoneChanged", { zone: key, id: -1, before: o.props, after: null, changed: Object.keys(o.props), added: false, removed: true, source, statesBefore: o.recs, statesAfter: NONE });
  for ( const [key, n] of now.bs ) {
    const o = was.bs.get(key);
    // (before / after: what the border amounts to, as always; was / now: its wall and door - told too when only those changed)
    if ( o?.kind !== n.kind || (o && o.sig !== n.sig) ) emit("borderChanged", { border: key, zones: n.zones, before: o?.kind ?? null, after: n.kind, source, was: o ? Borders.partsOf(o.m) : null, now: Borders.partsOf(n.m) });
  }
  for ( const [key, o] of was.bs ) if ( !now.bs.has(key) ) emit("borderChanged", { border: key, zones: o.zones, before: o.kind, after: null, source, was: Borders.partsOf(o.m), now: null });
  for ( const [id, e] of now.es ) { const o = was.es.get(id); if ( !o || JSON.stringify(o) !== JSON.stringify(e) ) emit("edgeChanged", { edge: id, before: o ?? null, after: e, source }); }
  for ( const [id, o] of was.es ) if ( !now.es.has(id) ) emit("edgeChanged", { edge: id, before: o, after: null, source });
  for ( const doc of canvas.scene?.tokens ?? [] ) syncToken(doc, "zones");
}

/* ---------------------------------------------------------------- play state: writes for a combat module (dev/zones-api.md 9-12) */

const r1 = (v) => Math.round(v * 10) / 10;
const copy = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const fail = (reason, more = {}) => ({ ok: false, reason, ...more });
let playDepth = 0, playDirty = false;

/** Whether this client may write play state: the GM, and where several GMs are connected the active one (it alone executes combat). */
export function canWrite() {
  return !!game.user?.isGM && !!S && !!Z && (!game.users?.activeGM || game.users.activeGM.id === game.user.id);
}

/** The active GM's name (the one whose client writes play state); "" when none is connected. */
export const activeGmName = () => game.users?.activeGM?.name ?? "";
/** Why a write was refused, in words for the one who tried (a result of apply() or one of its reasons). */
export function refusalText(r) {
  const reason = typeof r === "string" ? r : r?.reason ?? "other";
  const key = `MOINENMAPS.Zones.refused.${REFUSALS.includes(reason) ? reason : "other"}`;
  return game.i18n.format(key, { gm: activeGmName() || "?", reason });
}
const REFUSALS = ["notGM", "notActiveGM", "noZones", "noBorder", "noWall", "noDoor", "noZone", "noState", "noEdge", "badEdge", "badState"];

/**
 * Change the play state (border states, registry states, edges; also marks and walls on behalf of a combat action): `fn(s)` gets a
 * copy whose arrays it may replace (never change an entry in place) and returns true when it changed something. No undo step: the
 * editor's undo leaves play state alone, the caller keeps the inverse. Nothing is worked out from the lines again.
 */
function play(fn) {
  if ( !game.user.isGM || !S ) return false;
  const next = { ...S, walls: S.walls.slice(), marks: S.marks.slice(), plays: S.plays.slice(), states: S.states.slice(), edges: S.edges.slice() };
  // (edges and inverses name zones by key: the keys are written down before the first play write, as before an edit)
  pinKeys(next);
  if ( !fn(next) ) return false;
  S = next;
  remark(false);
  if ( playDepth ) playDirty = true; else playDone();
  return true;
}
function playDone() { refresh(); scheduleSave(); tell("edited"); announce("play"); }

/** A border named by its key ("z1|z2"), a border object, or two places: { a, b, pk, key } (ids) - null when they are not neighbours. */
function pairOf(b) {
  let ka, kb;
  if ( typeof b === "string" ) [ka, kb] = b.split("|");
  else if ( Array.isArray(b) ) { ka = placeOf(b[0])?.zone; kb = placeOf(b[1])?.zone; }
  else if ( b && typeof b.key === "string" ) [ka, kb] = b.key.split("|");
  const a = K?.idOf.get(ka), c = K?.idOf.get(kb);
  if ( a == null || c == null || a === c ) return null;
  const pk = Marks.pairKey(a, c);
  return Places.pairsOf(cache()).has(pk) ? { a, b: c, pk, key: Places.borderKey(ka, kb) } : null;
}
const wallRow = (pk) => S.walls.find(([x, y]) => pairAt(x, y) === pk) ?? null;

function opBorder(o) {
  const P = pairOf(o.border);
  if ( !P ) return fail("noBorder");
  const m = M0?.borders.get(P.pk) ?? null, prev = Borders.playOf(m);
  let next;
  if ( "play" in o || o.restore ) {
    if ( o.play && !m ) return fail("noWall");
    if ( o.play?.d != null && !m.door ) return fail("noDoor");
    next = o.restore ? null : Borders.normPlay(m, o.play);
  } else {
    const r = Borders.patchPlay(m, o);
    if ( r.error ) return fail(r.error);
    next = r.play;
  }
  const changed = JSON.stringify(next) !== JSON.stringify(prev);
  if ( changed ) play((s) => {
    s.plays = s.plays.filter(([x, y]) => pairAt(x, y) !== P.pk);
    if ( next ) s.plays.push([r1(m.x), r1(m.y), next]);
    return true;
  });
  return { ok: true, changed, inverse: { op: "border", border: P.key, play: prev }, result: borderBetween(...P.key.split("|")) };
}

function opBorderBuild(o) {
  const P = pairOf(o.border);
  if ( !P ) return fail("noBorder");
  const m = M0?.borders.get(P.pk) ?? null, row = wallRow(P.pk);
  const prevRaw = row ? copy(row.slice(2)) : null, prevPlay = Borders.playOf(m);
  let raw, nextPlay = null;
  if ( "raw" in o ) {
    raw = o.raw;
    if ( raw != null && (!Array.isArray(raw) || !Borders.KINDS[raw[0]]) ) return fail("badBorder");
    if ( raw ) { const e = Borders.cleanExt(raw[0], raw[1]); raw = e ? [raw[0], e] : [raw[0]]; }
    nextPlay = raw ? Borders.normPlay({ ...Borders.model(...raw) }, o.play) : null;
  } else {
    raw = Borders.buildFrom(m, o);
    if ( raw === undefined ) return fail("badBorder");
  }
  const changed = JSON.stringify(raw) !== JSON.stringify(prevRaw) || JSON.stringify(nextPlay) !== JSON.stringify(prevPlay);
  const at = m ?? Places.pairsOf(cache()).get(P.pk);
  if ( changed ) play((s) => {
    s.walls = s.walls.filter(([x, y]) => pairAt(x, y) !== P.pk);
    s.plays = s.plays.filter(([x, y]) => pairAt(x, y) !== P.pk);
    if ( raw ) s.walls.push([r1(at.x), r1(at.y), ...raw]);
    if ( raw && nextPlay ) s.plays.push([r1(at.x), r1(at.y), nextPlay]);
    return true;
  });
  return { ok: true, changed, inverse: { op: "borderBuild", border: P.key, raw: prevRaw, play: prevPlay }, result: borderBetween(...P.key.split("|")) };
}

const stateRow = (id) => S.states.find((row) => row[2].id === id) ?? null;
/** Give a new record its id from the scene counter ("s7", "e8"); a record that comes back with its id keeps it, and the counter
 *  stays ahead of it - an id is never given twice (an id in use is passed over: a scene saved while the counter lagged behind). */
function takeId(s, rec, letter) {
  const used = (id) => s.states.some((row) => row[2].id === id) || s.edges.some((e) => e.id === id);
  if ( !rec.id ) { do rec.id = `${letter}${s.playNext++}`; while ( used(rec.id) ); }
  else { const m = /^[se](\d+)$/.exec(rec.id); if ( m ) s.playNext = Math.max(s.playNext, Number(m[1]) + 1); }
}
/** A registry row as it is told: the state with the key of its zone (null: its zone is gone for now). */
const stateOut = ([x, y, r]) => ({ ...copy(r), zone: keyOfId(zoneAtNow(x, y)) });

function opStateAdd(o) {
  const st = o.state;
  if ( !st || typeof st !== "object" ) return fail("badState");
  let point = Array.isArray(o.point) && o.point.every(Number.isFinite) ? [o.point[0], o.point[1]] : null, at = st.at;
  if ( o.zone != null ) {
    const p = placeOf(o.zone);
    if ( !p || p.id < 0 ) return fail("noZone");
    // a spot string names the level the state holds on; a bare key names none
    if ( at == null && typeof o.zone === "string" && o.zone.includes(":") ) at = States.atOfSpot(p.spot);
    if ( !point || zoneAtNow(point[0], point[1]) !== p.id ) point = zonePoint(p.id);
  }
  if ( !point ) return fail("noZone");
  const rec = States.cleanState({ ...st, at });
  if ( !rec ) return fail("badState");
  if ( rec.id && stateRow(rec.id) ) return fail("idTaken");
  play((s) => {
    takeId(s, rec, "s");
    s.states.push([r1(point[0]), r1(point[1]), rec]);
    return true;
  });
  return { ok: true, changed: true, inverse: { op: "zoneState.remove", id: rec.id }, result: stateOut(stateRow(rec.id)) };
}
function opStateRemove(o) {
  const row = stateRow(o.id);
  if ( !row ) return fail("noState");
  const out = stateOut(row);
  play((s) => { s.states = s.states.filter((q) => q !== row); return true; });
  return { ok: true, changed: true, inverse: { op: "zoneState.add", zone: null, point: [row[0], row[1]], state: copy(row[2]) }, result: out };
}
function opStateUpdate(o) {
  const row = stateRow(o.id), patch = o.patch;
  if ( !row ) return fail("noState");
  if ( !patch || typeof patch !== "object" ) return fail("badState");
  const merged = { ...row[2] }, before = {};
  for ( const k of ["at", "level", "owner", "ends", "except", "data"] ) {
    if ( !(k in patch) ) continue;
    before[k] = copy(row[2][k]) ?? null;
    if ( patch[k] == null ) delete merged[k]; else merged[k] = patch[k];
  }
  const rec = States.cleanState(merged);
  if ( !rec ) return fail("badState");
  const changed = JSON.stringify(rec) !== JSON.stringify(row[2]);
  if ( changed ) play((s) => { s.states = s.states.map((q) => (q === row ? [q[0], q[1], rec] : q)); return true; });
  return { ok: true, changed, inverse: { op: "zoneState.update", id: o.id, patch: before }, result: stateOut(stateRow(o.id)) };
}

/** A stored edge as it is told: with `live` (it joins two zones of the map now). */
const edgeOut = (e) => ({ ...copy(e), live: ED.live.some((l) => l.id === e.id) });
function opEdgeAdd(o) {
  const e = o.edge;
  if ( !e || typeof e !== "object" ) return fail("badEdge");
  // the ends as spots: anything that names a place; `raw` keeps the spot strings as given (putting back an edge whose zone sleeps)
  const end = (w) => (o.raw && typeof w === "string" ? w : placeOf(w)?.spot ?? null);
  const a = end(e.a), b = end(e.b);
  if ( !a || !b ) return fail("noZone");
  const rec = States.cleanEdge({ ...e, a, b });
  if ( !rec ) return fail("badEdge");
  if ( rec.id && S.edges.some((q) => q.id === rec.id) ) return fail("idTaken");
  play((s) => {
    takeId(s, rec, "e");
    s.edges.push(rec);
    return true;
  });
  return { ok: true, changed: true, inverse: { op: "edge.remove", id: rec.id }, result: edgeOut(rec) };
}
function opEdgeRemove(o) {
  const e = S.edges.find((q) => q.id === o.id);
  if ( !e ) return fail("noEdge");
  const out = edgeOut(e);
  play((s) => { s.edges = s.edges.filter((q) => q !== e); return true; });
  return { ok: true, changed: true, inverse: { op: "edge.add", raw: true, edge: copy(e) }, result: out };
}

/** A zone's own marks changed for a combat action (as setZone, with the fire it paints or puts out), without an undo step. */
function opZone(o) {
  const p = placeOf(o.zone), patch = o.patch;
  if ( !p || p.id < 0 ) return fail("noZone");
  if ( !patch || typeof patch !== "object" ) return fail("badPatch");
  const own = M0?.zones.get(p.id) ?? {}, before = {};
  for ( const k of Object.keys(patch) ) before[k] = copy(own[k]) ?? null;
  // THE FIRE LAYER IN THE INVERSE (U72). A fire write also paints / puts out strokes on the fire layer; the own marks before say
  // nothing of them (a fire that was only painted has no mark: its inverse used to be { fire: null }, which repaints nothing, and
  // the inverse of a new fire put out whatever burned in the zone by then). The inverse now carries what was done there:
  //   fireLayer: { back: [the strokes put out, as they were], out: [the ids of the strokes painted] }
  // and an op that carries `fireLayer` (only the map hands those out) does exactly that on the layer - puts `out` out, gives `back`
  // back (fire.giveBack: the same strokes, growing again) - and writes the marks as given, with no painting of its own.
  if ( o.fireLayer !== undefined ) {
    const fl = o.fireLayer;
    if ( !fl || typeof fl !== "object" || !Array.isArray(fl.back ?? []) || !Array.isArray(fl.out ?? []) ) return fail("badOp");
    if ( !game.user.isGM || !S || !Z ) return fail("noZones");
    const done = { back: [], out: [] };
    putOutStrokes((fl.out ?? []).filter((id) => typeof id === "string"), done.back);
    try { done.out = FireMod.giveBack(fl.back ?? []); } catch ( err ) { console.warn(`${MODULE_ID} | zones: giving a fire back`, err); }
    const wrote = writeZones(new Map([[p.id, { ...own, ...patch }]]), null, play);
    return { ok: true, changed: wrote || done.back.length + done.out.length > 0, inverse: { op: "zone", zone: p.zone, patch: before, fireLayer: done }, result: zoneInfo(p.zone) };
  }
  const layer = { back: [], out: [] };
  const changed = setZone(p.id, patch, null, play, layer);
  const touched = layer.back.length + layer.out.length > 0;
  return { ok: true, changed: changed || touched, inverse: { op: "zone", zone: p.zone, patch: before, ...(touched ? { fireLayer: layer } : {}) }, result: zoneInfo(p.zone) };
}

/* ---- tokens: rows { id, x, y, alt, floor, air } (alt / floor / air: this module's token flags; null: not set) */

const tokenRow = (doc) => { const f = doc.flags?.[MODULE_ID] ?? {}; return { id: doc.id, x: sx(doc), y: sy(doc), alt: f.alt ?? null, floor: f.floor ?? null, air: f.air === true ? true : null }; };
function tokenUpdate(row) {
  const k = `flags.${MODULE_ID}`, u = { _id: row.id };
  if ( Number.isFinite(row.x) ) u.x = row.x;
  if ( Number.isFinite(row.y) ) u.y = row.y;
  for ( const n of ["alt", "floor", "air"] ) { if ( !(n in row) ) continue; if ( row[n] == null ) u[`${k}.-=${n}`] = null; else u[`${k}.${n}`] = row[n]; }
  return u;
}
/**
 * Whether this client draws frames now. A tab in the background, a minimised window or a hidden pane draws none: a token's
 * movement animation never ends there, so a move made on such a client is not animated and is not waited for. The answer is
 * kept for `maxAge` ms. (No requestAnimationFrame at all: nothing to ask, taken as yes.)
 */
let framesAt = -Infinity, framesOk = true;
export async function drawsFrames(maxAge = 1000) {
  if ( typeof requestAnimationFrame !== "function" ) return true;
  if ( Date.now() - framesAt < maxAge ) return framesOk;
  framesOk = globalThis.document?.hidden === true ? false : await Promise.race([new Promise((r) => requestAnimationFrame(() => r(true))), new Promise((r) => setTimeout(() => r(false), 250))]);
  framesAt = Date.now();
  return framesOk;
}
/** The options of a token write: without animation on a client that draws no frames (unless the caller said `animate` itself). */
async function drawOptions(options = {}) {
  return "animate" in options || (await drawsFrames()) ? options : { ...options, animate: false };
}
const mayMove = (doc) => !!doc && (doc.canUserModify?.(game.user, "update") ?? doc.isOwner ?? false);
const tokenDoc = (id) => canvas.scene?.tokens.get?.(id) ?? [...(canvas.scene?.tokens ?? [])].find((d) => d.id === id) ?? null;
/**
 * Write token rows. `skipMissing`: a row whose token is no longer on the scene is left out and named in `missing` (an inverse: the
 * tokens that still exist go back; with none of them left nothing is written, `changed: false`). Without it: all or nothing.
 */
async function writeTokens(rows, options = {}, { skipMissing = false } = {}) {
  if ( !Array.isArray(rows) || !rows.every((r) => r && typeof r === "object" && typeof r.id === "string") ) return fail("badOp");
  const missing = rows.filter((r) => !tokenDoc(r.id)).map((r) => r.id);
  if ( missing.length && !skipMissing ) return fail("noToken", { missing });
  if ( missing.length ) rows = rows.filter((r) => !missing.includes(r.id));
  const docs = rows.map((r) => tokenDoc(r.id));
  if ( !docs.every(mayMove) ) return fail("notOwner");
  const before = docs.map(tokenRow);
  if ( rows.length ) {
    try { await canvas.scene.updateEmbeddedDocuments("Token", rows.map(tokenUpdate), await drawOptions(options)); }
    catch ( err ) { console.warn(`${MODULE_ID} | zones: token write`, err); return fail("error"); }
  }
  return { ok: true, changed: rows.length > 0, inverse: { op: "tokens", rows: before, skipMissing: true }, result: docs.map((d) => placeOfDoc(d)), ...(missing.length ? { missing } : {}) };
}

const OPS = {
  border: opBorder, borderBuild: opBorderBuild,
  "zoneState.add": opStateAdd, "zoneState.remove": opStateRemove, "zoneState.update": opStateUpdate,
  "edge.add": opEdgeAdd, "edge.remove": opEdgeRemove, zone: opZone
};
async function applyOne(op) {
  if ( !op || typeof op !== "object" ) return fail("badOp");
  if ( op.op === "batch" ) {
    if ( !Array.isArray(op.ops) ) return fail("badOp");
    const inv = [], results = [];
    let changed = false;
    for ( let i = 0; i < op.ops.length; i++ ) {
      const r = await applyOne(op.ops[i]);
      if ( !r.ok ) {
        // all or nothing: what was done is taken back, last first
        for ( const u of inv.reverse() ) await applyOne(u);
        return fail(r.reason, { at: i });
      }
      inv.push(r.inverse); results.push(r.result);
      if ( r.changed !== false ) changed = true;
    }
    return { ok: true, changed, inverse: { op: "batch", ops: inv.reverse() }, result: results };
  }
  if ( op.op === "tokens" ) return writeTokens(op.rows, { mmMove: typeof op.move === "string" ? op.move : "restore", ...(op.options && typeof op.options === "object" ? op.options : {}) }, { skipMissing: op.skipMissing === true });
  const fn = OPS[op.op];
  return fn ? fn(op) : fail("badOp");
}

/**
 * One write of play state for a combat action (the active GM's client): { ok, inverse, result, changed } or { ok: false, reason }.
 * `inverse` is an op that undoes exactly this write when given back to apply() - plain data, for an undo journal. Ops:
 *   { op: "border", border, wall?: { state, temp }, door?: { state } }        a border's state ({ restore: true }: as built)
 *   { op: "borderBuild", border, kind?, wall?: null | { armor, outer }, door?: null | { armor, state } }   build it anew
 *   { op: "zoneState.add", zone, state } | { op: "zoneState.update", id, patch } | { op: "zoneState.remove", id }
 *   { op: "edge.add", edge } | { op: "edge.remove", id }
 *   { op: "zone", zone, patch }                                               a zone's own marks (as setZone)
 *   { op: "tokens", rows: [{ id, x, y, alt, floor, air }], skipMissing? }     put tokens somewhere (the inverse of a move; the
 *                                                                             inverses the map hands out carry `skipMissing: true`:
 *                                                                             a token that is gone is left out and named in `missing`)
 *   { op: "batch", ops: [...] }                                               all or nothing, told and saved once
 * The scene is saved before the promise resolves (`save: false`: with the next save).
 */
export async function apply(op, { save: flush = true } = {}) {
  if ( !canWrite() ) return fail(!game.user?.isGM ? "notGM" : !S || !Z ? "noZones" : "notActiveGM");
  let r;
  playDepth++;
  try { r = await applyOne(op); }
  finally { playDepth--; if ( !playDepth && playDirty ) { playDirty = false; playDone(); } }
  if ( r.ok && flush && saveTimer ) { clearTimeout(saveTimer); saveTimer = 0; await save(); }
  return r;
}

export const setBorderState = (border, patch = {}) => apply({ op: "border", border, ...patch });
export const buildBorder = (border, spec = {}) => apply({ op: "borderBuild", border, ...spec });
/** Put a border (or, with none named, every border) back as built: a GM action - nothing does this on its own (combat-plan 5.7 item 4). */
export function restoreBorders(border = null) {
  if ( border != null ) return apply({ op: "border", border, restore: true });
  const ops = [];
  for ( const m of M0?.borders.values() ?? [] ) if ( Borders.playOf(m) ) ops.push({ op: "border", border: Places.borderKey(keyOfId(m.a), keyOfId(m.b)), restore: true });
  return apply({ op: "batch", ops });
}
/** Whether any border is not as built (the menu offers "restore" then). */
export const bordersChanged = () => { for ( const m of M0?.borders.values() ?? [] ) if ( Borders.playOf(m) ) return true; return false; };

export const addZoneState = (zone, state) => apply({ op: "zoneState.add", zone, state });
export const updateZoneState = (id, patch) => apply({ op: "zoneState.update", id, patch });
export const removeZoneState = (id) => apply({ op: "zoneState.remove", id });
/**
 * The states of a zone as records (states.mjs): the registry's, the GM's own marks, what the map's layers show. A bare key or id:
 * every level; a spot, a place or a token: that level and the states that name no level; `anyLevel` true / false says it outright
 * (as tokensInZone). The spot string of the ground level is the bare key, so the ground level alone is asked for with
 * "z3:ground", a place, a token or { anyLevel: false }. No argument: the registry's states of the whole scene (each with `zone`,
 * the key of its zone).
 */
export function zoneStates(w = undefined, { anyLevel = null } = {}) {
  if ( !S ) return [];
  if ( w === undefined ) return S.states.map(stateOut);
  const p = placeOf(w);
  if ( !p || p.id < 0 ) return [];
  const bare = typeof w === "number" || (typeof w === "string" && !w.includes(":"));
  const at = (anyLevel ?? bare) ? null : States.atOfSpot(p.spot);
  return States.listStates(RS.get(p.id), M0?.zones.get(p.id), MAP.get(p.id), at).map((r) => ({ ...copy(r), zone: p.zone }));
}
export const zoneState = (id) => { const row = S ? stateRow(id) : null; return row ? stateOut(row) : null; };

export const addEdge = (edge) => apply({ op: "edge.add", edge });
export const removeEdge = (id) => apply({ op: "edge.remove", id });
/** Every stored edge, with `live` (it joins two zones now). The edges at a zone. */
export const edgeList = () => (S ? S.edges.map(edgeOut) : []);
export function edgesOf(w) {
  const p = placeOf(w);
  return p && p.id >= 0 ? ED.live.filter((e) => e.ids.includes(p.id)).map((e) => { const { ids, ...rest } = e; return { ...copy(rest), live: true }; }) : [];
}

/**
 * The zones and borders in the shape the combat rules library takes (C:/ipu-tactics scripts/rules/CONTRACT.md, "Zone graph"):
 *   { zones: [{ id (key), level: 0, terrain, rooftop, empty, wrecked, flammable, wreck, tags }],
 *     borders: [{ id (border key), a, b, wall: null | { armor, state }, door: null | { armor, state } }],
 *     edges: [{ id, kind, a, b (zone keys), spots: [a, b], ways }] }
 * `wreck`, `tags` and `edges` are more than the contract names. Kept until the zones change.
 */
export function graph() {
  if ( GR?.ver === ver ) return GR.data;
  const data = { zones: [], borders: [], edges: [] };
  if ( Z && K ) {
    for ( const z of Z.zones ) {
      const p = M?.zones.get(z.id) ?? {};
      data.zones.push({ id: keyOfId(z.id), level: 0, terrain: Marks.WRECK[p.terrain] ? p.terrain : null, rooftop: !!p.building && !p.wrecked, empty: !!p.empty, wrecked: !!p.wrecked, flammable: !!p.tags?.includes("flammable"), wreck: Marks.wreckOf(p), tags: Marks.tagsOf(p) });
    }
    for ( const [pk, pr] of Places.pairsOf(cache()) ) {
      const id = Places.borderKey(keyOfId(pr.a), keyOfId(pr.b)), [ka, kb] = id.split("|"), m = M?.borders.get(pk);
      data.borders.push({ id, a: ka, b: kb, ...Borders.contractOf(m?.wall ? m : null) });
    }
    for ( const e of ED.live ) data.edges.push({ id: e.id, kind: e.kind, a: keyOfId(e.ids[0]), b: keyOfId(e.ids[1]), spots: [e.a, e.b], ways: e.ways ? e.ways.slice() : null });
  }
  GR = { ver, data };
  return data;
}

/* ---------------------------------------------------------------- movement (dev/zones-api.md 13-14) */

const BEFORE = [];
let moveSeq = 0, TACT = null;

/**
 * Ask to be asked before every step of every move made through `move()` on this client: fn(ctx) -> nothing | false |
 * { stop: true, reason, data } | { pass: true }, or a promise of one (moves.mjs runSteps). Returns the function that stops asking.
 */
export function beforeStep(fn) {
  if ( typeof fn !== "function" ) return () => {};
  BEFORE.push(fn);
  return () => { const i = BEFORE.indexOf(fn); if ( i >= 0 ) BEFORE.splice(i, 1); };
}

const docOf = (t) => { const d = t?.document ?? t; return d?.documentName === "Token" ? d : null; };
const centerOf = (doc) => { const g = gridSize(); return { x: sx(doc) + (doc.width * g) / 2, y: sy(doc) + (doc.height * g) / 2 }; };
/** A scene point for whatever names one: a token (its middle), { x, y }, or a place / key / spot (the middle of its zone). */
function pointOf(w) {
  const d = docOf(w);
  if ( d ) return centerOf(d);
  if ( w && typeof w === "object" && Number.isFinite(w.x) && Number.isFinite(w.y) ) return { x: w.x, y: w.y };
  const p = placeOf(w), z = p && p.id >= 0 ? Z.zones[p.id] : null;
  return z ? { x: z.label.x, y: z.label.y } : null;
}

/** What getting from one place to another costs a mover: { plan, cost, reachable } (moves.mjs plan / costOf). */
export function moveCost(a, b, profile = {}) {
  const pl = plan(a, b, profile);
  return { reachable: !!pl, plan: pl, cost: pl?.cost ?? null };
}
/** The move of a mover from a to b, step by step (temporary edges included), with its cost; null: no way. */
export function plan(a, b, profile = {}) {
  const p = placeOf(a), q = placeOf(b), prof = Moves.profileOf(profile);
  return p && q && prof ? Moves.plan(cache(), keyOfId, p, q, prof) : null;
}
/**
 * Where a mover can get to from a place: [{ zone, id, d, cost }] nearest first (`max`: no farther than this many borders and edges).
 * Counted from the level the mover is on, as plan() and moveCost() count it: `d` and `cost` are those of the plan to the zone's
 * ground (the stairs down a building included), and a zone this mover has no plan to from there (a walker hanging in the air, a
 * place its way of moving cannot be at) is left out. The mover's own zone is always the first row (d 0). `flat: true`: the borders
 * and edges alone, from the ground of the mover's zone whatever level it is on.
 */
export function reach(w, profile = {}, { max = Infinity, flat = false } = {}) {
  const p = placeOf(w), prof = Moves.profileOf(profile);
  if ( !p || p.id < 0 || !prof ) return [];
  const rows = Moves.reach(cache(), p.id, prof, max);
  // (on the plain ground the plan to a zone has exactly the horizontal steps: nothing more to work out)
  if ( flat === true || (p.level === "ground" && !p.airborne) ) return rows.map((r) => ({ zone: keyOfId(r.id), id: r.id, d: r.d, cost: r.cost }));
  const out = [];
  for ( const r of rows ) {
    if ( r.id === p.id ) { out.push({ zone: keyOfId(r.id), id: r.id, d: 0, cost: Moves.costOf(0, prof) }); continue; }
    const pl = Moves.plan(cache(), keyOfId, p, mkPlace({ id: r.id }), prof);
    if ( pl ) out.push({ zone: keyOfId(r.id), id: r.id, d: pl.total, cost: pl.cost });
  }
  return out.sort((a, b) => a.d - b.d || a.id - b.id);
}
/** The level a thrown or pushed mover keeps: elevated stays up (in the air), everything else comes out on the ground. */
const forcedEnd = (A, id) => mkPlace(A.level === "elevated" ? { id, alt: "elevated", air: true } : A.level === "underground" ? { id, alt: "underground" } : { id });
/**
 * The steps along a chain of zones somebody chose (keys, the first the mover's own zone): a forced move the GM edited, a route
 * picked by hand. `end`: { level, floor, airborne } of the last place (default: the ground; `forced`: the level the mover is on).
 * null: the chain does not hang together.
 */
export function planAlong(from, zoneKeys, { profile = null, end = null, forced = false } = {}) {
  const A = placeOf(from);
  if ( !A || A.id < 0 || !Array.isArray(zoneKeys) || !zoneKeys.length ) return null;
  const ids = zoneKeys.map((k) => K?.idOf.get(k) ?? -1);
  if ( ids.some((i) => i < 0) ) return null;
  const last = ids[ids.length - 1];
  const prof = Moves.profileOf(profile ?? { way: forced && A.level === "elevated" ? "air" : "walk" });
  if ( !prof ) return null;
  const B = end && typeof end === "object" ? placeOf({ ...end, id: last, zone: undefined, x: undefined, y: undefined }) : forced ? forcedEnd(A, last) : mkPlace({ id: last });
  if ( !B ) return null;
  // a forced chain that stays in the mover's zone goes straight up or down, one vertical zone a step
  if ( forced && end && ids.length === 1 && ids[0] === A.id && B ) {
    const steps = Moves.levelSteps(M, keyOfId, A, Moves.rungOf(M, B));
    return { ...Moves.planOfLevels(keyOfId, A, B, prof, steps), forced: true, vertical: true };
  }
  const pl = Moves.planAlong(cache(), keyOfId, A, ids, prof, B, { stairs: !forced });
  return pl && (forced ? { ...pl, forced: true } : pl);
}
/**
 * The chain of zones, levels and borders a forced move takes (Knockback, Slam, a throw): from where the mover is, `distance` zones
 * along a direction. The direction: `direction: { dx, dy }` or `{ angle }` (degrees, 0 = east, 90 = south), `awayFrom` (a token, a
 * point or a place: straight away from it) or `toward`. The result is a plan (as planAlong, `forced: true`) with
 * `ray: { dx, dy, end: "distance" | "edge", points }`; its borders that stop the mover carry `blocked: true` with their wall and
 * door - what hitting one does is the combat module's (answer the step). A GM who wants another chain: planAlong(from, keys, { forced: true }).
 * null: no direction (the two are on the same point), or the mover is in no zone.
 */
export function forcedChain(who, { direction = null, awayFrom = null, toward = null, distance = 1, profile = null } = {}) {
  const A = placeOf(who), from = pointOf(who);
  if ( !A || A.id < 0 || !from ) return null;
  const dz = vertical(direction);
  if ( dz ) return risePlan(A, from, dz, distance, profile);
  let dir = null;
  if ( direction && Number.isFinite(direction.angle) ) { const r = (direction.angle * Math.PI) / 180; dir = { dx: Math.cos(r), dy: Math.sin(r) }; }
  else if ( direction && Number.isFinite(direction.dx) && Number.isFinite(direction.dy) ) dir = { dx: direction.dx, dy: direction.dy };
  else if ( awayFrom != null ) { const p = pointOf(awayFrom); if ( p ) dir = { dx: from.x - p.x, dy: from.y - p.y }; }
  else if ( toward != null ) { const p = pointOf(toward); if ( p ) dir = { dx: p.x - from.x, dy: p.y - from.y }; }
  const L = dir ? Math.hypot(dir.dx, dir.dy) : 0;
  if ( !(L > 1e-6) ) return null;
  const g = gridSize(), dm = canvas.dimensions ?? {};
  const R = Moves.rayChain(cache(), zoneAtNow, from, dir, Math.max(0, Math.floor(Number(distance) || 0)), g / 4, Math.hypot(dm.width ?? 0, dm.height ?? 0) || 1e5);
  if ( !R ) return null;
  const pl = planAlong(A, R.ids.map(keyOfId), { profile, forced: true });
  return pl && { ...pl, ray: { dx: dir.dx / L, dy: dir.dy / L, end: R.end, points: R.points } };
}

/** A direction that is straight up or down: "up" | "down", { vertical: "up" | "down" }, { dz } with no dx / dy. -> 1 | -1 | 0 */
function vertical(d) {
  const v = typeof d === "string" ? d : d && typeof d === "object" ? (d.vertical ?? (Number.isFinite(d.dz) && !Number(d.dx) && !Number(d.dy) ? d.dz : null)) : null;
  return v === "up" || v > 0 ? 1 : v === "down" || v < 0 ? -1 : 0;
}
/**
 * The chain of a forced move straight up or down (moves.mjs riseChain): a plan with `forced: true`, `vertical: true` and
 * `ray: { dx: 0, dy: 0, dz, end: "distance" | "top" | "ground", points }`. Up ends in the air (above a building: over its
 * rooftop), down ends where it stops; every step says what it passes through (`slab`).
 */
function risePlan(A, from, dz, distance, profile) {
  const prof = Moves.profileOf(profile ?? { way: A.level === "elevated" ? "air" : "walk" });
  const R = prof ? Moves.riseChain(M, keyOfId, A, dz, Math.max(0, Math.floor(Number(distance) || 0))) : null;
  if ( !R ) return null;
  const n = Marks.floorsOf(M, A.id), h = R.rung;
  // (where no step is taken the mover stays as it is: standing on a rooftop is not turned into flying)
  const B = !R.steps.length ? A : mkPlace(h < 0 ? { id: A.id, alt: "underground" } : h > n ? { id: A.id, alt: "elevated", air: true } : { id: A.id, floor: h });
  return { ...Moves.planOfLevels(keyOfId, A, B, prof, R.steps), forced: true, vertical: true, ray: { dx: 0, dy: 0, dz, end: R.end, points: [{ x: from.x, y: from.y }] } };
}

/** The tokens of the scene as rectangles, without some of them. */
function takenRects(skip) {
  const g = gridSize(), out = [];
  for ( const d of canvas.scene?.tokens ?? [] ) if ( !skip.has(d.id) ) out.push({ x: sx(d), y: sy(d), w: d.width * g, h: d.height * g });
  return out;
}
/**
 * A free spot for a token inside a zone: { x, y, crowded } - the token's top-left corner (moves.mjs freeSpot). `token`: whose size
 * to fit and who not to count as in the way; `near`: a point to stay close to (default: the middle of the zone).
 */
export function freeSpot(w, { token = null, near = null, skip = null } = {}) {
  const p = placeOf(w), z = p && p.id >= 0 ? Z.zones[p.id] : null;
  if ( !z ) return null;
  const doc = docOf(token), g = gridSize();
  const out = new Set(skip ?? []); if ( doc ) out.add(doc.id);
  return Moves.freeSpot(z, { w: (doc?.width ?? 1) * g, h: (doc?.height ?? 1) * g, taken: takenRects(out), near, grid: g });
}

/** The token rows that put some tokens into a zone on a level: each on a free spot of its own near a point. */
function rowsInto(docs, zid, flags, near) {
  const g = gridSize(), z = Z.zones[zid], taken = takenRects(new Set(docs.map((d) => d.id))), rows = [];
  for ( const d of docs ) {
    const w = d.width * g, h = d.height * g;
    // a token that already stands in the zone stays where it is (a change of level only)
    const here = zoneAtNow(sx(d) + w / 2, sy(d) + h / 2) === zid;
    const sp = here ? { x: sx(d), y: sy(d) } : Moves.freeSpot(z, { w, h, taken, near, grid: g });
    taken.push({ x: sp.x, y: sp.y, w, h });
    rows.push({ id: d.id, x: sp.x, y: sp.y, ...flags });
  }
  return rows;
}
const levelFlags = (alt, floor, air) => ({ alt: alt === "ground" ? null : alt, floor: floor > 0 ? floor : null, air: air ? true : null });

/**
 * Put a token (with `group`: several) into a free spot of a zone, on the level the place names - no route, no steps, nobody
 * asked (a teleport, a GM's placement, a return from the sky). Off-map areas change the level only. Returns { ok, inverse, place }.
 */
export async function moveToZone(token, w, { group = [], near = null, options = {} } = {}) {
  const doc = docOf(token), p = placeOf(w);
  if ( !doc || !S || doc.parent !== canvas.scene ) return fail("noToken");
  if ( !p || (!p.area && p.id < 0) ) return fail("noZone");
  const docs = [doc, ...group.map(docOf).filter((d) => d && d !== doc && d.parent === canvas.scene)];
  const rows = p.area ? docs.map((d) => ({ id: d.id, alt: p.area, floor: null, air: null })) : rowsInto(docs, p.id, levelFlags(p.level === "floor" ? "ground" : p.level, p.floor, p.airborne), near);
  const r = await writeTokens(rows, { mmMove: `put${++moveSeq}`, ...options });
  return r.ok ? { ok: true, inverse: r.inverse, place: placeOfDoc(doc) } : r;
}

const stopWayOf = (way) => (way === "swim" || way === "range" ? "walk" : way === "swing" ? "air" : way);
/**
 * When the tokens' movement has played (best effort: a token without a canvas object has nothing to wait for). It stops waiting
 * when the client stops drawing frames (the animation would never end) and after 4 s at the latest.
 */
async function settled(docs) {
  const waits = docs.map((d) => d.object?.movementAnimationPromise).filter((p) => p && typeof p.then === "function");
  if ( !waits.length ) return;
  let over = false, timer = 0;
  const frozen = (async () => { while ( !over && (await drawsFrames(0)) ) await new Promise((r) => setTimeout(r, 200)); })();
  await Promise.race([Promise.allSettled(waits), frozen, new Promise((r) => { timer = setTimeout(r, 4000); })]);
  over = true; clearTimeout(timer);
}

/**
 * Move a token step by step: to a place (`to`, the route worked out from `profile`) or along a plan made before (`plan`: from
 * plan(), planAlong(), forcedChain()). Before every step the beforeStep listeners are asked and may stop the move (moves.mjs
 * runSteps); a border that stops the mover and that nobody opened or passed stops it too. Every step is ONE write of all the
 * movers (`group`: tokens that go along - carried, pulled, passengers, a group of minions - each to a free spot of its own in the
 * same zone and on the same level), so a group moves as one operation.
 *   opts: { profile, plan, group, drop: { x, y } (where in the last zone to end up near), forced, data (handed to the listeners),
 *           wait (default true: each step waits for the tokens to get there), options (for the token updates) }
 * The context a listener gets: { op, index, last, step, remaining, token, group, profile, plan, forced, data, from, to (places),
 *   border (as it is now) | edge, statesFrom, statesTo (the states of the zone left and of the zone entered) }.
 * Returns { ok, op, done, total, stopped: null | { index, reason, data, step }, place, inverse } - `inverse`: a "tokens" op that
 * puts every mover back where it started (null when no step was taken).
 * Runs on the client that calls it (a combat engine: the active GM's); the tokens must be the caller's to move.
 */
export async function move(token, to, o = {}) {
  const doc = docOf(token);
  if ( !doc || !S || !Z || doc.parent !== canvas.scene ) return fail("noToken");
  const group = [...new Set((o.group ?? []).map(docOf).filter((d) => d && d !== doc && d.parent === canvas.scene))], all = [doc, ...group];
  if ( !all.every(mayMove) ) return fail("notOwner");
  const A = placeOfDoc(doc), prof = Moves.profileOf(o.profile ?? (o.plan ? { way: o.plan.way === "range" ? "walk" : o.plan.way } : {}));
  if ( !prof ) return fail("badProfile");
  let pl = o.plan ?? null;
  if ( pl ) { if ( !Array.isArray(pl.steps) || (pl.from && pl.from.spot !== A.spot) ) return fail("stalePlan"); }
  else { const B = placeOf(to); pl = B ? Moves.plan(cache(), keyOfId, A, B, prof) : null; }
  if ( !pl ) return fail("noRoute");
  const op = `mv${++moveSeq}`, forced = !!(o.forced ?? pl.forced), steps = pl.steps, start = all.map(tokenRow), stopWay = stopWayOf(pl.way);
  const ids = all.map((d) => d.id), base = { op, token: doc.id, uuid: doc.uuid, group: ids.slice(1), forced };
  const idOfSpot = (spot) => { const s = Places.parseSpot(spot); return s ? { ...s, id: K?.idOf.get(s.key) ?? -1 } : null; };
  // the border of a step as it is NOW (a listener may have breached it; the GM may have redrawn the map under a long move)
  const liveBorder = (step) => { const a = idOfSpot(step.from), b = idOfSpot(step.to); return a && b && a.id >= 0 && b.id >= 0 ? Places.borderInfo(cache(), keyOfId, a.id, b.id) : null; };
  let still = false;
  emit("moveStarted", { ...base, way: pl.way, total: steps.length, zones: pl.zones?.slice() ?? [] });
  const R = await Moves.runSteps({
    steps, listeners: BEFORE,
    context: (step, index) => {
      const a = idOfSpot(step.from), b = idOfSpot(step.to);
      return {
        op, index, last: index === steps.length - 1, step, remaining: steps.slice(index), token: doc, group, profile: prof, plan: pl, forced, data: o.data ?? null,
        from: placeOfDoc(doc), to: placeOf(step.to),
        border: step.kind === "border" ? liveBorder(step) : null, edge: step.kind === "edge" ? step.edge : null,
        statesFrom: a && a.id >= 0 ? zoneStates(step.from, { anyLevel: false }) : [], statesTo: b && b.id >= 0 ? zoneStates(step.to, { anyLevel: false }) : []      // a step's ends are spots: that level (a ground spot is the bare key)
      };
    },
    blocked: (step) => {
      const b = idOfSpot(step.to);
      if ( !b || b.id < 0 ) return true;                                   // the zone is gone
      if ( step.kind === "border" ) { const br = liveBorder(step); return !br || !!br.stops[stopWay]; }
      if ( step.kind === "edge" ) return !ED.live.some((e) => e.id === step.edge?.id);
      return false;
    },
    perform: async (step, index) => {
      const s = idOfSpot(step.to), last = index === steps.length - 1;
      // in the air while passing; at the end as the plan's end says (a rooftop is stood on)
      const air = s.alt === "elevated" && (last ? !!pl.end?.airborne : true);
      const flags = levelFlags(s.alt, s.floor, air);
      let rows;
      if ( step.kind === "level" ) rows = all.map((d) => ({ id: d.id, ...flags }));
      else {
        const drop = last && o.drop && zoneAtNow(o.drop.x, o.drop.y) === s.id ? o.drop : null;
        rows = rowsInto(all, s.id, flags, drop ?? (step.kind === "border" && step.border ? { x: step.border.x, y: step.border.y } : null));
      }
      const opts = await drawOptions({ ...(o.options ?? {}), mmMove: op });
      // a token deleted while the move runs: without the mover the move ends here; one that only went along is left behind
      if ( !tokenDoc(doc.id) ) return { stop: true, reason: "noToken", data: { token: doc.id } };
      rows = rows.filter((r) => tokenDoc(r.id));
      if ( opts.animate === false ) still = true;
      await canvas.scene.updateEmbeddedDocuments("Token", rows.map(tokenUpdate), opts);
      if ( o.wait !== false && opts.animate !== false ) await settled(all.filter((d) => tokenDoc(d.id)));
    },
    after: (step, index) => emit("moveStep", { ...base, index, step, place: placeOfDoc(doc) })
  });
  emit("moveEnded", { ...base, done: R.done, total: steps.length, stopped: R.stopped, place: placeOfDoc(doc) });
  return { ok: true, op, done: R.done, total: steps.length, stopped: R.stopped, place: placeOfDoc(doc), inverse: R.done ? { op: "tokens", rows: start, skipMissing: true } : null, animated: R.done > 0 && !still };
}

/**
 * Cost confirmation when a token is dragged during tactical play (combat-plan 5.7 item 16). While it is on, a drag of a token
 * into ANOTHER zone by this client's user is not taken as it is: the route and its cost are worked out for the mover's profile
 * and `confirm(ctx)` is asked. A drag inside the zone goes through (moving inside a zone is free: book-dump 2383). A drop
 * outside every zone, and a drop into a zone from outside them, is a change of zone too: it is asked with `plan: null`,
 * `reachable: false` and the place outside (`zone: null`) as `to` / `from`; a yes moves nothing (there is no plan). The GM's own
 * such drop (`gm: true`, the free placement not switched off) is a placement like an Alt-drop: written, and `place(ctx)` told.
 *   tactical({ profile(tokenDoc) -> profile, confirm(ctx) -> true | false | Promise, when(tokenDoc) -> bool, gm: false })
 *   tactical(false)      off
 * ctx: { token, from, to (places), drop: { x, y } (the middle of where it was dropped), profile, plan, cost, reachable }.
 * confirm answers true: the map moves the token along the plan with move() (step by step, the listeners asked) - for a client
 * that may move it; anything else: the token stays (a combat module that sends the move to the GM as an intent answers false
 * after sending it). No `confirm`: a yes / no dialog with the cost. `gm: true` asks the GM's own drags too.
 * `levels: true` (with a `confirm`): a change of LEVEL this client's user makes outside a move - the token HUD's altitude button,
 * setAltitude / setFloor / setLevel - is held back the same way (book-dump 2386-2388: changing altitude is movement and has a
 * price, which is the combat module's to name). ctx: { token, from, to, level: true, drop: null, profile, plan, cost, reachable }
 * (`plan` null to or from an off-map area, or when this way of moving cannot be there). confirm answers true: the level is
 * written as it was asked for; anything else: the token stays where it is. Moves made through move() / moveToZone() / apply()
 * are never held.
 */
export function tactical(opts) {
  TACT = opts === false || opts == null ? null : { profile: opts.profile ?? null, confirm: opts.confirm ?? null, when: opts.when ?? null, gm: opts.gm === true, levels: opts.levels === true,
    free: opts.free === false ? false : true, place: typeof opts.place === "function" ? opts.place : null };
  return !!TACT;
}
/** Does tactical play hold a change of level of this token by this client's user (tactical({ levels: true, confirm }))? */
function levelHeld(doc) {
  if ( !TACT?.levels || !TACT.confirm || !S || !Z || !doc || doc.parent !== canvas.scene || (game.user.isGM && !TACT.gm) ) return false;
  try { return !TACT.when || !!TACT.when(doc); } catch { return false; }
}
/** The level flags an update would leave on a token: { alt, floor, air } (null: not set), or null when it touches none of them. */
function levelAfter(doc, changed) {
  const fm = changed?.flags?.[MODULE_ID];
  if ( !fm || typeof fm !== "object" ) return null;
  const cur = doc.flags?.[MODULE_ID] ?? {}, out = { alt: cur.alt ?? null, floor: cur.floor ?? null, air: cur.air === true ? true : null };
  let any = false;
  for ( const n of ["alt", "floor", "air"] ) {
    // (a value that is no plain string, number or true is a deletion, however this Foundry writes one)
    if ( n in fm ) { const v = fm[n]; out[n] = typeof v === "string" || typeof v === "number" || v === true ? v : null; any = true; }
    else if ( `-=${n}` in fm ) { out[n] = null; any = true; }
  }
  return any ? out : null;
}
/** Ask the combat module about a level change that was held back; a yes writes it (`write`: another way to make it, the orbit scene). */
async function askLevel(doc, lv, write = null) {
  const T = TACT;
  if ( !T?.confirm ) return;
  try {
    const g = gridSize(), from = placeOfDoc(doc);
    const to = mkPlace({ id: Geo.zoneAt(Z, sx(doc) + (doc.width * g) / 2, sy(doc) + (doc.height * g) / 2), alt: Places.ALT_VALUES.includes(lv.alt) ? lv.alt : "ground", floor: lv.floor, air: lv.air === true });
    if ( !from || Places.placeSig(from) === Places.placeSig(to) ) return;
    const prof = Moves.profileOf(T.profile?.(doc) ?? {}) ?? Moves.profileOf({});
    let pl = null;
    try { pl = from.area || to.area ? null : Moves.plan(cache(), keyOfId, from, to, prof); } catch { pl = null; }
    const yes = await T.confirm({ token: doc, from, to, level: true, drop: null, profile: prof, plan: pl, cost: pl?.cost ?? null, reachable: !!pl || !!from.area || !!to.area });
    if ( yes !== true ) return;
    if ( write ) await write();
    else { const { _id, ...flat } = tokenUpdate({ id: doc.id, alt: lv.alt ?? null, floor: lv.floor ?? null, air: lv.air === true ? true : null }); await doc.update(flat, { mmMove: `lv${++moveSeq}` }); }
  } catch ( err ) { console.warn(`${MODULE_ID} | zones: tactical level change`, err); }
}
function onPreUpdateToken(doc, changed, options, userId) {
  if ( !TACT || !S || !Z || userId !== game.user.id || options?.mmMove || doc.parent !== canvas.scene ) return;
  if ( !("x" in changed || "y" in changed) ) {
    // a change of level alone (the HUD's altitude button, setLevel): held while tactical play asks for it
    try {
      const lv = levelAfter(doc, changed);
      if ( !lv || !levelHeld(doc) ) return;
      const g = gridSize(), from = placeOfDoc(doc);
      const to = mkPlace({ id: Geo.zoneAt(Z, sx(doc) + (doc.width * g) / 2, sy(doc) + (doc.height * g) / 2), alt: Places.ALT_VALUES.includes(lv.alt) ? lv.alt : "ground", floor: lv.floor, air: lv.air === true });
      if ( !from || Places.placeSig(from) === Places.placeSig(to) ) return;      // the same place (a stale flag cleared): nothing to price
      askLevel(doc, lv);
      return false;
    } catch ( err ) { console.warn(`${MODULE_ID} | zones: tactical level change`, err); }
    return;
  }
  if ( game.user.isGM && !TACT.gm ) return;
  try {
    if ( TACT.when && !TACT.when(doc) ) return;
    // a GM who holds Alt while dropping the token PLACES it: no route, no price, nobody asked; the caller is told afterwards
    const placeFree = () => {
      FREE.set(doc.id, { from: placeOfDoc(doc), row: { id: doc.id, x: sx(doc), y: sy(doc), alt: doc.flags?.[MODULE_ID]?.alt ?? null, floor: doc.flags?.[MODULE_ID]?.floor ?? null, air: doc.flags?.[MODULE_ID]?.air === true ? true : null } });
      if ( options && typeof options === "object" ) options.mmFree = true;
    };
    if ( game.user.isGM && TACT.free && altDown() ) { placeFree(); return; }
    const g = gridSize(), drop = { x: (changed.x ?? sx(doc)) + (doc.width * g) / 2, y: (changed.y ?? sy(doc)) + (doc.height * g) / 2 };
    const from = placeOfDoc(doc), id = zoneAtNow(drop.x, drop.y);
    // a move from one zone into another is a move that costs - also out of the zones and back into one (two free drags would
    // otherwise pass every wall); on an off-map level (sky, orbit) there is nothing to count
    if ( !from || from.area ) return;
    // (the GM's own drop out of the zones or into them from outside has no route to price: it is a placement, told like an Alt-drop)
    if ( game.user.isGM && TACT.free && (from.id < 0) !== (id < 0) ) { placeFree(); return; }
    const fl = doc.flags?.[MODULE_ID] ?? {}, lv = levelAfter(doc, changed);
    if ( id === from.id ) {
      // dropped where it stood (or outside the zones both times): free, unless the same update changes the level too
      if ( !lv || !levelHeld(doc) ) return;
      const to = mkPlace({ id, alt: Places.ALT_VALUES.includes(lv.alt) ? lv.alt : "ground", floor: lv.floor, air: lv.air === true });
      if ( Places.placeSig(from) === Places.placeSig(to) ) return;
      const { _id, ...flat } = tokenUpdate({ id: doc.id, ...("x" in changed ? { x: changed.x } : {}), ...("y" in changed ? { y: changed.y } : {}), alt: lv.alt ?? null, floor: lv.floor ?? null, air: lv.air === true ? true : null });
      askLevel(doc, lv, () => doc.update(flat, { mmMove: `lv${++moveSeq}` }));
      return false;
    }
    // (a level written in the same update is where the mover asks to end up; else it keeps the level it travels on)
    const alt = lv ? (Places.ALT_VALUES.includes(lv.alt) ? lv.alt : "ground") : rawAlt(doc);
    const to = mkPlace({ id, alt: alt === "underground" || alt === "elevated" || Places.AREAS.includes(alt) ? alt : "ground", floor: lv ? lv.floor : 0, air: lv ? lv.air === true : fl.air === true });
    askDrag(doc, from, to, drop);
    return false;
  } catch ( err ) { console.warn(`${MODULE_ID} | zones: tactical drag`, err); }
}
/** Is Alt held on this client (Foundry's keyboard, else what the last key or pointer event of this window said; a window that
 *  lost the focus holds no key: the key-up of an Alt+Tab never arrives). */
let altKey = false;
function altDown() {
  try { const k = game.keyboard; if ( typeof k?.isModifierActive === "function" ) return !!k.isModifierActive("Alt") || altKey; } catch {}
  return altKey;
}
/** Tokens a GM is placing free of cost right now: token id -> { from (place), row (where it stood, for the inverse) }. */
const FREE = new Map();
/** A GM's free placement was written: say so on the token and tell the combat module (tactical({ place })). */
function onFreePlaced(doc, options) {
  const f = FREE.get(doc.id);
  if ( !f || !options?.mmFree ) return;
  FREE.delete(doc.id);
  const g = gridSize(), to = placeOfDoc(doc);
  try { flashToken(doc, game.i18n.localize("MOINENMAPS.Zones.board.free")); } catch {}
  try { TACT?.place?.({ token: doc, from: f.from, to, drop: { x: sx(doc) + (doc.width * g) / 2, y: sy(doc) + (doc.height * g) / 2 }, free: true, inverse: { op: "tokens", rows: [f.row], skipMissing: true } }); }
  catch ( err ) { console.warn(`${MODULE_ID} | zones: tactical placement`, err); }
}
async function askDrag(doc, from, to, drop) {
  const T = TACT;
  if ( !T ) return;
  try {
    const prof = Moves.profileOf(T.profile?.(doc) ?? {}) ?? Moves.profileOf({});
    const pl = Moves.plan(cache(), keyOfId, from, to, prof);
    const ctx = { token: doc, from, to, drop, profile: prof, plan: pl, cost: pl?.cost ?? null, reachable: !!pl };
    const yes = T.confirm ? await T.confirm(ctx) : await askCost(ctx);
    if ( yes === true && pl ) await move(doc, to, { profile: prof, plan: pl, drop });
  } catch ( err ) { console.warn(`${MODULE_ID} | zones: tactical drag`, err); }
}
/** The map's own question when no combat module asks: the zones and the actions the move takes. */
async function askCost(ctx) {
  const DL = (k, d) => game.i18n.format(`MOINENMAPS.Zones.drag.${k}`, d ?? {});
  if ( !ctx.plan ) { ui.notifications.warn(DL("noWay", { name: ctx.token.name })); return false; }
  const c = ctx.cost;
  const text = c.stressActions != null && c.stressActions < c.actions ? DL("costStress", { name: ctx.token.name, zones: zonesText(c.total), n: c.actions, s: c.stressActions }) : DL("cost", { name: ctx.token.name, zones: zonesText(c.total), n: c.actions });
  try { return (await foundry.applications.api.DialogV2.confirm({ window: { title: DL("title") }, content: `<p>${esc(text)}</p>`, rejectClose: false })) === true; }
  catch { return false; }
}

/* ---------------------------------------------------------------- public API */

export const zonesApi = {
  /** The decoded scene data (lines, preset, look) and the zones worked out from them. */
  state: () => (S ? Model.encode(S) : null),
  /** The look and movement preset in force here (after world defaults), and the look presets. */
  look, movePreset, styles: Styles,
  zones: () => Z,
  /** The zone at a scene point (-1: none), and zones between two points (null: outside, or no route). */
  zoneAt: (x, y) => Geo.zoneAt(Z, x, y),
  distance: (ax, ay, bx, by) => Geo.zoneDistance(Z, ax, ay, bx, by),
  /** Zones between two tokens. */
  tokenDistance(a, b) { const p = tokenCenter(a), q = tokenCenter(b); return Geo.zoneDistance(Z, p.x, p.y, q.x, q.y); },
  /** What a move of `d` zones costs this actor under the scene's preset. */
  band: (d, actor) => preset(movePreset())?.band(d, movesOf(actor)) ?? null,
  moves: (actor) => movesOf(actor),
  presets: () => presets().map((p) => ({ id: p.id, title: game.i18n.localize(p.title) })),
  addStroke, erase: eraseAlong, trim, clear: clearAll, undo: undoEdit, redo: redoEdit, setParams,
  /** Walls and doors, zone features and states (marks.mjs), fire, token altitude. */
  marks: () => M, ownMarks: () => M0, mapStates: () => MAP, borderAt, altCost, hasLifeSupport, setBorder, editBorder, setZone, clearStates, fireRound, altitude: altOf, setAltitude, floor: floorOf, setFloor, rules: Marks,
  refresh,
  /** Pure geometry, for tests and other modules. */
  geometry: Geo,

  /* ---- for a combat module (dev/zones-api.md): everything below takes and gives stable keys and places with their level */
  /** Counts every change of the zones or their marks: a cache built on these answers is good while it stays the same. */
  version: () => ver,
  LEVELS: Places.LEVELS, AREAS: Places.AREAS, WAYS: Places.WAYS, TAGS: Marks.TAGS, EVENT_HOOK,
  /** Stable keys: of a zone id (null: no such zone), the id of a key (-1), every key in id order. */
  keyOf: keyOfId,
  idOf: (key) => K?.idOf.get(key) ?? -1,
  keys: () => (Z ? Z.zones.map((z) => keyOfId(z.id)) : []),
  /** A zone's number as its badge shows it, a zone named in words, the numeral format in force, any number in that format. */
  zoneName: nameOf, zoneTitle: titleOf, numberFormat, numeral: numeralOf, NUM_FORMATS: Model.NUM_FORMATS,
  /** A place (zone key + level) from a token, a key, a spot string, an id, a point or a place; the place at a scene point. */
  place: placeOf,
  placeAt: (x, y, o = {}) => placeOf({ ...o, x, y, zone: undefined }),
  zoneOfToken: (token) => placeOf(token?.document ?? token),
  tokensInZone, zonesWithin,
  /** A zone / every zone as data for the rules (terrain and wrecking, building, empty, resource tags, states). */
  zone: zoneInfo,
  zoneList: () => (Z ? Z.zones.map((z) => Places.zoneInfo(cache(), keyOfId, z.id)) : []),
  /** The border between two neighbouring zones (null: not neighbours), the borders of a zone. */
  borderBetween, bordersOf,
  /** Range: borders on the shortest route, blocked ones too, and the levels between: { borders, levels, total } | null. */
  range: (a, b) => { const p = placeOf(a), q = placeOf(b); return p && q ? Places.range(cache(), p, q) : null; },
  /** The horizontal count alone (number | null). */
  borderDistance: (a, b) => { const p = placeOf(a), q = placeOf(b); return (p && q ? Places.range(cache(), p, q)?.borders : null) ?? null; },
  /** The route one way of moving can take (walk | air | through | swim | swing): { borders, levels, total } | null. */
  route: (a, b, way = "walk") => { const p = placeOf(a), q = placeOf(b); return p && q ? Places.routeLength(cache(), p, q, way) : null; },
  /** Both distances at once: { range, walk, air, through, swim, swing } (totals; null: no way). */
  distances(a, b) {
    const p = placeOf(a), q = placeOf(b), out = { range: null };
    for ( const w of Places.WAYS ) out[w] = null;
    if ( !p || !q ) return out;
    out.range = Places.range(cache(), p, q)?.total ?? null;
    for ( const w of Places.WAYS ) out[w] = Places.routeLength(cache(), p, q, w)?.total ?? null;
    return out;
  },
  /** The route step by step: zones, levels and borders crossed (way: "range" or a way of moving); null when there is none. */
  path: (a, b, { way = "walk" } = {}) => { const p = placeOf(a), q = placeOf(b); return p && q ? Places.path(cache(), keyOfId, p, q, way) : null; },
  setLevel,

  /* ---- package M2 (dev/zones-api.md sections 9-14) */
  WALL_STATES: Borders.WALL_STATES, DOOR_STATES: Borders.DOOR_STATES, STATE_KINDS: States.STATE_KINDS, EDGE_KINDS: States.EDGE_KINDS,
  /** One write for a combat module (the active GM's client): { ok, inverse, result } - the inverse is an op that undoes it. */
  apply, canWrite,
  setBorderState, buildBorder, restoreBorders,
  /** The zone-state registry: every state of a zone (or of the scene), one by id; add / change / remove (each returns its inverse). */
  zoneStates, zoneState, addZoneState, updateZoneState, removeZoneState,
  /** Temporary edges (portals, tunnels). */
  edges: edgeList, edgesOf, addEdge, removeEdge,
  /** The zones and borders in the shape the combat rules take (rules CONTRACT.md "Zone graph"). */
  graph,
  /** Movement: a mover profile, what a route costs it, where it can get to, its route step by step (temporary edges included). */
  profile: (p) => Moves.profileOf(p), moveCost, reach, plan, planAlong, forcedChain,
  /** A free spot for a token in a zone; put a token there; move a token (or a group) step by step, the listeners asked before each. */
  freeSpot, moveToZone, move, beforeStep, drawsFrames,
  /** Cost confirmation when a token is dragged during tactical play. */
  tactical, tacticalOn: () => !!TACT,
  /** One language of zones while a combat module runs: numbers on every zone, no distance badges, zones shown to this client. */
  present,
  /** How much the camera follows a fight on this client (the director's combat stage): the user's switch and a combat module's default. */
  camera: (o) => moduleApi.directorStage?.camera?.(o) ?? null,
  /** Bring what a combat module names into the free part of this client's screen (dev/zones-api.md 38); "My view" takes it back. */
  frame: (spec) => moduleApi.directorStage?.frame?.(spec) ?? Promise.resolve({ ok: false, reason: "noStage" }),
  frameBack: () => { moduleApi.directorStage?.home?.(); },
  /** The action camera of a fight a combat module drives (dev/zones-api.md 39): a beat of an exchange, shot on this client only. */
  shot: (spec) => moduleApi.directorStage?.shot?.(spec) ?? Promise.resolve({ ok: false, reason: "noStage" }),
  shotEnd: () => moduleApi.directorStage?.shotEnd?.() ?? false,
  /** Who runs the rules: a combat module takes the map's own mechanics over (fire round, wrecking numbers, distance badges). */
  rulesDriver, drivenBy, wreckText,
  /** Why a write was refused, in the user's language; the active GM's name. */
  refusalText, activeGmName,
  /** The pure parts, for tests and other modules. */
  places: Places, keysLib: Keys, borders: Borders, statesLib: States, moves: Moves
};

export function registerZones() {
  // highlights and zone picking (interact.mjs): api.highlight, clearHighlights, highlights, showReach, pick, cancelPick, picking
  Object.assign(zonesApi, interactApi);
  registerInteract();
  // interaction on the map (board.mjs): token marks, lines, a move and an area under the pointer, menus, intentions
  Object.assign(zonesApi, boardApi);
  registerBoard();
  moduleApi.zones = zonesApi;
  Hooks.once("init", registerSettings);
  Hooks.once("setup", patchRuler);
  Hooks.once("ready", () => { patchRuler(); const m = game.modules.get(MODULE_ID); if ( m ) { m.api ??= moduleApi; m.api.zones ??= zonesApi; } });
  Hooks.on("canvasReady", onCanvasReady);
  Hooks.on("canvasTearDown", teardown);
  Hooks.on("updateScene", onUpdateScene);
  Hooks.on("controlToken", () => refresh());
  // badges and lines keep their size on screen: badges follow every zoom step, lines are drawn again after ~8 %
  Hooks.on("canvasPan", () => { if ( display?.root.visible ) display.onZoom(canvas.stage?.scale.x ?? 1); });
  Hooks.on("updateToken", (doc, changed) => {
    const fm = changed.flags?.[MODULE_ID];
    const alt = !!fm && ["alt", "-=alt", "floor", "-=floor"].some((k) => k in fm);
    if ( alt || "x" in changed || "y" in changed ) altBadge(doc.object);
    if ( ("x" in changed || "y" in changed || alt) && doc.object?.controlled ) refresh();
  });
  // where every token is, for "moinenMapsZoneEvent" (the document's position: told when the move is made, not when it has played)
  Hooks.on("updateToken", (doc, changed, _o, userId) => {
    if ( !S || doc.parent !== canvas.scene ) return;
    // (any change of this module's token flags is looked at: the place is only told when it really differs)
    const level = !!changed.flags?.[MODULE_ID];
    if ( level || "x" in changed || "y" in changed || "width" in changed || "height" in changed ) syncToken(doc, level && !("x" in changed || "y" in changed) ? "level" : "move", userId, _o?.mmMove ?? null);
  });
  Hooks.on("preUpdateToken", onPreUpdateToken);
  Hooks.on("updateToken", (doc, changed, options, userId) => { if ( FREE.size && userId === game.user.id ) onFreePlaced(doc, options); });
  if ( typeof window?.addEventListener === "function" ) {
    // (a press or a release of the pointer says it too: the drop of a drag is told before the token is written)
    for ( const ev of ["keydown", "keyup", "pointerdown", "pointerup"] ) window.addEventListener(ev, (e) => { altKey = !!e.altKey; }, true);
    window.addEventListener("blur", () => { altKey = false; });
  }
  Hooks.on("createToken", (doc, _o, userId) => { if ( S && doc.parent === canvas.scene ) syncToken(doc, "create", userId); });
  Hooks.on("deleteToken", (doc, _o, userId) => { if ( S && doc.parent === canvas.scene ) dropToken(doc, userId); });
  Hooks.on("drawToken", (t) => altBadge(t));
  Hooks.on("refreshToken", (t) => { if ( t._mmAlt || altOf(t.document) !== "ground" ) altBadge(t); });
  // a token that walks out of its building leaves its floor behind (the client that moved it clears the flag)
  Hooks.on("updateToken", (doc, changed, _o, userId) => {
    if ( userId !== game.user.id || !("x" in changed || "y" in changed) || !doc.getFlag(MODULE_ID, "floor") || !Z || !doc.object ) return;
    if ( !floorOf(doc.object) ) doc.unsetFlag(MODULE_ID, "floor");
  });
  Hooks.on("moinenMapsZones", (kind) => { if ( kind !== "section" ) altBadges(); });
  Hooks.on("renderTokenHUD", onTokenHUD);
  for ( const h of ["moinenMapsFire", "moinenMapsWater", "moinenMapsDestruction"] ) Hooks.on(h, onLayer);
  Hooks.on("updateItem", (item) => { if ( item.parent && canvas.tokens?.controlled.some((t) => t.actor === item.parent) ) refresh(); });
  window.addEventListener("beforeunload", () => flushSave());
  document.addEventListener("visibilitychange", () => { if ( document.visibilityState === "hidden" ) flushSave(); });
}
