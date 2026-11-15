/* MAPSFXSEAT: ONE PICTURE FOR THE TABLE, then ONE RULE PER SEAT (pure: no Foundry, no PIXI, no DOM; node-tested in
   dev/sfx-seat.test.mjs). The owner's standard for the map's lettering: every seat that sees the place shows the same words, at the
   same size and place on the map, at the same instant, and the same again when the event is replayed.

   Before, each seat letters a map event from its OWN view: the words were written in the order its timers fired (a seat busy applying
   the destruction wrote the debris words after the ground was known, another before: other words), sized by its window height and zoom
   and clamped by the engine's size model with this seat's window and its own count of words up (a seat with more words up drew the main
   word smaller), placed around its own panels, its own tokens (the GM sees hidden ones) and its own words up, and started when its
   timer fired (a seat busy for two seconds dropped the words as too late).

   Now (the rule this module sets; plus-ultra's roll splash set the same for its map block: same-picture.mjs, MAPSEAT):
   1. The TABLE PICTURE of a map moment is computed from what every seat shares: the event (its record, its strokes, its shared time),
      the scene (grid, its rectangle, the tokens nobody hides, the note pins every player may see), the table's settings, and a
      REFERENCE VIEW instead of this seat's view: the reference window (REF_VW x REF_VH CSS px minus RESERVE, Foundry's bars) centred on
      the event at a REFERENCE ZOOM (refZoom: REF_SQ squares in the window's height, wider when the event itself is bigger). Words are
      sized in scene px by the engine's own size model fed that reference view (fit "world" afterwards: no second clamp per seat),
      measured by the engine (L.measure: the hold box and the whole reach of the entrance and the hold), placed off the shared
      obstacles and off the words the table picture already holds (the LEDGER: planned words, not what one seat happened to draw), and
      timed on the shared clock (`startAt`).
   2. A seat shows that picture by these rules only (MAPSFXSEAT2 seatLayout), each logged per seat:
      - not on this seat's screen (the place, the subject and a rider's way all off its view): nothing (as before);
      - how big is this seat's: the engine's own size of the word for this seat's window and zoom at step 2 (the table's options and
        words up; a ranked word's request the larger of the table's and this view's share), then the step's share of it (step 3 x1.4, step 1
        x0.7, never under the legibility floor) - a seat zoomed closer than the reference never draws a weaker word than before ("size");
      - where is the table's: each word scaled about its point nearest the thing it letters, so it keeps its side and its gap; when its
        ink would lie on this seat's panels, a pin, a shared token or a word up with it, or its box out of the view, it moves the least -
        on its own side first, else on the first side of the table's own order every seat shares, farther away but clean ("shift", "side");
      - a step-3 word that cannot stand clean at MIN_GAIN x its step-2 size anywhere: the largest clean size not under step 2 ("full");
        nothing clean at all: the least covered spot at its step's own size ("tight"); bigger than the view: the size that fits ("fit");
      - a word that rides (a bomb's fall, a car) keeps the table's way, only its size is this seat's ("ride");
      - a place this seat may not see (a player: fog, out of vision, a hidden shooter): unlocated on the screen (as before);
      - this seat's reduced motion and its performance mode (fewer words up) as before: they are this seat's needs, not its view.
      Words on the SCREEN (unlocated: thunder, a sound from a place this seat cannot see) are laid out once in the reference window
      (SCREEN_ZONES: the shared panel zones every seat keeps them off) and drawn centred in this seat's window, at the size this window
      gives them at step 2 then the step's share (sfx-table screenCaps), laid out by the same seatLayout off this seat's panels, its pins
      and the screen words still up on it. */

import * as SZ from "./sfx-size.mjs";
import * as FIT from "./sfx-fit.mjs";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const inter = (a, b) => area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });

/** the reference window (CSS px): as plus-ultra's same-picture.mjs (SAMEPIC-1) */
export const REF_VW = 1600, REF_VH = 900;
/** Foundry's own bars, kept off on the reference window (CSS px from its edges; same-picture.mjs RESERVE, measured live) */
export const RESERVE = Object.freeze({ l: 96, t: 54, r: 356, b: 98 });
/** the engine's usable width on the reference window (its sidebar collapsed: innerWidth; the engine counts an open sidebar out) */
export const REF_USABLE_W = REF_VW;
/** squares of the scene in the reference window's height at the reference zoom (provisional MAPSFXSEAT-1: a GM's usual table view,
    The Warehouse at 0.45 shows 5.7 squares of 350 px in 900 px) */
export const REF_SQ = 6;
/** the smallest cap height (CSS px) a map word is drawn at on any seat (the engine's legibility floor floorMin) */
export const READ_PX = 15;
/** a word's margin from a seat's view edge, CSS px (sfx-fit EDGE) */
export const SEAT_EDGE = 16;

/**
 * The reference zoom of a map moment (pure, shared): REF_SQ squares in the reference window's height; a moment bigger than that (a
 * meteor's ring, a wide cluster) is referenced at the zoom that holds its extent `r` (scene px, radius) with room around it.
 */
export function refZoom(grid = 100, r = 0) {
  const g = grid > 0 ? grid : 100, zGrid = REF_VH / (REF_SQ * g);
  const inner = REF_VH - RESERVE.t - RESERVE.b;
  const zFit = r > 0 ? inner / (2.5 * r) : Infinity;
  return Math.max(zGrid * 0.25, Math.min(zGrid, zFit));
}
/** The reference view of a moment (scene px): the reference window minus RESERVE, centred on `c` (the event) at zoom `z`. */
export function refView(c, z) {
  const u = 1 / Math.max(1e-4, z);
  return { x0: c.x - (REF_VW / 2 - RESERVE.l) * u, y0: c.y - (REF_VH / 2 - RESERVE.t) * u, x1: c.x + (REF_VW / 2 - RESERVE.r) * u, y1: c.y + (REF_VH / 2 - RESERVE.b) * u };
}
/**
 * The engine's size model fed the REFERENCE view (shared): `sizeFor` = the engine's own model (scripts/letters/size.mjs sizeFor), `o`
 * the play options of the word, `plan` { sizeK, hold: { w } } (the engine's plan: its mood factor and hold-box width), `z` the
 * reference zoom, `alive` the table's world words up at its moment (the ledger), `grid`. -> { size (scene px, to play with fit "world"),
 * px (cap height on the reference screen), clamp }.
 */
export function refSize(sizeFor, o, plan, { z = 1, alive = 0, grid = 100, fit = null, space = "world", vw = REF_USABLE_W, vh = REF_VH } = {}) {
  const world = space === "world";
  const info = sizeFor({ space: world ? "world" : "screen", size: o.size, magnitude: o.magnitude, area: world ? areaOf(o.area) : 0, tokenSpan: 0, grid, zoom: world ? z : 1,
    vw, vh, scale: o.scale ?? 1, sizeK: plan?.sizeK ?? 1, aspect: plan?.hold?.w ?? 3, fit: fit ?? o.fit ?? "legible", alive: world ? alive : 0, pixel: 0,
    ceilK: o.ceil });
  return { size: info.size, px: info.px, clamp: info.clamp, natural: info.natural };
}
/** MAPSFXSEAT2: a step's share of today's (step 2's) size as drawn, the same ladder on the table's reference view and on every seat:
    step 3 = STEP_K[3] x today's - no ceiling here: the seat layout (seatLayout) holds it to what this seat's view can show clean -, step 1 =
    STEP_K[1] x today's but not under the engine's legibility floor (sfx-size smallPx). Before, step 3 was held under the engine's loudest
    ceiling (sfx-size bigPx): a big blast's main word already stands at it at step 2, so step 3 drew it no bigger (live 2026-11-15: the
    table's 282.5 -> 284.2), and a seat then fitted both to its view - step 3 smaller than step 2 there. */
export function stepPx(px2, step, floor = 0) {
  const s = SZ.stepOf(step);
  if ( s > SZ.SIZE_DEFAULT ) return px2 * SZ.STEP_K[s];
  if ( s < SZ.SIZE_DEFAULT && s > 0 ) return SZ.smallPx(px2, s, floor);
  return px2;
}
/** step 3 counts as visibly bigger than step 2 (and step 2 than step 1) from this ratio of the drawn size on; a seat whose view cannot
    hold a step-3 word that big anywhere clean draws it at the largest clean size not smaller than its step 2 ("full", question
    MAPSFXSEAT2-1) */
export const MIN_GAIN = 1.15;
const areaOf = (a) => (Number.isFinite(a) ? a : a && Number.isFinite(a.radius) ? a.radius : a && Number.isFinite(a.w) ? 0.5 * Math.sqrt(a.w * (a.h ?? a.w)) : 0);
/**
 * The TABLE size of a map word in scene px (shared; play it with fit "world"): the engine's own model on the reference view at zoom `z`
 * with the table's words up (`alive`), then the group's size step (SFXSIZE, sfx-size steppedPx: at a smaller step under the engine's
 * legibility floor of the reference screen, at a bigger one under its loudest ceiling there; `fitK` the ladder's share of the extra
 * size). `model` = the engine's L.sizeModel. -> { size, px (cap px on the reference screen, mood factor in), clamp } | null (exact or
 * pixel lettering: sized another way).
 */
export function tableSize(sizeFor, model, o, plan, { z, alive = 0, grid = 100, step = SZ.SIZE_DEFAULT, fitK = 1, vw = REF_USABLE_W, vh = REF_VH } = {}) {
  if ( !o || o.fit === "exact" || o.pixel ) return null;
  const q = refSize(sizeFor, o, plan, { z, alive, grid, vw, vh });
  const sk = plan?.sizeK ?? 1, s = SZ.stepOf(step);
  let px = q.px;
  if ( s !== SZ.SIZE_DEFAULT && s !== 0 ) {
    const st = stepPx(px, s, SZ.floorPx(vh, sk, model ?? FLOOR_MODEL));
    px = s > SZ.SIZE_DEFAULT && Number.isFinite(fitK) && fitK < 1 ? px + (st - px) * Math.max(0, fitK) : st;
  }
  return { size: px / (sk * z), px, px2: q.px, clamp: q.clamp };
}
/** (the engine's legibility floor numbers, for a caller without L.sizeModel: size.mjs SIZE) */
const FLOOR_MODEL = { floorMin: 15, floorMax: 30, floorVh: 0.026, quietFloorK: 0.8 };
/** The TABLE size of an unlocated (screen) ranked word, CSS px on the reference window: its rank's share of the reference height,
    stepped (SFXSIZE screenSizeAt, at a bigger step under the engine's loudest ceiling of the reference screen). */
export function tableScreenSize(sizeFor, model, o, plan, step = SZ.SIZE_DEFAULT) {
  const s = SZ.stepOf(step), sk = plan?.sizeK ?? 1;
  if ( s === SZ.SIZE_DEFAULT || s === 0 ) return o.size;
  // (MAPSFXSEAT2: the same ladder as a world word - the seat layout holds it to the window; before, step 3 stood under the loudest
  // ceiling, which a long thunder word already reaches at step 2: live, step 3's KRA-KA-GRRRRRAWOOM!! drew smaller than step 2's)
  return stepPx(o.size * sk, s, s < SZ.SIZE_DEFAULT ? SZ.floorPx(REF_VH, sk, model ?? FLOOR_MODEL) : 0) / sk;
}

/* ---------------------------------------------------------------- the ledger: what the table picture holds */

/**
 * The words the table picture holds (shared: planned from shared events, never "what this seat drew"): { key, box (scene px), t0, t1
 * (shared ms), main? }. A word is placed off the ones that stand at its moment; its own life is [t0, t1].
 */
export function makeLedger(max = 200) {
  const list = [];
  return {
    list,
    add(e) { const i = list.findIndex((q) => q.key === e.key); if ( i >= 0 ) list.splice(i, 1); list.push(e); if ( list.length > max ) list.splice(0, list.length - max); return e; },
    /** the boxes of the words up during [t0, t1] (other keys than `skip`) */
    boxes(t0, t1, skip = null) { return list.filter((q) => q.box && q.t1 > t0 && q.t0 < t1 && q.key !== skip && !(skip && q.page && q.page === skip)).map((q) => q.box); },
    count(t0, t1) { return list.filter((q) => q.t1 > t0 && q.t0 < t1).length; },
    has: (key) => list.some((q) => q.key === key),
    get: (key) => list.find((q) => q.key === key) ?? null,
    prune(now) { for ( let i = list.length - 1; i >= 0; i-- ) if ( list[i].t1 < now - 30000 ) list.splice(i, 1); },
    clear() { list.length = 0; }
  };
}
/** a word's life on the table (shared ms): its sound, its hold, an exit */
export const lifeOf = (w, t) => ({ t0: t, t1: t + Math.max(600, Number(w.hold) || 0, Number(w.ms) || 0) + 450 });

/* ---------------------------------------------------------------- the seat rule */

/**
 * How THIS seat shows a word of the table picture (pure). `box` its hold box and `reach` its reach box (scene px, from L.measure at its
 * table place), `view` this seat's view (scene px), `panels` this seat's own interface panels (scene px), `zoom` this seat's zoom,
 * `cap` the word's cap height (scene px), `subject` what it letters (scene px, optional). -> { rule: "ok" | "off" | "read" | "fit" |
 * "shift", k (size factor), dx, dy (scene px) }. Only a seat's view and panels move or resize it, never its text or its instant.
 */
export function seatFit({ box, reach = null, view, panels = [], zoom = 1, cap = 0, subject = null, read = READ_PX, edge = SEAT_EDGE }) {
  const R = reach ?? box;
  if ( !view ) return { rule: "ok", k: 1, dx: 0, dy: 0 };
  if ( inter(R, view) <= 0 && !(subject && inter(subject, view) > 0) ) return { rule: "off", k: 1, dx: 0, dy: 0 };
  const rules = [];
  let k = 1;
  // (too small to read at this zoom: the readable floor, in place)
  if ( cap > 0 && cap * zoom < read ) { k = read / (cap * zoom); rules.push("read"); }
  const m = edge / Math.max(1e-4, zoom);
  const v = { x0: view.x0 + m, y0: view.y0 + m, x1: view.x1 - m, y1: view.y1 - m };
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const sc = (b, f) => ({ x0: cx + (b.x0 - cx) * f, y0: cy + (b.y0 - cy) * f, x1: cx + (b.x1 - cx) * f, y1: cy + (b.y1 - cy) * f });
  let r = sc(R, k);
  // (its whole reach bigger than this seat's view: smaller, to fit)
  const kv = Math.min(1, (v.x1 - v.x0) / Math.max(1e-6, r.x1 - r.x0), (v.y1 - v.y0) / Math.max(1e-6, r.y1 - r.y0));
  if ( kv < 1 - 1e-6 ) { k *= kv; r = sc(R, k); rules.push("fit"); }
  // (cut by this seat's view edge or under its own panel: the smallest shift that shows it whole)
  const d = shiftClear(r, sc(box, k), panels, v);
  if ( Math.abs(d.dx) > 1e-6 || Math.abs(d.dy) > 1e-6 ) rules.push("shift");
  return { rule: rules.length ? rules.at(-1) : "ok", rules, k, dx: d.dx, dy: d.dy };
}
/**
 * MAPSFXSEAT2, THE SEAT LAYOUT: how THIS seat draws the words of one page / moment of the table picture (pure). The table picture says
 * which words, when, and where each stands against the thing it letters (its side, its gap); THIS seat says how big - the size its own
 * screen gives the word (`sizes`: the engine's own size for this seat's window and zoom at step 2, then the step's share of it), so a seat
 * zoomed closer than the reference view never draws a weaker word than it drew before the table picture, and step 3 stays bigger than 2
 * and 2 than 1 as drawn on every seat. Live (2026-11-15, MAPSFXSEAT) the whole page was scaled down as one group to fit a closer seat's
 * view (k 0.6 GM, 0.4 player: the blast word 203 -> 159 GM, 120 -> 111 player as drawn), the more at step 3 (bigger words, more to shrink:
 * smaller than step 2), and the group's shift put the main word on the bomb's pin.
 *
 * Each word, in `prio` order (the main word first): scaled about its PIVOT - the point of its table box nearest to its subject's centre
 * (beside the thing: its near edge; over it: the thing's own point) - to its first size, so it keeps its side of the thing and its gap;
 * kept there when it is clean: whole inside this seat's view (less `edge`), off this seat's panels, the pins, the tokens every seat counts,
 * the words of the same picture up at the same time (`life`), and off its own subject beyond `cover`. Else moved: the smallest shift
 * that makes it clean - away from the thing and along it first, on its own side; another side only when its own side has no room (owner's
 * ruling for plus-ultra's map block: a seat that cannot show it clean may show it farther away, but clean). No clean spot at that size: the
 * next of its `sizes` (never under `min`); none at all: at `min` where it covers least ("tight"). A word bigger than the view is made to
 * fit it ("fit"). A word that rides (`ride`) keeps its table way. A word whose place and subject are both off this view: "off".
 *
 * items: [{ key, prio, box (table box, world units), sub (subject box | null), sizes: [cap, ...] (world units, preferred first), u (the table
 *          box's cap), min (cap), full (cap), small (cap), life: [t0, t1] | null, ride, cover, ink: [kx, ky] (its ink's share of its box) }]
 * -> Map(key -> { cap, k (cap / u), px, py (pivot), f, dx, dy, box, rules, clean, side })   map a table point q: px + (q.x - px) * f + dx
 */
export function seatLayout(items, { view, panels = [], pins = [], tokens = [], zoom = 1, edge = SEAT_EDGE } = {}) {
  const out = new Map();
  if ( !view ) { for ( const it of items ?? [] ) out.set(it.key, { cap: it.u, k: 1, f: 1, px: 0, py: 0, dx: 0, dy: 0, box: it.box, rules: [], clean: true }); return out; }
  const m = edge / Math.max(1e-4, zoom), v = { x0: view.x0 + m, y0: view.y0 + m, x1: view.x1 - m, y1: view.y1 - m };
  const vw = Math.max(1, v.x1 - v.x0), vh = Math.max(1, v.y1 - v.y0);
  const placed = [];
  const meet = (a, b) => !a || !b || (a[0] < b[1] && b[0] < a[1]);
  const mv = (b, d) => ({ x0: b.x0 + d.dx, y0: b.y0 + d.dy, x1: b.x1 + d.dx, y1: b.y1 + d.dy });
  const into = (lo, hi, a, z) => (hi - lo > z - a ? (a + z) / 2 - (lo + hi) / 2 : lo < a ? a - lo : hi > z ? z - hi : 0);
  const inView = (b) => b.x0 >= v.x0 - 1e-6 && b.x1 <= v.x1 + 1e-6 && b.y0 >= v.y0 - 1e-6 && b.y1 <= v.y1 + 1e-6;
  for ( const it of (items ?? []).slice().sort((a, b) => (a.prio ?? 9) - (b.prio ?? 9)) ) {
    const B = it.box, u = it.u > 0 ? it.u : 1, sub = it.sub ?? null;
    const sc = sub ? { x: (sub.x0 + sub.x1) / 2, y: (sub.y0 + sub.y1) / 2 } : { x: (B.x0 + B.x1) / 2, y: (B.y0 + B.y1) / 2 };
    const p = { x: clamp(sc.x, B.x0, B.x1), y: clamp(sc.y, B.y0, B.y1) };
    const at = (f) => ({ x0: p.x + (B.x0 - p.x) * f, y0: p.y + (B.y0 - p.y) * f, x1: p.x + (B.x1 - p.x) * f, y1: p.y + (B.y1 - p.y) * f });
    // (off this view: its place and its subject both)
    if ( inter(B, view) <= 0 && !(sub && inter(sub, view) > 0) && !(it.ride && (it.path ?? []).some((q) => q.x >= view.x0 && q.x <= view.x1 && q.y >= view.y0 && q.y <= view.y1)) ) { out.set(it.key, { cap: it.u, k: 1, f: 1, px: p.x, py: p.y, dx: 0, dy: 0, box: B, rules: ["off"], rule: "off", clean: false }); continue; }
    const rules = [];
    // (its sizes, the first that fits the view whole; a word bigger than the view: the size that fits)
    const fitCap = (B.x1 - B.x0) > 0 && (B.y1 - B.y0) > 0 ? u * Math.min(vw / (B.x1 - B.x0), vh / (B.y1 - B.y0)) : Infinity;
    let sizes = (it.sizes?.length ? it.sizes : [u]).filter((c) => c > 0);
    let min = Math.min(it.min > 0 ? it.min : sizes.at(-1), sizes.at(-1));
    // (no clean spot at any of its sizes on this view: smaller - the largest size that stands clean, never under `small` (this seat's
    // step-1 size: the legibility floor's side of it) - rule "small", question MAPSFXSEAT2-1: clean before as big as before)
    const small = it.small > 0 ? Math.min(it.small, min) : min;
    for ( let c = min * 0.95; c > small * 1.0001; c *= 0.95 ) sizes.push(c);
    if ( small < min - 1e-9 ) sizes.push(small);
    if ( sizes.every((c) => c > fitCap) ) { sizes = [fitCap]; rules.push("fit"); } else sizes = sizes.filter((c) => c <= fitCap + 1e-9);
    // (a word that rides keeps its table way: only its size is this seat's)
    // (its way is the table's, held inside THIS view: the table kept it inside the reference view, which a seat zoomed closer does not
    // show whole - live, the blast's wave word rode half off the GM's screen; `ride`: the rectangle its anchor keeps to, sfx-page
    // rideInView's margins at this seat's size)
    if ( it.ride ) {
      const f = sizes[0] / u, bw = (it.w?.bw > 0 ? it.w.bw : B.x1 - B.x0) * f, bh = (it.w?.bh > 0 ? it.w.bh : B.y1 - B.y0) * f;
      const mx = Math.min(bw * 0.55, vw * 0.45), my = Math.min(bh * 0.75, vh * 0.45);
      out.set(it.key, { cap: sizes[0], k: f, f, px: p.x, py: p.y, dx: 0, dy: 0, box: at(f), rules: [...rules, "ride"], rule: "ride", clean: true, ride: { x0: v.x0 + mx, y0: v.y0 + my, x1: v.x1 - mx, y1: v.y1 - my } });
      continue;
    }
    // (pins and tokens lie ON the map: a word over them hides what the table must read - the hardest rule; a panel lies over the canvas
    // and hides the word, another word up with it is read badly: both kept clean too, given way only where nothing clean exists)
    const near = (o) => o.x1 > view.x0 && o.x0 < view.x1 && o.y1 > view.y0 && o.y0 < view.y1;
    const hardG = grid([...pins, ...tokens].filter(near), view), softG = grid([...panels, ...placed.filter((q) => meet(q.life, it.life)).map((q) => q.box)].filter(near), view);
    // (its own subject: covered no more than its kind allows, or than the table picture itself covers it - the table's placement weighs
    // that share, it does not forbid it: a big blast's word stands over the top of its crater on the table)
    const hw0 = sub ? (sub.x1 - sub.x0) / 2 : 0, hh0 = sub ? (sub.y1 - sub.y0) / 2 : 0;
    const cover = sub ? Math.max(it.cover ?? 0.3, inter(B, sub) / Math.max(1, area(sub))) + 0.02 : 0;
    // (what may not be covered is the word's INK - its hold picture with the rim under it (`ink`: shares of its box) -, not the room its
    // box keeps for the entrance and the outline: the box stays whole inside the view)
    const kx = it.ink?.[0] > 0 ? Math.min(1, it.ink[0]) : 1, ky = it.ink?.[1] > 0 ? Math.min(1, it.ink[1]) : 1;
    const inkOf = (b) => { const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, hw = ((b.x1 - b.x0) * kx) / 2, hh = ((b.y1 - b.y0) * ky) / 2; return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh }; };
    // (nothing clean at any size: the least covered spot, at a size that still keeps its step - a step-3 word not under `full`)
    let fmin = Math.min(sizes[0], Math.max(min, it.full > 0 ? it.full : 0));
    const offView = (b) => area(b) - inter(b, v);
    // (its side of the thing: the way the table put it from the subject's centre, along the axis it stands out most - above, below, left,
    // right; kept on every seat, left only where this seat has no clean spot on it)
    const sideOf = (b) => {
      const ox = ((b.x0 + b.x1) / 2 - sc.x) / Math.max(1, hw0 + (b.x1 - b.x0) / 2), oy = ((b.y0 + b.y1) / 2 - sc.y) / Math.max(1, hh0 + (b.y1 - b.y0) / 2);
      if ( Math.max(Math.abs(ox), Math.abs(oy)) < 0.15 ) return null;
      return Math.abs(ox) > Math.abs(oy) ? { x: Math.sign(ox), y: 0 } : { x: 0, y: Math.sign(oy) };
    };
    const side0 = sideOf(B), side = side0 ?? { x: 0, y: 0 };
    const flips = (b) => { if ( !side0 ) return 0; const s2 = sideOf(b); return !s2 || s2.x !== side0.x || s2.y !== side0.y ? 1 : 0; };
    // (the table's side order round the subject, and which of its sides a box stands on)
    const around = it.around?.length ? it.around : AROUND, touch = Number.isFinite(it.touch) ? it.touch : 0.18;
    const hw = sub ? (sub.x1 - sub.x0) / 2 : 0, hh = sub ? (sub.y1 - sub.y0) / 2 : 0;
    const rankOf = (b, bw, bh) => {
      const ox = ((b.x0 + b.x1) / 2 - sc.x) / Math.max(1, hw + bw / 2), oy = ((b.y0 + b.y1) / 2 - sc.y) / Math.max(1, hh + bh / 2);
      let k = around.length, dk = Infinity;
      for ( let i = 0; i < around.length; i++ ) { const dd = Math.hypot(ox - around[i][0], oy - around[i][1]); if ( dd < dk - 1e-9 ) { dk = dd; k = i; } }
      return k;
    };
    let best = null, fallback = null;
    const trySize = (cap) => {
      const f = cap / u, b0 = at(f), bw = b0.x1 - b0.x0, bh = b0.y1 - b0.y0;
      const d0 = { dx: into(b0.x0, b0.x1, v.x0, v.x1), dy: into(b0.y0, b0.y1, v.y0, v.y1) };
      const clampD = (d) => { const q = mv(b0, d); return { dx: d.dx + into(q.x0, q.x1, v.x0, v.x1), dy: d.dy + into(q.y0, q.y1, v.y0, v.y1) }; };
      // candidate shifts, searched nearest first (best first: a candidate's score is never under its `base`, so the search stops at the
      // first candidate whose base is not better than the best clean one): none / into the view; away from the thing and along it on its
      // own side; beside its subject on each side of the table's own order; and, from every candidate that meets an obstacle, just past
      // that obstacle on each side (so a word between two obstacles finds the gap)
      const queue = [], seen = new Set();
      const add = (d) => {
        const c = clampD(d), k = Math.round(c.dx) * 2097152 + Math.round(c.dy);
        if ( seen.has(k) ) return;
        seen.add(k);
        const q = mv(b0, c), fl = flips(q), dist = Math.hypot(c.dx, c.dy) / Math.max(1, bh);
        heapPush(queue, { d: c, q, fl, base: fl ? 6 + 2 * rankOf(q, bw, bh) + dist : dist });
      };
      add(d0);
      const ax = side.x || (side.y ? 0 : 1), ay = side.y || (side.x ? 0 : -1);
      for ( const s of [0.25, 0.5, 1, 1.5, 2.5] ) { add({ dx: d0.dx + ax * s * bh, dy: d0.dy + ay * s * bh }); add({ dx: d0.dx + s * bw * 0.5, dy: d0.dy }); add({ dx: d0.dx - s * bw * 0.5, dy: d0.dy }); add({ dx: d0.dx, dy: d0.dy + s * bh }); add({ dx: d0.dx, dy: d0.dy - s * bh }); }
      // (beside its subject on each side of the table's own order `around`, touching it as the table places - and a step farther out:
      // a seat that must leave the table's side takes the first side of that SHARED order it can show clean, so two seats that both
      // must leave it agree)
      if ( sub ) for ( const [ox, oy] of around ) for ( const g of [0, 0.5] ) {
        const tx = sc.x + ox * (hw + bw / 2 - touch * bh + g * bh), ty = sc.y + oy * (hh + bh / 2 - touch * bh + g * bh);
        add({ dx: tx - (b0.x0 + b0.x1) / 2, dy: ty - (b0.y0 + b0.y1) / 2 });
      }
      let evals = 0;
      while ( queue.length && evals < MAX_EVALS ) {
        const c = heapPop(queue);
        if ( best && best.cap === cap && c.base >= best.score - 1e-9 ) break;
        evals++;
        const { d, q, fl } = c, k = inkOf(q);
        let hh2 = 0, soft = 0;
        const met = [];
        for ( const o of hardG.near(k) ) { const a = inter(k, o); if ( a > 0 ) { hh2 += a; met.push(o); } }
        const metSoft = [];
        for ( const o of softG.near(k) ) { const a = inter(k, o); if ( a > 0 ) { soft += a; metSoft.push(o); } }
        const subX = sub ? Math.max(0, inter(k, sub) - cover * area(sub)) : 0, off = offView(q), ia = area(k);
        // (clean: whole in the view, off every pin and token, its own subject covered no more than allowed, and at most SOFT_OK of its ink
        // under this seat's panels / words up with it - an edge under a panel is read, a word made smaller is weaker: MAPSFXSEAT2-1)
        const clean = hh2 <= 1e-6 && off <= 1e-6 && subX <= 1e-6 && soft <= SOFT_OK * ia + 1e-6;
        // (clean first; on its own side; off it, the earliest side of the shared order; then the nearest, the least covered)
        const score = c.base + (soft / Math.max(1, ia)) * 40;
        // (made smaller for want of room: the largest clean size on any side - its own side first at a size, then the shared order -:
        // the roomiest side is the one seats short of room share, and the word stays as strong as this view lets it; live 2026-11-15
        // "own side first while shrinking" kept the GM's blast word above the bomb at 155 and sent the player's below it, MAPSFXSEAT2-6)
        // (the larger size wins, then the lower score: the sizes under `min` are not tried in order, see below)
        const over = (o) => !o || cap > o.cap + 1e-9 || (Math.abs(cap - o.cap) <= 1e-9 && score < o.score - 1e-9);
        if ( clean ) { if ( over(best) ) best = { cap, f, d, q, score, fl, soft }; continue; }
        else if ( cap >= fmin - 1e-9 ) {
          // (nothing clean at any size: the least covered at a size not under `fmin` - off pins and tokens first, then on its own side, then
          // the least covered and the least cut by the view edge)
          const fs = ((soft + subX + hh2 * 1000 + off * 4) / Math.max(1, area(q))) * 100 + fl * 20 + score;
          if ( !fallback || fs < fallback.fs - 1e-9 ) fallback = { cap, f, d, q, fs };
        }
        // (escapes: past each pin / token it meets, and past the panels / words it meets only when they cover more than the edge allowed)
        if ( soft > SOFT_OK * ia + 1e-6 ) met.push(...metSoft);
        for ( const o of met ) { add({ dx: d.dx + o.x0 - k.x1 - 1, dy: d.dy }); add({ dx: d.dx + o.x1 - k.x0 + 1, dy: d.dy }); add({ dx: d.dx, dy: d.dy + o.y0 - k.y1 - 1 }); add({ dx: d.dx, dy: d.dy + o.y1 - k.y0 + 1 }); }
        if ( sub && subX > 1e-6 ) { add({ dx: d.dx, dy: d.dy + (side.y || -1) * Math.min(bh, subX / Math.max(1, k.x1 - k.x0)) }); }
      }
    };
    // (its sizes from the largest: the first with a clean spot wins - its own sizes down to `min`, then under it (rule "small") down to the
    // legibility floor x MIN_GAIN, on any side (its own first at a size). Each run searched by a stride of four, then the three larger between the first hit and the miss before it: a smaller word
    // fits where a larger one did nearly always, and a view with no room at all tries a third of the sizes. The run under `min` is the
    // same on every step (`min` x 0.95^k), so its search finds the same size whichever step the word was asked at)
    const gallop = (list) => {
      let hit = -1;
      for ( let j = 0; list.length; j = Math.min(j + 4, list.length - 1) ) {
        trySize(list[j]);
        if ( best ) { hit = j; break; }
        if ( j === list.length - 1 ) break;
      }
      if ( hit > 0 ) for ( let j = Math.max(1, hit - 3); j < hit; j++ ) { const was = best; trySize(list[j]); if ( best !== was ) break; }
    };
    const search = (list) => {
      gallop(list.filter((c) => c >= min - 1e-9));
      if ( !best ) gallop(list.filter((c) => c < min - 1e-9));
    };
    // (step 1 yields: where a step-2 word would have to shrink for room here (`probe`: its sizes on this seat), step 1 stays at most
    // 1 / MIN_GAIN of what step 2 gets - a seat short of room keeps step 1 < step 2 as drawn, never under the legibility floor)
    if ( it.probe?.length && !rules.includes("fit") ) {
      const keep = [min, fmin], pr = it.probe.filter((c) => c <= fitCap + 1e-9);
      if ( pr.length ) {
        min = fmin = pr[0];
        search(pr);
        const c2 = best?.cap ?? pr.at(-1);
        best = fallback = null; [min, fmin] = keep;
        const lim = Math.max(c2 / MIN_GAIN, it.floor > 0 ? it.floor : 0);
        if ( sizes[0] > lim + 1e-9 ) {
          const s2 = sizes.filter((c) => c <= lim + 1e-9);
          sizes = s2.length ? s2 : [lim]; min = Math.min(min, sizes.at(-1)); fmin = Math.min(sizes[0], Math.max(min, it.full > 0 ? it.full : 0));
          rules.push("yield");
        }
      }
    }
    // (a view with no clean spot even at its smallest size has none at any: only the least covered spot at the largest size and the
    // smallest that keeps its step (`fmin`) is sought)
    if ( sizes.length > 2 ) {
      trySize(sizes.at(-1));
      const none = !best;
      best = null;
      if ( none ) { const fs = sizes.filter((c) => c >= fmin - 1e-9); for ( const cap of new Set([fs[0], fs.at(-1)]) ) if ( cap > 0 ) trySize(cap); }
      else search(sizes);
    } else for ( const cap of sizes ) { trySize(cap); if ( best ) break; }
    const pick = best ?? fallback ?? { cap: sizes[0], f: sizes[0] / u, d: { dx: 0, dy: 0 }, q: at(sizes[0] / u) };
    if ( Math.abs(pick.f - 1) > 1e-6 && !rules.includes("fit") ) rules.push("size");
    if ( Math.abs(pick.d.dx) > 1e-6 || Math.abs(pick.d.dy) > 1e-6 ) rules.push("shift");
    if ( best && best.fl ) rules.push("side");
    if ( !best ) rules.push("tight");
    if ( best && it.full > 0 && best.cap < it.full - 1e-9 && best.cap >= min - 1e-9 ) rules.push("full");
    if ( best && best.cap < min - 1e-9 ) rules.push("small");
    if ( best?.soft > 1e-6 ) rules.push("edge");
    const r = { cap: pick.cap, k: pick.f, f: pick.f, px: p.x, py: p.y, dx: pick.d.dx, dy: pick.d.dy, box: pick.q, rules, rule: rules.at(-1) ?? "ok", clean: !!best && !(best.soft > 1e-6), ok: !!best };
    out.set(it.key, r);
    placed.push({ box: inkOf(pick.q), life: it.life ?? null });
  }
  return out;
}
/** the share of a word's ink a seat lets lie under its own panels / the words up with it (its edge) before it moves farther or is made
    smaller: question MAPSFXSEAT2-1 (provisional; live 2026-11-15 the take's blast word could not stand whole on either seat at its size
    between the challenges panel, the scene bar, the hotbar and the bomb's pin) */
export const SOFT_OK = 0.06;
/** the most candidate spots a word tries at one size (best first: the nearest clean one is found long before; the cap bounds a crowded view) */
const MAX_EVALS = 160;
// (the search's queue: a binary heap on `base`, nearest first)
function heapPush(h, e) { h.push(e); let i = h.length - 1; while ( i > 0 ) { const pi = (i - 1) >> 1; if ( h[pi].base <= e.base ) break; h[i] = h[pi]; i = pi; } h[i] = e; }
function heapPop(h) {
  const top = h[0], e = h.pop();
  if ( h.length ) {
    let i = 0;
    for ( ;; ) { const l = 2 * i + 1, r = l + 1; let m = i, mb = e.base; if ( l < h.length && h[l].base < mb ) { m = l; mb = h[l].base; } if ( r < h.length && h[r].base < mb ) m = r; if ( m === i ) break; h[i] = h[m]; i = m; }
    h[i] = e;
  }
  return top;
}
// (obstacles bucketed on a coarse grid over the view: a candidate meets only the few in its cells - same answers, fewer tests)
function grid(list, view, n = 12) {
  if ( list.length < 8 ) return { near: () => list };
  const x0 = view.x0, y0 = view.y0, cw = Math.max(1, (view.x1 - view.x0) / n), ch = Math.max(1, (view.y1 - view.y0) / n);
  const cx = (x) => Math.max(0, Math.min(n - 1, Math.floor((x - x0) / cw))), cy = (y) => Math.max(0, Math.min(n - 1, Math.floor((y - y0) / ch)));
  const cells = Array.from({ length: n * n }, () => []);
  list.forEach((o, i) => { for ( let y = cy(o.y0); y <= cy(o.y1); y++ ) for ( let x = cx(o.x0); x <= cx(o.x1); x++ ) cells[y * n + x].push(i); });
  const mark = new Uint32Array(list.length); let stamp = 0;
  return { near(b) {
    stamp++; const outL = [];
    for ( let y = cy(b.y0); y <= cy(b.y1); y++ ) for ( let x = cx(b.x0); x <= cx(b.x1); x++ ) for ( const i of cells[y * n + x] ) if ( mark[i] !== stamp ) { mark[i] = stamp; outL.push(list[i]); }
    return outL;
  } };
}
/** the table's side order round a word's subject when the item names none (sfx-core AROUND: above, above beside, beside, below) */
const AROUND = [[0, -1], [0.55, -1], [-0.55, -1], [1, -0.35], [-1, -0.35], [1, 0.3], [-1, 0.3], [0, 1], [0, 0]];
/** a point of the table picture as this seat draws it (seatLayout's entry `L`) */
export const layoutAt = (q, L) => (L ? { ...q, x: L.px + (q.x - L.px) * L.f + L.dx, y: L.py + (q.y - L.py) * L.f + L.dy } : q);

/** the smallest shift that brings reach `r` inside `v` and the box `b` (or every box of a group) off every panel (inside the view
    first; panels as far as they let it stay inside the view; nothing clean: the least covered) */
export function shiftClear(r, b, panels, v) {
  const bs = Array.isArray(b) ? b : [b];
  const into = (lo, hi, a, z) => (hi - lo > z - a ? (a + z) / 2 - (lo + hi) / 2 : lo < a ? a - lo : hi > z ? z - hi : 0);
  const d0 = { dx: into(r.x0, r.x1, v.x0, v.x1), dy: into(r.y0, r.y1, v.y0, v.y1) };
  const mv = (q, d) => ({ x0: q.x0 + d.dx, y0: q.y0 + d.dy, x1: q.x1 + d.dx, y1: q.y1 + d.dy });
  const hit = (d) => panels.reduce((s, p) => s + bs.reduce((t, q) => t + inter(mv(q, d), p), 0), 0) + (area(mv(r, d)) - inter(mv(r, d), v)) * 4;
  if ( hit(d0) <= 1e-6 ) return d0;
  let best = { ...d0, h: hit(d0), dist: Math.hypot(d0.dx, d0.dy) };
  const cands = [];
  for ( const p of panels ) for ( const b1 of bs ) {
    const q = mv(b1, d0); if ( inter(q, p) <= 0 ) continue;
    cands.push({ dx: d0.dx + p.x0 - q.x1 - 1, dy: d0.dy }, { dx: d0.dx + p.x1 - q.x0 + 1, dy: d0.dy }, { dx: d0.dx, dy: d0.dy + p.y0 - q.y1 - 1 }, { dx: d0.dx, dy: d0.dy + p.y1 - q.y0 + 1 });
  }
  for ( const c of cands ) { const h = hit(c), dist = Math.hypot(c.dx, c.dy); if ( h < best.h - 1e-6 || (Math.abs(h - best.h) <= 1e-6 && dist < best.dist) ) best = { ...c, h, dist }; }
  return { dx: best.dx, dy: best.dy };
}

/* ---------------------------------------------------------------- the screen: one reference window for every seat */

/** the shared panel zones of the reference window (CSS px in it): Foundry's bars (RESERVE) and the panels every seat may have at a
    fixed spot - the party cards bottom left, the challenges' panel top right (plus-ultra same-picture.mjs PANEL_ZONES / dockZone), the
    map's own meter top left (CROWD2 METER_ZONE). A seat's other panels move only that seat's words (seatFit). */
export const SCREEN_ZONES = Object.freeze([
  { x0: 0, y0: 0, x1: RESERVE.l, y1: REF_VH }, { x0: 0, y0: 0, x1: REF_VW, y1: RESERVE.t }, { x0: REF_VW - RESERVE.r, y0: 0, x1: REF_VW, y1: REF_VH },
  { x0: 0, y0: REF_VH - RESERVE.b, x1: REF_VW, y1: REF_VH },
  { x0: 0, y0: REF_VH - 414, x1: 340, y1: REF_VH - 108 }, { x0: REF_VW - RESERVE.r + 2 - 310, y0: 48, x1: REF_VW - RESERVE.r + 2, y1: 281 },
  { x0: 96, y0: 92, x1: 360, y1: 144 }
]);
/** the reference window's offset on a seat's window W x H (it is centred there) */
export const screenOffset = (W, H) => ({ x: (W - REF_VW) / 2, y: (H - REF_VH) / 2 });
/** a screen spot of the reference window (fx, fy: shares of the reference window) */
export const refSpot = (fx, fy) => ({ x: fx * REF_VW, y: fy * REF_VH });

const scaleAt = (b, f, cx, cy) => (f === 1 ? b : { x0: cx + (b.x0 - cx) * f, y0: cy + (b.y0 - cy) * f, x1: cx + (b.x1 - cx) * f, y1: cy + (b.y1 - cy) * f });
/** a spot of the reference window free of SCREEN_ZONES for a word `bw` x `bh` (CSS px), the upper middle first (`turn` 0..2 rotates the
    order by the word's seed: two unlocated words of one moment start at different spots) */
export function refScreenSpot(bw, bh, turn = 0) {
  const F = [[0.5, 0.2], [0.36, 0.24], [0.64, 0.24], [0.5, 0.32], [0.28, 0.4], [0.72, 0.4], [0.5, 0.7]];
  const k = clamp(Math.floor(turn), 0, F.length - 1), order = [...F.slice(k), ...F.slice(0, k)];
  let best = null;
  for ( const [fx, fy] of order ) {
    const x = fx * REF_VW, y = fy * REF_VH, b = { x0: x - bw / 2, y0: y - bh / 2, x1: x + bw / 2, y1: y + bh / 2 };
    const hit = SCREEN_ZONES.reduce((s, u) => s + inter(b, u), 0);
    if ( !best || hit < best.hit ) best = { x, y, hit };
    if ( !hit ) break;
  }
  return { x: best.x, y: best.y };
}
/**
 * THUNDERFIT + MAPSFXSEAT: an unlocated word laid out ONCE in the reference window (the same for every seat), by its real box: `hold`
 * { w, h } and `reach` { l, r, u, d } in units of its cap height (the engine's L.measure; null: the old factor of its entrance
 * `stageIn`), `cap` its cap height (CSS px). As big as it is but never bigger than the window (sfx-fit viewFit), at its spot - the edge
 * toward the strike (`fixed` { fx, fy }) or a free spot of the upper middle - when it is clean there (whole reach inside the window, box
 * off SCREEN_ZONES), else the nearest clean spot, else a little smaller where it fits (sfx-fit screenFit).
 * -> { x, y, k (share of its size), cap, hit, box, reach } in reference-window CSS px | null.
 */
export function screenLayout({ hold, reach = null, cap, fixed = null, turn = 0, stageIn = null }) {
  const b = FIT.wordBox(hold, cap);
  if ( !(b.bw > 0) ) return null;
  const W = REF_VW, H = REF_VH;
  const rk = reach ? FIT.reachFactor(hold, reach) : FIT.reachOf(stageIn), kv = FIT.viewFit(b.bw * rk, b.bh * rk, W, H);
  const fw = b.bw * kv * 0.5 + 16, fh = b.bh * kv * 0.75 + 16;
  const today = fixed ? { x: Math.min(Math.max(fixed.fx * W, fw), Math.max(fw, W - fw)), y: Math.min(Math.max(fixed.fy * H, fh), Math.max(fh, H - fh)) } : refScreenSpot(b.bw * kv, b.bh * kv, turn);
  const want = fixed ? refSpot(fixed.fx, fixed.fy) : today;
  const r = FIT.screenFit({ today: kv >= 1 ? today : null, want, bw: b.bw * kv, bh: b.bh * kv, rk, view: { x0: 0, y0: 0, x1: W, y1: H }, ui: SCREEN_ZONES });
  const k = kv * r.k, c = cap * k, w2 = b.bw * k / 2, h2 = b.bh * k / 2;
  const box = { x0: r.x - w2, y0: r.y - h2, x1: r.x + w2, y1: r.y + h2 };
  const rb = reach ? { x0: Math.min(box.x0, r.x - reach.l * c), y0: Math.min(box.y0, r.y - reach.u * c), x1: Math.max(box.x1, r.x + reach.r * c), y1: Math.max(box.y1, r.y + reach.d * c) } : scaleAt(box, rk, r.x, r.y);
  return { x: r.x, y: r.y, k, cap: c, hit: r.hit, box, reach: rb };
}
/** A seat's drawing of a laid-out unlocated word (`ref`: screenLayout): the reference window centred in its window W x H, its own size
    setting `scale`, then the seat rule (seatFit: off its `panels`, whole in its window, smaller only when its reach is bigger than the
    window). -> { at (CSS px of this window), k (size factor on the table's size), fit } */
export function seatScreen(ref, { W, H, panels = [], scale = 1 }) {
  const off = screenOffset(W, H), cx = ref.x + off.x, cy = ref.y + off.y;
  const mv = (b) => scaleAt({ x0: b.x0 + off.x, y0: b.y0 + off.y, x1: b.x1 + off.x, y1: b.y1 + off.y }, scale, cx, cy);
  const f = seatFit({ box: mv(ref.box), reach: mv(ref.reach), view: { x0: 0, y0: 0, x1: W, y1: H }, panels, zoom: 1, cap: ref.cap * scale });
  return { at: { x: cx + f.dx, y: cy + f.dy }, k: f.k, fit: f };
}

/* ---------------------------------------------------------------- the ground under a firing, shared */

/**
 * The ground material at a firing's impact from the map's own pixels (RGBA of a box round it; every seat reads the same map): the same
 * rule as the destruction layer's bake (scripts/destruction/core.mjs classify), so a page's debris words are written for the ground the
 * crater will show - and written at once, on every seat alike (before, the ground was taken from the first damage area to ENTER on this
 * seat: a seat still applying the destruction wrote "earth" debris, another "stone": other words). -> a MATS name of sfx-core.
 */
export function groundOfPixels(px, W) {
  const n0 = Math.floor((px?.length ?? 0) / 4);
  if ( !n0 || !(W > 0) ) return "auto";
  let n = 0, sr = 0, sg = 0, sb = 0, hx = 0, hy = 0, ssat = 0, sl = 0, sl2 = 0, gx = 0, gy = 0;
  const lum = (o) => 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
  const step = Math.max(1, Math.floor(n0 / 4000));
  for ( let i = 0; i < n0; i += step ) {
    const o = i * 4, [h, s, l] = hsl(px[o], px[o + 1], px[o + 2]);
    sr += px[o]; sg += px[o + 1]; sb += px[o + 2]; ssat += s; sl += l; sl2 += l * l;
    hx += Math.cos((h * Math.PI) / 180) * s; hy += Math.sin((h * Math.PI) / 180) * s;
    if ( (i % W) + 1 < W ) gx += Math.abs(lum(o + 4) - lum(o));
    if ( i + W < n0 ) gy += Math.abs(lum(o + W * 4) - lum(o));
    n++;
  }
  const hue = (((Math.atan2(hy, hx) * 180) / Math.PI) + 360) % 360, sat = ssat / n, l = sl / n;
  const tex = Math.sqrt(Math.max(0, sl2 / n - l * l)), aniso = Math.abs(gx - gy) / Math.max(1, gx + gy);
  if ( hue >= 175 && hue <= 255 && sat > 0.2 && l > 0.12 && l < 0.75 ) return "water";
  if ( l > 0.74 && sat < 0.16 ) return "snow";
  if ( sat < 0.13 ) return tex < 0.045 && l < 0.6 ? "metal" : "stone";
  if ( hue >= 65 && hue < 175 && sat > 0.15 ) return "grass";
  if ( hue >= 32 && hue < 65 && sat > 0.2 && l > 0.52 ) return "sand";
  if ( hue >= 8 && hue < 50 && sat > 0.22 && aniso > 0.16 ) return "wood";
  if ( sat < 0.2 ) return "stone";
  return "earth";
}
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if ( mx === mn ) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/* ---------------------------------------------------------------- what every seat counts as an obstacle */

/** a token every seat counts (its document not hidden; the GM's hidden tokens are no obstacle on any seat, so nothing of them shows in
    anyone's picture): its box from the document (scene px), whatever this seat's vision shows */
export function sharedTokenBox(doc, grid = 100) {
  if ( !doc || doc.hidden ) return null;
  const w = (Number(doc.width) || 1) * grid, h = (Number(doc.height) || 1) * grid, x = Number(doc.x) || 0, y = Number(doc.y) || 0;
  return { x0: x, y0: y, x1: x + w, y1: y + h };
}
/** is a note pin one every player may see (then it is an obstacle on every seat; a pin of a page some player may not open is none on
    any seat, so nothing of it shows in a player's placement)? `perm(user)` -> that user may see the note's page or entry */
export const sharedPin = (players, perm) => players.every((u) => { try { return perm(u) !== false; } catch { return false; } });

/** a stable sort key of a play call for the per-seat logs and the checks: what must be equal on every seat */
export function callKey(c) {
  const r = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : v);
  return JSON.stringify([c.text, c.seed ?? null, r(c.size), c.at ? [r(c.at.x), r(c.at.y)] : null, r(c.t), c.space ?? null]);
}
