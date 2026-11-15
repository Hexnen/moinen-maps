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

/**
 * A spot (screen px) for an unlocated word of box `bw` x `bh` on a screen `view` ({ x0, y0, x1, y1 }) with this seat's panels `ui`.
 * `today` = the spot the word took before (kept when the word's REAL box is clean there: inside the view by `m` and off every panel),
 * `want` = where it should sound (the edge toward a strike, a free spot of the upper middle). Else the nearest clean spot: along the
 * band of `want`, then bands above and below it; only when no band holds it whole the word is made smaller (down to `minK` of its
 * size, the largest share that fits clean; at `minK` the least covered spot). -> { x, y, k (size share), hit (px² still covered) }
 */
export function screenFit({ today = null, want, bw, bh, view, ui = [], m = EDGE, minK = 0.55 }) {
  const v = { x0: view.x0 + m, y0: view.y0 + m, x1: view.x1 - m, y1: view.y1 - m };
  if ( today ) { const b = boxAt(today.x, today.y, bw, bh); if ( hitOf(b, ui, v) <= 1e-6 ) return { x: today.x, y: today.y, k: 1, hit: 0 }; }
  const ks = [1]; for ( let k = 0.92; k > minK + 1e-9; k -= 0.08 ) ks.push(Math.round(k * 100) / 100); ks.push(minK);
  for ( const k of ks ) {
    const w = bw * k, h = bh * k;
    if ( w > v.x1 - v.x0 || h > v.y1 - v.y0 ) continue;
    // (bands: the wanted one, then half a word, a word ... above and below it, inside the view)
    const ys = [0]; for ( let d = 0.5; d <= 6; d += 0.5 ) ys.push(-d, d);
    let best = null;
    for ( const dy of ys ) {
      const y = clamp(want.y + dy * h, v.y0 + h / 2, v.y1 - h / 2);
      for ( const r of freeRuns(ui, v.x0, v.x1, y - h / 2, y + h / 2) ) {
        if ( r.b - r.a < w - 1e-6 ) continue;
        const x = clamp(want.x, r.a + w / 2, r.b - w / 2), d = Math.hypot(x - want.x, y - want.y);
        if ( !best || d < best.d - 1e-6 ) best = { x, y, d };
      }
    }
    if ( best ) return { x: best.x, y: best.y, k, hit: 0 };
  }
  // (nowhere clean even at minK: the least covered spot at minK, near where it should sound)
  const w = bw * minK, h = bh * minK;
  let best = null;
  for ( let fy = 0; fy <= 1; fy += 0.125 ) for ( let fx = 0; fx <= 1; fx += 0.125 ) {
    const x = v.x0 + w / 2 + (Math.max(0, v.x1 - v.x0 - w)) * fx, y = v.y0 + h / 2 + (Math.max(0, v.y1 - v.y0 - h)) * fy;
    const hit = hitOf(boxAt(x, y, w, h), ui, v), d = Math.hypot(x - want.x, y - want.y);
    if ( !best || hit < best.hit - 1e-6 || (Math.abs(hit - best.hit) <= 1e-6 && d < best.d) ) best = { x, y, hit, d };
  }
  return { x: best.x, y: best.y, k: minK, hit: best.hit };
}

/** the shares of a bigger step's extra size a word tries, from its whole stepped size down to today's (0): a step-3 word that finds no
    clean place at its stepped size takes the largest of these that does (never smaller than today's word) */
export const LADDER = [1, 0.5, 0];
/** Is a placed word clean (sfx-core place penalties `pen`): inside the view, off the panels, the tokens, the pins and the other words,
    and over its subject no more than its voice allows? */
export const isClean = (pen) => !!pen && pen.off <= 1e-6 && pen.pui <= 0.02 && pen.tok <= 1e-6 && (pen.pin ?? 0) <= 1e-6 && pen.wrd <= 0.05 && pen.sub <= 1e-6;
