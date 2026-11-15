// ENGPINK (1.9.22): no lettering the engine colours by itself is pink or magenta. The owner, 2026-11-15: «Nie chcę żeby najczęstsze
// napisy były różowe» (I do not want the most common lettering to be pink). The band is the callers' (invincible-plus-ultra
// sweep-checks/palette.mjs): OKLCH hue 290..360 or 0..15, chroma >= 0.04, lightness >= 0.3. Measured here with this file's OWN colour maths
// (not design.mjs's), so a wrong isPink cannot hide a pink colour:
//   1  the band itself: the same verdicts as the callers' check on their probe colours, and design.mjs isPink agrees with this file;
//   2  every engine table colour (INV, COLORS fills / blocks / second outlines / ink, prefs CVD and CONTRAST, the Okabe-Ito set in use);
//   3  the computed colours: unpinkHsl and recolor leave every colour outside the band exactly as it was and move every colour inside out;
//   4  the replaced families still do their job: the invincible violet apart from the other invincible faces for normal, protan, deutan
//      and tritan eyes (OKLab), readable on its keyline and on a dark board; the changed colour-blind families apart from every other
//      colour-blind family face for all four visions, and on their keyline;
//   5  (--engine, own process) every word of every sound kind, both languages, three loudnesses, in every style (invincible League
//      Gothic and Anton, comic, expressive), every table palette (mood, contrast, cvd), screen and world, plus every colour family asked
//      by name: the plan's colours AND every colour painted (fills, strokes, gradient stops, shadows on a recording context) of the
//      entrance, hold, exit and colour-plate pictures. A caller's own colours stay the caller's and are not swept.
// Called from check.mjs (pure part in process, section 16 spawns --engine); standalone: node check-pink.mjs [--engine] [<letters folder>]
// (an older engine fails both parts).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* ---------------- own colour maths ---------------- */
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255)); };
const labOf = ([r, g, b]) => { const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]; };
const HEX = /^#[0-9a-f]{6}$/i;
export const lchOf = (hex) => { const [L, a, b] = labOf(rgbOf(hex)); return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }; };
export const BAND = { from: 290, to: 15, minC: 0.04, minL: 0.3 };
export const pinkHex = (hex) => { if ( !HEX.test(hex ?? "") ) return false; const o = lchOf(hex); return o.C >= BAND.minC && o.L >= BAND.minL && (o.h >= BAND.from || o.h < BAND.to); };
const MACHADO = { protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]] };
const VISIONS = ["normal", "protan", "deutan", "tritan"];
const seen = (hex, v) => { const c = rgbOf(hex); return MACHADO[v] ? MACHADO[v].map((r) => Math.min(1, Math.max(0, r[0] * c[0] + r[1] * c[1] + r[2] * c[2]))) : c; };
const dE = (a, b, v) => { const p = labOf(seen(a, v)), q = labOf(seen(b, v)); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const lum = (hex) => { const [r, g, b] = rgbOf(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/* any CSS colour the painter writes -> #rrggbb (hsl/hsla with the painter's rounding, rgb/rgba, hex); else null */
export function toHex(s) {
  if ( typeof s !== "string" ) return null;
  const t = s.replace(/\s/g, "");
  if ( HEX.test(t) ) return t.toLowerCase();
  let m = /^hsla?\(([-\d.e]+),([\d.]+)%,([\d.]+)%/.exec(t);
  if ( m ) {
    const h = (((+m[1] % 360) + 360) % 360) / 360, sa = +m[2] / 100, l = +m[3] / 100, q = l < 0.5 ? l * (1 + sa) : l + sa - l * sa, p = 2 * l - q;
    const f = (x) => { x = (x + 1) % 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 0.5 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
    return "#" + [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
  }
  m = /^rgba?\((\d+),(\d+),(\d+)/.exec(t);
  if ( m ) return "#" + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, "0")).join("");
  return null;
}

/* ---------------- pure part ---------------- */
export async function run(ok, { dir = null, verbose = !!process.env.LETR_VERBOSE } = {}) {
  const at = (f) => (dir ? new URL(f, pathToFileURL(dir.replace(/[\\/]?$/, "/"))).href : new URL(`./${f}`, import.meta.url).href);
  /* fresh module copies: the engine's own tables, without palettes another suite registered in this process (check-tools adds a pink "duo") */
  const D = await import(at("design.mjs") + "?pink"), Pr = await import(at("prefs.mjs") + "?pink");
  const say = (...a) => { if ( verbose ) console.log("  pink:", ...a); };

  /* 1. the band */
  ok(pinkHex("#d1a3ff") && pinkHex("#ff4fae") && pinkHex("#ffa3ad") && pinkHex("#b36dff") && pinkHex("#cc79a7")
    && !pinkHex("#ec2a2b") && !pinkHex("#ff3b52") && !pinkHex("#8a7bff") && !pinkHex("#2b0c5a") && !pinkHex("#ffffff") && !pinkHex("#a8a8a8"),
    "pink 1: the band catches lilac, hot pink, rose, the old engine violet and Okabe-Ito's reddish purple, not red, blood red, indigo, a near-black block or greys (the callers' verdicts)");
  ok(typeof D.isPink === "function" && typeof D.unpinkHsl === "function" && D.PINK?.from === BAND.from && D.PINK?.to === BAND.to && D.PINK?.minC === BAND.minC && D.PINK?.minL === BAND.minL,
    "pink 1: design.mjs has the band (PINK, isPink, unpinkHsl) with the callers' bounds");
  if ( typeof D.isPink === "function" ) {
    let bad = 0; const R = (() => { let s = 7; return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); })();
    for ( let i = 0; i < 4000; i++ ) { const h = "#" + Math.floor(R() * 0x1000000).toString(16).padStart(6, "0"); if ( D.isPink(h) !== pinkHex(h) ) bad++; }
    ok(bad === 0, `pink 1: design.mjs isPink agrees with this file's own measure on 4000 random colours (${bad} differ)`);
  }

  /* 2. every table colour */
  const tableColours = [];
  const add = (where, v) => { for ( const c of [v].flat(3) ) if ( typeof c === "string" ) tableColours.push([where, c]); };
  for ( const [fam, pals] of Object.entries(D.COLORS) ) pals.forEach((p, i) => { add(`COLORS.${fam}[${i}].fill`, p.fill); add(`COLORS.${fam}[${i}].ext`, p.ext); add(`COLORS.${fam}[${i}].out2`, p.out2); add(`COLORS.${fam}[${i}].ink`, p.ink); });
  for ( const [fam, p] of Object.entries(Pr.CVD ?? {}) ) { add(`CVD.${fam}.fill`, p.fill); add(`CVD.${fam}.ext`, p.ext); add(`CVD.${fam}.out2`, p.out2); add(`CVD.${fam}.ink`, p.ink); }
  if ( Pr.CONTRAST ) add("CONTRAST", [Pr.CONTRAST.fill, Pr.CONTRAST.ext, Pr.CONTRAST.out2, Pr.CONTRAST.ink]);
  /* the impact frames tones (L.impact; plus-ultra letters a villain roll in "void") and the literal colours its painter uses */
  const Ip = await import(at("impact/plan.mjs")).catch(() => null);
  for ( const [t, c] of Object.entries(Ip?.TONES ?? {}) ) add(`impact TONES.${t}`, [c.a, c.b]);
  if ( Ip?.SAFE_RED ) add("impact SAFE_RED", Ip.SAFE_RED);
  { const fs = await import("node:fs"); const src = fs.readFileSync(new URL(at("impact/draw.mjs")), "utf8"); for ( const m of src.matchAll(/"(#[0-9a-f]{6})"/gi) ) add("impact draw.mjs literal", m[1].toLowerCase()); }
  const inv = D.COLORS.inv ?? [];
  const badT = tableColours.filter(([, c]) => pinkHex(c));
  ok(tableColours.length > 300 && badT.length === 0, `pink 2: no engine table colour in the band (${tableColours.length} colours: INV, COLORS, CVD, CONTRAST, impact tones and painter literals)${badT.length ? ": " + badT.slice(0, 8).map(([w, c]) => `${w} ${c} h${lchOf(c).h.toFixed(0)}`).join("; ") : ""}`);
  ok(tableColours.every(([, c]) => HEX.test(c)), "pink 2: every table colour is a plain #rrggbb (so this sweep reads all of them)");

  /* 3. computed colours */
  if ( typeof D.unpinkHsl === "function" ) {
    let moved = 0, kept = 0, wrongKeep = 0, stillPink = 0;
    for ( let h = 0; h < 360; h += 7.3 ) for ( const s of [0, 20, 55, 80, 100] ) for ( const l of [12, 30, 50, 66, 85, 96] ) {
      const was = pinkHex(toHex(`hsla(${h},${s}%,${l}%,1)`)), h2 = D.unpinkHsl(h, s, l), now = pinkHex(toHex(`hsla(${h2},${s}%,${l}%,1)`));
      if ( was ) { moved++; if ( now ) stillPink++; } else { kept++; if ( h2 !== h ) wrongKeep++; }
    }
    ok(moved > 50 && stillPink === 0, `pink 3: unpinkHsl moves every computed colour in the band out of it (${moved} tried, ${stillPink} still pink)`);
    ok(kept > 500 && wrongKeep === 0, `pink 3: unpinkHsl leaves every colour outside the band exactly as it was (${kept} tried, ${wrongKeep} changed)`);
  }
  if ( typeof D.recolor === "function" ) {
    let bad = 0, changed = 0, n = 0;
    for ( const [, c] of tableColours ) for ( const dh of [60, 120, 180, 240] ) { n++; if ( pinkHex(D.recolor(c, dh, 0)) ) bad++; }
    ok(n > 1000 && bad === 0, `pink 3: recolor (the legacy styles' per-letter colours) never turns a table colour into the band (${n} turns, ${bad} pink)`);
    void changed;
  }

  /* 4. the replaced families still do their job */
  const INV = Object.fromEntries(inv.map((p) => [p.fill[1], p]));
  const violet = inv.find((p) => { const o = lchOf(p.fill[1]); return o.C > 0.15 && o.h > 270 && o.h < 330; });
  ok(!!violet, "pink 4: the invincible style keeps a violet family (power, mind)");
  if ( violet ) {
    const others = Object.keys(INV).filter((c) => c !== violet.fill[1]);
    const near = Object.fromEntries(VISIONS.map((v) => [v, Math.min(...others.map((c) => dE(violet.fill[1], c, v)))]));
    say("violet", violet.fill[1], JSON.stringify(Object.fromEntries(Object.entries(near).map(([k, x]) => [k, +x.toFixed(3)]))));
    /* the old violet #b36dff had 0.164 / 0.032 / 0.048 / 0.146 to its nearest face (the blue): the new one may not be harder to tell apart
       for a colour-blind viewer; 0.1 normal is the callers' 0.08 with room */
    ok(near.normal >= 0.1 && near.protan >= 0.05 && near.deutan >= 0.05 && near.tritan >= 0.05,
      `pink 4: the invincible violet ${violet.fill[1]} stays apart from every other invincible face (OKLab nearest: normal ${near.normal.toFixed(3)} >= 0.1, protan ${near.protan.toFixed(3)} / deutan ${near.deutan.toFixed(3)} / tritan ${near.tritan.toFixed(3)} >= 0.05)`);
    ok(cr(violet.fill[1], violet.ink) >= 3 && cr(violet.fill[1], "#16171d") >= 3 && cr(violet.fill[1], violet.ext) >= 3,
      `pink 4: the violet face reads on its keyline (${cr(violet.fill[1], violet.ink).toFixed(1)}:1), on a dark board (${cr(violet.fill[1], "#16171d").toFixed(1)}:1) and against its block (${cr(violet.fill[1], violet.ext).toFixed(1)}:1), all >= 3`);
  }
  const CVD = Pr.CVD ?? {};
  const faces = Object.entries(CVD).map(([k, p]) => [k, p.fill[1]]);
  const bad4 = [];
  for ( const fam of ["pop", "beast", "plasma", "bruise"] ) {
    if ( !CVD[fam] ) { bad4.push(`${fam} missing`); continue; }
    const f = CVD[fam].fill[1];
    for ( const v of VISIONS ) {
      const d = Math.min(...faces.filter(([k, c]) => k !== fam && c !== f).map(([, c]) => dE(f, c, v)));
      if ( d < 0.06 ) bad4.push(`${fam} ${f} ${v} ${d.toFixed(3)}`);
    }
    if ( cr(f, CVD[fam].ink) < 3 ) bad4.push(`${fam} ${f} on its keyline ${cr(f, CVD[fam].ink).toFixed(1)}:1`);
  }
  ok(bad4.length === 0, `pink 4: the changed colour-blind families (pop, beast, plasma, bruise) stay apart from every other colour-blind family face for normal, protan, deutan and tritan eyes (OKLab >= 0.06; the old pink one had 0.047 deutan) and read on their keyline${bad4.length ? ": " + bad4.join("; ") : ""}`);
}

/* ---------------- the engine sweep (own process: replaces globals) ---------------- */
export async function engineChecks(dir0) {
  const dir = pathToFileURL(dir0.replace(/[\\/]?$/, "/")).href;
  let n = 0, failed = 0;
  const ok = (c, msg) => { n++; if ( !c ) { failed++; console.log("FAIL", msg); } else if ( process.env.LETR_VERBOSE ) console.log("ok  ", msg); };
  globalThis.__letrRealST ??= setTimeout;
  const { setup } = await import(dir + "testenv.mjs");
  const Prefs = await import(dir + "prefs.mjs"), D = await import(dir + "design.mjs"), P = await import(dir + "paint.mjs"), Sh = await import(dir + "shape.mjs"), W = await import(dir + "words.mjs");
  const E = await setup(); const L = E.engine; const bank = L._bank;
  function recorder() {
    const log = []; const st = [{ fs: "#000", ss: "#000" }]; let cur = st[0];
    const SETS = new Set(["lineWidth", "globalAlpha", "globalCompositeOperation", "lineJoin", "lineCap", "miterLimit", "filter", "font", "textAlign", "textBaseline", "shadowBlur", "shadowOffsetX", "shadowOffsetY", "imageSmoothingEnabled", "lineDashOffset"]);
    const ctx = new Proxy({}, {
      get(_, k) {
        if ( k === "fillStyle" ) return cur.fs; if ( k === "strokeStyle" ) return cur.ss;
        if ( k === "save" ) return () => { st.push(cur = { ...cur }); };
        if ( k === "restore" ) return () => { if ( st.length > 1 ) st.pop(); cur = st.at(-1); };
        if ( k === "createLinearGradient" || k === "createRadialGradient" || k === "createConicGradient" ) return () => ({ addColorStop(t, c) { log.push(c); } });
        if ( k === "fill" || k === "fillRect" ) return () => log.push(cur.fs);
        if ( k === "stroke" || k === "strokeRect" ) return () => log.push(cur.ss);
        if ( k === "getImageData" ) return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) });
        if ( k === "measureText" ) return () => ({ width: 1 });
        if ( k === "createPattern" ) return () => "pattern";
        if ( k === "canvas" ) return { width: 1, height: 1 };
        if ( typeof k === "string" && !SETS.has(k) && /^[a-z]/.test(k) ) return () => {};
        return cur[k];
      },
      set(_, k, v) {
        if ( k === "fillStyle" ) cur.fs = typeof v === "string" ? v : "gradient"; else if ( k === "strokeStyle" ) cur.ss = typeof v === "string" ? v : "gradient";
        else { cur[k] = v; if ( k === "shadowColor" ) log.push(v); }
        return true;
      }
    });
    return { log, make: (w, h) => ({ width: w, height: h, getContext: () => ctx }) };
  }
  const styles = [["invincible", "league"], ["invincible", "anton"], ["comic"], ["expressive"]];
  const palettes = ["mood", "contrast", "cvd"];
  let words = 0; const hits = [];
  const sweep = (key, text, o, palette) => {
    const plan = L._plan(text, o);
    Prefs.filterPlan(plan, o, { prefs: { ...Prefs.seatPrefs(Prefs.TABLE_DEFAULTS, {}), palette }, colors: D.COLORS, TICK: D.TICK, flashLog: [], now: 0, t0: 0, capPx: 60, vh: 900 });
    Sh.settleCenter(plan, bank);
    const H = plan.hand, tl = plan.timeline, all = [...tl.ent, ...tl.hold, ...tl.exit];
    const pics = [...new Set([tl.ent[0], tl.ent.at(-1), tl.hold[0], tl.exit[0], all.find((p) => p.misreg > 0)].filter(Boolean))];
    const cols = [...(H.pal?.fill ?? []), H.pal?.ext, H.pal?.out2, H.ink, H.fill === "hollow" ? H.hollowPaper : null, ...(H.alt ?? [])];
    for ( const pic of pics ) { const r = recorder(); P.paintPicture(plan, bank, pic, 64, r.make); cols.push(...r.log); }
    const pk = [...new Set(cols.map(toHex).filter(pinkHex))];
    words++;
    if ( pk.length ) hits.push(`${key} ${text}: ${pk.slice(0, 3).join(" ")}`);
  };
  const tally = {};
  for ( const [style, face] of styles ) for ( const palette of palettes ) {
    const before = hits.length;
    const look = { style, ...(face ? { face, motion: "smooth" } : {}) };
    for ( const kind of W.KIND_IDS ) for ( const lang of ["en", "pl"] ) for ( const loud of [0.2, 0.6, 1] ) {
      const w = L.word(kind, { lang, loud, long: 0.5, seed: `pink:${kind}` });
      if ( !w?.text ) continue;
      for ( const space of style === "invincible" ? ["screen", "world"] : ["screen"] ) sweep(`${style}${face ? "/" + face : ""} ${palette} ${kind} ${lang} ${loud} ${space}`, w.text, { ...w.play, seed: `pink:${kind}:${lang}:${loud}`, look, space }, palette);
    }
    for ( const fam of Object.keys(D.COLORS) ) for ( const seed of [1, 2, 3, 4] ) sweep(`${style}${face ? "/" + face : ""} ${palette} family ${fam}`, "KA-BLAMM!", { mood: "impact", seed: `pinkf:${fam}:${seed}`, look, palette: fam }, palette);
    tally[`${style}${face ? "/" + face : ""} ${palette}`] = hits.length - before;
  }
  for ( const [k, v] of Object.entries(tally) ) ok(v === 0, `pink 5: ${k}: no pink in any word's plan or painted colours (every kind x en/pl x 3 loudnesses${k.startsWith("invincible") ? " x screen/world" : ""} + every family by name)${v ? `: ${v} words, e.g. ${hits.filter((h) => h.startsWith(k + " ")).slice(0, 3).join("; ")}` : ""}`);
  ok(words > 8000, `pink 5: the sweep painted ${words} letterings`);
  E.restoreWarn?.();
  console.log(`pink-engine: ${n} checks, ${failed} failed`);
  return failed;
}

if ( process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] ) {
  const other = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const dir = other ? path.resolve(other) : path.dirname(fileURLToPath(import.meta.url));
  if ( process.argv.includes("--engine") ) process.exit((await engineChecks(dir)) ? 1 : 0);
  let n = 0, failed = 0;
  await run((c, msg) => { n++; if ( !c ) { failed++; console.log("FAIL", msg); } else if ( process.env.LETR_VERBOSE ) console.log("ok  ", msg); }, { dir: other ? dir : null });
  console.log(`pink-pure: ${n} checks, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
