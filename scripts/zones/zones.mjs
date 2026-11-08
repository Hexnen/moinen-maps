import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as Model from "./model.mjs";
import * as Geo from "./geometry.mjs";
import { ZoneDisplay } from "./display.mjs";
import { preset, presets, zonesText } from "./presets.mjs";
import * as Editor from "./editor.mjs";
import * as Styles from "./styles.mjs";
import * as Marks from "./marks.mjs";

/**
 * Zones of the open scene. The GM draws loose pencil lines (scripts/zones/editor.mjs); every area the lines close off is a zone
 * (scripts/zones/geometry.mjs). Zones count movement the Year Zero way: the distance between two tokens is the number of zone
 * borders on the shortest route. The scene's preset (scripts/zones/presets.mjs) says what a distance costs: the badges of a selected
 * token's surroundings and the token ruler's label show it.
 *
 * Inside the Zones workspace section the GM sees the raw pencil lines; everywhere else (and for players) only the finished zones.
 * Public API: `game.modules.get("moinen-maps").api.zones`. Hook "moinenMapsZones" with ("loaded" | "edited" | "params" | "section").
 */

let S = null, Z = null, M = null, display = null, saveTimer = 0, inSection = false, hover = -1, hoverRaf = 0, hoverAt = null;
let saveSceneId = null, lastSaved = "";
const undo = [], redo = [];
const UNDO_MAX = 60;

export const tell = (kind) => Hooks.callAll("moinenMapsZones", kind);
export const state = () => S;
export const zones = () => Z;
/** The marks laid onto the zones now: { borders: Map pair -> {kind, x, y, a, b}, zones: Map id -> props }. */
export const marks = () => M;
export const editing = () => inSection && !!game.user?.isGM;
export const gridSize = () => canvas.dimensions?.size ?? canvas.grid?.size ?? 100;
const sceneRect = () => { const r = canvas.dimensions?.sceneRect; return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; };

/* ---------------------------------------------------------------- settings */

function registerSettings() {
  const R = (k, type, def, onChange) => game.settings.register(MODULE_ID, k, { scope: "client", config: false, type, default: def, onChange });
  R("zonesDistances", Boolean, true, () => { refresh(); tell("params"); });
  R("zonesEraser", Number, 0.5, () => tell("params"));
  R("zonesRuler", Boolean, true, () => tell("params"));
  // world defaults: look presets saved by the GM, the default look preset and movement preset (scenes may pick their own)
  const W = (k, type, def) => game.settings.register(MODULE_ID, k, { scope: "world", config: false, type, default: def, onChange: () => { refresh(); tell("params"); } });
  W("zonesStyles", Object, { list: [] });
  W("zonesStyleDefault", String, "classic");
  W("zonesPresetDefault", String, "invincible");
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

function rebuild() {
  const g = gridSize();
  // smoothing works on screen-sized steps of the line (scene pixels), so it looks the same on small- and large-grid maps
  const step = Math.max(3, Math.min(g * 0.15, 12));
  const lines = S ? [...S.strokes.values()].map((p) => Geo.smoothLine(p, S.smooth, step)) : [];
  // a zone is at least one grid square; the scene's edge closes zones where lines reach it
  Z = S && S.strokes.size ? Geo.buildZones(lines, { snap: S.snap * g, merge: 0.5, minArea: g * g, edge: sceneRect() }) : null;
  // walls and zone marks keep to the border / zone their point lies on, whatever the zones are numbered now
  M = Marks.resolve(Z, S?.walls, S?.marks, (x, y) => Geo.zoneAt(Z, x, y), markTol());
}
const markTol = () => gridSize() * 0.35;

/** Who sees the finished zones: always the GM drawing them, else as the scene says. */
export function visibleToMe() {
  if ( !S || !Z ) return false;
  if ( editing() ) return true;
  const who = look().who;
  return who === "all" || (who === "gm" && game.user.isGM);
}

/** The one token selected (and owned) on this client, or null. */
function selectedToken() {
  const c = canvas.tokens?.controlled ?? [];
  return c.length === 1 && c[0].isOwner ? c[0] : null;
}

/** A token's centre where it stands (its document, not the animation). */
export function tokenCenter(t) {
  const d = t.document, g = gridSize();
  return { x: d.x + (d.width * g) / 2, y: d.y + (d.height * g) / 2 };
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
  const t = setting("zonesDistances", true) ? selectedToken() : null;
  // Sky High and Orbit are off the map (one zone of their own): no distances on the map from there
  if ( t && Z && !OFF_MAP.has(altOf(t.document)) ) {
    const c = tokenCenter(t);
    here = Geo.zoneAt(Z, c.x, c.y);
    if ( here >= 0 ) {
      // each way of moving counts its own route past the walls (marks.mjs); the preset picks the cheapest and says what it costs
      const D = Marks.moveDistances(Z, here, M), p = preset(movePreset()), moves = movesOf(t.actor);
      dist = new Map(); bands = p ? new Map() : null;
      for ( const z of Z.zones ) {
        const dd = Marks.distancesTo(D, z.id), b = p?.band(dd, moves);
        if ( b ) { bands.set(z.id, b); if ( b.d != null ) dist.set(z.id, b.d); }
        else if ( dd.walk != null ) dist.set(z.id, dd.walk);
      }
    }
  }
  display.hoverId = hover;
  display.render(Z, look(), gridSize(), { dist, bands, here, hover, editing: editing(), zoom: canvas.stage.scale.x, marks: M });
}

/* ---------------------------------------------------------------- numbers on hover */

/** The zone under the cursor (numbers "hover", border highlight): one check per frame at most, a redraw only when it changes. */
function onHoverMove(ev) {
  const L = look();
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
function setHover(id) { if ( id === hover ) return; hover = id; if ( look()?.numbers === "hover" ) refresh(); else display?.drawHover(id); }
const onHoverLeave = () => { hoverAt = null; if ( hover >= 0 ) setHover(-1); };

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
  rebuild(); refresh();
  Editor.onCanvasReady();
  tell("loaded");
}

function teardown() {
  flushSave();
  clearTimeout(saveTimer); saveTimer = 0;
  Editor.teardown();
  canvas.app?.view?.removeEventListener("pointermove", onHoverMove);
  canvas.app?.view?.removeEventListener("pointerleave", onHoverLeave);
  cancelAnimationFrame(hoverRaf); hoverRaf = 0; hoverAt = null; hover = -1;
  display?.destroy(); display = null;
  S = Z = M = null;
  undo.length = redo.length = 0;
}

function onUpdateScene(scene, changed, _o, userId) {
  if ( scene.id !== canvas.scene?.id || !S ) return;
  const f = changed.flags?.[MODULE_ID];
  if ( !f || !(Model.FLAG in f || `-=${Model.FLAG}` in f) ) return;
  if ( userId === game.user.id ) return;
  S = Model.load(scene);
  lastSaved = JSON.stringify(Model.encode(S));
  rebuild(); refresh(); tell("loaded");
}

/* ---------------------------------------------------------------- editing (GM) */

const snapshot = () => JSON.stringify(Model.encode(S));
const restore = (text) => { S = Model.load({ flags: { [MODULE_ID]: { [Model.FLAG]: JSON.parse(text) } } }); };

/**
 * Change the lines: `fn(strokes, S)` edits a copy (a Map id -> points) and returns true when it changed something. One undo step.
 */
export function edit(fn) {
  if ( !game.user.isGM || !S ) return false;
  const before = snapshot();
  const next = Model.canonical(S);
  if ( !fn(next.strokes, next) ) return false;
  undo.push(before); if ( undo.length > UNDO_MAX ) undo.shift();
  redo.length = 0;
  S = Model.canonical(next);
  rebuild(); refresh(); scheduleSave(); tell("edited");
  return true;
}

export function undoEdit() { const s = undo.pop(); if ( !s || !S ) return false; redo.push(snapshot()); restore(s); rebuild(); refresh(); scheduleSave(); tell("edited"); return true; }
export function redoEdit() { const s = redo.pop(); if ( !s || !S ) return false; undo.push(snapshot()); restore(s); rebuild(); refresh(); scheduleSave(); tell("edited"); return true; }
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
  S = Model.canonical(next);
  if ( snapChanged ) rebuild();
  refresh(); scheduleSave(); tell("params");
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
    const dd = Marks.distancesTo(Marks.moveDistances(Z, a, M), b);
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
      if ( !ctx || !Z || !setting("zonesRuler", true) || !visibleToMe() || !waypoint.previous ) return ctx;
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
  return nb ? { ...nb, kind: M?.borders.get(Marks.pairKey(nb.a, nb.b))?.kind ?? "open" } : null;
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
    return JSON.stringify(s.walls) !== before;
  });
}

/** A point inside a zone to keep its mark on: where its mark is now, else `prefer` when it lies in the zone, else the label spot. */
function zonePoint(id, prefer) {
  for ( const [x, y] of S.marks ) if ( Geo.zoneAt(Z, x, y) === id ) return [x, y];
  if ( prefer && Geo.zoneAt(Z, prefer.x, prefer.y) === id ) return [prefer.x, prefer.y];
  const z = Z.zones.find((q) => q.id === id);
  return z ? [z.label.x, z.label.y] : null;
}

/** Write the props of some zones (id -> props; empty props drop the mark). One undo step. */
function writeZones(map, prefer) {
  if ( !Z || !map.size ) return false;
  const at = new Map([...map.keys()].map((id) => [id, zonePoint(id, prefer)]));
  return edit((_st, s) => {
    const before = JSON.stringify(s.marks);
    s.marks = s.marks.filter(([x, y]) => !map.has(Geo.zoneAt(Z, x, y)));
    for ( const [id, p] of map ) { const c = Marks.cleanProps(p); if ( Object.keys(c).length && at.get(id) ) s.marks.push([...at.get(id), c]); }
    return JSON.stringify(s.marks) !== before;
  });
}

/** Change a zone's features / states: { building, tall, water, terrain, wrecked, fire (0..12), dark, ice, flooded, lowgrav }. */
export function setZone(id, patch, at = null) {
  if ( !Z || id < 0 ) return false;
  return writeZones(new Map([[id, { ...(M?.zones.get(id) ?? {}), ...patch }]]), at);
}

/** Clear the states (not the features) of one zone, or of every zone (end of the scene). */
export function clearStates(id = null) {
  const map = new Map();
  for ( const [zid, p] of M?.zones ?? [] ) if ( (id == null || zid === id) && Marks.hasStates(p) ) map.set(zid, Marks.withoutStates(p));
  return writeZones(map);
}

/** One round of fire (book: Fire Spreading): a D6 for every burning zone, the result written and told in the chat. */
export async function fireRound() {
  if ( !game.user.isGM || !Z || !M ) return null;
  const { next, log } = Marks.fireRound(Z, M);
  const L = (k, d) => game.i18n.format(`MOINENMAPS.Zones.fire.${k}`, d ?? {});
  if ( !log.length ) { ui.notifications.info(L("none")); return log; }
  writeZones(new Map([...next].map(([id, p]) => [id, p])));
  const num = (id) => id + 1;
  const rows = log.map((r) => {
    const d = { n: num(r.id), r: r.roll, to: r.to != null ? num(r.to) : "" };
    return `<li>${r.out ? L("out", d) : r.to != null ? L("spread", d) : r.roll >= 5 ? L("blocked", d) : L("stays", d)}</li>`;
  });
  await ChatMessage.create({ speaker: { alias: game.i18n.localize("MOINENMAPS.Zones.fire.title") }, content: `<ul class="mm-z-fire">${rows.join("")}</ul>` });
  return log;
}

/* ---------------------------------------------------------------- token altitude (Invincible: ground, elevated, Sky High, Orbit) */

export const ALTS = ["ground", "elevated", "sky", "orbit"];
const OFF_MAP = new Set(["sky", "orbit"]);
/** A token's altitude (its flag; "ground" when unset). */
export const altOf = (doc) => { const a = doc?.getFlag?.(MODULE_ID, "alt"); return ALTS.includes(a) ? a : "ground"; };
export async function setAltitude(token, alt) {
  const doc = token?.document ?? token;
  if ( !doc?.isOwner || !ALTS.includes(alt) ) return;
  return alt === "ground" ? doc.unsetFlag(MODULE_ID, "alt") : doc.setFlag(MODULE_ID, "alt", alt);
}

/** A small tag on a token that is not on the ground (only where the zones show). */
function altBadge(t) {
  if ( !t || t.destroyed ) return;
  const alt = altOf(t.document), show = alt !== "ground" && !!Z && visibleToMe();
  if ( !show ) { if ( t._mmAlt ) { t._mmAlt.destroy({ children: true }); t._mmAlt = null; } return; }
  const text = `▲ ${game.i18n.localize(`MOINENMAPS.Zones.altShort.${alt}`)}`;
  if ( t._mmAlt?.destroyed ) t._mmAlt = null;
  if ( !t._mmAlt ) {
    const c = new PIXI.Container(); c.eventMode = "none";
    c.addChild(new PIXI.Graphics(), new PIXI.Text("", { fontFamily: "Signika, sans-serif", fontWeight: "700", fontSize: 13, fill: 0xf3e7c9 }));
    c.children[1].anchor.set(0.5); c.children[1].resolution = 3;
    t._mmAlt = t.addChild(c);
  }
  const [G, T] = t._mmAlt.children;
  T.text = text;
  const w = T.width + 12, col = alt === "elevated" ? 0x5cc8ff : alt === "sky" ? 0xc38bff : 0xe06666;
  G.clear().lineStyle({ width: 1.5, color: col }).beginFill(0x15110f, 0.85).drawRoundedRect(-w / 2, -10, w, 20, 9).endFill();
  const s = Math.max(0.6, Math.min(2, t.w / 100));
  t._mmAlt.scale.set(s);
  t._mmAlt.position.set(t.w / 2, -4 * s);
}
const altBadges = () => { for ( const t of canvas.tokens?.placeables ?? [] ) altBadge(t); };

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
    const a = altOf(t.document);
    btn.innerHTML = `<i class="fa-solid ${icon[a]}"></i>`;
    btn.dataset.tooltip = game.i18n.format("MOINENMAPS.Zones.altHud", { a: game.i18n.localize(`MOINENMAPS.Zones.alt.${a}`) });
    btn.classList.toggle("active", a !== "ground");
  };
  show();
  btn.addEventListener("click", async (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const a = altOf(t.document), i = ALTS.indexOf(a);
    await setAltitude(t, ALTS[(i + (ev.shiftKey ? ALTS.length - 1 : 1)) % ALTS.length]);
    show();
  });
  btn.addEventListener("contextmenu", async (ev) => { ev.preventDefault(); ev.stopPropagation(); await setAltitude(t, "ground"); show(); });
  col.append(btn);
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
  marks: () => M, borderAt, setBorder, setZone, clearStates, fireRound, altitude: altOf, setAltitude, rules: Marks,
  refresh,
  /** Pure geometry, for tests and other modules. */
  geometry: Geo
};

export function registerZones() {
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
    const alt = changed.flags?.[MODULE_ID] && ("alt" in changed.flags[MODULE_ID] || "-=alt" in changed.flags[MODULE_ID]);
    if ( alt ) altBadge(doc.object);
    if ( ("x" in changed || "y" in changed || alt) && doc.object?.controlled ) refresh();
  });
  Hooks.on("drawToken", (t) => altBadge(t));
  Hooks.on("refreshToken", (t) => { if ( t._mmAlt || altOf(t.document) !== "ground" ) altBadge(t); });
  Hooks.on("moinenMapsZones", (kind) => { if ( kind !== "section" ) altBadges(); });
  Hooks.on("renderTokenHUD", onTokenHUD);
  Hooks.on("updateItem", (item) => { if ( item.parent && canvas.tokens?.controlled.some((t) => t.actor === item.parent) ) refresh(); });
  window.addEventListener("beforeunload", () => flushSave());
  document.addEventListener("visibilitychange", () => { if ( document.visibilityState === "hidden" ) flushSave(); });
}
