/**
 * The CAVE-IN's entry (display side; the bake is collapse.mjs). Staged like a slump, not a pop of an outlined disc:
 *   1. ANTICIPATION (~200 ms): two or three hairline cracks race out from the deepest point of the pit (never elsewhere), the ground
 *      over the pit trembles by an art pixel (a patch of the plain map, jittered) and darkens a touch as it sags, motes of dust jump;
 *   2. SLUMP (700-1000 ms): the plates go ring by ring from the rim towards the middle - each one shivers loose, tips inward and drops
 *      (ease-in), overshoots its rest by a pixel, squashes, a hop on the rubble and settles; under them the ground darkens in stages
 *      (the depth grows as they sink); a dust curtain rises along the rim as the rim ring goes and drifts with the wind; rubble tumbles
 *      in from the rim; the lip and the hairlines outside come in after the rim has gone;
 *   3. SETTLE: a few low puffs in the pit, then nothing moves (everything is over within ~2 s: no particle outlives it).
 * A followed stroke (a trench): the same along the path at the drawing speed - a collapse zone running with the head, the side slabs
 * first, then the middle, short cracks ahead of the head, dust at both edges trailing behind.
 * Decay as the cause: the rot does not come in as a ring - it starts from rough seeds along the cracks and creeps out from them.
 * Deterministic per area (its hash) except the particles' jitter. Reduced motion / Low performance: the display's short fade.
 */
import { MaskedPatch } from "./masked-map.mjs";

const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;
function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const mixP = (r, g, b, c, t) => (Math.round(r + (((c >> 16) & 255) - r) * t) << 16) | (Math.round(g + (((c >> 8) & 255) - g) * t) << 8) | Math.round(b + ((c & 255) - b) * t);
const lerpC = (a, b, t) => mixP((a >> 16) & 255, (a >> 8) & 255, a & 255, b, t);
const DECAY = 8;   // core CAUSES index

/** Two-pass chamfer distance (1 / 1.4142) in place. */
function chamfer(d, W, H) {
  const D = 1.4142;
  for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
    const i = y * W + x; let v = d[i];
    if ( x > 0 ) v = Math.min(v, d[i - 1] + 1);
    if ( y > 0 ) { v = Math.min(v, d[i - W] + 1); if ( x > 0 ) v = Math.min(v, d[i - W - 1] + D); if ( x < W - 1 ) v = Math.min(v, d[i - W + 1] + D); }
    d[i] = v;
  }
  for ( let y = H - 1; y >= 0; y-- ) for ( let x = W - 1; x >= 0; x-- ) {
    const i = y * W + x; let v = d[i];
    if ( x < W - 1 ) v = Math.min(v, d[i + 1] + 1);
    if ( y < H - 1 ) { v = Math.min(v, d[i + W] + 1); if ( x < W - 1 ) v = Math.min(v, d[i + W + 1] + D); if ( x > 0 ) v = Math.min(v, d[i + W - 1] + D); }
    d[i] = v;
  }
}

/**
 * The cave-in's clock, or null (then the display's generic entry runs). disp: the display; g: the group; start (ms), k (1 / speed),
 * pathFront: the followed stroke's front (display.pathFront) or null; seed; noise(x, y) 0..1 smooth.
 * Returns { delay, reveal, band, arrive, pixelTime, stages, piece(p, n, it), end, ... } (absolute art px everywhere).
 */
export function collapseClock(disp, g, { start, k, pathFront, seed = g.hash % 9973, noise = null }) {
  noise ??= (x, y) => vnoise(x / 7, y / 7, seed) * 0.65 + vnoise(x / 2.6, y / 2.6, seed + 17) * 0.35;
  const info = g.info, cf = g.coverFrame, data = g.tex?.resource?.data, TW = g.tex?.width;
  if ( !cf || !data || !TW ) return null;
  // the pit's own pixels on a grid over the base's rectangle (the base frame is that rectangle)
  const GX = info.x, GY = info.y, GW = info.w, GH = info.h, N = GW * GH;
  const own = new Uint8Array(N), fr = cf.tex.frame;
  for ( let y = 0; y < fr.height; y++ ) for ( let x = 0; x < fr.width; x++ ) {
    if ( !data[((fr.y + y) * TW + fr.x + x) * 4 + 3] ) continue;
    const X = cf.x + x - GX, Y = cf.y + y - GY; if ( X >= 0 && Y >= 0 && X < GW && Y < GH ) own[Y * GW + X] = 1;
  }
  const din = new Float32Array(N), dout = new Float32Array(N);
  for ( let i = 0; i < N; i++ ) { din[i] = own[i] ? 1e6 : 0; dout[i] = own[i] ? 0 : 1e6; }
  // (the frame's border counts as outside)
  for ( let x = 0; x < GW; x++ ) { din[x] = 0; din[N - 1 - x] = 0; } for ( let y = 0; y < GH; y++ ) { din[y * GW] = 0; din[y * GW + GW - 1] = 0; }
  chamfer(din, GW, GH); chamfer(dout, GW, GH);
  let maxD = 1, deep = 0;
  for ( let i = 0; i < N; i++ ) if ( own[i] && din[i] > maxD ) { maxD = din[i]; deep = i; }
  const at = (ax, ay) => { const x = Math.round(ax) - GX, y = Math.round(ay) - GY; return x < 0 || y < 0 || x >= GW || y >= GH ? -1 : y * GW + x; };
  const fOf = (i) => (i < 0 ? 0 : clamp01(din[i] / maxD));
  // the ground's own colour (the plates are cuts of the map): what the sagging floor darkens from
  // and each plate's own brightness: a plate tipped towards the light is brighter than the ground - it starts at the ground's tone
  // and brightens as it tips (tint), instead of popping in lit
  let gr = 0, gg = 0, gb = 0, gn = 0;
  const lumP = new Float32Array(g.pieces.length);
  for ( let q = 0; q < g.pieces.length; q++ ) {
    const t = g.frame(g.pieces[q].frame), f = t.frame, st = Math.max(1, Math.round(Math.sqrt(f.width * f.height) / 6));
    let l = 0, n = 0;
    for ( let y = 1; y < f.height - 1; y += st ) for ( let x = 1; x < f.width - 1; x += st ) {
      const o = ((f.y + y) * TW + f.x + x) * 4; if ( data[o + 3] < 255 ) continue;
      l += 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]; n++;
      if ( q < 64 ) { gr += data[o]; gg += data[o + 1]; gb += data[o + 2]; gn++; }
    }
    lumP[q] = n ? l / n : 0;
    t.destroy(false);
  }
  const lumG = gn ? 0.299 * gr / gn + 0.587 * gg / gn + 0.114 * gb / gn : 128;
  const G = gn ? ((Math.round(gr / gn * 0.8) << 16) | (Math.round(gg / gn * 0.8) << 8) | Math.round(gb / gn * 0.8)) : 0x6e665c;
  const P = pathFront, trench = !!P;
  // (the cave-in keeps its own budget: a slow cause - rot - does not stretch it past ~2 s; the rot creeps inside it instead)
  k = 1 / (disp.look?.speed || 1);
  const A = (trench ? 90 : 200) * k;                                     // anticipation
  const D = trench ? 420 * k : Math.min(950, 700 + maxD * 10) * k;    // the slump of the rings (a trench: across, behind its head)
  const delay = trench ? 40 * k : A;
  const along = trench ? (x, y) => P.at(x, y) : () => 0;
  // DECAY: the rot creeps out from rough seeds along the cracks (and a few on the rim), not in from a ring
  const decay = (info.cause | 0) === DECAY, creepMs = 9 * k;
  // the hairlines of the anticipation: from the deepest point out, OPEN and branching (never joining into a ring): 2-3 main cracks
  // that wander (no straight leader) and stop well inside the rim, each with one or two forks at 30-60 degrees
  const E = { x: GX + (deep % GW), y: GY + Math.floor(deep / GW) };
  const cracks = [];
  if ( !trench ) {
    const walk = (x, y, a, maxS, fmin, t0, tSpan, sd, main) => {
      const cells = [];
      let bend = (hash2(sd, 0, 73) - 0.5) * 0.25;
      for ( let s = 0; s < maxS; s++ ) {
        if ( s % 4 === 0 ) bend = (hash2(sd, s, 74) - 0.5) * 0.5;          // the bend changes every few px: a crooked line
        a += bend + (hash2(sd, s, 72) - 0.5) * 0.35;
        x += Math.cos(a); y += Math.sin(a);
        const i = at(x, y); if ( i < 0 || !own[i] || fOf(i) < fmin ) break;
        const X = Math.floor(x), Y = Math.floor(y), last = cells[cells.length - 1];
        if ( !last || last.x !== X || last.y !== Y ) cells.push({ x: X, y: Y, a });
      }
      cells.forEach((q, j) => { q.t = t0 + (j / Math.max(1, cells.length)) * tSpan; q.main = main && j < cells.length * 0.3; });
      return cells;
    };
    const n = 2 + (hash2(seed, 1, 71) < 0.5 ? 1 : 0), a0 = hash2(seed, 2, 71) * Math.PI * 2;
    for ( let c = 0; c < n; c++ ) {
      const a = a0 + (c + (hash2(seed, 3 + c, 71) - 0.5) * 0.45) * Math.PI * 2 / n;
      const main = walk(E.x + 0.5, E.y + 0.5, a, Math.round(maxD * 0.75), 0.38, 0, A * 0.65, seed * 7 + c, true);
      cracks.push(main);
      for ( let b = 0; b < 1 + (hash2(seed, 20 + c, 71) < 0.5 ? 1 : 0); b++ ) {
        const at0 = Math.floor(main.length * (0.35 + 0.3 * hash2(seed, 30 + c * 3 + b, 71))); const q = main[at0]; if ( !q ) continue;
        const fa = q.a + (hash2(seed, 40 + c * 3 + b, 71) < 0.5 ? -1 : 1) * (Math.PI / 6 + hash2(seed, 50 + c * 3 + b, 71) * Math.PI / 6);
        cracks.push(walk(q.x + 0.5, q.y + 0.5, fa, Math.round(maxD * 0.35), 0.42, q.t, A * 0.3, seed * 7 + 100 + c * 3 + b, false));
      }
    }
  }
  const seedsDecay = [];
  if ( decay ) {
    for ( const cl of cracks ) cl.forEach((q, j) => { if ( j % 3 === 0 ) seedsDecay.push(q); });
    for ( let i = 0, m = 0; i < N && m < 6; i++ ) if ( own[i] && din[i] <= 1.01 && hash2(i, 9, seed) < 0.02 ) { seedsDecay.push({ x: GX + i % GW, y: GY + Math.floor(i / GW) }); m++; }
    if ( !seedsDecay.length ) seedsDecay.push(E);
  }
  const creep = decay ? (x, y) => { let b = Infinity; for ( const q of seedsDecay ) { const d = (q.x - x) ** 2 + (q.y - y) ** 2; if ( d < b ) b = d; } return Math.min(260 * k, Math.sqrt(b) * creepMs * (0.7 + 0.6 * noise(x * 1.7, y * 1.7))); } : () => 0;
  // the rings go in three clear STAGES (rim, middle band, core - a visible difference between frames), each stage sweeping round the
  // pit by sectors (an angular stagger: the rim never breaks all round at once, so no closed outline flashes in)
  const sweep = (x, y) => vnoise(Math.cos(Math.atan2(y - E.y, x - E.x)) * 1.6 + 7, Math.sin(Math.atan2(y - E.y, x - E.x)) * 1.6 + 7, seed + 75);
  const stageOf = (f) => (f < 0.3 ? 0 : f < 0.6 ? 1 : 2);
  const ringAt = (f, x, y) => delay + (trench ? D * (0.04 + 0.45 * f ** 0.9) : D * (0.04 + 0.24 * stageOf(f) + 0.3 * sweep(x, y)));
  const cap = (trench ? 0 : 0) + 1150 * k;                               // (the last ground pixel by ~1.15 s: edge shedding ends in time)
  const pixelTime = (ax, ay) => {
    const i = at(ax, ay), nz = (noise(ax, ay) - 0.5) * 50 * k + (hash2(ax | 0, ay | 0, seed) - 0.5) * 20 * k;
    // inside: as its plates go, not before (no outlined ring first); the rot from its seeds during the crack phase already
    if ( i >= 0 && own[i] ) {
      // (the rim's own edge - the gap the plates leave as they tip in - opens last, by sectors: no closed outline while it slumps)
      const tp = (din[i] < 2.5 && !trench ? delay + D * (0.62 + 0.3 * sweep(ax, ay)) : ringAt(fOf(i), ax, ay) + 10 * k) + nz;
      return along(ax, ay) + Math.min(trench ? tp : cap, decay ? Math.min(tp, Math.max(A * 0.7 + creep(ax, ay) * 2, tp - 200 * k)) : tp);   // (the rot runs ahead of the slabs along its seeds, by at most 200 ms)
    }
    // outside the pit (lip, halo, shadows): only after the rim beside it has gone, by sectors, spreading out
    const dn = i < 0 ? 1 : clamp01(dout[i] / (0.5 * maxD + 4));
    return along(ax, ay) + Math.min(trench ? Infinity : cap, delay + D * (trench ? 0.25 + 0.5 * dn : 0.62 + 0.3 * sweep(ax, ay) + 0.25 * dn) + nz * 1.5);
  };
  // the ground under the plates darkens in stages as they sink (the depth grows) - from a little above its final tone, never a pale
  // flash
  const Gd = lerpC(G, 0x000000, 0.25);
  const stg = (t) => (r, gg2, b, i) => (own[i] ? mixP(r, gg2, b, Gd, t) : (r << 16) | (gg2 << 8) | b);
  const stages = [{ dt: 0, col: stg(0.3) }, { dt: 0.1 * D, col: stg(0.12) }, { dt: 0.2 * D, col: null }];
  const reveal = (trench ? P.D : 0) + D * 0.9;
  const C = {
    delay, reveal, band: 120 * k, pixelTime, stages, own, din, maxD, E, G, cracks, trench, A, D, k, seed, GX, GY, GW, GH, at, fOf,
    arrive: (x, y) => along(x, y) + ringAt(fOf(at(x, y)), x, y),
    // (nothing of it outlives ~2 s at entry speed 1, plus a trench's run)
    endBy: start + (trench ? P.D : 0) + Math.min(delay + D + 750 * k, 1900 * k),
    /** A piece's life: its stage (its source), a shiver before, a visible sink (ease-in, darkening as it drops), overshoot, squash, settle. */
    piece(p, n) {
      const i = at(p.sx, p.sy), f = fOf(i), hA = hash2(n, 1, seed), hB = hash2(n, 2, seed);
      const size = p.w ? Math.sqrt(p.w * p.h) : 6, dd = Math.hypot(p.fx - p.sx, p.fy - p.sy);
      const t0 = start + along(p.sx, p.sy) + ringAt(f, p.sx, p.sy) + (hA - 0.5) * 40 * k;
      const dur = (250 + 120 * f + Math.min(100, size * 3) + Math.min(100, dd * 20)) * k * (0.9 + 0.2 * hB);
      // the drop overshoots its rest inward and down by 1.5-3 px (so the sink reads over two or three frames), then comes back
      const ov = Math.max(1.5, Math.min(3, dd * 0.35));
      const ux = dd > 0.5 ? (p.fx - p.sx) / dd : (E.x - p.sx) / (Math.hypot(E.x - p.sx, E.y - p.sy) || 1), uy = dd > 0.5 ? (p.fy - p.sy) / dd : (E.y - p.sy) / (Math.hypot(E.x - p.sx, E.y - p.sy) || 1);
      const lit = lumP[n] > lumG * 1.03 ? Math.max(0.68, lumG / lumP[n]) : 1, grey = Math.round(255 * lit);
      return { p, t0, dur, arc: 0, spin: 1, bounces: 1, pre: (trench ? 90 : 120 + 40 * hB) * k, dusted: false, seed: n, coll: C, fadeIn: !trench && !!C.patch, tint0: (grey << 16) | (grey << 8) | grey,
        ovx: ux * ov, ovy: uy * ov + 1, hop: p.chip || f > 0.45 };
    }
  };
  // the tremor patch: the plain map over the pit, jittered by an art pixel while the ground trembles (taps only)
  if ( !trench ) {
    const ms = disp.mapSprite?.();
    if ( ms ) {
      const mb = new Uint8Array(N * 4);
      for ( let i = 0; i < N; i++ ) if ( own[i] ) mb[i * 4] = mb[i * 4 + 1] = mb[i * 4 + 2] = mb[i * 4 + 3] = 255;
      const tex = PIXI.Texture.fromBuffer(mb, GW, GH);
      const mask = new PIXI.Sprite(tex); mask.eventMode = "none"; mask.scale.set(disp.ap); mask.position.set(disp.origin.x + GX * disp.ap, disp.origin.y + GY * disp.ap);
      const patch = new MaskedPatch(ms, mask);
      g.cont.addChildAt(patch, g.patch ? 1 : 0);
      C.patch = patch; C.patchTex = tex; C.patchMap = ms;
    }
  }
  return C;
}

/** A piece at flight time t (0 = it gives, 1 = it lands; ms-normalised by it.dur). */
export function collapsePlace(disp, p, t, it) {
  const ap = disp.ap, o = disp.origin, s = p.spr, tm = t * it.dur;
  if ( !s ) return;
  if ( tm < 0 ) {
    // it shows where it lies a moment before it goes, shivers loose (one art pixel), and starts to tip (leans: a slight squash)
    if ( tm < -it.pre ) { s.visible = false; return; }
    // (over the still map patch it fades in where it lies - the ground there takes on the plate's tilt and shade - never popping in
    // dark or lit; a trench has no patch: opaque)
    const f = 1 + tm / it.pre;
    s.visible = true; s.alpha = it.fadeIn ? Math.min(1, f * 1.4) : 1; s.tint = it.tint0 ?? 0xFFFFFF;
    const sh = f > 0.35 ? ((Math.floor(tm / 40 + it.seed) & 1) ? 1 : -1) : 0;
    s.position.set(o.x + Math.round(p.sx + sh) * ap, o.y + p.sy * ap);
    s.rotation = 0; s.scale.set(ap, ap * (f > 0.75 ? 0.95 : 1));
    return;
  }
  s.visible = true; s.alpha = 1; s.tint = t >= 1 ? 0xFFFFFF : lerpC(lerpC(it.tint0 ?? 0xFFFFFF, 0xFFFFFF, t * t), 0x000000, 0.16 * Math.sin(t * Math.PI));   // (in shadow as it drops)
  if ( t >= 1 ) {
    // landed: past its rest by the overshoot, back with a damped swing, squash and a small hop on the rubble, then still
    const st = tm - it.dur;
    if ( st >= 140 * (it.coll?.k ?? 1) ) { s.position.set(o.x + p.fx * ap, o.y + p.fy * ap); s.rotation = 0; s.scale.set(ap); return; }
    const kk = Math.exp(-st / 45) * Math.cos(st / 28), hop = it.hop && st > 30 && st < 130 ? Math.sin((st - 30) / 100 * Math.PI) : 0;
    s.position.set(o.x + Math.round(p.fx + it.ovx * kk) * ap, o.y + Math.round(p.fy + it.ovy * kk - hop) * ap);
    const q = Math.min(1, st / 80);
    s.rotation = 0; s.scale.set(ap * (1.06 - 0.06 * q), ap * (0.86 + 0.14 * q));
    return;
  }
  // the drop: ease-in (it falls), carried a little past its rest (the overshoot), the inward tip foreshortens it
  const e = t * t;
  s.position.set(o.x + Math.round(p.sx + (p.fx - p.sx) * e + it.ovx * e) * ap, o.y + Math.round(p.sy + (p.fy - p.sy) * e + it.ovy * e) * ap);
  s.rotation = p.rot * (1 - e);
  const w = Math.sin(t * Math.PI);
  s.scale.set(ap * (1 + 0.03 * w), ap * (0.95 - 0.07 * w));
}

/** The cave-in's own effects each frame: tremor, cracks, dust curtain, rubble, settling dust. */
export function collapseFx(disp, g, a, now, el) {
  const C = a.coll, k = C.k, ap = disp.ap;
  C.now = now;
  const left = () => C.endBy - now;
  const life = (ms) => Math.max(0, Math.min(ms, left()));
  // tremor: the ground over the pit jitters by an art pixel, faster as it nears the give; then the patch goes
  if ( C.patch ) {
    // (it stays, still, under the plates until the last ring has gone: they fade in over the plain ground, not over the dark pit)
    if ( el < C.A ) {
      const ph = Math.floor(el / (el < C.A * 0.6 ? 55 : 35) * 1) + C.seed;
      C.patch.position.set(((ph & 1) ? 1 : -1) * ap, (ph % 3 === 0 ? 1 : 0) * ap);
      // a touch darker as it sags
      if ( C.patchMap ) C.patchMap.tint = lerpC(0xffffff, 0xd2ccc4, clamp01(el / C.A));
    } else if ( el < C.A + C.D ) C.patch.position.set(0, 0);
    else collapseEnd(disp, g, a);
  }
  // the hairline cracks of the anticipation (from the deepest point out), gone as the plates under them give
  if ( C.cracks.length && !C.crackFx ) {
    const pc = disp.pixelCanvas(), v = { ap, ox: disp.origin.x, oy: disp.origin.y };
    const dur = C.A + C.D * 0.6;
    C.crackFx = { g: pc, kind: "cracks", t0: a.start, dur, draw: () => {
      const e = C.now - a.start;
      for ( const cl of C.cracks ) for ( const q of cl ) {
        if ( e < q.t || e > C.arrive(q.x, q.y) - 60 * k ) continue;
        pc.beginFill(0x16120e, 0.9).drawRect(v.ox + q.x * ap, v.oy + q.y * ap, ap, ap);
        if ( q.main ) pc.beginFill(0x16120e, 0.55).drawRect(v.ox + q.x * ap, v.oy + (q.y + 1) * ap, ap, ap);
        else if ( hash2(q.x, q.y, C.seed) < 0.35 ) pc.beginFill(0xe8e0d0, 0.3).drawRect(v.ox + q.x * ap, v.oy + (q.y - 1) * ap, ap, ap);
      }
    } };
    a.fx.push(C.crackFx);
    // motes jumping off the cracks as they open
    C.events = [];
    for ( const cl of C.cracks ) for ( const q of cl ) if ( hash2(q.x, q.y, C.seed + 5) < 0.14 ) C.events.push({ t: a.start + q.t, f: () => disp.spawn({ x: q.x, y: q.y, vx: (Math.random() - 0.5) * 3, vy: 0, rise: -5 - Math.random() * 3, life: life(260 + Math.random() * 120), color: disp.tone?.(g, 2, 0xa89c8a) ?? 0xa89c8a, alpha: 0.75, size: 2 }) });   // (grains in the ground's tone, no pale flecks)
  }
  if ( !C.events ) C.events = [];
  if ( !C.planned ) {
    C.planned = true;
    const { own, din, GW, GH, GX, GY } = C;
    // the dust curtain: along the rim, rising as the rim ring goes and drifting with one wind
    const wind = (hash2(C.seed, 11, 3) < 0.5 ? -1 : 1) * (1.5 + hash2(C.seed, 12, 3) * 2);
    const rim = [];
    for ( let i = 0; i < own.length; i++ ) if ( own[i] && din[i] <= 1.01 && hash2(i, 13, C.seed) < 0.3 ) rim.push(i);
    // (the curtain rises from stretches of the rim, not all round it: a ring of puffs read as an outline)
    const stretch = (i) => vnoise((GX + i % GW) / 9, (GY + Math.floor(i / GW)) / 9, C.seed + 19) > 0.5;
    const step = Math.max(1, Math.round(rim.length / 22));
    for ( let q = 0; q < rim.length; q += step ) {
      const i = rim[q], x = GX + i % GW, y = GY + Math.floor(i / GW), big = hash2(i, 18, C.seed) < 0.25;
      if ( !stretch(i) ) continue;
      C.events.push({ t: a.start + C.arrive(x, y) + Math.random() * 90 * k, f: () => disp.spawn({ x, y: y - 1, vx: wind + (Math.random() - 0.5) * 2, vy: -1, rise: -5 - Math.random() * 6, life: life(600 + Math.random() * 300), color: lerpC(C.G, 0xd8d0c2, 0.55 + Math.random() * 0.2), alpha: 0.5, size: big ? 3 : 2, drag: 1.5 }) });
    }
    // rubble tumbling in from the rim towards the deepest part while the inner rings go: chunks cut from the area's own plates
    // (debris.mjs), sinking dark where they land; grains where there are no chunks
    const nr = Math.min(8, 3 + Math.round(C.maxD * 0.25));
    for ( let q = 0; q < nr && rim.length; q++ ) {
      const i = rim[Math.floor(hash2(q, 14, C.seed) * rim.length)], x = GX + i % GW, y = GY + Math.floor(i / GW);
      let ix = C.E.x - x, iy = C.E.y - y;
      if ( C.trench ) { ix = 0; iy = 0; for ( const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] ) { const j = C.at(x + dx, y + dy); if ( j >= 0 ) { ix += dx * C.din[j]; iy += dy * C.din[j]; } } }
      const l = Math.hypot(ix, iy) || 1, sp = 10 + hash2(q, 15, C.seed) * 10;
      const tt = a.start + C.arrive(x, y) + C.D * (0.12 + 0.35 * hash2(q, 16, C.seed));
      const dl = C.trench ? C.maxD * 0.6 : Math.hypot(C.E.x - x, C.E.y - y) * 0.6, s2 = 900 + q;
      C.events.push({ t: tt, f: () => {
        if ( disp.chunks && g.chunks && disp.chunks(g, a, { count: 1, landing: "into", H: [1.5, 4], seed: s2, sizes: [3, 6], from: () => [x, y], to: () => [x + ix / l * dl, y + iy / l * dl] }) ) return;
        disp.spawn({ x, y, vx: ix / l * sp, vy: iy / l * sp, fall: 6, life: life(360 + Math.random() * 120), color: lerpC(C.G, 0x1a1612, 0.35 + Math.random() * 0.3), size: 2, drag: 2.5 });
      } });
    }
    // settling: a few low puffs in the pit as the last ring lands
    for ( let q = 0; q < 5; q++ ) {
      const i = Math.floor(hash2(q, 17, C.seed) * own.length); if ( !own[i] ) continue;
      const x = GX + i % GW, y = GY + Math.floor(i / GW);
      C.events.push({ t: a.start + C.arrive(x, y) + C.D * 0.3, f: () => disp.spawn({ x, y, vx: wind * 0.5, vy: 0, rise: -2.5, life: life(600), color: disp.tone?.(g, 1, 0xb8ae9e) ?? 0xb8ae9e, alpha: 0.5, size: 3, drag: 2 }) });
    }
    C.events.sort((p, q) => p.t - q.t); C.ev = 0;
  }
  while ( C.ev < C.events.length && C.events[C.ev].t <= now ) { const e = C.events[C.ev++]; if ( left() > 120 ) e.f(); }
  // a trench: the collapse zone running with the head - short cracks just ahead of it, dust at both edges trailing behind
  if ( C.trench && a.path ) {
    const P = a.path, h = P.head(el - a.delay);
    if ( h && now >= (C.nextFx ?? 0) ) {
      C.nextFx = now + 50 * k;
      const [x, y, dx, dy] = h, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, w = P.wr * 0.75;
      for ( const sg of [1, -1] ) if ( Math.random() < 0.8 ) disp.spawn({ x: x - uy * w * sg - ux * 3, y: y + ux * w * sg - uy * 3, vx: -ux * 2 + (Math.random() - 0.5) * 2, vy: -uy * 2, rise: -6 - Math.random() * 5, life: life(600 + Math.random() * 300), color: Math.random() < 0.5 ? 0xc2b8a8 : 0xa89c8a, alpha: 0.6, size: Math.random() < 0.5 ? 3 : 2, drag: 1.6 });
      if ( !C.headFx ) {
        const pc = disp.pixelCanvas(), v = { ap, ox: disp.origin.x, oy: disp.origin.y };
        C.headFx = { g: pc, kind: "cracks", t0: a.start + a.delay, dur: P.D + 80 * k, draw: () => {
          const hh = P.head(C.el - a.delay); if ( !hh ) return;
          const [hx, hy, ddx, ddy] = hh, ll = Math.hypot(ddx, ddy) || 1, vx = ddx / ll, vy = ddy / ll;
          for ( let s2 = 2; s2 < 11; s2++ ) {
            const j = Math.sin(s2 * 1.7 + C.seed) * 0.8, X = Math.round(hx + vx * s2 - vy * j), Y = Math.round(hy + vy * s2 + vx * j);
            pc.beginFill(0x16120e, s2 < 7 ? 0.85 : 0.5).drawRect(v.ox + X * ap, v.oy + Y * ap, ap, ap);
          }
        } };
        a.fx.push(C.headFx);
      }
    }
    C.el = el;
  }
}

/** The tremor patch goes (end of the anticipation, or the entry ends). */
export function collapseEnd(disp, g, a) {
  const C = a?.coll; if ( !C?.patch ) return;
  if ( !C.patch.destroyed ) { C.patch.parent?.removeChild(C.patch); C.patch.destroy({ children: true }); }
  C.patchTex?.destroy(true);
  C.patch = null; C.patchMap = null; C.patchTex = null;
}
