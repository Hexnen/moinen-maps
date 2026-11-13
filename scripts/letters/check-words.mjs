// WORD: node checks of the vocabulary layer (words.mjs), called from check.mjs with its counter and the loaded font bank.
// Coverage of every sound kind in both languages and tiers, every word renderable in every font (Polish letters included, F23: no
// silent "?"), determinism and variation, loudness -> tier/stretch/prefix, escalation series, streams, additions and overrides,
// number formatting (REQUESTS ldic 6), and the engine's public surface (L.word / L.sfx / L.vocab / stream kind).
// v5 corrections (the user, 2026-11-13): only onomatopoeia (deny list + reviewed-syllable list), the 0..3 "!" scale, duration
// separate from loudness (long-quiet / short-loud), the sustain rule (which letters repeat), and the per-letter accent for LOOK.
import fs from "node:fs";
import { createVocab, KINDS, KIND_IDS, BANK, expand, stretchText, formatNumber, formatRange, clean, renderable, langOf, MAX_LEN, MAX_RUN,
  naming, NAMING, BORDERLINE, bangsFor, units, sustainOf, DEFAULT_HOLD, CLASSES, accentOf, ENVS, MOOD_ENV, FLOW, FLOW_STYLES, stretchPlan, MATERIALS, TEXTURES, MOOD_KIND } from "./words.mjs";
import { REVIEWED } from "./words-reviewed.mjs";
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
  ok(/^(KA-|TRA-TA-)BU+M+!{1,3}$/.test(V.word("boom", { lang: "pl", loud: 1, prefix: true, template: "BUM!" }).text), `words: a prefix for the loudest (${V.word("boom", { lang: "pl", loud: 1, prefix: true, template: "BUM!" }).text})`);
  ok(/^KA-BU{3,6}M{1,3}!$/.test(V.word("boom", { lang: "pl", loud: 1, long: 1, bangs: 1, prefix: "KA-", template: "BUM" }).text), `words: stretch and prefix, the prefix never stretches (${V.word("boom", { lang: "pl", loud: 1, long: 1, bangs: 1, prefix: "KA-", template: "BUM" }).text})`);
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
  ok(/VOCAB_KEYS = \[[^\]]*"long", "duration", "bangs"\]/.test(eng), "words: L.sfx takes long / duration / bangs as vocabulary options (not as play options)");

  /* 12. ONLY ONOMATOPOEIA: no bank word, stream syllable or prefix names a sound; every syllable was reviewed; add() refuses naming words */
  const flat = (w) => clean(w).replace(/[!?…\x27.,:]/g, "").split(/[-\s]+/).filter(Boolean).map((x) => x.replace(/(\p{L})\1+/gu, "$1"));
  for ( const lang of ["pl", "en"] ) {
    const rev = new Set(REVIEWED[lang]), names = [], unreviewed = new Set();
    for ( const id of KIND_IDS ) {
      const all = [...Object.values(BANK[lang][id]).flat(), ...(KINDS[id].pre?.[lang] ?? [])];
      for ( const w of all ) {
        if ( naming(w, lang) ) names.push(`${id}: ${w} (${naming(w, lang)})`);
        for ( const x of flat(w) ) if ( !rev.has(x) ) unreviewed.add(`${id}: ${x}`);
      }
    }
    ok(names.length === 0, `words: ${lang} words that NAME a sound instead of imitating it: ${names.slice(0, 8).join("; ")}`);
    ok(unreviewed.size === 0, `words: ${lang} syllables not on the reviewed list (words-reviewed.mjs; read them against the onomatopoeia rule first): ${[...unreviewed].slice(0, 8).join("; ")}`);
    ok(Object.values(BORDERLINE[lang]).every((r) => typeof r === "string" && r.length >= 8), `words: every ${lang} borderline word has a reason`);
  }
  ok(naming("CHRZĘST!", "pl") && naming("CHRZĘĘĘST", "pl") && naming("KRA-ŁOMOT", "pl") && naming("GROWL!", "en") && naming("TAK!", "pl") && !naming("TIK-TAK", "pl") && !naming("KRAK!", "pl") && !naming("BOOM!", "en"),
    "words: the naming test (named sounds, stretched or in a syllable, are caught; imitations pass; TAK alone is a word, TIK-TAK a clock)");
  ok(NAMING.pl.includes("CHRZĘST") && NAMING.en.includes("ROAR"), "words: the deny lists hold the words the user ruled out");
  { const W = createVocab(), warn = console.warn; console.warn = () => {}; const r = W.add("pl", "crumble", ["CHRZĘST!", "CHRUP!"]); console.warn = warn;
    ok(r.refused.length === 1 && r.refused[0] === "CHRZĘST!", "words: add() refuses a word that names a sound"); }

  /* 13. the "!" scale 0..2 (the user: "stopniowanie wykrzykników do 2") is really used, rises with loudness, and is separate from length */
  { const used = new Set(), mono = [];
    for ( const id of KIND_IDS ) {
      let prev = -1;
      for ( const loud of [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1] ) {
        const w = V.word(id, { lang: "pl", seed: 1, loud, long: 0.3 }); used.add(w.bangs);
        if ( w.bangs < prev ) mono.push(`${id}@${loud}`); prev = w.bangs;
        ok((w.text.match(/!+$/)?.[0].length ?? 0) === w.bangs, `words: ${id} text ends with its ${w.bangs} "!" (${w.text})`);
      }
    }
    ok([0, 1, 2].every((n) => used.has(n)) && !used.has(3), `words: the "!" scale uses 0, 1 and 2, never 3 (${[...used].sort()})`);
    ok(mono.length === 0, `words: louder never has fewer "!" (${mono.slice(0, 6).join(" ")})`);
    ok(bangsFor(0.1, 1, 0) === 0 && bangsFor(0.4, 1, 0) === 1 && bangsFor(0.7, 1, 0) === 2 && bangsFor(1, 1, 0) === 2 && bangsFor(1, 0.2, 0) === 2 && bangsFor(0.7, 0.2, 0) === 1 && bangsFor(0.5, 1, 0.9) === 0 && bangsFor(1, 0, 0, 0) === 0 && bangsFor(0, 0, 0, 7) === 2,
      "words: the scale (quiet 0, ordinary 1, loud 2; one less for a soft onset unless very loud, or a long sound that is not loud; bangs forces 0..2)");
    ok(!/!/.test(V.word("punch", { lang: "pl", seed: 1, loud: 1, bangs: 0 }).text) && /[^!]!!$/.test(V.word("click", { lang: "pl", seed: 1, loud: 0.1, bangs: 3 }).text), "words: bangs: 0 and bangs: 2 are obeyed (3 is capped to 2)");
  }

  /* 14. DURATION is separate from loudness: long-quiet is stretched and has no "!", short-loud is not stretched and has 2 "!";
         same duration, different loudness = the same stretch; same loudness, longer duration = longer */
  const body = (w) => w.text.replace(/[!?…]+$/, "").slice(w.prefix ? clean(w.prefix).length : 0);
  for ( const id of KIND_IDS ) for ( const lang of ["pl", "en"] ) {
    const t = V.word(id, { lang, seed: 5, loud: 0.5 }).template, core = clean(t).replace(/[!?…]+$/, "");
    const lq = V.word(id, { lang, template: t, loud: 0.15, long: 1 }), sq = V.word(id, { lang, template: t, loud: 0.15, long: 0 });
    const sl = V.word(id, { lang, template: t, loud: 1, long: 0, prefix: false });
    ok(lq.bangs === 0 && body(lq).length > body(sq).length, `words: ${lang}/${id} long-quiet is stretched and quiet (${lq.text} vs ${sq.text})`);
    ok(sl.bangs === 2 && body(sl) === core, `words: ${lang}/${id} short-loud is unstretched and loud (${sl.text} from ${core})`);
    const a = V.word(id, { lang, template: t, loud: 0.3, long: 0.6, prefix: false }), b = V.word(id, { lang, template: t, loud: 0.9, long: 0.6, prefix: false });
    ok(body(a) === body(b), `words: ${lang}/${id} loudness alone does not stretch (${a.text} / ${b.text})`);
    ok(V.word(id, { lang, template: t, duration: 2000 }).text === V.word(id, { lang, template: t, long: 1 }).text, `words: ${lang}/${id} duration in ms = long`);
  }

  /* 15. WHERE a word stretches: only the sustain (the kind's classes, in order), only in the last syllable, never a plosive or a prefix */
  { const bad = [];
    for ( const lang of ["pl", "en"] ) for ( const id of KIND_IDS ) {
      const hold = KINDS[id].hold ?? DEFAULT_HOLD;
      ok(hold.every((c) => CLASSES[c]), `words: ${id} hold names a sustain class`);
      for ( const tpl of Object.values(BANK[lang][id]).flat() ) {
        const core = clean(tpl).replace(/[!?…]+$/, ""), st = stretchText(core, 4, hold, lang), pl = stretchPlan(core, 4, hold, lang);
        if ( !pl ) continue;
        const a = pl.before, b = pl.runs, last = pl.last;
        if ( a.length !== b.length || a.some((r, i) => r.t !== b[i].t || b[i].n < r.n) ) { bad.push(`${lang}/${id} ${core}->${st} (shape)`); continue; }
        const grew = a.map((r, i) => (b[i].n > r.n ? i : -1)).filter((i) => i >= 0);
        const target = sustainOf(a, last, hold);
        if ( pl.target !== target ) bad.push(`${lang}/${id} ${core}: the stretch target is not the sustain`);
        for ( const i of grew ) {
          if ( !a[i].cls ) bad.push(`${lang}/${id} ${core}->${st}: repeats ${a[i].t} (no sustain)`);
          else if ( i < last ) bad.push(`${lang}/${id} ${core}->${st}: stretches before the last syllable`);
          else if ( i !== target && !(i === target + 1 && hold.includes(a[i].cls)) ) bad.push(`${lang}/${id} ${core}->${st}: ${a[i].t} is not the sustain`);
        }
        const inHold = a.slice(last).some((r) => hold.includes(r.cls));
        if ( inHold && grew.some((i) => !hold.includes(a[i].cls)) ) bad.push(`${lang}/${id} ${core}->${st}: stretched a class outside its sustain ${hold.join("")}`);
      }
    }
    ok(bad.length === 0, `words: the sustain rule: ${bad.length} wrong stretches: ${bad.slice(0, 6).join("; ")}`);
  }
  ok(stretchText("KRAK", 3, ["V"]) === "KRAAAAK" && stretchText("KRAK", 3, ["R", "V"]) === "KRRRRAK" && stretchText("PSST", 3, ["S"]) === "PSSSSST" && stretchText("SZUM", 2, ["S"]) === "SZSZSZUM"
    && stretchText("WHOOSH", 2, ["S"], "en") === "WHOOSHHH" && stretchText("BUM", 7, ["V", "M"]) === "BUUUUUUMMM" && stretchText("KTP", 3) === "KTP" && stretchText("KA-BUM", 2, ["V"]) === "KA-BUUUM"
    && stretchText("TWOM", 3, ["V", "M"]) === "TWOOOMM" && stretchText("BATOW", 3, ["V", "F"], "en") === "BATOOOWW" && stretchText("SKROM", 6, ["V", "M"], "en") === "SKROOOOOMMM",
    `words: the sustain rule examples (vowel ring, rolling R, hiss, SZ as a pair, English SH -> SHHH, overflow forward into the hum, plosives never, prefix never; the comic's manner: a vowel shares the stretch with the continuant after it, TWOOOMM, BATOOOWW)`);

  /* 16. ACCENT for LOOK: one weight 0..1 per character of the engine's word, the peak in the main syllable, the kind's envelope */
  { const bad = [];
    for ( const id of KIND_IDS ) for ( const lang of ["pl", "en"] ) for ( const o of [{ loud: 0.15, long: 1 }, { loud: 1, long: 0, prefix: true }, { loud: 0.5 }] ) {
      const w = V.word(id, { lang, seed: 3, ...o }), chars = makePlan(w.text, { ...w.play, seed: 3 }, fontsApi, []).chars;
      if ( w.accent.length !== chars.length ) bad.push(`${lang}/${id} ${w.text}: ${w.accent.length} weights for ${chars.length} letters`);
      if ( !w.accent.every((x) => x >= 0 && x <= 1) || !(w.peak >= 0 && w.peak <= 1) ) bad.push(`${lang}/${id} ${w.text}: out of range`);
      if ( w.sound.peak !== w.peak || w.play.sound.peak !== w.peak || w.play.accent !== w.accent || w.env !== KINDS[id].env ) bad.push(`${lang}/${id}: accent not passed to the engine`);
      chars.forEach((c, i) => { if ( c === " " && w.accent[i] !== 0 ) bad.push(`${lang}/${id}: a space has weight`); });
      if ( w.prefix ) { const n = [...clean(w.prefix)].length, pm = Math.max(...w.accent.slice(0, n)), mm = Math.max(...w.accent.slice(n)); if ( pm >= mm ) bad.push(`${lang}/${id} ${w.text}: the prefix is as loud as the sound`); }
    }
    ok(bad.length === 0, `words: accent data: ${bad.length} problems: ${bad.slice(0, 6).join("; ")}`);
    ok(KIND_IDS.every((id) => ENVS.includes(KINDS[id].env)), "words: every kind has an accent envelope");
    const A = (t, o) => accentOf(t, o).accent;
    const hit = A("KRAAAAK!", { kind: "punch" }), sw = A("GRRRRR", { kind: "roar" }), fd = A("UUUUUF", { kind: "sigh" }), ar = A("WHOOOOOSH", { kind: "whoosh", lang: "en" }), bt = A("TA-TA-TA", { kind: "gunfire" });
    ok(hit[0] === 1 && hit[2] > hit[5] && hit[6] < hit[2], `words: hit = loud attack, the stretched ring decays (${hit})`);
    ok(sw[1] < sw[5], `words: swell = the sustain builds to the end (${sw})`);
    ok(fd[0] > fd[4] && fd[5] < fd[0], `words: fade = loud start, fading tail (${fd})`);
    ok(ar[4] > ar[2] && ar[4] > ar[6], `words: arc = rises to the middle of the sustain and falls (a fly-by) (${ar})`);
    ok(bt[0] === bt[3] && bt[6] >= bt[3] && bt[1] < bt[0] && bt[2] === 0, `words: beat = every syllable has its own onset accent (${bt})`);
    const pre = accentOf("KA-BUUUUM!", { mood: "boom" });
    ok(pre.accent[0] < pre.accent[3] && pre.peak > 0.2 && pre.env === "hit", `words: plain text gets an accent from its mood; a prefix is a quieter lead-in (${pre.accent})`);
    ok(accentOf("hello  world", {}).accent.length === 11 && accentOf("", {}).accent.length === 0 && accentOf("???", { mood: "nope" }).env === "hit", "words: plain text of any kind gets a sensible accent");
    ok(Object.values(MOOD_ENV).every((e) => ENVS.includes(e)) && MOOD_IDS.every((m) => MOOD_ENV[m]), "words: every engine mood has an envelope for plain text");
    ok(V.series("gunfire", 4, { lang: "pl", seed: 1 }).every((w) => w.accent.length === [...w.text].length) && V.series("crack", 5, { lang: "en", seed: 1, loud: 0.9 }).every((w) => w.accent.length === [...w.text].length), "words: series words carry the accent of their final text");
    ok(V.accent("KRAAAK!", { kind: "crack" }).env === "hit" && V.accent("WRRRUM", { mood: "roar" }).env === "swell", "words: L.vocab.accent for any text");
  }

  /* 17. CONTINUOUS sounds (the user: "obsługiwać ciągłe dźwięki ciekawie", e.g. "syczenie rur stałe"): a flow of words that lasts
         as long as the sound, varies, never repeats a text twice in a row, never one endless letter run, letters in every font */
  { const bad = [], dull = [];
    ok(Object.values(FLOW).every((st) => FLOW_STYLES.includes(st)) && Object.keys(FLOW).every((id) => KINDS[id]), "words: flow styles name real kinds and styles");
    for ( const id of KIND_IDS ) for ( const lang of ["pl", "en"] ) {
      const f = V.flow(id, { lang, seed: 11 }), segs = f.take(8000);
      if ( segs[0].phase !== "onset" || segs.at(-1).phase !== "tail" || segs.length < 4 ) bad.push(`${lang}/${id}: shape`);
      if ( segs.at(-1).t + segs.at(-1).ms < 8000 - 1 || segs.some((x, i) => i && x.t !== segs[i - 1].t + segs[i - 1].ms) ) bad.push(`${lang}/${id}: timing`);
      segs.forEach((x, i) => {
        if ( i && x.text === segs[i - 1].text ) bad.push(`${lang}/${id}: ${x.text} twice`);
        if ( new RegExp(`(\\p{L})\\1{${MAX_RUN},}`, "u").test(x.text) ) bad.push(`${lang}/${id}: ${x.text} run too long`);
        if ( /!!!/.test(x.text) || x.bangs > 2 ) bad.push(`${lang}/${id}: ${x.text} more than 2 "!"`);
        if ( !renderable(x.text) || x.text.replace(/[!?…]/g, "").length > MAX_LEN ) bad.push(`${lang}/${id}: ${x.text} not letterable`);
        if ( x.accent.length !== [...x.text].length || !x.play?.mood ) bad.push(`${lang}/${id}: ${x.text} accent/play`);
        for ( const fo of Object.keys(FONTS) ) if ( missing(fo, x.text).length ) bad.push(`${lang}/${id}: ${x.text} in ${fo}`);
      });
      const body = Array.from({ length: 20 }, (_, i) => f.at(i).text);
      if ( new Set(body).size < 4 ) dull.push(`${lang}/${id} (${new Set(body).size})`);
      if ( JSON.stringify(body) !== JSON.stringify(Array.from({ length: 20 }, (_, i) => V.flow(id, { lang, seed: 11 }).at(i).text)) ) bad.push(`${lang}/${id}: not deterministic`);
    }
    ok(bad.length === 0, `words: flows: ${bad.length} problems: ${bad.slice(0, 6).join("; ")}`);
    ok(dull.length === 0, `words: flows that do not vary (fewer than 4 different words in 20): ${dull.join(", ")}`);
    /* the steady pipe hiss: quiet, no "!", long hissing words with a slow change of length, a sputter now and then */
    for ( const lang of ["pl", "en"] ) {
      const f = V.flow("hiss", { lang, seed: 3 }), b = Array.from({ length: 30 }, (_, i) => f.at(i));
      ok(f.style === "steady" && b.every((x) => x.loud <= 0.25 && x.bangs === 0 && !/!/.test(x.text)), `words: ${lang} steady hiss stays quiet without "!"`);
      ok(b.filter((x) => /S{3,}|(SZ){3,}|H{3,}/.test(x.text)).length >= 18 && new Set(b.map((x) => x.text.length)).size >= 3, `words: ${lang} steady hiss holds its S and breathes in length (${b.slice(0, 8).map((x) => x.text).join(" ")})`);
      ok(/…$/.test(f.tail.text) && f.tail.loud < f.at(0).loud + 0.01, `words: ${lang} a flow ends trailing off (${f.tail.text})`);
    }
    { const f = V.flow("engine", { lang: "pl", seed: 2 }), L = Array.from({ length: 16 }, (_, i) => f.at(i).text.length);
      ok(f.style === "drone" && new Set(L).size >= 3, `words: a drone swells and sinks (${Array.from({ length: 8 }, (_, i) => f.at(i).text).join(" ")})`); }
    { const f = V.flow("gunfire", { lang: "en", seed: 2 }), n = Array.from({ length: 16 }, (_, i) => f.at(i).text.split("-").length);
      ok(f.style === "cycle" && new Set(n).size >= 2, `words: a cycle varies its count (${Array.from({ length: 6 }, (_, i) => f.at(i).text).join(" ")})`); }
    { const f = V.flow("fire", { lang: "pl", seed: 2 }), b = Array.from({ length: 12 }, (_, i) => f.at(i));
      ok(f.style === "crackle" && b.some((x) => x.long >= 0.7) && b.some((x) => x.long <= 0.2), `words: a crackle mixes a bed and pops (${b.slice(0, 6).map((x) => x.text).join(" ")})`); }
    ok(V.flow("hiss", { style: "drone", seed: 1 }).style === "drone" && V.flow("punch", { seed: 1 }).style === "crackle", "words: a flow style can be asked for; a short kind still flows");
    ok(/flow: vocab\.flow/.test(eng), "words: L.flow is on the engine");
  }
  /* 18. CHARACTER for the look (the user: the lettering must look like the sound it describes): every kind and every word carries
         the sound's character (hard, sharp, heavy, wet, metal, electric, heat, sustain, rough, pitch, contour, material, texture) */
  { const bad = [], seen = new Set(), U = (x) => Number.isFinite(x) && x >= 0 && x <= 1;
    for ( const id of KIND_IDS ) {
      const c = KINDS[id].char;
      if ( !c || ![c.hard, c.heavy, c.wet, c.metal, c.electric].every(U) || !(c.heat >= -1 && c.heat <= 1) || !MATERIALS.includes(c.material) || !TEXTURES.includes(c.texture) ) bad.push(`${id}: kind character`);
      else seen.add(JSON.stringify(c));
      for ( const lang of ["pl", "en"] ) {
        const w = V.word(id, { lang, seed: 4, loud: 0.6, long: 0.5 }), x = w.character;
        if ( !x || ![x.hard, x.sharp, x.heavy, x.wet, x.metal, x.electric, x.sustain, x.rough].every(U) || !(x.heat >= -1 && x.heat <= 1) || !(x.pitch >= -1 && x.pitch <= 1)
          || !["fall", "rise", "arc", "pulse", "steady"].includes(x.contour) || !MATERIALS.includes(x.material) || !TEXTURES.includes(x.texture) ) bad.push(`${lang}/${id}: word character`);
        else if ( w.play.character !== x || x.sustain !== Math.round(w.long * 100) / 100 || x.sharp !== KINDS[id].sound.sharp ) bad.push(`${lang}/${id}: character not handed to play / not this word's duration`);
      }
    }
    ok(bad.length === 0, `words: character: ${bad.length} problems: ${bad.slice(0, 6).join("; ")}`);
    ok(seen.size >= 40, `words: kinds have their own character (${seen.size} different of ${KIND_IDS.length})`);
    const C = (id, o = {}) => V.word(id, { lang: "en", seed: 1, ...o }).character;
    ok(C("clang").metal >= 0.9 && C("chime").texture === "ringing" && C("splash").wet >= 0.9 && C("drip").material === "water" && C("fire").heat >= 0.9 && C("wind").heat < 0
      && C("zap").electric >= 0.9 && C("crack").hard > C("whoosh").hard && C("thud").heavy > C("click").heavy && C("crack").sharp > C("whump").sharp,
      "words: the characters fit the sounds (metal rings, water is wet, fire hot, wind cool, zap electric, crack hard and sharp, thud heavy)");
    ok(C("boom", { loud: 1 }).heavy > C("boom", { loud: 0.1 }).heavy && C("boom", { long: 1 }).sustain > C("boom", { long: 0 }).sustain, "words: a louder word is heavier, a longer one more sustained");
    ok(C("roar").contour === "rise" && C("crack").contour === "fall" && C("whoosh").contour === "arc" && C("gunfire").contour === "pulse" && V.flow("hiss", { seed: 1 }).at(0).character.contour === "steady", "words: contour from the envelope (steady for a steady flow)");
    ok(V.character({ mood: "fire" }).material === "fire" && V.character({ mood: "splash" }).wet === 1 && V.character({}).material === "flesh" && MOOD_IDS.every((m) => MOOD_KIND[m] && KINDS[MOOD_KIND[m]]), "words: plain text gets the character of its mood");
    { const W = createVocab(); W.define("pvfx-webshot", { mood: "whoosh" }); ok(W.word("pvfx-webshot", { lang: "en", seed: 1 }).character.material === "flesh", "words: a defined kind inherits a character"); }
  }
}
