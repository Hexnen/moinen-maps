/**
 * DUST AND GRIT, the pure part (no Foundry, no PIXI: node-tested in dev/dust-model.test.mjs). A brush of the fire layer (stroke kind
 * "dust", stored with the fire strokes: flags.moinen-maps.fireStrokes) that paints the GROUND DUST something leaves behind as it moves
 * - not the weather's airborne "dust" (a sky effect): this is dust kicked up from the ground by motion and by destruction.
 *
 *   stroke = { ..., k: "dust", dk: KIND, lv: LEVEL 1..3, r: the band's half-width (scene px), p: the path, q: paint time, o / g as fire }
 *   KIND (what passed along the path):
 *     bike   one wheel track, fast; a long thin plume thrown BACK behind it, a rooster tail of grit
 *     car    two wheel tracks, fast; a wider trailing cloud, rolled out to both sides
 *     drag   small rubble dragged slowly: low rolling dust along the path, a scraped groove, a lot of grit thrown sideways
 *     heavy  large rubble dragged slowly: a bow wave of heavy billows pushed out to both sides, a wide scrape, big chips
 *
 * THE LOOK (the destruction layer's own language - research: scripts/destruction/pixel-fx.mjs, debris.mjs, display.mjs burst /
 * dust): art pixels on the art grid, a few flat tones taken from THE GROUND'S OWN COLOUR (the map under the dust, never pale flecks over
 * a dark map), fading by pixel DROPOUT in 2 x 2 clusters, never by soft alpha; puffs that burst out fast and slow down with DRAG (2.6 /
 * s, as destruction's dust puffs), rise a little and settle; chips that fly a parabola with a visible apex and a ground shadow under
 * them. Three layers:
 *   1. CHIPS AND GRIT: chips thrown as the source passes (a few frames of flight), then grit lying on the ground along the band
 *   2. PUFFS: a lattice of emitters along the path (on the kind's lanes); each throws one BURST puff as the source passes (3 lobes,
 *      one metaball body with its neighbours: a rolling trail, never a row of balls) and, while the dust lingers, an occasional small
 *      lazy puff; lit top-left (light / mid / shadow bands), the outline a ragged rim of dropout
 *   3. AURA: a wide low haze over the band and around it, two pixel bands with dithered edges, that rises as the source passes,
 *      thins to a lingering veil and drifts with the wind
 *   plus GROUND MARKS: wheel tracks with a tread rhythm (bike, car) or a scraped groove with streaks along the drag (drag, heavy).
 *
 * TIME (the shared clock, the same on every client): the source travels the path at the kind's speed from the stroke's paint time
 * (litTime), so everything is kicked where it passes, in drawing order. Then the dust lingers (aura veil, grit, marks, a lazy puff now
 * and then) until it is put out (o: erased, deleted, undone): no new puffs, the haze settles, the grit and marks drop out, and when the
 * last puff has died (DUST_TAIL) the stroke is gone. An eraser puts out the dust under it (painted after the dust) the same way.
 *
 * THE FIELD (dustRaster, in the field worker):
 *   cell   Float32 RGBA per cell: kick time (s since the area's ref; NONE = no dust reaches it), out time (s; NONE = none), the signed
 *          offset across the nearest path (cells, + = the path's left normal), code (kind * 4 + level) + 16 x round(band half-width x 4)
 *   back   (only with an UNDONE eraser over the dust) Float32 RGBA per cell: [back, out2, 0, 0] - the dust put out at `out` came back
 *          at `back` (s; NONE = no), easing in from what was left; out2 = its next out time after that (NONE = none)
 *   em     Float32, 3 RGBA texels an emitter (1024 emitters a row): [x, y (cells, area-local), kick, seed], [heading x, y, side +-1,
 *          code], [out, back, out2, 0]
 *   tileH  Float32 RGBA per 16 x 16 cells: [start, count, 0, 0] into `idx` - the emitters whose whole reach touches the tile (a cell
 *          looks only at those: the art pass's cost is bounded, and no puff is ever cut at a tile's edge - the reach is the whole one)
 *   idx    Float32 RGBA, 4 emitter indices a texel (1024 texels a row)
 */
import { hash4, hashStr, vnoise, windVec, litTime } from "./model.mjs";

export const DUST_KINDS = ["bike", "car", "drag", "heavy", "hits", "shock"];
/**
 * SHOCK (the bomb / grenade presets, dev/presets-design.md G3): no path - the stroke's one point is a blast's centre and `r` the reach
 * of its shock wave. A ragged front of the ground's own dust tears outward from the centre at a decaying speed (it reaches a radius d
 * at shockAt(d): fast at first, slowing with drag, the rim at about 2.2 tau), each puff thrown out ahead of it, chips skittering out
 * low, then grit and a low haze over the whole swept disc that thins to a veil and drifts. Level 1 a grenade, 2 a shell, 3 a bomb.
 */
export const SHOCK_OVER = 1.12;
/**
 * The HAZE a blast leaves (shock only): its aura does not thin to a veil and stop there - it hangs over the swept disc as a low pall
 * of the ground's own dust for minutes (KIND.shock haze s by level: a bomb's ~5 min), slowly SPREADS (its reach past the rim grows by
 * up to HAZE_GROW x the aura over the first minutes), churns and drifts with the wind (the aura's drifting noise), and THINS over the
 * second half of its life: its pixel bands shrink and break into patches until nothing is left (no pop: the stroke's own out `o`
 * comes after). The lingering puffs stop after linW s, so for the minutes of the haze the art pass skips the emitters (puffEnd).
 */
export const HAZE_GROW = 0.9;
/** When the shock front of stroke-look L reaches the distance d (cells) from its centre, R its reach (cells): s after its paint time. */
export const shockAt = (L, d, R) => -L.tau * Math.log(1 - Math.min(d, R) / (SHOCK_OVER * R)) + Math.max(0, d - R) / Math.max(1e-6, R / L.tau);
/**
 * HITS (the gun presets, dev/presets-design.md G4): no source travels the path - its points are BULLET IMPACTS in time order, the
 * first at the stroke's paint time (q), each next one hitDt ms later (the stroke's `s` holds the shot interval in HIT_DT ms: a gun's
 * hits per lane are evenly spaced in time, presets/core.mjs walkHits). Each hit throws a GEYSER: a jet of soil shot straight up and a
 * few puffs thrown out round it, chips flying high in every direction, grit where they land, a small haze that lingers and drifts.
 * Level 1 a light gun (an Uzi's puffs), 3 a heavy machine gun's tall geysers. No ground marks: the damage layer owns the pocks.
 */
export const HIT_DT = 250;
/** The kinds' codes (kind * 4 + level) are packed into a cell with the band's half-width (code + CODE_N x the width): room for 8 kinds. */
export const CODE_N = 32;
/** A hits stroke's shot interval (ms). */
export const hitDt = (st) => HIT_DT * (Number(st.s) || 0.4);
export const NONE = 1e9;
/** Emitters one tile may list (the art pass's loop bound): over it, the area's emitters are thinned evenly (never per tile). */
export const MAX_PER_TILE = 120;
export const TILE = 16;
/** A lingering puff: one slot every LIN_P s (a share of the slots, by level), LIN_L s of life, smaller and lazier than a burst. */
export const LIN_P = 4.5, LIN_L = 3.4;
/** The wind's drift: puffs ride it, slowing as they settle (tau s): at most DRIFT x tau squares a puff, the scene's wind SDRIFT x tau. */
export const DRIFT = 0.25, SDRIFT = 0.12, TAU = 2;
/** After a put-out, the last lingering puff lives on this long at most (s); then nothing of the stroke is left. */
export const DUST_TAIL = Math.max(LIN_L * 1.15, 3) + 0.3;

/**
 * Per KIND, per LEVEL ([_, L1, L2, L3]); lengths in grid squares, times in seconds. v: how fast the source moves; lanes(hw, g): the
 * emitter lanes' offsets across the path (cells); sp: emitter spacing along a lane; pr: a puff's lobe radius; out / back: how far a
 * burst is thrown sideways / behind; rise; life: a burst puff's; lin: the share of lingering slots that puff; chips: thrown per
 * emitter, how far (chipD), how high (chipH), 1 or 2 px; grit: the share of ground cells with a grain; aura: how far the haze reaches
 * past the band, auraA its density; mark: 1 wheel tracks (trackW wide), 2 a scraped groove.
 */
export const KIND = {
  bike: { v: 5.5, lanes: () => [0], sp: 0.14, pr: [0, 0.14, 0.2, 0.28], out: [0, 0.12, 0.16, 0.22], back: [0, 0.6, 1.0, 1.45],
    rise: [0, 0.12, 0.2, 0.32], life: [0, 2.2, 3.0, 4.0], lin: [0, 0.25, 0.4, 0.55], chips: [0, 2, 3, 5], chipD: 0.45, chipH: 0.3, chipSz: 1,
    grit: [0, 0.03, 0.05, 0.08], aura: [0, 0.4, 0.6, 0.85], auraA: [0, 0.6, 0.85, 1], mark: 1, trackW: 0.035 },
  car: { v: 4.5, lanes: (hw, g) => { const o = Math.min(0.22 * g, 0.6 * hw); return [-o, o]; }, sp: 0.15, pr: [0, 0.2, 0.3, 0.42],
    out: [0, 0.3, 0.45, 0.6], back: [0, 0.4, 0.7, 1.0], rise: [0, 0.12, 0.2, 0.32], life: [0, 2.6, 3.6, 4.8], lin: [0, 0.25, 0.4, 0.55],
    chips: [0, 1, 2, 3], chipD: 0.35, chipH: 0.25, chipSz: 1, grit: [0, 0.025, 0.045, 0.07], aura: [0, 0.5, 0.75, 1.05], auraA: [0, 0.6, 0.85, 1],
    mark: 1, trackW: 0.05 },
  drag: { v: 1.6, lanes: (hw) => [-0.5 * hw, 0, 0.5 * hw], sp: 0.14, pr: [0, 0.12, 0.17, 0.24], out: [0, 0.25, 0.38, 0.55], back: [0, 0.08, 0.1, 0.12],
    rise: [0, 0.06, 0.1, 0.15], life: [0, 2.0, 2.6, 3.3], lin: [0, 0.2, 0.3, 0.4], chips: [0, 2, 4, 6], chipD: 0.3, chipH: 0.18, chipSz: 1,
    grit: [0, 0.12, 0.18, 0.26], aura: [0, 0.3, 0.45, 0.65], auraA: [0, 0.55, 0.75, 0.95], mark: 2, trackW: 0 },
  heavy: { v: 1.0, lanes: (hw) => [-0.66 * hw, -0.22 * hw, 0.22 * hw, 0.66 * hw], sp: 0.2, pr: [0, 0.24, 0.36, 0.5], out: [0, 0.45, 0.7, 1.0],
    back: [0, 0.12, 0.15, 0.18], rise: [0, 0.12, 0.2, 0.3], life: [0, 3.0, 4.2, 5.5], lin: [0, 0.25, 0.4, 0.55], chips: [0, 3, 5, 8], chipD: 0.55,
    chipH: 0.32, chipSz: 2, grit: [0, 0.15, 0.24, 0.34], aura: [0, 0.55, 0.85, 1.25], auraA: [0, 0.65, 0.9, 1], mark: 2, trackW: 0 },
  // (hits: `back` is the radial throw - an emitter's heading points back at its hit, so the throw sends the puff outwards; `rise` the
  // geyser's height, risen fast (riseK / s), its young jet - the column from the ground up to the cloud - lasting longer (jetK);
  // `per` emitters a hit, the first one nearly straight up)
  hits: { v: 1, lanes: () => [0], sp: 1, pr: [0, 0.12, 0.15, 0.2], out: [0, 0.04, 0.06, 0.1], back: [0, 0.2, 0.26, 0.34],
    rise: [0, 0.32, 0.5, 0.78], life: [0, 1.3, 1.7, 2.0], lin: [0, 0.02, 0.03, 0.035], chips: [0, 3, 4, 6], chipD: 0.6, chipH: 0.55, chipSz: 2,
    grit: [0, 0.1, 0.15, 0.22], aura: [0, 0.26, 0.3, 0.35], auraA: [0, 0.4, 0.5, 0.6], mark: 0, trackW: 0, riseK: 5.5, jetK: 2.2, per: [0, 2, 3, 4] },
  // (shock: the emitters lie on rings round the centre (`fr` of the reach, `sp` apart along each), the heading points back at the
  // centre so `back` is the outward throw; low and rolling (small rise), `tau` the front's slowing - see shockAt)
  shock: { v: 1, lanes: (hw) => [hw], sp: 0.22, pr: [0, 0.17, 0.27, 0.31], out: [0, 0.06, 0.08, 0.1], back: [0, 0.3, 0.5, 0.75],
    rise: [0, 0.06, 0.1, 0.15], life: [0, 1.6, 2.3, 3.2], lin: [0, 0.12, 0.2, 0.28], chips: [0, 2, 3, 4], chipD: 0.5, chipH: 0.2, chipSz: 1,
    grit: [0, 0.1, 0.16, 0.24], aura: [0, 0.25, 0.4, 0.55], auraA: [0, 0.45, 0.6, 0.75], mark: 0, trackW: 0, riseK: 1.4, jetK: 3.0,
    tau: [0, 0.2, 0.28, 0.38], fr: [0.18, 0.38, 0.58, 0.76, 0.92], linW: [0, 10, 14, 18], haze: [0, 150, 240, 300] }
};
/** The puffs' rise rate (1 / s) and the young jet's decay (1 / s) of the kinds that travel (hits has its own). */
export const RISE_K = 1.1, JET_K = 4.0;

/** A dust stroke's kind and level, resolved: { dk, lv, code, ...numbers of that level }. */
export function look(st) {
  const dk = DUST_KINDS.includes(st.dk) ? st.dk : "car", lv = Math.min(3, Math.max(1, st.lv | 0 || 2)), K = KIND[dk];
  return { dk, lv, code: DUST_KINDS.indexOf(dk) * 4 + lv, v: K.v, lanes: K.lanes, sp: K.sp, pr: K.pr[lv], out: K.out[lv], back: K.back[lv], rise: K.rise[lv],
    life: K.life[lv], lin: K.lin[lv], chips: K.chips[lv], chipD: K.chipD, chipH: K.chipH, chipSz: K.chipSz, grit: K.grit[lv], aura: K.aura[lv],
    auraA: K.auraA[lv], mark: K.mark, trackW: K.trackW, riseK: K.riseK ?? RISE_K, jetK: K.jetK ?? JET_K, hits: dk === "hits", per: K.per?.[lv] ?? 0,
    shock: dk === "shock", tau: K.tau?.[lv] ?? 0, linW: K.linW?.[lv] ?? 0, haze: K.haze?.[lv] ?? 0 };
}

/** The art pass's per-code table (CODES codes = kind * 4 + level), six vec4 arrays: [pr, out, back, rise], [life, lin, chips, chipD],
 * [chipH, chipSz, grit, aura], [auraA, mark, trackW, v], [riseK, jetK, radial 0 / 1 (hits, shock: thrown out from a centre), 0],
 * [linW (s: lingering puffs only this long after the kick; 0 = until put out), haze (s: the long HAZE's life; 0 = none), HAZE_GROW, 0]. */
export const CODES = 24;
export function kindTable() {
  const T = [0, 1, 2, 3, 4, 5].map(() => new Float32Array(CODES * 4));
  DUST_KINDS.forEach((dk, ki) => { for ( let lv = 1; lv <= 3; lv++ ) {
    const L = look({ dk, lv }), o = (ki * 4 + lv) * 4;
    T[0].set([L.pr, L.out, L.back, L.rise], o); T[1].set([L.life, L.lin, L.chips, L.chipD], o);
    T[2].set([L.chipH, L.chipSz, L.grit, L.aura], o); T[3].set([L.auraA, L.mark, L.trackW, L.v], o);
    T[4].set([L.riseK, L.jetK, L.hits || L.shock ? 1 : 0, 0], o);
    T[5].set([L.linW, L.haze, L.haze ? HAZE_GROW : 0, 0], o);
  } });
  return T;
}

/** A stroke's path in cells and its band half-width (cells). */
function pathOf(st, geo) {
  const pts = [];
  for ( let i = 0; i + 1 < st.p.length; i += 2 ) pts.push([(st.p[i] - geo.ox) / geo.ap, (st.p[i + 1] - geo.oy) / geo.ap]);
  return { pts, hw: Math.max(1, st.r / geo.ap) };
}
const pathLen = (pts) => { let l = 0; for ( let i = 1; i < pts.length; i++ ) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };

/** How far (cells) anything of a dust stroke reaches past its path: the puffs' throw, size, rise and drift, the chips, the aura. */
export function reachCells(st, geo) {
  const g = geo.grid / geo.ap, L = look(st), { hw } = pathOf(st, geo);
  const lane = Math.max(0, ...L.lanes(hw, g).map(Math.abs));
  const [wx, wy] = windVec(st.wd, st.ws), drift = (Math.hypot(wx, wy) * DRIFT + SDRIFT) * TAU * g;
  const puff = lane + (L.out + L.back) * g + 2.6 * L.pr * g * 1.5 + L.rise * g + drift;
  const chip = lane + (L.chipD + L.chipH) * g + 2;
  const aura = (hw + L.aura * g * (1 + (L.haze ? HAZE_GROW : 0))) * 1.35;
  return Math.ceil(Math.max(puff, chip, aura)) + 3;
}

/** The cells a dust stroke can reach (integers, x1 / y1 exclusive). */
export function dustRect(st, geo) {
  const { pts } = pathOf(st, geo), R = reachCells(st, geo);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( const [x, y] of pts ) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0: Math.floor(x0 - R), y0: Math.floor(y0 - R), x1: Math.ceil(x1 + R), y1: Math.ceil(y1 + R) };
}
/** Its CORE (what joins areas): the band itself. */
export function dustCore(st, geo) {
  const { pts, hw } = pathOf(st, geo), m = hw + 2;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( const [x, y] of pts ) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0: Math.floor(x0 - m), y0: Math.floor(y0 - m), x1: Math.ceil(x1 + m), y1: Math.ceil(y1 + m) };
}

/** How long the source takes along the whole path (ms). */
export function passMs(st, geo) {
  const g = geo.grid / geo.ap, { pts } = pathOf(st, geo), L = look(st);
  if ( L.hits ) return Math.max(0, pts.length - 1) * hitDt(st);   // (hits: the last one's moment)
  if ( L.shock ) { const R = Math.max(1, st.r / geo.ap); return 1000 * shockAt(L, R, R); }   // (shock: the front at its reach)
  return 1000 * pathLen(pts) / (L.v * g);
}
/** When a dust stroke's current animation ends (ms): its last burst puff died (painted), or its last puff after a put-out. */
export function dustEnd(st, geo) {
  const L = look(st);
  return st.o !== undefined ? st.o + DUST_TAIL * 1000 + Math.max(0, L.life * 1.15 - DUST_TAIL) * 1000 : litTime(st) + passMs(st, geo) + (L.life * 1.15 + 0.5) * 1000;
}

/* ---------------------------------------------------------------- the field */

/** Organic band edge: the normalized distance is warped by a smooth noise (no round brush, no straight edge). */
const warp = (x, y, g, seed) => 0.82 + 0.36 * vnoise(x / (0.4 * g), y / (0.4 * g), seed);

/** A polyline walker: position and smoothed heading at arc length s (cells). */
function walker(pts) {
  const cum = [0];
  for ( let i = 1; i < pts.length; i++ ) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const at = (s) => {
    s = Math.min(total, Math.max(0, s));
    let i = 1; while ( i < pts.length - 1 && cum[i] < s ) i++;
    const a = pts[i - 1], b = pts[i] ?? a, l = Math.max(1e-6, cum[i] - cum[i - 1]), t = Math.min(1, Math.max(0, (s - cum[i - 1]) / l));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const head = (s, d) => {
    const p = at(s - d), q = at(s + d), dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy);
    return l > 1e-6 ? [dx / l, dy / l] : null;
  };
  return { at, head, total };
}

/**
 * A dust area's FIELD (see the file header). `area` as model.areasOf gives it (style "dust": its dust strokes and the erasers that
 * touch it). Pure and deterministic.
 */
export function dustRaster(area, geo, P) {
  const { rect } = area, W = Math.max(1, rect.x1 - rect.x0), H = Math.max(1, rect.y1 - rect.y0), N = W * H, g = geo.grid / geo.ap;
  const members = area.strokes.filter((s) => s.k === "dust");
  const ref = members.length ? Math.min(...members.map(litTime)) : 0;
  const sec = (ms) => (ms - ref) / 1000;
  const cell = new Float32Array(N * 4);
  for ( let i = 0; i < N; i++ ) { cell[i * 4] = NONE; cell[i * 4 + 1] = NONE; }
  const best = new Float32Array(N).fill(Infinity);
  // ERASERS (painted, not undone): the earliest and the latest that cover each cell - a stroke is put out by the first eraser
  // painted after it (by the latest when the earliest came before it)
  const eMin = new Float32Array(N).fill(Infinity), eMax = new Float32Array(N).fill(-Infinity);
  // UNDONE erasers (o set: the dust they put out comes BACK from o - it eases in from what was left, never pops): per cell the
  // earliest one's paint time and its undo time
  const uTe = new Float32Array(N).fill(Infinity), uBk = new Float32Array(N).fill(NONE);
  let undone = false;
  for ( const e of area.strokes ) {
    if ( e.k !== "erase" ) continue;
    const { pts } = pathOf(e, geo), r = Math.max(1, e.r / geo.ap), te = sec(litTime(e)), bk = e.o !== undefined ? sec(e.o) : null;
    if ( bk !== null ) undone = true;
    for ( let k = 0; k < pts.length; k++ ) {
      const [ax, ay] = pts[k], [bx, by] = pts[Math.min(pts.length - 1, k + 1)];
      const xa = Math.max(rect.x0, Math.floor(Math.min(ax, bx) - r)), xb = Math.min(rect.x1, Math.ceil(Math.max(ax, bx) + r));
      const ya = Math.max(rect.y0, Math.floor(Math.min(ay, by) - r)), yb = Math.min(rect.y1, Math.ceil(Math.max(ay, by) + r));
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      for ( let y = ya; y < yb; y++ ) for ( let x = xa; x < xb; x++ ) {
        const px = x + 0.5, py = y + 0.5, t = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
        if ( Math.hypot(px - ax - dx * t, py - ay - dy * t) > r ) continue;
        const i = (y - rect.y0) * W + (x - rect.x0);
        if ( bk !== null ) { if ( te < uTe[i] ) { uTe[i] = te; uBk[i] = bk; } continue; }
        if ( te < eMin[i] ) eMin[i] = te; if ( te > eMax[i] ) eMax[i] = te;
      }
    }
  }
  const erasedAt = (i, t0) => (eMin[i] > t0 ? eMin[i] : eMax[i] > t0 ? eMax[i] : NONE);
  // (an undone eraser painted after the dust, before any live eraser: the dust went out at its paint time and comes back at its undo)
  const backOf = (i, t0, out) => (i >= 0 && uTe[i] > t0 && uTe[i] < out && uBk[i] > uTe[i] ? [uTe[i], uBk[i]] : null);
  const back = undone ? new Float32Array(N * 4) : null;
  if ( back ) for ( let i = 0; i < N; i++ ) { back[i * 4] = NONE; back[i * 4 + 1] = NONE; }
  const cellOf = (x, y) => { const cx = Math.floor(x), cy = Math.floor(y); return cx >= rect.x0 && cy >= rect.y0 && cx < rect.x1 && cy < rect.y1 ? (cy - rect.y0) * W + (cx - rect.x0) : -1; };

  const ems = [];   // [x, y, kick, seed, hx, hy, side, code, out, reach]
  // HITS: the cells round each impact (its kick time, the distance from it in z) and its geyser's emitters - the first nearly straight
  // up (a short heading: a small throw), the others thrown out round it, a few ms apart
  const hitsOf = (st, L, pts, hw, t0, oSt, seed, A) => {
    const dt = hitDt(st) / 1000, Rc = (hw + L.aura * g) * 1.35 + 2;
    const [wx, wy] = windVec(st.wd, st.ws), drift = (Math.hypot(wx, wy) * DRIFT + SDRIFT) * TAU * g;
    const reach = Math.max((L.out + L.back) * g + 2.6 * L.pr * g * 1.5 + L.rise * g + drift, (L.chipD + L.chipH) * g + 2) + 2;
    let n = 0;
    pts.forEach(([hx, hy], k) => {
      const kick = t0 + k * dt;
      const xa = Math.max(rect.x0, Math.floor(hx - Rc)), xb = Math.min(rect.x1, Math.ceil(hx + Rc));
      const ya = Math.max(rect.y0, Math.floor(hy - Rc)), yb = Math.min(rect.y1, Math.ceil(hy + Rc));
      for ( let y = ya; y < yb; y++ ) for ( let x = xa; x < xb; x++ ) {
        const px = x + 0.5, py = y + 0.5, d = Math.hypot(px - hx, py - hy);
        if ( d > Rc ) continue;
        const i = (y - rect.y0) * W + (x - rect.x0), nd = d / hw * warp(px, py, g, seed);
        if ( nd >= best[i] ) continue;
        best[i] = nd;
        const o = i * 4, out = Math.min(oSt, erasedAt(i, t0)), bk = back ? backOf(i, t0, out) : null;
        cell[o] = kick; cell[o + 1] = bk ? bk[0] : out;
        if ( back ) { back[o] = bk ? bk[1] : NONE; back[o + 1] = bk ? out : NONE; }
        cell[o + 2] = d; cell[o + 3] = A;
      }
      const a0 = hash4(seed, k, 11) * Math.PI * 2, m = L.per;
      for ( let e = 0; e < m; e++ ) {
        const a = a0 + (e + (hash4(seed, k, e, 12) - 0.5) * 0.7) / Math.max(1, m - 1) * Math.PI * 2, len = e === 0 ? 0.22 : 0.8 + 0.4 * hash4(seed, k, e, 13);
        const es = (Math.imul(seed, 31) + n * 7919) >>> 0, i = cellOf(hx, hy);
        const out = Math.min(oSt, i >= 0 ? erasedAt(i, t0) : NONE), bk = back ? backOf(i, t0, out) : null;
        ems.push([hx - rect.x0, hy - rect.y0, kick + (e ? 0.012 + 0.03 * hash4(seed, k, e, 14) : 0), es % 1000003, -Math.cos(a) * len, -Math.sin(a) * len, 1, L.code,
          bk ? bk[0] : out, reach, bk ? bk[1] : NONE, bk ? out : NONE]);
        n++;
      }
    });
  };
  // SHOCK: every cell of the swept disc (and its haze past the rim) kicked when the front reaches it, the distance from the centre in z;
  // the emitters on rings round the centre, each kicked as the front passes it and thrown outward (the heading points back at the centre)
  const shockOf = (st, L, [cx, cy], R, t0, oSt, seed, A) => {
    const Rc = (R + L.aura * g * (1 + (L.haze ? HAZE_GROW : 0))) * 1.35 + 2;
    const [wx, wy] = windVec(st.wd, st.ws), drift = (Math.hypot(wx, wy) * DRIFT + SDRIFT) * TAU * g;
    const reach = Math.max((L.out + L.back) * g * 1.2 + 2.6 * L.pr * g * 1.5 + L.rise * g + drift, (L.chipD + L.chipH) * g + 2) + 2;
    const xa = Math.max(rect.x0, Math.floor(cx - Rc)), xb = Math.min(rect.x1, Math.ceil(cx + Rc));
    const ya = Math.max(rect.y0, Math.floor(cy - Rc)), yb = Math.min(rect.y1, Math.ceil(cy + Rc));
    for ( let y = ya; y < yb; y++ ) for ( let x = xa; x < xb; x++ ) {
      const px = x + 0.5, py = y + 0.5, d = Math.hypot(px - cx, py - cy);
      if ( d > Rc ) continue;
      const i = (y - rect.y0) * W + (x - rect.x0), nd = d / R * warp(px, py, g, seed);
      if ( nd >= best[i] ) continue;
      best[i] = nd;
      const o = i * 4, out = Math.min(oSt, erasedAt(i, t0)), bk = back ? backOf(i, t0, out) : null;
      cell[o] = t0 + shockAt(L, d * warp(px, py, g, seed + 3), R); cell[o + 1] = bk ? bk[0] : out;
      if ( back ) { back[o] = bk ? bk[1] : NONE; back[o + 1] = bk ? out : NONE; }
      cell[o + 2] = d; cell[o + 3] = A;
    }
    // (np: no puffs - a burst of look 3 rolls its own ground surge over the ring; the stroke keeps its grit, aura and haze)
    if ( st.np ) return;
    const sp = L.sp * g, fr = KIND.shock.fr;
    let n = 0;
    fr.forEach((f, ri) => {
      const rr = f * R, m = Math.max(5, Math.round(2 * Math.PI * rr / sp)), a0 = hash4(seed, ri, 51) * Math.PI * 2;
      for ( let k = 0; k < m; k++ ) {
        const a = a0 + (k + (hash4(seed, ri, k, 52) - 0.5) * 0.6) / m * Math.PI * 2, rj = rr * (1 + (hash4(seed, ri, k, 53) - 0.5) * 0.16);
        const hx = Math.cos(a), hy = Math.sin(a), x = cx + hx * rj, y = cy + hy * rj * 0.97, len = 0.55 + 0.65 * f * (0.7 + 0.6 * hash4(seed, ri, k, 54));
        const es = (Math.imul(seed, 31) + n * 7919) >>> 0, i = cellOf(x, y);
        const out = Math.min(oSt, i >= 0 ? erasedAt(i, t0) : NONE), bk = back ? backOf(i, t0, out) : null;
        ems.push([x - rect.x0, y - rect.y0, t0 + shockAt(L, rj, R) + 0.03 * hash4(seed, ri, k, 55), es % 1000003, -hx * len, -hy * len, hash4(seed, ri, k, 56) < 0.5 ? -1 : 1, L.code,
          bk ? bk[0] : out, reach, bk ? bk[1] : NONE, bk ? out : NONE]);
        n++;
      }
    });
  };
  let pEnd = -Infinity, allShock = true;
  for ( const st of members ) {
    const L = look(st), { pts: raw, hw } = pathOf(st, geo), t0 = sec(litTime(st)), v = L.v * g, oSt = st.o !== undefined ? sec(st.o) : NONE;
    const seed = hashStr(st.id), A = L.code + CODE_N * Math.round(hw * 4);
    const pts = raw.length ? raw : [[0, 0]];
    if ( L.hits ) { allShock = false; hitsOf(st, L, pts, hw, t0, oSt, seed, A); continue; }
    if ( L.shock ) { shockOf(st, L, pts[0], hw, t0, oSt, seed, A); if ( L.linW > 0 ) pEnd = Math.max(pEnd, t0 + shockAt(L, hw * 1.2, hw) + 0.2 + L.linW + LIN_P * 0.5 + LIN_L * 1.15 + L.life * 1.15); else allShock = false; continue; }
    allShock = false;
    // 1. the CELLS: the nearest path point of the nearest stroke (by distance over its band, warped organic)
    const Rc = (hw + L.aura * g) * 1.35 + 2;
    let s0 = 0;
    const segs = pts.length > 1 ? pts.length - 1 : 1;
    for ( let k = 0; k < segs; k++ ) {
      const [ax, ay] = pts[k], [bx, by] = pts[Math.min(pts.length - 1, k + 1)];
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), l2 = len * len;
      const xa = Math.max(rect.x0, Math.floor(Math.min(ax, bx) - Rc)), xb = Math.min(rect.x1, Math.ceil(Math.max(ax, bx) + Rc));
      const ya = Math.max(rect.y0, Math.floor(Math.min(ay, by) - Rc)), yb = Math.min(rect.y1, Math.ceil(Math.max(ay, by) + Rc));
      for ( let y = ya; y < yb; y++ ) for ( let x = xa; x < xb; x++ ) {
        const px = x + 0.5, py = y + 0.5, t = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
        const qx = ax + dx * t, qy = ay + dy * t, d = Math.hypot(px - qx, py - qy);
        if ( d > Rc ) continue;
        const i = (y - rect.y0) * W + (x - rect.x0), nd = d / hw * warp(px, py, g, seed);
        if ( nd >= best[i] ) continue;
        best[i] = nd;
        const o = i * 4;
        cell[o] = t0 + (s0 + t * len) / v;
        const out = Math.min(oSt, erasedAt(i, t0)), bk = back ? backOf(i, t0, out) : null;
        cell[o + 1] = bk ? bk[0] : out;
        if ( back ) { back[o] = bk ? bk[1] : NONE; back[o + 1] = bk ? out : NONE; }
        cell[o + 2] = len > 0 ? ((py - ay) * dx - (px - ax) * dy) / len : py - ay;
        cell[o + 3] = A;
      }
      s0 += len;
    }
    // 2. the EMITTERS along the kind's lanes (a click: a ring of them round the point)
    const wk = walker(pts), sp = L.sp * g, lanes = L.lanes(hw, g);
    const [wx, wy] = windVec(st.wd, st.ws), drift = (Math.hypot(wx, wy) * DRIFT + SDRIFT) * TAU * g;
    const reach = Math.max((L.out + L.back) * g + 2.6 * L.pr * g * 1.5 + L.rise * g + drift, (L.chipD + L.chipH) * g + 2) + 2;
    let n = 0;
    const push = (x, y, hx, hy, side, kick) => {
      const es = (Math.imul(seed, 31) + n * 7919) >>> 0, i = cellOf(x, y);
      const out = Math.min(oSt, i >= 0 ? erasedAt(i, t0) : NONE), bk = back ? backOf(i, t0, out) : null;
      ems.push([x - rect.x0, y - rect.y0, kick, es % 1000003, hx, hy, side, L.code, bk ? bk[0] : out, reach, bk ? bk[1] : NONE, bk ? out : NONE]);
      n++;
    };
    if ( wk.total < sp ) {
      const [x, y] = pts[0], m = Math.max(4, lanes.length * 2);
      for ( let k = 0; k < m; k++ ) {
        const a = (k + hash4(seed, k, 1)) / m * Math.PI * 2, hx = Math.cos(a), hy = Math.sin(a);
        push(x + hx * hw * 0.3, y + hy * hw * 0.3, -hy, hx, 1, t0 + hash4(seed, k, 2) * 0.08);
      }
    } else {
      lanes.forEach((lo, li) => {
        let s = hash4(seed, li, 3) * sp, k = 0;
        while ( s <= wk.total && k < 20000 ) {
          const h = wk.head(s, 0.5 * g) ?? [1, 0], [x, y] = wk.at(s);
          const jA = (hash4(seed, li, k, 4) - 0.5) * 0.5 * sp, jC = (hash4(seed, li, k, 5) - 0.5) * 0.3 * sp, off = lo + jC;
          const side = lo > 0.01 ? 1 : lo < -0.01 ? -1 : hash4(seed, li, k, 6) < 0.5 ? -1 : 1;
          push(x + h[0] * jA - h[1] * off, y + h[1] * jA + h[0] * off, h[0], h[1], side, t0 + s / v + hash4(seed, li, k, 7) * 0.05);
          s += sp * (0.75 + 0.5 * hash4(seed, li, k, 8)); k++;
        }
      });
    }
  }
  // 3. the TILE LISTS: every emitter in each tile its reach touches; over MAX_PER_TILE, the area's emitters are thinned evenly
  const TW = Math.ceil(W / TILE), TH = Math.ceil(H / TILE);
  const tilesOf = (e, f) => {
    const r = e[9], tx0 = Math.max(0, Math.floor((e[0] - r) / TILE)), tx1 = Math.min(TW - 1, Math.floor((e[0] + r) / TILE));
    const ty0 = Math.max(0, Math.floor((e[1] - r) / TILE)), ty1 = Math.min(TH - 1, Math.floor((e[1] + r) / TILE));
    for ( let ty = ty0; ty <= ty1; ty++ ) for ( let tx = tx0; tx <= tx1; tx++ ) f(ty * TW + tx);
  };
  let keep = ems, thin = 1;
  for ( let pass = 0; pass < 8; pass++ ) {
    const cnt = new Uint32Array(TW * TH);
    for ( const e of keep ) tilesOf(e, (t) => cnt[t]++);
    let mx = 0; for ( const c of cnt ) if ( c > mx ) mx = c;
    if ( mx <= MAX_PER_TILE ) break;
    thin *= MAX_PER_TILE / mx * 0.97;
    keep = ems.filter((e) => hash4(e[3], 9, 9, 9) < thin);
  }
  const E = keep.length, emRows = Math.max(1, Math.ceil(E / 1024)), em = new Float32Array(Math.max(1, Math.min(E, 1024)) * 3 * 4 * emRows);
  const emW = Math.max(1, Math.min(E, 1024)) * 3;
  keep.forEach((e, i) => {
    const o = ((i >> 10) * emW + (i & 1023) * 3) * 4;
    em.set([e[0], e[1], e[2], e[3], e[4], e[5], e[6], e[7], e[8], e[10], e[11], 0], o);
  });
  const cnt = new Uint32Array(TW * TH);
  keep.forEach((e) => tilesOf(e, (t) => cnt[t]++));
  const tileH = new Float32Array(TW * TH * 4), start = new Uint32Array(TW * TH);
  let total = 0;
  for ( let t = 0; t < TW * TH; t++ ) { start[t] = total; tileH[t * 4] = total; tileH[t * 4 + 1] = cnt[t]; total += cnt[t]; }
  const idxRows = Math.max(1, Math.ceil(total / 4096)), idx = new Float32Array(1024 * 4 * idxRows), fill = start.slice();
  keep.forEach((e, i) => tilesOf(e, (t) => { idx[fill[t]++] = i; }));
  let maxKick = 0; for ( const e of keep ) if ( e[2] > maxKick ) maxKick = e[2];
  for ( let i = 0; i < N; i++ ) { const k = cell[i * 4]; if ( k < NONE && k > maxKick ) maxKick = k; }
  // (an area of blasts only: after its last puff can live, the art pass skips the emitters - the minutes of the haze cost the ground only)
  const puffEnd = allShock && !undone && members.length ? pEnd + 1 : NONE;
  return { style: "dust", w: W, h: H, ref, cell, back, em, emW, emH: emRows, emN: E, thin, tileH, tw: TW, th: TH, idx, idxH: idxRows, maxKick, puffEnd,
    emit: { fire: [], smoke: [] }, anim: true, wind: area.wind ?? [0, 0] };
}
