// MAPSFXSEAT: every seat that sees a map moment shows the same words, at the same size and place on the map, at the same instant, and
// the same again on replay (scripts/sfx/sfx-table.mjs: the table picture; scripts/sfx/sfx-seat.mjs: the reference view and the seat
// rule). Two simulated seats with different windows, panels, zoom, own lettering size, words up and arrival delay run the SAME planning
// code the runtime runs (sfx.mjs only builds the deps from shared data and draws the plan) on the real engine in node
// (scripts/letters/testenv.mjs, read only).
//   STEP2     on a seat whose window, zoom and words up are the reference's, the table size IS the engine's own size (L.sizeOf) - step 2
//             unchanged there - and steps 1 / 3 are the old stepping of it; on another seat the old size differed (defect 1)
//   MOMENT    a destruction moment (a collapse, its debris, a blast): equal words, sizes, places, instants on both seats; a replay equal
//   PAGE      a preset firing's page (blast, wave, debris, fire catch, fire out): the same; its debris ground from the map, not a seat
//   LATE      a seat that gets the moment late gathers the same chunks and joins each word at the same point of its life (startAt)
//   RULE      the seat rule: only place shift and size factor change, logged; a seat with nothing in the way draws the table unchanged;
//             a page's / moment's words move and scale TOGETHER (seatGroup), never one onto another
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

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
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
      let px = z0.px;
      if ( step !== 2 ) {
        const cap = L.sizeOf(word.text, { ...o, fit: "legible", size: (20 * innerHeight) / z, scale: 1, ceilK: 1, magnitude: SZ.LOUD_MAG }).px / L.sizeModel.hardHi;
        px = SZ.steppedPx(z0.px, step, step > 2 ? { cap } : { floor: SZ.floorPx(innerHeight, sk, L.sizeModel) });
      }
      const old = step === 2 ? z0.size : px / (sk * z);
      if ( Math.abs(tab.size - old) <= 1e-6 * old ) same++; else console.log("STEP2 differs", kind, seed, zr, step, tab.size, old);
    }
    // (another seat - a laptop window, closer zoom - drew it at another size before: the cause of defect 1)
    globalThis.innerWidth = 1366; globalThis.innerHeight = 768; canvas.stage.scale.x = 1.35;
    if ( Math.abs(L.sizeOf(word.text, o).size - T.tableSized(w, o, 2, d).size) > 0.01 ) differ++;
  }
  ok(same === cases, `on a reference seat the table size is the engine's own (step 2) and its old stepping (steps 1, 3): ${same} of ${cases}`);
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
  const box = { x0: 1900, y0: 1450, x1: 2100, y1: 1530 }, reach = { x0: 1880, y0: 1420, x1: 2120, y1: 1560 };
  // (nothing in the way: the view holds it whole, no panel over it, readable: the table's word unchanged)
  const f0 = SEAT.seatFit({ box, reach, view: { x0: 1000, y0: 900, x1: 3000, y1: 2100 }, panels: [], zoom: 0.8, cap: 40 });
  ok(f0.rule === "ok" && f0.k === 1 && f0.dx === 0 && f0.dy === 0, "a seat with nothing in the way draws the table's word as it is");
  // (a panel over it: moved by the smallest shift, same size)
  const f1 = SEAT.seatFit({ box, reach, view: { x0: 1000, y0: 900, x1: 3000, y1: 2100 }, panels: [{ x0: 1950, y0: 1400, x1: 2400, y1: 1600 }], zoom: 0.8, cap: 40 });
  ok(f1.rule === "shift" && f1.k === 1 && (f1.dx || f1.dy), "under this seat's panel: shifted, same size");
  // (a far zoom: drawn at the readable floor)
  const f2 = SEAT.seatFit({ box, reach, view: { x0: 0, y0: 0, x1: 8000, y1: 5000 }, panels: [], zoom: 0.2, cap: 40 });
  ok(f2.rules.includes("read") && Math.abs(f2.k * 40 * 0.2 - SEAT.READ_PX) < 1e-9, "too small at this zoom: the readable floor");
  // (a tiny view: smaller to fit)
  const f3 = SEAT.seatFit({ box, reach, view: { x0: 1950, y0: 1400, x1: 2050, y1: 1600 }, panels: [], zoom: 4, cap: 40 });
  ok(f3.rules.includes("fit") && f3.k < 1, "its reach bigger than the view: smaller to fit");
  // (off this seat's view: not drawn)
  ok(SEAT.seatFit({ box, reach, view: { x0: 0, y0: 0, x1: 500, y1: 500 }, panels: [], zoom: 1, cap: 40 }).rule === "off", "off the view: not drawn");
  // A GROUP (a page's words): live (two seats, 2026-11-15) the player's view was smaller than the table's and each word was shifted into
  // it on its own: FHWOOOOMMFF! landed on the main word. The group rule moves and scales the whole page together.
  const d = A.deps(SEAT.makeLedger()), { rec, strokes } = firing();
  const pg = PG.firingPage(rec, { grid: G, strokes, lift: 0.5 });
  const tb = T.planPage({ rec, pg, ground: "stone" }, d);
  const ws = [...tb.values()].filter((q) => q && !q.dropped && !q.screenAt && q.box && Number.isFinite(q.x));
  const items = ws.map((q) => ({ box: q.box, reach: q.box, cap: q.size }));
  const ov = (bs) => { let s = 0; for ( let i = 0; i < bs.length; i++ ) for ( let j = i + 1; j < bs.length; j++ ) { const a = bs[i], b = bs[j]; s += Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)); } return s; };
  const U = items.reduce((a, q) => ({ x0: Math.min(a.x0, q.box.x0), y0: Math.min(a.y0, q.box.y0), x1: Math.max(a.x1, q.box.x1), y1: Math.max(a.y1, q.box.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const anchor = { x: rec.at[0], y: rec.at[1] };
  ok(items.length >= 4, `the page has located words (${items.length})`);
  // (nothing in the way: unchanged)
  const g0 = SEAT.seatGroup({ items, anchor, view: { x0: U.x0 - 400, y0: U.y0 - 400, x1: U.x1 + 400, y1: U.y1 + 400 }, panels: [], zoom: 0.62 });
  ok(g0.rule === "ok" && g0.k === 1 && g0.dx === 0 && g0.dy === 0, "a seat whose view holds the whole page draws it as the table planned it");
  // (a view smaller than the page and off to one side, a panel at its left: one scale, one shift for all; no word onto another)
  const W0 = U.x1 - U.x0, H0 = U.y1 - U.y0;
  const vw = { x0: U.x0 + W0 * 0.3, y0: U.y0 + H0 * 0.2, x1: U.x0 + W0 * 0.9, y1: U.y0 + H0 * 0.8 };
  const panel = { x0: vw.x0, y0: vw.y0, x1: vw.x0 + (vw.x1 - vw.x0) * 0.1, y1: vw.y1 };
  const g1 = SEAT.seatGroup({ items, anchor, view: vw, panels: [panel], zoom: 1.35 });
  const after = items.map((q) => SEAT.groupBox(q.box, g1));
  ok(g1.rules.includes("fit") && g1.k < 1, `the page bigger than this view: all its words smaller together (k ${g1.k.toFixed(2)})`);
  ok(ov(after) <= ov(items.map((q) => q.box)) * g1.k * g1.k + 1e-6, "no word moved onto another: their overlap only scales with them");
  ok(after.every((b) => b.x0 >= vw.x0 - 1e-6 && b.x1 <= vw.x1 + 1e-6 && b.y0 >= vw.y0 - 1e-6 && b.y1 <= vw.y1 + 1e-6), "every word whole in this seat's view");
  const one = items.map((q) => { const f = SEAT.seatFit({ box: q.box, reach: q.box, view: vw, panels: [panel], zoom: 1.35, cap: q.cap }); const cx = (q.box.x0 + q.box.x1) / 2, cy = (q.box.y0 + q.box.y1) / 2; return SEAT.groupBox(q.box, { k: f.k, dx: f.dx, dy: f.dy, ax: cx, ay: cy }); });
  if ( process.env.SEAT_VERBOSE ) console.log("group overlap: table", ov(items.map((q) => q.box)).toFixed(0), "group rule", ov(after).toFixed(0), "word by word", ov(one).toFixed(0));
  ok(/const f = w\.group \? groupFit\(w\.group, vw, ui, zoom\)/.test(SRC) && /p\.group = \{ words:/.test(SRC) && /for \( const w of grp\.words \) w\.group = grp;/.test(SRC), "the runtime applies the group rule to every page and moment");
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

globalThis.innerWidth = 1600; globalThis.innerHeight = 900; canvas.stage.scale.x = 1;
if ( failed.length ) { console.error(failed.join("\n")); console.error(`sfx-seat: ${failed.length} group(s) failed, ${n} checks passed`); process.exit(1); }
console.log(`sfx-seat: ${n} checks passed`);
