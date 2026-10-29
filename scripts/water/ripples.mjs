import * as Water from "./water.mjs";
import * as Model from "./model.mjs";
import { chain, nearest } from "./rods.mjs";

/**
 * Tokens in the water: rings around a token that stands in water, a splash when one enters or leaves, and a foam wake behind one that
 * moves. All of it is a light layer over the baked water (no new bake): the water masks say whether a token is in water, and the
 * effects are small pixel-art sprites on the water's own art-pixel grid, in the colours of the current look.
 *
 * Settings (per scene, in the water settings): fxOn, fxStrength (0..10), fxRings, fxSplash, fxWake, fxWho ("all" | "gm").
 */

export const FX_DEFAULTS = { fxOn: true, fxStrength: 5, fxRings: true, fxSplash: true, fxWake: true, fxWho: "all" };
export const FX_KEYS = Object.keys(FX_DEFAULTS);

const STEP_MS = 90;           // pixel art moves in steps, not smoothly
const RING_MS = 1700;         // one ring's life
const WAKE_MS = 900, SPLASH_MS = 650;
const REDUCED = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");

let root = null, tick = null, states = new Map();
let parts = [];               // droplets, wake puffs and splash rings in flight
let texCache = new Map();
let dotTex = null;

const cfg = () => ({ ...FX_DEFAULTS, ...(Water.state()?.params ?? {}) });

/* ---------------------------------------------------------------- textures */

/** A one-pixel ring of radius r (art pixels), midpoint circle, in a texture of its own. */
function ringTexture(r, color) {
  const key = `${r}|${color}`;
  let t = texCache.get(key);
  if ( t ) return t;
  const d = r * 2 + 3, c = document.createElement("canvas"); c.width = c.height = d;
  const ctx = c.getContext("2d"); ctx.fillStyle = `#${color}`;
  const cx = r + 1, cy = r + 1;
  let x = r, y = 0, e = 1 - r;
  const put = (a, b) => ctx.fillRect(cx + a, cy + b, 1, 1);
  while ( x >= y ) {
    for ( const [a, b] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]] ) put(a, b);
    y++;
    if ( e < 0 ) e += 2 * y + 1; else { x--; e += 2 * (y - x) + 1; }
  }
  t = PIXI.Texture.from(c, { scaleMode: PIXI.SCALE_MODES.NEAREST });
  t.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
  texCache.set(key, t);
  return t;
}

function dot() {
  if ( dotTex && !dotTex.destroyed ) return dotTex;
  const c = document.createElement("canvas"); c.width = c.height = 1;
  c.getContext("2d").fillStyle = "#fff"; c.getContext("2d").fillRect(0, 0, 1, 1);
  dotTex = PIXI.Texture.from(c, { scaleMode: PIXI.SCALE_MODES.NEAREST });
  return dotTex;
}

/* ---------------------------------------------------------------- world <-> art pixels */

const S = () => Water.state();
const art = (p) => { const r = Model.sceneRect(), s = S(); return [(p.x - r.x) / s.px, (p.y - r.y) / s.px]; };
const snapWorld = (ax, ay) => { const r = Model.sceneRect(), s = S(); return [r.x + Math.round(ax) * s.px, r.y + Math.round(ay) * s.px]; };

function inWater(p) {
  const s = S(); if ( !s ) return false;
  const [ax, ay] = art(p), x = Math.floor(ax), y = Math.floor(ay);
  if ( x < 0 || y < 0 || x >= s.w || y >= s.h ) return false;
  const i = y * s.w + x;
  return !s.masks.fall[i] && (s.masks.water[i] === 1 || s.masks.river[i] === 1);
}

/** The way the water runs at a point (unit vector, art pixels), or null for still water. */
function flowAt(p) {
  const s = S(), P = s.params, [ax, ay] = art(p), i = Math.floor(ay) * s.w + Math.floor(ax);
  if ( P.guideOn && Array.isArray(P.guides) ) {
    let best = null;
    for ( const r of P.guides ) {
      if ( r.kind === "lip" ) continue;
      const c = chain(r), n = nearest(c, ax, ay);
      if ( n.d <= (P.guideReach ?? 8) && (!best || n.d < best.d) ) {
        const k = Math.min(c.xs.length - 1, Math.max(1, Math.round(n.at * (c.xs.length - 1))));
        const vx = c.xs[k] - c.xs[k - 1], vy = c.ys[k] - c.ys[k - 1], l = Math.hypot(vx, vy) || 1;
        best = { d: n.d, v: [vx / l, vy / l] };
      }
    }
    if ( best ) return best.v;
  }
  const deg = s.masks.river[i] ? P.rangle ?? 90 : (P.drift ?? 0) > 0 ? P.angle ?? 0 : null;
  if ( deg === null ) return null;
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

/* ---------------------------------------------------------------- sprites */

function sprite(texture, tint = 0xFFFFFF) {
  const sp = new PIXI.Sprite(texture);
  sp.anchor.set(0.5); sp.eventMode = "none"; sp.tint = tint;
  root.addChild(sp);
  return sp;
}
const hex = (c) => parseInt(String(c).replace("#", ""), 16);

/* ---------------------------------------------------------------- effects */

const colors = () => (S()?.params?.colors ?? []).map((c) => String(c).replace("#", ""));

function addRing(state, i) {
  const sp = sprite(PIXI.Texture.EMPTY);
  state.rings[i] = sp;
}

function updateRings(st, now, c, k) {
  const s = S(), cols = colors(), ps = s.px;
  const base = Math.max(2, st.radius), grow = Math.max(2, Math.round(base * 0.9));
  for ( let i = 0; i < 3; i++ ) {
    if ( !st.rings[i] ) addRing(st, i);
    const sp = st.rings[i];
    const phase = ((Math.floor(now / STEP_MS) * STEP_MS) / RING_MS + i / 3 + st.seed) % 1;
    const r = Math.round(base * 0.7 + phase * grow);
    const col = phase < 0.45 ? cols[4] : phase < 0.75 ? cols[5] : cols[3];
    sp.texture = ringTexture(r, col ?? "ffffff");
    sp.alpha = Math.min(1, k) * (phase < 0.15 ? 0.5 + phase * 3 : phase < 0.6 ? 1 : phase < 0.8 ? 0.6 : 0.3);
    const [wx, wy] = snapWorld(art(c)[0], art(c)[1]);
    sp.position.set(wx, wy); sp.scale.set(ps);
    sp.visible = true;
  }
}

function hideRings(st) { for ( const sp of st.rings ) if ( sp ) sp.visible = false; }

/** A ring that grows and fades once (splash rings and wake puffs). */
function puff(c, r0, r1, ms, color, drift = null) {
  const sp = sprite(PIXI.Texture.EMPTY);
  parts.push({ kind: "ring", sp, born: performance.now(), ms, r0, r1, color, c: { x: c.x, y: c.y }, drift });
}

function droplets(c, n, speed, color) {
  const s = S();
  for ( let i = 0; i < n; i++ ) {
    const a = Math.random() * Math.PI * 2, v = speed * (0.6 + Math.random() * 0.8);
    const sp = sprite(dot(), hex(color));
    sp.scale.set(s.px);
    parts.push({ kind: "drop", sp, born: performance.now(), ms: SPLASH_MS * (0.7 + Math.random() * 0.5), c: { x: c.x, y: c.y }, vx: Math.cos(a) * v, vy: Math.sin(a) * v });
  }
}

function splash(c, radius, k) {
  const cols = colors(); if ( !cols.length ) return;
  puff(c, Math.max(2, radius * 0.5), Math.round(radius * 2), SPLASH_MS, cols[5]);
  puff(c, 1, Math.round(radius * 1.4), SPLASH_MS * 0.8, cols[4]);
  droplets(c, Math.round(4 + radius * k * 0.8), 10 + radius, cols[5]);
}

function stepParts(now) {
  const s = S(), ps = s?.px ?? 1;
  parts = parts.filter((p) => {
    const t = (now - p.born) / p.ms;
    if ( t >= 1 || !s ) { p.sp.destroy(); return false; }
    const q = Math.floor(t * (p.ms / STEP_MS)) / (p.ms / STEP_MS);   // pixel steps
    if ( p.kind === "ring" ) {
      const r = Math.max(1, Math.round(p.r0 + (p.r1 - p.r0) * q));
      p.sp.texture = ringTexture(r, p.color);
      p.sp.alpha = 1 - q * 0.9;
      let [ax, ay] = art(p.c);
      if ( p.drift ) { ax += p.drift[0] * q * 4; ay += p.drift[1] * q * 4; }
      const [wx, wy] = snapWorld(ax, ay);
      p.sp.position.set(wx, wy); p.sp.scale.set(ps);
    } else {
      const [ax, ay] = art(p.c), dt = q * (p.ms / 1000);
      const [wx, wy] = snapWorld(ax + p.vx * dt, ay + p.vy * dt);
      p.sp.position.set(wx, wy); p.sp.alpha = 1 - q;
    }
    return true;
  });
}

/* ---------------------------------------------------------------- the loop */

function onTick() {
  const s = S(), P = cfg();
  const on = s && s.enabled && P.fxOn && !REDUCED?.matches && (P.fxWho === "all" || game.user.isGM);
  if ( !on ) { if ( states.size || parts.length ) clear(); return; }
  const now = performance.now(), k = P.fxStrength / 5, seen = new Set();
  for ( const t of canvas.tokens?.placeables ?? [] ) {
    const doc = t.document;
    if ( !t.visible || doc.hidden && !game.user.isGM || (doc.elevation ?? 0) > 0 || (doc.elevation ?? 0) < 0 ) continue;
    seen.add(t.id);
    const c = t.center, wet = inWater(c);
    const radius = Math.max(2, Math.round((Math.max(t.w, t.h) / 2) / s.px * 0.8));
    let st = states.get(t.id);
    if ( !st ) { st = { wet, c: { x: c.x, y: c.y }, rings: [], seed: Math.random(), radius, nextWake: 0, hold: 0 }; states.set(t.id, st); }
    st.radius = radius;
    const moved = Math.hypot(c.x - st.c.x, c.y - st.c.y) / s.px;
    if ( wet !== st.wet && P.fxSplash ) splash(wet ? c : st.c, radius, k);
    if ( wet && P.fxRings ) updateRings(st, now, c, k); else hideRings(st);
    if ( wet && P.fxWake && moved > 0.15 && now >= st.nextWake ) {
      // a puff behind the token, carried by the current if there is one
      const f = flowAt(c) ?? [0, 0];
      const dx = (st.c.x - c.x), dy = (st.c.y - c.y), l = Math.hypot(dx, dy) || 1;
      const back = { x: c.x + (dx / l) * radius * s.px * 0.7, y: c.y + (dy / l) * radius * s.px * 0.7 };
      puff(back, 1, Math.max(2, Math.round(radius * 0.9 * k)), WAKE_MS, colors()[5] ?? "ffffff", f);
      st.nextWake = now + 140;
    }
    st.wet = wet; st.c = { x: c.x, y: c.y };
  }
  for ( const [id, st] of states ) if ( !seen.has(id) ) { for ( const sp of st.rings ) sp?.destroy(); states.delete(id); }
  stepParts(now);
}

function clear() {
  for ( const st of states.values() ) for ( const sp of st.rings ) sp?.destroy();
  states.clear();
  for ( const p of parts ) p.sp.destroy();
  parts = [];
}

/* ---------------------------------------------------------------- lifecycle */

export function onCanvasReady() {
  teardown();
  root = new PIXI.Container(); root.eventMode = "none";
  // over the water (240) and the districts (250), under tiles and tokens
  Object.assign(root, { elevation: 0, sortLayer: 255, sort: 0, _lastSortedIndex: 0 });
  canvas.primary.addChild(root);
  tick = () => onTick();
  canvas.app.ticker.add(tick);
}

export function teardown() {
  if ( tick ) canvas.app?.ticker?.remove(tick);
  tick = null;
  if ( root ) { clear(); if ( !root.destroyed ) root.destroy({ children: true }); }
  root = null;
  for ( const t of texCache.values() ) t.destroy(true);
  texCache.clear();
  dotTex?.destroy(true); dotTex = null;
}
