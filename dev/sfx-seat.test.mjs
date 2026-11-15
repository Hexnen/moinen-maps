// MAPSFXSEAT: every seat that sees a map moment shows the same words, at the same size and place on the map, at the same instant, and
// the same again on replay (scripts/sfx/sfx-table.mjs: the table picture; scripts/sfx/sfx-seat.mjs: the reference view and the seat
// rule). Two simulated seats with different windows, panels, zoom, own lettering size, words up and arrival delay run the SAME planning
// code the runtime runs (sfx.mjs only builds the deps from shared data and draws the plan) on the real engine in node
// (scripts/letters/testenv.mjs, read only).
//   STEP2     on a seat whose window, zoom and words up are the reference's, the table size IS the engine's own size (L.sizeOf) - step 2
//             unchanged there - and steps 1 / 3 its share (sfx-seat stepPx: x0.7 over the floor, x1.4); on another seat it differed
//   MOMENT    a destruction moment (a collapse, its debris, a blast): equal words, sizes, places, instants on both seats; a replay equal
//   PAGE      a preset firing's page (blast, wave, debris, fire catch, fire out): the same; its debris ground from the map, not a seat
//   LATE      a seat that gets the moment late gathers the same chunks and joins each word at the same point of its life (startAt)
//   RULE      the seat layout (MAPSFXSEAT2 seatLayout): a word with room stays where the table put it; a panel over it: it moves the
//             least; its side blocked: the first side of the shared order; never on a pin; off the view: not drawn; a rider keeps its way
//   SEAT2     MAPSFXSEAT2 on the live take's blast (The Warehouse, G 350; the GM 1600x900 at 0.6, a player 1366x768 at 0.73, their recorded
//             panels and the bomb's pin) and on a spread of windows and zooms, against the previous rule (base eab7e02: one group scale,
//             one shift, a pin step): step order as drawn, not smaller than before, same side of the thing, nothing on a pin / panel / word
//   GROUND    the ground classes from map pixels (the destruction bake's rule)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as C from "../scripts/sfx/sfx-core.mjs";
import * as PG from "../scripts/sfx/sfx-page.mjs";
import * as SZ from "../scripts/sfx/sfx-size.mjs";
import * as SEAT from "../scripts/sfx/sfx-seat.mjs";
import * as T from "../scripts/sfx/sfx-table.mjs";
import * as EV from "../scripts/sfx/sfx-events.mjs";
import os from "node:os";
import { revTree } from "./lib/baseline.mjs";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; if ( process.env.SEAT_VERBOSE ) console.log("  ok", m); };
const failed = [];
const group = async (id, fn) => { try { await fn(); } catch ( err ) { failed.push(`${id}: ${String(err?.message ?? err).split(/\r?\n/)[0]}`); } };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(root, "scripts/sfx/sfx.mjs"), "utf8");
const { setup } = await import(pathToFileURL(path.join(root, "scripts/letters/testenv.mjs")).href);
const { sizeFor } = await import(pathToFileURL(path.join(root, "scripts/letters/size.mjs")).href);
const E = await setup({ gm: true });
const L = E.engine; L.lookStyle("invincible");
const G = 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const area2 = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const on2 = (a, b) => area2({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
const inkBox = (b, k) => { const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, hw = (b.x1 - b.x0) * k[0] / 2, hh = (b.y1 - b.y0) * k[1] / 2; return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh }; };

/** a seat: its window, zoom, own lettering size, words it has up, its clock's offset from the shared clock; it builds the deps the way
    sfx.mjs tdeps() does - only from shared data (the seat's own values are set as the engine's globals, where they must NOT leak in) */
function seat({ W, H, zoom, scale = 1, off = 0, up = 0 }) {
  return {
    W, H, zoom, scale, off, up,
    enter() {
      globalThis.innerWidth = W; globalThis.innerHeight = H; canvas.stage.scale.x = canvas.stage.scale.y = zoom; canvas.grid.size = G;
      L.prefs = { ...(L.prefs ?? {}), scale };
      for ( let i = 0; i < up; i++ ) L.play("KRAK", { space: "world", at: { x: 500 + i * 50, y: 500 }, size: 40, fit: "world" });
    },
    deps(ledger) {
      return { L, sizeFor, grid: G, sceneId: "scene1", lang: "en", known: null, ledger, toPerf: (t) => t + off, toShared: (t) => t - off, layer: { layer: "overlay" },
        step: () => 2, memo: new Map(), tokens: () => [{ x0: 1900, y0: 1300, x1: 2000, y1: 1400 }], pins: () => [{ x0: 2200, y0: 1380, x1: 2260, y1: 1500 }], warn: () => {} };
    }
  };
}
const A = seat({ W: 1920, H: 1080, zoom: 0.62, scale: 1, off: 0, up: 0 });
const B = seat({ W: 1366, H: 768, zoom: 1.35, scale: 1.3, off: 53210.5, up: 5 });
const sig = (w) => [w.key, w.text, r3(w.size), r3(w.x), r3(w.y), r3(w.ts), w.box && [r3(w.box.x0), r3(w.box.y0), r3(w.box.x1), r3(w.box.y1)], r3(w.rk ?? 0), (w.path ?? []).map((q) => [r3(q.x), r3(q.y), q.ms])];

/* ---------------------------------------------------------------- STEP2 */
await group("STEP2", async () => {
  const words = [["boom", { loud: 1, prefix: true }, 5], ["debris", { pieces: "large", material: "stone", loud: 0.5 }, 2], ["thud", { loud: 0.9 }, null], ["crack", { loud: 0.3 }, null], ["shockwave", { loud: 0.7 }, 3]];
  let same = 0, cases = 0, differ = 0;
  for ( const [kind, wo, rank] of words ) for ( const seed of ["a", "b"] ) for ( const zr of [0, 260, 900] ) {
    const z = SEAT.refZoom(G, zr);
    const word = L.word(kind, { ...wo, seed, lang: "en" });
    const w = { role: "main", text: word.text, word, x: 2000, y: 1500, magnitude: 0.9, area: 150, seed, rank: rank ?? undefined, shrink: 1, stage: { in: "slam" }, ms: 800, zr, voice: kind, alive: 0 };
    const d = A.deps(SEAT.makeLedger());
    // (the seat equal to the reference: 1600 x 900, the reference zoom, no words up)
    globalThis.innerWidth = SEAT.REF_VW; globalThis.innerHeight = SEAT.REF_VH; canvas.stage.scale.x = z; canvas.grid.size = G;
    const o = T.baseOpts(w, d);
    for ( const step of [1, 2, 3] ) {
      cases++;
      const tab = T.tableSized(w, o, step, { ...d, step: () => step });
      // (before MAPSFXSEAT: sfx.mjs steppedWorld - the engine's size on THIS seat, stepped)
      const z0 = L.sizeOf(word.text, o), sk = z0.sizeK ?? 1;
      // (MAPSFXSEAT2: step 3 = STEP_K[3] x the engine's size, no loud ceiling - the seat layout holds it to a seat's view; step 1 its share
      // over the legibility floor; before, sfx-size steppedPx held step 3 under the loudest ceiling, where a big blast's word stood already)
      let px = z0.px;
      if ( step === 3 ) px = z0.px * SZ.STEP_K[3];
      if ( step === 1 ) px = SZ.smallPx(z0.px, 1, SZ.floorPx(innerHeight, sk, L.sizeModel));
      const old = step === 2 ? z0.size : px / (sk * z);
      if ( Math.abs(tab.size - old) <= 1e-6 * old ) same++; else console.log("STEP2 differs", kind, seed, zr, step, tab.size, old);
    }
    // (another seat - a laptop window, closer zoom - drew it at another size before: the cause of defect 1)
    globalThis.innerWidth = 1366; globalThis.innerHeight = 768; canvas.stage.scale.x = 1.35;
    if ( Math.abs(L.sizeOf(word.text, o).size - T.tableSized(w, o, 2, d).size) > 0.01 ) differ++;
  }
  ok(same === cases, `on a reference seat the table size is the engine's own (step 2) and its share at steps 1, 3: ${same} of ${cases}`);
  ok(differ > 0, `on another seat the old per-seat size differed in ${differ} of ${cases / 3} words (now every seat draws the table size)`);
});

/* ---------------------------------------------------------------- MOMENT */
const events = (sh) => [
  { key: "d|a|1", sid: "d|a", voice: "crash", x: 2000, y: 1500, r: 180, t: sh(10000), m: 0.8, tPre: sh(9600) },
  { key: "d|b|1", sid: "d|b", voice: "crash", x: 2300, y: 1550, r: 90, t: sh(10030) },
  { key: "d|c|1", sid: "d|c", voice: "boom", x: 1700, y: 1400, r: 140, t: sh(10040), m: 0.7 },
  { key: "d|a|deb", sid: "d|a|deb", voice: "debris", x: 2150, y: 1650, r: 60, t: sh(10600), phase: true }
];
function runMoment(S, { late = 0 } = {}) {
  S.enter();
  const ledger = SEAT.makeLedger(), d = S.deps(ledger), recent = [];
  const evs = events((t) => t + S.off);
  // (a late seat gets every event at once; a seat on time gets them as they come: the chunks must be the same)
  const chunks = late ? T.moments(evs) : [evs.filter((e) => e.t < S.off + 10500), evs.filter((e) => e.t >= S.off + 10500)].flatMap((b) => T.moments(b));
  const out = [];
  for ( const ch of chunks ) for ( const r of T.planMoment(ch, d, recent) ) out.push(...r.placed);
  return { out, chunks: chunks.map((c) => c.map((e) => e.key).join(",")), ledger };
}
await group("MOMENT", async () => {
  const a = runMoment(A), b = runMoment(B, { late: 900 }), a2 = runMoment(A);
  ok(a.out.length >= 3, `the moment letters (${a.out.map((w) => w.text).join(" ")})`);
  ok(JSON.stringify(a.chunks) === JSON.stringify(b.chunks), `the late seat gathers the same moments (${a.chunks.join(" | ")})`);
  ok(JSON.stringify(a.out.map(sig)) === JSON.stringify(b.out.map(sig)), "two seats (other window, zoom, own size, words up, clock, arrival): the same words, sizes, places, instants");
  ok(JSON.stringify(a.out.map(sig)) === JSON.stringify(a2.out.map(sig)), "a replay plans the same picture");
  ok(a.out.every((w) => Math.abs(w.t - w.ts) < 1e-6) && b.out.every((w) => Math.abs(w.t - B.off - w.ts) < 1e-6), "each seat times the words at the same shared instant on its own clock");
  ok(a.out.every((w) => w.reachU && w.rk >= 1), "every word carries the engine's measured reach");
});

/* ---------------------------------------------------------------- PAGE */
function firing() {
  const strokes = new Map([
    ["b1", { id: "b1", k: "burst", p: [2000, 1500], r: 220, lv: 3, q: 20000, db: [300, -200, 700, -260, 180, 900, 120, 320, 1100], wd: 0, ws: 0 }],
    ["s1", { id: "s1", k: "dust", dk: "shock", r: 600, lv: 3, q: 20000 }],
    ["f1", { id: "f1", k: "fire", p: [2100, 1600, 2300, 1650], r: 80, lv: 2, q: 20300, o: 32000 }],
    ["f2", { id: "f2", k: "fire", p: [1850, 1550], r: 60, lv: 1, q: 20500, o: 30500 }]
  ]);
  const rec = { id: "fir1", t0: 20000, seed: 7, size: 1.2, power: 1, at: [2000, 1500], d: [{ id: "d1" }], f: [...strokes.keys()].map((id) => ({ id })) };
  return { rec, strokes };
}
function runPage(S) {
  S.enter();
  const ledger = SEAT.makeLedger(), d = S.deps(ledger), { rec, strokes } = firing();
  const pg = PG.firingPage(rec, { grid: G, strokes, lift: 0.5 });
  const p = { rec, pg, ground: "stone" };
  const tb = T.planPage(p, d);
  return [...tb.entries()].map(([k, q]) => [k, q.dropped ? ["dropped", q.dropped, q.text] : sig(q)]);
}
await group("PAGE", async () => {
  const a = runPage(A), b = runPage(B), a2 = runPage(A);
  ok(a.length >= 5 && a.some(([k]) => k === "wave") && a.some(([k]) => k.startsWith("fall")) && a.some(([k]) => k === "catch"), `the page has its main word, wave, debris and catch (${a.map(([k]) => k).join(" ")})`);
  ok(JSON.stringify(a) === JSON.stringify(b), "two seats: the same page words, sizes, places, ways, instants");
  ok(JSON.stringify(a) === JSON.stringify(a2), "a replay plans the same page");
  const catchW = a.find(([k]) => k === "catch")[1]; if ( process.env.SEAT_VERBOSE ) console.log("catch", JSON.stringify(catchW));
  // (at its fire's moment + CATCH_SHOW_MS, or - covered by the blast's bigger words - a quarter second later at a time on the TABLE's
  // timeline: the same wait on every seat)
  const lagC = catchW[5] - (20300 + T.CATCH_SHOW_MS);
  ok(lagC >= -1e-6 && Math.abs(lagC / 250 - Math.round(lagC / 250)) < 1e-6, `the catch word sounds at its fire's shared moment + CATCH_SHOW_MS (+ the table's wait ${lagC} ms) on every seat, no wait for this seat's flames`);
  // (the debris material is the ground the page was given - read from the map when planned - never the first area to enter a seat)
  const d = A.deps(SEAT.makeLedger()), { rec, strokes } = firing();
  const pg = PG.firingPage(rec, { grid: G, strokes, lift: 0.5 });
  const t1 = T.planPage({ rec, pg, ground: "stone" }, d), t2 = T.planPage({ rec, pg, ground: "water" }, A.deps(SEAT.makeLedger()));
  const fallTexts = (t) => [...t.entries()].filter(([k]) => k.startsWith("fall")).map(([, q]) => q.text).join(" ");
  ok(fallTexts(t1) !== fallTexts(t2), `the debris words follow the map's ground (stone: ${fallTexts(t1)} / water: ${fallTexts(t2)})`);
});

/* ---------------------------------------------------------------- LATE */
await group("LATE", async () => {
  A.enter();
  const now = performance.now();
  const w = { t: now - 900, ms: 1100, hold: 0 };
  ok(now <= w.t + T.lifeMs(w) - 250, "a word 900 ms late is still in its life on the table: drawn, not dropped");
  const h = L.play("KA-BOOM!", { space: "world", at: { x: 2000, y: 1500 }, size: 60, fit: "world", startAt: w.t });
  await E.tick(32);
  ok(h.t0 === w.t, "joined at its shared start (startAt): the same point of its life as the seat on time");
  h.stop({ quick: true }); await E.tick(30);
});

/* ---------------------------------------------------------------- RULE */
await group("RULE", async () => {
  const L1 = (it, o) => SEAT.seatLayout([it], o).get(it.key);
  const box = { x0: 1900, y0: 1450, x1: 2100, y1: 1530 }, sub = { x0: 1960, y0: 1540, x1: 2040, y1: 1620 };
  const it = { key: "w", prio: 0, box, u: 40, sizes: [40], min: 40, sub, cover: 0.2, ink: [0.9, 0.86] };
  const view = { x0: 1000, y0: 900, x1: 3000, y1: 2100 };
  // (room: the table's word where the table put it, at this seat's size, scaled about its point nearest the thing)
  const f0 = L1(it, { view, zoom: 0.8 });
  ok(f0.rules.length === 0 && f0.f === 1 && f0.dx === 0 && f0.dy === 0 && f0.clean, "a seat with room draws the table's word where the table put it");
  const f0b = L1({ ...it, sizes: [60], min: 60 }, { view, zoom: 0.8 });
  ok(f0b.f === 1.5 && Math.abs(f0b.box.y1 - box.y1) < 1e-9 && Math.abs((f0b.box.x0 + f0b.box.x1) / 2 - 2000) < 1e-9, "bigger on this seat: grown about its edge nearest the thing - its side and its gap kept");
  // (a panel over it: moved the least, same size, off the panel)
  const panel = { x0: 1950, y0: 1400, x1: 2400, y1: 1600 };
  const f1 = L1(it, { view, panels: [panel], zoom: 0.8 });
  ok(f1.rules.includes("shift") && f1.f === 1 && f1.clean && on2(inkBox(f1.box, it.ink), panel) === 0, `under this seat's panel: moved, same size, off it (${JSON.stringify(f1)})`);
  // (its own side blocked: the first side of the shared order, the same on every seat that must leave it)
  const above = { x0: 900, y0: 800, x1: 3100, y1: 1545 };
  const f2 = L1(it, { view, panels: [above], zoom: 0.8 }), f2b = L1(it, { view: { ...view, x0: 1500 }, panels: [above], zoom: 1.1 });
  ok(f2.rules.includes("side") && on2(inkBox(f2.box, it.ink), above) === 0 && JSON.stringify(f2.box) === JSON.stringify(f2b.box), `its side blocked: the next side of the shared order, the same on two seats (${JSON.stringify([f2.box, f2.rules, f2b.box, f2b.rules])})`);
  // (a pin is never covered: smaller where nothing else holds it, down to its step-1 size)
  const pin = { x0: 1880, y0: 1380, x1: 1920, y1: 1500 };
  const f3 = L1({ ...it, sizes: [80], min: 80, small: 40 }, { view: { x0: 1820, y0: 1300, x1: 2180, y1: 1700 }, pins: [pin], zoom: 1 });
  ok(on2(inkBox(f3.box, it.ink), pin) === 0 && f3.cap < 80 && f3.cap >= 40 && f3.rules.includes("small"), `no room off the pin at its size: smaller, never on the pin (${f3.cap.toFixed(1)} ${f3.rules})`);
  // (a word bigger than the view: the size that fits; off the view: not drawn; a rider keeps its way)
  ok(L1({ ...it, sizes: [400], min: 400 }, { view: { x0: 1900, y0: 1400, x1: 2300, y1: 1700 }, zoom: 1 }).rules.includes("fit"), "bigger than the view: the size that fits");
  ok(L1({ ...it, sub: null }, { view: { x0: 0, y0: 0, x1: 500, y1: 500 }, zoom: 1 }).rule === "off", "off the view: not drawn");
  // (MAPRIDE: a rider is laid out on this seat like any word - sfx-seat rideLayout; the finer checks are in dev/sfx-mapride.test.mjs)
  const wbox = { bw: 200, bh: 80 };
  const rd = L1({ ...it, key: "r0", sizes: [60], ride: true, path: [{ x: 2000, y: 1490, ms: 0 }, { x: 2200, y: 1490, ms: 400 }], w: wbox, life: [0, 1000] }, { view, zoom: 1 });
  ok(rd.rules[0] === "ride" && rd.f === 1.5 && rd.way?.length === 2 && rd.way[0].x === 2000 && rd.way[1].x === 2200, `a rider with room rides the table's way at this seat's size (${rd.rules})`);
  // (MAPSFXSEAT2 live: the blast's wave word rode half off the GM's screen - the table holds a way inside the REFERENCE view; held inside
  // this view by a clamp (take 4) it rode over the main word. Now: every sample of its way whole in this view and off the words up with it)
  const way = [{ x: 2000, y: 1490, ms: 0 }, { x: 2000, y: 2400, ms: 500 }], rideIt = { ...it, key: "r", prio: 2, sizes: [40], ride: true, path: way, w: wbox, life: [0, 1000], anchor: "start", turn: true };
  const vv = { x0: view.x0 + SEAT.SEAT_EDGE, y0: view.y0 + SEAT.SEAT_EDGE, x1: view.x1 - SEAT.SEAT_EDGE, y1: view.y1 - SEAT.SEAT_EDGE };
  const rv = L1(rideIt, { view, zoom: 1 }), rb = rv.box;
  ok(rv.way && rb.x0 >= vv.x0 - 1e-6 && rb.x1 <= vv.x1 + 1e-6 && rb.y0 >= vv.y0 - 1e-6 && rb.y1 <= vv.y1 + 1e-6, `a rider's way that leaves this seat's view is laid out inside it (${rv.rules})`);
  const low = { ...it, key: "m", sub: null, box: { x0: 1900, y0: 1960, x1: 2100, y1: 2040 }, life: [0, 1000] };
  const ll = SEAT.seatLayout([low, rideIt], { view, zoom: 1 }), lr = ll.get("r"), lm = inkBox(ll.get("m").box, it.ink);
  const meetsLow = lr.way && lr.way.some((q, i) => i < lr.way.length - 1 && [0, 0.25, 0.5, 0.75, 1].some((g) => { const x = q.x + (lr.way[i + 1].x - q.x) * g, y = q.y + (lr.way[i + 1].y - q.y) * g, f = lr.cap / 40; return on2(inkBox({ x0: x - 100 * f, y0: y - 40 * f, x1: x + 100 * f, y1: y + 40 * f }, it.ink), lm) > SEAT.SOFT_OK * 200 * 80 * f * f * it.ink[0] * it.ink[1] + 1e-6; }));
  ok(lr.rules[0] === "ride" && (lr.rule === "noroom" || !meetsLow), `kept inside the view it does not ride over a word laid out before it (${lr.rules})`);
  ok(/if \( o\.path\?\.points && f\.way \) \{[\s\S]{0,300}oo\.path = \{ \.\.\.o\.path, points: f\.way\.map/.test(SRC) && /f\.rule === "noroom"/.test(SRC), "the runtime rides the way this seat laid out (or none)");
  // (two words of one picture up at the same time: the second keeps off the first)
  const lay = SEAT.seatLayout([{ ...it, key: "a", life: [0, 1000] }, { ...it, key: "b", prio: 1, life: [500, 1500], box: { x0: 1950, y0: 1460, x1: 2150, y1: 1540 } }], { view, zoom: 1 });
  ok(on2(inkBox(lay.get("a").box, it.ink), inkBox(lay.get("b").box, it.ink)) === 0, "a word never lands on another word up with it");
  ok(/const lay = groupLayout\(w\.group, vw, zoom, sc\)/.test(SRC) && /p\.group = \{ words:/.test(SRC) && /for \( const w of grp\.words \) w\.group = grp;/.test(SRC) && /SEAT\.seatLayout\(items, \{ view: vw, panels: ui, pins, tokens: sharedTokens\(vw\), zoom \}\)/.test(SRC), "the runtime lays out every page and moment with it");
});

/* ---------------------------------------------------------------- SEAT2 */
// The live take (MAPSFXSEAT, 2026-11-15): the blast on The Warehouse (grid 350), the GM at 1600x900 zoom 0.6 and Test Gracz 1 at 1366x768
// asked for zoom 0.9 - Foundry holds it at this scene's largest zoom, 0.7314 (both takes' seat logs) -, both centred 0.3 squares above
// the bomb, with the panels each seat measured (api.sfx.ui(), client px) and the bomb's note pin as the map's seat layout gets it
// (sharedPins + pinBoxes, traced live 2026-11-15: 2111..2439 x 3468..3879). BEFORE = what the seat drew before the table picture (base 8800f47: the engine's legible size of the word's request on this window
// and zoom - a ranked word's rank as a share of this view's height); PREV = the previous rule (base eab7e02: one group scale and shift).
const REC_UI = {
  gm: [[1232,48,1542,159],[1232,165,1542,276],[16,792,216,884],[1236,826,1536,886],[0,534,196,612],[0,618,196,696],[0,702,196,780],[96,92,360,144],[104,16,274,48],[219,858,368,890],[95,500,226,528],[450,824,510,884],[518,824,578,884],[586,824,646,884],[654,824,714,884],[722,824,782,884],[790,824,850,884],[858,824,918,884],[926,824,986,884],[994,824,1054,884],[1062,824,1122,884],[1432,11,1540,39],[16,16,48,48],[16,56,48,88],[16,96,48,128],[16,136,48,168],[16,176,48,208],[16,216,48,248],[16,256,48,288],[16,296,48,328],[16,336,48,368],[16,376,48,408],[16,416,48,448],[16,456,48,488],[16,496,48,528],[56,16,88,48],[56,56,88,88],[56,96,88,128],[56,136,88,168],[56,176,88,208],[56,216,88,248],[56,256,88,288],[56,296,88,328],[1552,726,1584,758],[1552,758,1584,790],[1552,790,1584,822],[1552,822,1584,854],[1552,854,1584,886],[1552,16,1584,48],[1552,56,1584,88],[1552,96,1584,128],[1552,136,1584,168],[1552,176,1584,208],[1552,216,1584,248],[1552,256,1584,288],[1552,296,1584,328],[1552,336,1584,368],[1552,376,1584,408],[1552,416,1584,448],[1552,456,1584,488],[1552,496,1584,528],[1552,536,1584,568],[1552,576,1584,608],[234,500,264,528],[280,20,304,44],[418,827,442,851],[418,857,442,881],[1130,824,1154,848],[1130,860,1154,884],[1158,828,1182,852],[1158,856,1182,880],[1132,844,1152,864]],
  p1: [[998,48,1308,158],[998,164,1308,274],[16,660,216,752],[1002,694,1302,754],[0,380,100,458],[0,464,100,542],[0,548,100,626],[104,16,274,48],[0,346,130,374],[503,624,563,684],[571,624,631,684],[639,624,699,684],[707,624,767,684],[775,624,835,684],[503,692,563,752],[571,692,631,752],[639,692,699,752],[707,692,767,752],[775,692,835,752],[1198,11,1306,39],[16,16,48,48],[16,56,48,88],[16,96,48,128],[16,136,48,168],[16,176,48,208],[16,216,48,248],[56,16,88,48],[56,56,88,88],[56,96,88,128],[56,136,88,168],[56,176,88,208],[1318,594,1350,626],[1318,626,1350,658],[1318,658,1350,690],[1318,690,1350,722],[1318,722,1350,754],[1318,16,1350,48],[1318,56,1350,88],[1318,96,1350,128],[1318,136,1350,168],[1318,176,1350,208],[1318,216,1350,248],[1318,256,1350,288],[1318,296,1350,328],[1318,336,1350,368],[1318,376,1350,408],[1318,416,1350,448],[1318,456,1350,488],[1318,496,1350,528],[1318,536,1350,568],[138,346,168,374],[280,20,304,44],[471,661,495,685],[471,691,495,715],[843,658,867,682],[843,694,867,718],[871,662,895,686],[871,690,895,714],[845,678,865,698]]
};
const WG = 350, BOMB = { x: 2555, y: 3885 }, CAM = { x: 2555, y: 3780 }, PIN_S = 0.6 * WG;
const PIN = { x0: 2111, y0: 3468, x1: 2439, y1: 3879 };
const REC = { gm: { W: 1600, H: 900, z: 0.6, ui: REC_UI.gm }, p1: { W: 1366, H: 768, z: 0.7314285714285714, ui: REC_UI.p1 } };
/** a GM's usual panels on a W x H window (as dev/sfx-fit.test.mjs) */
const panelsOf = (W, H) => [[0, 0, 40, H], [45, 0.27 * H, 140, 0.44 * H], [W - 190, 0, W - 30, 0.16 * H], [W - 30, 0, W, H], [0.13 * W, H - 48, 0.75 * W, H], [W - 330, H - 60, W - 30, H]];
const SPREAD = [];
for ( const [W, H] of [[1366, 768], [1600, 900], [1920, 1080], [2560, 1440]] ) for ( const z of [0.35, 0.45, 0.6, 0.9, 1.35] ) SPREAD.push({ W, H, z, ui: panelsOf(W, H) });
const PC = await import(pathToFileURL(path.join(root, "scripts/presets/core.mjs")).href);
const { BUILTIN } = await import(pathToFileURL(path.join(root, "scripts/presets/defs.mjs")).href);
const FM = await import(pathToFileURL(path.join(root, "scripts/fire/model.mjs")).href);
const MC = await import(pathToFileURL(path.join(root, "scripts/presets/meteor-core.mjs")).href);
const { fallAt } = await import(pathToFileURL(path.join(root, "scripts/presets/landing-fx.mjs")).href);
const PREV = revTree(root, "eab7e02", "scripts/sfx", fs.mkdtempSync(path.join(os.tmpdir(), "mapsfxseat2-prev-")));
const PT = await import(pathToFileURL(path.join(PREV, "sfx-table.mjs")).href), PS = await import(pathToFileURL(path.join(PREV, "sfx-seat.mjs")).href);
/** the take's bomb page (seed 777, aftermath 6), its debris on its blast's clock (as the runtime) */
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
const viewOf = (S) => ({ x0: CAM.x - S.W / 2 / S.z, y0: CAM.y - S.H / 2 / S.z, x1: CAM.x + S.W / 2 / S.z, y1: CAM.y + S.H / 2 / S.z });
const toScene = (S) => (r) => ({ x0: CAM.x + (r[0] - S.W / 2) / S.z, y0: CAM.y + (r[1] - S.H / 2) / S.z, x1: CAM.x + (r[2] - S.W / 2) / S.z, y1: CAM.y + (r[3] - S.H / 2) / S.z });
const pages = new Map();
const pageAt = (step, prev) => { const k = `${step}|${prev}`; if ( !pages.has(k) ) { const { rec, pg } = bombPage(); pages.set(k, (prev ? PT : T).planPage({ rec, pg, ground: "stone" }, wdeps(step))); } return pages.get(k); };
/** how a seat draws the page at a step: per word key { cap (option units: the size L.play gets), box, ink, rules, ok, w } */
function drawSeat(S, step, prev = false) {
  enterSeat(S);
  const d = wdeps(step), tb = pageAt(step, prev);
  const ws = [...tb.values()].filter((q) => q && !q.dropped && !q.screenAt && !q.stream && Number.isFinite(q.x) && Number.isFinite(q.y));
  const view = viewOf(S), panels = S.ui.map(toScene(S)), out = new Map();
  if ( !prev ) {
    const items = T.seatItems(ws, d, { vw: S.W, vh: S.H, zoom: S.z, scale: 1 });
    const lay = SEAT.seatLayout(items, { view, panels, pins: [PIN], tokens: [], zoom: S.z });
    for ( const it of items ) { const f = lay.get(it.key), sk = it.w.size / (T.optsOf(it.w, d).size || 1);
      out.set(it.key, { cap: f.cap / sk, box: f.box, ink: inkBox(f.box, it.ink), rules: f.rules, ok: f.ok, w: it.w, item: it, sub: it.sub, way: f.way ?? null, f: f.f }); }
    return { out, view, panels };
  }
  // (the previous rule, as its runtime did it: sfx.mjs wordGeom + groupFit + seatCall at eab7e02)
  const items = ws.map((w) => { const at = { x: w.x, y: w.y }, u = w.size, box = w.box ?? C.boxOf(w);
    const reach = w.reachU ? PT.unionBox(box, { x0: at.x - w.reachU.l * u, y0: at.y - w.reachU.u * u, x1: at.x + w.reachU.r * u, y1: at.y + w.reachU.d * u }) : PT.scaleBox(box, w.rk ?? 1, at.x, at.y);
    return { box, reach, cap: u }; });
  const g = PS.seatGroup({ items, anchor: BOMB, view, panels, zoom: S.z, subject: { x0: BOMB.x - WG, y0: BOMB.y - WG, x1: BOMB.x + WG, y1: BOMB.y + WG } });
  const nds = g.rule !== "ok" && g.rule !== "off" ? PS.groupNudge(items.map((q) => PS.groupBox(q.box, g)), [PIN], view, S.z, undefined, ws.map((q) => [q.t, q.t + PT.lifeMs(q)]), panels) : items.map(() => ({ dx: 0, dy: 0 }));
  ws.forEach((w, i) => { const b = PS.groupBox(items[i].box, g), nd = nds[i], box = { x0: b.x0 + nd.dx, y0: b.y0 + nd.dy, x1: b.x1 + nd.dx, y1: b.y1 + nd.dy };
    const sk = w.size / (PT.optsOf(w, d).size || 1);
    out.set(w.key ?? `${w.seed}|${w.role}`, { cap: (w.size * g.k) / sk, box, ink: inkBox(box, T.inkShare(w)), rules: g.rule === "off" ? ["off"] : g.rules, ok: true, w, sub: w.subject ?? null }); });
  return { out, view, panels };
}
const shown = (q, view) => !!q && !q.rules.includes("off") && !q.rules.includes("ride") && !(q.w.path?.length > 1) && on2(q.box, view) > 0;
const sideOf = (q) => { const S2 = q.sub, b = q.box; if ( !S2 ) return null; const cx = (S2.x0 + S2.x1) / 2, cy = (S2.y0 + S2.y1) / 2, ox = ((b.x0 + b.x1) / 2 - cx) / ((S2.x1 - S2.x0) / 2 + (b.x1 - b.x0) / 2), oy = ((b.y0 + b.y1) / 2 - cy) / ((S2.y1 - S2.y0) / 2 + (b.y1 - b.y0) / 2); return Math.abs(ox) > Math.abs(oy) ? ["x", Math.sign(ox)] : ["y", Math.sign(oy)]; };
await group("SEAT2", async () => {
  // ---- step order as drawn, on the two recorded seats and the spread
  let orderNew = 0, orderPrev = 0, visNew = 0, cases = 0;
  const bad = [];
  for ( const S of [REC.gm, REC.p1, ...SPREAD] ) {
    const n = [1, 2, 3].map((s) => drawSeat(S, s)), p = [1, 2, 3].map((s) => drawSeat(S, s, true));
    for ( const key of n[1].out.keys() ) {
      const a = n.map((r) => r.out.get(key)), b = p.map((r) => r.out.get(key));
      if ( a.every((q) => shown(q, n[0].view)) ) {
        cases++;
        if ( !(a[0].cap < a[1].cap - 1e-6 && a[1].cap <= a[2].cap + 1e-6) ) { orderNew++; if ( process.env.SEAT_DBG ) for ( const q of a ) console.log("DBG", S.W, S.H, S.z, q.cap.toFixed(1), q.rules.join(","), "sizes", q.item.sizes.map((c) => c.toFixed(0)).join("/"), "min", q.item.min.toFixed(0), "small", q.item.small?.toFixed(0), "probe", (q.item.probe ?? []).slice(0, 6).map((c) => c.toFixed(0)).join("/"), "u", q.item.u.toFixed(0), "tbl", [q.item.box.x0, q.item.box.y0, q.item.box.x1, q.item.box.y1].map(Math.round).join(","), "box", [q.box.x0, q.box.y0, q.box.x1, q.box.y1].map(Math.round).join(",")); bad.push(`${S.W}x${S.H}@${S.z} ${a[1].w.text} ${a.map((q) => q.cap.toFixed(0) + ":" + q.rules.join("+")).join(" / ")}`); }
        // (visibly: step 3 at least MIN_GAIN x step 2 unless this view holds no clean spot that big - "full", "small", "fit")
        else if ( a[2].cap < a[1].cap * SEAT.MIN_GAIN - 1e-6 && !a[2].rules.some((r) => r === "full" || r === "small" || r === "fit") ) visNew++;
      }
      if ( b.every((q) => shown(q, p[0].view)) && !(b[0].cap < b[1].cap - 1e-6 && b[1].cap <= b[2].cap + 1e-6) ) orderPrev++;
    }
  }
  ok(orderPrev > 0, `the previous rule: step 1 < step 2 <= step 3 as drawn broken in ${orderPrev} word x seat cases`);
  ok(orderNew === 0, `now: step 1 < step 2 <= step 3 as drawn in every case (${cases}; broken ${orderNew}: ${bad.slice(0, 4).join("; ")})`);
  ok(visNew === 0, `now: step 3 at least ${SEAT.MIN_GAIN} x step 2 wherever the view holds it clean (${visNew} not)`);
  // ---- not smaller than before, the two recorded seats, step 2
  let lessNew = 0, lessPrev = 0, smallChecked = 0;
  const rows = [];
  for ( const [sn, S] of Object.entries(REC) ) {
    const n = drawSeat(S, 2), p = drawSeat(S, 2, true), d = wdeps(2);
    enterSeat(S);
    for ( const [key, q] of n.out ) {
      if ( !shown(q, n.view) ) continue;
      // (the before build: the word's options with a ranked word's rank as a share of THIS view's height, the engine's legible size here)
      const o = { ...T.baseOpts(q.w, d) }; if ( Number.isFinite(q.w.rank) ) o.size = EV.rankSize(q.w.rank, S.H / S.z, q.w.shrink ?? 1);
      delete o.fit; delete o.keepInView;
      // (the engine's own size model for this window and zoom, its words up the table's - L.sizeOf would count the words this test left up)
      const pl = T.planInfo(q.w.text, o, d), before = SEAT.refSize(sizeFor, o, pl, { z: S.z, alive: q.w.alive ?? 0, grid: WG, vw: S.W, vh: S.H }).px / ((pl.sizeK ?? 1) * S.z);
      const pq = p.out.get(key);
      if ( pq && shown(pq, p.view) && pq.cap < before * 0.995 ) lessPrev++;
      if ( q.w.role === "main" ) rows.push(`${sn} ${q.w.text} before ${before.toFixed(1)} prev ${pq?.cap.toFixed(1)} now ${q.cap.toFixed(1)} ${q.rules.join("+")}`);
      if ( q.cap >= before * 0.995 ) continue;
      // (smaller only by the rule "small": no spot of this view holds it at its step-2 size off the pin, inside the view, its panels'
      // and earlier words' share at most SOFT_OK - checked here by brute force over the whole view, not by the layout's own candidates)
      if ( !q.rules.includes("small") ) { lessNew++; rows.push(`  less: ${sn} ${q.w.text} ${q.cap.toFixed(1)} < ${before.toFixed(1)} ${q.rules}`); continue; }
      smallChecked++;
      const it = q.item, f = it.min / it.u, B = it.box, bw = (B.x1 - B.x0) * f, bh = (B.y1 - B.y0) * f, m = SEAT.SEAT_EDGE / S.z, v = n.view;
      const others = [...n.out.values()].filter((o2) => o2 !== q && (o2.item?.prio ?? 9) < it.prio && shown(o2, v)).map((o2) => o2.ink);
      // (and its own subject covered no more than the layout allows: its kind's share or the table picture's own, + 0.02)
      const sub = it.sub, cov = sub ? Math.max(it.cover ?? 0.3, on2(B, sub) / area2(sub)) + 0.02 : 0;
      let room = false, at = null;
      for ( let cy = v.y0 + m + bh / 2; cy <= v.y1 - m - bh / 2 && !room; cy += bh / 12 ) for ( let cx = v.x0 + m + bw / 2; cx <= v.x1 - m - bw / 2 && !room; cx += bw / 24 ) {
        const k = inkBox({ x0: cx - bw / 2, y0: cy - bh / 2, x1: cx + bw / 2, y1: cy + bh / 2 }, it.ink);
        if ( on2(k, PIN) > 0 || (sub && on2(k, sub) > cov * area2(sub) + 1e-6) ) continue;
        const soft = [...n.panels, ...others].reduce((s2, o2) => s2 + on2(k, o2), 0);
        if ( soft <= SEAT.SOFT_OK * area2(k) * 0.9 ) { room = true; at = [Math.round(cx), Math.round(cy)]; }
      }
      if ( room ) { lessNew++; rows.push(`  room: ${sn} ${q.w.text} at ${at} (${Math.round(bw)} x ${Math.round(bh)})`); }
    }
  }
  if ( process.env.SEAT_VERBOSE ) console.log(rows.join("\n"));
  ok(lessPrev > 0, `the previous rule drew ${lessPrev} words smaller than before on the recorded seats (${rows.filter((r) => r.startsWith("gm")).join("; ")})`);
  ok(lessNew === 0, `now: no word smaller than before unless its view holds no clean spot that big (${lessNew} are; ${smallChecked} by "small", proven: ${rows.filter((r) => r.startsWith("p1")).join("; ")})`);
  // ---- same side of the thing, the two recorded seats
  let sideNew = 0, sidePrev = 0, sideCases = 0;
  for ( const step of [1, 2, 3] ) {
    const a = drawSeat(REC.gm, step), b = drawSeat(REC.p1, step), pa = drawSeat(REC.gm, step, true), pb = drawSeat(REC.p1, step, true);
    for ( const key of a.out.keys() ) {
      const x = a.out.get(key), y = b.out.get(key);
      if ( shown(x, a.view) && shown(y, b.view) && x.sub ) {
        sideCases++;
        const s1 = sideOf(x), s2 = sideOf(y);
        // (a seat that could not show it on its side - the rule "side" - stands it on the shared order's next side)
        if ( (s1[0] !== s2[0] || s1[1] !== s2[1]) && !x.rules.includes("side") && !y.rules.includes("side") ) sideNew++;
      }
      const px = pa.out.get(key), py = pb.out.get(key);
      if ( shown(px, pa.view) && shown(py, pb.view) && px.sub ) { const s1 = sideOf(px), s2 = sideOf(py); if ( s1[0] !== s2[0] || s1[1] !== s2[1] ) sidePrev++; }
    }
    const ma = [...a.out.values()].find((q) => q.w.role === "main"), mb = [...b.out.values()].find((q) => q.w.role === "main");
    // (B: live the main word stood on two sides of the bomb's pin; now the same side - or, where a seat cannot show it on the table's side
    // ("side"), on the first side of the order every seat shares)
    ok(JSON.stringify(sideOf(ma)) === JSON.stringify(sideOf(mb)) || ma.rules.includes("side") || mb.rules.includes("side"), `step ${step}: the blast's main word on the same side of the bomb on both seats (${sideOf(ma)} ${ma.rules} / ${sideOf(mb)} ${mb.rules})`);
    if ( process.env.SEAT_VERBOSE ) console.log("main side step", step, sideOf(ma), ma.rules.join("+"), [ma.box.x0, ma.box.y0, ma.box.x1, ma.box.y1].map(Math.round).join(","), "|", sideOf(mb), mb.rules.join("+"), [mb.box.x0, mb.box.y0, mb.box.x1, mb.box.y1].map(Math.round).join(","), "sub", [ma.sub.x0, ma.sub.y0, ma.sub.x1, ma.sub.y1].map(Math.round).join(","));
  }
  if ( process.env.SEAT_VERBOSE ) console.log("side: prev", sidePrev, "now", sideNew, "of", sideCases);
  ok(sideNew === 0, `every word both seats show stands on the same side of what it letters (${sideNew} of ${sideCases} not; previous rule ${sidePrev})`);
  // ---- nothing covered: no ink on the pin; panels and the words up with it at most SOFT_OK of it (an edge); recorded seats and spread
  let pinNew = 0, pinPrev = 0, coverNew = 0, coverPrev = 0, words = 0;
  const lifeOf = (w) => [w.ts ?? 0, (w.ts ?? 0) + T.lifeMs(w)], meet = (a2, b2) => a2[0] < b2[1] && b2[0] < a2[1];
  for ( const S of [REC.gm, REC.p1, ...SPREAD] ) for ( const step of [1, 2, 3] ) for ( const prev of [false, true] ) {
    const r = drawSeat(S, step, prev), vis = [...r.out.values()].filter((q) => shown(q, r.view));
    for ( const q of vis ) {
      if ( !prev ) words++;
      const others = vis.filter((o2) => o2 !== q && meet(lifeOf(o2.w), lifeOf(q.w)) && (prev ? true : (o2.item?.prio ?? 9) < (q.item?.prio ?? 9) || ((o2.item?.prio ?? 9) === (q.item?.prio ?? 9) && o2.item?.key < q.item?.key)));
      const soft = r.panels.reduce((s2, o2) => s2 + on2(q.ink, o2), 0) + others.reduce((s2, o2) => s2 + on2(q.ink, o2.ink), 0) / (prev ? 2 : 1);
      if ( on2(q.ink, PIN) > 0 ) { if ( prev ) pinPrev++; else pinNew++; }
      if ( soft > SEAT.SOFT_OK * area2(q.ink) + 1e-6 && (prev || !q.rules.includes("tight")) ) { if ( prev ) coverPrev++; else coverNew++; }
    }
  }
  ok(pinPrev > 0 && pinNew === 0, `no word on the pin (previous rule: ${pinPrev} word x seat x step; now ${pinNew} of ${words})`);
  // (the previous rule kept panels and words clean too - by shrinking the whole page: defect A - and put the main word on the pin: C)
  ok(coverNew === 0, `no word under a panel or on another word beyond an edge of ${SEAT.SOFT_OK * 100} % (previous rule: ${coverPrev}; now ${coverNew} of ${words})`);
  // ---- seeded and clocked, nothing per seat at random: the same seat draws the same twice
  const sig2 = () => JSON.stringify([...drawSeat(REC.p1, 3).out].map(([k, q]) => [k, q.cap, q.box]));
  ok(sig2() === sig2(), "a seat draws the same picture twice");
});

/* ---------------------------------------------------------------- RIDE (MAPRIDE) */
// The words that ride a way (the bomb's falling word, the shock wave) on the take's two seats and the spread, steps 1-3: every sample of
// the way as this seat draws it (its box at this seat's size, at the instant it passes there) whole in this seat's view, its ink off the
// pin, at most SOFT_OK of it under this seat's panels and the words up at that instant. The previous rule (f1d9491: the table's way, held
// inside the view by a clamp only where that clamp stayed off earlier words) broke it on the recorded seats (live: the wave half off the
// GM's bottom edge, the falling word under the challenges panel).
const BASE = revTree(root, "f1d9491", "scripts/sfx", fs.mkdtempSync(path.join(os.tmpdir(), "mapride-base-")));
const BT = await import(pathToFileURL(path.join(BASE, "sfx-table.mjs")).href), BS = await import(pathToFileURL(path.join(BASE, "sfx-seat.mjs")).href);
/** the riders of the page as a seat draws them: { key, way, f, w, item } (base: the f1d9491 rule) + the words up with them */
function ridersOf(S, step, base = false) {
  enterSeat(S);
  const d = wdeps(step), tb = pageAt(step, false);
  const ws = [...tb.values()].filter((q) => q && !q.dropped && !q.screenAt && !q.stream && Number.isFinite(q.x) && Number.isFinite(q.y));
  const view = viewOf(S), panels = S.ui.map(toScene(S));
  const TT = base ? BT : T, SS = base ? BS : SEAT;
  const items = TT.seatItems(ws, d, { vw: S.W, vh: S.H, zoom: S.z, scale: 1 }), lay = SS.seatLayout(items, { view, panels, pins: [PIN], tokens: [], zoom: S.z });
  const riders = [], words = [];
  for ( const it of items ) {
    const f = lay.get(it.key);
    if ( it.ride && (it.path?.length ?? 0) > 1 ) {
      let way = f.way ?? it.path;
      if ( base && f.ride ) { const r = f.ride; way = it.path.map((q) => ({ ...q, x: r.x1 > r.x0 ? Math.min(Math.max(q.x, r.x0), r.x1) : (r.x0 + r.x1) / 2, y: r.y1 > r.y0 ? Math.min(Math.max(q.y, r.y0), r.y1) : (r.y0 + r.y1) / 2 })); }
      riders.push({ key: it.key, way, f: f.f ?? f.cap / it.u, rules: f.rules, w: it.w, item: it, stop: Number.isFinite(it.w.stopAt) ? it.w.ts + (it.w.stopAt - it.w.t) : it.life[1] });
    } else if ( f && !f.rules.includes("off") ) words.push({ ink: inkBox(f.box, it.ink), life: it.life, prio: it.prio });
  }
  return { riders, words, view, panels };
}
/** the faults of a rider's way on a seat: samples off the view, on the pin, under panels / words up beyond SOFT_OK */
function rideFaults(r, ctx, S) {
  const m = SEAT.SEAT_EDGE / S.z, v = { x0: ctx.view.x0 + m, y0: ctx.view.y0 + m, x1: ctx.view.x1 - m, y1: ctx.view.y1 - m };
  const W = r.way, P0 = W[0].ms, tot = Math.max(1, W.at(-1).ms - P0), bw = r.w.bw * r.f, bh = r.w.bh * r.f, k = r.item.ink;
  const out = { off: 0, pin: 0, cover: 0, n: 0 };
  for ( let i = 0; i <= 20; i++ ) {
    const ms = P0 + (tot * i) / 20;
    let j = 1; while ( j < W.length - 1 && W[j].ms < ms ) j++;
    const a = W[j - 1], b = W[j], g = b.ms > a.ms ? Math.min(1, Math.max(0, (ms - a.ms) / (b.ms - a.ms))) : 1, x = a.x + (b.x - a.x) * g, y = a.y + (b.y - a.y) * g;
    const box = { x0: x - bw / 2, y0: y - bh / 2, x1: x + bw / 2, y1: y + bh / 2 }, ink = inkBox(box, k), t = r.item.life[0] + ms - P0;
    out.n++;
    if ( area2(box) - on2(box, v) > 1 ) out.off++;
    if ( on2(ink, PIN) > 0 ) out.pin++;
    const up = ctx.words.filter((q) => q.prio < r.item.prio && q.life[0] < t + 80 && q.life[1] > t - 80);
    const soft = ctx.panels.reduce((s, o) => s + on2(ink, o), 0) + up.reduce((s, o) => s + on2(ink, o.ink), 0);
    if ( soft > SEAT.SOFT_OK * area2(ink) * 1.05 + 1 ) out.cover++;
  }
  return out;
}
await group("RIDE", async () => {
  let faultsNew = 0, faultsBase = 0, shownNew = 0, noroom = 0, cases = 0;
  const rows = [];
  for ( const [sn, S] of [["gm", REC.gm], ["p1", REC.p1], ...SPREAD.map((q) => [`${q.W}x${q.H}@${q.z}`, q])] ) for ( const step of [1, 2, 3] ) {
    const n = ridersOf(S, step), b = ridersOf(S, step, true);
    for ( const r of n.riders ) {
      cases++;
      if ( r.rules.includes("off") ) continue;
      if ( r.rules.includes("noroom") ) { noroom++; if ( sn === "gm" || sn === "p1" ) rows.push(`noroom ${sn} s${step} ${r.w.text}`); continue; }
      shownNew++;
      const fl = rideFaults(r, n, S);
      if ( fl.off || fl.pin || fl.cover ) { faultsNew++; rows.push(`NEW ${sn} s${step} ${r.w.text} ${JSON.stringify(fl)} ${r.rules}`); }
      if ( (sn === "gm" || sn === "p1") && process.env.SEAT_VERBOSE ) { const P = r.item.path, kp = r.item.anchor === "end" ? [P.at(-1), r.way.at(-1)] : [P[0], r.way[0]];
        rows.push(`${sn} s${step} ${r.w.text} cap ${(r.f * r.item.u).toFixed(0)} ${r.rules.join("+")} anchor moved ${Math.round(kp[1].x - kp[0].x)},${Math.round(kp[1].y - kp[0].y)} (${(Math.hypot(kp[1].x - kp[0].x, kp[1].y - kp[0].y) / (r.w.bh * r.f)).toFixed(1)} box h)`); }
    }
    for ( const r of b.riders ) {
      if ( r.rules.includes("off") ) continue;
      const fl = rideFaults(r, b, S);
      if ( fl.off || fl.pin || fl.cover ) { faultsBase++; if ( sn === "gm" || sn === "p1" ) rows.push(`base ${sn} s${step} ${r.w.text} ${JSON.stringify(fl)}`); }
    }
  }
  if ( process.env.SEAT_VERBOSE ) console.log(rows.join("\n"));
  ok(faultsBase > 0, `the previous rule: riders off the view, on the pin or under a panel / word in ${faultsBase} rider x seat x step cases (${rows.filter((q) => q.startsWith("base gm") || q.startsWith("base p1")).slice(0, 3).join("; ")})`);
  ok(faultsNew === 0, `now: every rider's way whole in view, off the pin, at most an edge under panels / words up (${shownNew} drawn, ${noroom} without room, of ${cases}; faults ${faultsNew}: ${rows.filter((q) => q.startsWith("NEW")).slice(0, 3).join("; ")})`);
  // (the take's two seats draw both riders at every step - the falling word and the wave are the story's build and its pressure)
  let recShown = 0;
  for ( const S of [REC.gm, REC.p1] ) for ( const step of [1, 2, 3] ) recShown += ridersOf(S, step).riders.filter((r) => !r.rules.includes("noroom") && !r.rules.includes("off")).length;
  ok(recShown === 2 * 3 * 2, `the take's seats draw the falling word and the wave at every step (${recShown} of 12; ${rows.filter((q) => q.startsWith("noroom")).join("; ")})`);
  // (seeded and clocked: the same seat lays its riders out the same twice; the wave keeps its start at the blast, the fall its end)
  const sig3 = () => JSON.stringify(ridersOf(REC.gm, 2).riders.map((r) => [r.key, r.f, r.way]));
  ok(sig3() === sig3(), "a seat lays its riders out the same twice");
  const g2 = ridersOf(REC.gm, 2).riders;
  for ( const r of g2 ) { const P = r.item.path, Wy = r.way, keep = r.item.anchor === "end" ? [P.at(-1), Wy.at(-1)] : [P[0], Wy[0]];
    ok(r.rules.includes("shift") || Math.hypot(keep[0].x - keep[1].x, keep[0].y - keep[1].y) < 1e-6, `${r.w.text}: its ${r.item.anchor} stays where the table tied it unless the whole way had to move (${r.rules})`); }
});

/* ---------------------------------------------------------------- GROUND */
await group("GROUND", () => {
  const fill = (r, g, b, n = 64 * 64) => { const a = new Uint8ClampedArray(n * 4); for ( let i = 0; i < n; i++ ) { a[i * 4] = r; a[i * 4 + 1] = g; a[i * 4 + 2] = b; a[i * 4 + 3] = 255; } return a; };
  ok(SEAT.groundOfPixels(fill(60, 130, 50), 64) === "grass", "green: grass");
  ok(SEAT.groundOfPixels(fill(40, 90, 170), 64) === "water", "blue: water");
  ok(["stone", "metal"].includes(SEAT.groundOfPixels(fill(120, 120, 122), 64)), "grey: stone / metal");
  ok(SEAT.groundOfPixels(fill(250, 250, 250), 64) === "snow", "white: snow");
  ok(SEAT.groundOfPixels(new Uint8ClampedArray(0), 64) === "auto", "nothing read: auto (earth)");
});

/* ---------------------------------------------------------------- BURN (MAPRIDE) */
// A burning fire's run on the take's two seats (The Warehouse, their recorded panels and the bomb's pin), steps 1-3: a fire burning by the
// hotbar, one by the pin, and a second fire 4.5 run sizes above the first (two fires one above the other: SUSTAINGAP-5). Each run's block
// (sfx-seat runReserve: the room the engine keeps the run to + the margin its ink may leave it by - measured in dev/sfx-burn.test.mjs)
// stands whole in the view, off the pin and the panels (a 6 % share of a tall block hid a whole phrase live), never on another fire's block. The previous rule (f1d9491
// burnOffsets: a box -2.5 .. +0.9 em, em = 1.25 x the run's size, cleared of panels and pins, the run left to take its own height) put the
// run's real block on the hotbar, the pin or the other fire's run.
await group("BURN", async () => {
  // (sfx.mjs burnSize: the run's size at the fire group's step - a live fire at level 0.6)
  const kOf = (step) => SZ.sizeAt(Math.max(4, (SEAT.REF_VH * (0.035 + 0.03 * Math.min(1, 0.6 / 0.9))) / SEAT.refZoom(WG, 0)), step);
  const mid = (S, sx, sy) => ({ x: CAM.x + (sx - S.W / 2) / S.z, y: CAM.y + (sy - S.H / 2) / S.z });
  let bad = 0, badPrev = 0, notLettered = 0, cases = 0;
  const rows = [], sizesRow = [], minsOf = {};
  for ( const [sn, S] of [["gm", REC.gm], ["p1", REC.p1]] ) for ( const step of [1, 2, 3] ) for ( const motion of ["smooth", "stepped"] ) {
    const k = kOf(step), v0 = viewOf(S), m = SEAT.SEAT_EDGE / S.z, v = { x0: v0.x0 + m, y0: v0.y0 + m, x1: v0.x1 - m, y1: v0.y1 - m };
    const panels = S.ui.map(toScene(S));
    // (the fires, the same on both seats: by the GM's hotbar, beside the pin, and one above the first)
    const A0 = mid(REC.gm, 760, 800), k2 = kOf(2), spots = [A0, { x: PIN.x0 - 0.5 * k2, y: PIN.y1 + 0.5 * k2 }, { x: A0.x, y: A0.y - 4.5 * k2 }];
    // (the previous rule)
    const em = 1.25 * k, ui = [...panels, PIN], prevBlocks = [];
    for ( const q of spots ) {
      const box = { x0: q.x - em * 4.4, y0: q.y - em * 2.5, x1: q.x + em * 4.4, y1: q.y + em * 0.9 }, d = C.clearOf(box, ui, v0, Math.max(v0.x1 - v0.x0, v0.y1 - v0.y0) * 0.45);
      if ( d.dx || d.dy ) ui.push({ x0: box.x0 + d.dx, y0: box.y0 + d.dy, x1: box.x1 + d.dx, y1: box.y1 + d.dy });
      prevBlocks.push(SEAT.runReserve({ x: q.x + d.dx, y: q.y + d.dy }, k, motion));
    }
    // (now)
    // (as sfx.mjs burnRooms: smaller on this seat where the table's size has no room, down to half of it, never under the legibility floor)
    const kMin = Math.min(k, SZ.floorPx(S.H, 1, L.sizeModel) / S.z);
    const r = SEAT.burnRoom(spots, { k, kMin, below: [1, 2, 3].filter((s) => s < step).map(kOf), v, hard: [PIN, ...panels], motion });
    const mins = (minsOf[`${sn} ${motion}`] ??= []); mins[step] = r.map((o) => (o.ok ? o.k : 0));
    sizesRow.push(`${sn} s${step} ${motion}: ${r.map((q) => (q.ok ? Math.round(q.k * S.z) : "-")).join("/")} px (table ${Math.round(k * S.z)})`);
    const fault = (b, others) => (on2(b, PIN) > 0 ? "pin" : area2(b) - on2(b, v) > 1 ? "off" : panels.some((o) => on2(b, o) > 1) ? "panel" : others.some((o) => on2(b, o) > 1) ? "fire" : "");
    prevBlocks.forEach((b, i) => { const f = fault(b, prevBlocks.filter((_, j) => j !== i)); if ( f ) { badPrev++; if ( rows.length < 40 ) rows.push(`prev ${sn} s${step} ${motion} fire${i} ${f}`); } });
    r.forEach((q, i) => { cases++; if ( !q.ok ) { notLettered++; rows.push(`noroom ${sn} s${step} ${motion} fire${i} k ${k.toFixed(0)} block ${Math.round(q.box.x1 - q.box.x0)}x${Math.round(q.box.y1 - q.box.y0)} view ${Math.round(v.x1 - v.x0)}x${Math.round(v.y1 - v.y0)}`); return; }
      const f = fault(q.box, r.filter((o, j) => j !== i && o.ok).map((o) => o.box)); if ( f ) { bad++; rows.push(`NOW ${sn} s${step} ${motion} fire${i} ${f}`); }
      if ( !(q.room.x0 >= q.box.x0 - 1e-6 && q.room.x1 <= q.box.x1 + 1e-6 && q.room.y0 >= q.box.y0 - 1e-6 && q.room.y1 <= q.box.y1 + 1e-6) ) { bad++; rows.push(`room ${sn} s${step} fire${i} not inside its block`); } });
  }
  if ( process.env.SEAT_VERBOSE ) console.log(rows.join("\n") + "\nrun sizes on screen: " + sizesRow.join("; "));
  ok(badPrev > 0, `the previous rule: a fire's run on the pin, a panel, off the view or on another fire's run in ${badPrev} fire x seat x step cases (${rows.filter((q) => q.startsWith("prev")).slice(0, 4).join("; ")})`);
  ok(bad === 0, `now: every run's block whole in view, off the pin and the panels, never on another fire's (${bad} faults; ${rows.filter((q) => q.startsWith("NOW") || q.startsWith("room")).slice(0, 3).join("; ")})`);
  ok(notLettered === 0, `the take's fires are lettered on both seats at every step (${cases - notLettered} of ${cases}; ${rows.filter((q) => q.startsWith("noroom")).join("; ")})`);
  const order = Object.entries(minsOf).filter(([, m]) => m[1].some((_, i) => !(m[1][i] <= m[2][i] + 1e-9 && m[2][i] <= m[3][i] + 1e-9)));
  ok(!order.length, `a higher step never letters a crowded seat's run smaller (${order.map(([s, m]) => s + " " + m.slice(1).map((x) => x.map(Math.round).join("/")).join(" ")).join("; ")})`);
  const sig4 = () => JSON.stringify(SEAT.burnRoom([{ x: 2400, y: 4300 }, { x: 2400, y: 4100 }], { k: 60, v: viewOf(REC.p1), hard: [PIN], soft: REC.p1.ui.map(toScene(REC.p1)) }));
  ok(sig4() === sig4(), "a seat lays its runs out the same twice");
});

globalThis.innerWidth = 1600; globalThis.innerHeight = 900; canvas.stage.scale.x = 1;
if ( failed.length ) { console.error(failed.join("\n")); console.error(`sfx-seat: ${failed.length} group(s) failed, ${n} checks passed`); process.exit(1); }
console.log(`sfx-seat: ${n} checks passed`);
