/* THUNDERFIT: a map sound word kept whole inside the view and clear of the panels, measured by what the engine will really draw (pure:
   no Foundry, no PIXI, no DOM; node-tested in dev/sfx-fit.test.mjs). The owner's standard for the map's lettering: readable, never
   covering what it describes, never leaving the view, the same picture on every seat.
     - wordBox: a word's box (the engine's hold box of the word, in its own units, times its drawn cap height) with room for its
       entrance and outline - the SAME formula the placement used for a measured world word (sfx.mjs measure), now for every word;
     - viewFit: the largest share of a word's size whose box fits the view (an unlocated word is drawn at a share of the view height
       with no width ceiling of the engine: live 2026-11-15, the close strike's KRA-KA-GRRRRRAWOOM!! was as wide as the whole window);
     - freeRuns / screenFit: a spot on the screen for an unlocated word, off this seat's panels: today's spot when it is clean, else the
       nearest clean one around it, else (only then) the word a little smaller where it fits;
     - ladder: the sizes a bigger-step word tries, from its stepped size down to today's, when its stepped size finds no clean place. */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const inter = (a, b) => area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });

/** the room a word takes beyond its hold box (sfx.mjs measure: width x 1.08 + 0.3 cap, height x 1.12 + 0.25 cap): its entrance's
    overshoot and its outline; checked against the engine's own reach in dev/sfx-fit.test.mjs */
export const PAD = { w: 1.08, wc: 0.3, h: 1.12, hc: 0.25 };
/** the box (bw, bh) of a word whose hold box is `hb` (units of its drawn cap height, the engine's plan._holdBox) drawn at cap height
    `cap` (the engine's size x the mood's sizeK, in the units the box is wanted in) */
export const wordBox = (hb, cap) => ({ bw: (hb.w * PAD.w + PAD.wc) * cap, bh: (hb.h * PAD.h + PAD.hc) * cap });
/** the rough estimate the placement fell back to without a measured hold box (a share of the text's length) */
export const estHold = (chars) => ({ w: 0.8 * chars + 0.6, h: 1.35 });

/** a word's margin from the view edge (CSS px on the screen; the share of the view's short side in the world: sfx-core place) */
export const EDGE = 16;
/** The largest share (<= 1) of a word's size whose box (bw, bh) fits a view `vw` x `vh` with `m` margin on every side. */
export const viewFit = (bw, bh, vw, vh, m = EDGE) => Math.min(1, Math.max(0, vw - 2 * m) / Math.max(1, bw), Math.max(0, vh - 2 * m) / Math.max(1, bh));

/**
 * The free stretches of [x0, x1] along a horizontal band [y0, y1] that no panel in `ui` covers (sorted, each { a, b }).
 */
export function freeRuns(ui, x0, x1, y0, y1) {
  const cuts = ui.filter((u) => u.y1 > y0 && u.y0 < y1 && u.x1 > x0 && u.x0 < x1).map((u) => [Math.max(x0, u.x0), Math.min(x1, u.x1)]).sort((p, q) => p[0] - q[0]);
  const out = []; let a = x0;
  for ( const [c0, c1] of cuts ) { if ( c0 > a ) out.push({ a, b: c0 }); a = Math.max(a, c1); }
  if ( x1 > a ) out.push({ a, b: x1 });
  return out;
}
/** how much of box `b` lies under the panels `ui` or outside the view `v` (px²) */
export const hitOf = (b, ui, v) => ui.reduce((s, u) => s + inter(b, u), 0) + (v ? area(b) - inter(b, v) : 0);
const boxAt = (x, y, bw, bh) => ({ x0: x - bw / 2, y0: y - bh / 2, x1: x + bw / 2, y1: y + bh / 2 });

/** how far a word's entrance reaches beyond its box (sfx.mjs measure's box), as a factor of it - ONLY the fallback for an engine without
    L.measure (before LETR 1.9.11). The map now takes each word's own reach from the engine (reachFactor of L.measure): these factors
    went stale when the engine's motion changed (LETR 1.9.10 HOLDS: a held word moves while it stands - a debris word's reach grew to
    1.18 x its box, over the 1.15 here, and the trunk's check went red) */
export const REACH = { slam: 1.36, rise: 1.4, other: 1.15 };
export const reachOf = (stageIn) => REACH[stageIn] ?? REACH.other;
/** MAPSFXSEAT: a word's reach factor from the ENGINE's own measure (L.measure: `reach` { l, r, u, d } from its centre, here in units of its
    cap height like the hold box `hb`): the share of its box (wordBox) the whole entrance and hold reach, never under 1 */
export const reachFactor = (hb, reach) => {
  if ( !hb || !reach ) return REACH.other;
  const b = wordBox(hb, 1);
  return Math.max(1, (reach.l + reach.r) / Math.max(1e-6, b.bw), (reach.u + reach.d) / Math.max(1e-6, b.bh));
};

/**
 * A spot (screen px) for an unlocated word of box `bw` x `bh` (its hold picture with room for its outline: wordBox) on a screen `view`
 * ({ x0, y0, x1, y1 }) with this seat's panels `ui`; `rk` = how far its entrance reaches beyond the box (REACH): the whole reach stays
 * inside the view by `m`, the box off every panel. `today` = the spot the word took before (kept when the word is clean there),
 * `want` = where it should sound (the edge toward a strike, a free spot of the upper middle). Else the nearest clean spot: along the
 * band of `want`, then bands above and below it; only when no band holds it whole the word is made smaller (down to `minK` of its
 * size, the largest share that fits clean; at `minK` the least covered spot). -> { x, y, k (size share), hit (px² still covered) }
 */
export function screenFit({ today = null, want, bw, bh, rk = 1, view, ui = [], m = EDGE, minK = 0.55 }) {
  const v = { x0: view.x0 + m, y0: view.y0 + m, x1: view.x1 - m, y1: view.y1 - m };
  const R = Math.max(1, rk);
  // (the centre's range for a word w x h: its reach inside v)
  const range = (w, h) => ({ x0: v.x0 + (w * R) / 2, x1: v.x1 - (w * R) / 2, y0: v.y0 + (h * R) / 2, y1: v.y1 - (h * R) / 2 });
  const clean = (x, y, w, h) => { const c = range(w, h); return x >= c.x0 - 1e-6 && x <= c.x1 + 1e-6 && y >= c.y0 - 1e-6 && y <= c.y1 + 1e-6 && hitOf(boxAt(x, y, w, h), ui, null) <= 1e-6; };
  if ( today && clean(today.x, today.y, bw, bh) ) return { x: today.x, y: today.y, k: 1, hit: 0 };
  // (the nearest clean spot for the word at share k of its size, or null)
  const spotAt = (k) => {
    const w = bw * k, h = bh * k, c = range(w, h);
    if ( c.x0 > c.x1 || c.y0 > c.y1 ) return null;
    // (bands: the wanted one, then half a word, a word ... above and below it, inside the view)
    const ys = [0]; for ( let d = 0.5; d <= 6; d += 0.5 ) ys.push(-d, d);
    let best = null;
    for ( const dy of ys ) {
      const y = clamp(want.y + dy * h, c.y0, c.y1);
      for ( const r of freeRuns(ui, v.x0, v.x1, y - h / 2, y + h / 2) ) {
        const a = Math.max(r.a + w / 2, c.x0), b = Math.min(r.b - w / 2, c.x1);
        if ( a > b + 1e-6 ) continue;
        const x = clamp(want.x, a, b), d = Math.hypot(x - want.x, y - want.y);
        if ( !best || d < best.d - 1e-6 ) best = { x, y, d };
      }
    }
    return best;
  };
  const ks = [1]; for ( let k = 0.92; k > minK + 1e-9; k -= 0.08 ) ks.push(Math.round(k * 100) / 100); ks.push(minK);
  let lo = null, hi = 1;
  for ( const k of ks ) { const s0 = spotAt(k); if ( s0 ) { lo = { k, s: s0 }; break; } hi = k; }
  if ( lo ) {
    // (the LARGEST share that fits, not the next rung of the ladder: a bigger size step never ends smaller than a smaller one)
    if ( lo.k < 1 ) for ( let i = 0; i < 10; i++ ) { const k = (lo.k + hi) / 2, s0 = spotAt(k); if ( s0 ) lo = { k, s: s0 }; else hi = k; }
    return { x: lo.s.x, y: lo.s.y, k: lo.k, hit: 0 };
  }
  // (nowhere clean even at minK: the least covered spot at minK inside the view, near where it should sound)
  const w = bw * minK, h = bh * minK, c = range(w, h);
  let best = null;
  for ( let fy = 0; fy <= 1; fy += 0.125 ) for ( let fx = 0; fx <= 1; fx += 0.125 ) {
    const x = c.x0 <= c.x1 ? c.x0 + (c.x1 - c.x0) * fx : (v.x0 + v.x1) / 2, y = c.y0 <= c.y1 ? c.y0 + (c.y1 - c.y0) * fy : (v.y0 + v.y1) / 2;
    const hit = hitOf(boxAt(x, y, w, h), ui, v), d = Math.hypot(x - want.x, y - want.y);
    if ( !best || hit < best.hit - 1e-6 || (Math.abs(hit - best.hit) <= 1e-6 && d < best.d) ) best = { x, y, hit, d };
  }
  return { x: best.x, y: best.y, k: minK, hit: best.hit };
}

/** the shares of a bigger step's extra size a word tries, from its whole stepped size down to today's (0): a step-3 word that finds no
    clean place at its stepped size takes the largest of these that does (never smaller than today's word) */
export const LADDER = [1, 0.5, 0];
/** how much more of its main word's placement penalty a bigger ladder size may cover than the least covering one and still be taken
    when no size is clean (sfx-core place's penalty: about a tenth of a panel's weight) */
export const LADDER_SLACK = 0.1;
/** Is a placed word clean (sfx-core place penalties `pen`): inside the view, off the panels, the tokens, the pins and the other words,
    and over its subject no more than its voice allows? */
export const isClean = (pen) => !!pen && pen.off <= 1e-6 && pen.pui <= 0.02 && pen.tok <= 1e-6 && (pen.pin ?? 0) <= 1e-6 && pen.wrd <= 0.05 && pen.sub <= 1e-6;

/**
 * The placement of words of which some may stand at a BIGGER step than today's: `place(specs, ctx)` (sfx-core place) at their stepped
 * size first; when that leaves a word dropped or the main word not clean, the words that `grows(w)` try smaller sizes, `resize(w, f)`
 * (f = the share of their extra size kept: LADDER, down to 0 = today's size), and the first size where every word stands and the main
 * word is clean is taken, else the one that keeps most words with the main word clean, the bigger first. Live 2026-11-15: at step 3 a
 * blast's main word covered its own marker and the pins, and its side words were dropped for want of room. Nothing grows (today's step,
 * a smaller one): `place` itself, untouched.
 */
export function ladderPlace(specs, ctx, { place, grows = () => false, resize = (w) => w } = {}) {
  const placed = place(specs, ctx);
  if ( !specs.some(grows) ) return placed;
  const n = specs.filter((w) => w.text || w.stream).length, hasMain = specs.some((w) => w.role === "main");
  const mainOk = (r) => !hasMain || isClean(r.find((q) => q.role === "main")?.pen);
  // (no size gives a clean place: the one that covers least - live, a step-3 blast word with no clean place anywhere stood at its full
  // stepped size over the party portraits; at today's size it covered less. A single word: its own penalty decides)
  const lead = (r) => (hasMain ? r.find((q) => q.role === "main") : r.length === 1 ? r[0] : null);
  const dirt = (r) => { const m = lead(r); return m && !isClean(m.pen) ? Math.min(9, (m.pen?.pen ?? 0) * 4) : 0; };
  const score = (r, i) => (mainOk(r) ? 1000 : 0) + r.length * 10 + r.filter((q) => q.role !== "main" && isClean(q.pen)).length - i * 0.5 - dirt(r);
  const full = (r) => mainOk(r) && r.length >= n;
  if ( full(placed) ) return placed;
  const tries = [{ r: placed, s: score(placed, 0), i: 0 }];
  for ( let i = 1; i < LADDER.length; i++ ) {
    const r = place(specs.map((w) => (grows(w) ? resize(w, LADDER[i]) : w)), ctx), sc = score(r, i);
    if ( full(r) ) return r;
    tries.push({ r, s: sc, i });
  }
  // (MAPSFXSEAT: no size gives a clean place - the BIGGEST size that keeps as many words and covers no more than LADDER_SLACK more of
  // its main word's penalty than the least covering size: live, a step-3 main word with no clean place anywhere stood at today's size,
  // step 3 looked like step 2, though the bigger size covered barely more)
  const pen = (r) => { const m = lead(r); return m ? (m.pen?.pen ?? 0) : 0; };
  const most = Math.max(...tries.map((q) => q.r.length)), anyOk = tries.some((q) => mainOk(q.r));
  const pool = tries.filter((q) => q.r.length === most && (!anyOk || mainOk(q.r)));
  const least = Math.min(...pool.map((q) => pen(q.r)));
  return (pool.find((q) => pen(q.r) <= least + LADDER_SLACK) ?? tries.sort((a, b) => b.s - a.s)[0]).r;
}

/**
 * A riding word's way (points { x, y, ms } in scene px) kept whole inside the view `v` and off the panels `ui` (pure): each point after
 * the first is held where the word's box (`bw` x `bh`) times its reach `rk` stays `m` inside the view, and a point whose box would stand
 * on an obstacle of `ui` (the panels; the caller adds the pins, the main word, the words up) is drawn back along the way toward the
 * start until it does not, at most to a third of the way (the start point too is held inside the view). Live
 * (THUNDERFIT): a blast's wave word rode out past the left edge and under the controls column. A way that is clean already is returned
 * as it is (the same points: today's picture).
 */
/** the points between two of a ride's points at which its box is checked (MAPSFXSEAT) */
export const RIDE_SAMPLES = 6;
export function rideFit(path, v, ui = [], bw = 0, bh = 0, rk = REACH.other, m = 0) {
  if ( !v || !Array.isArray(path) || !path.length ) return path;
  const hx = Math.min((bw * rk) / 2 + m, (v.x1 - v.x0) / 2), hy = Math.min((bh * rk) / 2 + m, (v.y1 - v.y0) / 2);
  const inV = (q) => ({ x: clamp(q.x, v.x0 + hx, v.x1 - hx), y: clamp(q.y, v.y0 + hy, v.y1 - hy) });
  const hit = (q) => hitOf(boxAt(q.x, q.y, bw, bh), ui, null) > 1e-6;
  const p0 = { ...path[0], ...inV(path[0]) };
  let changed = p0.x !== path[0].x || p0.y !== path[0].y;
  const out = [p0];
  // (MAPSFXSEAT: the box is checked ALONG the way, not only at its points - live at step 3 the wave word crossed the map pin between two
  // clean points of its way)
  const segHit = (a, b) => { for ( let k = 1; k <= RIDE_SAMPLES; k++ ) { const f = k / RIDE_SAMPLES; if ( hit({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }) ) return true; } return false; };
  for ( let i = 1; i < path.length; i++ ) {
    const q = path[i]; let c = inV(q);
    const prev = out[i - 1];
    // (in the way: drawn back toward the start to the first point whose way there is clean - not nearer than a third of the way; none
    // clean: where it was)
    if ( segHit(prev, c) ) {
      let ok = false;
      for ( let f = 0.9; f >= 0.3 - 1e-9; f -= 0.1 ) { const t = { x: p0.x + (c.x - p0.x) * f, y: p0.y + (c.y - p0.y) * f }; if ( !segHit(prev, t) ) { c = t; ok = true; break; } }
      // (the obstacle lies right on the way: the word rides only up to it - the farthest clean point toward where it was going - and
      // stands there; a word already on it keeps its way)
      if ( !ok && !hit(prev) ) { let t = prev; for ( let k = 1; k <= RIDE_SAMPLES * 4; k++ ) { const f = k / (RIDE_SAMPLES * 4), q2 = { x: prev.x + (c.x - prev.x) * f, y: prev.y + (c.y - prev.y) * f }; if ( hit(q2) ) break; t = q2; } c = t; }
    }
    if ( c.x !== q.x || c.y !== q.y ) changed = true;
    out.push({ ...q, x: c.x, y: c.y });
  }
  return changed ? out : path;
}
