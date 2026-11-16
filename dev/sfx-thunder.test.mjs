// MAPTHUNDER: the storm under the fight, and the map events that got no word or a word of the wrong weight (ADVM r2 items 1 and 9).
// PREV = the trunk before (917cbce). Each group names what it holds; the PREV checks show the defect the group fixes.
//   RHYTHM   a storm at full rate and closeness letters at most one close strike in THUNDER_GAP s (before: a full-size word for most of
//            every 30 s, often two at once - ADVM r2 item 1, take G); the same answer whichever slot a seat asks from (window-aligned)
//   RANK     an opening strike's word is under a shell's and a bomb's main word; the strikes rolling on under it smaller still
//   MID      a mid flash's edge rumble never lands within MID_CLEAR s of a lettered close strike (no stack)
//   YIELD    a storm word whose moment is a fight's main word's (THUNDER_YIELD) is not lettered; one up leaves before the fight lands
//   ONSET    the GM's switch-on gets an entrance rumble when the storm letters nothing of its own at once (take E: 7 s of nothing)
//   STEAM    rain ramping up over a burning fire letters a hiss at the steam onset (take D 28 s: nothing); not when it already steamed
//   OUT      a fire going out is the fire's own last stage (TSSS…), in ash, at rank 1 - not the blue power-fail FIZZLE as big as the catch
//   HINT     a bomb off a seat's whole view: its main word at that seat's view edge ("away", at most OFF_K) - before "off": no hint (take K)
//   WIRED    sfx.mjs uses all of it (the rhythm, the yield, the entrance, the hiss, the stop of storm words before a fight)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { revTree } from "./lib/baseline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const EV = await imp("scripts/sfx/sfx-events.mjs"), C = await imp("scripts/sfx/sfx-core.mjs"), SM = await imp("scripts/weather/storm-model.mjs");
const PG = await imp("scripts/sfx/sfx-page.mjs"), T = await imp("scripts/sfx/sfx-table.mjs"), SEAT = await imp("scripts/sfx/sfx-seat.mjs");
const PREV = revTree(root, "917cbce", "scripts/sfx", fs.mkdtempSync(path.join(os.tmpdir(), "mapthunder-prev-")));
const pimp = (f) => import(pathToFileURL(path.join(PREV, f)).href);
const PE = await pimp("sfx-events.mjs"), PC0 = await pimp("sfx-core.mjs"), PT = await pimp("sfx-table.mjs"), PS = await pimp("sfx-seat.mjs");
const { createVocab } = await imp("scripts/letters/words.mjs");
const V = createVocab(), KINDS = new Set(V.list("en").map((k) => k.id));

let n = 0; const failed = [];
const ok = (c, m) => { if ( c ) n++; else failed.push(m); };
const src = (f) => fs.readFileSync(path.join(root, "scripts", f), "utf8");

/* ---------------------------------------------------------------- RHYTHM / RANK / MID on the real storm model */
const RAIN = () => 1;
const stormOf = (seed, patch = {}) => ({ S: SM.withChange(null, { on: true, rate: 99, power: 99, near: 99, ...patch }, 1_000_000), seed, rainP: RAIN });
const closeOf = (st) => { const m = new Map(); return (j) => { if ( !m.has(j) ) m.set(j, SM.flashOf(st.S, st.seed, j, st.rainP)?.kind === "close"); return m.get(j); }; };
{
  let worstPrev = 0, worstNow = 0, gapBad = [], two = 0, twoPrev = 0, opens = 0, total = 0, coverNow = 0, coverPrev = 0;
  const view = { x0: 0, y0: 0, x1: 3000, y1: 2000 };
  for ( let seed = 1; seed <= 40; seed++ ) {
    const st = stormOf(seed * 7919), isClose = closeOf(st);
    const k0 = 1000 + seed * 3;                                       // (30 s of storm, slots k0 .. k0+29)
    const now = [], prev = [];
    for ( let k = k0; k < k0 + 30; k++ ) {
      const ev = SM.flashOf(st.S, st.seed, k, st.rainP);
      if ( ev?.kind !== "close" ) continue;
      prev.push(ev.t);                                                // (before: every close strike lettered)
      const r = EV.thunderRhythm(k, isClose);
      if ( r.lettered ) { now.push({ k, t: ev.t, r }); total++; if ( r.opens ) opens++; }
    }
    for ( let i = 1; i < now.length; i++ ) if ( now[i].k - now[i - 1].k < EV.THUNDER_GAP ) gapBad.push(`${seed}:${now[i - 1].k}-${now[i].k}`);
    // (two words up at once: a word lives ~1.1 s + its hold; counted as overlapping when within 2.2 s)
    const overl = (ts) => ts.reduce((a, t, i) => a + (i && t - ts[i - 1] < 2200 ? 1 : 0), 0);
    two += overl(now.map((q) => q.t)); twoPrev += overl(prev);
    worstNow = Math.max(worstNow, now.length); worstPrev = Math.max(worstPrev, prev.length);
    coverNow += now.length * 2.2; coverPrev += prev.length * 2.2;
  }
  ok(worstPrev >= 10 && twoPrev > 20, `PREV RHYTHM: before, a 30 s storm at full rate lettered up to ${worstPrev} close strikes, ${twoPrev} of them on another's heels`);
  ok(gapBad.length === 0, `RHYTHM: no two lettered close strikes within THUNDER_GAP slots (${gapBad.slice(0, 5).join(", ")})`);
  ok(worstNow <= Math.ceil(30 / EV.THUNDER_GAP) + 1 && two === 0, `RHYTHM: at most ${Math.ceil(30 / EV.THUNDER_GAP) + 1} lettered strikes in 30 s (worst ${worstNow}), never two up at once (${two})`);
  ok(coverNow / 40 <= 30 * 0.25 && coverPrev >= 2 * coverNow, `RHYTHM: a close-strike word up at most a quarter of the time, under half of before (now ${(coverNow / 40 / 30 * 100).toFixed(0)} %, before ${(coverPrev / 40 / 30 * 100).toFixed(0)} %)`);
  ok(opens >= 1 && opens < total, `RHYTHM: some strikes open a spell (${opens} of ${total}), the rest roll on under it`);
  // (the same answer from every slot a seat may ask from: windows aligned to the shared slots, two back)
  let incons = 0;
  for ( let seed = 1; seed <= 20; seed++ ) {
    const st = stormOf(seed * 104729), isClose = closeOf(st);
    for ( let k = 2000; k < 2300; k++ ) if ( isClose(k) ) { const a = EV.thunderRhythm(k, isClose), b = EV.thunderRhythm(k, isClose); if ( a.lettered !== b.lettered || a.opens !== b.opens ) incons++; }
  }
  ok(incons === 0, "RHYTHM: deterministic");
  // (a quiet storm - one close strike now and then - letters each of them and each opens)
  const sparse = (j) => j % 25 === 0;
  ok([0, 25, 50, 75].every((k) => EV.thunderRhythm(k, sparse).lettered && EV.thunderRhythm(k, sparse).opens), "RHYTHM: a strike after 20 s of quiet is lettered and opens");
  // (MID)
  let midBad = 0, midCases = 0;
  for ( let seed = 1; seed <= 30; seed++ ) {
    const st = stormOf(seed * 15485863, { near: 0.5 }), isClose = closeOf(st);
    for ( let k = 3000; k < 3200; k++ ) {
      const ev = SM.flashOf(st.S, st.seed, k, st.rainP);
      if ( ev?.kind !== "mid" || !EV.midLettered(k, isClose) ) continue;
      midCases++;
      for ( let j = k - EV.MID_CLEAR; j <= k + EV.MID_CLEAR; j++ ) if ( isClose(j) && EV.thunderRhythm(j, isClose).lettered ) midBad++;
    }
  }
  ok(midCases > 20 && midBad === 0, `MID: ${midCases} mid rumbles lettered, none within MID_CLEAR of a lettered strike (${midBad})`);
  // (RANK: under the fight's big words)
  const C0 = { ...SM.DEFAULT, on: true, power: 1 }, close = { ...SM.makeFlash(C0, 7, 102, 102_000, "close"), lv: 3 };
  const wO = EV.flashWord(close, { x: 900, y: 400 }, view, "s", { lettered: true, opens: true }), wR = EV.flashWord(close, { x: 900, y: 400 }, view, "s", { lettered: true, opens: false });
  const wP = PE.flashWord(close, { x: 900, y: 400 }, view, "s");
  const sz = (w) => EV.rankSize(w.rank, 900, w.shrink ?? 1);
  ok(wP.rank === 5, `PREV RANK: before, a level-3 close strike was rank ${wP.rank} - a bomb's size`);
  ok(sz(wO) < EV.rankSize(4, 900) && sz(wO) < EV.rankSize(5, 900) && sz(wR) < sz(wO) && wR.rank === 3, `RANK: opening strike ${sz(wO).toFixed(1)} px < a shell's ${EV.rankSize(4, 900).toFixed(1)} < a bomb's ${EV.rankSize(5, 900).toFixed(1)}; rolling ${sz(wR).toFixed(1)}`);
  ok(wO.wo.prefix && !wR.wo.prefix && wO.wo.loud > wR.wo.loud && wO.heard && wR.heard, "RANK: the opening strike has its lead-in and is louder; both heard all over the scene");
  for ( const lang of ["en", "pl"] ) for ( let s = 0; s < 16; s++ ) for ( const w of [wO, wR] ) {
    const t = V.word(w.kind, { ...w.wo, seed: `t${s}`, lang }).text;
    ok(!/BOOM|BUUM/.test(t), `thunder never BOOM (owner): ${t}`);
  }
}

/* ---------------------------------------------------------------- YIELD */
{
  const f = [100_000];
  ok(EV.thunderYields(100_000 - 1400, f) && EV.thunderYields(100_000 + 1400, f) && !EV.thunderYields(100_000 - 2500, f) && !EV.thunderYields(100_000 + 1600, f),
    "YIELD: a storm word in [fight - 2.4 s, fight + 1.5 s] yields; outside it stands");
  ok(!EV.thunderYields(100_000, []), "YIELD: no fight, no yield");
  ok(EV.THUNDER_CLEAR > 0 && EV.THUNDER_CLEAR < 1000, "YIELD: a storm word up leaves a moment before the fight's word lands");
}

/* ---------------------------------------------------------------- ONSET */
{
  const S = SM.withChange({ ...SM.DEFAULT, on: false, t: 0 }, { on: true, rate: 30, near: 0.6 }, 5_000_000);
  const o = EV.stormOnset(S, () => false, () => 1);
  ok(o && o.t === S.t + EV.ONSET_LAG && o.ev.kind === "mid" && o.ev.onset, "ONSET: a switch-on with nothing lettered at once rolls in ONSET_LAG after it");
  ok(EV.stormOnset(S, () => true, () => 1) === null, "ONSET: the storm's own word at once - no entrance word");
  ok(EV.stormOnset(S, () => false, () => 0.1) === null, "ONSET: no rain, no flashes - no entrance");
  ok(EV.stormOnset(SM.withChange(S, { rate: 60 }, 6_000_000), () => false, () => 1) === null, "ONSET: a change while it already storms is no entrance");
  ok(JSON.stringify(EV.stormOnset(S, () => false, () => 1)) === JSON.stringify(o), "ONSET: the same on every seat");
  const w = EV.flashWord(o.ev, { x: -500, y: 300 }, { x0: 0, y0: 0, x1: 2000, y1: 1000 }, "s");
  ok(w && w.screen && w.screen.fx < 0.2 && w.rank === 3 && w.t === o.t && w.kind === "thunder", `ONSET: rumble at the screen edge on its side, rank 3 (${JSON.stringify(w?.screen)}, r${w?.rank})`);
  // (take E: rate 99 at closeness 99 - the first lettered word of the storm comes within ONSET_WAIT of the switch-on, its own or the entrance)
  let late = 0;
  for ( let seed = 1; seed <= 30; seed++ ) {
    const st = { S: SM.withChange(null, { on: true, rate: 99, power: 99, near: 99 }, 7_000_000 + seed * 1000), seed: seed * 31, rainP: RAIN }, isClose = closeOf(st);
    const lettered = (t0, t1) => { for ( let k = Math.floor(t0 / SM.SLOT) - 1; k <= Math.floor(t1 / SM.SLOT); k++ ) { const ev = SM.flashOf(st.S, st.seed, k, st.rainP); if ( ev && ev.t >= t0 && ev.t <= t1 && (ev.kind === "close" ? EV.thunderRhythm(k, isClose).lettered : ev.kind === "mid" ? EV.midLettered(k, isClose) : false) ) return true; } return false; };
    if ( !lettered(st.S.t, st.S.t + EV.ONSET_WAIT) && !EV.stormOnset(st.S, lettered, RAIN) ) late++;
  }
  ok(late === 0, `ONSET: every switch-on letters something within ${EV.ONSET_WAIT} ms (${late} did not)`);
}

/* ---------------------------------------------------------------- STEAM */
{
  // (a rain key at 10 s ramping over 1.5 s: steam rises with it)
  const keys = [{ t: 10_000, dur: 1500 }];
  const ramp = (t) => (t < 10_000 ? 0 : Math.min(1, (t - 10_000) / 1500) * 0.6);
  const s = EV.steamOnsets(keys, ramp);
  ok(s.length === 1 && s[0].t >= 10_000 && ramp(s[0].t) >= EV.STEAM_ON && ramp(s[0].t - EV.STEAM_STEP) < EV.STEAM_ON, `STEAM: the hiss at the steam onset (${s[0]?.t})`);
  ok(EV.steamOnsets(keys, () => 0.6).length === 0, "STEAM: already steaming before the change - no new hiss");
  ok(EV.steamOnsets(keys, () => 0.05).length === 0, "STEAM: a drizzle that never steams - no hiss");
  const pl = { key: "f1", r: 60, points: [{ x: 700, y: 900 }] }, w = EV.steamWord(pl, s[0].t, 0.6, "s");
  // (MAPBURN3, restated: rank 2 before - the owner's ruling makes every fire word small; the hiss is rank 1 a notch down, with the other hisses)
  ok(w.kind === "hiss" && w.rank === 1 && w.shrink === EV.STEAM_SHRINK && w.x === 700 && w.y === 900 && w.t === s[0].t && w.drift && KINDS.has(w.kind), "STEAM: a rising hiss at the fire, a fire word's size (rank 1, a notch down)");
}

/* ---------------------------------------------------------------- OUT */
{
  const st = { id: "f1", k: "fire", p: [100, 100, 300, 120], r: 50, lv: 3, q: 1000, g: 1000, o: 9000 }, prevSt = { ...st, o: undefined };
  const evs = (CC) => CC.strokeEvents?.(st, prevSt, 0, 20000, { grid: 100 }) ?? [];
  const out = evs(C).find((e) => e.voice === "out"), pout = evs(PC0).find((e) => e.voice === "out");
  ok(!!out, "OUT: a fire put out letters its going out");
  ok(PC0.kindOf("out", KINDS) === "fizzle", "PREV OUT: before, a fire going out was the engine's FIZZLE (a power failing)");
  ok(C.kindOf("out", KINDS) === "fire" && C.wordOpts({ kind: "fire", voice: "out" }).stage === "out", "OUT: now the fire's own last stage");
  for ( const lang of ["en", "pl"] ) for ( let i = 0; i < 12; i++ ) {
    const t = V.word("fire", { stage: "out", loud: 0.3, seed: `o${i}`, lang }).text;
    ok(/^[TFP]S+/.test(t) && !/Z/.test(t), `OUT: ${lang} ${t} is a dying hiss, not a fizz`);
  }
  ok(JSON.stringify(out?.colors) === JSON.stringify([...C.OUT_ASH]) && out?.rank === C.OUT_RANK && C.OUT_RANK === 1, `OUT: natural fire goes out in ash at rank 1 (${JSON.stringify(out?.colors)}, r${out?.rank})`);
  ok(!pout || (pout.rank === undefined && !pout.colors), "PREV OUT: before, no rank and the engine's own colours (the fizzle's blue)");
  const blue = { ...st, c: "#2a6cff" }, bout = (C.strokeEvents(blue, { ...blue, o: undefined }, 0, 20000, { grid: 100 }) ?? []).find((e) => e.voice === "out");
  ok(bout && bout.colors?.[1] === "#2a6cff", "OUT: a fire in its own colour goes out in its colour");
  for ( const [a, b, c] of [C.OUT_ASH] ) ok(![a, b, c].some((h) => { const v = parseInt(h.slice(1), 16), r = v >> 16, g = (v >> 8) & 255, bl = v & 255; return r > 200 && bl > 150 && g < 150; }), "OUT: ash, never pink");
  const g = { main: out, members: [out], span: 100, rEq: 50, box: out.box, x: out.x, y: out.y, t: out.t };
  const mw = C.planCluster(g, { grid: 100, sec: 2, seed: "s", known: KINDS }).find((w) => w.role === "main");
  ok(mw?.rank === 1 && mw.kind === "fire", `OUT: its word is sized by its rank (r${mw?.rank} ${mw?.kind})`);
  const tb = T.baseOpts({ ...mw, word: null }, { grid: 100, layer: {} });
  ok(Number.isFinite(tb.size) && tb.size <= EV.rankSize(2, SEAT.REF_VH), `OUT: the table sizes it at rank 1 (${tb.size?.toFixed?.(1)})`);
}

/* ---------------------------------------------------------------- HINT (take K: a bomb nobody watches) */
{
  const { setup } = await imp("scripts/letters/testenv.mjs"), { sizeFor } = await imp("scripts/letters/size.mjs");
  const PCo = await imp("scripts/presets/core.mjs"), { BUILTIN } = await imp("scripts/presets/defs.mjs"), FM = await imp("scripts/fire/model.mjs");
  const MC = await imp("scripts/presets/meteor-core.mjs"), { fallAt } = await imp("scripts/presets/landing-fx.mjs");
  const E = await setup({ gm: true }), L = E.engine; L.lookStyle("invincible");
  const WG = 350, BOMB = { x: 900, y: 5300 };
  const ENV = { grid: WG, rect: { x: 0, y: 0, width: 7000, height: 7000 }, now: 1_800_000_000_000, wind: { dir: 0, speed: 0.4 } };
  const def = BUILTIN.find((q) => q.id === "bomb"), plan = PCo.expand(def, { a: [BOMB.x, BOMB.y] }, { seed: 777, aftermath: 6 }, ENV), strokes = new Map(), f = [];
  for ( const r of plan.fire ) { const st = { id: `f-${r.key}`, ...r }; strokes.set(st.id, st); f.push({ id: st.id, key: r.key }); }
  for ( const b of plan.pending.burst ?? [] ) { const st = { id: `f-burst.${b.id}`, k: "burst", p: [b.x, b.y], r: b.r, lv: b.lv, q: Math.round(plan.t0 + (b.at ?? 0)), wd: 0, ws: 0.4 }; strokes.set(st.id, st); f.push({ id: st.id, key: `burst.${b.id}` }); }
  const rec = { id: "fid-k", preset: "bomb", t0: plan.t0, seed: plan.seed, size: plan.size, power: plan.power, at: plan.at, dir: plan.dir, gesture: plan.gesture, walk: plan.walk,
    d: plan.destruction.map((r, i) => ({ id: `d${i}`, key: r.key, at: Math.round(plan.t0 + (r.at ?? 0)) })), f, pending: { ...plan.pending, burst: [] } };
  const pg = PG.firingPage(rec, { grid: WG, strokes, wayOf: MC.wayOf, headAt: MC.headAt, fallAt, lift: 0.5 });
  const d = () => ({ L, sizeFor, grid: WG, sceneId: "s", lang: "en", known: null, ledger: SEAT.makeLedger(), toPerf: (t) => t, toShared: (t) => t, layer: { layer: "overlay" },
    step: () => 2, memo: new Map(), tokens: () => [], pins: () => [], warn: () => {} });
  // (both seats of take K look at the standing fire far away: W x H at zoom 0.55, the bomb ~3500 px off their view)
  const S = { W: 1600, H: 900, z: 0.55, cam: { x: 2700, y: 1500 } };
  globalThis.innerWidth = S.W; globalThis.innerHeight = S.H; canvas.stage.scale.x = canvas.stage.scale.y = S.z; canvas.grid.size = WG; L.prefs = { ...(L.prefs ?? {}), scale: 1 };
  const view = { x0: S.cam.x - S.W / 2 / S.z, y0: S.cam.y - S.H / 2 / S.z, x1: S.cam.x + S.W / 2 / S.z, y1: S.cam.y + S.H / 2 / S.z };
  const run = (TT, SS) => {
    const ws = [...TT.planPage({ rec, pg, ground: "stone" }, d()).values()].filter((q) => q && !q.dropped && !q.screenAt && !q.stream && Number.isFinite(q.x));
    const items = TT.seatItems(ws, d(), { vw: S.W, vh: S.H, zoom: S.z, scale: 1 }), lay = SS.seatLayout(items, { view, panels: [], pins: [], tokens: [], zoom: S.z });
    return ws.map((w) => ({ w, f: lay.get(items.find((it) => it.key === w.key)?.key) })).filter((q) => q.f);
  };
  const now = run(T, SEAT), prev = run(PT, PS);
  const mN = now.find((q) => q.w.role === "main"), mP = prev.find((q) => q.w.role === "main");
  ok(mP && mP.f.rules.includes("off"), `PREV HINT: before, the bomb's main word off both views was "off" - no hint (${mP?.f.rules})`);
  const inView = (b) => b.x1 > view.x0 && b.x0 < view.x1 && b.y1 > view.y0 && b.y0 < view.y1;
  ok(mN && mN.f.rules.includes("away") && !mN.f.rules.includes("off") && inView(mN.f.box), `HINT: its main word at the view's edge toward it, "away" (${mN?.w.text} ${mN?.f.rules})`);
  ok(mN && mN.f.k <= SEAT.OFF_K + 1e-6, `HINT: at most OFF_K of its size (${mN?.f.k})`);
  const restN = now.filter((q) => q.w.role !== "main");
  ok(restN.every((q) => q.f.rules.includes("off")), `HINT: the rest of its page stays where it happens (${restN.map((q) => q.w.text + ":" + q.f.rules).join(" ")})`);
  ok(src("sfx/sfx.mjs").includes("if ( !q.heard && !hereVisible(") && !/q\.hint/.test(src("sfx/sfx.mjs")), "HINT: a player under the fog still gets the hidden bomb's word on the screen generally (owner's answer 4), not at the place");
}

/* ---------------------------------------------------------------- WIRED */
{
  const s = src("sfx/sfx.mjs");
  ok(/EV\.thunderRhythm\(ev\.k/.test(s) && /EV\.midLettered\(ev\.k/.test(s) && /EV\.flashWord\(ev, place, view\(\), canvas\.scene\?\.id \?\? "", spell\)/.test(s), "WIRED: pollStorm letters by the rhythm and passes the spell");
  ok(/EV\.thunderYields\(w\.t, fights\.values\(\)\) \? "yield"/.test(s) && /seatSkip\(q, typeof still === "string" \? still : "gone"\)/.test(s), "WIRED: a storm word yields to a fight, logged \"yield\"");
  ok(/noteFight\(`pg\|/.test(s) && /noteFight\(`e\|/.test(s) && /noteFight\(`st\|/.test(s) && /noteFight\(`m\|/.test(s), "WIRED: pages, events, stories and guns are fights");
  ok(/for \( const h of \[\.\.\.stormUp\] \) \{ try \{ h\.stop\(\); \}/.test(s) && /keepStorm\(w, h\)/.test(s) && /keepStorm\(spec, h\)/.test(s), "WIRED: storm words up leave before a fight lands");
  ok(/stormEntrance\(storm, now, rect, G\)/.test(s) && /EV\.stormOnset\(S,/.test(s), "WIRED: the storm's entrance");
  ok(/Hooks\.on\("moinenMapsWeather", \(kind\) => onWeather\(kind\)\)/.test(s) && /EV\.steamOnsets\(/.test(s) && /EV\.steamWord\(/.test(s) && /P\.who === "gm" && !game\.user\?\.isGM/.test(s), "WIRED: the rain's hiss on a weather change (hidden weather: none for players)");
  ok(/fights\.clear\(\); stormUp\.clear\(\);/.test(s), "WIRED: a scene change forgets it all");
}

if ( failed.length ) { console.log(failed.join("\n")); console.log(`sfx-thunder: ${failed.length} failed, ${n} checks passed`); process.exit(1); }
console.log(`sfx-thunder: ${n} checks passed`);
process.exit(0);
