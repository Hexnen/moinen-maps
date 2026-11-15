// MAPSEATS3: every seat letters a map sound with the same words, at the same moment, in the same arrangement and the same proportions
// between its words, whatever its window, pan and zoom (ADVM r2 items 2, 3, 4, 10). On the real engine in node (scripts/letters/testenv.mjs):
// the take's bomb (a preset firing, The Warehouse, grid 350, seed 777) and a hand-painted brush blast with its debris (sfx-core entryEvent
// + brushFalls through planMoment), on seats with unequal windows, pans and zooms, steps 1-3. PREV = the trunk before (5687bcd).
//   PROP   on every seat and step, every word drawn at its own room (no "room" / "floor" / "tight" / "fit" / "small" / "side" / "noroom")
//          draws the same share of its table size as the page's main word (1 where the main word stands whole) - the proportions between
//          the words are the table's on every seat (before, each word shrank on its own: the main word 0.6 of its size beside a debris
//          word at 1.0 on one seat, both at 1.0 on the other)
//   AWAY   a word whose subject this seat's view does not hold, drawn anyway (pulled in at the edge): rule "away", at most OFF_K of its
//          size - never bigger than on a seat that looks at it (ADVM r2 item 4: the player who could not see the blast got the bigger word)
//   HEARD  a close thunder strike: the same word, instant and place for every seat's view (before, each seat chose by its view between a
//          small map word and a big screen word: ADVM r2 item 2); a seat whose view does not hold it draws it at its edge ("away"), not "off"
//   SOUND  a riding fall word's sound is its impact, not the sky start (sfx-table soundAt: ADVM r2 item 10)
//   JOIN   a hand-painted stroke: every seat that gets the flag in time starts its entry - and so its words - at the GM's own instant, on the
//          shared clock, whenever the flag reaches it (before, ~1 s after the GM: ADVM r2 item 3); a late arrival still sees it whole
//   COST   the seat layout of a page with the shares: mean per layout under the budget of dev/sfx-same.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { revTree } from "./lib/baseline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const PG = await imp("scripts/sfx/sfx-page.mjs"), C = await imp("scripts/sfx/sfx-core.mjs"), EV = await imp("scripts/sfx/sfx-events.mjs");
const T = await imp("scripts/sfx/sfx-table.mjs"), SEAT = await imp("scripts/sfx/sfx-seat.mjs");
const J = await imp("scripts/destruction/entry-join.mjs");
const PREV = revTree(root, "5687bcd", "scripts/sfx", fs.mkdtempSync(path.join(os.tmpdir(), "mapseats3-prev-")));
const PT = await import(pathToFileURL(path.join(PREV, "sfx-table.mjs")).href), PS = await import(pathToFileURL(path.join(PREV, "sfx-seat.mjs")).href);
const PE = await import(pathToFileURL(path.join(PREV, "sfx-events.mjs")).href);
const { setup } = await imp("scripts/letters/testenv.mjs");
const { sizeFor } = await imp("scripts/letters/size.mjs");
const PC = await imp("scripts/presets/core.mjs"), { BUILTIN } = await imp("scripts/presets/defs.mjs"), FM = await imp("scripts/fire/model.mjs");
const MC = await imp("scripts/presets/meteor-core.mjs"), { fallAt } = await imp("scripts/presets/landing-fx.mjs");
const E = await setup({ gm: true });
const L = E.engine; L.lookStyle("invincible");

let n = 0; const failed = [], V = !!process.env.SEATS3_VERBOSE;
const ok = (c, m) => { if ( c ) { n++; if ( V ) console.log("  ok", m); } else failed.push(m); };
const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const on = (a, b) => area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });

const WG = 350, BOMB = { x: 2555, y: 3885 }, PIN = { x0: 2111, y0: 3468, x1: 2439, y1: 3879 };
const panelsOf = (W, H) => [[0, 0, 40, H], [45, 0.27 * H, 140, 0.44 * H], [W - 190, 0, W - 30, 0.16 * H], [W - 30, 0, W, H], [0.13 * W, H - 48, 0.75 * W, H], [W - 330, H - 60, W - 30, H]];
// (unequal windows, pans and zooms: the take's two seats and a spread, each looking at the blast from another spot; some do not hold it)
const SEATS = [];
for ( const [W, H] of [[1366, 768], [1600, 900], [1920, 1080]] ) for ( const z of [0.35, 0.6, 1.0] ) for ( const [px, py] of [[0, -105], [-600, 300], [900, -500], [2600, 0]] )
  SEATS.push({ name: `${W}x${H}@${z}+${px},${py}`, W, H, z, cam: { x: BOMB.x + px, y: BOMB.y + py }, ui: panelsOf(W, H) });

function bombPage(seed = 777) {
  const ENV = { grid: WG, rect: { x: 0, y: 0, width: 7000, height: 7000 }, now: 1_800_000_000_000, wind: { dir: 0, speed: 0.4 } };
  const def = BUILTIN.find((q) => q.id === "bomb"), plan = PC.expand(def, { a: [BOMB.x, BOMB.y] }, { seed, aftermath: 6 }, ENV), strokes = new Map(), f = [];
  const b0 = plan.pending.burst?.[0];
  for ( const r of plan.fire ) {
    const rec = { ...r };
    if ( b0 && /^debris\./.test(rec.key ?? "") ) { const dd = Math.hypot(rec.p[0] - b0.x, rec.p[1] - b0.y), j = (FM.hash4(plan.seed, dd | 0, 3) - 0.5) * 160;
      const q = Math.round(plan.t0 + (b0.at ?? 0) + Math.min(1600, 280 + 520 * Math.sqrt(dd / WG) + j)), dq = q - rec.q; rec.q = q; if ( rec.o !== undefined ) rec.o += dq; }
    const st = { id: `f-${rec.key}`, ...rec }; strokes.set(st.id, st); f.push({ id: st.id, key: rec.key });
  }
  const debris = plan.fire.filter((r) => /^debris\./.test(r.key ?? ""));
  for ( const b of plan.pending.burst ?? [] ) { const q = Math.round(plan.t0 + (b.at ?? 0));
    const db = debris.filter((r) => r.q >= q).map((r) => [r.p[0] - b.x, r.p[1] - b.y, r.q - q]).flat();
    const st = { id: `f-burst.${b.id}`, k: "burst", p: [b.x, b.y], r: b.r, lv: b.lv, q, wd: 0, ws: 0.4, ...(db.length ? { db } : {}) }; strokes.set(st.id, st); f.push({ id: st.id, key: `burst.${b.id}` }); }
  const rec = { id: `fid-bomb-${seed}`, preset: "bomb", t0: plan.t0, seed: plan.seed, size: plan.size, power: plan.power, at: plan.at, dir: plan.dir, gesture: plan.gesture, walk: plan.walk,
    d: plan.destruction.map((r, i) => ({ id: `d${i}`, key: r.key, at: Math.round(plan.t0 + (r.at ?? 0)) })), f, pending: { ...plan.pending, burst: [] } };
  return { rec, pg: PG.firingPage(rec, { grid: WG, strokes, wayOf: MC.wayOf, headAt: MC.headAt, fallAt, lift: 0.5 }) };
}
const wdeps = (step) => ({ L, sizeFor, grid: WG, sceneId: "vL4Lqhd60r7UHjPT", lang: "en", known: null, ledger: SEAT.makeLedger(), toPerf: (t) => t, toShared: (t) => t, layer: { layer: "overlay" },
  step: () => step, memo: new Map(), tokens: () => [], pins: () => [PIN], warn: () => {} });
const enterSeat = (S) => { globalThis.innerWidth = S.W; globalThis.innerHeight = S.H; canvas.stage.scale.x = canvas.stage.scale.y = S.z; canvas.grid.size = WG; L.prefs = { ...(L.prefs ?? {}), scale: 1 }; };
const viewOf = (S) => ({ x0: S.cam.x - S.W / 2 / S.z, y0: S.cam.y - S.H / 2 / S.z, x1: S.cam.x + S.W / 2 / S.z, y1: S.cam.y + S.H / 2 / S.z });
const toScene = (S) => (r) => ({ x0: S.cam.x + (r[0] - S.W / 2) / S.z, y0: S.cam.y + (r[1] - S.H / 2) / S.z, x1: S.cam.x + (r[2] - S.W / 2) / S.z, y1: S.cam.y + (r[3] - S.H / 2) / S.z });
const wordsOf = (ws) => ws.filter((q) => q && !q.dropped && !q.screenAt && !q.stream && Number.isFinite(q.x) && Number.isFinite(q.y));

// the two pages, planned once per step (the table picture: no seat in it)
const pages = new Map();
const bombAt = (step, prev) => { const k = `b|${step}|${prev}`; if ( !pages.has(k) ) { const { rec, pg } = bombPage(); pages.set(k, wordsOf([...(prev ? PT : T).planPage({ rec, pg, ground: "stone" }, wdeps(step)).values()])); } return pages.get(k); };
// (a hand-painted blast with its debris: the GM's stroke - what onEntry makes of it - through the same moment planner every seat runs)
const BR = { type: "blast", cause: 0, mat: 2, rect: { x0: -2, y0: -2, x1: 2, y1: 2 } };
const brushAt = (step, prev) => {
  const k = `r|${step}|${prev}`;
  if ( !pages.has(k) ) {
    const ev = C.entryEvent(BR, BOMB, WG / 2, 1_800_000_000_000, { key: "d|brush|1", sid: "d|brush", objId: "dbrush" });
    const due = [ev, ...C.brushFalls(ev, WG, 1)], out = (prev ? PT : T).planMoment(due, wdeps(step));
    pages.set(k, wordsOf(out.flatMap((m) => m.placed ?? [])));
  }
  return pages.get(k);
};

/** one seat's drawing of a page at a step: per key { cap, share (cap / its table size of this step), rules, w, item, box, shown } */
function drawSeat(S, ws, step, prev = false, mod = null) {
  enterSeat(S);
  const TT = prev ? PT : T, SS = prev ? PS : SEAT, d = wdeps(step), view = viewOf(S), panels = S.ui.map(toScene(S));
  const items = TT.seatItems(ws, d, { vw: S.W, vh: S.H, zoom: S.z, scale: 1 });
  if ( mod ) for ( const it of items ) mod(it);
  const hr = () => Number(process.hrtime.bigint()) / 1e6, t0 = hr(), lay = SS.seatLayout(items, { view, panels, pins: [PIN], tokens: [], zoom: S.z }), ms = hr() - t0;
  const out = new Map();
  for ( const it of items ) {
    const f = lay.get(it.key); if ( !f ) continue;
    const nom = Array.isArray(it.nom) && it.nom.length === 3 ? it.nom[step - 1] : (it.sizes?.[0] ?? it.u);
    const shown = !f.rules.includes("off") && !f.rules.includes("noroom") && on(f.box, view) > 0;
    out.set(it.key, { cap: f.cap, share: f.cap / nom, rules: f.rules, w: it.w, item: it, box: f.box, shown, sub: it.sub });
  }
  return { out, view, ms };
}
const ROOMY = ["room", "floor", "tight", "fit", "small", "side", "noroom", "off", "edge"];
const free = (q) => q.shown && !q.rules.some((r) => ROOMY.includes(r));

// ---- PROP: the page's proportions on every seat
const propFaults = (page, prev) => {
  const bad = []; let cases = 0;
  for ( const S of SEATS ) for ( const step of [1, 2, 3] ) {
    const { out } = drawSeat(S, page(step, prev), step, prev);
    const main = [...out.values()].find((q) => q.w.role === "main");
    if ( !main || !main.shown ) continue;
    // (the share the main word draws on this seat: its own room's, or OFF_K when its view does not hold what it letters)
    const mk = main.share;
    for ( const q of out.values() ) {
      if ( q === main || !free(q) ) continue;
      cases++;
      // (a word this seat cannot see is at most OFF_K whatever the main word does: the smaller of the two)
      const want = Math.min(mk, q.rules.includes("away") ? SEAT.OFF_K : 1);
      if ( Math.abs(q.share - want) > 0.02 * want + 1e-6 ) bad.push(`${S.name} s${step} ${q.w.text} ${q.share.toFixed(2)} vs main ${main.w.text} ${mk.toFixed(2)} (${q.rules.join("+")})`);
    }
  }
  return { bad, cases };
};
for ( const [nm, page] of [["bomb (preset)", bombAt], ["brush blast", brushAt]] ) {
  const pNow = propFaults(page, false), pPrev = propFaults(page, true);
  ok(pPrev.bad.length > 0, `PREV ${nm}: a word drawn at another share of its size than the main word on some seat (${pPrev.bad.length} of ${pPrev.cases}: ${pPrev.bad.slice(0, 3).join("; ")})`);
  ok(pNow.cases >= 10 && pNow.bad.length === 0, `PROP ${nm}: every word at its own room draws the main word's share on every seat and step (${pNow.cases} word x seat x step; ${pNow.bad.length} not: ${pNow.bad.slice(0, 4).join("; ")})`);
}

// ---- the same words, instants and arrangement on every seat: one table picture, whatever the seat
for ( const [nm, page] of [["bomb (preset)", bombAt], ["brush blast", brushAt]] ) {
  const ws = page(2, false), sig = (q) => `${q.key}|${q.text}|${q.ts}|${Math.round(q.x)},${Math.round(q.y)}`;
  let same = 0, diff = [];
  const ref = new Map(ws.map((q) => [q.key, sig(q)]));
  for ( const S of SEATS ) { const { out } = drawSeat(S, ws, 2); for ( const [k, q] of out ) { if ( ref.get(k) === sig(q.w) ) same++; else diff.push(`${S.name} ${q.w.text}`); } }
  ok(ws.length >= 2 && !diff.length, `WORDS ${nm}: every seat letters the table's words at the table's instants and places (${ws.length} words, ${same} word x seat; ${diff.slice(0, 3).join("; ")})`);
}

// ---- AWAY: a word this seat does not see is drawn smaller than its size, never bigger than where it is seen
{
  let cases = 0; const bad = [];
  for ( const page of [bombAt, brushAt] ) for ( const S of SEATS ) for ( const step of [1, 2, 3] ) {
    const { out, view } = drawSeat(S, page(step, false), step);
    for ( const q of out.values() ) {
      if ( !q.shown || !q.sub ) continue;
      const seen = on(q.sub, view) > 0;
      if ( seen ) continue;
      cases++;
      // (bigger only where the legibility floor holds it up: "floor")
      if ( !q.rules.includes("away") || (q.share > SEAT.OFF_K + 1e-6 && !q.rules.includes("floor")) ) bad.push(`${S.name} s${step} ${q.w.text} ${q.share.toFixed(2)} ${q.rules.join("+")}`);
    }
  }
  ok(!bad.length, `AWAY: every word drawn on a seat whose view does not hold its subject says "away" and is at most ${SEAT.OFF_K} of its size (${cases} cases; ${bad.slice(0, 4).join("; ")})`);
}

// ---- HEARD: a close thunder strike, one word for every seat's view
{
  const close = { kind: "close", k: 3, t: 5000, lv: 3, strokes: [1, 2] }, place = { x: BOMB.x + 1100, y: BOMB.y - 550 };
  const views = SEATS.map(viewOf), core = (w) => JSON.stringify({ ...w, edge: undefined });
  const now = views.map((v) => EV.flashWord(close, place, v, "s")), prev = views.map((v) => PE.flashWord(close, place, v, "s"));
  const same = now.every((w) => core(w) === core(now[0])), prevSame = prev.every((w) => core(w) === core(prev[0]));
  ok(!prevSame && prev.some((w) => w.screen) && prev.some((w) => !w.screen), `PREV HEARD: the close strike's word depended on the seat's view (${prev.filter((w) => w.screen).length} seats a screen word, ${prev.filter((w) => !w.screen).length} a map word)`);
  ok(same && now[0].heard && !now[0].screen && now[0].x === place.x && now[0].y === place.y && now[0].role === "main",
    `HEARD: the close strike is one map word at the strike for all ${views.length} seat views (heard, main, at ${place.x},${place.y})`);
  // (a seat that does not hold the strike: drawn at its edge, "away", not "off"; a seat that holds it: at its own room)
  const ws = bombAt(2, false), main = ws.find((q) => q.role === "main");
  let away = 0, offs = [];
  for ( const S of SEATS ) {
    const { out, view } = drawSeat(S, [main], 2, false, (it) => { it.heard = true; });
    const q = out.get(main.key), seen = on(q.sub ?? q.item.box, view) > 0;
    if ( seen ) continue;
    if ( q.rules.includes("off") || !q.rules.includes("away") || (q.share > SEAT.OFF_K + 1e-6 && !q.rules.includes("floor")) ) offs.push(`${S.name} ${q.rules.join("+")} ${q.share.toFixed(2)}`); else away++;
  }
  ok(away >= 3 && !offs.length, `HEARD: a heard word a seat's view does not hold is drawn there at the edge, "away", at most ${SEAT.OFF_K} (${away} seats; ${offs.slice(0, 3).join("; ")})`);
}

// ---- SOUND: a riding word's sound
{
  const ride = [{ x: 100, y: -4000, ms: 0 }, { x: 900, y: 600, ms: 900 }];
  const a = T.soundAt({ role: "pre", ride, x: 50, y: -3000 }), b = T.soundAt({ role: "main", ride, x: 50, y: 50 }), c = T.soundAt({ role: "sec", x: 7, y: 8 }), d = T.soundAt({ at: { x: 1, y: 2 }, ride, x: 3, y: 4 });
  ok(a.sx === 900 && a.sy === 600 && b.sx === 100 && c.sx === 7 && c.sy === 8 && d.sx === 1 && d.sy === 2,
    `SOUND: a fall word's sound is its impact (${a.sx},${a.sy}), a word riding off its start there, a standing word its place, its own \`at\` first`);
  const e = T.soundAt({ role: "pre", ride, x: 50, y: -3000 }, { x: 905, y: 640 });
  ok(e.sx === 905 && e.sy === 640, `SOUND: a fall word whose own way ends in the sky (a meteor's far whine) sounds at the page's impact (${e.sx},${e.sy})`);
  const pre = bombAt(2, false).find((q) => q.role === "pre" && (q.ride?.length ?? 0) > 1);
  if ( pre ) ok(Math.hypot(pre.sx - BOMB.x, pre.sy - BOMB.y) < WG * 2, `SOUND: the bomb's fall word sounds at its impact (${Math.round(pre.sx)},${Math.round(pre.sy)} by the bomb ${BOMB.x},${BOMB.y})`);
}

// ---- JOIN: a hand-painted stroke enters at the GM's instant on every seat
{
  const s = 1_800_000_010_000, t = s + 320 + 700, W = 8000;   // (the GM's entry; baked and published 320 ms later; + 700 ms)
  // (seats whose clocks differ: each reads sNow / pNow together; the start in shared time = start - pNow + sNow)
  const seats = [[s + 450, 1000], [s + 1100, 52000], [t + 400, 777], [t + 1400, 5]];
  const sh = seats.map(([sNow, pNow]) => J.entryStart({ t, s }, sNow, pNow, W) - pNow + sNow);
  ok(sh.every((x) => Math.abs(x - s) < 1e-6), `JOIN: every seat that gets the flag in time starts the stroke's entry at the GM's instant (shared ${sh.map((x) => x - s).join(", ")} ms from it)`);
  const before = seats.map(([sNow, pNow]) => pNow + Math.max(0, -(sNow - t)) - pNow + sNow);
  ok(before.some((x) => x - s > 900), `PREV JOIN: the old rule started it at the publish moment or later (${before.map((x) => Math.round(x - s)).join(", ")} ms after the GM)`);
  const late = J.entryStart({ t, s }, t + J.JOIN_LATE_MS + 500, 100, W), old = J.entryStart({ t }, s + 450, 100, W), gone = J.entryStart({ t, s }, t + W + 1, 100, W);
  ok(late === 100 && old === 100 + (t - s - 450) && gone === null, `JOIN: a late seat still sees it whole from now (${late}), an entry without the GM's instant keeps its publish moment (${old}), an old one stays settled (${gone})`);
  // (the words are the entry's: sfx-core entryEvent keys their instant on the entry's start - the same start, the same word instant)
  const e1 = C.entryEvent(BR, BOMB, WG / 2, sh[0], { key: "a", sid: "a" }), e2 = C.entryEvent(BR, BOMB, WG / 2, sh[3], { key: "b", sid: "b" });
  ok(e1.t === e2.t, `JOIN: the stroke's word instant is the same on both seats (${e1.t - s} ms after the GM's start)`);
}

// ---- COST: one layout of the page with the shares
{
  // (every seat of the spread, step 3 - the largest envelopes -, the middle 8 of 12 runs; the trunk on the same seats and pages)
  const run = (prev) => { const all = []; for ( const S of SEATS ) { const ms = [], ws = bombAt(3, prev); for ( let i = 0; i < 12; i++ ) ms.push(drawSeat(S, ws, 3, prev).ms); ms.sort((a, b) => a - b); all.push(ms.slice(2, 10).reduce((a, b) => a + b, 0) / 8); } return all.reduce((a, b) => a + b, 0) / all.length; };
  const mNow = run(false), mPrev = run(true);
  ok(mNow < 8 && mNow <= mPrev * 1.25 + 0.3, `COST: the bomb page's seat layout, mean over ${SEATS.length} seats ${mNow.toFixed(2)} ms (the trunk ${mPrev.toFixed(2)} ms; budget 8, at most 1.25 x the trunk)`);
}

if ( failed.length ) { for ( const m of failed ) console.log("FAIL", m); console.log(`sfx-seats3: ${failed.length} failed, ${n} passed`); process.exit(1); }
console.log(`sfx-seats3: ${n} checks passed`);
