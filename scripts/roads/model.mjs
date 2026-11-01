import { MODULE_ID } from "../config.mjs";
import { emptyGraph } from "./graph.mjs";

/**
 * The roads of a scene, stored in one scene flag `flags.moinen-maps.roads` (written by the GM, read by everyone):
 *
 *   { v: 1,
 *     n: [[id, x, y], ...],                         nodes, scene pixels (rounded to 0.1)
 *     e: [[id, a, b, kind, width, lanes, oneway, [x, y, ...], speed?], ...]
 *                                                   edges; the flat list is the interior control points (ends are the nodes)
 *     next: id counter,
 *     traffic: { on, density, speed, size, max, kinds, side, lights, who, style, seed },
 *     look: { shadow, ink, marks, crossings, guides } }
 *
 * Kind "guide" (same v1 payload: older sets simply have none) is a road traced over one drawn in the map image.
 *
 * Arrays replace each other on update, so a save never leaves stale roads behind.
 */
export const FLAG = "roads";
export const VERSION = 1;

/** Road kinds, lowest first: where two kinds overlap at a junction the later one is drawn on top. `cars` = cars may drive it. */
export const KINDS = ["guide", "dirt", "path", "cobble", "asphalt"];
export const KIND_INFO = {
  // a guide line traces a road that is already drawn in the map image: cars drive it, the module paints nothing there
  guide: { cars: true, speed: 1, painted: false },
  dirt: { cars: true, speed: 0.6 },
  path: { cars: false, speed: 0 },
  cobble: { cars: true, speed: 0.75 },
  asphalt: { cars: true, speed: 1 }
};

export const BODY_TYPES = ["compact", "sedan", "van", "pickup", "truck", "bus", "taxi"];

export const TRAFFIC_DEFAULTS = Object.freeze({
  on: true, density: 0.5, speed: 1, size: 0.45, vary: 0, max: 60, kinds: [...BODY_TYPES], side: "right", lights: "auto", who: "all", style: "ink", seed: 1
});
/** guides: when the GM sees guide lines: "tool" (only while a road tool is in hand) or "always". Players never see them. */
export const LOOK_DEFAULTS = Object.freeze({ shadow: 0.6, ink: 1, marks: true, crossings: true, guides: "tool" });
export const LIMITS = { width: [0.05, 3], size: [0.03, 1.5], speed: [0.2, 3], max: [0, 150], density: [0, 1], vary: [0, 0.5], roadSpeed: [0.2, 2] };

const r1 = (v) => Math.round(v * 10) / 10;
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

export function cleanTraffic(t = {}) {
  const D = TRAFFIC_DEFAULTS;
  return {
    on: t.on !== false,
    density: num(t.density, D.density, ...LIMITS.density),
    speed: num(t.speed, D.speed, ...LIMITS.speed),
    size: num(t.size, D.size, ...LIMITS.size),
    vary: num(t.vary, D.vary, ...LIMITS.vary),
    max: Math.round(num(t.max, D.max, ...LIMITS.max)),
    kinds: Array.isArray(t.kinds) ? t.kinds.filter((k) => BODY_TYPES.includes(k)) : [...D.kinds],
    side: t.side === "left" ? "left" : "right",
    lights: ["off", "on", "auto"].includes(t.lights) ? t.lights : D.lights,
    who: t.who === "gm" ? "gm" : "all",
    style: t.style === "pixel" ? "pixel" : "ink",
    seed: Math.round(num(t.seed, D.seed, 1, 999999))
  };
}

export function cleanLook(l = {}) {
  const D = LOOK_DEFAULTS;
  return { shadow: num(l.shadow, D.shadow, 0, 1), ink: num(l.ink, D.ink, 0, 3), marks: l.marks !== false, crossings: l.crossings !== false, guides: l.guides === "always" ? "always" : "tool" };
}

/** A fresh, empty roads set. */
export const blank = () => ({ G: emptyGraph(), traffic: cleanTraffic(), look: cleanLook() });

/** The scene's stored roads, decoded (an empty set when nothing is stored). */
export function load(scene) {
  const f = scene?.flags?.[MODULE_ID]?.[FLAG];
  const R = blank();
  if ( !f || typeof f !== "object" ) return R;
  R.traffic = cleanTraffic(f.traffic);
  R.look = cleanLook(f.look);
  const G = R.G;
  for ( const row of Array.isArray(f.n) ? f.n : [] ) {
    const [id, x, y] = row ?? [];
    if ( Number.isFinite(id) && Number.isFinite(x) && Number.isFinite(y) ) G.nodes.set(id, { id, x, y });
  }
  for ( const row of Array.isArray(f.e) ? f.e : [] ) {
    const [id, a, b, k, w, l, o, inner, sp] = row ?? [];
    const A = G.nodes.get(a), B = G.nodes.get(b);
    if ( !Number.isFinite(id) || !A || !B ) continue;
    const mid = Array.isArray(inner) ? inner.filter(Number.isFinite) : [];
    G.edges.set(id, {
      id, a, b, pts: [A.x, A.y, ...mid.slice(0, mid.length & ~1), B.x, B.y],
      k: KINDS.includes(k) ? k : "asphalt", w: num(w, 1, ...LIMITS.width), l: l === 1 ? 1 : 2, o: o ? 1 : 0,
      ...(sp != null && Number(sp) !== 1 ? { sp: num(sp, 1, ...LIMITS.roadSpeed) } : {})
    });
  }
  let max = 0;
  for ( const k of [...G.nodes.keys(), ...G.edges.keys()] ) max = Math.max(max, k);
  G.next = Math.max(Number(f.next) || 1, max + 1);
  return R;
}

/** The flag payload of a roads set. */
export function encode(R) {
  const G = R.G;
  return {
    v: VERSION,
    n: [...G.nodes.values()].map((n) => [n.id, r1(n.x), r1(n.y)]),
    // an optional ninth entry: the road's speed factor (only when it is not 1)
    e: [...G.edges.values()].map((e) => { const row = [e.id, e.a, e.b, e.k, r1(e.w * 10) / 10, e.l, e.o, e.pts.slice(2, -2).map(r1)]; if ( e.sp != null && e.sp !== 1 ) row.push(Math.round(e.sp * 100) / 100); return row; }),
    next: G.next,
    traffic: { ...R.traffic, kinds: [...R.traffic.kinds] },
    look: { ...R.look }
  };
}

export const hasRoads = (R) => !!R && R.G.edges.size > 0;
