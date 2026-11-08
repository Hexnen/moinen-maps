import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as Dir from "./core.mjs";
import { emit, isLeader, killed, publicName } from "./director.mjs";
import { zoneName } from "../zones/zones.mjs";

const zoneLabel = (id) => { try { return zoneName(id); } catch { return String(id + 1); } };

/**
 * THE MODULE'S OWN EVENTS, the director's first source. Every client keeps the snapshots (cheap: ids and a few flags), only the
 * LEADER emits, so a new leader (the GM left) carries on without a burst of old events. Everything is read from the documents every
 * client gets (scene / token updates), at the moment the players get them too:
 *   - destruction: a new stroke in flags.destructionObjects (not staged: staged strokes play in the destruction show), its box from the
 *     mask px; a carry (tk) or a Superhero plough (tk.hit) follows the token; a flood hole is its own kind;
 *   - fire: a new burning stroke in flags.fireStrokes (a fireball takes the camera; the layer hidden from the players = GM only);
 *   - zones: a zone newly wrecked (quake), on fire, flooded, or with a new state of the GM's (dark, ice, low gravity: GM only while the
 *     zones are hidden from the players);
 *   - orbit: a token leaving for orbit (deleteToken with options.mmOrbit.dir "up") and one landing (createToken, "down");
 *   - altitude and floors: a token's flags alt / floor.
 * A hidden token makes its event GM-only; a token's name travels only when every player may read it (publicName).
 */

const flagsOf = (scene) => scene?.flags?.[MODULE_ID] ?? {};
const grid = () => canvas?.dimensions?.size ?? 100;
const live = () => !killed() && canvas?.ready && isLeader();

/* ---------------------------------------------------------------- destruction */

const TYPES = ["blast", "collapse", "scorch", "flood", "cracks", "gash"];
const TYPE_K = { blast: 1.15, collapse: 1.25, scorch: 0.75, flood: 1, cracks: 0.6, gash: 0.95 };
const MK = 2;                                    // mask px per art px (destruction model K)
let dIds = null;                                 // stroke ids known on this scene

function strokeBox(o, ap) {
  const r = canvas.dimensions.sceneRect, m = ap * MK;
  return { x0: r.x + o.x0 * m, y0: r.y + o.y0 * m, x1: r.x + (o.x0 + o.w) * m, y1: r.y + (o.y0 + o.h) * m };
}
function onDestruction(objs, scene, apIn = null) {
  const ap = Number(apIn ?? flagsOf(scene).destruction?.ap) || 1;
  for ( const [id, o] of Object.entries(objs) ) {
    if ( id.startsWith("-=") || !o || typeof o !== "object" || o.k || o.cin ) continue;      // erase strokes; staged / show strokes (the show plays them)
    if ( dIds.has(id) ) continue;
    dIds.add(id);
    if ( !live() || !Number.isFinite(o.x0) || !Number.isFinite(o.w) ) continue;
    const box = strokeBox(o, ap), size = Math.max(box.x1 - box.x0, box.y1 - box.y0), type = TYPES[o.t] ?? "blast";
    if ( o.tk && typeof o.tk === "object" ) { carryEvent(o, box, ap, scene); continue; }
    const c = Dir.boxCentre(box);
    emit({ kind: type === "flood" ? "flood" : "destruction", src: "destruction", id: `d-${id}`, ref: id, weight: Dir.sizeWeight(size, grid(), TYPE_K[type] ?? 1), box, x: c.x, y: c.y,
      caption: { key: `Dir.cap.${type}`, data: {} } });
  }
}
/** A carried token (tk): the camera frames the whole carry and drifts along it; with hits it is the Superhero plough. */
function carryEvent(o, box, ap, scene) {
  const tk = o.tk, d = scene.tokens.get(tk.id), g = grid();
  const w = (d?.width ?? 1) * g, h = (d?.height ?? 1) * g;
  const a = { x: tk.x0 + w / 2, y: tk.y0 + h / 2 }, b = { x: tk.x1 + w / 2, y: tk.y1 + h / 2 };
  let fb = Dir.unionBox(Dir.pointBox(a.x, a.y, g), Dir.pointBox(b.x, b.y, g));
  fb = Dir.unionBox(fb, box);
  const hits = Array.isArray(tk.hit) ? tk.hit.filter((q) => q && typeof q.id === "string") : [];
  const p = Array.isArray(tk.p) ? tk.p : [], dur = p.length >= 3 ? Number(p[p.length - 1]) || 0 : 0;
  const hidden = !!d?.hidden || hits.some((q) => scene.tokens.get(q.id)?.hidden);
  emit({ kind: hits.length ? "plough" : "carry", src: "destruction", id: `c-${o.id}`, ref: o.id, weight: hits.length ? 0.9 : 0.7, box: fb, x: b.x, y: b.y,
    tokens: [tk.id, ...hits.map((q) => q.id)], path: [a.x, a.y, b.x, b.y], dur: dur ? Math.min(3500, dur + 600) : null, who: hidden ? "gm" : "all",
    caption: { key: hits.length ? "Dir.cap.plough" : "Dir.cap.carry", data: { token: tk.id, name: d ? publicName(d) : "", n: hits.length } } });
}

/** The leader painted it itself ("edited" comes before the save): the event goes at once, the players' entry starts after the save and
 * the bake, so the camera is on its way before the damage shows. The flag path above then knows the ids. */
function onDestructionHook(kind) {
  if ( kind !== "edited" || !dIds || !live() ) return;
  const S = moduleApi.destruction?.state?.(); if ( !S?.o ) return;
  const fresh = {};
  for ( const o of S.o ) if ( o?.id && !dIds.has(o.id) ) fresh[o.id] = o;
  if ( Object.keys(fresh).length ) onDestruction(fresh, canvas.scene, S.ap);
}

/* ---------------------------------------------------------------- fire */

let fIds = null;
function onFire(strokes, scene) {
  const P = flagsOf(scene).fire ?? {};
  for ( const [id, s] of Object.entries(strokes) ) {
    if ( id.startsWith("-=") || !s || typeof s !== "object" ) continue;
    if ( fIds.has(id) ) continue;
    fIds.add(id);
    if ( !live() || s.k === "erase" || s.o !== undefined || !Array.isArray(s.p) || s.p.length < 2 ) continue;
    const r = Number(s.r) || grid() * 0.5;
    let box = null; for ( let i = 0; i + 1 < s.p.length; i += 2 ) box = Dir.unionBox(box, Dir.pointBox(s.p[i], s.p[i + 1], r));
    if ( !box ) continue;
    const ball = s.st === "fireball", lv = Number(s.lv) || 1, size = Math.max(box.x1 - box.x0, box.y1 - box.y0);
    const c = ball ? { x: s.p[0], y: s.p[1] } : Dir.boxCentre(box);
    emit({ kind: ball ? "destruction" : "fire", src: "fire", id: `f-${id}`, weight: ball ? 0.8 : Dir.clamp(0.12 + 0.08 * lv + 0.4 * Dir.sizeWeight(size, grid()), 0, 0.75), box, x: c.x, y: c.y,
      who: P.on === false || P.who === "gm" ? "gm" : "all", caption: { key: ball ? "Dir.cap.fireball" : s.k === "smoke" ? "Dir.cap.smoke" : "Dir.cap.fire", data: {} } });
  }
}

/* ---------------------------------------------------------------- zones */

let zSnap = null;                                // label key -> props
const zKey = (z) => `${Math.round(z.label?.x ?? z.cx)}:${Math.round(z.label?.y ?? z.cy)}`;
function onZones(kind) {
  if ( kind !== "edited" && kind !== "linked" && kind !== "loaded" ) return;
  const Z = moduleApi.zones?.zones?.(), M = moduleApi.zones?.marks?.();
  if ( !Z?.zones || !M?.zones ) return;
  const next = new Map(), first = zSnap === null;
  const derived = moduleApi.zones?.mapStates?.() ?? new Map();
  const look = moduleApi.zones?.look?.() ?? {}, shown = (look.who ?? "all") === "all", at2 = upTime(canvas.scene);
  for ( const z of Z.zones ) {
    const p = M.zones.get(z.id) ?? {}, key = zKey(z), before = zSnap?.get(key) ?? {};
    next.set(key, { ...p });
    if ( first || !live() ) continue;
    let box = null; for ( const ring of z.rings ?? [] ) for ( let i = 0; i + 1 < ring.length; i += 2 ) box = Dir.unionBox(box, Dir.pointBox(ring[i], ring[i + 1], 0));
    const at = { x: z.label?.x ?? z.cx, y: z.label?.y ?? z.cy };
    box ??= Dir.pointBox(at.x, at.y, grid());
    const size = Math.sqrt(Math.max(0, z.area ?? 0)), name = zoneLabel(z.id);
    const fromMap = (k) => !!(derived instanceof Map ? derived.get(z.id) : derived?.[z.id])?.[k];
    const who = (k) => (fromMap(k) || shown ? "all" : "gm");
    const add = (k, kind2, weight, cap) => emit({ kind: kind2, src: "zones", id: `z-${key}-${k}-${at2}`, weight, box, x: at.x, y: at.y, who: who(k), caption: { key: cap, data: { zone: name } } });
    if ( p.wrecked && !before.wrecked ) add("wrecked", "quake", Dir.clamp(0.5 + 0.5 * Dir.sizeWeight(size, grid()), 0, 1), "Dir.cap.quake");
    if ( (p.fire ?? 0) > 0 && !(before.fire > 0) ) add("fire", "fire", 0.45, "Dir.cap.zoneFire");
    else if ( (p.fire ?? 0) > (before.fire ?? 0) + 1 ) add("fire", "fire", 0.3, "Dir.cap.zoneFireUp");
    if ( p.flooded && !before.flooded ) add("flooded", "flood", 0.4, "Dir.cap.zoneFlood");
    for ( const k of ["dark", "ice", "lowgrav"] ) if ( p[k] && !before[k] ) add(k, "zoneState", 0.3, `Dir.cap.zone_${k}`);
  }
  zSnap = next;
}

/* ---------------------------------------------------------------- tokens: orbit, altitude, floors */

/** The server's time of a document's last change, base 36 (the same on every client): makes an event id unique per change. */
const upTime = (doc) => Math.round(Number(doc?._stats?.modifiedTime) || Date.now()).toString(36);
function tokenBox(d) { const g = grid(), w = (d.width ?? 1) * g, h = (d.height ?? 1) * g; return { x0: d.x, y0: d.y, x1: d.x + w, y1: d.y + h }; }
function onDeleteToken(doc, options) {
  if ( options?.mmOrbit?.dir !== "up" || doc.parent?.id !== canvas.scene?.id || !live() ) return;
  const b = tokenBox(doc), c = Dir.boxCentre(b);
  emit({ kind: "orbitUp", src: "orbit", id: `o-${doc.id}-up`, weight: 0.85, box: Dir.unionBox(b, Dir.pointBox(c.x, c.y, grid() * 2)), x: c.x, y: c.y, who: doc.hidden ? "gm" : "all",
    caption: { key: "Dir.cap.orbitUp", data: { token: doc.id, name: publicName(doc) } } });
}
function onCreateToken(doc, options) {
  if ( options?.mmOrbit?.dir !== "down" || doc.parent?.id !== canvas.scene?.id || !live() ) return;
  const b = tokenBox(doc), c = Dir.boxCentre(b);
  emit({ kind: "orbitDown", src: "orbit", id: `o-${doc.id}-down`, weight: 0.8, box: Dir.unionBox(b, Dir.pointBox(c.x, c.y, grid() * 2)), x: c.x, y: c.y, tokens: [doc.id], who: doc.hidden ? "gm" : "all",
    caption: { key: "Dir.cap.orbitDown", data: { token: doc.id, name: publicName(doc) } } });
}
const ALT_W = { ground: 0.3, elevated: 0.3, sky: 0.4 };
function onUpdateToken(doc, changed) {
  const f = changed?.flags?.[MODULE_ID];
  if ( !f || doc.parent?.id !== canvas.scene?.id || !live() ) return;
  const b = tokenBox(doc), c = Dir.boxCentre(b), who = doc.hidden ? "gm" : "all", data = { token: doc.id, name: publicName(doc) };
  // a removed key arrives as "-=key" or (v14) as a deletion operator object; the id carries the update's server time, the same on
  // every client (two leaders dedupe) but new for every change (sky, ground, sky again all play)
  const gone = (k) => `-=${k}` in f || (f[k] !== null && typeof f[k] === "object");
  const at = upTime(doc);
  if ( "alt" in f || "-=alt" in f ) {
    const alt = gone("alt") || !f.alt ? "ground" : String(f.alt);
    if ( alt !== "orbit" && ALT_W[alt] !== undefined ) emit({ kind: "altitude", src: "altitude", id: `a-${doc.id}-${alt}-${at}`, weight: ALT_W[alt], box: b, x: c.x, y: c.y, tokens: [doc.id], who, caption: { key: `Dir.cap.alt_${alt}`, data } });
  }
  if ( "floor" in f || "-=floor" in f ) {
    const n = gone("floor") ? 0 : Number(f.floor) || 0;
    emit({ kind: "floor", src: "altitude", id: `fl-${doc.id}-${n}-${at}`, weight: 0.25, box: b, x: c.x, y: c.y, tokens: [doc.id], who, caption: { key: n ? "Dir.cap.floor" : "Dir.cap.floorGround", data: { ...data, n } } });
  }
}

/* ---------------------------------------------------------------- wiring */

function onUpdateScene(scene, changed) {
  if ( scene.id !== canvas.scene?.id ) return;
  const f = changed?.flags?.[MODULE_ID]; if ( !f ) return;
  if ( f.destructionObjects && typeof f.destructionObjects === "object" && dIds ) onDestruction(f.destructionObjects, scene);
  if ( f.fireStrokes && typeof f.fireStrokes === "object" && fIds ) onFire(f.fireStrokes, scene);
}
function onCanvasReady() {
  const f = flagsOf(canvas.scene);
  dIds = new Set(Object.keys(f.destructionObjects ?? {}));
  fIds = new Set(Object.keys(f.fireStrokes ?? {}));
  zSnap = null;
  // (the zones are worked out after canvasReady: their "loaded" takes the first snapshot)
}

export function registerSources() {
  Hooks.on("canvasReady", onCanvasReady);
  Hooks.on("canvasTearDown", () => { dIds = fIds = zSnap = null; });
  Hooks.on("updateScene", onUpdateScene);
  Hooks.on("moinenMapsZones", onZones);
  Hooks.on("moinenMapsDestruction", onDestructionHook);
  Hooks.on("deleteToken", onDeleteToken);
  Hooks.on("createToken", onCreateToken);
  Hooks.on("updateToken", onUpdateToken);
}
export const _sources = { snap: () => ({ d: dIds?.size ?? null, f: fIds?.size ?? null, z: zSnap?.size ?? null }) };
