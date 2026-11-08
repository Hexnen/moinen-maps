/**
 * Night lights: districts that light up after dark (lit windows on a faux building lattice, street lamps along the outline, soft bokeh).
 *
 * Storage: nothing new is written by the effect itself. Settings live with the district (`d.lights = {on: "inherit"|"on"|"off", own, ...look}`)
 * and as the scene default (`flags.moinen-maps.config.lights`, plus `nightMode` / `nightStart` / `nightFull`). Resolution order like every
 * district look: editor draft > per-district (when `own`) > scene default > built-in.
 * Positions are derived from the district rings + its id as the seed, so every client and every reload computes the same lights.
 *
 * Rendering, two parts per light:
 *  - the core (a tiny window / lamp / bokeh sprite) sits in the primary group just above the district fills and below tiles, drawings
 *    and tokens, so a token walking over a window covers it;
 *  - the halo is added to Foundry's illumination layer (canvas.effects.illumination.lights, MAX_COLOR like a real light source). The
 *    scene darkness is a multiply of the primary group by that illumination texture, so the halo lifts the darkness around each light:
 *    the core shows at its full colour (emissive) and the map around it is lit by a small warm pool, exactly like a Foundry light.
 *    Foundry clears that container on every lighting refresh, so it is re-attached from the `lightingRefresh` hook.
 * Night follows the scene darkness (smoothstep between two thresholds; the "darknessChange" event and lighting refreshes drive it,
 * so darkness animations are followed), or a per-scene override (auto / always / off). Lights come on one by one at dusk.
 * One shared ticker callback runs only while some lights are visible; it touches only alpha (no allocations per frame).
 */
import { MODULE_ID, sceneConfig, reducedMotion, LIGHT_DEFAULTS } from "./config.mjs";
import { fg } from "./labels.mjs";
import { perfLow } from "./perf-mode.mjs";

const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const TAU = Math.PI * 2;

export const LIGHT_STYLES = ["windows", "town", "lamps", "bokeh"];
export const LIGHT_WARMTH = ["warm", "candle", "cold", "neon", "custom"];
const PALETTES = {
  warm: ["#ffd27a", "#ffc65a", "#ffe2a0", "#ffcf6e", "#ffb84a"],
  candle: ["#ffa04a", "#ffb35e", "#ff8f38", "#ffc078"],
  cold: ["#e8f1ff", "#d3e4ff", "#f6f9ff", "#c8dcff"],
  neon: ["#ff3fb4", "#2ef2ff", "#b6ff3a", "#ffd23f", "#ff5a3c"]
};
const TV = "#cfe0ff";   // the odd window lit by a screen instead of a lamp (warm palettes only)
const KIND = { window: 0, lamp: 1, bokeh: 2 };
const STRIDE = 6;       // per light: phase, rate, dusk threshold, switch period (0 = steady), kind, tv flicker
const CAP = { window: 900, lamp: 360, bokeh: 320 };

/* ------------------------------------------------------------------ config */

/** Effective night-light settings of a district: per-district look (when `own`) > scene default > built-in; `on` is tri-state. */
export function lightsCfg(d, scene = canvas.scene) {
  const sc = sceneConfig(scene), base = sc.lights ?? {}, o = d?.lights ?? {};
  const c = { ...LIGHT_DEFAULTS, ...base, ...(o.own ? o : {}) };
  const on = o.on === "on" ? true : o.on === "off" ? false : !!base.on;
  return {
    on, style: LIGHT_STYLES.includes(c.style) ? c.style : LIGHT_DEFAULTS.style, warmth: LIGHT_WARMTH.includes(c.warmth) ? c.warmth : LIGHT_DEFAULTS.warmth,
    color: /^#[0-9a-f]{6}$/i.test(c.color ?? "") ? c.color : LIGHT_DEFAULTS.color,
    density: clamp(num(c.density, LIGHT_DEFAULTS.density), 0.05, 1), size: clamp(num(c.size, LIGHT_DEFAULTS.size), 0.4, 2.5),
    glow: clamp(num(c.glow, LIGHT_DEFAULTS.glow), 0, 1), twinkle: clamp(num(c.twinkle, LIGHT_DEFAULTS.twinkle), 0, 1),
    switching: clamp(num(c.switching, LIGHT_DEFAULTS.switching), 0, 1)
  };
}

/** Scene night: 0 = day, 1 = full night. */
function nightTarget() {
  const sc = sceneConfig(canvas.scene);
  if ( sc.nightMode === "on" ) return 1;
  if ( sc.nightMode === "off" ) return 0;
  const dl = canvas.environment?.darknessLevel ?? canvas.scene?.environment?.darknessLevel ?? 0;
  const a = clamp(num(sc.nightStart, 0.35), 0, 0.99), b = Math.max(a + 0.01, clamp(num(sc.nightFull, 0.7), 0, 1));
  const t = clamp((dl - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ layout (deterministic) */

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hashStr = (s) => { let h = 7; for ( const c of String(s) ) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };

function inside(x, y, rings) {
  let ins = false;
  for ( const r of rings ) {
    for ( let i = 0, j = r.length - 2; i < r.length; j = i, i += 2 ) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if ( (yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi ) ins = !ins;
    }
  }
  return ins;
}

/** The street direction: the longest edge of the outline. Windows line up with it, like buildings along a street. */
function streetAngle(rings) {
  let best = 0, ang = 0;
  for ( const r of rings ) for ( let i = 0, j = r.length - 2; i < r.length; j = i, i += 2 ) {
    const dx = r[i] - r[j], dy = r[i + 1] - r[j + 1], l = dx * dx + dy * dy;
    if ( l > best ) { best = l; ang = Math.atan2(dy, dx); }
  }
  return ((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
}

/** Lit windows on a faux lattice of buildings (blocks of window cells separated by one-cell streets), aligned to the street direction. */
function windowLights(rings, cfg, S, rnd, out, densityK = 1) {
  const th = streetAngle(rings), ca = Math.cos(th), sa = Math.sin(th);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for ( const r of rings ) for ( let i = 0; i < r.length; i += 2 ) {
    const u = r[i] * ca + r[i + 1] * sa, v = -r[i] * sa + r[i + 1] * ca;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  let sx = S * 0.15 * cfg.size, sy = S * 0.2 * cfg.size;
  const w = sx * 0.5, h = sy * 0.56;
  const cells = ((u1 - u0) / sx) * ((v1 - v0) / sy);
  if ( cells > 14000 ) { const k = Math.sqrt(cells / 14000); sx *= k; sy *= k; }
  const dens = cfg.density * densityK;
  const cols = [], rows = [];
  for ( let u = u0 + rnd() * sx; u < u1; ) { const n = 2 + Math.floor(rnd() * 3); cols.push([u, n]); u += (n + 1 + (rnd() < 0.2 ? 1 : 0)) * sx; }
  for ( let v = v0 + rnd() * sy; v < v1; ) { const n = 1 + Math.floor(rnd() * 3); rows.push([v, n]); v += (n + 1) * sy; }
  const pB = 0.25 + 0.7 * dens, pW = 0.2 + 0.65 * dens;
  const hw = w * 0.5, hh = h * 0.5;
  for ( const [cu, cn] of cols ) for ( const [rv, rn] of rows ) {
    if ( rnd() > pB ) continue;
    for ( let i = 0; i < cn; i++ ) for ( let j = 0; j < rn; j++ ) {
      if ( rnd() > pW ) continue;
      const u = cu + (i + 0.5) * sx, v = rv + (j + 0.5) * sy;
      const x = u * ca - v * sa, y = u * sa + v * ca;
      // the window and two opposite corners must lie inside, so no light hangs over the inked outline
      if ( !inside(x, y, rings) ) continue;
      if ( !inside(x + (hw + sx * 0.4) * ca - (hh + sy * 0.3) * sa, y + (hw + sx * 0.4) * sa + (hh + sy * 0.3) * ca, rings) ) continue;
      if ( !inside(x - (hw + sx * 0.4) * ca + (hh + sy * 0.3) * sa, y - (hw + sx * 0.4) * sa - (hh + sy * 0.3) * ca, rings) ) continue;
      out.push({ kind: KIND.window, x, y, w, h, rot: th });
    }
  }
}

/** Street lamps: evenly spaced just inside the outline (holes included). */
function lampLights(rings, cfg, S, rnd, out, densityK = 1) {
  let per = 0;
  for ( const r of rings ) for ( let i = 0, j = r.length - 2; i < r.length; j = i, i += 2 ) per += Math.hypot(r[i] - r[j], r[i + 1] - r[j + 1]);
  let sp = S * clamp(1.55 - 1.15 * cfg.density * densityK, 0.32, 1.55);
  if ( per / sp > CAP.lamp ) sp = per / CAP.lamp;
  const off = S * 0.16, d = S * 0.09 * cfg.size;
  for ( const r of rings ) {
    let carry = rnd() * sp;
    for ( let i = 0, j = r.length - 2; i < r.length; j = i, i += 2 ) {
      const ax = r[j], ay = r[j + 1], dx = r[i] - ax, dy = r[i + 1] - ay, len = Math.hypot(dx, dy);
      if ( len < 1e-6 ) continue;
      const nx = -dy / len, ny = dx / len;
      for ( let t = carry; t < len; t += sp ) {
        const px = ax + dx * t / len, py = ay + dy * t / len;
        let x = px + nx * off, y = py + ny * off;
        if ( !inside(x, y, rings) ) { x = px - nx * off; y = py - ny * off; if ( !inside(x, y, rings) ) continue; }
        out.push({ kind: KIND.lamp, x, y, w: d, h: d, rot: 0 });
      }
      carry = ((carry - len) % sp + sp) % sp;
    }
  }
}

/** Soft bokeh: a jittered scatter inside the district. */
function bokehLights(rings, cfg, S, rnd, out) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( const r of rings ) for ( let i = 0; i < r.length; i += 2 ) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
  let cell = S * clamp(1.5 - 1.15 * cfg.density, 0.35, 1.5);
  const n = ((x1 - x0) / cell) * ((y1 - y0) / cell);
  if ( n > CAP.bokeh * 2.2 ) cell *= Math.sqrt(n / (CAP.bokeh * 2.2));
  for ( let y = y0; y < y1; y += cell ) for ( let x = x0; x < x1; x += cell ) {
    if ( rnd() > 0.7 ) { rnd(); rnd(); rnd(); continue; }
    const px = x + rnd() * cell, py = y + rnd() * cell, d = S * 0.2 * cfg.size * (0.6 + rnd() * 0.8);
    if ( inside(px, py, rings) ) out.push({ kind: KIND.bokeh, x: px, y: py, w: d, h: d, rot: 0 });
  }
}

/** Every light of a district with its colour and animation constants. Pure function of (rings, id, look). */
function layoutLights(d, cfg, S) {
  const rnd = rng(hashStr(d.id) ^ 0x5bd1e995), list = [];
  const rings = (d.rings ?? []).filter((r) => r?.length >= 6);
  if ( !rings.length ) return list;
  if ( cfg.style === "windows" || cfg.style === "town" ) windowLights(rings, cfg, S, rnd, list);
  if ( cfg.style === "lamps" || cfg.style === "town" ) lampLights(rings, cfg, S, rnd, list, cfg.style === "town" ? 0.6 : 1);
  if ( cfg.style === "bokeh" ) bokehLights(rings, cfg, S, rnd, list);
  // trim to the caps by a deterministic shuffle (keeps the spread even instead of cutting one side off)
  for ( const [k, cap] of [[KIND.window, CAP.window], [KIND.lamp, CAP.lamp], [KIND.bokeh, CAP.bokeh]] ) {
    const of = list.filter((l) => l.kind === k);
    if ( of.length <= cap ) continue;
    const drop = new Set(of.map((l) => [l, rnd()]).sort((a, b) => a[1] - b[1]).slice(cap).map((p) => p[0]));
    for ( let i = list.length - 1; i >= 0; i-- ) if ( drop.has(list[i]) ) list.splice(i, 1);
  }
  const pal = cfg.warmth === "custom" ? null : PALETTES[cfg.warmth];
  const custom = Color.from(cfg.color);
  for ( const l of list ) {
    const warm = cfg.warmth === "warm" || cfg.warmth === "candle";
    l.tv = l.kind === KIND.window && warm && rnd() < 0.07;
    if ( l.tv ) l.color = Color.from(TV);
    else if ( pal ) l.color = Color.from(pal[Math.floor(rnd() * pal.length)]);
    else l.color = custom.mix(Color.from(rnd() < 0.5 ? "#ffffff" : "#000000"), rnd() * 0.18);
    l.phase = rnd() * TAU; l.rate = 0.6 + rnd() * 1.4;
    l.dusk = rnd() * 0.8;                                                       // lights come on one by one as night falls
    l.period = rnd() < cfg.switching * 0.45 ? 14 + rnd() * 40 : 0;           // a few lights switch on and off over time
    l.swPhase = rnd() * TAU;
  }
  return list;
}

/* ------------------------------------------------------------------ textures (baked once) */

const haloTex = (mk, flat, pow) => mk(128, 128, (x, w) => {
  const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  for ( let i = 0; i <= 10; i++ ) g.addColorStop(flat + (1 - flat) * i / 10, `rgba(255,255,255,${((1 - i / 10) ** pow).toFixed(3)})`);
  x.fillStyle = g; x.fillRect(0, 0, w, w);
});

let TEX = null;
function bakeTextures() {
  if ( TEX && !TEX.halo.baseTexture.destroyed ) return TEX;
  const mk = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); return PIXI.Texture.from(c, { scaleMode: PIXI.SCALE_MODES.LINEAR }); };
  TEX = {
    // a lit window: a flat pane with a slightly brighter top and a darker sill line (reads as a window, not a dot, from 6 px up)
    window: mk(24, 32, (x, w, h) => {
      x.fillStyle = "#ffffff"; x.beginPath(); x.roundRect(2, 2, w - 4, h - 4, 2); x.fill();
      x.fillStyle = "rgba(0,0,0,0.22)"; x.fillRect(2, h - 7, w - 4, 3);
      x.fillStyle = "rgba(0,0,0,0.16)"; x.fillRect(w / 2 - 1, 4, 2, h - 12);
    }),
    // a lamp: a hard disc with a soft rim
    lamp: mk(32, 32, (x, w) => {
      const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.55, "rgba(255,255,255,1)"); g.addColorStop(0.75, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g; x.fillRect(0, 0, w, w);
    }),
    // bokeh: a soft disc with a faintly brighter rim, like an out-of-focus light
    bokeh: mk(64, 64, (x, w) => {
      const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, "rgba(255,255,255,0.5)"); g.addColorStop(0.72, "rgba(255,255,255,0.62)"); g.addColorStop(0.86, "rgba(255,255,255,0.8)"); g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g; x.fillRect(0, 0, w, w);
    }),
    // the halos (illumination): a flat middle that covers the core, then a smooth falloff; white, tinted per light.
    // Windows: a tight pool. Lamps: a small hot middle and a long soft fall, so the pool never reads as a disc.
    halo: haloTex(mk, 0.2, 2.2),
    haloWide: haloTex(mk, 0.07, 1.7)
  };
  return TEX;
}

/* ------------------------------------------------------------------ views */

const ENTRIES = new Map();   // districtId -> entry
let coreLayer = null, haloLayer = null, ticking = false, target = 0;
const PREVIEW = new Set();   // district ids (or "*") forced to night while an editor shows its night-light controls

function ensureLayers() {
  if ( !canvas.primary ) return false;
  if ( !coreLayer || coreLayer.destroyed ) {
    coreLayer = new PIXI.Container(); coreLayer.eventMode = "none"; coreLayer.interactiveChildren = false;
    // just above the district fills (sortLayer 250), below tiles (500), drawings and tokens
    Object.assign(coreLayer, { elevation: 0, sortLayer: 251, sort: 0, _lastSortedIndex: 0 });
    canvas.primary.addChild(coreLayer);
  }
  if ( !haloLayer || haloLayer.destroyed ) {
    haloLayer = new PIXI.Container(); haloLayer.eventMode = "none"; haloLayer.interactiveChildren = false; haloLayer.zIndex = 1e6;
  }
  attachHalos();
  return true;
}
/** Foundry empties the illumination container on every lighting refresh: put the halos back. */
function attachHalos() {
  const host = canvas.effects?.illumination?.lights;
  if ( haloLayer && !haloLayer.destroyed && host && haloLayer.parent !== host ) host.addChild(haloLayer);
}

function sigOf(d, cfg) { return JSON.stringify([d.rings, d.id, cfg.style, cfg.warmth, cfg.color, cfg.density, cfg.size, cfg.switching, canvas.grid.size]); }

function destroyEntry(e) {
  if ( e.job ) { e.job.dead = true; const k = JOBS.indexOf(e.job); if ( k >= 0 ) JOBS.splice(k, 1); }
  e.core.destroy({ children: true }); e.halo.destroy({ children: true });
}

/**
 * The lights of a district as PARTICLE CONTAINERS, one per texture (windows, lamps, bokeh; their halos: pool, wide pool): positions,
 * sizes, rotations and texture frames are uploaded once, only the tint + alpha of each light goes to the GPU per frame (a typed-array
 * loop in PIXI's particle renderer) - no per-sprite transform, bounds or batch work. The layout groups the lights by kind (windows,
 * then lamps, then bokeh), so drawing kind after kind keeps the order of the single container this replaces (pixel-equal); the halos
 * blend MAX_COLOR (order-free). A particle container draws every child: an unlit light has alpha 0 (not `visible = false`).
 */
const pc = (n, blend) => {
  const c = new PIXI.ParticleContainer(Math.max(1, n), { vertices: false, position: false, rotation: false, uvs: false, tint: true });
  c.blendMode = blend; c.eventMode = "none"; c.interactiveChildren = false;
  return c;
};

/**
 * Build a district's lights over frames (PERF, round 2): a generator that yields every CHUNK lights, so a driver (pump) can spend ~BUILD_MS
 * of a frame on it - the 5 synthetic districts (4888 lights) took 24-33 ms in one go. The new containers are filled on the side and
 * swapped in when the build is done (the old lights stay up until then).
 *
 * The lights are also split into spatial CELLS (an edge of ~450 lights' worth of area): every kind of light has one particle container
 * per cell, each with its own cull rectangle, so a cell off screen costs the renderer nothing (before: all 4888 lights' tint + alpha were
 * uploaded every frame whatever the zoom) and `apply` skips its lights. The cores are added kind after kind (all windows, then lamps,
 * then bokeh), so overlaps between kinds keep the old order; within a kind lights never overlap meaningfully (a lattice, spaced lamps, an
 * additive blend) and the halos blend MAX_COLOR (order-free).
 */
// (CAP keeps a district at 1260 lights at most, so today every district is ONE cell, culled as a whole; the split is there for raised caps)
const CHUNK = 160, BUILD_MS = 3, CELL_SPLIT = 1500, CELL_LIGHTS = 900;
function* buildSteps(e, d, cfg, job) {
  const S = canvas.grid.size, tex = bakeTextures(), list = layoutLights(d, cfg, S);
  yield;
  if ( job.dead ) return;
  const n = list.length, rec = new Float32Array(n * STRIDE);
  const hrOf = (l) => (l.kind === KIND.window ? 0.24 : l.kind === KIND.lamp ? 0.95 : 0.7) * S * cfg.size * (0.45 + cfg.glow);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, maxHr = 0;
  for ( const l of list ) { const hr = hrOf(l); x0 = Math.min(x0, l.x - hr); y0 = Math.min(y0, l.y - hr); x1 = Math.max(x1, l.x + hr); y1 = Math.max(y1, l.y + hr); maxHr = Math.max(maxHr, hr); }
  // the cells: only a big district is split (more than CELL_SPLIT lights), into cells of ~CELL_LIGHTS lights - every container costs a
  // draw call, so a district of a thousand lights stays one cell (it is culled as a whole)
  const parts = n > CELL_SPLIT ? Math.ceil(n / CELL_LIGHTS) : 1;
  const edge = !n ? 1 : parts === 1 ? Math.max(x1 - x0, y1 - y0, 1) : clamp(Math.sqrt(((x1 - x0) * (y1 - y0)) / parts), 5 * S, 30 * S);
  const nx = n ? Math.max(1, Math.ceil((x1 - x0) / edge)) : 1, ny = n ? Math.max(1, Math.ceil((y1 - y0) / edge)) : 1;
  const cellOf = new Uint16Array(n), cells = new Map();
  list.forEach((l, i) => {
    const c = Math.min(ny - 1, Math.floor((l.y - y0) / edge)) * nx + Math.min(nx - 1, Math.floor((l.x - x0) / edge));
    cellOf[i] = c;
    let q = cells.get(c);
    if ( !q ) { q = { id: c, items: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, kinds: [0, 0, 0], cores: [], halos: [], n: -1, vis: true }; cells.set(c, q); }
    q.items.push(i); q.kinds[l.kind]++;
    const hr = hrOf(l);
    q.x0 = Math.min(q.x0, l.x - hr); q.y0 = Math.min(q.y0, l.y - hr); q.x1 = Math.max(q.x1, l.x + hr); q.y1 = Math.max(q.y1, l.y + hr);
  });
  yield;
  if ( job.dead ) return;
  const MAXC = PIXI.BLEND_MODES.MAX_COLOR ?? PIXI.BLEND_MODES.ADD, NORMAL = PIXI.BLEND_MODES.NORMAL, ADD = PIXI.BLEND_MODES.ADD;
  const blend = [NORMAL, NORMAL, ADD];
  const cellList = [...cells.values()];
  for ( const q of cellList ) {
    q.items = Uint32Array.from(q.items); q.rect = new PIXI.Rectangle(q.x0, q.y0, q.x1 - q.x0, q.y1 - q.y0);
    for ( let k = 0; k < 3; k++ ) if ( q.kinds[k] ) { const c = pc(q.kinds[k], blend[k]); c.cullable = true; c.cullArea = q.rect; q.cores[k] = c; }
    const wn = q.kinds[KIND.window] + q.kinds[KIND.bokeh];
    if ( wn ) { const c = pc(wn, MAXC); c.cullable = true; c.cullArea = q.rect; q.halos[0] = c; }
    if ( q.kinds[KIND.lamp] ) { const c = pc(q.kinds[KIND.lamp], MAXC); c.cullable = true; c.cullArea = q.rect; q.halos[1] = c; }
  }
  const sprCores = new Array(n), sprHalos = new Array(n);
  for ( let i = 0; i < n; i++ ) {
    const l = list[i], q = cells.get(cellOf[i]);
    const t = l.kind === KIND.window ? tex.window : l.kind === KIND.lamp ? tex.lamp : tex.bokeh;
    const sp = new PIXI.Sprite(t); sp.anchor.set(0.5); sp.position.set(l.x, l.y); sp.width = l.w; sp.height = l.h; sp.rotation = l.rot;
    // the lamp core is whiter than its pool, like a hot filament
    sp.tint = l.kind === KIND.lamp ? l.color.mix(Color.from("#ffffff"), 0.45) : l.color;
    sp.alpha = 0; q.cores[l.kind].addChild(sp); sprCores[i] = sp;
    const hr = hrOf(l);
    const h = new PIXI.Sprite(l.kind === KIND.lamp ? tex.haloWide : tex.halo); h.anchor.set(0.5); h.position.set(l.x, l.y); h.width = h.height = hr * 2;
    // the pool is nearly white in its flat middle, so the darkness never dims the core (emissive), and takes the light's colour outwards
    h.tint = l.color.mix(Color.from("#ffffff"), 0.55); h.alpha = 0;
    q.halos[l.kind === KIND.lamp ? 1 : 0].addChild(h); sprHalos[i] = h;
    const o = i * STRIDE;
    rec[o] = l.phase; rec[o + 1] = l.rate; rec[o + 2] = l.dusk; rec[o + 3] = l.period; rec[o + 4] = l.kind; rec[o + 5] = l.tv ? l.swPhase : -1;
    if ( i % CHUNK === CHUNK - 1 ) { yield; if ( job.dead ) break; }
  }
  // dead (a newer build replaced this one, or the scene closed): the half-made containers go
  if ( job.dead ) { for ( const q of cellList ) for ( const c of [...q.cores, ...q.halos] ) c?.destroy({ children: true }); return; }
  // done: swap in (the cores kind after kind, cell after cell)
  for ( const c of e.core.removeChildren() ) c.destroy({ children: true });
  for ( const c of e.halo.removeChildren() ) c.destroy({ children: true });
  for ( const k of [0, 1, 2] ) for ( const q of cellList ) if ( q.cores[k] ) e.core.addChild(q.cores[k]);
  for ( const q of cellList ) for ( const c of q.halos ) if ( c ) e.halo.addChild(c);
  e.cores = sprCores; e.halos = sprHalos; e.count = n; e.rec = rec; e.cells = cellList; e.maxHr = maxHr;
  e.animated = list.some((l) => l.period > 0 || l.tv);   // switching lights or screens move even with twinkle at 0
  // culling: a district off screen costs one rectangle test (and a cell off screen one more)
  const area = n ? new PIXI.Rectangle(x0, y0, x1 - x0, y1 - y0) : new PIXI.Rectangle();
  for ( const c of [e.core, e.halo] ) { c.cullable = true; c.cullArea = area; }
  e.applied = -1;
}

/* The builds wait in a queue, one entry at a time, a few ms of each frame (an editor's draft replaces a build under way). */
const JOBS = [];       // { e, gen, dead }
let pumping = false;
function queueBuild(e, d, cfg) {
  const old = JOBS.findIndex((j) => j.e === e);
  if ( old >= 0 ) { JOBS[old].dead = true; JOBS.splice(old, 1); }
  if ( e.job ) e.job.dead = true;
  const job = { e, dead: false, gen: null }; job.gen = buildSteps(e, d, cfg, job);
  e.job = job; JOBS.push(job);
}
/** Run builds for ~ms; true while some are left. */
function runSlice(ms) {
  const t0 = performance.now();
  while ( JOBS.length && performance.now() - t0 < ms ) {
    const j = JOBS[0];
    let r;
    try { r = j.gen.next(); } catch ( err ) { console.error(`${MODULE_ID} | night lights`, err); r = { done: true }; j.dead = true; }
    if ( r.done || j.dead ) { JOBS.shift(); if ( j.e.job === j ) j.e.job = null; if ( !j.dead ) j.e.applied = -1; }
  }
  return JOBS.length > 0;
}
/** After a sync: the first slice at once (a scene with one small district is built before it is drawn), the rest over the next frames. */
function pump() {
  if ( JOBS.length ) runSlice(BUILD_MS);
  if ( JOBS.length && !pumping && canvas.app?.ticker ) { canvas.app.ticker.add(pumpTick); pumping = true; }
  wake();
}
function pumpTick() {
  if ( !runSlice(BUILD_MS) ) { canvas.app?.ticker?.remove(pumpTick); pumping = false; }
  wake();
}
function stopBuilds() {
  for ( const j of JOBS ) j.dead = true;
  JOBS.length = 0;
  if ( pumping ) { canvas.app?.ticker?.remove(pumpTick); pumping = false; }
}

/**
 * Called by districts.mjs whenever its views change (scene update, editor draft, Scene Config draft, local hide).
 * `views` is the districts' Map(id -> view) with `data` (effective, drafts applied), `visible` and `baseAlpha`.
 */
export function lightsSync(views) {
  if ( !canvas.ready || !canvas.scene ) return;
  const seen = new Set();
  for ( const [id, v] of views ) {
    if ( !v || v.destroyed ) continue;
    const d = v.data, cfg = lightsCfg(d);
    if ( !cfg.on || !ensureLayers() ) continue;   // the layers exist only once some district lights up
    seen.add(id);
    let e = ENTRIES.get(id);
    if ( !e ) {
      e = { id, n: 0, sig: "", core: new PIXI.Container(), halo: new PIXI.Container(), count: 0, rec: null, cores: [], halos: [], cells: [], job: null, applied: -1 };
      for ( const c of [e.core, e.halo] ) { c.eventMode = "none"; c.interactiveChildren = false; c.visible = false; }
      coreLayer.addChild(e.core); haloLayer.addChild(e.halo);
      ENTRIES.set(id, e);
    }
    const sig = sigOf(d, cfg);
    if ( sig !== e.sig && v.visible ) { e.sig = sig; queueBuild(e, d, cfg); }   // a district this client cannot see is laid out only once revealed
    e.cfg = cfg; e.shown = !!v.visible; e.base = v.baseAlpha ?? 1; e.applied = -1;
  }
  for ( const [id, e] of [...ENTRIES] ) if ( !seen.has(id) ) { destroyEntry(e); ENTRIES.delete(id); }
  retarget();
  pump();
}

/** Re-read the scene darkness / override and start the ticker when something has to move. */
function retarget() {
  target = canvas.ready ? nightTarget() : 0;
  previewAll = PREVIEW.has("*") && sceneConfig(canvas.scene).nightMode !== "off";
  wake();
}
let previewAll = false;   // the Scene Config preview yields to an explicit "off" chosen in the same form
const goal = (e) => (PREVIEW.has(e.id) || previewAll) ? 1 : target;

function wake() {
  if ( ticking || !canvas.app?.ticker || !ENTRIES.size ) return;
  canvas.app.ticker.add(tick); ticking = true;
}
function sleep() { if ( ticking ) { canvas.app?.ticker?.remove(tick); ticking = false; } }

/** The part of the scene on screen, in scene coordinates (with a margin: the stage moves between this tick and the render), or null. */
function viewRect() {
  const st = canvas.stage, sc = canvas.app?.screen;
  if ( !st || !sc || st.rotation ) return null;
  const kx = st.scale.x || 1, ky = st.scale.y || 1, m = 160 / Math.min(kx, ky);
  return { x0: (0 - st.position.x) / kx + st.pivot.x - m, y0: (0 - st.position.y) / ky + st.pivot.y - m, x1: (sc.width - st.position.x) / kx + st.pivot.x + m, y1: (sc.height - st.position.y) / ky + st.pivot.y + m };
}

function tick() {
  const dt = Math.min((canvas.app.ticker.deltaMS || 16) / 1000, 0.1), now = performance.now() / 1000;
  const still = reducedMotion() || perfLow();   // (performance mode Low: no twinkle)
  let busy = false, vr;
  for ( const e of ENTRIES.values() ) {
    const g = goal(e);
    // night fades in and out over ~1 s (instantly with reduced motion)
    if ( e.n !== g ) { e.n = still ? g : e.n + (g - e.n) * Math.min(1, dt / 0.45); if ( Math.abs(e.n - g) < 0.004 ) e.n = g; }
    const show = e.shown && e.n > 0.001 && e.count > 0;
    e.core.visible = e.halo.visible = show;
    const moving = !still && (e.cfg.twinkle > 0 || e.animated);
    if ( show ) {
      vr ??= (globalThis.CONFIG?.moinenMaps?.noLightCull ? null : viewRect()) ?? false;      // (CONFIG.moinenMaps.noLightCull: every cell updated and drawn, for A/B)
      apply(e, now, still, vr || null, moving);
      e.applied = e.n;
    }
    if ( e.n !== g || (show && moving) ) busy = true;
  }
  if ( !busy ) sleep();
}

/**
 * Per-light alpha: dusk order, twinkle, switching. Alpha only (0 = unlit): the particle containers upload only tint + alpha. Only the
 * cells on screen (`vr`) are updated - a cell that comes into view later is updated then (`q.n` is the night level it holds; -2 =
 * skipped while off screen); a still scene updates a cell only when its level changed or it was off screen.
 */
function apply(e, t, still, vr, moving) {
  const { rec, cores, halos, cfg } = e, n = e.n, base = e.base, tw = still ? 0 : cfg.twinkle, glowK = 0.7 + 0.3 * cfg.glow, force = e.applied !== n;
  for ( const q of e.cells ) {
    const on = !vr || !(q.x1 < vr.x0 || q.x0 > vr.x1 || q.y1 < vr.y0 || q.y0 > vr.y1);
    // (PIXI 7.4 in Foundry has no culler: a cell off screen is not drawn because it is not visible)
    if ( on !== q.vis ) { q.vis = on; for ( const c of q.cores ) if ( c ) c.visible = on; for ( const c of q.halos ) if ( c ) c.visible = on; }
    if ( !on ) { q.n = -2; continue; }
    if ( !moving && !force && q.n === n ) continue;
    q.n = n;
    const items = q.items;
    for ( let k = 0; k < items.length; k++ ) {
      const i = items[k], o = i * STRIDE, c = cores[i], h = halos[i];
      let a = (n - rec[o + 2]) / 0.2;
      if ( a <= 0 ) { c.alpha = h.alpha = 0; continue; }
      if ( a > 1 ) a = 1;
      if ( !still ) {
        const ph = rec[o], rate = rec[o + 1], kind = rec[o + 4];
        if ( rec[o + 5] >= 0 ) a *= 0.72 + 0.28 * Math.sin(t * 9.1 + ph) * Math.sin(t * 5.3 + rec[o + 5]);        // a screen flickers
        else if ( kind === KIND.lamp ) a *= 1 - tw * (0.12 * (0.5 + 0.5 * Math.sin(t * rate * 3.1 + ph)) + (Math.sin(t * 0.37 * rate + ph) > 0.992 ? 0.6 : 0)); // hum + a rare stutter
        else if ( kind === KIND.bokeh ) a *= 1 - tw * 0.45 * (0.5 + 0.5 * Math.sin(t * rate * 0.6 + ph));          // slow breathing
        else a *= 1 - tw * 0.3 * (0.5 + 0.5 * Math.sin(t * rate * 1.7 + ph)) * (0.5 + 0.5 * Math.sin(t * 0.23 + ph * 1.7)); // a lamp behind a curtain
        const per = rec[o + 3];
        if ( per > 0 ) a *= clamp((Math.sin(t * TAU / per + ph * 3.3) + 0.25) * 3, 0, 1);                     // someone switches it off for a while
      }
      if ( a <= 0.003 ) { c.alpha = h.alpha = 0; continue; }
      c.alpha = a * base; h.alpha = a * base * glowK;
    }
  }
}

/** While an editor shows its night-light controls, its district (or every district: "*") shows the lights as at night. */
/** (bench) how many lights are built. */
export const _stats = () => ({ lights: [...ENTRIES.values()].reduce((a, e) => a + (e.count || 0), 0), districts: ENTRIES.size });

export function setNightPreview(id, on) {
  if ( on ) PREVIEW.add(id); else PREVIEW.delete(id);
  if ( canvas.ready ) retarget();
}

function teardown() {
  sleep(); stopBuilds();
  for ( const e of ENTRIES.values() ) destroyEntry(e);
  ENTRIES.clear(); PREVIEW.clear();
  for ( const l of [coreLayer, haloLayer] ) if ( l && !l.destroyed ) l.destroy({ children: true });
  coreLayer = haloLayer = null; target = 0;
}

let envTarget = null, envListener = null;
function listenDarkness() {
  const env = canvas.environment;
  if ( envTarget === env ) return;
  if ( envTarget && envListener ) envTarget.removeEventListener?.("darknessChange", envListener);
  envTarget = env; envListener = () => retarget();
  env?.addEventListener?.("darknessChange", envListener);
}

Hooks.on("canvasReady", () => { listenDarkness(); retarget(); });
Hooks.on("canvasTearDown", () => { if ( envTarget && envListener ) envTarget.removeEventListener?.("darknessChange", envListener); envTarget = envListener = null; teardown(); });
// a pan brings cells into view: a still scene wakes for one frame to update them
Hooks.on("canvasPan", () => { if ( ENTRIES.size ) wake(); });
Hooks.on("lightingRefresh", () => { attachHalos(); if ( ENTRIES.size ) retarget(); });
Hooks.on("initializeCanvasEnvironment", () => { if ( ENTRIES.size ) retarget(); });
Hooks.on("updateScene", (scene) => { if ( scene.id === canvas.scene?.id && ENTRIES.size ) retarget(); });
Hooks.on("updateSetting", (s) => { if ( s.key === `${MODULE_ID}.respectReducedMotion` ) { for ( const e of ENTRIES.values() ) e.applied = -1; wake(); } });

export const _lightsDbg = () => ({ entries: [...ENTRIES.values()].map((e) => ({ id: e.id, count: e.count, n: e.n, shown: e.shown, visible: e.core.visible })), target, ticking, halo: !!haloLayer?.parent });

/* ------------------------------------------------------------------ UI */

/**
 * The look controls (shared by the district editor and the Districts workspace night panel). `p` = field-name prefix, `v` = values.
 * The editor adds its own on/inherit select and the "own look" switch around these.
 */
export function lightFieldsHtml(p, v) {
  const rng_ = (n, val, min, max, step) => `<range-picker name="${p}${n}" value="${val}" min="${min}" max="${max}" step="${step}"></range-picker>`;
  const sel = (n, val, opts) => `<select name="${p}${n}">${opts.map(([a, b]) => `<option value="${a}"${a === val ? " selected" : ""}>${esc(b)}</option>`).join("")}</select>`;
  return `${fg(T("Night.style"), sel("style", v.style, LIGHT_STYLES.map((s) => [s, T(`Night.style_${s}`)])), T("Night.styleHint"))}
    ${fg(T("Night.warmth"), `${sel("warmth", v.warmth, LIGHT_WARMTH.map((s) => [s, T(`Night.warmth_${s}`)]))}<color-picker name="${p}color" value="${esc(v.color)}"></color-picker>`)}
    ${fg(T("Night.density"), rng_("density", v.density, 0.05, 1, 0.05))}
    ${fg(T("Night.size"), rng_("size", v.size, 0.4, 2.5, 0.05))}
    ${fg(T("Night.glow"), rng_("glow", v.glow, 0, 1, 0.05), T("Night.glowHint"))}
    ${fg(T("Night.twinkle"), rng_("twinkle", v.twinkle, 0, 1, 0.05))}
    ${fg(T("Night.switching"), rng_("switching", v.switching, 0, 1, 0.05), T("Night.switchingHint"))}`;
}

export function readLightValues(vals, p) {
  return { style: vals[p + "style"], warmth: vals[p + "warmth"], color: vals[p + "color"], density: Number(vals[p + "density"]), size: Number(vals[p + "size"]),
    glow: Number(vals[p + "glow"]), twinkle: Number(vals[p + "twinkle"]), switching: Number(vals[p + "switching"]) };
}

/** Grey out what does not apply: the custom colour unless "custom" is chosen. */
export function wireLightFields(root, p) {
  const upd = () => {
    const w = root.querySelector(`[name="${p}warmth"]`), cp = root.querySelector(`[name="${p}color"]`);
    if ( w && cp ) { const off = w.value !== "custom"; cp.inert = off; cp.classList.toggle("is-off", off); }
  };
  root.addEventListener("change", upd); upd();
}

/** Keep a district (or "*") previewed at night while `fold` is open; returns a cleanup. */
export function previewWhileOpen(fold, id) {
  if ( !fold ) return () => {};
  const sync = () => setNightPreview(id, fold.open && fold.isConnected);
  fold.addEventListener("toggle", sync); sync();
  return () => { fold.removeEventListener("toggle", sync); setNightPreview(id, false); };
}
