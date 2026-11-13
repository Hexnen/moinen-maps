// LETR tools (contract v6): node checks of the engine-wide preferences, the plan filters (palette, motion, flash guard), the
// authoring API, the networking helper and the i18n tables. Run by check.mjs (both modules); `run(ok, ctx)` with ctx = { plan, bank }.
import fs from "node:fs";
import { SETTINGS, DEFAULTS, clean, cleanAll, reducedFor, resolveOpts, filterPlan, flashTimes, handFrom, CONTRAST, CVD, PHOTO } from "./prefs.mjs";
import { registerMood, registerPalette, registerFont, makeStyles, motionNames, shade } from "./author.mjs";
import { wireOpts, wireValue, unwire, missingToken, localStart, checkMsg, rateGate, OP_KEYS } from "./net.mjs";
import { STRINGS } from "./strings.mjs";
import { MOODS, MOOD_IDS, COLORS, FONTS, TICK, makePlan } from "./design.mjs";
import { paintPicture } from "./paint.mjs";

export async function run(ok, { plan, bank, fontsApi }) {
  const P = (o = {}) => ({ ...DEFAULTS, ...o });
  const all = (p) => [...p.timeline.ent, ...p.timeline.hold, ...p.timeline.exit];

  /* settings: defaults, cleaning of stored values */
  ok(Object.keys(DEFAULTS).length === Object.keys(SETTINGS).length && DEFAULTS.enabled === true && DEFAULTS.scale === 1 && DEFAULTS.photosafe === true, "tools: defaults");
  ok(clean("scale", 99) === 2.5 && clean("scale", "x") === 1 && clean("motion", "wild") === "auto" && clean("enabled", "yes") === true && clean("limitWorld", 2) === 4, "tools: stored values are cleaned");
  ok(JSON.stringify(cleanAll({})) === JSON.stringify(DEFAULTS), "tools: cleanAll of nothing = defaults");

  /* motion: the strongest reduction wins */
  ok(reducedFor("reduced", false, false) === true && reducedFor("auto", undefined, true) === true && reducedFor("auto", false, true) === false
    && reducedFor("full", undefined, true) === false && reducedFor("full", true, false) === true && reducedFor("gentle", undefined, false) === false, "tools: reduced motion table");

  /* options: master switch, size, styles, hand ids (F18) */
  ok(resolveOpts({ mood: "boom" }, P({ enabled: false })) === null, "tools: master off -> no word");
  ok(resolveOpts({ force: true }, P({ enabled: false })) !== null, "tools: force plays even when off (designer, still)");
  const src = { mood: "boom", seed: 1 };
  const ro = resolveOpts(src, P({ scale: 1.5 }));
  ok(ro._k === 1.5 && ro !== src && src._k === undefined, "tools: the size setting travels as _k, the caller's object untouched");
  const st = { hammer: { mood: "zap", palette: "volt", in: "pop", magnitude: 0.9, label: "Hammer" } };
  const r1 = resolveOpts({ style: "hammer", magnitude: 0.2 }, P(), st);
  ok(r1.mood === "zap" && r1.in === "pop" && r1.magnitude === 0.2 && r1.palette === "volt" && r1.label === undefined, "tools: a style lies under the call's own options");
  const r2 = resolveOpts({ hand: "bangers/jag/zig/volt/sticker/vgrad" }, P());
  ok(r2.hand.font === "bangers" && r2.hand.env === "zig" && r2.palette === "volt", "tools: hand given as the handle's id string is used (F18)");
  ok(handFrom("") === null && handFrom(null) === null && handFrom({ font: "anton" }).font === "anton", "tools: hand forms");
  const pin = plan("ZAP", { ...resolveOpts({ hand: "anton/plain/slant/ice/ink/flat", seed: 4 }, P()) });
  ok(pin.hand.font === "anton" && pin.hand.env === "slant" && pin.hand.fill === "flat", "tools: a pinned hand id reaches the plan");
  ok(resolveOpts({ font: "titan", seed: 1 }, P()).hand.font === "titan", "tools: font option pins the font");

  /* plan filters */
  const ctx = (o = {}) => ({ prefs: P(o.prefs), colors: COLORS, TICK, flashLog: o.log ?? [], now: 0, t0: o.t0 ?? 0, capPx: o.capPx ?? 40, vh: 800, preview: o.preview });
  const withFlash = (k) => { for ( let i = 0; i < 400; i++ ) { const p = plan("POW!", { mood: "impact", seed: `fl${k}${i}` }); if ( flashTimes(p, TICK).length ) return p; } return null; };
  const f0 = withFlash("a");
  ok(!!f0, "tools: some impact words carry a flash frame (test material)");
  if ( f0 ) {
    const ticks = all(f0).map((q) => q.ticks).join();
    const off = filterPlan(JSON.parse(JSON.stringify(f0)), {}, ctx({ prefs: { flashes: false } }));
    ok(flashTimes(off, TICK).length === 0 && all(off).map((q) => q.ticks).join() === ticks, "tools: flashes off removes flash frames, timing unchanged");
    const big = filterPlan(JSON.parse(JSON.stringify(f0)), {}, ctx({ capPx: 800 * PHOTO.bigVh + 1 }));
    ok(flashTimes(big, TICK).length === 0, "tools: photosensitivity guard: no flash on a big word");
    const unguarded = filterPlan(JSON.parse(JSON.stringify(f0)), {}, ctx({ prefs: { photosafe: false }, capPx: 700 }));
    ok(flashTimes(unguarded, TICK).length === flashTimes(f0, TICK).length, "tools: guard off keeps flash frames");
    /* rate: words started together cannot flash more than PHOTO.maxPerSec times a second on one client */
    const log = []; let n = 0;
    for ( let i = 0; i < 6; i++ ) { const q = filterPlan(JSON.parse(JSON.stringify(f0)), {}, ctx({ log, t0: i * 50 })); n += flashTimes(q, TICK).length; }
    ok(n <= PHOTO.maxPerSec, `tools: at most ${PHOTO.maxPerSec} flashes a second (${n})`);
    const later = filterPlan(JSON.parse(JSON.stringify(f0)), {}, ctx({ log, t0: 5000 }));
    ok(flashTimes(later, TICK).length >= 1, "tools: the flash budget refills after a second");
    const pv = filterPlan(JSON.parse(JSON.stringify(f0)), {}, ctx({ log: [0, 1, 2, 3], preview: true }));
    ok(flashTimes(pv, TICK).length >= 1, "tools: the designer's preview does not spend the flash budget");
  }
  /* misregistration plates never jump between drawings under the guard (zap buzz alternates them) */
  let jumpy = 0, steadyOk = true;
  for ( let i = 0; i < 30; i++ ) {
    const p = plan("BZZZT", { mood: "zap", seed: `mr${i}`, holdKind: "buzz" });
    if ( new Set(p.timeline.hold.map((q) => q.misreg)).size > 1 ) jumpy++;
    filterPlan(p, {}, ctx());
    if ( new Set(all(p).filter((q) => !q.impact).map((q) => q.misreg)).size > 1 ) steadyOk = false;
  }
  ok(jumpy > 0 && steadyOk, `tools: guard holds the colour plates still (${jumpy} jumpy plans fixed)`);
  /* gentle motion: smaller moves, no smear frames */
  {
    const a = plan("WHAM!", { mood: "impact", seed: "g1", in: "slam", holdKind: "shake" }), b = JSON.parse(JSON.stringify(a));
    filterPlan(b, {}, ctx({ prefs: { motion: "gentle" } }));
    const mag = (p) => all(p).reduce((s, q) => s + Math.abs(q.g.x) + Math.abs(q.g.y) + Math.abs(q.g.s - 1), 0);
    ok(mag(b) < mag(a) * 0.6 && all(b).every((q) => !q.smear), "tools: gentle motion damps moves and drops smears");
  }
  /* palettes */
  {
    const a = plan("OUCH", { mood: "pain", seed: "c1" });
    filterPlan(a, {}, ctx({ prefs: { palette: "contrast" } }));
    const w = a.hand.inkW;
    filterPlan(a, {}, ctx({ prefs: { palette: "contrast" } }));
    ok(a.hand.ink === CONTRAST.ink && a.hand.pal.fill[0] === CONTRAST.fill[0] && a.hand.tex === "none" && a.hand.inkW === w, "tools: high contrast palette, applied once");
    const own = plan("OUCH", { mood: "pain", seed: "c1", colors: ["#ff0000", "#aa0000", "#550000"] });
    filterPlan(own, { colors: ["#ff0000"] }, ctx({ prefs: { palette: "contrast" } }));
    ok(own.hand.pal.fill[0] === "#ff0000" && own.hand.ink === "#000000", "tools: high contrast keeps a caller's own colours, black ink");
    const pain = plan("OUCH", { mood: "pain", seed: "c2" }), heal = plan("+2", { mood: "heal", seed: "c2" });
    filterPlan(pain, {}, ctx({ prefs: { palette: "cvd" } })); filterPlan(heal, {}, ctx({ prefs: { palette: "cvd" } }));
    ok(pain.hand.pal.fill[1] !== heal.hand.pal.fill[1] && Object.keys(COLORS).every((k) => CVD[k]), "tools: colour-blind palette covers every family, pain and heal differ");
    const hue = (hex) => { const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if ( mx === mn ) return -1; const d = mx - mn; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
    const green = Object.values(CVD).filter((c) => c.fill.some((x) => { const h = hue(x); return h > 75 && h < 160; }));
    ok(green.length === 0, "tools: colour-blind palettes carry no green");
    const pf = plan("SPLASH", { mood: "splash", seed: "pf" });
    filterPlan(pf, { palette: "volt" }, ctx());
    ok(pf.hand.colorFam === "volt" && COLORS.volt.some((c) => c.fill[0] === pf.hand.pal.fill[0]) && pf.hand.id.split("/")[3] === "volt", "tools: palette by family name");
  }

  /* authoring */
  {
    ok(registerMood("frost", { extends: "crack", label: "ice cracking", sound: { pitch: 0.4, loud: 2 }, colors: { ice: 4 } }) === "frost" && MOOD_IDS.includes("frost"), "tools: register a mood");
    ok(MOODS.frost.sound.loud === 1 && MOODS.frost.sound.pitch === 0.4 && MOODS.frost.colors.ice === 4 && MOODS.frost.in.crackIn > 0, "tools: a registered mood extends and clamps");
    let threw = 0;
    for ( const bad of ["toString", "constructor", "__proto__", "auto", "Bad", "x y", ""] ) { try { registerMood(bad, {}); } catch { threw++; } }
    ok(threw === 7, "tools: reserved and malformed mood ids are refused (F15)");
    try { registerMood("weird", { fonts: { nofont: 1 } }); ok(false, "tools: unknown font in a mood refused"); } catch { ok(true, ""); }
    const p = plan("BRRR-KSSH", { mood: "frost", seed: 3 });
    ok(p.mood === "frost" && p.hand.colorFam === "ice", "tools: a registered mood letters a word");
    ok(registerPalette("venom", [["#e8ffb0", "#9be22a", "#2f6e1f"]]) === "venom" && COLORS.venom[0].fill[2] === "#2f6e1f" && /^#[0-9a-f]{6}$/.test(COLORS.venom[0].ext), "tools: register a palette (short form)");
    registerPalette("duo", { fill: ["#ffffff", "#ff00aa"], ext: "#220011", out2: ["#000000"], ink: "#000000" });
    ok(COLORS.duo[0].fill.length === 3 && COLORS.duo[0].ink === "#000000", "tools: register a palette (full form)");
    try { registerPalette("nope", [["red"]]); ok(false, "tools: bad colours refused"); } catch { ok(true, ""); }
    ok(shade("#808080", -0.5) === "#404040" && shade("#000", 0.5) === "#808080", "tools: shade");
    const buf = fs.readFileSync(new URL(FONTS.bangers.file, import.meta.url));
    await registerFont("grit", { buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), sharp: 0.9 }, bank);
    ok(FONTS.grit?.custom && bank.has("grit") && bank.glyph("grit", "Ż").contours.length > 0, "tools: register a font (Polish letters lettered)");
    const pg = plan("ŻÓŁW", { hand: { font: "grit" }, seed: 1 });
    const r = paintPicture(pg, bank, pg.timeline.hold[0], 120, (w, h) => ({ width: w, height: h, getContext: () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k.startsWith("create") ? () => ({ addColorStop() {} }) : (k === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : () => {}))), set: (t, k, v) => ((t[k] = v), true) }) }));
    ok(pg.hand.font === "grit" && r.canvas.width > 4, "tools: a registered font paints");
    const S = makeStyles();
    S.register("Młot Thora", { mood: "frost", palette: "venom", font: "grit", in: "pop", junk: 1 });
    ok(S.get("Młot Thora").junk === undefined && S.list().some((s) => s.name === "Młot Thora")   /* LOOK: built-in styles come first */, "tools: a style keeps only known keys, Polish names work");
    let bad = 0; for ( const [n, s] of [["x", { mood: "nomood" }], ["y", { palette: "nopal" }], ["z", { font: "nofont" }], ["", {}], ["toString", {}]] ) { try { S.register(n, s); } catch { bad++; } }
    ok(bad === 5, "tools: styles with unknown moods, palettes, fonts or bad names are refused");
    const fromWorld = new Set();
    S.syncWorld({ a: { mood: "boom" }, b: { mood: "zap" } }, fromWorld);
    S.syncWorld({ b: { mood: "zap" } }, fromWorld);
    ok(!S.get("a") && S.get("b") && S.get("Młot Thora"), "tools: world styles follow the setting, code-registered ones stay");
    const mn = motionNames();
    ok(["slam", "pop", "crackIn"].every((k) => mn.in.includes(k)) && mn.hold.includes("buzz") && mn.out.includes("shatter"), "tools: the motion vocabulary for the designer");
  }

  /* networking */
  {
    const warned = [];
    const tokDoc = { documentName: "Token", id: "T1" }, tokObj = { document: tokDoc };
    const w = wireOpts({ at: tokObj, token: tokDoc, from: { x: 1, y: 2 }, mood: "boom", until: Promise.resolve(), parent: {}, colors: ["#fff"], sound: { loud: 1 }, reduced: true, junk: 1 }, OP_KEYS, (k) => warned.push(k));
    ok(w.at.token === "T1" && w.token.token === "T1" && w.mood === "boom" && w.colors[0] === "#fff" && w.until === undefined && w.reduced === undefined && w.junk === undefined, "tools: net: what travels (tokens as ids, no reduced, no unknown keys)");
    ok(warned.includes("until") && warned.includes("parent"), "tools: net: Promises and elements are refused with a warning");
    ok(wireValue(() => 1, "at", (k) => warned.push(`f${k}`)) === undefined && warned.includes("fat"), "tools: net: a function `at` cannot travel");
    const back = unwire(w, (id) => (id === "T1" ? tokDoc : null));
    ok(back.at === tokDoc && back.from.x === 1 && !missingToken(w, back), "tools: net: tokens come back on the receiving client");
    const gone = unwire(w, () => null);
    ok(missingToken(w, gone), "tools: net: a token missing there (another scene) skips the word");
    ok(localStart(1500, 1000, 50).delay === 500 && localStart(1000, 1300, 5000).startAt === 4700, "tools: net: shared start -> local delay / startAt (F6)");
    ok(checkMsg({ t: "letr", id: "a", op: "play", at: 1, text: "x".repeat(999) }).text.length === 160 && !checkMsg({ t: "letr", id: "a", op: "rm -rf", at: 1 }) && !checkMsg({ t: "x" }) && !checkMsg({ t: "letr", id: "a", op: "play" }), "tools: net: messages are checked and capped");
    const g = rateGate(3);
    ok([g("u", 0), g("u", 10), g("u", 20), g("u", 30), g("v", 30), g("u", 1100)].join() === "true,true,true,false,true,true", "tools: net: per-sender rate gate");
  }

  /* i18n: both languages carry every key; every key the windows use exists */
  {
    const en = Object.keys(STRINGS.en), pl = Object.keys(STRINGS.pl);
    ok(en.length === pl.length && en.every((k) => k in STRINGS.pl), "tools: Polish and English strings match");
    const used = new Set();
    for ( const f of ["ui.mjs", "tools.mjs"] ) {
      const s = fs.readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
      for ( const m of s.matchAll(/\bT\("([A-Za-z.]+)"/g) ) used.add(`LETR.${m[1]}`);
      for ( const m of s.matchAll(/\bt\("([A-Za-z.]+)"/g) ) used.add(`LETR.${m[1]}`);
      for ( const m of s.matchAll(/"(LETR\.[A-Za-z.]+)"/g) ) used.add(m[1]);
    }
    const missing = [...used].filter((k) => !(k in STRINGS.en) && !/\.$/.test(k));
    ok(missing.length === 0, `tools: strings missing: ${missing.join(", ")}`);
    for ( const m of MOOD_IDS.filter((x) => !MOODS[x].custom) ) ok(`LETR.Mood.${m}` in STRINGS.pl, `tools: mood ${m} has a Polish name`);
    for ( const k of Object.keys(SETTINGS) ) ok(`LETR.Settings.${k}.Name` in STRINGS.en && `LETR.Settings.${k}.Hint` in STRINGS.pl, `tools: setting ${k} has words`);
  }

  /* the engine's tool hooks are in place (source pins: the filters must run in play, start and still) */
  {
    const eng = fs.readFileSync(new URL("./engine.mjs", import.meta.url), "utf8"), idx = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
    ok(/for \( const f of ext\.opts \)/.test(eng) && /return offHandle\(/.test(eng) && /for \( const f of ext\.plan \) f\(h\.plan, h\)/.test(eng) && /ext\.start/.test(eng), "tools: engine runs the opts / plan / start hooks");
    ok(/info\.size \* \(h\.opts\._k \?\? 1\)/.test(eng), "tools: the size setting applies after the legibility clamp");
    ok(/import \* as tools from "\.\/tools\.mjs"/.test(idx) && /REG\.toolsHooked/.test(idx), "tools: index registers the tools once (newest copy)");
  }
}
