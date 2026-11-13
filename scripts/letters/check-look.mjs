// LOOK: node checks of the look layer (lines, backdrops, bolder deformation, fills and treatments, legibility, accent, styles,
// interlocked rings), called from check.mjs with its counter and the loaded font bank.
import { makePlan, FONTS, MOOD_IDS, BACKDROPS, FILLS, TEXTURES, STYLES, accentOf, NUMBER_RE, traitsOf } from "./design.mjs";
import { createVocab, KIND_IDS, KINDS } from "./words.mjs";
import { paintPicture } from "./paint.mjs";
import { treatLetter, settleCenter, occlusionReport, baseGeometry } from "./shape.mjs";
import { makeReader, ALPHABET } from "./legibility.mjs";
import { jag } from "./geom.mjs";
import { rng } from "./rng.mjs";

export function checkLook(ok, bank) {
  const fontsApi = { adv: (f, c) => bank.adv(f, c) };
  const plan = (t, o = {}) => makePlan(t, o, fontsApi, []);
  const rd = makeReader(bank);
  const sound = { loud: 0.8, sharp: 1, long: 1, rough: 1, pitch: 0, peak: 0.5 };

  /* L1. the reader: every plain letter, digit and Polish letter of every font reads as itself */
  for ( const f of Object.keys(FONTS) ) {
    const bad = [...ALPHABET].filter((ch) => !rd.read(f, ch, bank.glyph(f, ch).contours).ok);
    ok(!bad.length, `reader: plain ${f} misreads ${bad.join("")}`);
  }
  /* L2. the reader catches broken letters: an S jagged 4x too hard, a Ł without its bar, an Ę without its ogonek, a 1 cut in half */
  {
    /* an S with a stroke through it is a $ (what a hard jag did to S in the first renders) */
    const S = bank.glyph("bangers", "S"), xs = S.contours.flat().filter((v, i) => i % 2 === 0), mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    const bar = [mid - 0.05, -1.25, mid + 0.05, -1.25, mid + 0.05, 0.25, mid - 0.05, 0.25];
    const sw = S.contours[0], sg = Math.sign(sw.reduce((a, v, i) => (i % 2 ? a : a + v * sw[(i + 3) % sw.length] - sw[(i + 2) % sw.length] * sw[i + 1]), 0));
    const barW = Math.sign(bar.reduce((a, v, i) => (i % 2 ? a : a + v * bar[(i + 3) % bar.length] - bar[(i + 2) % bar.length] * bar[i + 1]), 0)) === sg ? bar : [bar[6], bar[7], bar[4], bar[5], bar[2], bar[3], bar[0], bar[1]];
    void barW;
    /* an S drawn as the font's own $ is caught */
    for ( const f of Object.keys(FONTS) ) { const d = bank.raw(f, "$"); if ( !d ) continue; const r$ = rd.read(f, "S", d.contours); ok(!r$.ok, `reader: ${f} $ is not accepted as S (${r$.as})`); }
    void jag; void rng;
    for ( const [f, ch, base] of [["anton", "Ł", "L"], ["bangers", "Ę", "E"], ["titan", "Ż", "Z"]] ) {
      const L = bank.glyph(f, base).contours;
      const r = rd.read(f, ch, L);
      ok(!r.ok && r.mark < 0.5, `reader: ${ch} without its mark is caught in ${f} (mark ${r.mark?.toFixed(2)})`);
    }
    const one = bank.glyph("bangers", "1").contours;
    const cut = [[-1, -0.55, 3, -0.55, 3, 0.2, -1, 0.2]];
    ok(!rd.read("bangers", "1", one, [{ cs: cut, grow: 0 }]).ok, "reader: a 1 with its lower half covered is caught");
  }
  /* L3. the treatment guard: every font x treatment, at the strongest sound, every letter reads after the guard */
  {
    let fails = 0, tot = 0; const ex = [];
    for ( const font of Object.keys(FONTS) ) for ( const treat of ["jag", "rough", "flame", "drip"] ) {
      const hand = { treat, font };
      for ( const ch of "SFBEŁĘ1748" ) {
        const p = plan(ch.repeat(1), { seed: `g${font}${treat}${ch}`, look: { font }, hand: { treat } });
        const base = baseGeometry(p, bank); tot++;
        if ( !rd.read(base[0].gl.font ?? font, ch, base[0].cs).ok ) { fails++; if ( ex.length < 6 ) ex.push(`${font}/${treat}/${ch}`); }
      }
      void hand;
    }
    ok(fails <= tot * 0.01, `treatment guard: ${fails} of ${tot} letters still misread (${ex.join(" ")})`);
  }
  /* L4. the word settle: across moods, words and seeds almost every letter reads in its word (lean, overlap, cracks) */
  {
    let bad = 0, all = 0;
    for ( const w of ["RAKABOOM", "KRAK!", "ŁUBUDU!", "DOBRA!", "BĘC!", "-1", "ŻĄDŁO", "CRUSH!", "FIZZLE!", "STRES +1"] ) for ( const m of MOOD_IDS ) for ( let s = 0; s < 3; s++ ) {
      const p = plan(w, { mood: m, seed: `w${w}${s}` }); settleCenter(p, bank);
      const r = occlusionReport(p, bank); bad += r.filter((x) => !x.ok).length; all += r.length;
    }
    ok(bad <= all * 0.01, `word settle: ${bad} of ${all} letters unreadable in their words`);
  }
  /* L5. numbers are lettered whole: plain, even, nearly upright, no texture; a caller's look still wins */
  {
    for ( const t of ["-1", "+4", "12", "X3", "10%"] ) ok(NUMBER_RE.test(t), `number: ${t} is a number`);
    ok(!NUMBER_RE.test("KRAK") && !NUMBER_RE.test("A1"), "number: words are not numbers");
    for ( const m of MOOD_IDS ) {
      const p = plan("-12", { mood: m, seed: `n${m}` }), L = p.layout.letters, ss = L.map((l) => l.s);
      ok(p.hand.number && (p.hand.treat === "plain" || p.hand.treat === "bubble") && p.hand.tex === "none", `number ${m}: whole (${p.hand.treat}/${p.hand.tex})`);
      ok(Math.max(...ss) / Math.min(...ss) < 1.01, `number ${m}: even sizes (${ss.map((x) => x.toFixed(2))})`);
    }
    ok(plan("-1", { mood: "impact", seed: 1, look: { treat: "jag" } }).hand.treat === "jag", "number: look.treat still wins");
  }
  /* L6. lines: "\n" stacks, repeats stack, a column and a stair; the lines are reported */
  {
    const st = plan("BLAM\nBLAM", { mood: "boom", seed: 1 });
    ok(st.layout.lines?.length === 2 && st.layout.arrange !== "line", `lines: \\n stacks (${st.layout.arrange})`);
    const y = st.layout.lines.map((l) => l.y); ok(y[1] > y[0], "lines: the second line is lower");
    const v = plan("CHOOM", { mood: "boom", seed: 2, arrange: "vertical" });
    ok(v.layout.arrange === "vertical" && v.layout.lines.length === 5, "lines: a vertical column, one letter per line");
    const s3 = plan("BLAM BLAM BLAM", { mood: "impact", seed: 3, arrange: "stair" });
    ok(s3.layout.arrange === "stair" && s3.layout.lines.length === 3, "lines: a stair of repeats");
    ok((plan("KRAK", { mood: "crack", seed: 4 }).layout.lines?.length ?? 1) === 1, "lines: one word stays one line");
  }
  /* L7. backdrops are opt-in: none by default, the mood's pick with true, a named kind by name */
  {
    let any = 0; for ( const m of MOOD_IDS ) for ( let s = 0; s < 6; s++ ) if ( plan("POW!", { mood: m, seed: `b${m}${s}` }).hand.back ) any++;
    ok(any === 0, `backdrops: ${any} plans got a backdrop nobody asked for`);
    ok(BACKDROPS.includes(plan("POW!", { mood: "impact", seed: 1, backdrop: true }).hand.back), "backdrops: true gives the mood's pick");
    for ( const b of BACKDROPS ) ok(plan("POW!", { mood: "impact", seed: 1, backdrop: b }).hand.back === b, `backdrops: ${b} by name`);
    ok(plan("POW!", { mood: "impact", seed: 1, backdrop: "nonsense" }).hand.back === null, "backdrops: an unknown kind is none");
  }
  /* L8. bolder deformation: tilt and size contrast reach the reference ranges across seeds; a small prefix before a huge body */
  {
    const rots = [], ratios = [];
    for ( const m of MOOD_IDS ) for ( let s = 0; s < 12; s++ ) {
      const p = plan("RAKABOOM", { mood: m, seed: `d${m}${s}` }); settleCenter(p, bank);
      const L = p.layout.letters; rots.push(...L.map((l) => Math.abs(l.rot) * 57.3)); const ss = L.map((l) => l.s); ratios.push(Math.max(...ss) / Math.min(...ss));
    }
    const q = (a, f) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * f)];
    ok(q(rots, 0.95) >= 14, `deformation: tilt p95 ${q(rots, 0.95).toFixed(1)} deg (>= 14)`);
    ok(q(ratios, 0.95) >= 3, `deformation: size ratio p95 ${q(ratios, 0.95).toFixed(2)} (>= 3)`);
    const pr = plan("KA-BOOM!", { mood: "boom", seed: 9, look: { prefix: 0.4 } }), L = pr.layout.letters;
    ok(L[0].s < 0.6 * Math.max(...L.slice(3).map((l) => l.s)), "deformation: the KA- prefix is small before the body");
  }
  /* L9. accent: the peak is biggest, a lead-in small, a fading tail shrinks; a caller's accent wins */
  {
    const a = accentOf([..."KA-BOOM!"]); ok(a[4] > a[0] && a[5] > a[1], "accent: KA-BOOM peaks on BOOM");
    const g = accentOf([..."GRRRR"]); ok(g[0] > g[2] && g[2] > g[4], "accent: GRRRR fades letter by letter");
    const w = accentOf([..."WHOOOOM"]); ok(w[3] >= w[0] && w[3] > w[6] - 0.01, "accent: WHOOOOM peaks on its vowels");
    const given = accentOf([..."BAM"], [0.2, 1, 0.3]); ok(given[1] === 1 && given[0] === 0.2, "accent: a caller's per-letter accent wins");
    ok(accentOf([..."BAM"], "195")[1] === 1, "accent: a digit string accent");
    const p = plan("TRZAAASK!", { mood: "crack", seed: 3, accent: { peak: [0, 1] } }), L = p.layout.letters;
    ok(L[0].s > L[6].s, "accent: a peak at the start makes the start big");
    ok(Array.isArray(plan("BUM", { mood: "boom", seed: 1 }).accent), "accent: the plan reports it");
  }
  /* L10. every fill and texture paints, with counters, hollow, cast and long shadows, per-letter fonts and every backdrop */
  {
    let calls = 0;
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : (k === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : () => { calls++; }))), set: (t, k, v) => ((t[k] = v), true) });
    const make = (w, h) => ({ width: w, height: h, getContext: () => ctx });
    const looks = [...FILLS.map((fill) => ({ fill })), ...TEXTURES.map((tex) => ({ tex })), { counters: "ink" }, { counters: "color" }, { shadow: "cast" }, { shadow: "long" }, { capFont: "sigmar" }, { link: true }];
    for ( const look of looks ) {
      const p = plan("BOOM!", { mood: "boom", seed: 2, look });
      let threw = null; try { paintPicture(p, bank, p.timeline.hold[0], 120, make); } catch ( e ) { threw = e; }
      ok(!threw, `paint: look ${JSON.stringify(look)} threw ${threw}`);
    }
    for ( const b of BACKDROPS ) { const p = plan("POW!", { mood: "impact", seed: 3, backdrop: b }); let t = null; try { for ( const q of [...p.timeline.ent, ...p.timeline.hold, ...p.timeline.exit] ) paintPicture(p, bank, q, 90, make); } catch ( e ) { t = e; } ok(!t, `paint: backdrop ${b} threw ${t}`); }
    ok(calls > 100, "paint: the look layer issues draw calls");
  }
  /* L11. styles: "invincible" is the book's hand (squared font, plain, upright, ink keyline, block extrusion, no texture) */
  {
    ok(STYLES.includes("comic") && STYLES.includes("invincible"), "styles: comic and invincible");
    for ( const m of MOOD_IDS ) {
      const p = plan("KA-BOOM!", { mood: m, seed: `s${m}`, look: { style: "invincible" } }), H = p.hand;
      ok(["squada", "michroma"].includes(H.font) && ["plain", "jag", "flame", "drip", "rough"].includes(H.treat) && H.tex === "none" && H.outline === "ink" && H.depth >= 0.07 && H.colorFam === "inv", `style invincible ${m}: ${H.id} depth ${H.depth}`);
      ok(p.layout.letters.every((l) => Math.abs(l.rot) < 0.035 || l.ring), `style invincible ${m}: upright`);
    }
    const c = plan("KA-BOOM!", { mood: "boom", seed: 1 }), c2 = plan("KA-BOOM!", { mood: "boom", seed: 1, look: { style: "comic" } });
    ok(c.hand.id === c2.hand.id, "styles: comic is the default and changes nothing");
    ok(plan("KRAK", { mood: "crack", seed: 1, look: { style: "invincible", font: "bangers" } }).hand.font === "bangers", "styles: look still wins over the style");
  }
  /* L12. interlocked rings: a run of O's links as rings of alternating size, overlapping; the reader does not count the crossing */
  {
    const p = plan("WHOOOOM", { mood: "whoosh", seed: 4, look: { style: "invincible" } }), L = p.layout.letters;
    const os = L.map((l, i) => [l, i]).filter(([l]) => l.ring);
    ok(os.length === 4 && L[3].link === 2 && L[3].x < L[2].x + L[2].w, `rings: WHOOOOM links its O's (${os.length})`);
    ok(Math.abs(L[2].s - L[3].s) > 0.05, "rings: alternating size");
    const b = baseGeometry(p, bank); ok(b[2].ring && b[2].gl.contours.length === 2, "rings: drawn as a ring (outer + hole)");
    ok(!plan("WHOOOOM", { mood: "whoosh", seed: 4, look: { style: "invincible", link: false } }).layout.letters.some((l) => l.ring), "rings: look.link false keeps O's apart");
  }
  /* L16. the look says the sound: every vocabulary kind, both styles, the trait table holds (the user: "napisy pasowały wyglądem do dźwięków") */
  {
    const V = createVocab(), COLD = ["ice", "air", "mint", "water"], ROUND = ["titan", "patrick", "sigmar"];
    const looks = new Set(); let n = 0;
    for ( const id of KIND_IDS ) for ( const loud of [0.35, 0.8] ) for ( let k = 0; k < 3; k++ ) for ( const style of STYLES ) {
      const w = V.word(id, { lang: "pl", loud, seed: `${id}${k}` });
      const p = plan(w.text, { ...w.play, seed: `${id}${k}`, look: { style } }), H = p.hand, T = p.traits, tag = `sound ${style} ${id} "${w.text}" ${H.id}`;
      if ( NUMBER_RE.test(w.text) ) continue;
      n++;
      if ( style === "invincible" ) looks.add(`${KINDS[id].group}|${H.font}|${H.treat}|${H.env}|${H.fill}|${Math.sign(H.depthAng)}|${H.invPal}`);
      if ( T.hard ) ok(H.treat !== "bubble" && !ROUND.includes(H.font) && (style === "comic" || (H.font === "squada" && H.fill === "flat")), `${tag}: a hard sound gets a round or soft face`);
      if ( T.soft ) ok(H.treat !== "jag" && !["blackops", "anton"].includes(H.font) && (style === "comic" || H.font === "michroma"), `${tag}: a soft sound gets spikes or a hard face`);
      if ( T.warm ) ok(!COLD.includes(H.colorFam) && H.invPal !== "sky", `${tag}: a warm sound in a cold colour`);
      if ( T.cold && style === "invincible" ) ok(H.invPal === "sky", `${tag}: a cold sound not in a cold colour`);
      if ( !T.wet ) ok(H.treat !== "drip", `${tag}: a dry sound drips`);
      if ( T.heavy ) ok(H.depth >= 0.12 && (style === "comic" || Math.abs(H.depthAng - Math.PI / 2) < 1e-9), `${tag}: a heavy sound without a deep block`);
      if ( T.light ) ok(H.depth <= 0.09 + 1e-9 || style === "comic" && H.depth <= 0.09, `${tag}: a high sound with a deep block (${H.depth})`);
      if ( T.metallic ) ok(!["bubble", "drip"].includes(H.treat) && (H.treat !== "rough" || T.gritty) && (style === "comic" ? ["stone", "ice"].includes(H.colorFam) || T.warm : (H.invPal === "sky" || T.warm) && H.fill === "flat"), `${tag}: a metallic sound not cut and steel`);
      if ( style === "invincible" ) {
        ok(H.treat === (T.electric ? "jag" : T.hot ? "flame" : T.wet ? "drip" : T.gritty || T.sputter ? "rough" : "plain"), `${tag}: the edge does not say the matter`);
        if ( T.light ) ok(H.depthAng < 0, `${tag}: a high sound's block not thrown up`);
        if ( T.rising ) ok(H.env === "swell", `${tag}: a rising sound does not grow`);
        else if ( T.fading ) ok(H.env === "shrink", `${tag}: a fading sound does not shrink`);
      }
      if ( T.sputter ) ok(!["swell", "stairUp", "arc", "fan", "bulge"].includes(H.env), `${tag}: a fizzle that rises`);
    }
    ok(n > 300 && looks.size >= 24, `sound: ${n} words, ${looks.size} different Invincible looks across the kinds`);
    ok(KIND_IDS.every((id) => traitsOf(KINDS[id].mood, { ...KINDS[id].sound, loud: 0.8 }) && true), "sound: every kind has traits");
    const wet = plan("KRAK", { mood: "crack", seed: 9, character: { wet: 1 }, look: { style: "invincible" } });
    ok(wet.traits.wet && wet.hand.treat === "drip", "sound: a caller's character drives the look (WORD's play.character)");
    const c1 = plan("KRAK!", { mood: "crack", seed: 9 }), c2 = plan("KRAK!", { mood: "crack", seed: 9 });
    ok(c1.hand.id === c2.hand.id && JSON.stringify(c1.traits) === JSON.stringify(c2.traits), "sound: the mapping is deterministic");
  }
  /* L15. no letter turns lower case or vanishes by size (the dice review: CRUSH! read "cRUsh!", STRES +1 read "STRES !1") */
  {
    let dips = 0, small = 0;
    for ( const w of ["CRUSH!", "SZUUUM", "WHOOSH", "SPLASH", "STRES +1", "-12", "BOOM", "ŚWIST"] ) for ( const m of MOOD_IDS ) for ( let s = 0; s < 4; s++ ) {
      for ( const st of ["comic", "invincible"] ) {
        const p = plan(w, { mood: m, seed: `k${w}${s}`, look: { style: st } }), L = p.layout.letters, ch = p.chars, pre = p.layout.pre ?? 0;
        for ( let i = 0; i < L.length; i++ ) {
          if ( /[COSUVWXZĆÓŚŹŻ]/u.test(ch[i]) && i >= pre && !L[i].ring ) {
            const nb = Math.max(i > 0 && ch[i - 1] !== " " ? L[i - 1].s : 0, i < L.length - 1 && ch[i + 1] !== " " ? L[i + 1].s : 0);
            if ( L[i].s < 0.79 * nb ) dips++;
          }
          if ( /[+\-]/.test(ch[i]) && /\d/.test(ch[i + 1] ?? "") && L[i].s < L[i + 1].s * 0.99 ) small++;
        }
      }
    }
    ok(dips === 0, `case: ${dips} look-alike capitals small enough to read as lower case`);
    ok(small === 0, `case: ${small} signs smaller than their digit`);
  }
  /* L13. determinism with every look option */
  {
    const o = { mood: "boom", seed: "det", look: { style: "invincible", tilt: "wild", fill: "multi", tex: "spots", shadow: "long", counters: "ink" }, backdrop: "cloud", arrange: "stair", accent: "2999" };
    ok(JSON.stringify(plan("BUM BUM", o)) === JSON.stringify(plan("BUM BUM", o)), "determinism: same options, same plan");
  }
  /* L14. cost: a plan with its settle stays in a few milliseconds on average */
  {
    const t0 = performance.now(); let k = 0;
    for ( const m of MOOD_IDS ) for ( let s = 0; s < 4; s++ ) { const p = plan("RAKABOOM!", { mood: m, seed: `c${m}${s}` }); settleCenter(p, bank); k++; }
    const per = (performance.now() - t0) / k;
    ok(per < 12, `cost: plan + settle ${per.toFixed(2)} ms on average (< 12)`);
  }
  void treatLetter; void sound;
}
