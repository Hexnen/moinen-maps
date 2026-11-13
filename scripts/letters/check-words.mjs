// WORD: node checks of the vocabulary layer (words.mjs), called from check.mjs with its counter and the loaded font bank.
// Coverage of every sound kind in both languages and tiers, every word renderable in every font (Polish letters included, F23: no
// silent "?"), determinism and variation, loudness -> tier/stretch/prefix, escalation series, streams, additions and overrides,
// number formatting (REQUESTS ldic 6), and the engine's public surface (L.word / L.sfx / L.vocab / stream kind).
// v5 corrections (the user, 2026-11-13): only onomatopoeia (deny list + reviewed-syllable list), the 0..2 "!" scale, duration
// separate from loudness (long-quiet / short-loud), the sustain rule (which letters repeat), and the per-letter accent for LOOK.
// WORD2 (the vocabulary review, 2026-11-13): no Polish diacritics, the near-dictionary refusal, sayable words, lead-ins on the table,
// sharing only by the SHARED list, "!" caps per kind, percussive kinds never stretched, long steady sounds long (section 19).
import fs from "node:fs";
import { createVocab, KINDS, KIND_IDS, BANK, expand, stretchText, formatNumber, formatRange, clean, renderable, langOf, MAX_LEN, MAX_RUN,
  naming, NAMING, DICT, ICONIC, VOICE, ALLOW, SHARED, shareKey, refusal, sayable, DIACRITICS, PREFIXES, bangsFor, units, sustainOf, DEFAULT_HOLD, CLASSES, accentOf, ENVS, MOOD_ENV, FLOW, FLOW_STYLES, stretchPlan, MATERIALS, TEXTURES, MOOD_KIND,
  GROUPS, MATS, materialOf, MAT_CHAR, piecesOf, intensityOf, FIRE_STAGES, VARIANTS, VARY, VARIANT_META, TAILS, CHAINS, ROLES, PLACES } from "./words.mjs";
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
      /* the review (2026-11-13): 2-4 good words per tier, never padded */
      for ( const t of ["s", "m", "l"] ) ok(b[t]?.length >= 2 && b[t].length <= 4, `words: ${lang}/${id}/${t} has ${b[t]?.length} words (2-4 good ones, never padded)`);
      ok(b.s.length + b.m.length + b.l.length >= 6, `words: ${lang}/${id} has fewer than 6 words`);
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
  /* the review (2026-11-13, rule 1): NO Polish diacritics in any sound word of either language; the Polish set is spelled with Polish
     letters only (no V, Q, X), and it is not the English list */
  const plAll = Object.values(BANK.pl).flatMap((b) => [...b.s, ...b.m, ...b.l, ...b.st]).join(" ");
  const enAll = Object.values(BANK.en).flatMap((b) => [...b.s, ...b.m, ...b.l, ...b.st]).join(" ");
  ok(!DIACRITICS.test(plAll) && !DIACRITICS.test(enAll) && !Object.keys(PREFIXES.pl).concat(Object.keys(PREFIXES.en)).some((p) => DIACRITICS.test(p)), "words: no Polish diacritic in any sound word or prefix (the review, rule 1)");
  ok(!/[VQX]/.test(plAll) && !Object.keys(PREFIXES.pl).some((p) => /[VQX]/.test(p)), `words: the Polish set uses only Polish letters (${(plAll.match(/\S*[VQX]\S*/g) ?? []).slice(0, 6).join(" ")})`);
  /* the laser pistol is the one exception: the review prescribed ZAT / TZAT / ZARK for both languages (section 2) */
  let same = 0; for ( const id of KIND_IDS ) if ( id !== "laserpistol" && JSON.stringify(BANK.pl[id].m) === JSON.stringify(BANK.en[id].m) ) same++;
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
    ok(V.word(id, { lang, template: t, loud: 1, prefix: false }).text.replace(/[!?…]+$/, "").length >= V.word(id, { lang, template: t, loud: 0.35, prefix: false }).text.replace(/[!?…]+$/, "").length, `words: ${lang}/${id} a louder sound is not shorter`);
    ok(!new RegExp(`(\\p{L})\\1{${KINDS[id].run ?? MAX_RUN},}`, "u").test(V.word(id, { lang, seed: 3, loud: 1, step: 6 }).text), `words: ${lang}/${id} a letter repeated more than ${KINDS[id].run ?? MAX_RUN} times`);
  }
  ok(V.word("boom", { lang: "en", magnitude: "epic", seed: 1 }).tier === "l" && V.word("boom", { lang: "en", magnitude: "tiny", seed: 1 }).tier === "s", "words: magnitude words pick the tier");
  ok(V.word("boom", { lang: "en", seed: 1 }).play.magnitude === 0.5, "words: the default loudness is the engine's normal magnitude");
  ok(/^KA-BU+M+!{1,3}$/.test(V.word("boom", { lang: "pl", loud: 1, prefix: true, template: "BUM!" }).text), `words: a prefix for the loudest (${V.word("boom", { lang: "pl", loud: 1, prefix: true, template: "BUM!" }).text})`);
  ok(/^KA-BU{3,6}M{1,3}!$/.test(V.word("boom", { lang: "pl", loud: 1, long: 1, bangs: 1, prefix: "KA-", template: "BUM" }).text), `words: stretch and prefix, the prefix never stretches (${V.word("boom", { lang: "pl", loud: 1, long: 1, bangs: 1, prefix: "KA-", template: "BUM" }).text})`);
  /* 4b. PREFIXES are the sound's own lead-in (the user: "Tra ta przed bombą?"): every prefix of every kind is on the PREFIXES
     table for that kind, with its reason; no prefix is another sound's signature (a repeating kind's rattle syllable, or a whole
     bank word of another kind); the loudest boom / series never gets a gun rattle in front */
  { const bad = [], stSyl = {}, flat = (w) => clean(w).replace(/[!?…\x27.,:]/g, "").split(/[-\s]+/).filter(Boolean).map((x) => x.replace(/(\p{L})\1+/gu, "$1"));
    for ( const lang of ["pl", "en"] ) { stSyl[lang] = new Map();
      for ( const id of KIND_IDS ) if ( KINDS[id].repeat ) for ( const w of BANK[lang][id]?.st ?? [] ) for ( const x of flat(w) ) stSyl[lang].set(x, id); }
    for ( const lang of ["pl", "en"] ) {
      for ( const [pre, e] of Object.entries(PREFIXES[lang]) ) {
        if ( !(typeof e.why === "string" && e.why.length >= 20 && Array.isArray(e.kinds) && e.kinds.length && e.kinds.every((id) => KINDS[id])) ) bad.push(`${lang} ${pre}: no reason or unknown kinds`);
        for ( const x of flat(pre) ) if ( stSyl[lang].has(x) ) bad.push(`${lang} ${pre}: "${x}" is the rattle of ${stSyl[lang].get(x)}`);
        const whole = flat(pre).join("");
        for ( const id of KIND_IDS ) if ( !e.kinds.includes(id) && Object.values(BANK[lang][id]).flat().some((w) => flat(w).join("") === whole) ) bad.push(`${lang} ${pre}: a word of ${id}`);
      }
      for ( const id of KIND_IDS ) for ( const pre of KINDS[id].pre?.[lang] ?? [] ) if ( !PREFIXES[lang][pre]?.kinds.includes(id) ) bad.push(`${lang} ${id}: ${pre} is not its own lead-in`);
    }
    ok(bad.length === 0, `words: prefixes that do not belong to their sound: ${bad.slice(0, 8).join("; ")}`);
    const tops = ["pl", "en"].flatMap((lang) => [...Array.from({ length: 12 }, (_, i) => V.word("boom", { lang, loud: 1, prefix: true, seed: i }).text), ...V.series("boom", 6, { lang, seed: "p", loud: 0.9 }).map((w) => w.text)]);
    ok(tops.every((t) => !/^(TRA|RA|TA)-/.test(t)), `words: no gun rattle in front of a blast (${tops.filter((t) => /^(TRA|RA|TA)-/.test(t)).join(" ")})`); }
  /* 5. escalation (MOVE's seam): one sound repeated grows; never the same text twice in a row */
  for ( const grow of ["stretch", "vary"] ) for ( const id of ["crack", "boom", "punch", "zap", "pistol", "pain"] ) for ( const lang of ["pl", "en"] ) {
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
    const full = (w) => w.text.replace(/[!?…]+$/, "").length + 1 + w.text.replace(/[!?…]+$/, "").split("-").at(-1).length > MAX_LEN;   // no room for one more syllable
    ok((dash(s[1].text) > dash(s[0].text) || full(s[0])) && (dash(s[2].text) > dash(s[1].text) || full(s[1])), `words: a repeating sound grows by syllables (${lang}/${id}: ${s.map((w) => w.text).join(" ")})`);
  }
  /* 6. streams: syllables for L.stream */
  for ( const id of KIND_IDS ) for ( const lang of ["pl", "en"] ) {
    const syl = V.syllables(id, { lang, seed: 1 });
    ok(Array.isArray(syl) && syl.length >= 1 && syl.every((x) => x.length >= 1 && renderable(x)), `words: ${lang}/${id} stream syllables`);
  }
  ok(V.syllables("gunfire", { lang: "pl", seed: 1 }).length >= 3 && V.syllables("gunfire", { lang: "en", seed: 1 }).length >= 3, "words: gunfire rattles in syllables");
  /* 7. aliases, unknown kinds, languages */
  { const seen = new Map(), dup = []; for ( const [id, k] of Object.entries(KINDS) ) for ( const x of [id, ...(k.alias ?? [])] ) { if ( seen.has(x) && seen.get(x) !== id ) dup.push(`${x}: ${seen.get(x)} / ${id}`); seen.set(x, id); }
    ok(dup.length === 0, `words: an alias names two kinds: ${dup.join("; ")}`); }
  ok(V.kindOf("sword") === "sword" && V.kindOf("grenade") === "grenade" && V.kindOf("snake") === "snakehiss" && V.kindOf("pipe") === "hiss" && V.kindOf("elephant") === "trumpet" && V.kindOf("twister") === "tornado", "words: the new kinds and their aliases");
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
    ok(W.remove("pl", "punch", [BANK.pl.punch.s[0]]) === 1 && !W.all("punch", "pl").s.includes(BANK.pl.punch.s[0]), "words: remove");
    W.reset(); ok(W.all("punch", "pl").s.includes(BANK.pl.punch.s[0]) && !W.kinds.includes("webshot"), "words: reset");
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

  /* 12. ONLY ONOMATOPOEIA, NO DICTIONARY WORDS (the user's ruling 2026-11-13): no bank word, stream syllable, prefix or flow segment is a
     word of the language (whole or in a syllable) unless it is on the short ICONIC list; every syllable was reviewed; add() refuses them */
  const flat = (w) => clean(w).replace(/[!?…\x27.,:]/g, "").split(/[-\s]+/).filter(Boolean).map((x) => x.replace(/(\p{L})\1+/gu, "$1"));
  for ( const lang of ["pl", "en"] ) {
    const rev = new Set(REVIEWED[lang]), names = [], unreviewed = new Set();
    for ( const id of KIND_IDS ) {
      const all = [...Object.values(BANK[lang][id]).flat(), ...(KINDS[id].pre?.[lang] ?? [])];
      for ( const w of all ) {
        /* a word in its own kind (the voice list passes only in voice kinds); a lead-in syllable by syllable (it never stands alone) */
        const bad = /-$/.test(w) ? flat(w).find((x) => naming(x, lang, { kind: id })) : naming(w, lang, { kind: id });
        if ( bad ) names.push(`${id}: ${w} (${bad})`);
        for ( const x of flat(w) ) if ( !rev.has(x) ) unreviewed.add(`${id}: ${x}`);
      }
    }
    ok(names.length === 0, `words: ${lang} words that NAME a sound instead of imitating it: ${names.slice(0, 8).join("; ")}`);
    ok(unreviewed.size === 0, `words: ${lang} syllables not on the reviewed list (words-reviewed.mjs; read them against the onomatopoeia rule first): ${[...unreviewed].slice(0, 8).join("; ")}`);
    ok(Object.entries(ICONIC[lang]).every(([w, r]) => typeof r === "string" && r.length >= 8 && [...w].length <= 7 && DICT[lang].includes(w)), `words: every ${lang} iconic exception is short, has a reason and is a real dictionary word`);
    ok(Object.keys(ICONIC[lang]).length <= 16, `words: the ${lang} iconic exception list stays short (at most 16, the review)`);
    /* flows and stream syllables are built from the banks: no dictionary word may come back through them */
    { const bad = [];
      for ( const id of KIND_IDS ) {
        const F = createVocab().flow(id, { lang, seed: "dict" }), seg = [F.onset, ...Array.from({ length: 24 }, (_, i) => F.at(i)), F.tail].filter(Boolean);
        for ( const x of seg ) if ( naming(x.text, lang, { kind: id }) ) bad.push(`${id}: ${x.text}`);
        for ( const y of createVocab().syllables(id, { lang, seed: 3 }) ?? [] ) if ( naming(y, lang, { kind: id }) ) bad.push(`${id} syllable: ${y}`);
      }
      ok(bad.length === 0, `words: ${lang} flows / stream syllables bring a dictionary word back: ${bad.slice(0, 8).join("; ")}`); }
  }
  ok(naming("CHRZĘST!", "pl") && naming("CHRZĘĘĘST", "pl") && naming("KRA-ŁOMOT", "pl") && naming("GROWL!", "en") && naming("TAK!", "pl") && !naming("KRAK!", "pl") && !naming("BOOM!", "en"),
    "words: the naming test (named sounds, stretched or in a syllable, are caught; built sounds and iconic exceptions pass)");
  /* the user's examples of plain words: dictionary interjections are out, stretched or not, alone or in a syllable */
  ok(["CIACH!", "CIAAACH", "TRZASK!", "PLUSK", "SKRZYP", "BRZDĘK!", "CHRUP", "MLASK", "PSTRYK", "KŁAP", "SZUR", "CHLAST", "PRASK", "BĘC!", "ŁUP", "KA-TRZASK"].every((w) => naming(w, "pl")) &&
    ["CRASH!", "SPLAASH", "SLAP", "CRACK", "SNAP", "CLICK", "SPLAT", "SMASH!", "KA-CRUNCH", "DOOM", "BROOM"].every((w) => naming(w, "en")),
    "words: the dictionary interjections the user ruled out are caught (CIACH is a word)");
  ok(["SZSZT!", "FSZSZT!", "SWISZK!", "KRAK!", "BUM!", "KA-BUM!"].every((w) => !naming(w, "pl")) && ["TWOOM!!", "WRAMM!!", "SKROOMM!!", "CHOOM!!", "POW!", "THUD!", "KA-BOOM!", "BATOOWWW!", "FWOOOSH!!", "KA-THOOM!", "KRAK!!", "SKREE-", "KA-KROOSH!"].every((w) => !naming(w, "en")),
    "words: built sounds and the iconic exceptions pass");
  ok(NAMING === DICT && DICT.pl.includes("CHRZĘST") && DICT.pl.includes("CIACH") && DICT.en.includes("ROAR") && DICT.en.includes("CRASH"), "words: the deny lists hold the words the user ruled out");
  { const W = createVocab(), warn = console.warn; console.warn = () => {}; const r = W.add("pl", "crumble", ["CHRZĘST!", "CHRUP!", "KRRUNCZ!"]); console.warn = warn;
    ok(r.refused.length === 2 && r.refused.includes("CHRZĘST!") && r.refused.includes("CHRUP!"), "words: add() refuses a dictionary word and keeps a built one"); }

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
    ok(bangsFor(0.1, 1, 0) === 0 && bangsFor(0.4, 1, 0) === 1 && bangsFor(0.7, 1, 0) === 1 && bangsFor(0.9, 1, 0) === 2 && bangsFor(0.9, 0.2, 0) === 1 && bangsFor(1, 0.2, 0) === 2 && bangsFor(0.5, 1, 0.9) === 0 && bangsFor(1, 0, 0, 0) === 0 && bangsFor(0, 0, 0, 7) === 2 && bangsFor(1, 1, 0, null, 1) === 1,
      "words: the scale (quiet 0, ordinary 1, \"!!\" only from 0.85 loud with a sharp onset or from 0.95; one less for a soft onset or a long sound that is not loud; bangs forces 0..2; a kind's cap wins)");
    ok(!/!/.test(V.word("punch", { lang: "pl", seed: 1, loud: 1, bangs: 0 }).text) && /[^!]!!$/.test(V.word("punch", { lang: "pl", seed: 1, loud: 0.1, bangs: 3 }).text) && /[^!]!$/.test(V.word("click", { lang: "pl", seed: 1, loud: 0.1, bangs: 3 }).text), "words: bangs: 0 and bangs: 2 are obeyed (3 is capped to 2, a never-loud kind to its cap)");
  }

  /* 14. DURATION is separate from loudness: long-quiet is stretched and has no "!", short-loud is not stretched and has 2 "!";
         same duration, different loudness = the same stretch; same loudness, longer duration = longer */
  const body = (w) => w.text.replace(/[!?…]+$/, "").slice(w.prefix ? clean(w.prefix).length : 0);
  for ( const id of KIND_IDS ) for ( const lang of ["pl", "en"] ) {
    const t = V.word(id, { lang, seed: 5, loud: 0.5 }).template, core = clean(t).replace(/[!?…]+$/, "");
    const lq = V.word(id, { lang, template: t, loud: 0.15, long: 1 }), sq = V.word(id, { lang, template: t, loud: 0.15, long: 0 });
    const sl = V.word(id, { lang, template: t, loud: 1, long: 0, prefix: false }), k = KINDS[id];
    const dash = (w) => (body(w).match(/-/g) ?? []).length, canStretch = !!stretchPlan(core, 4, k.stretchHold ?? k.hold, lang, k.run ?? MAX_RUN);
    if ( k.perc && k.repeat ) ok(lq.bangs === 0 && (dash(lq) > dash(sq) || body(sq).length + 1 + body(sq).split("-").at(-1).length > MAX_LEN), `words: ${lang}/${id} a long percussive sound repeats more, never stretches (${lq.text} vs ${sq.text})`);
    else if ( canStretch ) ok(lq.bangs === 0 && body(lq).length > body(sq).length, `words: ${lang}/${id} long-quiet is stretched and quiet (${lq.text} vs ${sq.text})`);
    else ok(lq.bangs === 0 && body(lq) === body(sq), `words: ${lang}/${id} a word with nothing lasting is not stretched (${lq.text} vs ${sq.text})`);
    ok(sl.bangs === Math.min(2, k.maxBangs ?? 2) && body(sl) === core, `words: ${lang}/${id} short-loud is unstretched and as loud as its kind allows (${sl.text} from ${core})`);
    const a = V.word(id, { lang, template: t, loud: 0.3, long: 0.6, prefix: false }), b = V.word(id, { lang, template: t, loud: 0.9, long: 0.6, prefix: false });
    ok(body(a) === body(b), `words: ${lang}/${id} loudness alone does not stretch (${a.text} / ${b.text})`);
    ok(V.word(id, { lang, template: t, duration: 2000 }).text === V.word(id, { lang, template: t, long: 1 }).text, `words: ${lang}/${id} duration in ms = long`);
  }

  /* 15. WHERE a word stretches: only the sustain (the kind's classes, in order), only in the last syllable, never a plosive or a prefix */
  { const bad = [];
    for ( const lang of ["pl", "en"] ) for ( const id of KIND_IDS ) {
      const hold = KINDS[id].stretchHold ?? KINDS[id].hold ?? DEFAULT_HOLD;
      ok((KINDS[id].hold ?? DEFAULT_HOLD).every((c) => CLASSES[c]), `words: ${id} hold names a sustain class`);
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
  ok(stretchText("KRAK", 3, ["V"]) === "KRAAAAK" && stretchText("KRAK", 3, ["R", "V"]) === "KRRRRAK" && stretchText("PSST", 3, ["S"]) === "PSSSSST" && stretchText("SZUM", 2, ["S"], "pl") === "SSSZUM"
    && stretchText("WHOOSH", 2, ["S"], "en") === "WHOOSHHH" && stretchText("BUM", 7, ["V", "M"]) === "BUUUUUUMMM" && stretchText("KTP", 3) === "KTP" && stretchText("KA-BUM", 2, ["V"]) === "KA-BUUUM"
    && stretchText("TWOM", 3, ["V", "M"]) === "TWOOOMM" && stretchText("BATOW", 3, ["V", "F"], "en") === "BATOOOWW" && stretchText("SKROM", 6, ["V", "M"], "en") === "SKROOOOOMMM",
    `words: the sustain rule examples (vowel ring, rolling R, hiss, Polish SZ as an S run SSSZ, English SH -> SHHH, overflow forward into the hum, plosives never, prefix never; the comic's manner: a vowel shares the stretch with the continuant after it, TWOOOMM, BATOOOWW)`);

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
        if ( new RegExp(`(\\p{L})\\1{${KINDS[x.part ?? id].run ?? MAX_RUN},}`, "u").test(x.text) ) bad.push(`${lang}/${id}: ${x.text} run too long`);   // a mixed flow: its part's limit
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
  /* 19. THE VOCABULARY REVIEW (WORD2, 2026-11-13): every rule of the review is enforced on the banks AND on the text the engine really
         produces (prefix + stretched word + "!"), in both languages */
  { const LOUDS = [0, 0.3, 0.6, 0.85, 1], LONGS = [0, 0.5, 1], SEEDS = [1, 2, 3, 4];
    const gen = (lang, id, fn) => { for ( const loud of LOUDS ) for ( const long of LONGS ) for ( const seed of SEEDS ) for ( const prefix of [undefined, true] ) fn(V.word(id, { lang, loud, long, seed, prefix }), loud, long); };
    const syl = (w) => clean(w).replace(/[!?…\x27.,:]/g, "").split(/[-\s]+/).filter(Boolean);
    const bank = { refused: [], unsay: [], lead: [], shared: [] }, made = { refused: [], unsay: [], dia: [], bangs: [], perc: [], w: [], sz: [], ph: [], steady: [] };
    for ( const lang of ["pl", "en"] ) {
      const owner = new Map();
      for ( const id of KIND_IDS ) {
        const k = KINDS[id], b = BANK[lang][id];
        for ( const [tier, list] of Object.entries(b) ) for ( const w of list ) {
          /* rules 3, 4: no dictionary word, no word one letter from one (a respelling only by the ALLOW list) */
          const r = refusal(w, lang, { kind: id }); if ( r ) bank.refused.push(`${lang}/${id} ${w} (${r.why} ${r.part} ~ ${r.like})`);
          /* rules 12, 13: it can be said */
          const s = sayable(w, lang); if ( s ) bank.unsay.push(`${lang}/${id} ${w}: ${s}`);
          /* rule 7: a word with a lead-in uses its kind's own lead-in from the PREFIXES table */
          if ( tier !== "st" && !k.repeat && w.includes("-") ) { const lead = w.split("-").slice(0, -1).join("-") + "-"; if ( !PREFIXES[lang][lead]?.kinds.includes(id) ) bank.lead.push(`${lang}/${id} ${w}`); }
          /* each kind its own words; a word shared between kinds only by the SHARED list, with its reason */
          if ( tier !== "st" ) { const key = shareKey(w); if ( !owner.has(key) ) owner.set(key, new Set()); owner.get(key).add(id); }
        }
      }
      for ( const [key, ids] of owner ) if ( ids.size > 1 && !(SHARED[lang][key] && [...ids].every((i) => SHARED[lang][key].kinds.includes(i))) ) bank.shared.push(`${lang} ${key}: ${[...ids].join(", ")}`);
      for ( const [key, e] of Object.entries(SHARED[lang]) ) if ( !(typeof e.why === "string" && e.why.length >= 15 && e.kinds.length >= 2 && e.kinds.every((i) => KINDS[i])) || key !== shareKey(key) ) bank.shared.push(`${lang} SHARED ${key}: no reason, unknown kind or not a share key`);

      /* the text the engine produces */
      for ( const id of KIND_IDS ) {
        const k = KINDS[id], cap = Math.min(2, k.maxBangs ?? 2), bankSyl = new Set(Object.values(BANK[lang][id]).flat().flatMap(syl));
        gen(lang, id, (w, loud) => {
          const r = refusal(w.text, lang, { kind: id }); if ( r ) made.refused.push(`${lang}/${id} ${w.text} (${r.why} ${r.part})`);
          const s = sayable(w.text, lang); if ( s ) made.unsay.push(`${lang}/${id} ${w.text}: ${s}`);
          if ( DIACRITICS.test(w.text) ) made.dia.push(`${lang}/${id} ${w.text}`);
          /* "!" by loudness: never above the kind's cap, "!!" only from 0.85 loud */
          if ( w.bangs > cap || (w.bangs === 2 && loud < 0.85) ) made.bangs.push(`${lang}/${id} ${w.text} at ${loud}`);
          /* rule 9: a percussive kind never stretches a letter; a long one repeats whole syllables of its own words */
          const body = syl(w.text.slice(w.prefix ? clean(w.prefix).length : 0));
          if ( k.perc && body.some((x) => !bankSyl.has(x)) ) made.perc.push(`${lang}/${id} ${w.text}`);
          /* rule 6: W lasts only at a syllable's end after a vowel (POOWW), never THWWWIT or FWWWOOP */
          if ( /W{2,}(?=\p{L})/u.test(w.text.replace(/[!?…]+$/, "")) && !Object.values(BANK[lang][id]).flat().some((b) => /W{2,}(?=\p{L})/u.test(b)) ) made.w.push(`${lang}/${id} ${w.text}`);
          /* rule 14: a Polish SZ stretches as an S run (SSSSZ), never SZSZSZ unless the word itself is written so */
          if ( lang === "pl" && /(SZ){3,}/.test(w.text) && !Object.values(BANK.pl[id]).flat().some((b) => /(SZ){3,}/.test(b)) ) made.sz.push(`${lang}/${id} ${w.text}`);
          /* rule 5: English PH is no lasting sound (never PHHH, never PFAAAK from a PH) */
          if ( lang === "en" && /PHH|PFA/.test(w.text) && !Object.values(BANK.en[id]).flat().some((b) => /PFA/.test(b)) ) made.ph.push(`${lang}/${id} ${w.text}`);
        });
        /* rule 10: a long steady sound is long enough to read as lasting (at full duration a run of 4+ letters, 5+ for the steady
           hisses, hums and drones whose flows may run to 10) */
        if ( !k.perc && k.sound.long >= 0.8 && !k.repeat ) {
          const w = V.word(id, { lang, loud: 0.4, long: 1, seed: 1 }), run = Math.max(...(w.text.match(/(\p{L})\1*/gu) ?? [""]).map((x) => x.length));
          if ( run < ((k.run ?? MAX_RUN) > MAX_RUN ? 5 : 4) ) made.steady.push(`${lang}/${id} ${w.text}`);
        }
      }
      /* flows, series and stream syllables are refused the same way */
      for ( const id of KIND_IDS ) {
        const F = createVocab().flow(id, { lang, seed: "w2" }), seg = [F.onset, ...Array.from({ length: 16 }, (_, i) => F.at(i)), F.tail].filter(Boolean);
        for ( const x of [...seg.map((s) => s.text), ...V.series(id, 5, { lang, seed: "w2", loud: 0.4 }).map((s) => s.text), ...V.series(id, 5, { lang, seed: "w2", loud: 0.4, grow: "vary" }).map((s) => s.text)] ) {
          const r = refusal(x, lang, { kind: id }); if ( r ) made.refused.push(`${lang}/${id} flow/series ${x} (${r.why} ${r.part})`);
          if ( DIACRITICS.test(x) ) made.dia.push(`${lang}/${id} flow/series ${x}`);
          const s = sayable(x, lang); if ( s ) made.unsay.push(`${lang}/${id} flow/series ${x}: ${s}`);
        }
      }
    }
    ok(bank.refused.length === 0, `words: bank words refused as dictionary or near-dictionary words: ${bank.refused.slice(0, 8).join("; ")}`);
    ok(bank.unsay.length === 0, `words: bank words that cannot be said: ${bank.unsay.slice(0, 8).join("; ")}`);
    ok(bank.lead.length === 0, `words: bank words whose lead-in is not their kind's own on the PREFIXES table: ${bank.lead.slice(0, 8).join("; ")}`);
    ok(bank.shared.length === 0, `words: words shared between kinds without a SHARED entry and reason: ${bank.shared.slice(0, 8).join("; ")}`);
    ok(made.refused.length === 0, `words: produced text (prefix + word) refused: ${made.refused.slice(0, 8).join("; ")}`);
    ok(made.unsay.length === 0, `words: produced text that cannot be said: ${made.unsay.slice(0, 8).join("; ")}`);
    ok(made.dia.length === 0, `words: produced text with a Polish diacritic: ${made.dia.slice(0, 8).join("; ")}`);
    ok(made.bangs.length === 0, `words: "!" above the kind's cap or "!!" below 0.85 loud: ${made.bangs.slice(0, 8).join("; ")}`);
    ok(made.perc.length === 0, `words: a percussive kind stretched a letter: ${made.perc.slice(0, 8).join("; ")}`);
    ok(made.w.length === 0, `words: W stretched inside a syllable: ${made.w.slice(0, 8).join("; ")}`);
    ok(made.sz.length === 0, `words: Polish SZ stretched as SZSZSZ: ${made.sz.slice(0, 8).join("; ")}`);
    ok(made.ph.length === 0, `words: English PH stretched: ${made.ph.slice(0, 8).join("; ")}`);
    ok(made.steady.length === 0, `words: long steady sounds too short at full duration: ${made.steady.slice(0, 8).join("; ")}`);

    /* the lists: ICONIC short with reasons (above), VOICE only in voice kinds, ALLOW and VOICE with reasons */
    for ( const lang of ["pl", "en"] ) {
      ok(Object.values(VOICE[lang]).every((r) => typeof r === "string" && r.length >= 8) && Object.keys(VOICE[lang]).length <= 8, `words: the ${lang} voice list is short and every entry has a reason`);
      ok(Object.values(ALLOW[lang]).every((r) => typeof r === "string" && r.length >= 15) && Object.keys(ALLOW[lang]).length <= 20, `words: the ${lang} allow list is short and every entry has a reason`);
      ok(Object.keys(VOICE[lang]).every((w) => refusal(`${w}-${w}`, lang, { kind: "punch" }) && !refusal(`${w}-${w}`, lang, { kind: "laugh" })), `words: ${lang} voice words pass only in the voice kinds`);
      ok(Object.keys(ICONIC[lang]).every((w) => !refusal(w, lang, { kind: "punch" })) && Object.keys(ALLOW[lang]).every((w) => !refusal(w, lang, { kind: "punch" })), `words: ${lang} iconic and allowed words pass`);
    }
    /* the review's examples: plain words and near-words are caught, built sounds pass, the collapse side effects are gone */
    ok(["PLUSK", "CHLUP", "TRACH", "BACH", "PTAK", "BRAM", "GROCH", "PLOSK", "TRZAK", "KLIK", "KLYK", "SZWUM", "BRUM"].every((w) => refusal(w, "pl")) &&
      ["SPLASH", "CLICK", "WHIRR", "PEW", "SPLOTCH", "BWEEP", "THUM", "DLIP", "KREEK", "HWOOSH", "SCRAM"].every((w) => refusal(w, "en")),
      "words: the review's plain words, near-words and respellings are refused (CHLUP is no exception)");
    ok(["BA-DUM", "BADUM", "HRRO", "KRAKT", "BLAMM", "FWOOOSH"].every((w) => !refusal(w, "en")) && ["WRAM", "CZUM", "BA-DUM"].every((w) => !refusal(w, "pl")),
      "words: no collapse side effects (BAA, GRR) and no first-letter near matches (WRAM is not TRAM)");
    ok(["PLUP", "BLUP", "PLOP", "GLUP", "PLUMP", "BLUMP", "SPLUMP", "SPLOOSZ", "SPLASZ", "GLUB", "BLUB", "BULP"].every((w) => !refusal(w, "pl") && !sayable(w, "pl")) &&
      ["PLOP", "PLOOP", "PLUNK", "SPLOOSH", "GLUB", "BLUB"].every((w) => !refusal(w, "en") && !sayable(w, "en")), "words: the owner's water family passes in both languages");
    ok(["TK", "THK", "SNF", "CHK", "PFT", "BZZT", "PSST", "HMM", "GRRMM", "NNGH"].every((w) => !sayable(w, "en")) && ["KRKAK", "VVRT", "SHIIK", "PSZSZSZT"].every((w) => sayable(w, "en") || sayable(w, "pl")),
      "words: vowel-less ticks and one-sound words can be said; consonant piles, doubled plosive openings and English II cannot");
    ok(!["PIU", "PEW"].some((w) => Object.values(BANK.en.laserpistol).flat().concat(Object.values(BANK.pl.laserpistol).flat()).some((b) => syl(b).some((x) => x.replace(/(\p{L})\1+/gu, "$1") === w)))
      && ["ZAT", "TZAT"].every((w) => BANK.en.laserpistol.s.includes(w) && BANK.pl.laserpistol.s.includes(w)), "words: the laser pistol is ZAT / TZAT, not PIU PIU or PEW");
    ok(!KINDS.gunshot && V.kindOf("gunshot") === "pistol", "words: gunshot is merged into pistol (alias)");
    ok(stretchText("PHAKK", 4, ["F", "V"], "en") === "PHAAAAAKK" && stretchText("THWIT", 3, ["F", "V"], "en") === "THWIT" && stretchText("POW", 3, ["F"], "en") === "POWWWW" && stretchText("SZSZ", 3, ["S"], "pl") === "SSSSSZ" && stretchText("SHNIK", 3, ["V"], "en") === "SHHHHNIK",
      "words: the stretch rules of the review (PH is no sound of its own, W lasts only at the end after a vowel, SZ as an S run, English I never doubles)");
    ok(KIND_IDS.filter((id) => KINDS[id].perc).every((id) => KINDS[id].stretchHold.length === 0) && ["click", "pistol", "rifle", "hammer", "gunfire"].every((id) => KINDS[id].perc), "words: percussive kinds have no lasting letter");
  }
  checkKinds1(ok, bank, missing, eng);
}

/* 20. KINDS1 (2026-11-13, SPEC-KINDS items 1-6 + whizz, casings, dry fire, grenade): material as a call-time option, impact and debris
       by material (and size), shock wave and sonic boom, the fire ladder with ignite and put-out, TAILS and chains. Every new kind x tier
       x language x material yields a word that passes the same rules as the banks (no diacritic, no dictionary or near word, sayable,
       reviewed syllables, lettered by every font); the owner's fixed picks hold; chains tell the event in order. */
function checkKinds1(ok, bank, missing, eng) {
  const V = createVocab(), LANGS = ["pl", "en"], TIERS = ["s", "m", "l"];
  const NEW = ["shockwave", "sonicboom", "concussion", "impact", "debris", "whizz", "casings", "dryfire"];
  const flat = (w) => clean(w).replace(/[!?…\x27.,:]/g, "").split(/[-\s]+/).filter(Boolean).map((x) => x.replace(/(\p{L})\1+/gu, "$1"));
  ok(NEW.every((id) => KINDS[id]) && GROUPS.impact && KINDS.impact.group === "impact" && KINDS.debris.group === "impact", "kinds1: the new kinds and the impact group exist");
  ok(V.kindOf("shockwave") === "shockwave" && V.kindOf("sonic-boom") === "sonicboom" && V.kindOf("fireless") === "concussion" && V.kindOf("near-miss") === "whizz" && V.kindOf("brass") === "casings" && V.kindOf("dry-fire") === "dryfire" && V.kindOf("gust") === "whump",
    "kinds1: aliases (shockwave is its own kind now, the puff stays whump)");
  /* the variant tables: shape, every word lettered and allowed */
  { const bad = [], unrev = new Set();
    for ( const lang of LANGS ) {
      const rev = new Set(REVIEWED[lang]);
      for ( const [table, rows] of Object.entries(VARIANTS[lang]) ) for ( const [key, b] of Object.entries(rows) ) {
        if ( typeof b === "string" ) { if ( !KINDS[b] ) bad.push(`${lang} ${table}.${key}: names no kind`); continue; }
        for ( const t of TIERS ) if ( !(b[t]?.length >= 2 && b[t].length <= 4) ) bad.push(`${lang} ${table}.${key}.${t}: ${b[t]?.length} words`);
        const kind = VARY[table][0];
        for ( const w of Object.values(b).flat() ) {
          const r = refusal(w, lang, { kind }), s = sayable(w, lang);
          if ( r ) bad.push(`${lang} ${table}.${key} ${w}: ${r.why} ${r.part}~${r.like}`);
          if ( s ) bad.push(`${lang} ${table}.${key} ${w}: ${s}`);
          if ( DIACRITICS.test(w) || (lang === "pl" && /[VQX]/.test(w)) ) bad.push(`${lang} ${table}.${key} ${w}: letters`);
          if ( !renderable(w) || expand(w, 0).length > MAX_LEN ) bad.push(`${lang} ${table}.${key} ${w}: not letterable`);
          for ( const f of Object.keys(FONTS) ) if ( missing(f, w).length ) bad.push(`${lang} ${table}.${key} ${w} in ${f}`);
          for ( const x of flat(w) ) if ( !rev.has(x) ) unrev.add(`${lang} ${x}`);
        }
      }
      ok(Object.keys(VARIANTS.pl).every((t) => VARIANTS.en[t]) && Object.keys(VARIANTS.en).every((t) => VARIANTS.pl[t] && Object.keys(VARIANTS.en[t]).every((k) => VARIANTS.pl[t][k])), "kinds1: every variant row exists in both languages");
    }
    ok(bad.length === 0, `kinds1: variant-table words: ${bad.length} problems: ${bad.slice(0, 8).join("; ")}`);
    ok(unrev.size === 0, `kinds1: variant syllables not on the reviewed list: ${[...unrev].slice(0, 10).join(" ")}`);
  }
  /* every new kind x tier x language x material (and every fire row) yields a word, made by the same rules as the banks */
  { const bad = [], used = [];
    const runs = (k) => k.run ?? MAX_RUN;
    for ( const lang of LANGS ) {
      const combos = [];
      for ( const id of [...NEW, "grenade"] ) combos.push([id, {}]);
      for ( const [table, ids] of Object.entries(VARY) ) for ( const id of ids ) {
        if ( table === "fire" ) { for ( const i of [1, 2, 3, 4, 5] ) combos.push([id, { intensity: i }]); for ( const st of FIRE_STAGES ) combos.push([id, { stage: st }]); }
        else for ( const m of [...MATS, "concrete", "no-such"] ) combos.push([id, { material: m }]);
      }
      for ( const id of [...NEW, "grenade", "pistol", "crash"] ) for ( const m of MATS ) combos.push([id, { material: m }]);   // kinds without a table keep their words
      for ( const p of ["small", "medium", "large", 0.9] ) combos.push(["debris", { pieces: p }], ["debris", { pieces: p, material: "glass" }]);
      for ( const [id, o] of combos ) for ( const loud of [0.1, 0.5, 0.9, 1] ) for ( const long of [0, 0.5, 1] ) for ( const seed of [1, 2] ) {
        const w = V.word(id, { lang, loud, long, seed, ...o }), tag = `${lang}/${id}${JSON.stringify(o)}@${loud}/${long}`;
        if ( !w.text || !renderable(w.text) || w.text.replace(/[!?…]/g, "").length > MAX_LEN + 3 ) bad.push(`${tag} ${w.text}: not letterable`);
        if ( DIACRITICS.test(w.text) ) bad.push(`${tag} ${w.text}: diacritic`);
        const r = refusal(w.text, lang, { kind: id }); if ( r ) bad.push(`${tag} ${w.text}: ${r.why} ${r.part}`);
        const s = sayable(w.text, lang); if ( s ) bad.push(`${tag} ${w.text}: ${s}`);
        const k = KINDS[id], meta = w.variant != null ? VARIANT_META[k.vary]?.[w.variant] : null, cap = Math.min(2, meta?.maxBangs ?? k.maxBangs ?? 2);
        if ( w.bangs > cap || (w.text.match(/!/g) ?? []).length !== w.bangs ) bad.push(`${tag} ${w.text}: "!" ${w.bangs} over ${cap}`);
        if ( new RegExp(`(\\p{L})\\1{${meta?.run ?? runs(k)},}`, "u").test(w.text) ) bad.push(`${tag} ${w.text}: a run too long`);
        for ( const f of Object.keys(FONTS) ) if ( missing(f, w.text).length ) bad.push(`${tag} ${w.text} in ${f}`);
        const mat = materialOf(o.material);
        if ( (o.material !== undefined && w.material !== mat) || (o.material === undefined && w.material !== null) ) bad.push(`${tag}: material ${w.material}`);
        const row = k.vary ? (k.vary === "fire" ? (o.stage ?? (o.intensity != null ? String(o.intensity) : null)) : mat) : null;
        const has = row != null && VARIANTS[lang][k.vary]?.[row];
        if ( has && w.variant !== row ) bad.push(`${tag}: variant ${w.variant}, want ${row}`);
        if ( !has && w.variant !== null ) bad.push(`${tag}: variant ${w.variant} without a row`);
        if ( has ) {
          const b = typeof VARIANTS[lang][k.vary][row] === "string" ? BANK[lang][VARIANTS[lang][k.vary][row]] : VARIANTS[lang][k.vary][row];
          if ( !Object.values(b).flat().map(clean).includes(clean(w.template)) ) bad.push(`${tag}: ${w.template} is not a word of its row`);
        }
        if ( mat && MAT_CHAR[mat] && w.character.material !== MAT_CHAR[mat].material ) bad.push(`${tag}: character material ${w.character.material}`);
        used.push(w.text);
      }
    }
    ok(bad.length === 0, `kinds1: every new kind x tier x language x material: ${bad.length} problems: ${bad.slice(0, 8).join("; ")}`);
    ok(used.length > 4000, `kinds1: only ${used.length} words made`);
  }
  /* the tiers of the tables are used: quiet / normal / loud pick s / m / l, pieces pick the debris size */
  for ( const lang of LANGS ) {
    ok(TIERS.every((t, i) => V.word("impact", { lang, seed: 1, loud: [0.1, 0.5, 0.9][i], material: "metal" }).tier === t), `kinds1: ${lang} impact tiers by loudness`);
    ok(V.word("debris", { lang, seed: 1, loud: 0.1, pieces: "large", material: "stone" }).tier === "l" && V.word("debris", { lang, seed: 1, loud: 1, pieces: "small" }).tier === "s" && V.word("debris", { lang, seed: 1, loud: 1 }).tier === "l",
      `kinds1: ${lang} debris pieces pick the tier, loudness only without them`);
    ok(V.word("crack", { lang, seed: 1, material: "glass" }).template && BANK[lang].shatter.s.concat(BANK[lang].shatter.m, BANK[lang].shatter.l).includes(V.word("crack", { lang, seed: 1, material: "glass" }).template), `kinds1: ${lang} a crack on glass takes the shatter words`);
    ok(V.word("pistol", { lang, seed: 1, material: "metal" }).variant === null && V.word("pistol", { lang, seed: 1, material: "metal" }).text === V.word("pistol", { lang, seed: 1 }).text, `kinds1: ${lang} the muzzle word does not change with the target's material`);
  }
  ok(materialOf("Concrete") === "stone" && materialOf("forcefield") === "shield" && materialOf("plasma") === null && intensityOf("blaze") === 4 && intensityOf(9) === 5 && piecesOf("huge") === "l" && piecesOf(0.1) === "s", "kinds1: material, intensity and pieces names");
  /* the fire ladder: each row keeps its character */
  for ( const lang of LANGS ) {
    const e = V.word("fire", { lang, seed: 1, loud: 1, long: 1, intensity: 1 }), out = V.word("fire", { lang, seed: 1, loud: 1, intensity: 1, stage: "out" });
    ok(e.bangs === 0 && !/(\p{L})\1{2,}/u.test(e.text.replace(/[!…]/g, "")), `kinds1: ${lang} an ember never shouts and never stretches (${e.text})`);
    ok(out.variant === "out" && out.bangs === 0, `kinds1: ${lang} stage wins over intensity; put out has no "!" (${out.text})`);
    const styles = [1, 2, 3, 4, 5].map((i) => V.flow("fire", { lang, seed: 2, intensity: i }).style);
    ok(JSON.stringify(styles) === JSON.stringify(["crackle", "steady", "crackle", "gust", "drone"]) && V.flow("fire", { lang, seed: 2, stage: "out" }).style === "steady", `kinds1: ${lang} the fire rows flow in their own style (${styles})`);
    const inf = V.flow("fire", { lang, seed: 2, intensity: 5 }).take(6000), emb = V.flow("fire", { lang, seed: 2, intensity: 1 }).take(6000);
    ok(Math.max(...inf.map((x) => x.text.length)) > Math.max(...emb.map((x) => x.text.replace(/-/g, "").length)) - 2 && emb.every((x) => x.bangs === 0 && !/!/.test(x.text)), `kinds1: ${lang} an inferno drones long, embers tick without "!"`);
    for ( const f of [V.flow("fire", { lang, seed: 3, intensity: 3 }), V.flow("debris", { lang, seed: 3, material: "metal" }), V.flow("impact", { lang, seed: 3, material: "glass" })] ) {
      const seg = [f.onset, ...Array.from({ length: 16 }, (_, i) => f.at(i)), f.tail];
      ok(seg.every((x) => x.text && !refusal(x.text, lang, { kind: f.kind }) && !DIACRITICS.test(x.text) && !sayable(x.text, lang)) && seg.every((x, i) => !i || x.text !== seg[i - 1].text), `kinds1: ${lang} a ${f.kind} flow (${f.variant}) stays allowed and never repeats (${seg.slice(0, 6).map((x) => x.text).join(" ")})`);
    }
  }
  /* the owner's fixed picks (2026-11-13): BOOM / BUM only for blasts with fire, the fireless blast KROOM / KRUUM; the cave-in's BDUUM is
     not a grenade's; a shock wave never reads as a boom */
  { const words = (lang, id) => Object.values(BANK[lang][id]).flat().map(clean);
    ok(words("en", "concussion").some((w) => /^(KA-)?KR+O+M+$/.test(w)) && words("pl", "concussion").some((w) => /^(KA-)?KR+U+M+$/.test(w)), "kinds1: the fireless blast is KROOM / KRUUM (the owner's pick)");
    const noBoom = ["shockwave", "concussion", "debris", "impact", "sonicboom", "whizz", "casings", "dryfire"];
    ok(noBoom.every((id) => LANGS.every((lang) => words(lang, id).every((w) => !flat(w).some((x) => x === "BOM" || x === "BUM")))), "kinds1: no BOOM / BUM outside blasts with fire");
    ok(!words("pl", "grenade").some((w) => flat(w).includes("BDUM")) && !words("en", "grenade").some((w) => flat(w).includes("BTHOM")), "kinds1: the grenade does not take the cave-in's BDUUM / BTHOOM");
    ok(LANGS.every((lang) => ["s", "m", "l"].every((t) => BANK[lang].grenade[t].every((w) => !BANK[lang].boom[t].includes(w)))), "kinds1: the grenade has its own words now (not the boom's)"); }
  /* TAILS: the twin of PREFIXES, each with its reason */
  { const bad = [];
    for ( const [id, list] of Object.entries(TAILS) ) {
      if ( !KINDS[id] ) bad.push(`${id}: no kind`);
      for ( const x of list ) if ( !KINDS[x.kind] || !(typeof x.why === "string" && x.why.length >= 20) || !(x.t >= 0) || !(x.rel > 0 && x.rel <= 1) || !PLACES.includes(x.place) || x.kind === id ) bad.push(`${id} -> ${x.kind}: incomplete`);
    }
    ok(bad.length === 0, `kinds1: TAILS entries: ${bad.join("; ")}`);
    ok(V.tails("boom").map((x) => x.kind).join() === "shockwave,debris" && V.tails("impact", { material: "water" }).length === 0 && V.tails("impact", { material: "wood" })[0].material === "wood" && V.tails("shatter")[0].material === "glass" && V.tails("hiss").length === 0,
      "kinds1: tails() lists a sound's own aftermath, skips it where it does not happen, carries the material"); }
  /* CHAINS: the story of an event in order (build, peak, develop, resolve) */
  { const bad = [];
    for ( const [name, c] of Object.entries(CHAINS) ) {
      if ( !(typeof c.why === "string" && c.why.length >= 20) || !c.steps.every((s) => KINDS[s.kind] && ROLES.includes(s.role) && PLACES.includes(s.place)) ) bad.push(`${name}: steps`);
      for ( const lang of LANGS ) {
        const a = V.chain(name, { lang, seed: "c", magnitude: 1.2, material: "stone" }), b = V.chain(name, { lang, seed: "c", magnitude: 1.2, material: "stone" });
        if ( JSON.stringify(a.map((s) => [s.t, s.word.text])) !== JSON.stringify(b.map((s) => [s.t, s.word.text])) ) bad.push(`${lang} ${name}: not deterministic`);
        if ( a.some((s, i) => i && s.t < a[i - 1].t) ) bad.push(`${lang} ${name}: out of order`);
        const peak = a.find((s) => s.role === "peak");
        if ( !peak || a.some((s) => s.word.loud > peak.word.loud + 1e-9) ) bad.push(`${lang} ${name}: the peak is not the loudest`);
        const last = a.at(-1); if ( last !== peak && last.word.loud >= peak.word.loud ) bad.push(`${lang} ${name}: it does not resolve`);
        for ( const s of a ) { const r = refusal(s.word.text, lang, { kind: s.kind }); if ( r || DIACRITICS.test(s.word.text) || sayable(s.word.text, lang) ) bad.push(`${lang} ${name}: ${s.word.text}`); }
        if ( a.some((s, i) => i && s.word.text === a[i - 1].word.text) ) bad.push(`${lang} ${name}: the same word twice in a row`);
      }
    }
    ok(bad.length === 0, `kinds1: chains: ${bad.slice(0, 8).join("; ")}`);
    const ex = V.chain("explosion", { lang: "en", seed: 1, magnitude: 1.5 }), fast = V.chain("explosion", { lang: "en", seed: 1, magnitude: 1.5, tempo: 2 });
    ok(ex.map((s) => s.kind).join() === "boom,shockwave,debris,debris,debris" && ex.slice(2).map((s) => s.word.tier).join() === "l,m,s" && fast.at(-1).t === Math.round(ex.at(-1).t / 2), "kinds1: the explosion: blast, wave, debris big to small; tempo scales the times");
    const one = V.chain("gunfire", { lang: "pl", seed: 1 }), steps = V.chain([{ kind: "punch", material: "metal", layer: "under" }, { kind: "debris", t: 200, rel: 0.5 }], { lang: "en", seed: 1, tails: true });
    ok(one.length === 2 && one[1].kind === "casings" && one[1].tailOf === "gunfire" && one[1].place === "feet", "kinds1: one kind = the sound and its tails");
    ok(steps[0].word.variant === "metal" && steps[0].play.layer === "under" && !("material" in steps[0].play) && steps[1].t === 200 && steps.length === 2, "kinds1: own steps keep their word options and pass the rest to L.play");
    ok(V.chain("grenade", { lang: "en", seed: 1 }).some((s) => s.kind === "grenade" && s.role === "peak" && s.place === "target") && V.chain("burst", { lang: "en", seed: 1, material: "metal" }).find((s) => s.kind === "impact").word.variant === "metal", "kinds1: grenade and burst chains: the blast at the target, the impact by material");
  }
  /* the engine carries it: L.chain, the word options are not play options */
  ok(/function chain\(spec, opts = \{\}\)/.test(eng) && /flow: vocab\.flow, chain,/.test(eng) && /VOCAB_KEYS = \[[^\]]*"material", "pieces", "intensity", "stage"/.test(eng), "kinds1: L.chain is on the engine and material / pieces / intensity / stage stay vocabulary options");
  ok(Array.isArray(V.hitMaterials) && V.chains.includes("explosion") && V.variants("impact", "pl").rows.metal.l.length >= 2 && V.variants("crack", "en").rows.glass.from === "shatter" && V.variants("hiss") === null, "kinds1: L.vocab.variants / hitMaterials / chains for pickers and sheets");
}
