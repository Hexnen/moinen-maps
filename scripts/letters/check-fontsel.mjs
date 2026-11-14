// FONTSEL (1.9.7): node checks of the invincible style's two faces (the owner, 2026-11-14: «Niech będą do wyboru ten teraz i jako
// default Gothic»): League Gothic (default) and Anton, each with its own tuning (design.mjs INV_TUNE), as measurements:
//  1. both faces bundled with their licence, outlines free of overlapping contours (a seam would show under the one keyline);
//  2. a plan letters in the face asked for (look.face), the default otherwise; Anton's numbers are LOOK2/LOOK3's own;
//  3. optical sizes (League Gothic): a small picture's stems reach the face's floor, the gaps between letters stay the plan's,
//     a small lead-in is drawn at least prePx tall and still tucks under the body; a big picture is drawn exactly as planned;
//     Anton is never changed by size;
//  4. a number's sign is League Gothic's minus (U+2212), the word itself stays "-7";
//  5. the vertical column's "!" stands at the optical gap from its letter (League Gothic), Anton's column is untouched.
// Pure part from check.mjs; `node check-fontsel.mjs --engine` runs the engine part on the fake browser (L.invFace, the table's
// setting through applyPrefs, live without a reload, a call's look.face wins).
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { makePlan, INV_FACES, DEFAULT_FACE, INV_TUNE, FONTS } from "./design.mjs";
import { settleCenter, pictureGeometry, opticalSize, pairGaps, placedShape, KERN } from "./shape.mjs";
import { bbox } from "./geom.mjs";
import { area } from "./font.mjs";

const HERE = new URL("./", import.meta.url);
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?-+−ĄĆĘŁŃÓŚŹŻ";

/* contours of one glyph that cross each other or nest with the same winding (a fill seam / a keyline seam) */
function overlaps(cs) {
  const segs = (c) => { const s = []; for ( let i = 0; i < c.length; i += 2 ) { const j = (i + 2) % c.length; s.push([c[i], c[i + 1], c[j], c[j + 1]]); } return s; };
  const d = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const cross = (a, b) => { const A = [a[0], a[1]], B = [a[2], a[3]], C = [b[0], b[1]], D = [b[2], b[3]]; return d(A, B, C) * d(A, B, D) < 0 && d(C, D, A) * d(C, D, B) < 0; };
  const inside = (x, y, c) => { let w = false; for ( let i = 0, j = c.length - 2; i < c.length; j = i, i += 2 ) { const xi = c[i], yi = c[i + 1], xj = c[j], yj = c[j + 1]; if ( (yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi ) w = !w; } return w; };
  let n = 0;
  for ( let i = 0; i < cs.length; i++ ) for ( let j = i + 1; j < cs.length; j++ ) {
    const si = segs(cs[i]), sj = segs(cs[j]); let k = 0;
    for ( const a of si ) for ( const b of sj ) if ( cross(a, b) ) k++;
    if ( k ) n++;
    else if ( Math.sign(area(cs[i])) === Math.sign(area(cs[j])) && (inside(cs[j][0], cs[j][1], cs[i]) || inside(cs[i][0], cs[i][1], cs[j])) ) n++;
  }
  return n;
}
/* ink runs across a contour set at height y (widths of the filled spans, nonzero not needed: glyphs here are simple) */
function runs(cs, y) {
  const xs = [];
  for ( const c of cs ) for ( let i = 0; i < c.length; i += 2 ) { const j = (i + 2) % c.length, y1 = c[i + 1], y2 = c[j + 1]; if ( (y1 > y) !== (y2 > y) ) xs.push(c[i] + (y - y1) * (c[j] - c[i]) / (y2 - y1)); }
  xs.sort((a, b) => a - b); const r = []; for ( let i = 0; i + 1 < xs.length; i += 2 ) r.push(xs[i + 1] - xs[i]); return r;
}

export async function run(ok, { bank, fontsApi }) {
  const inv = (t, o = {}) => makePlan(t, { ...o, look: { style: "invincible", ...(o.look ?? {}) } }, fontsApi, []);
  const hold = (p) => ({ ...p.timeline.hold[0], g: { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 }, boil: 0, reseed: false });

  /* 1. bundled with the licence; overlap-free outlines */
  {
    ok(INV_FACES.join() === "league,anton" && DEFAULT_FACE === "league", "fontsel: two faces, League Gothic first and default");
    for ( const f of INV_FACES ) {
      const file = new URL(FONTS[f].file, HERE), lic = new URL(FONTS[f].file.replace(/[^/]+$/u, "OFL.txt"), HERE);
      ok(fs.existsSync(file) && fs.existsSync(lic) && /SIL Open Font License/u.test(fs.readFileSync(lic, "utf8")), `fontsel: ${f} bundled with its OFL licence`);
      ok(bank.has(f), `fontsel: ${f} loads`);
      let bad = 0, miss = 0; const ex = [];
      for ( const ch of GLYPHS ) { const g = bank.raw(f, ch); if ( !g ) { if ( ch !== "−" ) miss++; continue; } const k = overlaps(g.contours); if ( k ) { bad++; ex.push(ch); } }
      ok(bad === 0, `fontsel: ${f} outlines without overlapping contours (${ex.join("") || "none"})`);
      ok(miss === 0, `fontsel: ${f} has its own glyph for every capital, digit, mark and Polish capital (${miss} missing)`);
    }
    const att = fs.readFileSync(new URL("ATTRIBUTION.md", HERE), "utf8");
    ok(/leaguegothic\/LeagueGothic-Regular\.ttf/u.test(att), "fontsel: League Gothic listed in ATTRIBUTION.md");
  }

  /* 2. the face asked for, its own tuning; Anton keeps LOOK2/LOOK3's numbers */
  {
    const a = inv("KA-BOOM!", { mood: "boom", seed: 2, look: { face: "anton" } }), l = inv("KA-BOOM!", { mood: "boom", seed: 2 }), b = inv("KA-BOOM!", { mood: "boom", seed: 2, look: { face: "league" } });
    ok(a.hand.font === "anton" && l.hand.font === "league" && b.hand.font === "league", "fontsel: look.face picks the face, League Gothic by default");
    ok(JSON.stringify(l) === JSON.stringify(b), "fontsel: the default face's plan is the plan asked for by name");
    const T = INV_TUNE.anton;
    ok(T.gap.short === 0.04 && T.gap.sustained === 0.06 && T.gap.other === 0.05 && T.prefix[0] === 0.32 && T.prefix[1] === 0.06 && T.inkW === 0.016 && T.rimW === 0.05 && !T.small && !T.minus && !T.markKern, "fontsel: Anton keeps the LOOK2/LOOK3 numbers");
    ok(a.hand.inkW === 0.016 && l.hand.inkW === INV_TUNE.league.inkW && a.hand.kern.gap !== l.hand.kern.gap, "fontsel: each face carries its own keyline and gap");
    /* the face's stem as tuned is the stem of its own I */
    for ( const f of INV_FACES ) { const I = bank.glyph(f, "I"); const w = runs(I.contours, -0.5)[0]; ok(Math.abs(w - INV_TUNE[f].stem) < 0.004, `fontsel: ${f} tuned stem ${INV_TUNE[f].stem} = its I (${w.toFixed(3)})`); }
    /* a word is narrower in League Gothic (about 0.8), never wider */
    const wd = (p) => { settleCenter(p, bank); const g = pictureGeometry(p, bank, hold(p)), bb = bbox(g.flatMap((x) => x.cs)); return bb.x1 - bb.x0; };
    const r = wd(inv("KRRAKK!", { mood: "crack", seed: 5 })) / wd(inv("KRRAKK!", { mood: "crack", seed: 5, look: { face: "anton" } }));
    ok(r > 0.7 && r < 0.92, `fontsel: League Gothic sets a word at ${r.toFixed(2)} of Anton's width`);
  }

  /* 3. optical sizes */
  {
    const stemAt = (p, S, i) => { settleCenter(p, bank); const g = pictureGeometry(p, bank, hold(p), S).find((x) => x.i === i); const bb = bbox(g.cs); return Math.min(...runs(g.cs, (bb.y0 + bb.y1) / 2)) * S; };
    const sm = INV_TUNE.league.small;
    for ( const [t, i, m] of [["KRIK!", 2, "crack"], ["HIT!", 1, "impact"], ["-17", 2, "pain"]] ) {
      const p = inv(t, { mood: m, seed: 3 }), s = p.layout.letters[i].s;
      for ( const S of [18, 24, 30] ) {
        const px = stemAt(p, S, i), want = Math.min(sm.stemPx, (INV_TUNE.league.stem + 2 * sm.boldMax) * S * s);
        ok(px >= want - 0.15, `fontsel: ${t} at ${S} px: stem of ${t[i]} ${px.toFixed(2)} px >= ${want.toFixed(2)}`);
      }
      const big = pictureGeometry(p, bank, hold(p), 160), none = pictureGeometry(p, bank, hold(p));
      ok(JSON.stringify(big) === JSON.stringify(none), `fontsel: ${t} at 160 px is drawn exactly as planned`);
      const pa = inv(t, { mood: m, seed: 3, look: { face: "anton" } }); settleCenter(pa, bank);
      ok(opticalSize(pa, 18) === null && JSON.stringify(pictureGeometry(pa, bank, hold(pa), 18)) === JSON.stringify(pictureGeometry(pa, bank, hold(pa))), `fontsel: Anton's ${t} is not changed by size`);
    }
    /* the gaps stay: at 20 px every pair's closest row is no closer than at full size (the letters moved apart by what they grew) */
    {
      let worse = 0, n = 0; const ex = [];
      for ( const [t, m] of [["KRRAKK!", "crack"], ["SHHWIKT!", "slash"], ["WHAMM!", "punch"], ["MIAŻDŻ!", "impact"], ["+12", "heal"]] ) {
        const p = inv(t, { mood: m, seed: 4 }); settleCenter(p, bank);
        const g0 = pictureGeometry(p, bank, hold(p)), g1 = pictureGeometry(p, bank, hold(p), 20);
        const at = (g, i) => g.find((x) => x.i === i)?.cs;
        for ( let i = 1; i < p.chars.length; i++ ) {
          if ( !at(g0, i) || !at(g0, i - 1) ) continue;
          const d0 = pairGaps(at(g0, i - 1), at(g0, i)).rows.filter((d) => d != null), d1 = pairGaps(at(g1, i - 1), at(g1, i)).rows.filter((d) => d != null);
          if ( !d0.length || !d1.length ) continue;
          n++; if ( Math.min(...d1) < Math.min(...d0) - 0.004 ) { worse++; ex.push(`${t}:${p.chars[i - 1]}${p.chars[i]}`); }
        }
      }
      ok(n > 10 && worse === 0, `fontsel: small pictures keep each pair's gap (${worse} of ${n} closer: ${ex.slice(0, 4).join(" ")})`);
    }
    /* a small lead-in: at least prePx tall (within preMax), its top on the body's top line, still tucked under the body */
    for ( const [t, m] of [["KA-BOOM!", "boom"], ["KA-KRRAKK!", "crack"], ["KER-SPLAT!", "splash"]] ) {
      const p = inv(t, { mood: m, seed: 6, sound: { loud: 0.9 } }); settleCenter(p, bank);
      const pre = p.layout.pre; if ( !pre ) { ok(false, `fontsel: ${t} has a prefix`); continue; }
      for ( const S of [14, 20, 26] ) {
        const g = pictureGeometry(p, bank, hold(p), S), lead = g.filter((x) => x.i < pre && /\p{L}/u.test(p.chars[x.i])), body = g.find((x) => x.i === pre);
        const lb = bbox(lead.flatMap((x) => x.cs)), bb = bbox(body.cs), planned = p.layout.letters[0].s * S;
        const want = Math.min(sm.prePx, sm.preMax * planned);
        ok((lb.y1 - lb.y0) * S >= want - 0.6, `fontsel: ${t} at ${S} px: lead-in ${((lb.y1 - lb.y0) * S).toFixed(1)} px tall (>= ${want.toFixed(1)})`);
        ok(Math.abs(lb.y0 - bb.y0) * S < 1.2, `fontsel: ${t} at ${S} px: lead-in on the body's top line (${((lb.y0 - bb.y0) * S).toFixed(2)} px)`);
        const hy = g.find((x) => x.i === pre - 1);
        ok(hy && bbox(hy.cs).x1 > bb.x0 - 0.02, `fontsel: ${t} at ${S} px: the lead-in still meets the body`);
      }
    }
  }

  /* 4. a number's sign: League Gothic's minus, the word unchanged */
  {
    const p = inv("-7", { mood: "pain", seed: 1 }), a = inv("-7", { mood: "pain", seed: 1, look: { face: "anton" } });
    settleCenter(p, bank);
    ok(p.word === "-7" && p.chars.join("") === "-7" && p.layout.letters[0].glyph === "−" && a.layout.letters[0].glyph === undefined, "fontsel: League Gothic letters -7 with its minus, Anton with its hyphen; the word stays -7");
    const g = pictureGeometry(p, bank, hold(p)), m = bbox(g.find((x) => x.i === 0).cs), d = bbox(g.find((x) => x.i === 1).cs);
    const mid = (m.y0 + m.y1) / 2, dmid = (d.y0 + d.y1) / 2;
    ok(Math.abs(mid - dmid) < 0.12 * (d.y1 - d.y0) && (m.x1 - m.x0) >= 0.6 * (d.x1 - d.x0), `fontsel: the minus stands at the digit's middle, as wide as most of it (${(m.x1 - m.x0).toFixed(2)} vs ${(d.x1 - d.x0).toFixed(2)})`);
    const k = inv("KA-BOOM!", { mood: "boom", seed: 1 }); ok(k.layout.letters.every((l) => l.glyph === undefined), "fontsel: a lead-in's hyphen stays a hyphen");
  }

  /* 5. the column's mark */
  {
    for ( const t of ["KRAK!", "BOOM!", "WHAM!!"] ) {
      const p = inv(t, { mood: "impact", seed: 7, arrange: "vertical" }); settleCenter(p, bank);
      const L = p.layout.letters, i = p.chars.indexOf("!"), a = placedShape(p, bank, i - 1, L[i - 1].x), b = placedShape(p, bank, i, L[i].x);
      const h = Math.min(L[i - 1].s, L[i].s), g = pairGaps(a, b), live = g.rows.filter((d) => d != null);
      const mean = g.rows.reduce((acc, d) => acc + (d == null ? KERN.open * h : Math.min(KERN.open * h, d)), 0) / g.rows.length;
      /* the optical gap, or (an open letter: the K's arm) as close as a touch; always closer than the advance boxes put it */
      const at = Math.abs(mean - p.hand.kern.gap * h) < 0.01 * h || Math.abs(Math.min(...live) - KERN.touch * h) < 1e-3 * h;
      const adv = L[i - 1].x + L[i - 1].w + 0.02 * L[i - 1].s;
      ok(at && Math.min(...live) >= KERN.touch * h - 1e-6 && L[i].x < adv - 0.02 * h, `fontsel: column ${t}: the mark at the optical gap (${(mean / h).toFixed(3)} vs ${p.hand.kern.gap}, closest ${(Math.min(...live) / h).toFixed(3)}; x ${L[i].x.toFixed(3)} < ${adv.toFixed(3)})`);
    }
    const pa = inv("KRAK!", { mood: "impact", seed: 7, arrange: "vertical", look: { face: "anton" } }), L = pa.layout.letters, i = pa.chars.indexOf("!");
    settleCenter(pa, bank);
    ok(Math.abs(L[i].x - (L[i - 1].x + L[i - 1].w + 0.02 * L[i - 1].s)) < 1e-9, "fontsel: Anton's column keeps the mark at the advance (LOOK2)");
  }
}

/* ---------- the engine part (fake browser): the table's face reaches every next word without a reload ---------- */
async function engineChecks() {
  let n = 0, failed = 0;
  const ok = (c, msg) => { n++; if ( !c ) { failed++; console.log("FAIL", msg); } else if ( process.env.LETR_VERBOSE ) console.log("ok  ", msg); };
  const { setup } = await import("./testenv.mjs");
  try {
    for ( const gm of [true, false] ) {
      const E = await setup({ gm }); const L = E.engine; L.lookStyle("invincible");
      const { applyPrefs } = await import("./tools.mjs"); const { DEFAULTS } = await import("./prefs.mjs");
      const who = gm ? "GM" : "player";
      ok(L.invFace() === "league" && L.invFaces.join() === "league,anton", `fontsel engine (${who}): League Gothic by default`);
      applyPrefs(L, { ...DEFAULTS });
      const at = { x: 2000, y: 1500 }, base = { kind: "punch", magnitude: 1.2, space: "world", at };
      const a = L.play("BLAM!", { ...base, seed: "f1" });
      await E.tick(120);
      applyPrefs(L, { ...DEFAULTS, face: "anton" });
      const b = L.play("BLAM!", { ...base, seed: "f2" });
      const c = L.play("BLAM!", { ...base, seed: "f3", look: { style: "invincible", face: "league" } });
      const x = L.play("BLAM!", { ...base, seed: "f4", look: { style: "expressive" } });
      await E.tick(200);
      ok(a.plan?.hand.font === "league", `fontsel engine (${who}): the word before the switch is League Gothic (${a.plan?.hand.font})`);
      ok(b.plan?.hand.font === "anton", `fontsel engine (${who}): the next word after the table's switch is Anton (${b.plan?.hand.font}), no reload`);
      ok(c.plan?.hand.font === "league", `fontsel engine (${who}): a call's look.face beats the table's setting`);
      ok(!!x.plan && x.plan.hand.style !== "invincible" && x.plan.hand.font !== "league", `fontsel engine (${who}): the legacy style keeps its own faces (${x.plan?.hand.font})`);
      L.invFace("bogus"); ok(L.invFace() === "anton", `fontsel engine (${who}): an unknown face is ignored`);
      applyPrefs(L, { ...DEFAULTS });
      const d = L.play("BLAM!", { ...base, seed: "f5" }); await E.tick(50);
      ok(d.plan?.hand.font === "league", `fontsel engine (${who}): back to League Gothic for the next word`);
      /* the still picture follows the same face */
      const s1 = await L.still("KRAK!", { mood: "crack", seed: 1, size: 40 }), w1 = s1.width;
      L.invFace("anton"); const s2 = await L.still("KRAK!", { mood: "crack", seed: 1, size: 40 }); L.invFace("league");
      ok(w1 < s2.width, `fontsel engine (${who}): L.still letters in the table's face (League ${w1} px < Anton ${s2.width} px wide)`);
      L.stopAll?.(); await E.tick(3000);
      E.restoreWarn();
    }
  } catch ( e ) { n++; failed++; console.log("FAIL (threw)", String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ")); }
  console.log(`fontsel-engine: ${n} checks, ${failed} failed`);
  return failed;
}

if ( process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] ) {
  if ( process.argv.includes("--engine") ) process.exit((await engineChecks()) ? 1 : 0);
  /* alone: the pure part with its own font bank */
  const { FontBank } = await import("./fontbank.mjs");
  const bank = new FontBank();
  for ( const [id, f] of Object.entries(FONTS) ) { const b = fs.readFileSync(new URL(f.file, HERE)); bank.add(id, b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); }
  let n = 0, failed = 0;
  await run((c, m) => { n++; if ( !c ) { failed++; console.log("FAIL", m); } else if ( process.env.LETR_VERBOSE ) console.log("ok  ", m); }, { bank, fontsApi: { adv: (f, c) => bank.adv(f, c) } });
  console.log(`fontsel: ${n} checks, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
