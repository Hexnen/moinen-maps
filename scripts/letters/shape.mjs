/* LETR: the outlines of one picture of a plan, in word units (cap height 1). Pure. */
import { resample, jag, rough, boil, drips, flames, bbox, crackLines, strokeQuads, bolden } from "./geom.mjs";
import { envelope, RING_W, INV_TUNE } from "./design.mjs";
import { rng } from "./rng.mjs";
import { area } from "./font.mjs";
import { makeReader } from "./legibility.mjs";

const STEP = 0.032;

/* letter outlines after the hand's treatment; `seed` re-rolls treatments that live (flames, sparks of jagged edges) */
export function treatLetter(gl, hand, sound, seed, i, k = 1) {
  const R = rng((seed ^ (i * 2654435761)) >>> 0);
  let cs = gl.contours.map((c) => resample(c, STEP));
  const extra = [];
  switch ( hand.treat ) {
    case "jag": {
      /* LOOK: shards, not fur: fewer, longer spikes on the outer edge; counters (holes) only nicked, so they stay open */
      const big = cs.reduce((a, c) => (Math.abs(area(c)) > Math.abs(area(a)) ? c : a), cs[0] ?? []), sg = Math.sign(area(big));
      cs = cs.map((c) => jag(c, (0.045 + 0.04 * sound.sharp) * k * (Math.sign(area(c)) === sg ? 1 : 0.3), 8, R));
      break;
    }
    case "rough": cs = cs.map((c, j) => rough(c, (0.016 + 0.018 * sound.rough) * k, 2.2, (seed + i * 31 + j) | 0)); break;
    case "drip": extra.push(...drips(cs, R, 0.75 * k, (0.32 + 0.25 * sound.long) * k)); cs = cs.map((c, j) => rough(c, 0.012 * k, 2, (seed + j) | 0)); break;
    case "flame": cs = cs.map((c, j) => rough(c, 0.02 * k, 2.5, (seed + i * 7 + j) | 0)); extra.push(...flames(cs, R, k, (0.35 + 0.3 * sound.long) * k, (seed % 100) / 10)); break;
    default: break;
  }
  return cs.concat(extra);
}

/* LOOK: a treated letter that no longer reads as itself (legibility.mjs) is treated again, weaker, until it does: the word stays readable
   whatever the hand. Deterministic (geometry only), so every client tames the same letters the same way. */
const STEPS = [1, 0.6, 0.3, 0];
export function treatReadable(gl, ch, font, hand, sound, seed, i, bank) {
  if ( hand.treat === "plain" || hand.treat === "bubble" || hand.legible === false || !bank ) return treatLetter(gl, hand, sound, seed, i);
  const reader = (bank._reader ??= makeReader(bank));
  let cs = null;
  for ( const k of STEPS ) {
    cs = treatLetter(gl, hand, sound, seed, i, k);
    if ( k === 0 || reader.read(gl.font ?? font, ch, cs).ok ) break;
  }
  return cs;
}

/* LOOK: a linked round letter is drawn as a true ring (KA-THOOM's interlocked OO): a circle as wide as RING_W, its stroke as heavy as
   the font's own O (from its area), wound like the font's outlines */
export function ringGlyph(font, bank) {
  const key = `ring#${font}`;
  if ( bank.cache.has(key) ) return bank.cache.get(key);
  const o = bank.glyph(font, "O"), cs = o.contours ?? [];
  const big = cs.reduce((a, c) => (Math.abs(area(c)) > Math.abs(area(a)) ? c : a), cs[0] ?? [0, 0, 1, 0, 1, -1]);
  const ink = Math.abs(cs.reduce((a, c) => a + area(c), 0)), b = bbox(cs), ow = Math.max(0.3, b.x1 - b.x0);
  /* stroke t of a ring of the O's box with the O's ink: ink ~ perimeter * t */
  const t = Math.max(0.1, Math.min(0.17, 0.85 * ink / (Math.PI * (ow + 1) / 2)));   // rings a shade lighter than the letters (the reference)
  const rx = RING_W / 2, ry = 0.5, cx = RING_W / 2, cy = -0.5, N = 56, sg = Math.sign(area(big)) || 1;
  const ell = (ax, ay, dir) => { const c = []; for ( let k = 0; k < N; k++ ) { const a = dir * k * 2 * Math.PI / N; c.push(cx + ax * Math.cos(a), cy + ay * Math.sin(a)); } return c; };
  let outer = ell(rx, ry, 1), inner = ell(rx - t, ry - t, -1);
  if ( Math.sign(area(outer)) !== sg ) { outer = ell(rx, ry, -1); inner = ell(rx - t, ry - t, 1); }
  const g = { adv: RING_W, contours: [outer, inner], font: o.font ?? font, ring: true };
  bank.cache.set(key, g);
  return g;
}

/* LOOK2 (SPEC-LOOK P10, the owner: «bardziej połączone artystyczne OO»): the book's interlocked O is the face's OWN O (a tall oval or
   stadium, the same stroke weight as every letter), widened at its middle only (its sides keep their curve and weight) until its
   counter can hold the neighbour's stroke with clear air on both sides: width >= 3 strokes + 2 gaps. `link` = how far the next
   ring's left edge stands from this one's (stroke + gap), so the strokes cross with even air around them. */
export function ovalRing(font, bank) {
  const key = `oval#${font}`;
  if ( bank.cache.has(key) ) return bank.cache.get(key);
  const o = bank.glyph(font, "O"), cs = o.contours ?? [];
  const big = cs.reduce((a, c) => (Math.abs(area(c)) > Math.abs(area(a)) ? c : a), cs[0] ?? [0, 0, 1, 0, 1, -1]);
  const b = bbox(cs), holes = cs.filter((c) => c !== big && Math.sign(area(c)) !== Math.sign(area(big)));
  const hb = holes.length ? bbox(holes) : { x0: b.x0 + 0.15, x1: b.x1 - 0.15 };
  const ow = b.x1 - b.x0, t = Math.max(0.06, (ow - (hb.x1 - hb.x0)) / 2), gap = Math.max(0.06, 0.5 * t);
  const D = Math.max(0, 3 * t + 2 * gap - ow), cx = (b.x0 + b.x1) / 2;
  const contours = cs.map((c) => { const q = c.slice(); for ( let k = 0; k < q.length; k += 2 ) if ( q[k] > cx ) q[k] += D; return q; });
  const g = { adv: o.adv + D, contours, font: o.font ?? font, ring: true, link: t + gap, stroke: t, gap };
  bank.cache.set(key, g);
  return g;
}

/* LOOK2 (SPEC-LOOK P18, the owner: «odstępy ... za duże, ale to zależy od litery»): optical spacing, pair by pair. Each pair is set
   by the white between the two SHAPES (not their advance boxes) over the height they share: the mean gap, counting at most
   KERN.open cap heights of air per row (so T-A, A-V, L-T tuck in and round pairs sit closest), equals the hand's gap, and no row
   comes closer than KERN.touch (letters may just touch: the word's one keyline closes such joins). The last prefix letter is
   overlapped by the first body letter (P7); a ring stands at its link distance from the ring it holds (P10); a run of one letter
   keeps one, slightly tighter rhythm. Sizes, the baseline and the prefix are already set (layoutPlan); the words of a line keep
   their word gap. Deterministic, pure. */
export const KERN = { rows: 40, open: 0.12, touch: -0.02, preOverlap: 0.015, same: 0.85 };
function rowExtents(cs, ys) {
  const mn = ys.map(() => Infinity), mx = ys.map(() => -Infinity);
  for ( const c of cs ) for ( let i = 0, n = c.length; i < n; i += 2 ) {
    const j = (i + 2) % n, x1 = c[i], y1 = c[i + 1], x2 = c[j], y2 = c[j + 1];
    if ( y1 === y2 ) continue;
    const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
    for ( let k = 0; k < ys.length; k++ ) { const y = ys[k]; if ( y < lo || y >= hi ) continue; const x = x1 + (y - y1) * (x2 - x1) / (y2 - y1); if ( x < mn[k] ) mn[k] = x; if ( x > mx[k] ) mx[k] = x; }
  }
  return { mn, mx };
}
/* letter i's outline placed in the line (before the envelope), its advance box starting at x */
export function placedShape(plan, bank, i, x = 0) {
  const L = plan.layout.letters[i], base = baseGeometry(plan, bank)[i];
  if ( !base?.gl || L.skip ) return null;
  const s = L.s, c = Math.cos(L.rot), sn = Math.sin(L.rot), px = base.gl.adv / 2, py = -0.5, tx = x + L.w / 2, ty = -0.5 + L.dy;
  return mapCs(base.cs, (X, Y) => [(X - px) * s * c - (Y - py) * s * sn + tx, (X - px) * s * sn + (Y - py) * s * c + ty]);
}
/* the gap per row of the height two placed shapes share (null where one of them has no ink on that row) */
export function pairGaps(a, b, rows = KERN.rows) {
  const ba = bbox(a), bb = bbox(b), y0 = Math.max(ba.y0, bb.y0), y1 = Math.min(ba.y1, bb.y1);
  if ( y1 - y0 < 1e-3 ) return { rows: [], y0, y1 };
  const ys = []; for ( let k = 0; k < rows; k++ ) ys.push(y0 + (y1 - y0) * (k + 0.5) / rows);
  const ea = rowExtents(a, ys), eb = rowExtents(b, ys);
  return { rows: ys.map((y, k) => (Number.isFinite(ea.mx[k]) && Number.isFinite(eb.mn[k]) ? eb.mn[k] - ea.mx[k] : null)), y0, y1 };
}
/* FONTSEL: the optical offset of `me` (placed at 0) after `a`: the mean gap over the rows they share (at most `open` of air a row)
   equals G, never closer than a touch */
function opticalX(a, me, h, G) {
  const g = pairGaps(a, me), live = g.rows.filter((d) => d != null);
  if ( !live.length ) return bbox(a).x1 - bbox(me).x0 + G;
  const need = Math.max(...live.map((d) => -d)), open = KERN.open * h;
  const f = (x) => g.rows.reduce((acc, d) => acc + (d == null ? open : Math.min(open, d + x)), 0) / g.rows.length;
  let lo = need - open, hi = need + open;
  for ( let it = 0; it < 32; it++ ) { const m = (lo + hi) / 2; if ( f(m) < G ) lo = m; else hi = m; }
  return Math.max((lo + hi) / 2, need + KERN.touch * h);
}
/* FONTSEL (INV_TUNE markKern): in the vertical column a row's "!" / "?" stands at the optical gap from its letter; the advance boxes
   left League Gothic's mark hanging away from the last letter (its K and ! carry wide side bearings) */
function kernColumnMarks(plan, bank) {
  const H = plan.hand, lay = plan.layout, Ls = lay.letters, chars = plan.chars, base = baseGeometry(plan, bank);
  for ( const ln of lay.lines ?? [] ) for ( let i = ln.from + 1; i <= ln.to; i++ ) {
    if ( !/[!?]/u.test(chars[i]) || Ls[i].skip || !base[i].gl || !base[i - 1].gl || Ls[i - 1].skip ) continue;
    const a = placedShape(plan, bank, i - 1, Ls[i - 1].x), me = placedShape(plan, bank, i, 0);
    if ( !a || !me ) continue;
    const h = Math.min(Ls[i - 1].s, Ls[i].s);
    Ls[i].x = opticalX(a, me, h, H.kern.gap * h);
  }
}
export function kernOptical(plan, bank) {
  const H = plan.hand, lay = plan.layout, Ls = lay.letters, chars = plan.chars;
  if ( H.kern && lay.arrange === "vertical" && !lay._kerned && H.style === "invincible" && INV_TUNE[H.font]?.markKern ) {
    Object.defineProperty(lay, "_kerned", { value: true, enumerable: false, configurable: true });
    kernColumnMarks(plan, bank);
    return;
  }
  if ( !H.kern || lay.arrange === "vertical" || lay._kerned ) return;
  Object.defineProperty(lay, "_kerned", { value: true, enumerable: false, configurable: true });
  const base = baseGeometry(plan, bank), pre = lay.pre ?? 0;
  for ( let i = 0; i < Ls.length; i++ ) if ( base[i].ring && base[i].gl ) Ls[i].w = base[i].gl.adv * Ls[i].s;
  const lines = lay.lines ?? [{ from: 0, to: Ls.length - 1 }];
  const old = Ls.map((l) => l.x);
  for ( const line of lines ) {
    let prev = -1;
    for ( let i = line.from; i <= line.to; i++ ) {
      const me = base[i].gl && !Ls[i].skip ? placedShape(plan, bank, i, 0) : null;
      if ( !me ) { if ( prev >= 0 ) Ls[i].x = Ls[prev].x + (old[i] - old[prev]); continue; }
      if ( prev < 0 ) { prev = i; continue; }
      const spaced = chars.slice(prev + 1, i).some((c) => c === " " || c === "\n");
      if ( spaced ) { Ls[i].x = Ls[prev].x + (old[i] - old[prev]); prev = i; continue; }
      const a = placedShape(plan, bank, prev, Ls[prev].x), h = Math.min(Ls[prev].s, Ls[i].s);
      let X;
      if ( Ls[i].link === prev && base[i].gl.link ) X = bbox(a).x0 + base[prev].gl.link * Ls[prev].s - bbox(me).x0;
      else {
        const g = pairGaps(a, me), live = g.rows.filter((d) => d != null);
        if ( !live.length ) X = bbox(a).x1 - bbox(me).x0 + H.kern.gap * h;
        else {
          const need = Math.max(...live.map((d) => -d));   // the offset at which the closest row just touches
          if ( pre && i === pre ) X = need - KERN.preOverlap * Ls[i].s;
          else {
            const G = H.kern.gap * h * (chars[i] === chars[prev] ? KERN.same : 1), open = KERN.open * h;
            const f = (x) => g.rows.reduce((acc, d) => acc + (d == null ? open : Math.min(open, d + x)), 0) / g.rows.length;
            let lo = need - open, hi = need + open;
            for ( let it = 0; it < 32; it++ ) { const m = (lo + hi) / 2; if ( f(m) < G ) lo = m; else hi = m; }
            X = Math.max((lo + hi) / 2, need + KERN.touch * h);
          }
        }
      }
      Ls[i].x = X; prev = i;
    }
  }
  /* the block: stacked lines centred again on the widest line */
  const right = (ln) => Math.max(...Ls.slice(ln.from, ln.to + 1).map((l) => l.x + l.w));
  if ( lay.lines && lay.arrange === "stack" ) {
    const ws = lay.lines.map((ln) => right(ln) - Ls[ln.from].x), W = Math.max(...ws);
    lay.lines.forEach((ln, k) => { const off = (W - ws[k]) / 2 - Ls[ln.from].x; for ( let i = ln.from; i <= ln.to; i++ ) Ls[i].x += off; ln.w = ws[k]; });
  }
  const W = Math.max(0.3, ...Ls.map((l) => l.x + l.w));
  lay.W = W; lay.E.W = W; plan._env = null;
}

/* base geometry cache per plan: glyph per letter and treated outlines for the plan's own seed */
export function baseGeometry(plan, bank) {
  if ( plan._base ) return plan._base;
  const base = plan.chars.map((ch, i) => {
    if ( ch === " " || ch === "\n" || plan.layout.letters[i]?.skip ) return { gl: null, cs: [] };   // FXLE F12: a line break has no glyph (LOOK2: nor a hyphen a column drops)
    const font = plan.layout.letters[i]?.font ?? plan.hand.font;
    if ( plan.layout.letters[i]?.ring ) { const gl = plan.hand.style === "invincible" ? ovalRing(font, bank) : ringGlyph(font, bank); return { gl, cs: gl.contours, ring: true }; }
    const gl = bank.glyph(font, plan.layout.letters[i]?.glyph ?? ch);   // FONTSEL: a number's sign may be the face's minus
    return { gl, cs: treatReadable(gl, ch, font, plan.hand, plan.sound, plan.seed, i, bank) };
  });
  Object.defineProperty(plan, "_base", { value: base, enumerable: false, configurable: true });
  return base;
}

/* LOOK: the word must read as it is shown. Each letter is read upright, as placed in the hold picture (its lean and the envelope
   included: a Z leaning 15 degrees is an L to a reader), minus what lies in front of it (the neighbour that overlaps it, with that
   neighbour's outlines; ink cracks drawn across it). A letter that stops reading leans less and, when it is covered, pushes its
   pair apart a little, until it reads; the line closes up after it. Pure and deterministic: it only changes the plan's own layout. */
export const CRACK_W = 0.03;   // ink crack width, in parts of the letter's height (paint.mjs draws them the same)
export const crackSeed = (plan, i) => (plan.seed ^ (i + 7) * 40503) >>> 0;
/* a letter's place in the line (before the envelope): glyph -> line, and line -> the letter's own frame for reading: its size and
   place taken off, part of its lean kept. The lean is the letter's own plus the envelope's turn where it stands (an arc, a tumble,
   the word's tilt); a reader turns a leaning letter back in the mind by half, never by more than about 17 degrees: a Z leaning hard
   reads as an L, a D at 40 degrees as a C */
const READ_TURN = 0.3;   // radians a reader straightens a letter by, at most
export const leanOf = (plan, L) => {
  const env = plan._env ?? Object.defineProperty(plan, "_env", { value: envelope(plan.layout.E), enumerable: false, configurable: true, writable: true })._env;
  const tx = L.x + L.w / 2, ty = -0.5 + L.dy, d = Math.max(0.02, L.w / 2), a = env(tx - d, ty), b = env(tx + d, ty);
  return L.rot + Math.atan2(b[1] - a[1], b[0] - a[0]);
};
const keptLean = (t) => Math.sign(t) * Math.max(Math.abs(t) / 2, Math.abs(t) - READ_TURN);
const placeOf = (L, gl, total = L.rot) => {
  const s = L.s, c = Math.cos(L.rot), sn = Math.sin(L.rot), tx = L.x + L.w / 2, ty = -0.5 + L.dy, px = gl.adv / 2, py = -0.5;
  const u = L.rot - keptLean(total), ch = Math.cos(-u), shh = Math.sin(-u);
  return {
    fwd: (x, y) => [(x - px) * s * c - (y - py) * s * sn + tx, (x - px) * s * sn + (y - py) * s * c + ty],
    upright: (X, Y) => { const dx = (X - tx) / s, dy = (Y - ty) / s; return [px + dx * ch - dy * shh, py + dx * shh + dy * ch]; }
  };
};
const mapCs = (cs, f) => cs.map((c) => { const o = new Array(c.length); for ( let k = 0; k < c.length; k += 2 ) { const q = f(c[k], c[k + 1]); o[k] = q[0]; o[k + 1] = q[1]; } return o; });
const LEAN_FREE = 8 * Math.PI / 180;   // a lone letter leaning less than this was already read when it was treated
export function occlusionReport(plan, bank, only = null) {
  const H = plan.hand, Ls = plan.layout.letters, reader = (bank._reader ??= makeReader(bank)), base = baseGeometry(plan, bank);
  const outer = H.inflate + H.inkW + H.out2W;
  const out = [];
  for ( let i = 0; i < Ls.length; i++ ) {
    if ( only && !only.has(i) ) continue;
    const ch = plan.chars[i]; if ( !base[i].gl || base[i].ring || !reader.knows(ch) ) continue;   // a ring is an O to anyone
    const lean = leanOf(plan, Ls[i]), Pi = placeOf(Ls[i], base[i].gl, lean), cut = [];
    const me = mapCs(mapCs(base[i].cs, Pi.fwd), Pi.upright), mb = bbox(me);
    for ( const j of [i - 1, i + 1] ) {
      if ( j < 0 || j >= Ls.length || !base[j].gl ) continue;
      if ( !(H.stack === "merge" || (H.order === "right" ? j > i : j < i)) ) continue;
      if ( Ls[i].link === j || Ls[j].link === i ) continue;   // interlocked rings cross, they do not hide each other
      const Pj = placeOf(Ls[j], base[j].gl);
      /* stacked letters: the one in front covers with its outlines; merged ones flow into each other (no line between them) */
      /* LOOK3: the union keyline (invincible) draws no outline across a neighbour (only a hairline where they truly overlap), so the
         neighbour covers with its bare shape: counting a keyline width there read a touching W as covering the H's stem (H -> N) and
         pushed the last letter away ("CRUS H!") */
      const grow = H.stack === "merge" || H.keyline === "union" ? 0 : outer / Ls[i].s, cs = mapCs(mapCs(base[j].cs, Pj.fwd), Pi.upright), b = bbox(cs);
      if ( b.x1 + grow < mb.x0 || b.x0 - grow > mb.x1 || b.y1 + grow < mb.y0 || b.y0 - grow > mb.y1 ) continue;   // not touching
      cut.push({ cs, grow });
    }
    const covered = cut.length > 0;
    if ( H.tex === "cracks" ) cut.push({ cs: strokeQuads(crackLines(me, crackSeed(plan, i), H.crackN ?? 2), CRACK_W), grow: 0 });
    if ( !cut.length && Math.abs(lean) < LEAN_FREE ) { out.push({ i, ch, self: 1, other: 0, as: ch, ok: true, covered }); continue; }
    const r = reader.read(base[i].gl.font ?? H.font, ch, me, cut);
    out.push({ i, ch, ...r, covered, lean });
  }
  return out;
}
const UNION_PART = 0.04;   // LOOK3: the most a union-keyline pair parts for the reader, in cap heights of the letter (a touch, never a hole)
export function settleOcclusion(plan, bank) {
  const Ls = plan.layout.letters, lines = plan.layout.lines ?? [{ from: 0, to: Ls.length - 1 }];
  const state = new Map();
  let only = null;
  const opened = new Map();   // line -> how much its tracking was opened evenly
  for ( let round = 0; round < 14; round++ ) {
    for ( const r of occlusionReport(plan, bank, only) ) state.set(r.i, r);
    const bad = [...state.values()].filter((r) => !r.ok);
    if ( !bad.length ) break;
    let changed = false;
    if ( plan.hand.tex === "cracks" && (plan.hand.crackN ?? 2) > 1 && round >= 2 ) { plan.hand.crackN = 1; changed = true; }
    /* merged letters that hide each other are drawn as stacked stickers instead (each keeps its outline) */
    if ( plan.hand.stack === "merge" && bad.some((b) => b.covered) ) { plan.hand.stack = "stack"; only = null; continue; }
    const dirty = new Set(), open = new Set();
    for ( const b of bad ) {
      const L = Ls[b.i];
      dirty.add(b.i - 1).add(b.i).add(b.i + 1);
      if ( Math.abs(b.lean) > 0.07 ) { L.rot -= 0.6 * b.lean; changed = true; if ( round < 3 ) continue; }   // first lean less (against the envelope's turn too)
      if ( !b.covered ) continue;
      /* then part the pair a little, at most a fifth of a cap height in all: never a gap in the word */
      const line = lines.find((l) => b.i >= l.from && b.i <= l.to) ?? lines[0];
      const from = Math.max(line.from + 1, b.i + (plan.hand.order === "right" ? 1 : 0));
      if ( from > line.to ) continue;
      let d = 0.03 * Math.min(L.s, Ls[Math.max(line.from, from - 1)].s);
      /* LOOK3: in the union-keyline hand (invincible) the optical spacing lets a pair just touch; when that touch hides a stroke
         (a W's arm on an H's stem reads N) the pair parts by exactly its overlap, so it no longer touches: steps of 0.03 cap opened
         a visible hole before the last letter ("CRUS H!", "SMAS H!"). The prefix tuck keeps the old steps. */
      if ( plan.hand.keyline === "union" && from !== (plan.layout.pre ?? 0) && !Ls[from].link && Ls[from - 1] && !Ls[from - 1].skip ) {
        const a = placedShape(plan, bank, from - 1, Ls[from - 1].x), c = placedShape(plan, bank, from, Ls[from].x);
        const live = a && c ? pairGaps(a, c).rows.filter((v) => v != null) : [];
        if ( !live.length ) continue;
        const over = -Math.min(...live);
        if ( (Ls[from].pushed ?? 0) >= UNION_PART * L.s ) continue;   // parted as far as a touch may: the letter reads as the eye does
        d = Math.min(UNION_PART * L.s - (Ls[from].pushed ?? 0), over > 0.008 * L.s ? 0.5 * over : 0.008 * L.s);   // small steps: only as far as the reader needs
      }
      if ( (Ls[from].pushed ?? 0) + d > 0.2 * L.s ) { open.add(line); continue; }
      Ls[from].pushed = (Ls[from].pushed ?? 0) + d;
      for ( let k = from; k <= line.to; k++ ) Ls[k].x += d;
      changed = true;
    }
    /* a pair that cannot part further without a gap: the whole line opens its tracking evenly instead (a looser word, never a hole),
       by at most an eighth of a cap height per letter */
    for ( const line of open ) {
      const sAvg = Ls.slice(line.from, line.to + 1).reduce((a, l) => a + l.s, 0) / (line.to - line.from + 1), step = 0.02 * sAvg;
      if ( (opened.get(line) ?? 0) + step > 0.125 * sAvg ) continue;
      opened.set(line, (opened.get(line) ?? 0) + step);
      for ( let k = line.from + 1; k <= line.to; k++ ) Ls[k].x += step * (k - line.from);
      for ( let k = line.from; k <= line.to; k++ ) dirty.add(k);
      changed = true;
    }
    if ( !changed ) break;
    only = dirty;
    const W = Math.max(0.3, ...Ls.map((l) => l.x + l.w));
    if ( W > plan.layout.W ) { plan.layout.W = W; plan.layout.E.W = W; plan._env = null; }
  }
  return [...state.values()].sort((a, b) => a.i - b.i);
}

/* KERNEX (1.9.8): punctuation never reads as a diacritic of a letter. In Polish a mark at a letter changes the letter (E + a dot fused
   under its foot = Ę, L + a hyphen into its stem = Ł, a dot over a Z = Ż). The optical spacing (kernOptical) sets a mark like a letter:
   it counts the mark's empty rows (between the bar and the dot of "!") and the letter's open counters as air, so the mark slides in
   until its closest row touches (KERN.touch even overlaps), and the union keyline then makes the touching mark part of the letter:
   "ZBURZENIE!" read "ZBURZENIĘ!". The rule, measured on the hold picture in each letter's own frame (lean and envelope included):
   beside the letter (rows within its height, `band` either side) a mark keeps at least the hand's own gap from the letter's ink row
   by row (it may still tuck into an open side: V. T! L!); above or below the letter (up to `dz` cap heights away) it keeps that gap
   from the letter's whole width (nothing hangs under a foot or sits over a top). A mark that comes closer is moved away along the
   line (with everything after it), never the other way: the setting stays as tight as the rule allows. Marks = ! ? . , : ; and the
   hyphen / minus; the tucked lead-in's hyphen under the first body letter (the owner's prefix, LOOK2 P7) and mark-to-mark pairs ("!!")
   keep their setting. The invincible style only (the legacy styles are frozen). Deterministic, pure. */
export const MARK = { re: /[!?.,:;\-−…]/u, rows: 48, band: 0.03, dz: 0.3, rounds: 6, px: 1.5 };
export const isMark = (ch) => MARK.re.test(ch ?? "");
const isInk = (ch) => /[\p{L}\p{N}]/u.test(ch ?? "");
/* the clearance between mark m and letter j in the hold picture: the smallest gap (word units) on the mark's `side` of the letter
   (+1: the mark stands right of it, -1: left), over the rows the rule constrains; Infinity when no row is constrained */
export function markGap(plan, bank, geo, j, m, side) {
  const Ls = plan.layout.letters, h = Ls[j].s, lean = leanOf(plan, Ls[j]), c = Math.cos(-lean), s = Math.sin(-lean);
  const turn = (cs) => mapCs(cs, (x, y) => [x * c - y * s, x * s + y * c]);
  const A = turn(geo.get(j)), M = turn(geo.get(m)), ba = bbox(A), bm = bbox(M), band = MARK.band * h, dz = MARK.dz * h;
  /* rows: an even comb plus every corner height of either outline (the closest point of two polygons lies on a corner's row), just
     inside each corner so a horizontal edge counts */
  const ys = []; for ( let k = 0; k < MARK.rows; k++ ) ys.push(bm.y0 + (bm.y1 - bm.y0) * (k + 0.5) / MARK.rows);
  for ( const cs of [M, A] ) for ( const c of cs ) for ( let k = 1; k < c.length; k += 2 ) for ( const y of [c[k] - 1e-7, c[k] + 1e-7] ) if ( y > bm.y0 && y < bm.y1 ) ys.push(y);
  const em = rowExtents(M, ys);
  const inside = ys.map((y) => Math.max(ba.y0 + 1e-6, Math.min(ba.y1 - 1e-6, y)));
  const ea = rowExtents(A, inside);
  let min = Infinity;
  for ( let k = 0; k < ys.length; k++ ) {
    if ( !Number.isFinite(em.mn[k]) ) continue;
    const out = Math.max(0, ba.y0 - ys[k], ys[k] - ba.y1);
    if ( out >= dz ) continue;
    let edge;
    if ( out <= band ) { if ( !Number.isFinite(ea.mn[k]) ) continue; edge = side > 0 ? ea.mx[k] : ea.mn[k]; }
    else edge = side > 0 ? ba.x1 : ba.x0;
    const g = side > 0 ? em.mn[k] - edge : edge - em.mx[k];
    if ( g < min ) min = g;
  }
  return min;
}
const holdGeo = (plan, bank) => new Map(pictureGeometry(plan, bank, { ...plan.timeline.hold[0], g: { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 }, boil: 0, reseed: false }).map((l) => [l.i, l.cs]));
/* the pairs the rule holds: [letter, mark, side, index that moves] */
export function markPairs(plan) {
  const Ls = plan.layout.letters, chars = plan.chars, n = chars.length, pre = plan.layout.pre ?? 0, out = [];
  const live = (i) => i >= 0 && i < n && !Ls[i].skip && chars[i] !== " " && chars[i] !== "\n";
  const vertical = plan.layout.arrange === "vertical";
  const lines = plan.layout.lines ?? [{ from: 0, to: n - 1 }];
  for ( let m = 0; m < n; m++ ) {
    if ( !isMark(chars[m]) || !live(m) ) continue;
    if ( vertical ) { for ( let j = 0; j < n; j++ ) if ( live(j) && isInk(chars[j]) ) out.push([j, m, 1, m]); continue; }
    const ln = lines.find((l) => m >= l.from && m <= l.to) ?? lines[0];
    for ( let j = ln.from; j <= ln.to; j++ ) {
      if ( !live(j) || !isInk(chars[j]) ) continue;
      if ( chars.slice(Math.min(j, m) + 1, Math.max(j, m)).some((ch) => ch === " " || ch === "\n") ) continue;   // another word
      if ( pre && m === pre - 1 && j === pre ) continue;   // the tucked lead-in (LOOK2 P7): its hyphen hides under the first body letter
      out.push(j < m ? [j, m, 1, m] : [j, m, -1, j]);
    }
  }
  return out;
}
export function settleMarks(plan, bank) {
  const H = plan.hand, Ls = plan.layout.letters;
  if ( H.style !== "invincible" ) return 0;
  const pairs = markPairs(plan);
  if ( !pairs.length ) return 0;
  const lines = plan.layout.lines ?? [{ from: 0, to: Ls.length - 1 }], vertical = plan.layout.arrange === "vertical";
  const gapOf = (j) => (H.kern?.gap ?? INV_TUNE[H.font]?.gap?.other ?? 0.05) * Ls[j].s;
  let moved = 0;
  for ( let round = 0; round < MARK.rounds; round++ ) {
    /* measure every pair on one picture, then move each moving letter by its pair's largest shortfall (pairs of one mark share it) */
    const geo = holdGeo(plan, bank), need = new Map();
    for ( const [j, m, side, mv] of pairs ) {
      if ( !geo.has(j) || !geo.has(m) ) continue;
      const d = gapOf(j) - markGap(plan, bank, geo, j, m, side);
      if ( d > 1e-5 ) need.set(mv, Math.max(need.get(mv) ?? 0, d));
    }
    if ( !need.size ) break;
    for ( const [mv, d] of [...need].sort((a, b) => a[0] - b[0]) ) {
      const ln = lines.find((l) => mv >= l.from && mv <= l.to) ?? lines[0];
      const to = vertical ? mv : ln.to;   // a column moves the mark alone (it hangs right of the axis)
      for ( let k = mv; k <= to; k++ ) Ls[k].x += d;
      moved += d;
    }
    const W = Math.max(0.3, ...Ls.map((l) => l.x + l.w));
    if ( W > plan.layout.W ) { plan.layout.W = W; plan.layout.E.W = W; }
    plan._env = null;
  }
  return moved;
}

function altGlyph(plan, bank, i, ch) {
  if ( ch === " " ) return null;
  if ( !plan._alt ) Object.defineProperty(plan, "_alt", { value: new Map(), enumerable: false, configurable: true });
  const k = `${i}:${ch}`;
  if ( !plan._alt.has(k) ) { const font = plan.layout.letters[i]?.font ?? plan.hand.font, gl = bank.glyph(font, ch); plan._alt.set(k, gl ? { gl, cs: treatReadable(gl, ch, font, plan.hand, plan.sound, plan.seed, i, bank) } : null); }   // LOOK: read like any letter
  return plan._alt.get(k);
}

/* outlines of picture p: [{ i, cs: [contours], visible }], in word units, word centre at (0,0) of the HOLD layout */
/* FONTSEL: optical sizes of a face for one picture painted at S px per cap height (INV_TUNE[face].small): per letter the extra
   weight `e` (cap heights of the letter, each side) and its bolder outline; a small prefix's scale and the point it grows from (the
   right end of its hyphen, where it tucks under the body, on the body's top line); and the shift that keeps every pair as close as
   planned, no closer: each letter moves by what the PAIR lost at its closest row (a diagonal's mitred edge, a K's arm, included),
   along the line, or down the column for its rows. Null when nothing changes (a big picture, a face without optical sizes, no
   size given, no font bank). */
export function opticalSize(plan, S, gs = 1, bank = null) {
  const os = faceOpticalSize(plan, S, gs, bank);
  return plan.hand.style === "invincible" && S > 0 && bank ? markMinPx(plan, S * gs, bank, os) : os;
}
/* KERNEX: at a small picture the mark's gap (settleMarks: the hand's gap, in cap heights) can shrink under a pixel and the antialiased
   edges join the mark to its letter again (a 26 px "E!" fused its dot to the foot). Below MARK.px pixels at the closest shared row the
   mark moves away by the shortfall, in this picture only (the plan and its checks are unchanged). */
/* the smallest gap between a (left) and b (right) over the rows both have ink in, exact for outlines (a comb plus every corner row) */
function closestRow(a, b) {
  const ba = bbox(a), bb = bbox(b), y0 = Math.max(ba.y0, bb.y0), y1 = Math.min(ba.y1, bb.y1);
  if ( y1 - y0 < 1e-6 ) return Infinity;
  const ys = []; for ( let k = 0; k < KERN.rows; k++ ) ys.push(y0 + (y1 - y0) * (k + 0.5) / KERN.rows);
  for ( const cs of [a, b] ) for ( const c of cs ) for ( let k = 1; k < c.length; k += 2 ) for ( const y of [c[k] - 1e-7, c[k] + 1e-7] ) if ( y > y0 && y < y1 ) ys.push(y);
  const ea = rowExtents(a, ys), eb = rowExtents(b, ys);
  let min = Infinity;
  for ( let k = 0; k < ys.length; k++ ) if ( Number.isFinite(ea.mx[k]) && Number.isFinite(eb.mn[k]) ) min = Math.min(min, eb.mn[k] - ea.mx[k]);
  return min;
}
function markMinPx(plan, px, bank, os) {
  const Ls = plan.layout.letters, n = Ls.length, base = baseGeometry(plan, bank), vertical = plan.layout.arrange === "vertical";
  const pairs = markPairs(plan).filter(([j, m]) => base[j]?.gl && base[m]?.gl);
  if ( !pairs.length ) return os;
  const lines = plan.layout.lines ?? [{ from: 0, to: n - 1 }];
  const add = new Array(n).fill(0);
  const shape = (i) => {
    const L = Ls[i], gl = base[i].gl, cs = os?.bold?.[i] ?? base[i].cs, s = L.s * (i < (os?.pre ?? 0) ? os?.pf ?? 1 : 1), c = Math.cos(L.rot), sn = Math.sin(L.rot);
    let tx = L.x + L.w / 2 + (os?.shift?.[i] ?? 0) + add[i], ty = -0.5 + L.dy;
    return mapCs(cs, (X, Y) => [(X - gl.adv / 2) * s * c - (Y + 0.5) * s * sn + tx, (X - gl.adv / 2) * s * sn + (Y + 0.5) * s * c + ty]);
  };
  let any = false;
  /* the MARK moves (out of the word: a trailing one to the right with what follows it, a leading one to the left with what precedes
     it), so every letter stays where its plan put it */
  for ( const [j, m, side] of pairs.sort((a, b) => (a[2] - b[2]) || (a[2] > 0 ? a[1] - b[1] : b[1] - a[1])) ) {
    const [l, r] = side > 0 ? [j, m] : [m, j];
    const g = closestRow(shape(l), shape(r));
    if ( !Number.isFinite(g) ) continue;
    const d = MARK.px / px - g;
    if ( !(d > 1e-6) ) continue;
    const ln = lines.find((q) => m >= q.from && m <= q.to) ?? lines[0];
    if ( vertical ) add[m] += d;
    else if ( side > 0 ) for ( let k = m; k <= ln.to; k++ ) add[k] += d;
    else for ( let k = ln.from; k <= m; k++ ) add[k] -= d;
    any = true;
  }
  if ( !any ) return os;
  const o = os ?? { e: new Array(n).fill(0), bold: new Array(n).fill(null), shift: new Array(n).fill(0), row: new Array(n).fill(0), pf: 1, pre: plan.layout.pre ?? 0, ax: 0, ay: 0 };
  return { ...o, shift: o.shift.map((v, i) => v + add[i]) };
}
function faceOpticalSize(plan, S, gs = 1, bank = null) {
  const H = plan.hand, tune = H.style === "invincible" ? INV_TUNE[H.font] : null, sm = tune?.small;
  if ( !sm || !(S > 0) || !bank ) return null;
  const Ls = plan.layout.letters, n = Ls.length, pre = plan.layout.pre ?? 0, px = S * gs;
  const base = baseGeometry(plan, bank);
  let pf = 1, ax = 0, ay = 0;
  if ( pre > 0 && pre < n ) {
    pf = Math.max(1, Math.min(sm.preMax, sm.prePx / Math.max(1e-6, px * Ls[0].s)));
    const hy = base[pre - 1]?.gl ? placedShape(plan, bank, pre - 1, Ls[pre - 1].x) : null;
    ax = hy ? bbox(hy).x1 : Ls[pre - 1].x + Ls[pre - 1].w; ay = -0.5 + Ls[0].dy - 0.5 * Ls[0].s;
  }
  const kOf = (i) => (i < pre ? pf : 1);
  const e = Ls.map((L, i) => {
    const s = L.s * kOf(i), stem = tune.stem * s * px;
    return stem >= sm.stemPx ? 0 : Math.min(sm.boldMax, (sm.stemPx - stem) / 2 / (s * px));
  });
  if ( pf === 1 && e.every((v) => v === 0) ) return null;
  const bold = base.map((b, i) => (b?.cs?.length && e[i] > 0 ? bolden(b.cs, e[i]) : null));
  /* letter i's outline in the line (prefix grown from its anchor), as the pictures place it at rest */
  const place = (i, cs) => {
    const L = Ls[i], gl = base[i].gl, k = kOf(i), s = L.s * k, c = Math.cos(L.rot), sn = Math.sin(L.rot), px0 = gl.adv / 2, py = -0.5;
    let tx = L.x + L.w / 2, ty = -0.5 + L.dy;
    if ( k !== 1 ) { tx = ax + (tx - ax) * k; ty = ay + (ty - ay) * k; }
    return mapCs(cs, (X, Y) => [(X - px0) * s * c - (Y - py) * s * sn + tx, (X - px0) * s * sn + (Y - py) * s * c + ty]);
  };
  const live = (i) => !!base[i]?.gl && !Ls[i].skip && plan.chars[i] !== " " && plan.chars[i] !== "\n";
  /* how much closer a pair came at its closest shared row (word units, >= 0) */
  const lost = (a, b) => {
    const g0 = pairGaps(place(a, base[a].cs), place(b, base[b].cs)).rows.filter((d) => d != null);
    const g1 = pairGaps(place(a, bold[a] ?? base[a].cs), place(b, bold[b] ?? base[b].cs)).rows.filter((d) => d != null);
    return g0.length && g1.length ? Math.max(0, Math.min(...g0) - Math.min(...g1)) : 0;
  };
  const lines = plan.layout.lines ?? [{ from: 0, to: n - 1 }];
  const shift = new Array(n).fill(0), row = new Array(n).fill(0);
  if ( plan.layout.arrange === "vertical" ) {
    /* the column: each row moves down by what its letters grew on top and the row above grew below; a mark keeps its gap too */
    const grows = (i) => { if ( !bold[i] ) return [0, 0]; const b0 = bbox(base[i].cs), b1 = bbox(bold[i]); return [Math.max(0, b0.y0 - b1.y0) * Ls[i].s, Math.max(0, b1.y1 - b0.y1) * Ls[i].s]; };
    let cum = 0, prevB = null;
    for ( const ln of lines ) {
      let top = 0, bot = 0; for ( let i = ln.from; i <= ln.to; i++ ) if ( live(i) ) { const [t, b] = grows(i); top = Math.max(top, t); bot = Math.max(bot, b); }
      if ( prevB != null ) cum += prevB + top;
      for ( let i = ln.from; i <= ln.to; i++ ) row[i] = cum;
      prevB = bot;
      for ( let i = ln.from + 1; i <= ln.to; i++ ) shift[i] = shift[i - 1] + (live(i) && live(i - 1) ? lost(i - 1, i) : 0);
    }
    for ( let i = 0; i < n; i++ ) row[i] -= cum / 2;
  } else for ( const ln of lines ) {
    let cum = 0, prev = -1;
    for ( let i = ln.from; i <= ln.to; i++ ) {
      if ( !live(i) ) { shift[i] = cum; continue; }
      if ( prev >= 0 && !plan.chars.slice(prev + 1, i).some((c) => c === " " || c === "\n") ) cum += lost(prev, i);
      shift[i] = cum; prev = i;
    }
    for ( let i = ln.from; i <= ln.to; i++ ) shift[i] -= cum / 2;
  }
  return { e, bold, shift, row, pf, pre, ax, ay };
}

export function pictureGeometry(plan, bank, p, S = 0) {
  const base = baseGeometry(plan, bank);
  const { letters, E, W } = plan.layout;
  const env = envelope(E);
  const g = p.g;
  const os = opticalSize(plan, S, g.s ?? 1, bank);
  const splitAt = letters.findIndex((l) => l.splitSide);
  const splitPx = splitAt > 0 ? letters[splitAt].x : 0;
  const cg = Math.cos(g.r), sg = Math.sin(g.r);
  const center = plan._center ?? [W / 2, -0.5];
  const out = [];
  for ( let i = 0; i < letters.length; i++ ) {
    const L = letters[i], A = p.letters[i] ?? { v: 1, x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 };
    if ( !A.v || !base[i].gl ) continue;
    /* MOVE: a picture may draw another character in this slot (a number being counted in): its own treated outline, cached */
    const alt = A.ch && A.ch !== plan.chars[i] ? altGlyph(plan, bank, i, A.ch) : null;
    if ( A.ch && A.ch !== plan.chars[i] && !alt ) continue;
    const gl = alt ? alt.gl : base[i].gl;
    /* LOOK: a redrawn letter is re-treated only as far as it still reads; a true ring is never re-treated */
    let cs0 = p.reseed && (alt || !base[i].ring) ? treatReadable(gl, alt ? A.ch : plan.chars[i], L.font ?? plan.hand.font, plan.hand, plan.sound, p.boil, i, bank) : (alt ? alt.cs : base[i].cs);
    const adv = gl.adv, px = adv / 2, py = -0.5;
    let s = L.s * A.s, tx = L.x + L.w / 2 + A.x, ty = -0.5 + L.dy + A.y;
    if ( os ) {
      /* FONTSEL: a small lead-in grows from its tuck; a thin stem gets weight; the letters part by what they grew */
      if ( i < os.pre && os.pf > 1 ) { s *= os.pf; tx = os.ax + (tx - os.ax) * os.pf; ty = os.ay + (ty - os.ay) * os.pf; }
      if ( os.e[i] > 0 ) cs0 = cs0 === base[i].cs && os.bold[i] ? os.bold[i] : bolden(cs0, os.e[i]);
      tx += os.shift[i]; ty += os.row[i];
    }
    const sx = s * A.sx, sy = s * A.sy, rot = L.rot + A.r, c = Math.cos(rot), sn = Math.sin(rot);
    const cs = cs0.map((c0) => {
      const o = new Array(c0.length);
      for ( let k = 0; k < c0.length; k += 2 ) {
        let x = (c0[k] - px) * sx, y = (c0[k + 1] - py) * sy;
        let X = x * c - y * sn + tx, Y = x * sn + y * c + ty;
        if ( L.splitSide && E.splitDy != null ) { const dx = X - splitPx, dy = Y + 0.5, cr = Math.cos(E.splitRot), sr = Math.sin(E.splitRot); X = splitPx + dx * cr - dy * sr + 0.06; Y = -0.5 + dx * sr + dy * cr + E.splitDy; }
        [X, Y] = env(X, Y);
        X -= center[0]; Y -= center[1];
        X *= g.s * g.sx; Y *= g.s * g.sy;
        o[k] = X * cg - Y * sg + g.x; o[k + 1] = X * sg + Y * cg + g.y;
      }
      return boil(o, p.boil && plan.hand.style !== "invincible" ? 0.006 + 0.006 * plan.sound.rough : 0, p.boil % 9973);   // LOOK2 (P3): the book's ink is clean: no boil at all
    });
    out.push({ i, cs });
  }
  return out;
}

/* the hold picture's box sets the word's centre: every picture is placed relative to it (the anchor never jumps) */
export function settleCenter(plan, bank) {
  if ( plan._center ) return plan._center;
  Object.defineProperty(plan, "_center", { value: [0, 0], enumerable: false, configurable: true, writable: true });
  if ( plan.hand.kern ) kernOptical(plan, bank);   // LOOK2 (P18): pair-aware spacing before the reader checks the word
  if ( plan.hand.legible !== false ) settleOcclusion(plan, bank);
  settleMarks(plan, bank);   // KERNEX: no mark reads as a letter's diacritic (invincible style only)
  const p0 = { ...plan.timeline.hold[0], g: { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 }, boil: 0, reseed: false };
  const geo = pictureGeometry(plan, bank, p0);
  const b = bbox(geo.flatMap((l) => l.cs));
  plan._center = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  plan._holdBox = { w: b.x1 - b.x0, h: b.y1 - b.y0 };
  return plan._center;
}
