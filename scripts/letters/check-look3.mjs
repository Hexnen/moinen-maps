// LOOK3: node checks of three defects of the Invincible hand, as measurements (each fails on the 1.9.1 engine):
//  1. interlocked O's stagger: the first linked O stands up, the second down, a third up again (the owner's ruling); two O always
//     interlock, three only rarely, four and more never; the over/under switch lies between the two rings' middles; in stepped motion
//     linked rings shake as one piece;
//  2. a word's first letter is as tall as its neighbour (no "cRUSH!", "wHAM!", "sKREE-");
//  3. no hole before the last letter ("CRUS H!", "SMAS H!"): the last pair's optical gap is the word's own.
// Called from check.mjs with its counter; `dir` (a file URL of another letters folder) runs the same measurements on another engine
// (the 1.9.1 baseline: scratchpad tooling), so each check is shown to fail without its fix.
import { pathToFileURL } from "node:url";

export async function run(ok0, { bank, fontsApi, dir = null, verbose = !!process.env.LETR_VERBOSE, face = null }) {
  const ok = face ? (c, m) => ok0(c, `[${face}] ${m}`) : ok0;   // FONTSEL: once per invincible face (null = the engine's default face)
  const at = (f) => (dir ? new URL(f, dir).href : new URL(`./${f}`, import.meta.url).href);
  const D = await import(at("design.mjs")), S = await import(at("shape.mjs")), G = await import(at("geom.mjs")), W = await import(at("words.mjs"));
  const P = await import(at("paint.mjs"));
  const { makePlan } = D, { settleCenter, pictureGeometry, kernOptical } = S, { bbox } = G;
  const LINK = D.LINK ?? { rise: 0.07, three: 0.2, most: 3 };
  const say = (...a) => { if ( verbose ) console.log("  look3:", ...a); };
  const inv = (t, o = {}) => makePlan(t, { ...o, look: { style: "invincible", ...(face ? { face } : {}), ...(o.look ?? {}) } }, fontsApi, []);
  const ink = (c) => /[\p{L}\p{N}]/u.test(c);
  const V = W.createVocab();
  const vocab = [];
  for ( const id of W.KIND_IDS ) for ( const loud of [0.35, 0.7, 0.95] ) for ( const lang of ["en", "pl"] ) {
    const w = V.word(id, { lang, loud, seed: `lk3${id}${loud}` });
    if ( !/^[-+]?\d/.test(w.text) ) vocab.push({ id, text: w.text, play: w.play, seed: `lk3${id}${loud}${lang}` });
  }
  /* the hold picture's outline of each letter (word units, y down) */
  const holdBoxes = (p) => { settleCenter(p, bank); const q = { ...p.timeline.hold[0], g: { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 }, boil: 0, reseed: false }; const m = new Map(); for ( const l of pictureGeometry(p, bank, q) ) m.set(l.i, bbox(l.cs)); return m; };
  const runsOf = (chars) => { const out = []; for ( let i = 0; i < chars.length; ) { let j = i; while ( j + 1 < chars.length && chars[j + 1] === chars[i] ) j++; if ( chars[i] === "O" && j > i ) out.push([i, j - i + 1]); i = j + 1; } return out; };

  /* 1a. a pair of O: linked, the first up and the second down by LINK.rise of their size each, the pair's middle on the line */
  {
    let n = 0, sign = 0, size = 0, mid = 0; const got = [];
    const words = [["BOOM!", "boom"], ["KA-THOOM!", "boom"], ["WHOOM", "whoosh"], ["SPLOOSH", "splash"], ["GDOOMF!", "impact"], ["KA-BOOM!!", "boom"], ["THOOM", "impact"]];
    for ( const [t, m] of words ) for ( let s = 0; s < 6; s++ ) for ( const o of [{}, { sound: { loud: 0.95 } }, { look: { motion: "stepped" } }] ) {
      const p = inv(t, { mood: m, seed: `oo${t}${s}`, ...o }), L = p.layout.letters, chars = p.chars;
      const r = runsOf(chars).find(([, len]) => len === 2); if ( !r ) continue;
      const [a] = r; n++;
      if ( L[a + 1].link !== a ) { sign++; got.push(`${t}: not linked`); continue; }
      const B = holdBoxes(p), ca = (B.get(a).y0 + B.get(a).y1) / 2, cb = (B.get(a + 1).y0 + B.get(a + 1).y1) / 2;
      const off = (cb - ca) / L[a].s;   // y grows down: + = the second one lower
      if ( !(off > 0) ) { sign++; if ( got.length < 4 ) got.push(`${t} offset ${off.toFixed(3)}`); }
      if ( Math.abs(off - 2 * LINK.rise) > 0.02 ) { size++; if ( got.length < 4 ) got.push(`${t} offset ${off.toFixed(3)}`); }
      /* the pair's middle sits where a plain letter of the word stands (its own vertical middle) */
      const plain = [...L.keys()].filter((i) => i >= (p.layout.pre ?? 0) && ink(chars[i]) && !L[i].ring && Math.abs(L[i].s - L[a].s) < 1e-6);
      /* (measured on the layout: the hold picture leans with the word's envelope, a few hundredths over its width) */
      if ( plain.length ) { const dm = (L[a].dy + L[a + 1].dy) / 2 - L[plain[0]].dy; if ( Math.abs(dm) > 1e-6 ) { mid++; if ( got.length < 4 ) got.push(`${t} pair middle ${(dm / L[a].s).toFixed(3)} off the line`); } }
      if ( n === 1 ) say(`OO stagger ${t}: second O lower by ${off.toFixed(3)} cap (each ${(off / 2).toFixed(3)})`);
    }
    ok(n >= 30 && sign === 0, `look3 OO: the first linked O stands up, the second down (${sign} of ${n} wrong or unlinked; ${got.join(", ")})`);
    ok(size === 0, `look3 OO: the stagger is ${2 * LINK.rise} cap between the two rings (${size} off)`);
    ok(mid === 0, `look3 OO: the pair's middle stays on the word's line (${mid} off)`);
    ok(LINK.rise >= 0.04 && LINK.rise <= 0.1, `look3 OO: "a little": each O ${LINK.rise} cap off the line (0.04-0.10)`);
  }
  /* 1b. runs of three: linked only rarely (then up, down, up); four and more never; across the vocabulary and the brief's words */
  {
    let three = 0, linked3 = 0, zig = 0, four = 0, fourLinked = 0; const ex = [];
    const texts = vocab.map((v) => [v.text, v.play, v.seed]);
    for ( const t of ["GROOOAR", "WHOOOM", "KA-THOOOM!", "BOOOM!", "WHOOOOM", "KA-THOOOOOM!!", "THROOOOMF", "BOOOOOOM"] ) for ( let s = 0; s < 40; s++ ) texts.push([t, { mood: "boom" }, `r3${t}${s}`]);
    for ( const [t, play, seed] of texts ) {
      const p = inv(t, { ...play, seed }), L = p.layout.letters;
      for ( const [a, len] of runsOf(p.chars) ) {
        if ( a < (p.layout.pre ?? 0) ) continue;
        const linked = L.slice(a + 1, a + len).every((l, k) => l.link === a + k);
        const any = L.slice(a, a + len).some((l) => l.ring);
        if ( len === 3 ) {
          three++; if ( linked ) linked3++;
          if ( linked ) { const B = holdBoxes(p), c = [0, 1, 2].map((k) => (B.get(a + k).y0 + B.get(a + k).y1) / 2); if ( !(c[0] < c[1] && c[2] < c[1]) ) { zig++; if ( ex.length < 3 ) ex.push(`${t}: ${c.map((v) => v.toFixed(2)).join(" ")}`); } }
        }
        if ( len >= 4 ) { four++; if ( any ) { fourLinked++; if ( ex.length < 3 ) ex.push(`${t} links ${len}`); } }
      }
    }
    say(`runs of three: ${linked3} of ${three} linked; runs of four or more: ${fourLinked} of ${four} linked`);
    ok(three >= 100 && linked3 > 0 && linked3 <= 0.4 * three, `look3 OOO: a run of three interlocks rarely (${linked3} of ${three})`);
    /* the owner's ruling (2026-11-14, «20 procent»): a run of three interlocks on 20 % of the seeds, decided per seed (same on every seat) */
    { let n = 0, hit = 0, same = 0; for ( let s = 0; s < 1000; s++ ) { const seed = `rate3-${s}`, p = inv("GROOOAR", { mood: "roar", seed }), L = p.layout.letters, a = p.chars.indexOf("O");
        const linked = L[a + 1].link === a && L[a + 2].link === a + 1; n++; if ( linked ) hit++;
        if ( s < 50 ) { const q = inv("GROOOAR", { mood: "roar", seed }).layout.letters; if ( (q[a + 1].link === a && q[a + 2].link === a + 1) === linked ) same++; } }
      say(`three O linked on ${hit} of ${n} seeds`);
      ok(LINK.three === 0.2 && Math.abs(hit / n - 0.2) <= 0.04, `look3 OOO: three O interlock on 20 % of seeds (the owner's ruling; ${hit} of ${n})`);
      ok(same === 50, `look3 OOO: the three-O choice is the same for the same seed (${same} of 50)`); }
    ok(zig === 0, `look3 OOO: a linked three goes up, down, up again (${zig} wrong; ${ex.join(", ")})`);
    ok(four >= 100 && fourLinked === 0, `look3 OOOO: four or more O never interlock (${fourLinked} of ${four})`);
    ok(inv("100", { mood: "impact", seed: 1 }).layout.letters.every((l) => Math.abs(l.dy - inv("100", { mood: "impact", seed: 1 }).layout.letters[0].dy) < 1e-9), "look3 OO: a number's zeros stay level");
  }
  /* 1c. the over/under switch lies half way between the two rings' middles (the crossings are symmetric about it) */
  {
    let bad = 0, n = 0;
    for ( const [t, m] of [["BOOM!", "boom"], ["KA-THOOM!", "boom"], ["WHOOM", "whoosh"]] ) {
      const p = inv(t, { mood: m, seed: `x${t}` }); settleCenter(p, bank);
      const clips = [];
      const ctx = new Proxy({}, { get: (o, k) => {
        if ( k in o ) return o[k];
        if ( k === "rect" ) return (x, y) => clips.push(y);
        if ( k === "createLinearGradient" || k === "createRadialGradient" ) return () => ({ addColorStop() {} });
        if ( k === "getImageData" ) return () => ({ data: new Uint8ClampedArray(4) });
        if ( k === "measureText" ) return () => ({ width: 1 });
        return () => {};
      }, set: (o, k, v) => { o[k] = v; return true; } });
      const S0 = 100, r = P.paintPicture(p, bank, p.timeline.hold[0], S0, (w, h) => ({ width: w, height: h, getContext: () => ctx }));
      const q = { ...p.timeline.hold[0], g: { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 }, boil: 0, reseed: false };
      const geo = pictureGeometry(p, bank, q), L = p.layout.letters;
      for ( const g of geo ) {
        const j = L[g.i].link; if ( j == null ) continue; n++;
        const a = bbox(g.cs), b = bbox(geo.find((x) => x.i === j).cs), want = r.ay + (a.y0 + a.y1 + b.y0 + b.y1) / 4 * r.S;
        if ( !clips.some((y) => Math.abs(y - want) <= 1.01) ) { bad++; say(`switch ${t}: clips ${clips.join(",")} want ${want.toFixed(1)}`); }
      }
    }
    ok(n >= 3 && bad === 0, `look3 OO: the over/under switch is half way between the two rings' middles (${bad} of ${n} off)`);
  }
  /* 1d. stepped motion: linked rings shake as one piece (their offsets equal in every letter drawing); smooth: one picture moves */
  {
    let bad = 0, n = 0;
    for ( const [t, m] of [["GDOOMF!", "impact"], ["KA-THOOM!", "boom"], ["VROOM", "engine"], ["BZOOM", "zap"], ["ROOAR", "roar"]] ) for ( const motion of ["stepped", "smooth"] ) {
      const p = inv(t, { mood: m, seed: `st${t}`, look: { motion } }), L = p.layout.letters;
      for ( const pic of [...p.timeline.ent, ...p.timeline.hold, ...p.timeline.exit] ) for ( let i = 0; i < L.length; i++ ) {
        if ( L[i].link == null || !pic.letters?.[i] ) continue; n++;
        const A = pic.letters[i], B = pic.letters[L[i].link];
        if ( ["x", "y", "r", "s", "sx", "sy"].some((k) => Math.abs((A[k] ?? 0) - (B[k] ?? 0)) > 1e-9) ) bad++;
      }
    }
    ok(n > 20 && bad === 0, `look3 OO in motion: linked rings move as one piece in both motion types (${bad} of ${n} drawings apart)`);
  }

  /* 2. the first letter: as tall as the second, and (outside a rising sound) as tall as the word's peak */
  {
    let n = 0, low = 0, peak = 0, worst = 1; const ex = [];
    const texts = vocab.map((v) => [v.text, v.play, v.seed]);
    const SPLASH = ["CRUSH!", "WHAM!", "SKREE-", "CRUNCH!", "GROOOAR", "SMASH!", "BRZDEK!", "SMAAASH!", "KRAK!!", "WHOOOOM", "CLANG!", "SPLOOSH"];
    for ( const t of SPLASH ) for ( const m of ["impact", "crash", "boom", "roar", "crack"] ) for ( const P2 of [0.3, 0.6, 1] ) texts.push([t, { mood: m, sound: { loud: 0.3 + 0.7 * P2, pitch: 0.15 + 0.6 * P2, rough: P2 > 0.55 ? 0.25 + 0.5 * P2 : 0.1 } }, `f${t}${m}${P2}`]);
    for ( const [t, play, seed] of texts ) {
      const p = inv(t, { ...play, seed }); if ( p.hand.number || p.groups ) continue;
      const L = p.layout.letters, ch = p.chars, pre = p.layout.pre ?? 0;
      const idx = []; for ( let i = pre; i < ch.length && ch[i] !== " " && ch[i] !== "\n"; i++ ) if ( ink(ch[i]) ) idx.push(i);
      if ( idx.length < 2 ) continue; n++;
      const r = L[idx[0]].s / L[idx[1]].s, top = Math.max(...idx.map((i) => L[i].s)), rp = L[idx[0]].s / top;
      worst = Math.min(worst, r);
      if ( r < 0.999 ) { low++; if ( ex.length < 4 ) ex.push(`${t} ${r.toFixed(2)}`); }
      if ( p.hand.env !== "swell" && rp < 0.999 ) { peak++; if ( ex.length < 4 ) ex.push(`${t} peak ${rp.toFixed(2)}`); }
    }
    /* the same misreading inside the word: a C, O, S, U, V, W, X, Z a step under its bigger neighbour reads as lower case (CRUNcH!) */
    let cases = 0, cn = 0; const cex = [];
    for ( const [t, play, seed] of texts ) {
      const p = inv(t, { ...play, seed }); if ( p.hand.number || p.groups || p.hand.env === "shrink" ) continue;
      const L = p.layout.letters, ch = p.chars, pre = p.layout.pre ?? 0;
      for ( let i = pre; i < ch.length; i++ ) {
        if ( !/[COSUVWXZ]/.test(ch[i]) ) continue;
        const nb = [i - 1, i + 1].filter((j) => j >= pre && j < ch.length && ink(ch[j])).map((j) => L[j].s); if ( !nb.length ) continue; cn++;
        if ( L[i].s < 0.999 * Math.max(...nb) ) { cases++; if ( cex.length < 4 ) cex.push(`${t}:${ch[i]} ${(L[i].s / Math.max(...nb)).toFixed(2)}`); }
      }
    }
    ok(cn > 300 && cases === 0, `look3 case look-alikes: never a step under the bigger neighbour (${cases} of ${cn}; ${cex.join(", ")})`);
    say(`first letter: worst first/second ratio ${worst.toFixed(3)} over ${n} words`);
    ok(n > 300 && low === 0, `look3 first letter: as tall as the second in ${n - low} of ${n} words (worst ${worst.toFixed(2)}; ${ex.join(", ")})`);
    ok(peak === 0, `look3 first letter: as tall as the peak unless the sound rises (${peak} smaller)`);
  }

  /* 3. the last pair: its optical gap is the word's own (no hole before the last letter) */
  {
    let n = 0, hole = 0, worst = -1; const ex = [];
    const texts = vocab.filter((v, k) => k % 2 === 0).map((v) => [v.text, v.play, v.seed]);
    for ( const t of ["CRUSH!", "SMASH!", "WHAM!", "CRUNCH!", "SMAAASH!", "BRZDEK!", "THWACK!", "KRAK!!"] ) for ( const m of ["impact", "crash", "boom", "roar", "crack"] ) for ( const P2 of [0.3, 0.6, 1] ) for ( let s = 0; s < 6; s++ )
      texts.push([t, { mood: m, sound: { loud: 0.3 + 0.7 * P2, pitch: 0.15 + 0.6 * P2, rough: P2 > 0.55 ? 0.25 + 0.5 * P2 : 0.1 }, ...(s % 2 ? { from: s % 4 === 1 ? 90 : -90 } : {}) }, `s${s}${t}`]);   // the dice splash sends from: 90
    for ( const [t, play, seed] of texts ) {
      const p = inv(t, { ...play, seed }); if ( p.layout.arrange === "vertical" || p.layout.lines?.length > 1 ) continue;
      settleCenter(p, bank);
      const L = p.layout.letters, ch = p.chars, pre = p.layout.pre ?? 0;
      const body = [...L.keys()].filter((i) => i >= pre && ink(ch[i]) && !L[i].skip);
      if ( body.length < 3 ) continue;
      /* a hole = space the reader pass (settleOcclusion) opened in ONE pair on top of the optical spacing: each pair's distance in the
         settled word minus the same pair's distance after the optical spacing alone (a fresh plan, kernOptical only), per cap; an even
         opening of the whole line (never a hole) is taken off as the median of the other pairs. (The pairs' optical gaps themselves
         differ by shape: a K-T meets at the bar, M-M stands off by its stems.) */
      const k0 = inv(t, { ...play, seed }); kernOptical(k0, bank); const K = k0.layout.letters;
      const gs = []; for ( let k = 1; k < body.length; k++ ) if ( body[k] === body[k - 1] + 1 && L[body[k]].link == null ) { const a = body[k - 1], b = body[k]; gs.push(((L[b].x - L[a].x) - (K[b].x - K[a].x)) / Math.min(L[a].s, L[b].s)); }
      if ( gs.length < 2 ) continue; n++;
      const last = gs.at(-1), rest = gs.slice(0, -1).sort((a, b) => a - b), med = rest[Math.floor(rest.length / 2)];
      const d = last - med; worst = Math.max(worst, d);
      if ( d > 0.03 ) { hole++; if ( ex.length < 4 ) ex.push(`${t} +${d.toFixed(3)}`); }
    }
    /* the source above or below (the dice splash: from 90) keeps the book's straight baseline: no fan, no sag */
    ok(["CRUSH!", "WHAM!"].every((t) => [90, -90].every((f) => inv(t, { mood: "crash", seed: 1, from: f }).hand.env === "flat")), "look3 last letter: a source above or below keeps the invincible baseline straight (no fan, no sag)");
    /* a caller's own curve (hand.env fan, arc): the reader parts a union-keyline pair at most a touch (0.04 cap), never a hole */
    let far = 0, fn = 0, fw = 0;
    for ( const t of ["CRUSH!", "SMASH!", "WHAM!", "CRUNCH!", "SKREE-"] ) for ( const env of ["fan", "arc", "sag"] ) for ( let s = 0; s < 8; s++ ) {
      const p = inv(t, { mood: "impact", seed: `c${s}${t}`, hand: { env } }); settleCenter(p, bank); fn++;
      const m = Math.max(0, ...p.layout.letters.map((l) => (l.pushed ?? 0) / l.s)); fw = Math.max(fw, m); if ( m > 0.04 + 1e-9 ) far++;
    }
    say(`curved words: largest part of one pair ${fw.toFixed(3)} cap over ${fn} words`);
    ok(fn > 100 && far === 0, `look3 last letter: in a curved word no pair parts more than 0.04 cap (${far} of ${fn}; largest ${fw.toFixed(3)})`);
    say(`last pair: worst extra opening over the word's median ${worst.toFixed(3)} cap over ${n} words`);
    ok(n > 300 && hole === 0, `look3 last letter: the last pair's gap is the word's own (${hole} of ${n} over +0.03 cap; worst +${worst.toFixed(3)}; ${ex.join(", ")})`);
  }
}

/* standalone: node check-look3.mjs [<letters folder of another engine>] */
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
  console.log(`look3: ${n} checks, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
