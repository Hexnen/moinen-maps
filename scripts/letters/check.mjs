// LETR: node checks of the lettering engine's logic (fonts, Polish letters, intent -> shape, determinism, variety, timeline,
// motion directions, streams, the size model, painting on a recording mock context, the copy manifest). Run: node scripts/letters/check.mjs
// Prints "letters: N checks, F failed"; exit 1 on any failure. Both modules run it (maps: dev/letters.test.mjs, plus-ultra:
// scripts/sweep-checks/letters.mjs).
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FontBank } from "./fontbank.mjs";
import { makePlan, FONTS, MOODS, MOOD_IDS, guessMood, soundOf, envelope, syllablesOf, TICK } from "./design.mjs";
import { paintPicture, MAX_SIDE } from "./paint.mjs";
import { normals, jag } from "./geom.mjs";
import { area } from "./font.mjs";
import { rng } from "./rng.mjs";
import { sizeFor, naturalSize, limits as sizeLimits, magnitudeOf, SIZE } from "./size.mjs";

let n = 0, failed = 0;
const ok = (c, msg) => { n++; if ( !c ) { failed++; console.log("FAIL", msg); } };

const bank = new FontBank();
for ( const [id, f] of Object.entries(FONTS) ) { const b = fs.readFileSync(new URL(f.file, import.meta.url)); bank.add(id, b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); }
const fontsApi = { adv: (f, c) => bank.adv(f, c) };
const plan = (t, o = {}, mem = []) => makePlan(t, o, fontsApi, mem);

/* 1. every font letters every Polish capital, digit and sign: its own glyph, a synthesised one, or the fallback */
const PL = "ĄĆĘŁŃÓŚŹŻ", ALL = PL + "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?-+";
for ( const id of Object.keys(FONTS) ) for ( const ch of ALL ) {
  const g = bank.glyph(id, ch);
  ok(g && g.contours.length > 0 && g.adv > 0.1, `${id} has no outline for ${ch}`);
}
/* the synthesised Polish letters carry an accent: more contours than the base letter (Knewave has no Polish letters of its own) */
for ( const [ch, base] of [["Ą", "A"], ["Ć", "C"], ["Ę", "E"], ["Ł", "L"], ["Ń", "N"], ["Ś", "S"], ["Ź", "Z"], ["Ż", "Z"]] ) {
  const g = bank.glyph("knewave", ch), b = bank.glyph("knewave", base);
  ok(g.font === "knewave" && g.contours.length > b.contours.length, `knewave ${ch} not built from its own ${base} + accent`);
}

/* 2. outward normals: a jagged square grows, for either winding */
for ( const sq of [[0, 0, 1, 0, 1, 1, 0, 1], [0, 0, 0, 1, 1, 1, 1, 0]] ) {
  const N = normals(sq);
  ok(N[0] < 0 && N[1] < 0, `normal of the corner (0,0) points outward (${N[0].toFixed(2)},${N[1].toFixed(2)})`);
  const r = rng(1), c = []; for ( let i = 0; i < 4; i++ ) for ( let k = 0; k < 10; k++ ) { const j = (i + 1) % 4; c.push(sq[2 * i] + (sq[2 * j] - sq[2 * i]) * k / 10, sq[2 * i + 1] + (sq[2 * j + 1] - sq[2 * i + 1]) * k / 10); }
  ok(Math.abs(area(jag(c, 0.08, 4, r))) > Math.abs(area(c)) * 0.97, "a jagged outline keeps its size (spikes outward)");
}

/* 3. the auto intent reads the word's sound */
for ( const [w, m] of [["KRAK!", "crack"], ["KABOOM!", "boom"], ["GRRROAR", "roar"], ["BZZZT", "zap"], ["SPLASH", "splash"], ["-3", "pain"], ["+2", "heal"], ["klik", "tick"], ["WHOOSH", "whoosh"], ["FWOOSH", "fire"], ["ŁUBUDU", "crash"], ["ARGH", "pain"], ["PFFT", "fail"], ["TRZASK", "crack"], ["12", "impact"]] )
  ok(guessMood(w) === m, `auto mood of ${w} is ${guessMood(w)}, want ${m}`);
ok(soundOf("WHOOOOOSH", "whoosh").long > soundOf("WHOSH", "whoosh").long, "repeated letters make the sound longer");
ok(soundOf("POW!", "impact").loud > soundOf("POW", "impact").loud, "! makes it louder");
ok(soundOf("X", "impact", { loud: 0.2, pitch: -1 }).loud === 0.2 && soundOf("X", "impact", { pitch: -1 }).pitch === -1, "sound overrides win");
ok(plan("x", { sound: { loud: 0.1, sharp: 0.6, long: 0 } }).mood === "tick", "a custom quiet sharp sound picks the tick vocabulary");

/* 4. determinism and variety */
ok(JSON.stringify(plan("KRAK!", { mood: "crack", seed: "m1" })) === JSON.stringify(plan("KRAK!", { mood: "crack", seed: "m1" })), "same seed, same plan");
for ( const m of MOOD_IDS ) {
  const hands = new Set(), fonts = new Set(), envs = new Set(), cols = new Set();
  for ( let i = 0; i < 24; i++ ) { const p = plan("BLAM!", { mood: m, seed: `${m}${i}` }); hands.add(p.hand.id); fonts.add(p.hand.font); envs.add(p.hand.env); cols.add(p.hand.pal.fill.join()); }
  ok(hands.size >= 12, `${m}: only ${hands.size} different hands in 24 seeds`);
  ok(fonts.size >= Math.min(2, Object.values(MOODS[m].fonts).filter((w) => w > 0).length), `${m}: fonts do not vary`);
  ok(envs.size >= 2 && cols.size >= 2, `${m}: warps or colours do not vary`);
}
{ /* the recent-hands memory: the next word differs in font, warp and colour family where the mood allows */
  let same = 0;
  for ( let i = 0; i < 40; i++ ) { const a = plan("POW", { mood: "impact", seed: `a${i}` }); const b = plan("BAM", { mood: "impact", seed: `b${i}` }, [a.hand.id]); if ( a.hand.font === b.hand.font || a.hand.env === b.hand.env ) same++; }
  ok(same === 0, `two words at once share font or warp ${same}/40 times`);
}
{ const a = plan("RA", { mood: "impact", seed: 1 }), b = plan("TA", { mood: "impact", seed: 2, hand: a.hand }); ok(b.hand.id === a.hand.id && b.hand.font === a.hand.font, "a pinned hand is kept"); }

/* 5. intent -> shape: the loudest letters sit where the sound peaks; swell grows, shrink fades; rising pitch climbs */
{
  const p = plan("WHAAAAM", { mood: "roar", seed: 3, sound: { peak: 1 } });
  const s = p.layout.letters.map((l) => l.s);
  if ( p.hand.env !== "shrink" ) ok(s[s.length - 1] > s[0], `roar swells toward the end (${s.map((x) => x.toFixed(2))})`);
  const q = plan("KRAKKK", { mood: "impact", seed: 9, sound: { peak: 0 } });
  const t = q.layout.letters.map((l) => l.s);
  if ( q.hand.env !== "swell" && q.hand.env !== "streak" ) ok(t[0] > t[t.length - 1], "a sharp attack is biggest at the start");
  for ( let i = 0; i < 10; i++ ) { const u = plan("VRRRMMM", { mood: "powerup", seed: `u${i}` }); if ( u.hand.env === "stairUp" ) ok(u.layout.letters.at(-1).dy < u.layout.letters[0].dy, "power-up letters climb (screen-up)"); }
  const r = plan("BOOM", { mood: "boom", seed: 1, from: 180 });
  ok(r.hand.env === "swell", "a sound from the left grows to the right");
  const r2 = plan("BOOM", { mood: "boom", seed: 1, from: 0 });
  ok(r2.hand.env === "shrink", "a sound from the right is biggest on the left");
  const e = envelope({ kind: "arc", W: 4, ang: 0.6, rot: 0 });
  const mid = e(2, -0.5), end = e(0, -0.5);
  ok(Math.abs(mid[0] - 2) < 1e-9 && Math.abs(mid[1] + 0.5) < 1e-9 && end[1] > mid[1], "an arc keeps its middle and bends its ends down");
}

/* 6. the timeline: whole ticks, the comic clock, sane lengths, directions of motion */
const rising = new Set(["rise"]), falling = new Set(["fall", "droop"]);
for ( const m of MOOD_IDS ) for ( let i = 0; i < 12; i++ ) {
  const p = plan(i % 2 ? "KA-BOOM!" : "ŻÓŁW", { mood: m, seed: `t${m}${i}` });
  const tl = p.timeline, pics = [...tl.ent, ...tl.hold, ...tl.exit];
  ok(tl.ent.length >= 1 && tl.hold.length >= 3 && tl.exit.length >= 1, `${m}: missing part of the timeline`);
  ok(pics.every((q) => Number.isInteger(q.ticks) && q.ticks >= 1 && q.ticks <= 6), `${m}: pictures must last 1-6 ticks of 24 fps (stepped animation; 5-6 = a held key pose)`);
  ok(pics.filter((q) => q.ticks >= 2).length >= pics.length * (m === "whoosh" ? 0.55 : 0.7), `${m}: mostly on twos or threes (about 12 drawings a second)`);
  ok(pics.filter((q) => q.ticks === 1).length <= 4 && tl.hold.every((q) => q.ticks >= 2), `${m}: ones only for smears, flash and snap frames, never in the hold`);
  ok(pics.filter((q) => q.impact).every((q) => q.ticks === 1), `${m}: an impact (flash) frame lasts one tick`);
  const ms = (a) => a.reduce((s, q) => s + q.ticks * TICK, 0);
  ok(ms(tl.ent) <= 1000 && ms(tl.exit) <= 800, `${m}: entrance ${ms(tl.ent) | 0} ms / exit ${ms(tl.exit) | 0} ms too long`);
  ok(new Set(tl.hold.map((q) => q.boil)).size === tl.hold.length, `${m}: every hold picture is a new drawing`);
  const lastY = (q) => q.g.y + (q.letters.reduce((s, l) => s + l.y, 0) / Math.max(1, q.letters.length));
  if ( rising.has(tl.kinds.out) ) ok(lastY(tl.exit.at(-1)) < -0.2, `${m}: a rising exit goes screen-up`);
  if ( falling.has(tl.kinds.out) ) ok(lastY(tl.exit.at(-1)) > 0.2, `${m}: a falling exit goes screen-down`);
  if ( tl.kinds.in === "drop" ) ok(tl.ent[0].letters.find((l) => l.v)?.y < 0, `${m}: dropped letters come from above`);
  if ( tl.kinds.in === "rise" ) ok(tl.ent[0].letters.find((l) => l.v)?.y > 0, `${m}: rising letters come from below`);
  ok(tl.exit.at(-1).dissolve > 0 || ["shrink"].includes(tl.kinds.out), `${m}: the last exit picture is (being) erased`);
}
{ const p = plan("POW", { mood: "impact", seed: 1, reduced: true }); ok(p.timeline.ent.length === 1 && p.timeline.hold.every((q) => q.g.x === 0 && q.g.y === 0), "reduced motion: one entrance picture, no shake"); }
ok(plan("POW", { mood: "impact", seed: 1, hold: 2000 }).holdMs === 2000 && plan("POW", { mood: "impact", seed: 1, hold: 2000, tempo: 2 }).holdMs === 1000, "hold and tempo");

/* 7. streams split their syllables */
ok(JSON.stringify(syllablesOf("ratatata")) === '["RA","TA","TA","TA"]', "RATATATA -> RA TA TA TA");
ok(JSON.stringify(syllablesOf("RA-TA-TA")) === '["RA","TA","TA"]' && JSON.stringify(syllablesOf("BZZZT")) === '["BZZZT"]', "explicit and vowelless syllables");

/* 8. painting: every picture of every mood paints without throwing, inside the side cap, on a recording mock context */
{
  let pics = 0, calls = 0, big = 0;
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : (k === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : () => { calls++; }))), set: (t, k, v) => ((t[k] = v), true) });
  const make = (w, h) => ({ width: w, height: h, getContext: () => ctx });
  for ( const m of MOOD_IDS ) for ( const w of ["KRAK!", "ĄĆĘŁŃÓŚŹŻ", "WHOOOOOOOOOOOOOOOM", "-3"] ) {
    const p = plan(w, { mood: m, seed: `p${m}${w}` });
    for ( const q of [...p.timeline.ent, ...p.timeline.hold, ...p.timeline.exit] ) {
      const r = paintPicture(p, bank, q, 300, make); pics++;
      if ( r.canvas.width > MAX_SIDE + 2 || r.canvas.height > MAX_SIDE + 2 ) big++;
      ok(Number.isFinite(r.ax) && Number.isFinite(r.ay) && r.canvas.width > 4, `${m} ${w}: bad picture`);
    }
  }
  ok(big === 0, `${big} pictures over the side cap`);
  ok(calls > pics * 10, "painting issues draw calls");
}

/* 8b. size model (size.mjs): legibility floor, viewport ceiling, monotonic zoom response, token / area / magnitude growth,
   the explicit size, fit modes, pixel snapping, crowding, and no blow-up of small pictures (README "Size") */
{
  const base = { space: "world", grid: 100, vw: 1100, vh: 768, sizeK: 1, aspect: 3 };
  const zooms = [0.1, 0.15, 0.2, 0.3, 0.45, 0.6, 0.8, 1, 1.5, 2, 3, 4];
  for ( const ctx of [{}, { sizeK: 0.7 }, { area: 1000, magnitude: 1 }, { tokenSpan: 400 }, { magnitude: 0 }, { size: 30 }, { aspect: 9, magnitude: 1.5 }] ) {
    let prev = 0;
    for ( const z of zooms ) {
      const r = sizeFor({ ...base, ...ctx, zoom: z }), L = sizeLimits({ ...base, ...ctx });
      ok(r.px >= prev - 1e-9, `size: px falls while zooming in ${JSON.stringify(ctx)} @${z}`);
      prev = r.px;
      ok(r.px >= L.floor * SIZE.hardLo - 1e-6, `size: under the hard floor ${JSON.stringify(ctx)} @${z}: ${r.px}`);
      ok(r.px <= L.ceil * SIZE.hardHi + 1e-6, `size: over the hard ceiling ${JSON.stringify(ctx)} @${z}: ${r.px}`);
      ok(Math.abs(r.size * (ctx.sizeK ?? 1) * z - r.px) < 1e-6, `size: size and px disagree @${z}`);
      ok(r.px * (ctx.aspect ?? 3) <= base.vw * (SIZE.widthVw + SIZE.widthVwMag) * SIZE.hardHi + 1, `size: word wider than the viewport allows @${z}`);
    }
  }
  /* inside the legible range the word is simply its world size (zoom scales it like the map) */
  const mid = sizeFor({ ...base, zoom: 1 });
  ok(mid.clamp === null && Math.abs(mid.size - mid.natural) < 1e-9, "size: in range the world size is untouched");
  /* far zoomed out a word is held at the floor (still slightly smaller than at the floor's own zoom: depth cue) */
  const far = sizeFor({ ...base, zoom: 0.1 }), floorZ = sizeLimits(base).floor / (mid.natural);
  ok(far.clamp === "floor" && far.px < sizeLimits(base).floor && far.px >= sizeLimits(base).floor * SIZE.hardLo, "size: zoomed out a word stays legible");
  ok(sizeFor({ ...base, zoom: floorZ }).px > far.px, "size: the floor still lets zoom show a little");
  /* growth: bigger token, bigger area, bigger magnitude -> bigger natural size; sub-linear */
  const n1 = naturalSize({ ...base, tokenSpan: 100 }), n4 = naturalSize({ ...base, tokenSpan: 400 });
  ok(n4 > n1 * 1.5 && n4 < n1 * 3, `size: a 4x4 token gets a bigger, not 4x bigger word (${(n4 / n1).toFixed(2)})`);
  const a1 = naturalSize({ ...base, area: 100 }), a10 = naturalSize({ ...base, area: 1000 });
  ok(a10 > a1 * 2.5 && a10 < a1 * 10, `size: a 10x footprint grows the word sub-linearly (${(a10 / a1).toFixed(2)})`);
  ok(naturalSize({ ...base, magnitude: 1 }) > naturalSize({ ...base, magnitude: 0.5 }) && naturalSize({ ...base, magnitude: 0.5 }) > naturalSize({ ...base, magnitude: 0 }), "size: magnitude grows the word");
  ok(magnitudeOf("huge") === 1 && magnitudeOf("tiny") === 0 && magnitudeOf(9) === 2 && magnitudeOf(undefined) === 0.5, "size: magnitude words and clamping");
  ok(naturalSize({ ...base, size: 77 }) === 77 && naturalSize({ ...base, size: 77, scale: 2 }) === 154, "size: explicit size and scale");
  /* a destruction seen from far reads bigger on screen than a tick seen from far; from close it is capped by the viewport */
  ok(sizeFor({ ...base, zoom: 0.2, area: 1000, magnitude: 1 }).px > sizeFor({ ...base, zoom: 0.2, sizeK: 0.7 }).px * 1.5, "size: from far a collapse outranks a tick");
  ok(sizeFor({ ...base, zoom: 3, area: 1000, magnitude: 1 }).clamp !== null, "size: from close a collapse is capped by the viewport");
  /* fits */
  ok(Math.abs(sizeFor({ ...base, zoom: 0.1, fit: "world" }).px - mid.natural * 0.1) < 1e-9, "size: fit world never clamps");
  ok(Math.abs(sizeFor({ ...base, zoom: 0.1, size: 40, fit: "screen" }).px - 40) < 1e-9 && Math.abs(sizeFor({ ...base, zoom: 3, size: 40, fit: "screen" }).px - 40) < 1e-9, "size: fit screen = constant CSS px");
  /* screen space follows the viewport */
  const s1 = sizeFor({ space: "screen", vw: 1100, vh: 768, sizeK: 1, aspect: 3 }), s2 = sizeFor({ space: "screen", vw: 1700, vh: 1080, sizeK: 1, aspect: 3 });
  ok(s2.px > s1.px * 1.3 && s2.px < s1.px * 1.5, `size: a bigger screen gets proportionally bigger screen words (${(s2.px / s1.px).toFixed(2)})`);
  ok(sizeFor({ space: "screen", vw: 1100, vh: 768, sizeK: 1, aspect: 3, size: 900 }).clamp === "ceil" || sizeFor({ space: "screen", vw: 1100, vh: 768, sizeK: 1, aspect: 3, size: 900 }).clamp === "width", "size: a too big screen size is capped");
  ok(sizeFor({ space: "screen", vw: 1100, vh: 768, sizeK: 1, aspect: 12 }).clamp === "width", "size: a long word is capped by the width");
  /* pixel lettering: whole art pixels, at least 7 */
  for ( const z of zooms ) {
    const r = sizeFor({ ...base, zoom: z, pixel: 100 / 32 });
    const art = r.size * 1 / (100 / 32);
    ok(Math.abs(art - Math.round(art)) < 1e-6 && art >= SIZE.pixelMinArt && art <= SIZE.pixelMaxArt, `size: pixel word not in whole art px @${z}: ${art}`);
  }
  /* crowding lowers the floor (many words at once from far do not bury the scene) */
  ok(sizeLimits({ ...base, alive: 48 }).floor < sizeLimits({ ...base, alive: 3 }).floor && sizeLimits({ ...base, alive: 480 }).floor >= sizeLimits(base).floor * SIZE.crowdMin - 1e-9, "size: crowding lowers the floor, bounded");
  ok(sizeLimits({ ...base, alive: 12, magnitude: 1 }).ceil < sizeLimits({ ...base, alive: 1, magnitude: 1 }).ceil * 0.6 && sizeLimits({ ...base, alive: 500, magnitude: 1 }).ceil >= Math.max(sizeLimits({ ...base, alive: 500 }).floor * 1.25, sizeLimits({ ...base, alive: 1, magnitude: 1 }).ceil * SIZE.crowdCeilMin) - 1e-9, "size: a crowd of world words shares the screen (lower ceiling, bounded)");
  ok(sizeFor({ ...base, zoom: 2, ceilK: 0.55, magnitude: 1 }).px < sizeFor({ ...base, zoom: 2, magnitude: 1 }).px * 0.7, "size: a stream syllable gets a share of the ceiling");
  /* the engine never shows a picture enlarged by more than 15 % before drawing it again (source rule in engine.mjs) */
  const eng = fs.readFileSync(new URL("./engine.mjs", import.meta.url), "utf8");
  ok(/w > c\.want \* 1\.15/.test(eng) && /resize\(h, false\)/.test(eng), "size: re-draw on drift up (>15 %) and live resize are in the frame loop");
  ok(/redraws < MAX_REDRAWS/.test(eng) && /h\.retired/.test(eng) && !/if \( h\.shown === c \) h\.shown = null; dropPic\(c\)/.test(eng), "size: stale pictures are redrawn a few per frame and the shown texture is never freed under the sprite (F0/F1)");
}

/* 9. the copy manifest (the two modules' copies are equal to it) */
{
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("./sync.mjs", import.meta.url)), "--check"], { encoding: "utf8" });
  ok(r.status === 0, `manifest: ${r.stdout.trim()}`);
}

/* 10. FXLE: lifecycle, budgets, memory, safety (check-life.mjs on a fake browser and Foundry; its own process: it replaces globals) */
{
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("./check-life.mjs", import.meta.url))], { encoding: "utf8", timeout: 600000 });
  for ( const f of (r.stdout ?? "").split("\n").filter((l) => l.startsWith("FAIL")) ) console.log(f);
  ok(r.status === 0, `life: ${(r.stdout ?? "").trim().split("\n").at(-1)} ${r.stderr ? r.stderr.slice(0, 300) : ""}`);
}

console.log(`letters: ${n} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
