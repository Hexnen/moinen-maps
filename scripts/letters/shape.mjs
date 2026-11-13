/* LETR: the outlines of one picture of a plan, in word units (cap height 1). Pure. */
import { resample, jag, rough, boil, drips, flames, bbox } from "./geom.mjs";
import { envelope } from "./design.mjs";
import { rng } from "./rng.mjs";

const STEP = 0.032;

/* letter outlines after the hand's treatment; `seed` re-rolls treatments that live (flames, sparks of jagged edges) */
export function treatLetter(gl, hand, sound, seed, i) {
  const R = rng((seed ^ (i * 2654435761)) >>> 0);
  let cs = gl.contours.map((c) => resample(c, STEP));
  const extra = [];
  switch ( hand.treat ) {
    case "jag": cs = cs.map((c) => jag(c, 0.022 + 0.022 * sound.sharp, 5, R)); break;
    case "rough": cs = cs.map((c, j) => rough(c, 0.016 + 0.018 * sound.rough, 2.2, (seed + i * 31 + j) | 0)); break;
    case "drip": extra.push(...drips(cs, R, 0.75, 0.32 + 0.25 * sound.long)); cs = cs.map((c, j) => rough(c, 0.012, 2, (seed + j) | 0)); break;
    case "flame": cs = cs.map((c, j) => rough(c, 0.02, 2.5, (seed + i * 7 + j) | 0)); extra.push(...flames(cs, R, 1, 0.35 + 0.3 * sound.long, (seed % 100) / 10)); break;
    default: break;
  }
  return cs.concat(extra);
}

/* base geometry cache per plan: glyph per letter and treated outlines for the plan's own seed */
export function baseGeometry(plan, bank) {
  if ( plan._base ) return plan._base;
  const base = plan.chars.map((ch, i) => {
    if ( ch === " " || ch === "\n" ) return { gl: null, cs: [] };   // FXLE F12: a line break has no glyph
    const gl = bank.glyph(plan.hand.font, ch);
    return { gl, cs: treatLetter(gl, plan.hand, plan.sound, plan.seed, i) };
  });
  Object.defineProperty(plan, "_base", { value: base, enumerable: false, configurable: true });
  return base;
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
    const cs0 = p.reseed ? treatLetter(base[i].gl, plan.hand, plan.sound, p.boil, i) : base[i].cs;
    const adv = base[i].gl.adv, px = adv / 2, py = -0.5;
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
      return boil(o, p.boil ? 0.006 + 0.006 * plan.sound.rough : 0, p.boil % 9973);
    });
    out.push({ i, cs });
  }
  return out;
}

/* the hold picture's box sets the word's centre: every picture is placed relative to it (the anchor never jumps) */
export function settleCenter(plan, bank) {
  if ( plan._center ) return plan._center;
  Object.defineProperty(plan, "_center", { value: [0, 0], enumerable: false, configurable: true, writable: true });
  const p0 = { ...plan.timeline.hold[0], g: { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 }, boil: 0, reseed: false };
  const geo = pictureGeometry(plan, bank, p0);
  const b = bbox(geo.flatMap((l) => l.cs));
  plan._center = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  plan._holdBox = { w: b.x1 - b.x0, h: b.y1 - b.y0 };
  return plan._center;
}
