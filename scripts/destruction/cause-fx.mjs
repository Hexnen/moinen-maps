import { reducedMotion } from "../config.mjs";
import { pxFlash, pxLine, boltTree, boltCells, pxBolt, pxRunDisc, sigilCells, hashU } from "./pixel-fx.mjs";

/**
 * The CAUSE of a damage on screen (display side; the bake side is the CAUSE table of core.mjs). On top of the kind's entry and idle:
 *  - the entry's clock: `slow` stretches the whole entry (rot creeps, lightning strikes), `curve` shapes how the front spreads
 *    (front 0..1, angle: arcane spirals round the impact);
 *  - what the dissolving edge sheds (`edge`, a share of the particles) and what rides on the front;
 *  - the pieces' tint while they move (`tint`), one-shot accents (a flash, a ring, lightning bolts, a rune ring, a shock with a jolt,
 *    a claw slash);
 *  - the idle life (embers, bubbles, sparks, motes, dust, drips, spores, glints) and the pulse of its light;
 *  - the LIGHT: the bake's kind-3 sprite (the cause's emissive pixels, soft) is laid twice: added over the ruin (a faint bloom) and
 *    into Foundry's illumination (MAX_COLOR, like the districts' night lights), so in a dark scene the glowing pixels keep their
 *    colour and light the ground a little around them. Foundry empties that container on every lighting refresh: it is put back
 *    from the "lightingRefresh" hook.
 * One row per cause (index as core.mjs CAUSES); 0 = none: nothing here runs and the kind's entry is exactly what it was.
 * Reduced motion: no entry (the kind's fade), no pulse, no idle.
 */
const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;
const TAU = Math.PI * 2;

export const CAUSE_LOOK = [
  null,
  /* fire      */ { slow: 1.1, curve: (f) => Math.sqrt(f), share: 0.35, tint: 0xffa060, front: 0.35, edge: { color: [0xff9a3c, 0xffd36b, 0xd2401c, 0xffb347], rise: -6, life: 650, flicker: true },
    flash: 0xffb060, ring: 0xffa050, idle: "ember", pulse: "flicker", light: 0.5 },
  /* acid      */ { slow: 1.5, curve: (f) => f, share: 0.6, tint: 0xd8ff80, front: 0.5, edge: { color: [0xb6ff4a, 0xe8ff9a, 0x7fd02a], rise: -3, life: 650 },
    ring: 0x9fe060, idle: "bubble", pulse: "slow", light: 0.35, hot: [0xeaff9a, 0xb6ff4a, 0x6fa02a], stain: 0x9fe050 },
  /* lightning */ { slow: 0.55, curve: (f) => Math.pow(f, 0.35), share: 0.1, tint: null, front: 0.08, edge: { color: [0xffffff, 0xaad8ff], vy: -7, fall: 40, life: 200, drag: 2 },
    bolt: true, idle: "spark", pulse: "crackle", light: 0.4, hot: [0xffffff, 0xdcecff, 0x9fc8ff], stain: 0xd8ecff },
  /* arcane    */ { slow: 1.25, curve: (f, a) => clamp01(Math.sqrt(f) * 0.78 + (((a / TAU) % 1) + 1) % 1 * 0.22), share: 0.6, tint: 0xd8b0ff, front: 0.6,
    edge: { color: [0xc890ff, 0xf0d8ff, 0x9a6aff], rise: -4, life: 900 }, ring: 0xb070ff, rune: true, idle: "mote", pulse: "breathe", light: 0.5, hot: [0xf0d8ff, 0xc890ff, 0x7a4ad8], stain: 0xb070ff },
  /* impact    */ { slow: 0.7, curve: (f) => Math.pow(f, 0.45), share: 0.4, tint: null, front: 0.3, edge: { color: [0xcfc6b8, 0xb9ae9e], vy: -2, rise: -3, life: 600, drag: 2.4 },
    ring: 0xf3e6cc, shock: true, idle: "dust", hot: null, stain: 0x8a7a62 },
  /* claws     */ { slow: 0.8, curve: (f) => f, share: 0.4, tint: null, front: 0, edge: { color: [0xfff0b0, 0xe8dcc8], vy: -5, fall: 30, life: 260, drag: 2 },
    slash: true, idle: null, hot: null },
  /* water     */ { slow: 1.3, curve: (f) => Math.pow(f, 0.7), share: 0.6, tint: 0xb8d4ff, front: 0.5, edge: { color: [0xe6f4ff, 0x9fc8ee], vy: -1, life: 450, drag: 3 },
    ring: 0xcfe8ff, idle: "drip", hot: null, stain: 0x203448 },
  /* decay     */ { slow: 1.9, curve: (f) => f, share: 0.6, tint: 0xc8d4a0, front: 0.35, edge: { color: [0x9aa868, 0xb9ae9e, 0x6f7f45], rise: -2, life: 1400 },
    idle: "spore", hot: null, stain: 0x3a4a22 },
  /* frost     */ { slow: 1.15, curve: (f) => Math.pow(f, 0.6), share: 0.55, tint: 0xe4f2ff, front: 0.5, edge: { color: [0xffffff, 0xd8ecff], rise: -1, life: 520 },
    ring: 0xe8f4ff, idle: "glint", hot: [0xffffff, 0xe0f0ff, 0xa8d0f0], stain: 0xe8f4ff }
];
export const causeLook = (c) => CAUSE_LOOK[c | 0] ?? null;
const pick = (a) => a[(Math.random() * a.length) | 0];
/** Per cause: the share of its edge particles that are chips (fire: coals, acid: crumbs, lightning: glass, frost: ice). */
const CHIP = [0, 0.15, 0.2, 0.3, 0, 0, 0, 0, 0, 0.3];

/** A particle of the cause at (x, y) (art px). */
export function causeParticle(d, cl, x, y, k = 1) {
  const e = cl.edge, j = () => Math.random() - 0.5;
  // a share of the edge comes off as CHIPS of the cause's material (debris.mjs: ice chips, glass, coals, dissolving crumbs), not specks
  const g = d._owner, ch = CHIP[CAUSE_LOOK.indexOf(cl)] ?? 0;
  if ( ch && g?.chunks && g.anim && Math.random() < ch ) {
    const n = (g.anim.chunkN = (g.anim.chunkN ?? 0) + 1);
    d.chunks(g, g.anim, { count: 1, sizes: [3, 5], H: [2, 6], seed: 300 + n, from: () => [x, y], to: (i, h) => [x + (h(4) - 0.5) * 12, y + (h(5) - 0.5) * 9] });
    return;
  }
  d.spawn({ x, y, vx: j() * 6 + (e.vx ?? 0), vy: (e.vy ?? 0) + j() * 2, rise: e.rise, fall: e.fall, drag: e.drag, life: e.life * (0.7 + Math.random() * 0.6) * k,
    color: pick(e.color), alpha: 0.9, flicker: e.flicker, size: Math.random() < 0.2 ? 2 : 1 });
}

/** The cause's part of an entry frame: the light's fade-in, what rides on the front, one-shot accents. */
export function causeEffects(d, g, a, now, el) {
  const cl = a.cl; if ( !cl ) return;
  const k = a.k, pw = a.pw, R = Math.max(4, g.info.R), ap = d.ap, o = d.origin;
  const X = (x) => o.x + x * ap, Y = (y) => o.y + y * ap;
  const once = (key, at, fn) => { if ( el >= at && !a.fired.has(`c:${key}`) ) { a.fired.add(`c:${key}`); fn(); } };
  const tFront = clamp01((el - a.delay) / Math.max(1, a.reveal));
  g.glowIn = clamp01((el - a.delay) / Math.max(1, a.reveal + a.band * 0.5));
  // on the front
  if ( cl.front && tFront < 1 && Math.random() < cl.front ) {
    const ang = Math.random() * TAU, fr = a.Rmax * Math.sqrt(tFront);
    causeParticle(d, cl, a.ox + Math.cos(ang) * fr, a.oy + Math.sin(ang) * fr * 0.85, k);
  }
  const V = { ap, ox: o.x, oy: o.y };
  const draw = (key, at, dur, paint, blend = PIXI.BLEND_MODES.NORMAL) => once(key, at, () => {
    const gr = d.pixelCanvas(); gr.blendMode = blend;
    a.fx.push({ g: gr, kind: "cause", t0: a.start + at, dur, draw: (t) => paint(gr, t) });
  });
  // all accents in art pixels on the art grid (pixel-fx.mjs): no soft discs, no vector rings or lines
  if ( cl.flash ) draw("flash", 0, 150 * k, (gr, t) => pxFlash(gr, V, a.ox, a.oy, Math.min(R * 0.5, 14) * pw, t, { seed: a.seed + 31, colors: [0xffffff, cl.flash, cl.ring ?? cl.flash], rays: 5 }));
  // the cause's shock: a skirt of puffs in its colour, never a drawn ring; not round a tear (round its puncture the puffs spread
  // into curved arcs that read as vector ring segments)
  if ( cl.ring && !a.tear ) once("ring", a.delay + a.reveal * 0.15, () => d.burst(a.ox, a.oy, Math.min(R * 1.2, 60) * pw, now, { n: 16, color: cl.ring, rise: -2, speed: 1.2 }));
  if ( cl.bolt ) {
    // ONE strike (two channels on a big area): a branching bolt from above (screen-up) to the strike point - a jagged main channel,
    // 2-4 forks and a twig (pixel-fx boltTree), white core over a blue glow, on ~170 ms with one flicker gap; a hard, small additive
    // flash of the ground round the strike; a second, fainter restrike 90 ms later on the same channel. Deterministic per area.
    const H = 34 + R * 1.4, s0 = a.seed * 7 + 3, chans = R > 18 ? 2 : 1, trees = [];
    for ( let c = 0; c < chans; c++ ) {
      const sx = a.ox + (hashU(s0, c, 1) - 0.5) * R * 0.9, ex = a.ox + (c ? (hashU(s0, c, 2) - 0.5) * R * 0.7 : 0), ey = a.oy + (c ? (hashU(s0, c, 3) - 0.5) * R * 0.5 : 0);
      trees.push(boltCells(boltTree(s0 + c * 131, sx, a.oy - H * (c ? 0.8 : 1), ex, ey)));
    }
    const ADD = PIXI.BLEND_MODES.ADD;
    draw("boltflash", 0, 80 * k, (gr, t) => { if ( t < 0.6 ) pxRunDisc(gr, V, a.ox, a.oy, Math.min(R * 0.6, 14) * pw, 0xdcecff, 0.3 * (1 - t / 0.6), s0); }, ADD);   // (a short fused flash at the strike, no speckle cloud)
    trees.forEach((cells, c) => draw(`bolt${c}`, c * 35 * k, 175 * k, (gr, t) => pxBolt(gr, V, cells, t, { seed: s0 + c, glow: c ? 0x6fa8ff : 0x8fc8ff })));
    draw("restrike", 90 * k, 110 * k, (gr, t) => pxBolt(gr, V, trees[0], 0.5 + t * 0.5, { seed: s0 + 9, glow: 0x5f90e8 }));
  }
  if ( cl.rune ) draw("rune", a.delay, 1100 * k, (gr, t) => {
    // a ring of inscribed SIGILS (pixel-fx sigilStrokes: curved and angular strokes with ticks, never a cross) that turns a little,
    // each glyph lighting in turn and pulsing, then dying by dropout
    const rr = Math.max(6, R * 0.66) * (1 + 0.9 * Math.pow(1 - Math.min(1, t * 2.2), 2)), n = clamp01(R * 0.66 / 30) > 0.5 ? 8 : 6, rot = t * 0.5, sz = Math.max(2, Math.min(4, rr * 0.16));
    for ( let i = 0; i < n; i++ ) {
      const on = clamp01((t * 1.6 - i / n * 0.5) * 3), pul = 0.75 + 0.25 * Math.sin(t * 18 + i * 1.3), al = on * pul * (t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1);
      if ( al < 0.12 ) continue;
      const ang = rot + i / n * TAU, cx = a.ox + Math.cos(ang) * rr, cy = a.oy + Math.sin(ang) * rr * 0.82;
      gr.beginFill(i & 1 ? 0xd8a8ff : 0xf0d8ff, 1);
      for ( const [x, y] of sigilCells(a.seed * 13 + i, cx, cy, sz) ) if ( hashU(x, y, i) < al ) gr.drawRect(V.ox + x * ap, V.oy + y * ap, ap, ap);
      gr.endFill();
    }
  }, PIXI.BLEND_MODES.ADD);
  if ( cl.shock ) {
    // a heavy blow: the ground jolts for a moment, a dust skirt
    const j = el < 140 * k ? (((Math.floor(el / 35) & 1) ? 1 : -1) * ap) : 0;
    g.baseCont?.position.set(0, j); g.shardCont?.position.set(0, j);
    once("skirt", 40 * k, () => d.burst(a.ox, a.oy, R * pw, now, { n: 20, color: 0xcfc6b8, rise: -3, speed: 1.3 }));
  }
  if ( cl.slash ) {
    const ang = g.info.axis || 0, ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux, L = Math.max(10, g.info.len || R * 2) * 0.6;
    draw("slash", 0, 260 * k, (gr, t) => {
      const grow = Math.min(1, t * 3), al = 1 - t;
      for ( const off of [-1, 0, 1] ) {
        const cx = a.ox + nx * off * Math.max(2, R * 0.5), cy = a.oy + ny * off * Math.max(2, R * 0.5);
        pxLine(gr, V, cx - ux * L, cy - uy * L, cx - ux * L + ux * 2 * L * grow, cy - uy * L + uy * 2 * L * grow, 0xfff4d8, { drop: 1 - al, seed: off + 3 });
      }
    });
  }
}

/** Idle life of a settled damage: the cause's own particle now and then (instead of the kind's, about two times in three). */
export function causeIdle(d, g, x, y) {
  const cl = causeLook(g.info.cause); if ( !cl?.idle || Math.random() > 0.65 ) return false;
  const j = () => Math.random() - 0.5;
  switch ( cl.idle ) {
    case "ember": d.spawn({ x, y, vx: j() * 3, vy: 0, rise: -6 - Math.random() * 5, life: 1300 + Math.random() * 900, color: 0xff9a3c, flicker: true }); break;
    case "bubble": d.spawn({ x, y, vx: 0, vy: 0, rise: -1.5, life: 700, color: 0xd8ff8a, alpha: 0.9 }); d.spawn({ x: x + 1, y: y - 1, vx: 0, vy: 0, rise: -2, life: 500, color: 0x9fe060, alpha: 0.8 }); break;
    case "spark": for ( let q = 0; q < 3; q++ ) d.spawn({ x, y, vx: j() * 16, vy: -4 - Math.random() * 5, fall: 40, life: 220, color: q ? 0xaad8ff : 0xffffff, drag: 2 }); break;
    case "mote": d.spawn({ x, y, vx: j() * 2, vy: 0, rise: -3, life: 1600, color: Math.random() < 0.5 ? 0xd8b0ff : 0xf0d8ff, alpha: 0.9 }); break;
    case "dust": for ( let q = 0; q < 2; q++ ) d.spawn({ x: x + q, y, vx: j() * 2, vy: 0, rise: -2, life: 1100, color: 0xcfc6b8, alpha: 0.7 }); break;
    case "drip": d.spawn({ x, y: y - 6, vx: 0, vy: 0, fall: 30, life: 420, color: 0xcfe8ff, alpha: 0.9 }); break;
    case "spore": d.spawn({ x, y, vx: j() * 1.5, vy: 0, rise: -1.2, life: 2200, color: Math.random() < 0.5 ? 0xc8d4a0 : 0x9aa868, alpha: 0.75 }); break;
    case "glint": d.spawn({ x, y, vx: 0, vy: 0, life: 260, color: 0xffffff }); break;
    default: return false;
  }
  return true;
}

/* ---------------------------------------------------------------- the light */

function lightHost() { return canvas.effects?.illumination?.lights ?? null; }

function ensureLights(d) {
  if ( d.causeLights && !d.causeLights.layer.destroyed ) return d.causeLights;
  const layer = new PIXI.Container(); layer.eventMode = "none"; layer.interactiveChildren = false; layer.zIndex = 1e6;
  const attach = () => { const h = lightHost(); if ( h && layer.parent !== h && !layer.destroyed ) h.addChild(layer); };
  d.causeLights = { layer, groups: new Set(), attach, hook: Hooks.on("lightingRefresh", attach) };
  attach();
  return d.causeLights;
}

/** A group's light (its kind-3 frame at x, y art px): a faint bloom over its ruin, and a pool in the scene's illumination. */
export function addLight(d, g, tex, x, y) {
  const L = ensureLights(d), ap = d.ap, o = d.origin, cl = causeLook(g.info.cause);
  const bloom = new PIXI.Sprite(tex);
  bloom.eventMode = "none"; bloom.blendMode = PIXI.BLEND_MODES.ADD; bloom.scale.set(ap); bloom.position.set(o.x + x * ap, o.y + y * ap); bloom.alpha = 0;
  g.baseCont.addChildAt(bloom, Math.min(1, g.baseCont.children.length));
  const pool = new PIXI.Sprite(tex);
  // exactly over its pixels (the cores must sit on the glowing pixels; the soft margin is baked into the texture)
  pool.eventMode = "none"; pool.blendMode = PIXI.BLEND_MODES.MAX_COLOR ?? PIXI.BLEND_MODES.ADD; pool.scale.set(ap);
  pool.position.set(o.x + x * ap, o.y + y * ap); pool.visible = false;
  L.layer.addChild(pool);
  g.light = { bloom, pool, tex, base: cl?.light ?? 0.4, seed: (g.hash % 997) / 97 };
  L.groups.add(g);
}

/**
 * DARK-SCENE READABILITY for a damage that does not glow (no cause, impact, claws, water, rot, frost): a faint rim light on its lips and
 * an ambient lift over its own pixels, laid into Foundry's illumination like the cause lights, only as the scene grows dark (nothing by
 * day: tickLights). Made from the cover (the stroke's own pixels, cw x ch RGBA at x, y art px): edge pixels full, the inside faint,
 * softened by two box blurs; the colour per cause (a cool moonlit grey for plain damage, blue for water, green for rot, ice for frost).
 */
const RIM = [[175, 182, 196], null, null, null, null, [210, 198, 176], [205, 186, 158], [130, 182, 232], [160, 210, 120], [196, 230, 255]];
export function addRim(d, g, cov, x, y) {
  const col = RIM[g.info.cause | 0]; if ( !col || !cov?.data ) return;
  const { w, h, data } = cov, B = 4, LW = w + 2 * B, LH = h + 2 * B;
  let A = new Float32Array(LW * LH);
  const inA = (X, Y) => X >= 0 && Y >= 0 && X < w && Y < h && data[(Y * w + X) * 4 + 3] > 0;
  for ( let Y = 0; Y < h; Y++ ) for ( let X = 0; X < w; X++ ) {
    if ( !inA(X, Y) ) continue;
    const edge = !inA(X - 1, Y) || !inA(X + 1, Y) || !inA(X, Y - 1) || !inA(X, Y + 1);
    A[(Y + B) * LW + X + B] = edge ? 1 : 0.22;
  }
  for ( let pass = 0; pass < 2; pass++ ) {
    const T = new Float32Array(LW * LH), r = 1;
    for ( let Y = 0; Y < LH; Y++ ) for ( let X = 0; X < LW; X++ ) { let s = 0, n = 0; for ( let k = -r; k <= r; k++ ) { const q = X + k; if ( q >= 0 && q < LW ) { s += A[Y * LW + q]; n++; } } T[Y * LW + X] = s / n; }
    for ( let Y = 0; Y < LH; Y++ ) for ( let X = 0; X < LW; X++ ) { let s = 0, n = 0; for ( let k = -r; k <= r; k++ ) { const q = Y + k; if ( q >= 0 && q < LH ) { s += T[q * LW + X]; n++; } } A[Y * LW + X] = s / n; }
  }
  const px = new Uint8Array(LW * LH * 4);
  for ( let i = 0; i < LW * LH; i++ ) { const v = Math.min(1, A[i] * 1.6); px[i * 4] = col[0] * v; px[i * 4 + 1] = col[1] * v; px[i * 4 + 2] = col[2] * v; px[i * 4 + 3] = 255 * v; }
  const tex = PIXI.Texture.fromBuffer(px, LW, LH);
  const L = ensureLights(d), ap = d.ap, o = d.origin, pool = new PIXI.Sprite(tex);
  pool.eventMode = "none"; pool.blendMode = PIXI.BLEND_MODES.MAX_COLOR ?? PIXI.BLEND_MODES.ADD; pool.scale.set(ap);
  pool.position.set(o.x + (x - B) * ap, o.y + (y - B) * ap); pool.visible = false;
  L.layer.addChild(pool);
  g.rim = { pool, tex };
  L.groups.add(g);
}

export function dropLight(d, g) {
  if ( g.rim ) { d.causeLights?.groups.delete(g); if ( !g.rim.pool.destroyed ) g.rim.pool.destroy(); g.rim.tex.destroy(true); g.rim = null; }
  if ( !g.light ) return;
  d.causeLights?.groups.delete(g);
  if ( !g.light.pool.destroyed ) g.light.pool.destroy();
  if ( !g.light.bloom.destroyed ) g.light.bloom.destroy();
  g.light.tex.destroy(false);
  g.light = null;
}

/** Every frame: the lights follow their group (shown, fading, entering) and pulse with the cause (not with reduced motion). */
export function tickLights(d, now) {
  const L = d.causeLights; if ( !L?.groups.size ) return;
  L.attach();
  const still = reducedMotion() || !d.idle.on;
  // no bloom by day (the pixels carry the look; a soft glow over a lit map reads as a smudge); it grows with the scene's darkness,
  // where the pool lifts the dark too
  const dark = Math.min(1, Math.max(0, canvas.environment?.darknessLevel ?? 0)), bloomK = dark * dark;
  // the rims of non-glowing damage: none by day, from a darkness of 0.5 up to full at 0.85
  const rimK = Math.min(1, Math.max(0, (dark - 0.5) / 0.35));
  for ( const g of L.groups ) {
    const shown = !!g.cont.parent && !g.dead && g.cont.visible !== false;
    if ( g.rim ) { const a = shown ? rimK * g.cont.alpha * (g.anim ? (g.glowIn ?? clamp01((now - g.anim.start - g.anim.delay) / Math.max(1, g.anim.reveal))) : 1) : 0; g.rim.pool.visible = a > 0.01; g.rim.pool.alpha = Math.min(1, a); }
    const lt = g.light; if ( !lt ) continue;
    let a = shown ? g.cont.alpha * (g.anim ? (g.glowIn ?? 0) : 1) : 0;
    if ( a > 0 && !still ) a *= pulse(causeLook(g.info.cause)?.pulse, now, lt.seed);
    lt.pool.visible = a > 0.01; lt.pool.alpha = Math.min(1, a) * 0.85;
    lt.bloom.alpha = Math.min(1, a) * lt.base * bloomK;
  }
}

function pulse(kind, t, s) {
  switch ( kind ) {
    case "flicker": return 0.82 + 0.1 * Math.sin(t / 97 + s) + 0.08 * Math.sin(t / 41 + s * 3);
    case "breathe": return 0.78 + 0.22 * Math.sin(t / 900 + s);
    case "slow": return 0.9 + 0.1 * Math.sin(t / 1500 + s);
    case "crackle": return (Math.floor(t / 70 + s * 13) % 37) === 0 ? 1.25 : 0.9;
    default: return 1;
  }
}

export function disposeLights(d) {
  const L = d.causeLights; if ( !L ) return;
  Hooks.off("lightingRefresh", L.hook);
  for ( const g of [...L.groups] ) dropLight(d, g);
  if ( !L.layer.destroyed ) L.layer.destroy({ children: true });
  d.causeLights = null;
}
