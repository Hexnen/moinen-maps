import { reducedMotion } from "../config.mjs";
import { pxFlash, pxLine, pxRing, pxArcs, lineCells, boltTree, boltCells, pxBolt, pxRunDisc, sigilCells, hashU } from "./pixel-fx.mjs";
import { clawCount, impactSpokes } from "./core.mjs";

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
    hot: null, heat: true, ring: 0xffa050, idle: "ember", pulse: "flicker", light: 1.0 },
  /* acid      */ { slow: 1.5, curve: (f) => f, share: 0.6, tint: 0xd8ff80, front: 0.5, edge: { color: [0xb6ff4a, 0xe8ff9a, 0x7fd02a], rise: -3, life: 650 },
    ring: 0x9fe060, pops: true, idle: "bubble", pulse: "slow", light: 0.35, hot: [0xeaff9a, 0xb6ff4a, 0x6fa02a], stain: 0x9fe050 },
  /* lightning */ { slow: 0.55, curve: (f) => Math.pow(f, 0.35), share: 0.1, tint: null, front: 0.08, edge: { color: [0xffffff, 0xaad8ff], vy: -7, fall: 40, life: 200, drag: 2 },
    bolt: true, idle: null, pulse: "crackle", light: 0.4, hot: [0xffffff, 0xdcecff, 0x9fc8ff], stain: 0xd8ecff },
  /* arcane    */ { slow: 1.25, curve: (f, a) => clamp01(Math.sqrt(f) * 0.78 + (((a / TAU) % 1) + 1) % 1 * 0.22), share: 0.6, tint: 0xd8b0ff, front: 0.6,
    edge: { color: [0xc890ff, 0xf0d8ff, 0x9a6aff], rise: -4, life: 900 }, ring: 0xb070ff, rune: true, idle: "mote", pulse: "breathe", light: 0.5, hot: null, stain: 0xb070ff },
  /* impact    */ { slow: 0.7, curve: (f) => Math.pow(f, 0.45), share: 0.4, tint: null, front: 0.3, edge: { color: [0xcfc6b8, 0xb9ae9e], vy: -2, rise: -3, life: 600, drag: 2.4 },
    ring: 0xf3e6cc, shock: true, idle: "dust", hot: null, stain: 0x8a7a62 },
  /* claws     */ { slow: 0.8, curve: (f) => f, share: 0.4, tint: null, front: 0, edge: { color: [0xfff0b0, 0xe8dcc8], vy: -5, fall: 30, life: 260, drag: 2 },
    slash: true, idle: null, hot: null },
  /* water     */ { slow: 1.3, curve: (f) => Math.pow(f, 0.7), share: 0.6, tint: 0xb8d4ff, front: 0.5, edge: { color: [0xe6f4ff, 0x9fc8ee], vy: -1, life: 450, drag: 3 },
    ring: 0xcfe8ff, well: true, idle: "drip", hot: null, stain: 0x203448 },
  /* decay     */ { slow: 1.9, curve: (f) => f, share: 0.6, tint: 0xc8d4a0, front: 0.35, edge: { color: [0x9aa868, 0xb9ae9e, 0x6f7f45], rise: -2, life: 1400 },
    flakes: true, idle: "spore", hot: null, stain: 0x3a4a22 },
  /* frost     */ { slow: 1.15, curve: (f) => Math.pow(f, 0.6), share: 0.55, tint: 0xe4f2ff, front: 0.5, edge: { color: [0xffffff, 0xd8ecff], rise: -1, life: 520 },
    ring: 0xe8f4ff, crystal: true, idle: "glint", hot: [0xffffff, 0xe0f0ff, 0xa8d0f0], stain: 0xe8f4ff }
];
export const causeLook = (c) => CAUSE_LOOK[c | 0] ?? null;
const pick = (a) => a[(Math.random() * a.length) | 0];
/** Per cause: the share of its edge particles that are chips (fire: coals, acid: crumbs, lightning: glass, frost: ice). */
const CHIP = [0, 0.15, 0.2, 0, 0, 0, 0, 0, 0, 0.3];   // (lightning: none - its glass chips at rest read as black pebbles)

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

/** A gun preset's pock (a preset stroke entering along its timed path: presets/core.mjs walk), and when its bullet lands (ms of the entry). */
export const isGun = (d, g, a) => (a._gun ??= !!a.path && !!g.objId && !!d.dropsOut?.(g.objId));
const gunAt = (a) => (a.gunAt ??= Math.max(0, a.reach ? a.reach(a.ox, a.oy) - a.start : (a.delay ?? 0) + (a.path.at?.(a.ox, a.oy) ?? 0)));

/** The cause's part of an entry frame: the light's fade-in, what rides on the front, one-shot accents. */
export function causeEffects(d, g, a, now, el) {
  const cl = a.cl; if ( !cl ) return;
  const k = a.k, pw = a.pw, R = Math.max(4, g.info.R), ap = d.ap, o = d.origin;
  const X = (x) => o.x + x * ap, Y = (y) => o.y + y * ap;
  const once = (key, at, fn) => { if ( el >= at && !a.fired.has(`c:${key}`) ) { a.fired.add(`c:${key}`); fn(); } };
  const tFront = clamp01((el - a.delay) / Math.max(1, a.reveal));
  // (a gun's walked pocks: the area's night rim / light is one sprite for all its pocks - it comes in when the walk has passed, never
  // ahead of the hits)
  g.glowIn = isGun(d, g, a) ? clamp01((el - a.delay - a.reveal - a.band) / 500) : clamp01((el - a.delay) / Math.max(1, a.reveal + a.band * 0.5));
  // on the front (not a gun's: its pocks have no common front - the particles sprang from its first pock alone, before any round
  // landed; not a preset's stroke before its start: in its lead-in the front sits at the origin, and a pale fleck hung there)
  if ( cl.front && tFront < 1 && !isGun(d, g, a) && !(el < 0 && g.objId && d.dropsOut?.(g.objId)) && Math.random() < cl.front ) {
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
  if ( cl.ring && !a.tear && !isGun(d, g, a) ) once("ring", a.delay + a.reveal * 0.15, () => d.burst(a.ox, a.oy, Math.min(R * 1.2, 60) * pw, now, { n: 16, color: cl.ring, rise: -2, speed: 1.2 }));
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
    const rr = Math.max(6, R * 0.66) * (1 + 0.9 * Math.pow(1 - Math.min(1, t * 2.2), 2)), n = clamp01(R * 0.66 / 30) > 0.5 ? 6 : 5, rot = t * 0.5, sz = Math.max(2, Math.min(4, rr * 0.16));
    for ( let i = 0; i < n; i++ ) {
      const on = clamp01((t * 1.6 - i / n * 0.5) * 3), pul = 0.75 + 0.25 * Math.sin(t * 18 + i * 1.3), al = on * pul * (t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1);
      if ( al < 0.12 ) continue;
      const ang = rot + i / n * TAU, cx = a.ox + Math.cos(ang) * rr, cy = a.oy + Math.sin(ang) * rr * 0.82;
      gr.beginFill(i & 1 ? 0xb070ff : 0xd8a8ff, 1);
      for ( const [x, y] of sigilCells(a.seed * 13 + i, cx, cy, sz) ) if ( hashU(x, y, i) < al ) gr.drawRect(V.ox + x * ap, V.oy + y * ap, ap, ap);
      gr.endFill();
    }
  }, PIXI.BLEND_MODES.ADD);
  if ( cl.shock ) {
    // IMPACT, a heavy blow: anticipation - the shadow of what falls tightens onto the spot (0-55 ms); the HIT - a sharp white shock
    // ring broken into arcs races out, straight radial fractures shoot from the spot, the ground thumps (2 px down, a damped
    // rebound), chips pop, a low dust skirt rolls out
    // (a GUN's hits - a preset's stroke walked along its timed path: bullets, not a falling blow - have no falling shadow, no shock
    // ring and no skirt of pale puffs: their flash, sparks and dust are the preset's own layers; the fractures, the thump and the
    // chips stay, each pock's at the moment its bullet lands - when the front reaches it - not at the stroke's start)
    const gun = isGun(d, g, a);
    const hit = gun ? gunAt(a) : 55 * k;
    if ( !gun ) draw("shadow", 0, hit, (gr, t) => pxRunDisc(gr, V, a.ox, a.oy + 1, Math.max(2, R * (0.55 - 0.4 * t)), 0x1a1612, 0.18 + 0.4 * t, a.seed + 41));
    if ( !gun ) draw("shock", hit, 320 * k, (gr, t) => {
      // (white arcs with a dark outer pixel: it reads on pale stone as well as on dark ground)
      const e = 1 - Math.pow(1 - t, 2.2);
      pxRing(gr, V, a.ox, a.oy, Math.max(2, R * (0.35 + 1.25 * e) * pw), t * 0.6, { core: 0xffffff, outer: 0x4a4038, seed: a.seed + 43, dash: 7, thick: 2 });
    });
    const nf = 6 + Math.floor(hashU(a.seed, 1, 47) * 3), fan = impactSpokes(nf, a.seed + 47);
    const fl = fan.map((_, q) => 0.22 + 0.78 * Math.pow(hashU(q, 3, a.seed + 47), 1.4)), fk = fan.map((_, q) => hashU(q, 4, a.seed + 47) < 0.4 ? (hashU(q, 5, a.seed + 47) < 0.5 ? -1 : 1) * (0.45 + 0.35 * hashU(q, 6, a.seed + 47)) : 0);
    // (not for a gun: its area is a whole lane of pocks, so the fan - as long as the area's radius - burst out of the first pock alone,
    // a big star the size of a muzzle flash where the first bullet landed; each pock has its own hit flash and chips instead)
    if ( !gun ) draw("fract", hit, 420 * k, (gr, t) => {
      const grow = Math.min(1, t * 4), al = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      for ( let q = 0; q < nf; q++ ) {
        // (two legs with a kink: the ray wanders; it stops short of the rim or reaches it, now and then forking)
        const an = fan[q], L = R * 0.95 * fl[q] * grow, kink = (hashU(q, 7, a.seed + 47) - 0.5) * 0.35, c = Math.cos(an), s = Math.sin(an) * 0.85;
        const mx = a.ox + c * L * 0.5, my = a.oy + s * L * 0.5, ex = mx + Math.cos(an + kink) * L * 0.5, ey = my + Math.sin(an + kink) * L * 0.5 * 0.85;
        for ( const [x0, y0, x1, y1, w] of [[a.ox + c * 1.5, a.oy + s * 1.5, mx, my, 1], [mx, my, ex, ey, 0.7]] ) {
          pxLine(gr, V, x0, y0, x1, y1, 0x15110d, { alpha: al * w, drop: 1 - al, seed: q + 5 });
          pxLine(gr, V, x0 + 1, y0 + 1, x1 + 1, y1 + 1, 0xf2e8d6, { alpha: al * 0.7 * w, drop: Math.min(1, 1 - al + 0.3), seed: q + 9 });
        }
        if ( fk[q] && L > 5 ) pxLine(gr, V, mx, my, mx + Math.cos(an + fk[q]) * L * 0.35, my + Math.sin(an + fk[q]) * L * 0.3, 0x15110d, { alpha: al * 0.7, drop: 1 - al, seed: q + 15 });
      }
    });
    const je = el - hit, J = [2, -1, 1, 0];
    const j = je >= 0 && je < 140 * k ? J[Math.min(3, Math.floor(je / (35 * k)))] * ap : 0;
    g.baseCont?.position.set(0, j); g.shardCont?.position.set(0, j);
    once("chips", hit + 10 * k, () => { if ( g.chunks ) d.chunks(g, a, gun ? { count: Math.min(5, Math.round((2 + R * 0.15) * pw)), reach: [0.5, 1.2], H: [4, 9], sizes: [2, 4], seed: 7 }
      : { count: Math.min(10, Math.round((4 + R * 0.2) * pw)), reach: [0.5, 1.3], H: [3, 7], sizes: [3, 5], seed: 7 }); });
    if ( !gun ) once("skirt", hit + 40 * k, () => d.burst(a.ox, a.oy, R * 1.1 * pw, now, { n: 22, color: 0xcfc6b8, rise: -1.5, speed: 1.6 }));
  }
  if ( cl.slash ) {
    // CLAWS: one swipe - the furrows' streaks (as many as the bake's furrows: 3 on a tear, else clawCount) cut in one after another,
    // each a bright line that grows fast along the axis with a hot leading edge, then fades
    const ang = g.info.axis || 0, ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux, L = Math.max(10, g.info.len || R * 2) * (a.tear ? 0.45 : 0.6);
    // (a tear's swipe runs over the middle of its area, not from its pinprick; white with a dark under-line, so it never melts into
    // the blast front's hot cream; solid while it cuts, breaking up only as it fades)
    const n = a.tear ? 3 : clawCount(g.info.R), sp = a.tear ? 3.5 : Math.max(2.5, R * 1.7 / n);
    const mid = a.tear || a.coll, mx = mid ? g.info.x + g.info.w / 2 : a.ox, my = mid ? g.info.y + g.info.h / 2 : a.oy;
    for ( let q = 0; q < n; q++ ) draw(`slash${q}`, q * 25 * k, 220 * k, (gr, t) => {
      const grow = Math.min(1, t * 4), al = 1 - t, off = (q - (n - 1) / 2) * sp, Lq = L * (q === 0 || q === n - 1 ? 0.85 : 1);
      const cx = mx + nx * off, cy = my + ny * off, x0 = cx - ux * Lq, y0 = cy - uy * Lq, x1 = x0 + ux * 2 * Lq * grow, y1 = y0 + uy * 2 * Lq * grow;
      // (the tail fades first: the visible part starts further along as it dies; the middle third is two pixels thick)
      const tail = Math.max(0, (t - 0.35) / 0.65), sx = x0 + (x1 - x0) * tail, sy = y0 + (y1 - y0) * tail;
      const m0x = sx + (x1 - sx) * 0.33, m0y = sy + (y1 - sy) * 0.33, m1x = sx + (x1 - sx) * 0.7, m1y = sy + (y1 - sy) * 0.7;
      pxLine(gr, V, m0x, m0y + 1, m1x, m1y + 1, 0x241a12, { alpha: 0.7 * al, seed: q + 23 });
      pxLine(gr, V, sx, sy, x1, y1, 0xfff6e8, { alpha: 0.55 + 0.45 * al, drop: 0.35 * tail, seed: q + 3 });
      pxLine(gr, V, m0x + nx, m0y + ny, m1x + nx, m1y + ny, 0xffffff, { alpha: al, seed: q + 33 });
      if ( t < 0.3 ) pxLine(gr, V, x1 - ux * 4, y1 - uy * 4, x1, y1, 0xffc860, { seed: q + 13 });
    });
  }
  if ( cl.heat ) {
    // FIRE's own anticipation (no starburst): heat shimmer - wavy warm lines wobbling up off the spot; an ember swirl rising round
    // it; a scorched ring creeping out ahead of the burn (dark char arcs with an ember edge)
    draw("shimmer", 0, 520 * k, (gr, t) => {
      const al = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
      for ( let q = 0; q < 4; q++ ) {
        const yy = a.oy - 2 - q * 3 - t * 9, w = Math.round(R * (0.5 - q * 0.07));
        gr.beginFill(q & 1 ? 0xffd890 : 0xffb060, 0.22 * al);
        for ( let x = -w; x <= w; x++ ) if ( hashU(x, q, a.seed + 51) < 0.55 ) gr.drawRect(V.ox + Math.round(a.ox + x) * ap, V.oy + Math.round(yy + Math.sin(x * 0.7 + t * 30 + q * 2) * 1.2) * ap, ap, ap);
        gr.endFill();
      }
    }, PIXI.BLEND_MODES.ADD);
    once("swirl", 30 * k, () => {
      for ( let q = 0; q < 10; q++ ) {
        const an = q / 10 * TAU, r = R * 0.35;
        d.spawn({ x: a.ox + Math.cos(an) * r, y: a.oy + Math.sin(an) * r * 0.8, vx: -Math.sin(an) * 9, vy: Math.cos(an) * 5, rise: -7 - (q % 3) * 2, drag: 1.5, life: 700 + q * 40, color: q % 3 ? 0xff9a3c : 0xffd36b, flicker: true });
      }
    });
    draw("scorch", 60 * k, Math.max(300, (a.delay + a.reveal) * 0.9), (gr, t) =>
      pxRing(gr, V, a.ox, a.oy, Math.max(2, R * (0.25 + 0.9 * t) * pw), t * 0.6, { core: 0x24160e, outer: 0xff8a3c, seed: a.seed + 53, dash: 10, thick: 2 }));
  }
  if ( cl.pops ) {
    // ACID hisses: bubbles swell on the eaten floor and POP (a dot, a taller bead, a ring of four, gone), each at its own moment
    const nb = Math.min(14, 5 + Math.round(R * 0.3));
    draw("pops", a.delay, (a.reveal + a.band) * 1.2, (gr, t) => {
      for ( let q = 0; q < nb; q++ ) {
        const t0 = hashU(q, 1, a.seed + 61) * 0.8, u = (t - t0) / 0.18; if ( u < 0 || u > 1 ) continue;
        const an = hashU(q, 2, a.seed + 61) * TAU, rr = R * 0.75 * Math.sqrt(hashU(q, 3, a.seed + 61)), x = Math.round(a.ox + Math.cos(an) * rr), y = Math.round(a.oy + Math.sin(an) * rr * 0.8);
        if ( u < 0.6 ) { gr.beginFill(u < 0.3 ? 0xb6ff4a : 0xeaff9a, 1); gr.drawRect(V.ox + x * ap, V.oy + (y - (u > 0.3 ? 1 : 0)) * ap, ap, ap * (u > 0.3 ? 2 : 1)); gr.endFill(); }
        else { gr.beginFill(0xd8ff8a, 1 - (u - 0.6) / 0.4); for ( const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] ) gr.drawRect(V.ox + (x + dx) * ap, V.oy + (y + dy - 1) * ap, ap, ap); gr.endFill(); }
      }
    });
  }
  if ( cl.well ) {
    // WATER's anticipation: the ground darkens wet from the low spot and a ring of water surges up and out before the ground goes
    draw("wet", 0, Math.max(260, a.delay + a.reveal * 0.4), (gr, t) => blot(gr, V, a.ox, a.oy, Math.max(2, R * (0.25 + 0.6 * Math.min(1, t * 1.5)) * pw), 0x1a3040, 0.36 * (t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3), a.seed + 81));
    draw("surge", 20 * k, 420 * k, (gr, t) => pxArcs(gr, V, a.ox, a.oy, Math.max(2, R * (0.2 + 0.85 * (1 - Math.pow(1 - t, 2))) * pw), t, { seed: a.seed + 83, core: 0xe6f6fa }));
    // WATER wells up: slow broken ripple arcs spreading from the low spot as the pit fills
    for ( const [key, f, rr] of [["well1", 0.15, 0.7], ["well2", 0.5, 0.55], ["well3", 0.85, 0.45]] ) draw(key, a.delay + a.reveal * f, 650 * k, (gr, t) =>
      pxArcs(gr, V, a.ox, a.oy, Math.max(2, R * rr * pw * (0.3 + 0.7 * (1 - Math.pow(1 - t, 2)))), t, { seed: a.seed + key.length * 7 + Math.round(f * 100), core: t < 0.5 ? 0xd8f0f4 : 0x9fd0dc }));
  }
  if ( cl.flakes ) {
    // ROT's anticipation: a creeping darkening that PULSES twice (the rot drawing breath) before the ground sags
    draw("rot", 0, Math.max(420, a.delay + a.reveal * 0.5), (gr, t) => {
      const beat = 0.55 + 0.45 * Math.abs(Math.sin(t * Math.PI * 2));
      blot(gr, V, a.ox, a.oy, Math.max(2, R * (0.2 + 0.75 * t) * pw), 0x1e2414, 0.36 * beat * (t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2), a.seed + 85);
    });
    // ROT crumbles: flakes break off the sagging rim and fall in, dull spores drift up slowly
    for ( const [key, f] of [["fl1", 0.25], ["fl2", 0.55], ["fl3", 0.85]] ) once(key, a.delay + a.reveal * f, () => {
      for ( let q = 0; q < 5; q++ ) {
        const an = Math.random() * TAU, r = R * (0.8 + Math.random() * 0.25);
        d.spawn({ x: a.ox + Math.cos(an) * r, y: a.oy + Math.sin(an) * r * 0.8, vx: -Math.cos(an) * 4, vy: -2, fall: 24, drag: 1.2, life: 520 + Math.random() * 200, color: q & 1 ? 0x5a4a32 : 0x7a6a48, alpha: 0.95 });
      }
      for ( let q = 0; q < 2; q++ ) d.spawn({ x: a.ox + (Math.random() - 0.5) * R, y: a.oy + (Math.random() - 0.5) * R * 0.7, vx: (Math.random() - 0.5) * 1.2, vy: 0, rise: -1.4, life: 1500, color: 0xa8b47a, alpha: 0.6 });
    });
  }
  if ( cl.rune ) {
    // ARCANE's anticipation: an IMPLOSION - motes drawn in from a wide ring to the spot (convergence), a small violet pop when they meet
    once("implode", 0, () => {
      for ( let q = 0; q < 14; q++ ) {
        const an = q / 14 * TAU + hashU(q, 1, a.seed + 87) * 0.3, r = R * (1.2 + 0.4 * hashU(q, 2, a.seed + 87)), v = r / 0.22;
        d.spawn({ x: a.ox + Math.cos(an) * r, y: a.oy + Math.sin(an) * r * 0.8, vx: -Math.cos(an) * v, vy: -Math.sin(an) * v * 0.8, life: 210, color: q & 1 ? 0xd8a8ff : 0xf0d8ff, alpha: 0.95 });
      }
    });
    draw("pop", 210, 140 * k, (gr, t) => pxRunDisc(gr, V, a.ox, a.oy, Math.max(1.5, Math.min(R * 0.3, 8) * (0.4 + t)), 0xc890ff, 0.7 * (1 - t), a.seed + 89), PIXI.BLEND_MODES.ADD);
  }
  if ( cl.crystal ) {
    // FROST grows: crystal needles shoot out on the 30 / 90 / 150-degree lines from the spot, each branching once at 60 degrees
    draw("crystal", 0, Math.max(360, a.delay + a.reveal * 0.6), (gr, t) => {
      const grow = 1 - Math.pow(1 - Math.min(1, t * 1.6), 2), al = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
      for ( let q = 0; q < 6; q++ ) {
        const an = (q + 0.5) * Math.PI / 3 + (hashU(q, 2, a.seed + 71) - 0.5) * 0.3, L = R * (0.35 + 0.6 * hashU(q, 1, a.seed + 71)) * grow, c = Math.cos(an), s = Math.sin(an);
        pxLine(gr, V, a.ox, a.oy, a.ox + c * L, a.oy + s * L, 0xf4fbff, { alpha: al, seed: q + 21 });
        if ( L > 4 && hashU(q, 3, a.seed + 71) < 0.6 ) for ( const sg of [-1, 1] ) {
          const b = an + sg * Math.PI / 3, x0 = a.ox + c * L * 0.55, y0 = a.oy + s * L * 0.55;
          pxLine(gr, V, x0, y0, x0 + Math.cos(b) * L * 0.3, y0 + Math.sin(b) * L * 0.3, 0xbfe2ff, { alpha: al * 0.85, seed: q * 3 + sg + 31 });
        }
      }
    });
  }
  if ( cl.bolt ) {
    // after the strike: a few tiny flicker ARCS jumping along the bolt's own trail on the ground (near it only), then quiet
    once("arcs", 160 * k, () => {
      const gr = d.pixelCanvas(); gr.blendMode = PIXI.BLEND_MODES.ADD;
      const s0 = a.seed * 7 + 5, pts = Array.from({ length: 4 }, (_, q) => { const an = hashU(q, 1, s0) * TAU, r = R * 0.5 * hashU(q, 2, s0); return [a.ox + Math.cos(an) * r, a.oy + Math.sin(an) * r * 0.8]; });
      a.fx.push({ g: gr, kind: "cause", t0: now, dur: 380 * k, draw: (t) => {
        const q = Math.floor(t * 8) % pts.length; if ( (Math.floor(t * 23) & 1) ) return;
        const [x, y] = pts[q], cells = [];
        let X = x, Y = y;
        for ( let s = 0; s < 4; s++ ) { const nx2 = X + (hashU(q, s, s0 + 9) < 0.5 ? -1 : 1), ny2 = Y + (hashU(q, s, s0 + 10) - 0.5) * 2; lineCells(X, Y, nx2, ny2, cells); X = nx2; Y = ny2; }
        gr.beginFill(0xdcecff, 0.9); for ( const [cx, cy] of cells ) gr.drawRect(V.ox + cx * ap, V.oy + cy * ap, ap, ap); gr.endFill();
      } });
    });
  }
}

/** A ragged, soft-edged patch (wet ground, creeping rot): its rim wanders with the angle, its alpha falls off outwards in two
 * steps and drops out by pixel near the edge - never a flat disc. */
// PERF (display): a blot is drawn again every frame as it grows (~1/3 of a whole-scene Detonate's accent time went into it); what
// of a cell does not depend on the radius (its distance, its rim's lobe, its dropout hash) is kept per blot (centre + seed) over a
// square that grows ahead of the radius - the same numbers, computed once per cell
const BLOTS = new Map();
function blotGrid(cx, cy, R2, seed) {
  const key = `${Math.round(cx)}|${Math.round(cy)}|${seed}`;
  let G = BLOTS.get(key);
  if ( G && G.R2 >= R2 ) return G;
  if ( G ) R2 = Math.max(R2, Math.ceil(G.R2 * 1.6));
  const S = 2 * R2 + 1, hyp = new Float64Array(S * S), lob = new Float64Array(S * S), h = new Float64Array(S * S);
  for ( let y = -R2; y <= R2; y++ ) for ( let x = -R2; x <= R2; x++ ) {
    const q = (y + R2) * S + (x + R2), an = Math.atan2(y, x);
    lob[q] = 0.8 + 0.4 * vn(an * 1.6 + 7, 0.5, seed) + 0.15 * vn(x / 3, y / 3, seed + 1);
    hyp[q] = Math.hypot(x, y / 0.8);
    h[q] = hashU(Math.round(cx) + x, Math.round(cy) + y, seed + 2);
  }
  G = { R2, S, hyp, lob, h };
  BLOTS.delete(key); BLOTS.set(key, G);
  while ( BLOTS.size > 64 ) BLOTS.delete(BLOTS.keys().next().value);
  return G;
}
function blot(gr, V, cx, cy, r, color, alpha, seed) {
  if ( alpha < 0.02 ) return;
  const R2 = Math.ceil(r * 1.3), steps = [[], []], G = blotGrid(cx, cy, R2, seed), o = G.R2, S = G.S;
  for ( let y = -R2; y <= R2; y++ ) for ( let x = -R2; x <= R2; x++ ) {
    const q = (y + o) * S + (x + o);
    const d = G.hyp[q] / (r * G.lob[q]); if ( d > 1 ) continue;
    const X = Math.round(cx) + x, Y = Math.round(cy) + y;
    if ( d > 0.65 && G.h[q] < (d - 0.65) * 2.2 ) continue;
    steps[d < 0.55 ? 0 : 1].push(X, Y);
  }
  steps.forEach((st, k) => { gr.beginFill(color, alpha * (k ? 0.55 : 1)); for ( let i = 0; i < st.length; i += 2 ) gr.drawRect(V.ox + st[i] * V.ap, V.oy + st[i + 1] * V.ap, V.ap, V.ap); gr.endFill(); });
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
 * DARK-SCENE READABILITY for EVERY damage (glowing or not): laid into Foundry's illumination like the cause lights, only as the scene
 * grows dark (nothing by day: tickLights), so in the dark its own pixels are lit where it matters - never an outline drawn round it:
 *  - an INNER GLOW along its lips: a band of varied width (1-3 px, wandering along the edge) fading inwards, broken in places (its
 *    strength rides a slow noise, a few stretches nearly out), brighter on the lips facing the top-left light, dimmer on the far ones;
 *  - the lit BEVEL beside its dark lines (a crack, a fracture, a furrow, a tear's opening: a pixel next to a much darker one), so a
 *    black crack on dark ground reads as a dark line between lit edges - also broken by the same noise, 1-2 px wide;
 *  - a faint lift over the inside (more where the floor is mid-dark: water, the plain hole, char round the embers).
 * The light is moonlight with a hint of the cause's colour (the emissive causes keep more of theirs): a decal never gets a uniform
 * cause-coloured contour. Read once from the cover (cw x ch at x, y) and the base (bw x bh at bx, by, art px) when the area is built,
 * kept with it (one sprite, no animation).
 */
const MOON = [182, 190, 204];
const RIM = [[175, 182, 196], [255, 160, 92], [176, 240, 120], [196, 222, 255], [206, 162, 255], [216, 206, 186], [212, 194, 166], [140, 196, 236], [172, 212, 132], [206, 234, 255]];
const TINT = [0, 0.8, 0.45, 0.4, 0.55, 0.25, 0.25, 0.4, 0.35, 0.35];   // how much of the cause's colour the rim light keeps
function vn(x, y, s) {   // value noise 0..1 (smooth), on the art grid
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hashU(xi, yi, s), b = hashU(xi + 1, yi, s), c = hashU(xi, yi + 1, s), e = hashU(xi + 1, yi + 1, s);
  return (a + (b - a) * u) + ((c + (e - c) * u) - (a + (b - a) * u)) * v;
}
export function addRim(d, g, cov, x, y, base = null, bx = x, by = y) {
  if ( !cov?.data ) return;
  const ci = g.info.cause | 0, rc = RIM[ci] ?? RIM[0], tk = TINT[ci] ?? 0, col = [0, 1, 2].map((k) => MOON[k] + (rc[k] - MOON[k]) * tk);
  // (a tear's cover is its whole stroke - mostly lips pulled aside, not damage: lifting all of it showed the stroke as a flat band)
  const tear = g.info.type === "gash", lift0 = [0.9, 0.6, 0.5, 0.5, 0.6, 0.55, 0.55, 0.95, 0.75, 0.5][ci] ?? 0.5;
  const lift = lift0 * (tear ? 0.5 : 1), seed = (g.hash % 9973) | 0;
  const src = base?.data ? base : cov, w = src.w, h = src.h, data = src.data, ox = base?.data ? bx : x, oy = base?.data ? by : y;
  const inC = (X, Y) => { const cx = X + ox - x, cy = Y + oy - y; return cx >= 0 && cy >= 0 && cx < cov.w && cy < cov.h && cov.data[(cy * cov.w + cx) * 4 + 3] > 0; };
  const al = (X, Y) => X >= 0 && Y >= 0 && X < w && Y < h ? data[(Y * w + X) * 4 + 3] : 0;
  const lum = (X, Y) => { const o = (Y * w + X) * 4; return 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]; };
  // distance inwards from the cover's edge (0 = an edge pixel), up to 4, and the edge's outward direction (towards the outside)
  const D = new Uint8Array(w * h).fill(255), N4 = [[-1, 0], [1, 0], [0, -1], [0, 1]], dirX = new Float32Array(w * h), dirY = new Float32Array(w * h);
  let front = [];
  for ( let Y = 0; Y < h; Y++ ) for ( let X = 0; X < w; X++ ) {
    if ( !inC(X, Y) ) continue;
    let ex = 0, ey = 0;
    for ( const [dx, dy] of N4 ) if ( !inC(X + dx, Y + dy) ) { ex += dx; ey += dy; }
    if ( ex || ey || N4.some(([dx, dy]) => !inC(X + dx, Y + dy)) ) { const i = Y * w + X; D[i] = 0; dirX[i] = ex; dirY[i] = ey; front.push(i); }
  }
  for ( let r = 1; r <= 4 && front.length; r++ ) {
    const next = [];
    for ( const i of front ) {
      const X = i % w, Y = (i - X) / w;
      for ( const [dx, dy] of N4 ) {
        const q = (Y + dy) * w + X + dx; if ( X + dx < 0 || Y + dy < 0 || X + dx >= w || Y + dy >= h || D[q] !== 255 || !inC(X + dx, Y + dy) ) continue;
        D[q] = r; dirX[q] = dirX[i]; dirY[q] = dirY[i]; next.push(q);
      }
    }
    front = next;
  }
  // a tear: the lift fades with the distance from its opening (its dark pixels) - the lips beside the rip lit, the stroke's far
  // border not (no flat band in the stroke's shape)
  let DK = null;
  if ( tear && base?.data ) {
    DK = new Uint8Array(w * h).fill(255); let fr = [];
    for ( let Y = 0; Y < h; Y++ ) for ( let X = 0; X < w; X++ ) if ( al(X, Y) && lum(X, Y) < 60 ) { DK[Y * w + X] = 0; fr.push(Y * w + X); }
    for ( let r = 1; r <= 6 && fr.length; r++ ) {
      const nx = [];
      for ( const i of fr ) { const X = i % w, Y = (i - X) / w; for ( const [dx, dy] of N4 ) { const q = (Y + dy) * w + X + dx; if ( X + dx < 0 || Y + dy < 0 || X + dx >= w || Y + dy >= h || DK[q] !== 255 ) continue; DK[q] = r; nx.push(q); } }
      fr = nx;
    }
  }
  const B = 1, LW = w + 2 * B, LH = h + 2 * B, A = new Float32Array(LW * LH);
  for ( let Y = 0; Y < h; Y++ ) for ( let X = 0; X < w; X++ ) {
    const c = inC(X, Y);
    if ( !c && !al(X, Y) ) continue;
    const i = Y * w + X, Lm = base?.data && al(X, Y) ? lum(X, Y) : 128;
    // the band's own width (1-3 px) and strength (broken in places) wander slowly along the edge
    const wv = 1 + 2 * vn((X + ox) / 7, (Y + oy) / 7, seed + 3), br = vn((X + ox) / 5, (Y + oy) / 5, seed + 5), on = br < 0.3 ? 0.12 : 0.45 + 0.55 * br;
    // (the lift over the inside is mottled and low, never one even level up to the cover's edge: an even lift read as a pale disc with
    // a hard round edge at night - the lightning cracks, the gun pocks, a grenade's crater)
    const inner = lift * (0.2 + 0.45 * vn((X + ox) / 6, (Y + oy) / 6, seed + 11));
    let v = c ? (DK ? Math.max(inner, Math.min(1, lift0 * 1.2) * Math.max(0, 1 - DK[i] / 6) * (0.75 + 0.25 * br)) : inner) : 0;
    if ( c && D[i] < 255 && D[i] < wv ) {
      const l = Math.hypot(dirX[i], dirY[i]) || 1, face = (-(dirX[i] + dirY[i]) / l) * 0.7071;   // 1: the edge faces the top-left light
      // (the lit lips are the ones facing the light; the far ones nearly dark - an even band all round read as a pale hard ring at night)
      const lit = 0.15 + 0.85 * Math.pow(Math.max(0, (face + 1) / 2), 1.4);
      v = Math.max(v, Math.pow(1 - D[i] / (wv + 0.5), 0.7) * on * lit * (g.info.type === "gash" ? 0.5 : 1));   // (a tear: its opening's bevel carries it, the stroke's border only faintly)
    }
    if ( base?.data ) {
      let dark = 0;
      for ( const [dx, dy] of N4 ) if ( al(X + dx, Y + dy) && lum(X + dx, Y + dy) < 70 && lum(X + dx, Y + dy) < Lm - 40 ) { dark = 1; break; }
      if ( !dark && Lm >= 70 && vn((X + ox) / 4, (Y + oy) / 4, seed + 7) > 0.55 ) for ( const [dx, dy] of N4 ) if ( al(X + 2 * dx, Y + 2 * dy) && lum(X + 2 * dx, Y + 2 * dy) < 70 && lum(X + 2 * dx, Y + 2 * dy) < Lm - 40 ) { dark = 0.55; break; }
      if ( dark ) v = Math.max(v, 0.95 * dark * on);
      else if ( !c && Lm < 70 ) v = Math.max(v, 0.35 * on);
    }
    A[(Y + B) * LW + X + B] = v;
  }
  // MEMORY: kept as one byte per pixel (its strength); the texture is made when a dark scene first shows it (tickLights, rimTexture):
  // by day a scene's rims took ~115 MB of RGBA nobody saw
  const A8 = new Uint8Array(LW * LH);
  for ( let i = 0; i < LW * LH; i++ ) A8[i] = Math.round(A[i] * 255);
  const L = ensureLights(d), ap = d.ap, o = d.origin, pool = new PIXI.Sprite(PIXI.Texture.EMPTY);
  pool.eventMode = "none"; pool.blendMode = PIXI.BLEND_MODES.MAX_COLOR ?? PIXI.BLEND_MODES.ADD; pool.scale.set(ap);
  pool.position.set(o.x + (ox - B) * ap, o.y + (oy - B) * ap); pool.visible = false;
  L.layer.addChild(pool);
  g.rim = { pool, tex: null, A8, col, LW, LH };
  L.groups.add(g);
}

/** A rim's texture from its strengths (the cause's colour times the strength, the strength as alpha). */
function rimTexture(r) {
  const px = new Uint8Array(r.LW * r.LH * 4), A8 = r.A8, col = r.col;
  for ( let i = 0; i < A8.length; i++ ) { const a = A8[i]; if ( !a ) continue; const v = a / 255; px[i * 4] = col[0] * v; px[i * 4 + 1] = col[1] * v; px[i * 4 + 2] = col[2] * v; px[i * 4 + 3] = a; }
  r.tex = PIXI.Texture.fromBuffer(px, r.LW, r.LH); r.pool.texture = r.tex; r.A8 = null;
}

export function dropLight(d, g) {
  if ( g.rim ) { d.causeLights?.groups.delete(g); if ( !g.rim.pool.destroyed ) g.rim.pool.destroy(); g.rim.tex?.destroy(true); g.rim = null; }
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
    // (a gun's walked pocks: a faint rim - full, their many small lips read as white speckle round every pock at night)
    const gk = g.objId && d.gunPocks?.(g.objId) ? 0.3 : 1;
    if ( g.rim ) { const a = shown ? gk * rimK * g.cont.alpha * (g.anim ? (g.glowIn ?? clamp01((now - g.anim.start - g.anim.delay) / Math.max(1, g.anim.reveal))) : 1) : 0; if ( a > 0.01 && !g.rim.tex ) rimTexture(g.rim); g.rim.pool.visible = a > 0.01; g.rim.pool.alpha = Math.min(1, a); }
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

/**
 * The dark rim of an area that has no pixels here (a shell of the settled composite), read elsewhere (rim-job.mjs, the codec worker):
 * its sprite as addRim leaves it. `r`: { A8, col, LW, LH, ox, oy }. -> true when it was set.
 */
export function setRim(d, g, r) {
  if ( g.rim || !r?.A8 ) return false;
  const L = ensureLights(d), ap = d.ap, o = d.origin, B = 1, pool = new PIXI.Sprite(PIXI.Texture.EMPTY);
  pool.eventMode = "none"; pool.blendMode = PIXI.BLEND_MODES.MAX_COLOR ?? PIXI.BLEND_MODES.ADD; pool.scale.set(ap);
  pool.position.set(o.x + (r.ox - B) * ap, o.y + (r.oy - B) * ap); pool.visible = false;
  L.layer.addChild(pool);
  g.rim = { pool, tex: null, A8: r.A8, col: r.col, LW: r.LW, LH: r.LH, at: performance.now() };
  L.groups.add(g);
  return true;
}
