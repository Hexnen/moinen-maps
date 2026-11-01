import { reducedMotion } from "../config.mjs";
import { pxRing, pxFlash, pxLine } from "./pixel-fx.mjs";

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
  /* fire      */ { slow: 1.1, curve: (f) => Math.sqrt(f), share: 0.6, tint: 0xffa060, front: 0.8, edge: { color: [0xff9a3c, 0xffd36b, 0xff7a2a], rise: -6, life: 700, flicker: true },
    flash: 0xffb060, ring: 0xffa050, idle: "ember", pulse: "flicker", light: 0.5 },
  /* acid      */ { slow: 1.5, curve: (f) => f, share: 0.6, tint: 0xd8ff80, front: 0.5, edge: { color: [0xb6ff4a, 0xe8ff9a, 0x7fd02a], rise: -3, life: 650 },
    ring: 0x9fe060, idle: "bubble", pulse: "slow", light: 0.35 },
  /* lightning */ { slow: 0.55, curve: (f) => Math.pow(f, 0.35), share: 0.5, tint: 0xd8ecff, front: 0.6, edge: { color: [0xffffff, 0xaad8ff], vy: -7, fall: 40, life: 220, drag: 2 },
    flash: 0xe6f4ff, bolt: true, idle: "spark", pulse: "crackle", light: 0.4 },
  /* arcane    */ { slow: 1.25, curve: (f, a) => clamp01(Math.sqrt(f) * 0.78 + (((a / TAU) % 1) + 1) % 1 * 0.22), share: 0.6, tint: 0xd8b0ff, front: 0.6,
    edge: { color: [0xc890ff, 0xf0d8ff, 0x9a6aff], rise: -4, life: 900 }, ring: 0xb070ff, rune: true, idle: "mote", pulse: "breathe", light: 0.5 },
  /* impact    */ { slow: 0.7, curve: (f) => Math.pow(f, 0.45), share: 0.4, tint: null, front: 0.3, edge: { color: [0xcfc6b8, 0xb9ae9e], vy: -2, rise: -3, life: 600, drag: 2.4 },
    ring: 0xf3e6cc, shock: true, idle: "dust" },
  /* claws     */ { slow: 0.8, curve: (f) => f, share: 0.4, tint: null, front: 0, edge: { color: [0xfff0b0, 0xe8dcc8], vy: -5, fall: 30, life: 260, drag: 2 },
    slash: true, idle: null },
  /* water     */ { slow: 1.3, curve: (f) => Math.pow(f, 0.7), share: 0.6, tint: 0xb8d4ff, front: 0.5, edge: { color: [0xe6f4ff, 0x9fc8ee], vy: -1, life: 450, drag: 3 },
    ring: 0xcfe8ff, idle: "drip" },
  /* decay     */ { slow: 1.9, curve: (f) => f, share: 0.6, tint: 0xc8d4a0, front: 0.35, edge: { color: [0x9aa868, 0xb9ae9e, 0x6f7f45], rise: -2, life: 1400 },
    idle: "spore" },
  /* frost     */ { slow: 1.15, curve: (f) => Math.pow(f, 0.6), share: 0.55, tint: 0xe4f2ff, front: 0.5, edge: { color: [0xffffff, 0xd8ecff], rise: -1, life: 520 },
    ring: 0xe8f4ff, idle: "glint" }
];
export const causeLook = (c) => CAUSE_LOOK[c | 0] ?? null;
const pick = (a) => a[(Math.random() * a.length) | 0];

/** A particle of the cause at (x, y) (art px). */
export function causeParticle(d, cl, x, y, k = 1) {
  const e = cl.edge, j = () => Math.random() - 0.5;
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
  // the cause's shock: a skirt of puffs in its colour, never a drawn ring
  if ( cl.ring ) once("ring", a.delay + a.reveal * 0.15, () => d.burst(a.ox, a.oy, Math.min(R * 1.2, 60) * pw, now, { n: 16, color: cl.ring, rise: -2, speed: 1.2 }));
  if ( cl.bolt ) for ( const [key, at] of [["bolt1", 0], ["bolt2", 110 * k], ["bolt3", 260 * k]] ) {
    // a bolt from above to the strike: a jagged polyline, white core, blue glow, flickering
    const pts = [], H = 40 + R * 1.5, seg = 8;
    let x = a.ox + (Math.random() - 0.5) * R, y = a.oy - H;
    for ( let s = 0; s <= seg; s++ ) { pts.push([x, y]); const f = (s + 1) / seg; x = a.ox + (x - a.ox) * (1 - f) + (Math.random() - 0.5) * 10 * (1 - f); y = a.oy - H + H * f; }
    draw(key, at, 170 * k, (gr, t) => {
      if ( (Math.floor(t * 7) & 1) && t > 0.3 ) return;
      // a pixel bolt: a blue halo line one pixel to the right, the white core over it
      for ( let q = 1; q < pts.length; q++ ) pxLine(gr, V, pts[q - 1][0] + 1, pts[q - 1][1], pts[q][0] + 1, pts[q][1], 0x8fc8ff, { drop: t * 0.6, seed: q });
      for ( let q = 1; q < pts.length; q++ ) pxLine(gr, V, pts[q - 1][0], pts[q - 1][1], pts[q][0], pts[q][1], 0xffffff, { drop: t * 0.4, seed: q + 50 });
    });
  }
  if ( cl.rune ) draw("rune", a.delay, 1100 * k, (gr, t) => {
    // a rune ring that turns and fades: twelve dashes and their ticks
    const rr = Math.max(5, R * 0.62), al = Math.sin(Math.min(1, t * 1.4) * Math.PI) * 0.85, rot = t * 0.9;
    if ( al < 0.15 ) return;
    for ( let i = 0; i < 12; i++ ) {
      const a0 = rot + i / 12 * TAU, a1 = a0 + TAU / 24;
      pxLine(gr, V, a.ox + Math.cos(a0) * rr, a.oy + Math.sin(a0) * rr * 0.82, a.ox + Math.cos(a1) * rr, a.oy + Math.sin(a1) * rr * 0.82, 0xd8a8ff, { drop: 1 - al, seed: i });
      pxLine(gr, V, a.ox + Math.cos(a0) * rr * 0.82, a.oy + Math.sin(a0) * rr * 0.82 * 0.82, a.ox + Math.cos(a0) * rr, a.oy + Math.sin(a0) * rr * 0.82, 0xb070ff, { drop: 1 - al, seed: i + 20 });
    }
  });
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
        const cx = a.ox + nx * off * Math.max(2, R * 0.35), cy = a.oy + ny * off * Math.max(2, R * 0.35);
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

export function dropLight(d, g) {
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
  for ( const g of L.groups ) {
    const lt = g.light; if ( !lt ) continue;
    const shown = !!g.cont.parent && !g.dead && g.cont.visible !== false;
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
