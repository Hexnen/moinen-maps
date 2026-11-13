// WORD: node checks of the vocabulary layer (words.mjs), called from check.mjs with its counter and the loaded font bank.
// Coverage of every sound kind in both languages and tiers, every word renderable in every font (Polish letters included, F23: no
// silent "?"), determinism and variation, loudness -> tier/stretch/prefix, escalation series, streams, additions and overrides,
// number formatting (REQUESTS ldic 6), and the engine's public surface (L.word / L.sfx / L.vocab / stream kind).
import fs from "node:fs";
import { createVocab, KINDS, KIND_IDS, BANK, expand, stretchText, formatNumber, formatRange, clean, renderable, langOf, MAX_LEN, MAX_RUN } from "./words.mjs";
import { FONTS, FALLBACK, MOOD_IDS, makePlan } from "./design.mjs";

const IN = ["slam", "pop", "crackIn", "drop", "rise", "grow", "zip"], HOLD = ["boil", "shake", "throb", "rattle", "wobble", "buzz", "flicker"],
  OUT = ["shatter", "pop", "burst", "fall", "droop", "rise", "shrink", "zipout", "dissolve"];

export function checkWords(ok, bank) {
  const V = createVocab();
  const fontsApi = { adv: (f, c) => bank.adv(f, c) };
  /* a glyph is "lettered" when it is not the "?" stand-in the bank gives a character no font (or synthesis) has */
  const q = new Set(Object.keys(FONTS).map((id) => bank.raw(id, "?")?.contours).concat([bank.raw(FALLBACK[0], "?")?.contours]));
  const missing = (font, word) => [...clean(word)].filter((ch) => ch !== " " && ch !== "?" && (() => { const g = bank.glyph(font, ch); return !g || !g.contours.length || q.has(g.contours); })());

  /* 1. coverage: every kind has a definition, words in pl AND en in all three tiers, a valid mood and valid motions */
  for ( const id of KIND_IDS ) {
    const k = KINDS[id];
    ok(MOOD_IDS.includes(k.mood), `words: ${id} has an unknown mood ${k.mood}`);
    ok(k.motion.in.every((m) => IN.includes(m)) && k.motion.hold.every((m) => HOLD.includes(m)) && k.motion.out.every((m) => OUT.includes(m)), `words: ${id} names a motion the engine does not have`);
    ok(k.label?.pl && k.label?.en, `words: ${id} has no Polish or English label`);
    for ( const lang of ["pl", "en"] ) {
      const b = BANK[lang][id];
      ok(!!b, `words: ${id} has no ${lang} words`);
      if ( !b ) continue;
      for ( const t of ["s", "m", "l"] ) ok(b[t]?.length >= 2, `words: ${lang}/${id}/${t} has fewer than 2 words`);
      ok(b.s.length + b.m.length + b.l.length >= 8, `words: ${lang}/${id} has fewer than 8 words`);
    }
  }
  ok(Object.keys(BANK.pl).every((id) => KINDS[id]) && Object.keys(BANK.en).every((id) => KINDS[id]), "words: every bank entry is a defined kind");
  ok(KIND_IDS.length >= 40, `words: only ${KIND_IDS.length} sound kinds`);

  /* 2. every word, plain and at full stretch and with every prefix, letters in every font: no "?" and no character outside the set */
  let bad = [], words = 0;
  for ( const lang of ["pl", "en"] ) for ( const id of KIND_IDS ) for ( const [tier, list] of Object.entries(BANK[lang][id]) ) for ( const tpl of list ) {
    const forms = [expand(tpl, 0), expand(tpl, 8), ...(KINDS[id].pre?.[lang] ?? []).map((p) => p + expand(tpl, 3))];
    ok(!/\n/.test(tpl) && tpl === tpl.normalize("NFC") && tpl === tpl.toLocaleUpperCase("pl"), `words: ${lang}/${id} "${tpl}" is not one NFC upper-case line`);
    ok(expand(tpl, 0).replace(/\+/g, "").length <= MAX_LEN, `words: ${lang}/${id} "${tpl}" is longer than ${MAX_LEN}`);
    for ( const w of forms ) {
      words++;
      if ( !renderable(w) ) bad.push(`${lang}/${id} ${w} (character set)`);
      for ( const f of Object.keys(FONTS) ) { const m = missing(f, w); if ( m.length ) bad.push(`${lang}/${id} ${w} in ${f}: ${m.join("")}`); }
    }
  }
  ok(bad.length === 0, `words: ${bad.length} word forms not lettered by every font: ${bad.slice(0, 6).join("; ")}`);
  ok(words > 1500, `words: only ${words} word forms checked`);
  /* the Polish set really is Polish: its own letters appear, and it is not the English list */
  const plAll = Object.values(BANK.pl).flatMap((b) => [...b.s, ...b.m, ...b.l]).join(" ");
  ok([..."ĄĆĘŁŃÓŚŹŻ"].filter((c) => plAll.includes(c)).length >= 6, "words: the Polish set uses Polish letters");
  let same = 0; for ( const id of KIND_IDS ) if ( JSON.stringify(BANK.pl[id].m) === JSON.stringify(BANK.en[id].m) ) same++;
  ok(same === 0, `words: ${same} kinds have identical Polish and English words`);

  /* 3. determinism and variation */
  for ( const id of KIND_IDS ) for ( const lang of ["pl", "en"] ) {
    const a = V.word(id, { lang, seed: "m1", loud: 0.6 }), b = V.word(id, { lang, seed: "m1", loud: 0.6 });
    ok(a.text === b.text && JSON.stringify(a.play) === JSON.stringify(b.play), `words: ${lang}/${id} same seed, different word`);
    const seen = new Set(); for ( let i = 0; i < 24; i++ ) seen.add(V.word(id, { lang, seed: `v${i}`, loud: 0.5 }).template);
    ok(seen.size >= 2, `words: ${lang}/${id} does not vary with the seed`);
    ok(a.lang === lang && a.kind === id && a.mood === KINDS[id].mood && Number.isFinite(a.play.magnitude), `words: ${lang}/${id} result fields`);
  }
  { /* unseeded: never the same word twice in a row; seeded ignores that memory (ldic 3: same roll, same word on every seat) */
    let rep = 0, prev = null;
    for ( let i = 0; i < 200; i++ ) { const w = V.word("punch", { lang: "pl", loud: 0.5 }).text; if ( w === prev ) rep++; prev = w; }
    ok(rep === 0, `words: unseeded words repeated ${rep}/200 times in a row`);
    const W2 = createVocab(); for ( let i = 0; i < 9; i++ ) W2.word("punch", { lang: "pl", loud: 0.5 });
    ok(W2.word("punch", { lang: "pl", seed: "z", loud: 0.5 }).text === createVocab().word("punch", { lang: "pl", seed: "z", loud: 0.5 }).text, "words: a seeded word does not depend on the client's memory");
    const w = V.word("crack", { lang: "en", seed: "a", loud: 0.5 }), x = V.word("crack", { lang: "en", seed: "a", loud: 0.5, avoid: [w.template] });
    ok(x.template !== w.template, "words: avoid skips a word");
  }

  /* 4. loudness: quiet = short tier without "!", loud = loud tier, stretched; magnitude maps onto loudness; repeats keep growing */
  for ( const id of KIND_IDS ) for ( const lang of ["pl", "en"] ) {
    const s = V.word(id, { lang, seed: 1, loud: 0.1 }), l = V.word(id, { lang, seed: 1, loud: 1 });
    ok(s.tier === "s" && l.tier === "l" && !/!$/.test(s.text), `words: ${lang}/${id} tiers by loudness`);
    ok(l.sound.loud > s.sound.loud && l.play.magnitude > s.play.magnitude, `words: ${lang}/${id} loudness reaches the engine`);
    const t = V.word(id, { lang, seed: 2, loud: 0.35 }).template;
    ok(V.word(id, { lang, template: t, loud: 1, prefix: false }).text.length >= V.word(id, { lang, template: t, loud: 0.35, prefix: false }).text.length, `words: ${lang}/${id} a louder sound is not shorter`);
    ok(!new RegExp(`(\\p{L})\\1{${MAX_RUN},}`, "u").test(V.word(id, { lang, seed: 3, loud: 1, step: 6 }).text), `words: ${lang}/${id} a letter repeated more than ${MAX_RUN} times`);
  }
  ok(V.word("boom", { lang: "en", magnitude: "epic", seed: 1 }).tier === "l" && V.word("boom", { lang: "en", magnitude: "tiny", seed: 1 }).tier === "s", "words: magnitude words pick the tier");
  ok(V.word("boom", { lang: "en", seed: 1 }).play.magnitude === 0.5, "words: the default loudness is the engine's normal magnitude");
  ok(/^(KA-|TRA-TA-)BU+M!$/.test(V.word("boom", { lang: "pl", loud: 1, prefix: true, template: "BU+M!" }).text), "words: a prefix for the loudest");
  ok(V.word("boom", { lang: "pl", loud: 1, prefix: "KA-", template: "BU+M!" }).text === "KA-BUUUUM!", `words: stretch and prefix (${V.word("boom", { lang: "pl", loud: 1, prefix: "KA-", template: "BU+M!" }).text})`);
  /* 5. escalation (MOVE's seam): one sound repeated grows; never the same text twice in a row */
  for ( const grow of ["stretch", "vary"] ) for ( const id of ["crack", "boom", "punch", "zap", "gunshot", "pain"] ) for ( const lang of ["pl", "en"] ) {
    const s = V.series(id, 6, { lang, seed: "e", loud: 0.3, grow });
    ok(s.length === 6 && s.every((w, i) => i === 0 || w.text !== s[i - 1].text), `words: ${grow} series ${lang}/${id} repeats a word: ${s.map((w) => w.text).join(" ")}`);
    ok(s.every((w, i) => i === 0 || w.sound.loud >= s[i - 1].sound.loud), `words: ${grow} series ${lang}/${id} gets quieter`);
    if ( grow === "stretch" ) ok(s.every((w, i) => i === 0 || w.text.length >= s[i - 1].text.length), `words: stretch series ${lang}/${id} shrinks: ${s.map((w) => w.text).join(" ")}`);
  }
  { const s = V.series("pain", 10, { lang: "pl", seed: "q", loud: 1 }); ok(s.slice(0, 5).every((w, i, a) => i === 0 || w.text !== a[i - 1].text) && s.every((w, i, a) => i === 0 || w.text.length >= a[i - 1].text.length), `words: a long escalation grows for 5 steps and never shrinks: ${s.map((w) => w.text).join(" ")}`); }
  ok(V.grow("KRAK!", 2) === "KRAAAK!" && V.grow("BZZT", 3) === "BZZZZZT" && V.grow("12", 3) === "12" && V.grow("BU+M", 2) === "BUUUM", `words: grow() stretches plain text (${V.grow("KRAK!", 2)} ${V.grow("BZZT", 3)})`);
  ok(stretchText("TRA-TA-TA", 2) === "TRA-TA-TAAA" && stretchText("KA-BZZT", 3) === "KA-BZZZZZT", "words: only the last syllable stretches (never a prefix)");
  for ( const id of ["gunfire", "laugh", "siren"] ) for ( const lang of ["pl", "en"] ) {
    const s = V.series(id, 3, { lang, seed: "r", loud: 0.3 }), dash = (t) => (t.match(/-/g) ?? []).length;
    ok(dash(s[1].text) > dash(s[0].text) && dash(s[2].text) > dash(s[1].text), `words: a repeating sound grows by syllables (${lang}/${id}: ${s.map((w) => w.text).join(" ")})`);
  }
  /* 6. streams: syllables for L.stream */
  for ( const id of KIND_IDS ) for ( const lang of ["pl", "en"] ) {
    const syl = V.syllables(id, { lang, seed: 1 });
    ok(Array.isArray(syl) && syl.length >= 1 && syl.every((x) => x.length >= 1 && renderable(x)), `words: ${lang}/${id} stream syllables`);
  }
  ok(V.syllables("gunfire", { lang: "pl", seed: 1 }).length >= 3 && V.syllables("gunfire", { lang: "en", seed: 1 }).length >= 3, "words: gunfire rattles in syllables");
  /* 7. aliases, unknown kinds, languages */
  ok(V.kindOf("explosion") === "boom" && V.kindOf("Laser") === "beam" && V.kindOf("machinegun") === "gunfire" && V.kindOf("hit") === "punch", "words: aliases");
  { const w = console.warn; let n = 0; console.warn = () => n++; ok(V.word("no-such-sound", { seed: 1 }).kind === "punch", "words: an unknown kind falls back"); V.word("no-such-sound", { seed: 2 }); console.warn = w; ok(n === 1, "words: one warning per unknown kind"); }
  ok(langOf("pl") === "pl" && langOf("en-US") === "en" && langOf("de") === "en" && langOf("pl-PL") === "pl", "words: languages");
  { const g = globalThis.game; globalThis.game = { i18n: { lang: "pl" } }; ok(V.word("crack", { seed: 1 }).lang === "pl" && V.word("crack", { seed: 1, lang: "auto" }).lang === "pl", "words: auto = the game's language"); globalThis.game = g; }
  ok(V.word("crack", { seed: 1, lang: "de" }).lang === "en", "words: an unknown language falls back to English");
  /* 8. additions and overrides by callers and other modules */
  {
    const W = createVocab(), warn = console.warn; console.warn = () => {};
    const r = W.add("pl", "gunfire", ["TRRT!", "TA-TA-TRRT!", "😀", "A​B", "TRA-TA-TA-TA-TA-TA-TA-TA-TA!"]);
    console.warn = warn;
    ok(r.refused.length === 3 && W.all("gunfire", "pl").s.concat(W.all("gunfire", "pl").m, W.all("gunfire", "pl").l).includes("TRRT!"), `words: add merges, refuses what cannot be lettered (${r.refused.join(",")})`);
    W.add("pl", "crack", { s: ["KNAK!"], m: ["KNA+K!"], l: ["KNA+A+K!"] }, { replace: true });
    ok(W.word("crack", { lang: "pl", seed: 5, loud: 0.1 }).text === "KNAK" && W.word("crack", { lang: "pl", seed: 5, loud: 1, prefix: false }).text.startsWith("KNAA"), "words: replace overrides a kind");
    W.define("webshot", { group: "power", mood: "whoosh", label: { pl: "sieć", en: "web" }, alias: ["web"] });
    W.add("en", "webshot", { s: ["THWIP!", "THWP!"], m: ["THWI+P!", "THWIP-THWIP!"], l: ["THWI+I+P!", "KA-THWI+P!"] });
    ok(W.word("web", { lang: "en", seed: 1 }).kind === "webshot" && W.word("web", { lang: "pl", seed: 1 }).lang === "en", "words: a new kind, found by alias; a missing language falls back to English");
    ok(W.list("pl").some((k) => k.id === "webshot" && k.label === "sieć") && W.choices("pl").crack === "trzask", "words: list and choices for pickers, Polish labels");
    ok(W.remove("pl", "punch", ["PAC!"]) === 1 && !W.all("punch", "pl").s.includes("PAC!"), "words: remove");
    W.reset(); ok(W.all("punch", "pl").s.includes("PAC!") && !W.kinds.includes("webshot"), "words: reset");
    ok(!createVocab().kinds.includes("webshot"), "words: each engine has its own vocabulary (tests do not leak)");
  }
  /* 9. numbers for callers that letter numbers (REQUESTS ldic 6) */
  const N = (n, o) => formatNumber(n, o);
  const cases = [[N(3, { times: true }), "3×"], [N(3, { times: "before" }), "×3"], [N(1500, { lang: "en" }), "1,500"], [N(1500, { lang: "pl" }), "1500"],
    [N(12500, { lang: "pl" }), "12 500"], [N(12500, { lang: "en" }), "12,500"], [N(-3), "-3"], [N(2, { sign: "always" }), "+2"], [N(0, { sign: "always" }), "0"],
    [N(2.5, { lang: "pl" }), "2,5"], [N(2.5, { lang: "en" }), "2.5"], [N(1234567, { lang: "en", compact: true }), "1.2M"], [N(1234567, { lang: "pl", compact: true }), "1,2 MLN"],
    [N(12000, { lang: "pl", compact: true }), "12 TYS."], [N(45, { percent: true }), "45%"], [formatRange(2, 4), "2–4"], [formatRange(3, 3), "3"],
    [formatRange(1000, 12000, { lang: "pl" }), "1000–12 000"], [N(NaN), "?"], [N(-1500, { lang: "en", sign: "never" }), "1,500"]];
  for ( const [got, want] of cases ) ok(got === want, `words: number ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  for ( const [got] of cases ) for ( const f of Object.keys(FONTS) ) ok(!missing(f, got).length, `words: number ${got} not lettered by ${f}`);
  ok(makePlan(N(-12500, { lang: "pl" }), {}, fontsApi, []).mood === "pain" && makePlan(N(3, { sign: "always" }), {}, fontsApi, []).mood === "heal", "words: signed numbers keep the engine's auto mood");
  /* 10. a vocabulary word plans like any text (the engine sees only the text) */
  for ( const id of KIND_IDS ) { const w = V.word(id, { lang: "pl", seed: 7, loud: 0.8 }); const p = makePlan(w.text, { ...w.play, seed: 7 }, fontsApi, []); ok(p.mood === w.mood && p.word === w.text, `words: ${id} plans with its mood`); }
  /* 11. the engine exposes it (source pins: the API names other modules call) */
  const eng = fs.readFileSync(new URL("./engine.mjs", import.meta.url), "utf8");
  ok(/vocab, word: vocab\.word, sfx, number: vocab\.number, range: vocab\.range/.test(eng) && /function sfx\(kind, opts = \{\}\)/.test(eng) && /o\.kind != null && o\.text == null/.test(eng), "words: L.vocab / L.word / L.sfx / L.number / L.range and stream({ kind }) are on the engine");
}
