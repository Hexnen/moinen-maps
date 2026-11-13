/* LETR: the outlines of one picture of a plan, in word units (cap height 1). Pure. */
import { resample, jag, rough, boil, drips, flames, bbox, crackLines, strokeQuads } from "./geom.mjs";
import { envelope, RING_W } from "./design.mjs";
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

/* base geometry cache per plan: glyph per letter and treated outlines for the plan's own seed */
export function baseGeometry(plan, bank) {
  if ( plan._base ) return plan._base;
  const base = plan.chars.map((ch, i) => {
    if ( ch === " " || ch === "\n" ) return { gl: null, cs: [] };   // FXLE F12: a line break has no glyph
    const font = plan.layout.letters[i]?.font ?? plan.hand.font;
    if ( plan.layout.letters[i]?.ring ) { const gl = ringGlyph(font, bank); return { gl, cs: gl.contours, ring: true }; }
    const gl = bank.glyph(font, ch);
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
      const grow = H.stack === "merge" ? 0 : outer / Ls[i].s, cs = mapCs(mapCs(base[j].cs, Pj.fwd), Pi.upright), b = bbox(cs);
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
      const d = 0.03 * Math.min(L.s, Ls[Math.max(line.from, from - 1)].s);
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

function altGlyph(plan, bank, i, ch) {
  if ( ch === " " ) return null;
  if ( !plan._alt ) Object.defineProperty(plan, "_alt", { value: new Map(), enumerable: false, configurable: true });
  const k = `${i}:${ch}`;
  if ( !plan._alt.has(k) ) { const font = plan.layout.letters[i]?.font ?? plan.hand.font, gl = bank.glyph(font, ch); plan._alt.set(k, gl ? { gl, cs: treatReadable(gl, ch, font, plan.hand, plan.sound, plan.seed, i, bank) } : null); }   // LOOK: read like any letter
  return plan._alt.get(k);
}

/* outlines of picture p: [{ i, cs: [contours], visible }], in word units, word centre at (0,0) of the HOLD layout */
export function pictureGeometry(plan, bank, p) {
  const base = baseGeometry(plan, bank);
  const { letters, E, W } = plan.layout;
  const env = envelope(E);
  const g = p.g;
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
    const cs0 = p.reseed && (alt || !base[i].ring) ? treatReadable(gl, alt ? A.ch : plan.chars[i], L.font ?? plan.hand.font, plan.hand, plan.sound, p.boil, i, bank) : (alt ? alt.cs : base[i].cs);
    const adv = gl.adv, px = adv / 2, py = -0.5;
    const s = L.s * A.s, sx = s * A.sx, sy = s * A.sy, rot = L.rot + A.r, c = Math.cos(rot), sn = Math.sin(rot);
    const tx = L.x + L.w / 2 + A.x, ty = -0.5 + L.dy + A.y;
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
      return boil(o, p.boil ? (plan.hand.style === "invincible" ? 0.0025 : 0.006 + 0.006 * plan.sound.rough) : 0, p.boil % 9973);   // the book's ink is clean: a faint boil only
    });
    out.push({ i, cs });
  }
  return out;
}

/* the hold picture's box sets the word's centre: every picture is placed relative to it (the anchor never jumps) */
export function settleCenter(plan, bank) {
  if ( plan._center ) return plan._center;
  Object.defineProperty(plan, "_center", { value: [0, 0], enumerable: false, configurable: true, writable: true });
  if ( plan.hand.legible !== false ) settleOcclusion(plan, bank);
  const p0 = { ...plan.timeline.hold[0], g: { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 }, boil: 0, reseed: false };
  const geo = pictureGeometry(plan, bank, p0);
  const b = bbox(geo.flatMap((l) => l.cs));
  plan._center = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  plan._holdBox = { w: b.x1 - b.x0, h: b.y1 - b.y0 };
  return plan._center;
}
