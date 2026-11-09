/**
 * THE EXPLOSION FIRE ("burst"), the pure part (no Foundry, no PIXI: node-tested in dev/burst-model.test.mjs). A stroke kind of the
 * fire layer for a point event - a grenade's dirty flash, a shell's fireball, a bomb's rolling mushroom - stored with the fire strokes
 * (flags.moinen-maps.fireStrokes) and played by every client from its record and the shared clock (burst-art.mjs draws it):
 *
 *   stroke = { ..., k: "burst", p: [x, y] (the ground point, scene px), r: the fireball's radius (scene px), lv: 1..3, q: the impact
 *              (shared clock ms), c?: colour (look.mjs; absent: the scene's), wd / ws: wind, db?: [dx, dy, ms, ...] burning DEBRIS thrown
 *              out (each lands at (x + dx, y + dy) ms after q: where a preset puts a small fire), o?: taken back (it fades at once) }
 *
 * LEVELS: 1 a grenade (a dirty brown-grey puff round a short orange heart, mostly ground dust, no stem), 2 a shell or rocket (a fireball
 * that rolls up into a short dark column), 3 a bomb (a white-hot core, a rolling cauliflower fireball, a mushroom cap on a stem that
 * darkens into the smoke column). The size follows r.
 * TIME: one life from q (BURST_LV.life): it never waits for an `o`; a burst whose life is over is gone (the GM purges its record).
 * Reduced motion: no fireball at all (gone). A burst is ONE area of its own (never merged): the field is a small descriptor, not cells.
 */
import { windVec, litTime, hash4 } from "./model.mjs";

/** Per LEVEL ([_, L1, L2, L3]): life (s), the cap's height (x r, world: x the view's lift on screen), lobes, stem lobes, base surge lobes,
 * sparks, the heat's decay (s), the light (radius x r, peak). */
export const BURST_LV = {
  life: [0, 2.2, 5, 8.5],
  rise: [0, 0.9, 2.2, 3.4],
  lobes: [0, 12, 20, 28],
  stem: [0, 0, 4, 8],
  surge: [0, 20, 20, 24],
  sparks: [0, 18, 30, 46],
  hot: [0, 0.16, 0.42, 0.62],
  lightR: [0, 3.5, 4.5, 6],
  lightI: [0, 0.75, 1.0, 1.35]
};
/** A burst taken back (o) fades out over this long (s). */
export const BURST_FADE = 0.6;
/** Debris pieces a burst may throw. */
export const MAX_DEBRIS = 16;
/** The view's largest lift (view-angle.mjs): the area holds the cap at any view. */
const LIFT_MAX = 0.8;

const lvOf = (st) => Math.min(3, Math.max(1, st.lv | 0 || 2));

/** A burst's ground point and radius in cells. */
function pointOf(st, geo) {
  return { x: (st.p[0] - geo.ox) / geo.ap, y: (st.p[1] - geo.oy) / geo.ap, R: Math.max(2, st.r / geo.ap) };
}

/** Its debris: [[dx, dy (cells), t (s)], ...]. */
export function debrisOf(st, geo) {
  const d = Array.isArray(st.db) ? st.db : [], out = [];
  for ( let i = 0; i + 2 < d.length && out.length < MAX_DEBRIS; i += 3 ) out.push([d[i] / geo.ap, d[i + 1] / geo.ap, Math.max(0.12, d[i + 2] / 1000)]);
  return out;
}

/**
 * What a burst can reach (cells, integers, x1 / y1 exclusive): every body of its motion (burstAt) at every frame of its life, at the
 * four corners of the views a scene may have (lift 0..0.8, squash 0.6..1: a body's screen point is linear in both), plus the scene
 * wind's drift and a margin - nothing it draws is ever cut by its rectangle (no straight edge). Memoised per stroke and geometry.
 */
const RECTS = new Map();
const CORNERS = [{ lift: 0, squash: 0.6 }, { lift: 0, squash: 1 }, { lift: LIFT_MAX, squash: 0.6 }, { lift: LIFT_MAX, squash: 1 }];
export function burstRect(st, geo) {
  const key = `${st.id}|${st.q}|${st.g}|${st.p}|${st.r}|${st.lv}|${st.wd}|${st.ws}|${st.db}|${geo.ap}|${geo.ox}|${geo.oy}|${geo.grid}`;
  const had = RECTS.get(key); if ( had ) return { ...had };
  const lv = lvOf(st), { x, y } = pointOf(st, geo), g = geo.grid / geo.ap, life = BURST_LV.life[lv];
  const f = fieldOf(st, geo, 0, 0), o = { lob: new Float32Array(MAX_LOBES * 8), spk: new Float32Array(MAX_SPARKS * 4), dbr: new Float32Array(MAX_DEBRIS * 8), n: [0, 0, 0] };
  let x0 = x - 2, y0 = y - 2, x1 = x + 2, y1 = y + 2;
  const add = (ax, ay, r) => { x0 = Math.min(x0, ax - r); x1 = Math.max(x1, ax + r); y0 = Math.min(y0, ay - r); y1 = Math.max(y1, ay + r); };
  for ( let a = 0; a <= life + 1e-6; a += 1 / 24 ) for ( const v of CORNERS ) {
    burstAt(f, a, v, [0, 0], 1, o);
    for ( let i = 0; i < o.n[0]; i++ ) add(o.lob[i * 8], o.lob[i * 8 + 1], o.lob[i * 8 + 2] + 1);
    for ( let i = 0; i < o.n[1]; i++ ) add(o.spk[i * 4], o.spk[i * 4 + 1], 2);
    for ( let i = 0; i < o.n[2]; i++ ) { add(o.dbr[i * 8], o.dbr[i * 8 + 1], 3); add(o.dbr[i * 8] + 3 * o.dbr[i * 8 + 6], o.dbr[i * 8 + 1] + 3 * o.dbr[i * 8 + 7], 2); add(o.dbr[i * 8 + 2], o.dbr[i * 8 + 3], 2 + 3 * f.R / 8); }
  }
  // (the scene's wind carries the cloud: burst-art's drift, sw x a x 0.7, for a wind up to a quarter square a second; and the ground
  // heat pool under the flash, 1.5 R x 1.2 R)
  const m = 0.7 * 0.25 * g * life + 3;
  add(x, y, 0); x0 = Math.min(x0, x - 1.5 * f.R); x1 = Math.max(x1, x + 1.5 * f.R); y1 = Math.max(y1, y + 1.2 * f.R);
  const r = { x0: Math.floor(x0 - m), y0: Math.floor(y0 - m), x1: Math.ceil(x1 + m), y1: Math.ceil(y1 + m) };
  if ( RECTS.size > 256 ) RECTS.clear();
  RECTS.set(key, r);
  return { ...r };
}
/** Its CORE: the ground point (a burst never joins another area). */
export function burstCore(st, geo) {
  const { x, y } = pointOf(st, geo);
  return { x0: Math.floor(x) - 1, y0: Math.floor(y) - 1, x1: Math.ceil(x) + 1, y1: Math.ceil(y) + 1 };
}
/** When a burst ends (ms): its life, or its fade after it was taken back. */
export function burstEnd(st) {
  const e = litTime(st) + BURST_LV.life[lvOf(st)] * 1000;
  return st.o !== undefined ? Math.min(e, Math.max(st.o, litTime(st)) + BURST_FADE * 1000) : e;
}

/**
 * A burst area's FIELD: a small descriptor (burst-art.mjs draws everything from it and the clock). `area` as model.areasOf gives it
 * (style "burst": one burst stroke).
 */
export function burstRaster(area, geo) {
  const st = area.strokes.find((s) => s.k === "burst"), { rect } = area;
  const W = Math.max(1, rect.x1 - rect.x0), H = Math.max(1, rect.y1 - rect.y0);
  if ( !st ) return { style: "burst", w: W, h: H, none: true, emit: { fire: [], smoke: [] }, anim: true };
  return { style: "burst", w: W, h: H, ...fieldOf(st, geo, rect.x0, rect.y0), emit: { fire: [], smoke: [] }, anim: true };
}
/** The motion's inputs of a burst, its ground point relative to (x0, y0) cells. */
function fieldOf(st, geo, x0, y0) {
  const lv = lvOf(st), { x, y, R } = pointOf(st, geo), [wx, wy] = windVec(st.wd, st.ws);
  const db = debrisOf(st, geo), dbA = new Float32Array(MAX_DEBRIS * 4);
  db.forEach(([dx, dy, t], i) => dbA.set([dx, dy, t, hash4(st.sd | 0, i, 7)], i * 4));
  return { ref: litTime(st), c: [x - x0, y - y0], R, lv, wind: [wx, wy], db: dbA, dbN: db.length,
    out: st.o !== undefined ? (st.o - litTime(st)) / 1000 : 1e9, seed: (st.sd >>> 0) % 65536, color: st.c ?? null };
}

/* ---------------------------------------------------------------- the motion (per art frame, on the CPU: a few dozen bodies) */

/** Bodies the art pass reads per frame (uniform arrays of burst-art.mjs; keep in step). */
export const MAX_LOBES = 64, MAX_SPARKS = 40;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const H = (s, j, k) => hash4(s, j, k, 911);

/**
 * THE BURST AT AGE `a` (s since the impact): every body of it, in area-local cells, written into `out` (no garbage):
 *   lob  Float32Array(MAX_LOBES * 8): [x, y, r, heat 0..1, foot y (its ground row on screen: depth), kind (0 fireball, 1 stem, 2 ground
 *        surge), weight 0..1, its life's share 0..1]
 *   spk  Float32Array(MAX_SPARKS * 4): [x, y, temperature 0..1, ground y]
 *   dbr  Float32Array(MAX_DEBRIS * 8): [x, y, ground x, ground y, state (0 none, 1 flying, 2 just landed), heat, trail dx, trail dy]
 *   n    [lobes, sparks, debris] in use
 * `f` the field (burstRaster), `v` { lift, squash } (view-angle.mjs), `sw` the scene's wind drift (cells / s), `det` the sparks' share
 * (the guard). Pure and deterministic: every client computes the same bodies for the same frame.
 *
 * THE MOTION (L3; L1 / L2 the same with less of each): a white-hot core for a tenth of a second; the fireball's lobes burst out from
 * it with drag (a cauliflower of billows, each its own size), the whole body rises with buoyancy (an eased climb, the cap's lobes all
 * the way, the low ones less: a STEM forms under it at L3), the cap SPREADS as it climbs and ROLLS (its billows turn over: up through
 * the middle, out over the top, down the outside) and leans downwind; each lobe COOLS from its own heat (inner ones later: the colour
 * sinks from the outside in); a low SURGE of ground-coloured billows runs out along the ground with drag; SPARKS fly out on ballistic
 * arcs and cool through the ramp; DEBRIS arcs out to where its fire will catch.
 */
export function burstAt(f, a, v, sw = [0, 0], det = 1, out = null) {
  out ??= { lob: new Float32Array(MAX_LOBES * 8), spk: new Float32Array(MAX_SPARKS * 4), dbr: new Float32Array(MAX_DEBRIS * 8), n: [0, 0, 0] };
  const { lob, spk, dbr } = out, lv = f.lv ?? 2, R = f.R, [cx, cy] = f.c, s = f.seed | 0, life = BURST_LV.life[lv];
  const lift = v?.lift ?? 0.5, sq = v?.squash ?? 0.8, [wx, wy] = f.wind ?? [0, 0];
  out.n[0] = out.n[1] = out.n[2] = 0;
  if ( a < 0 || a > life || f.none ) return out;
  const fade = f.out < 1e8 ? 1 - sm(f.out, f.out + BURST_FADE, a) : 1;
  const Hh = BURST_LV.rise[lv] * R, tr = [0, 0.5, 0.95, 1.3][lv];
  const Zc = Hh * (1 - Math.exp(-Math.max(0, a - 0.15) / tr)), sr = Hh > 0 ? Zc / Hh : 0;
  const spread = [0, 0.25, 0.35, 0.55][lv], roll = [0, 0.5, 0.9, 1.7][lv], hot = BURST_LV.hot[lv], core = [0, 0.08, 0.1, 0.12][lv];
  // the axis leans downwind with height, and the whole cloud rides the scene's wind
  const axis = (z) => [wx * z * 0.45 + sw[0] * a * 0.7, wy * z * 0.18 + sw[1] * a * 0.7];
  let n = 0;
  const put = (x, y, r, heat, foot, kind, w, age) => {
    if ( n >= MAX_LOBES || w <= 0.001 || r <= 0.3 ) return;
    lob.set([x, y, r, heat, foot, kind, w, age], n * 8); n++;
  };
  // the FIREBALL: lobes on a sphere (mostly the upper half), out with drag, up with the cloud
  const NL = BURST_LV.lobes[lv];
  for ( let j = 0; j < NL; j++ ) {
    const az = 6.2832 * H(s, j, 1), el = -0.2 + 1.45 * Math.pow(H(s, j, 2), 0.75), h3 = H(s, j, 3), h4 = H(s, j, 4), h5 = H(s, j, 5);
    const ae = Math.max(0, a - 0.012 * j % 0.09), E = 1 - Math.exp(-11 * ae);
    if ( E <= 0 ) continue;
    const dist = R * (0.15 + 0.6 * h3) * E, up = sm(-0.2, 0.9, el), kz = (lv === 3 ? 0.18 : lv === 2 ? 0.45 : 0.7) + (1 - (lv === 3 ? 0.18 : lv === 2 ? 0.45 : 0.7)) * up;
    let rho = Math.cos(el) * dist * (1 + spread * sr * (0.6 + 0.8 * up)), z = R * 0.5 * E + Math.sin(el) * dist * 0.85 + Zc * kz;
    // ROLL: the cap's billows turn over round the cap's ring (up the middle, out, down the outside)
    if ( up > 0.3 && sr > 0 ) {
      const ring = R * (0.45 + 0.7 * spread * sr), zr = Zc * kz, th = -roll * sr * up;
      const dr = rho - ring, dz = z - zr - R * 0.5, cs = Math.cos(th), sn = Math.sin(th);
      rho = ring + dr * cs - dz * sn; z = zr + R * 0.5 + dr * sn + dz * cs;
    }
    rho = Math.max(0, rho);
    const [ax, ay] = axis(z), gx = Math.cos(az) * rho, gy = Math.sin(az) * rho;
    const r = R * (0.2 + 0.3 * h4 * h4) * (0.45 + 0.55 * E) * (1 + 0.35 * sr * up + 0.05 * Math.min(a, 3)) * (lv === 1 ? 1.25 : 1);
    const tau = hot * (0.7 + 0.7 * h5) * (0.75 + 0.6 * (1 - h3)), heat = a < core ? 1 : Math.exp(-Math.max(0, a - core) / tau) * (a < core * 3 ? 1 : 1);
    put(cx + ax + gx, cy + ay + gy * sq - z * lift, r, heat, cy + gy * sq, 0, Math.min(1, E * 3) * fade, (a / life) * (0.78 + 0.25 * h5 + 0.22 * up));
  }
  // the STEM (L2 short, L3 tall): billows up the axis from the ground to under the cap, the lowest licking with flame a while
  const NS = BURST_LV.stem[lv];
  if ( NS && a > 0.22 ) {
    const g0 = sm(0.22, 0.75, a);
    for ( let k = 0; k < NS; k++ ) {
      const fr = (k + 0.5) / NS, h1 = H(s, 100 + k, 1), h2 = H(s, 100 + k, 2);
      const z = R * 0.25 + Zc * 0.86 * fr * (lv === 3 ? 1 : 0.55), [ax, ay] = axis(z);
      const off = R * 0.22 * (h1 - 0.5), r = R * (0.34 - 0.12 * fr) * (0.7 + 0.3 * h2) * g0;
      const heat = fr < 0.3 ? 0.62 * Math.exp(-a / (lv === 3 ? 1.6 : 0.9)) : 0.4 * Math.exp(-a / 0.5);
      put(cx + ax + off, cy + ay - z * lift, r, heat, cy, 1, g0 * fade, Math.min(1, (a / life) * (1.05 + 0.2 * h2)));
    }
  }
  // the SURGE: low billows of the ground's own dust thrown out along the ground (the grenade is mostly this)
  const NB = BURST_LV.surge[lv], sk = [0, 1.5, 1.05, 1.25][lv], slife = life * [0, 0.9, 0.55, 0.45][lv];
  for ( let k = 0; k < NB; k++ ) {
    const az = 6.2832 * (k + 2.5 * H(s, 200 + k, 1)) / NB, h2 = H(s, 200 + k, 2), h3 = H(s, 200 + k, 3);
    const E = 1 - Math.exp(-3.2 * Math.max(0, a - 0.02)), D = R * sk * (0.25 + (0.25 + 1.35 * h2 * h2) * E);
    const gx = Math.cos(az) * D + sw[0] * a * 0.5, gy = Math.sin(az) * D + sw[1] * a * 0.5, z = R * (0.1 + 0.3 * (1 - Math.exp(-1.2 * a))) * (0.5 + h3);
    const r = R * (0.15 + 0.22 * h3 * h3) * (0.5 + 0.9 * (1 - Math.exp(-1.6 * a))) * (lv === 1 ? 1.6 : 1);
    const w = sm(0.04, 0.2, a) * (1 - sm(0.3 * slife, slife, a)) * fade;
    put(cx + gx, cy + gy * sq - z * lift, r, 0, cy + gy * sq, 2, w, a / slife);
  }
  out.n[0] = n;
  // SPARKS: ballistic, with drag, cooling through the ramp; gone when they land
  const NK = Math.round(BURST_LV.sparks[lv] * Math.max(0, Math.min(1, det)));
  let m = 0;
  for ( let k = 0; k < NK && m < MAX_SPARKS; k++ ) {
    const t = a - 0.02 - 0.06 * H(s, 300 + k, 1), L = (0.5 + 0.9 * H(s, 300 + k, 2)) * [0, 0.8, 1, 1.25][lv];
    if ( t <= 0 || t > L ) continue;
    const az = 6.2832 * H(s, 300 + k, 3), el = 0.25 + 1.15 * H(s, 300 + k, 4), v0 = R * (3 + 5 * H(s, 300 + k, 5)), kd = 2.4;
    const e = (1 - Math.exp(-kd * t)) / kd, ho = Math.cos(el) * v0 * e, z = R * 0.4 + Math.sin(el) * v0 * e - 0.5 * 5.5 * R * t * t;
    if ( z < 0 ) continue;
    const gx = Math.cos(az) * ho, gy = Math.sin(az) * ho;
    spk.set([cx + gx, cy + gy * sq - z * lift, (1 - t / L) * fade, cy + gy * sq], m * 4); m++;
  }
  out.n[1] = m;
  // DEBRIS: burning chunks on parabolas to their landing points (a small flare as they land; the preset's fire catches there)
  let d = 0;
  for ( let k = 0; k < (f.dbN ?? 0); k++ ) {
    const dx = f.db[k * 4], dy = f.db[k * 4 + 1], tl = f.db[k * 4 + 2], hj = f.db[k * 4 + 3], t0 = 0.05 + 0.08 * hj;
    if ( a < t0 || a > tl + 0.35 ) continue;
    const fr = Math.min(1, (a - t0) / Math.max(0.05, tl - t0)), dist = Math.hypot(dx, dy), apex = (0.45 * dist + 0.4 * R) * (0.7 + 0.6 * hj);
    const gx = cx + dx * fr, gy = cy + dy * fr, z = apex * 4 * fr * (1 - fr) + R * 0.3 * (1 - fr);
    const fr2 = Math.max(0, fr - 0.06), z2 = apex * 4 * fr2 * (1 - fr2) + R * 0.3 * (1 - fr2);
    const landed = a >= tl;
    dbr.set([gx, gy - z * lift, gx, gy, landed ? 2 : 1, landed ? 1 - (a - tl) / 0.35 : 0.55 + 0.45 * (1 - fr), (cx + dx * fr2) - gx, (cy + dy * fr2 - z2 * lift) - (gy - z * lift)], d * 8); d++;
  }
  out.n[2] = d;
  return out;
}

/**
 * A burst's LIGHT (the fire lights, lights.mjs): one light at the fireball, its own curve - a flash peaking at 50 ms with a big reach,
 * then a decay into the light of the fires it leaves. { x, y (scene px), radius, level, burst: { q, lv, life } , seed }.
 */
export function burstLight(st, geo, P) {
  const lv = lvOf(st), R = Math.max(2, st.r / geo.ap) * geo.ap;
  return { x: st.p[0], y: st.p[1] - R * 0.6, radius: Math.round(R * BURST_LV.lightR[lv] * (P.lightRadius ?? 1.5) / 1.5), level: lv, strength: 1,
    ignite: null, out: null, seed: (st.sd >>> 0) || 1, burst: { q: litTime(st), o: st.o ?? null, lv }, samples: [] };
}

/** The burst light's gain at `now` (ms): 0 before the impact, a peak at 50 ms, a long decay (L3 ~2 s); a taken-back burst dims fast. */
export function burstGain(B, now) {
  const a = (now - B.q) / 1000; if ( a < 0 ) return 0;
  const lv = B.lv ?? 2, dec = [0, 0.35, 0.8, 1.3][lv];
  let g = BURST_LV.lightI[lv] * (a < 0.05 ? a / 0.05 : 0.18 + 0.82 * Math.exp(-(a - 0.05) / dec)) * (1 - Math.min(1, Math.max(0, (a - BURST_LV.life[lv] * 0.55) / (BURST_LV.life[lv] * 0.4))));
  if ( B.o !== null && B.o !== undefined ) g *= 1 - Math.min(1, Math.max(0, (now - B.o) / (BURST_FADE * 1000)));
  return Math.max(0, g);
}
