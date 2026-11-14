// KERNEX: node checks that punctuation never reads as a diacritic of its neighbour in the invincible style (both faces). In Polish a
// mark at a letter changes the letter: a "!" whose dot fused under E's foot made "ZBURZENIE!" read "ZBURZENIĘ!" (1.9.7: the optical
// spacing let the dot touch the foot and the union keyline joined them). Sweeps every letter (A-Z, the Polish capitals, digits) with
// "!", "!!", "?", a trailing and an inner hyphen, in words with and without Polish letters, in a line and in the vertical column, on the
// plan (cap heights) and as painted at 26 px and 110 px. The measurement is this file's own (it does not call shape.mjs settleMarks
// or markGap): each pair is turned into the letter's frame (the word's lean), cut into rows; beside the letter (rows within its
// height) the mark keeps the hand's gap from the letter's ink in that row; above or below it (up to 0.3 cap away) it keeps that gap
// from the letter's whole width. Also: no mark sits farther than needed (no hole), the tucked lead-in keeps its tuck, the legacy
// styles are untouched, and no picture of a word (entrance, hold, exit) makes a mark touch its letter.
// Called from check.mjs; standalone: node check-marks.mjs [<letters folder of another engine>] (the 1.9.7 baseline fails).
import { pathToFileURL } from "node:url";

export async function run(ok, { bank, fontsApi, dir = null, verbose = !!process.env.LETR_VERBOSE }) {
  const at = (f) => (dir ? new URL(f, dir).href : new URL(`./${f}`, import.meta.url).href);
  const D = await import(at("design.mjs")), S = await import(at("shape.mjs")), G = await import(at("geom.mjs"));
  const { makePlan, INV_FACES = ["anton"], INV_TUNE = {} } = D, { settleCenter, pictureGeometry } = S, { bbox } = G;
  const say = (...a) => { if ( verbose ) console.log("  marks:", ...a); };
  const plan = (t, o = {}) => makePlan(t, o, fontsApi, []);
  const ROWS = 60, BAND = 0.03, DZ = 0.3;
  const isMark = (c) => /[!?.,:;\-−]/u.test(c), isInk = (c) => /[\p{L}\p{N}]/u.test(c);
  /* x extents of a shape at heights ys (edges crossing each row) */
  const rows = (cs, ys) => {
    const mn = ys.map(() => Infinity), mx = ys.map(() => -Infinity);
    for ( const c of cs ) for ( let i = 0; i < c.length; i += 2 ) {
      const j = (i + 2) % c.length, x1 = c[i], y1 = c[i + 1], x2 = c[j], y2 = c[j + 1];
      if ( y1 === y2 ) continue;
      ys.forEach((y, k) => { if ( y < Math.min(y1, y2) || y >= Math.max(y1, y2) ) return; const x = x1 + (y - y1) * (x2 - x1) / (y2 - y1); mn[k] = Math.min(mn[k], x); mx[k] = Math.max(mx[k], x); });
    }
    return { mn, mx };
  };
  /* exact: the rows through every corner of both outlines (a few row samples alone missed a 4's spur by 0.04 cap) */
  const corners = (ys, shapes, lo, hi) => { for ( const cs of shapes ) for ( const c of cs ) for ( let i = 1; i < c.length; i += 2 ) for ( const d of [-1e-7, 1e-7] ) { const y = c[i] + d; if ( y > lo && y < hi ) ys.push(y); } };
  /* the clearance of mark M on `side` of letter A (both already in the letter's frame); h = the letter's cap height */
  const clearance = (A, M, side, h) => {
    const ba = bbox(A), bm = bbox(M), ys = [];
    for ( let k = 0; k < ROWS; k++ ) ys.push(bm.y0 + (bm.y1 - bm.y0) * (k + 0.5) / ROWS);
    corners(ys, [A, M], bm.y0, bm.y1);
    const em = rows(M, ys), ea = rows(A, ys.map((y) => Math.max(ba.y0 + 1e-6, Math.min(ba.y1 - 1e-6, y))));
    let min = Infinity;
    ys.forEach((y, k) => {
      if ( !Number.isFinite(em.mn[k]) ) return;
      const out = Math.max(0, ba.y0 - y, y - ba.y1);
      if ( out >= DZ * h ) return;
      let e;
      if ( out <= BAND * h ) { if ( !Number.isFinite(ea.mn[k]) ) return; e = side > 0 ? ea.mx[k] : ea.mn[k]; } else e = side > 0 ? ba.x1 : ba.x0;
      min = Math.min(min, side > 0 ? em.mn[k] - e : e - em.mx[k]);
    });
    return min;
  };
  /* the shared-row gap (the closest row both have ink in) */
  const shared = (A, M, side) => {
    const ba = bbox(A), bm = bbox(M), y0 = Math.max(ba.y0, bm.y0), y1 = Math.min(ba.y1, bm.y1), ys = [];
    for ( let k = 0; k < ROWS; k++ ) ys.push(y0 + (y1 - y0) * (k + 0.5) / ROWS);
    corners(ys, [A, M], y0, y1);
    const ea = rows(A, ys), em = rows(M, ys); let min = Infinity;
    ys.forEach((y, k) => { if ( Number.isFinite(ea.mn[k]) && Number.isFinite(em.mn[k]) ) min = Math.min(min, side > 0 ? em.mn[k] - ea.mx[k] : ea.mn[k] - em.mx[k]); });
    return min;
  };
  const turn = (cs, a) => { const c = Math.cos(-a), s = Math.sin(-a); return cs.map((k) => { const o = []; for ( let i = 0; i < k.length; i += 2 ) o.push(k[i] * c - k[i + 1] * s, k[i] * s + k[i + 1] * c); return o; }); };
  const hold = (p) => ({ ...p.timeline.hold[0], g: { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 }, boil: 0, reseed: false });
  /* every pair the rule holds in plan p: [letter, mark, side] */
  const pairsOf = (p) => {
    const L = p.layout.letters, ch = p.chars, n = ch.length, pre = p.layout.pre ?? 0, out = [], vert = p.layout.arrange === "vertical";
    const live = (i) => i >= 0 && i < n && !L[i].skip && ch[i] !== " ";
    for ( let m = 0; m < n; m++ ) {
      if ( !isMark(ch[m]) || !live(m) ) continue;
      for ( let j = 0; j < n; j++ ) {
        if ( !live(j) || !isInk(ch[j]) ) continue;
        if ( vert ) { out.push([j, m, 1]); continue; }
        if ( ch.slice(Math.min(j, m) + 1, Math.max(j, m)).includes(" ") ) continue;
        if ( pre && m === pre - 1 && j === pre ) continue;   // the owner's tucked lead-in
        out.push([j, m, j < m ? 1 : -1]);
      }
    }
    return out;
  };
  /* measure one plan: per pair the clearance (word units) and the letter's cap height, at paint size Spx (0 = the plan) */
  const measure = (p, Spx = 0, pic = null) => {
    settleCenter(p, bank);
    const geo = new Map(pictureGeometry(p, bank, pic ?? hold(p), Spx).map((l) => [l.i, l.cs])), a = p.layout.E?.rot ?? 0;
    return pairsOf(p).filter(([j, m]) => geo.has(j) && geo.has(m)).map(([j, m, side]) => {
      const A = turn(geo.get(j), a), M = turn(geo.get(m), a);
      return { j, m, side, h: p.layout.letters[j].s, c: clearance(A, M, side, p.layout.letters[j].s), sh: shared(A, M, side) };
    });
  };
  const gapOf = (p) => p.hand.kern?.gap ?? INV_TUNE[p.hand.font]?.gap?.other ?? 0.05;
  const LET = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZĄĆĘŁŃÓŚŹŻ0123456789"];
  const TEXTS = (X) => [`${X}!`, `${X}!!`, `${X}?`, `BA${X}!`, `ŻÓ${X}!!`, `KRA${X}-`, `${X}-${X}`];
  const faces = INV_FACES.length ? INV_FACES : ["anton"];

  /* 1. the four words of the defect, as the dice splash calls them (mood, seed, from: 90), both faces */
  for ( const face of faces ) for ( const t of ["ZMIAŻDŻENIE!", "ZBURZENIE!", "ROZWALENIE!", "FORSOWANIE!"] ) {
    const p = plan(t, { mood: t === "FORSOWANIE!" ? "powerup" : "crash", seed: "m1:word", from: 90, look: { style: "invincible", face } });
    const r = measure(p).find((x) => x.j === t.length - 2);
    ok(r && r.c >= gapOf(p) * r.h - 1e-3, `[${face}] marks: ${t}: the "!" keeps the hand's gap from the E (${r ? (r.c / r.h).toFixed(3) : "?"} cap, need ${gapOf(p).toFixed(3)}): no ogonek`);
  }

  /* 2. every letter x every mark text, line and column, both faces: the clearance on the plan and at 110 px, a pixel at 26 px */
  for ( const face of faces ) for ( const arrange of ["line", "vertical"] ) {
    let n = 0, bad = 0, bad110 = 0, bad26 = 0, worst = Infinity, worst26 = Infinity; const ex = [];
    for ( const X of LET ) for ( const t of TEXTS(X) ) {
      const opts = { mood: "impact", seed: `kx${X}${t.length}`, look: { style: "invincible", face, ...(arrange === "vertical" ? { arrange: "vertical" } : {}) } };
      if ( arrange === "vertical" ) opts.arrange = "vertical";
      const p = plan(t, opts), G0 = gapOf(p);
      for ( const r of measure(p) ) {
        n++; worst = Math.min(worst, r.c / r.h - G0);
        if ( r.c < G0 * r.h - 1e-3 ) { bad++; if ( ex.length < 4 ) ex.push(`${t} ${p.chars[r.j]}/${p.chars[r.m]} ${(r.c / r.h).toFixed(3)}`); }
      }
      for ( const r of measure(p, 110) ) if ( r.c * 110 < Math.min(G0 * r.h * 110, 1.5) - 0.15 ) { bad110++; if ( ex.length < 6 ) ex.push(`110px ${t} ${p.chars[r.j]}/${p.chars[r.m]} ${(r.c * 110).toFixed(2)}px`); }
      /* 26 px: the word is painted at 26 px a cap: the mark stands at least about a pixel and a half clear where it shares rows with
         the letter, and never touches it anywhere */
      for ( const r of measure(p, 26) ) {
        worst26 = Math.min(worst26, r.sh * 26);
        if ( r.sh * 26 < 1.35 || r.c <= 0 ) { bad26++; if ( ex.length < 8 ) ex.push(`26px ${t} ${p.chars[r.j]}/${p.chars[r.m]} ${(r.sh * 26).toFixed(2)}px`); }
      }
    }
    say(`${face} ${arrange}: ${n} pairs, closest ${worst.toFixed(3)} cap over the gap, at 26 px ${worst26.toFixed(2)} px`);
    ok(n > 400 && bad === 0, `[${face}] marks ${arrange}: no mark comes closer to a letter than the hand's gap, beside it or under/over it (${bad} of ${n}; ${ex.join(", ")})`);
    ok(bad110 === 0, `[${face}] marks ${arrange}: painted at 110 px the same holds (${bad110} of ${n})`);
    ok(bad26 === 0, `[${face}] marks ${arrange}: painted at 26 px a mark stands at least 1.35 px clear of its letter (${bad26} of ${n}; worst ${worst26.toFixed(2)} px)`);
  }

  /* 3. tight: no mark is moved farther than the rule needs (no hole after a letter): a "!" after any letter of a line stands within
     the hand's gap + 0.04 cap at its closest row (in its own row or the letter's whole width) */
  for ( const face of faces ) {
    let n = 0, far = 0, most = 0; const ex = [];
    for ( const X of LET ) {
      const p = plan(`BA${X}!`, { mood: "impact", seed: `tight${X}`, look: { style: "invincible", face } }), G0 = gapOf(p);
      const r = measure(p).find((q) => q.j === 2 && q.m === 3); if ( !r ) continue;
      n++; const over = r.c / r.h - G0; most = Math.max(most, over);
      if ( over > 0.04 ) { far++; if ( ex.length < 4 ) ex.push(`${X}! +${over.toFixed(3)}`); }
    }
    say(`${face} tight: largest extra over the gap ${most.toFixed(3)} cap`);
    ok(n >= 40 && far === 0, `[${face}] marks: tight: a "!" stands no farther than the hand's gap + 0.04 cap from any letter (${far} of ${n}; ${ex.join(", ")})`);
  }

  /* 4. the tucked lead-in keeps its tuck (the owner's prefix): its hyphen still overlaps the first body letter */
  for ( const face of faces ) {
    let n = 0, kept = 0;
    for ( const t of ["KA-BOOM!", "KA-THOOM!", "KRA-KA-GRRAWOOM", "BA-DUM"] ) for ( let s = 0; s < 4; s++ ) {
      const p = plan(t, { mood: "boom", seed: `pre${s}`, look: { style: "invincible", face } }), pre = p.layout.pre ?? 0;
      if ( !pre || p.chars[pre - 1] !== "-" ) continue;
      settleCenter(p, bank); n++;
      const geo = new Map(pictureGeometry(p, bank, hold(p)).map((l) => [l.i, l.cs]));
      if ( bbox(geo.get(pre - 1)).x1 > bbox(geo.get(pre)).x0 ) kept++;
    }
    ok(n > 0 && kept === n, `[${face}] marks: the tucked lead-in's hyphen still tucks under the first body letter (${kept} of ${n})`);
  }

  /* 5. every picture of a word (entrance, hold, exit; smooth and stepped): a mark never touches its letter */
  for ( const face of faces ) {
    let n = 0, touch = 0; const ex = [];
    for ( const t of ["ZBURZENIE!", "SKRAKT!!", "WHAM!", "BLAST?!", "SKREE-"] ) for ( const motion of ["smooth", "stepped"] ) {
      const p = plan(t, { mood: "impact", seed: `pic${t}`, look: { style: "invincible", face, motion } });
      for ( const pic of [...p.timeline.ent, ...p.timeline.hold, ...p.timeline.exit] ) {
        if ( pic.smear ) continue;
        for ( const r of measure(p, 0, { ...pic, g: { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 }, boil: 0, reseed: false }) ) { n++; if ( !(r.c > 0) ) { touch++; if ( ex.length < 3 ) ex.push(`${t} ${motion} ${(r.c / r.h).toFixed(3)}`); } }
      }
    }
    ok(n > 100 && touch === 0, `[${face}] marks: in no picture of a word does a mark touch its letter (${touch} of ${n}; ${ex.join(", ")})`);
  }

  /* 6. the legacy styles are frozen: settleMarks leaves an expressive / comic plan's layout as it was */
  if ( S.settleMarks ) {
    let n = 0, moved = 0;
    for ( const st of ["expressive", "comic"] ) for ( const t of ["ZBURZENIE!", "KRAK!!", "L-L", "BAM?"] ) {
      const p = plan(t, { mood: "crash", seed: `fz${t}`, look: { style: st } }), before = JSON.stringify(p.layout.letters.map((l) => l.x));
      S.settleMarks(p, bank); n++; if ( JSON.stringify(p.layout.letters.map((l) => l.x)) !== before ) moved++;
    }
    ok(moved === 0, `marks: the legacy styles keep their setting (${moved} of ${n} moved)`);
  }
}

/* standalone: node check-marks.mjs [<letters folder of another engine>] */
if ( import.meta.url === pathToFileURL(process.argv[1] ?? "").href ) {
  const fs = await import("node:fs");
  const other = process.argv[2] ? pathToFileURL(process.argv[2].replace(/[\\/]?$/, "/")) : null;
  const { FontBank } = await import(other ? new URL("fontbank.mjs", other).href : "./fontbank.mjs");
  const { FONTS } = await import(other ? new URL("design.mjs", other).href : "./design.mjs");
  const bank = new FontBank();
  for ( const [id, f] of Object.entries(FONTS) ) { const b = fs.readFileSync(new URL(f.file, other ? new URL("design.mjs", other) : new URL("./design.mjs", import.meta.url))); bank.add(id, b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); }
  let n = 0, failed = 0;
  const ok = (c, m) => { n++; if ( !c ) { failed++; console.log("FAIL " + m); } else if ( process.env.LETR_VERBOSE ) console.log("ok   " + m); };
  await run(ok, { bank, fontsApi: { adv: (f, c) => bank.adv(f, c) }, dir: other });
  console.log(`marks: ${n} checks, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
