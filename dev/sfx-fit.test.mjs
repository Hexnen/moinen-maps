// THUNDERFIT: every map sound word whole inside the view and clear of the panels, measured by what the engine will really draw
// (scripts/sfx/sfx-fit.mjs + its wiring in sfx.mjs and sfx-core.mjs). Each group names what it holds; the groups marked (engine) run the
// real lettering engine in node (scripts/letters/testenv.mjs, read only) with the invincible style the table uses.
//   THUNDER  a close strike's word (unlocated, at the edge toward the strike) at steps 1 / 2 / 3 on several screens with a GM's usual
//            panels: today's rule ran it off the view and under the panels; now its whole reach stays in the view and its box off them
//   REACH    the placement box with the entrance reach factor holds what the engine keeps in the view (its reach)
//   FIT      the pure fitting: free runs, today's spot kept when clean, the nearest clean spot, smaller only when nothing holds it
//   PINS     note pins are obstacles like tokens; with no pins the placement is today's, decision for decision (base commit)
//   LADDER   a step-3 word that finds no clean place takes a smaller size, never under today's; at step 2 nothing changes
//   RIDE     a blast's wave word rides inside the view and off the panels; a clean way is today's
//   BURN     one fire's spots never stand on each other; a small fire is crowded by the bigger phrases; today's spots kept where they fit
//   STEP2    today's step is today's picture wherever it was not broken (the pure parts, against the base commit)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as FIT from "../scripts/sfx/sfx-fit.mjs";
import * as C from "../scripts/sfx/sfx-core.mjs";
import * as EV from "../scripts/sfx/sfx-events.mjs";
import * as SZ from "../scripts/sfx/sfx-size.mjs";
import * as SEAT from "../scripts/sfx/sfx-seat.mjs";
import { sizeFor } from "../scripts/letters/size.mjs";
import { revTree } from "./lib/baseline.mjs";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const failed = [];
const group = async (id, fn) => { try { await fn(); } catch ( err ) { failed.push(`${id}: ${String(err?.message ?? err).split(/\r?\n/)[0]}`); } };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// (MAPSFXSEAT: the runtime is sfx.mjs + its table planning sfx-table.mjs, split out so two simulated seats can run it: dev/sfx-seat.test.mjs)
const sfx = fs.readFileSync(path.join(root, "scripts/sfx/sfx.mjs"), "utf8") + fs.readFileSync(path.join(root, "scripts/sfx/sfx-table.mjs"), "utf8");
const seatSrc = fs.readFileSync(path.join(root, "scripts/sfx/sfx-seat.mjs"), "utf8");
const V = !!process.env.THUNDERFIT_VERBOSE;
const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const inter = (a, b) => area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
const boxAt = (x, y, w, h) => ({ x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 });
/** the base commit THUNDERFIT started from (tactics-zones after SFXSIZE): today's code */
const BASE = "ecb065d";
const base = revTree(root, BASE, "scripts/sfx", fs.mkdtempSync(path.join(os.tmpdir(), "thunderfit-base-")));
const C0 = await import(pathToFileURL(path.join(base, "sfx-core.mjs")).href);

/** a GM's usual panels on a W x H window (client px; as on the evidence sheets: the controls column, the party portraits, the
    challenges panel top right, the collapsed sidebar, the hotbar, the chat input) */
const panels = (W, H) => [{ x0: 0, y0: 0, x1: 40, y1: H }, { x0: 45, y0: 0.27 * H, x1: 140, y1: 0.44 * H }, { x0: W - 190, y0: 0, x1: W - 30, y1: 0.16 * H },
  { x0: W - 30, y0: 0, x1: W, y1: H }, { x0: 0.13 * W, y0: H - 48, x1: 0.75 * W, y1: H }, { x0: W - 330, y0: H - 60, x1: W - 30, y1: H }];
const SCREENS = [[1366, 768], [1600, 900], [1920, 1080], [2560, 1440]];

/* ---------------------------------------------------------------- FIT (pure) */
await group("FIT", () => {
  ok(JSON.stringify(FIT.freeRuns([{ x0: 100, y0: 0, x1: 200, y1: 50 }, { x0: 150, y0: 0, x1: 300, y1: 50 }], 0, 1000, 10, 20)) === JSON.stringify([{ a: 0, b: 100 }, { a: 300, b: 1000 }]), "free runs between overlapping panels");
  ok(FIT.freeRuns([{ x0: 100, y0: 0, x1: 200, y1: 50 }], 0, 1000, 60, 80).length === 1, "a panel outside the band does not cut it");
  const view = { x0: 0, y0: 0, x1: 1600, y1: 900 }, ui = panels(1600, 900);
  // (today's spot is kept, exactly, when the word is clean there)
  const t = FIT.screenFit({ today: { x: 800, y: 300 }, want: { x: 700, y: 200 }, bw: 400, bh: 100, view, ui });
  ok(t.x === 800 && t.y === 300 && t.k === 1, "a clean spot of today stays today's");
  // (a word under the challenges panel moves off it, as big as it was, near where it should sound)
  const u = FIT.screenFit({ today: { x: 1450, y: 70 }, want: { x: 1450, y: 70 }, bw: 300, bh: 90, view, ui });
  ok(u.k === 1 && FIT.hitOf(boxAt(u.x, u.y, 300, 90), ui, null) === 0 && Math.hypot(u.x - 1450, u.y - 70) < 400, `a word under a panel moves off it, whole (${Math.round(u.x)},${Math.round(u.y)})`);
  // (a word too wide for any free stretch is made smaller, the largest share that fits clean)
  // (the free stretch of that band: between the controls column (to x 40) and the sidebar (from x 1570): 1530 px)
  const w = FIT.screenFit({ want: { x: 800, y: 200 }, bw: 1540, bh: 120, view, ui });
  ok(w.k < 1 && w.k >= 0.55 && w.hit === 0 && 1540 * w.k <= 1530, `a word wider than the free view is smaller (k ${w.k})`);
  ok(FIT.screenFit({ want: { x: 800, y: 200 }, bw: 1000, bh: 120, view, ui }).k === 1, "a word that fits keeps its size");
  // (the reach stays inside the view: a slam's contact pose)
  const r = FIT.screenFit({ want: { x: 1580, y: 20 }, bw: 600, bh: 120, rk: 1.36, view, ui: [] });
  ok(r.x + 600 * 1.36 / 2 <= 1600 - 16 + 1e-6 && r.y - 120 * 1.36 / 2 >= 16 - 1e-6, "the whole reach stays in the view");
  ok(FIT.viewFit(2000, 100, 1600, 900) < 0.8 && FIT.viewFit(500, 100, 1600, 900) === 1, "viewFit: a share only when wider than the view");
  // (the box formula is the one the placement always used: width x 1.08 + 0.3 cap, height x 1.12 + 0.25 cap)
  const b = FIT.wordBox({ w: 5, h: 1.4 }, 40);
  ok(Math.abs(b.bw - (5 * 40 * 1.08 + 40 * 0.3)) < 1e-9 && Math.abs(b.bh - (1.4 * 40 * 1.12 + 40 * 0.25)) < 1e-9, "wordBox = the placement's old box formula");
});

/* ---------------------------------------------------------------- PINS + STEP2 (pure placement vs the base commit) */
const rnd = (() => { let s = 7; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; })();
function scenario() {
  const view = { x0: 0, y0: 0, x1: 1600, y1: 900 }, ui = panels(1600, 900).map((q) => ({ ...q }));
  const cx = 100 + rnd() * 1400, cy = 80 + rnd() * 740, R = 40 + rnd() * 220, u = 20 + rnd() * 70;
  const S = { x0: cx - R, y0: cy - R, x1: cx + R, y1: cy + R };
  const main = { role: "main", text: "KA-BOOM!", chars: 8, x: cx, y: cy, t: 0, size: u, bw: u * (3 + rnd() * 6), bh: u * 1.7, subject: S, cover: 0.3, around: C.besideOf(rnd() < 0.5 ? -1 : 1) };
  const sats = Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => ({ role: "sec", text: "KRAK", chars: 4, x: cx + (rnd() - 0.5) * 3 * R, y: cy + (rnd() - 0.5) * 3 * R, t: 100 + i, size: u * 0.6, bw: u * 0.6 * (2 + rnd() * 3), bh: u, subject: null }));
  const tokens = Array.from({ length: Math.floor(rnd() * 5) }, () => { const x = rnd() * 1600, y = rnd() * 900; return { x0: x, y0: y, x1: x + 100, y1: y + 100 }; });
  const aliveB = Array.from({ length: Math.floor(rnd() * 3) }, () => { const x = rnd() * 1500, y = rnd() * 850; return { x0: x, y0: y, x1: x + 200, y1: y + 60 }; });
  return { specs: [main, ...sats], ctx: { view, ui, tokens, alive: aliveB } };
}
const sig = (r) => JSON.stringify(r.map((q) => [q.role, q.t, Math.round(q.x * 1000), Math.round(q.y * 1000), Math.round(q.pen?.pen * 1e6)]));
await group("STEP2", () => {
  let same = 0;
  for ( let i = 0; i < 1500; i++ ) {
    const { specs, ctx } = scenario();
    const a = C0.place(specs, ctx), b = C.place(specs, ctx), c = C.place(specs, { ...ctx, pins: [] });
    const d = FIT.ladderPlace(specs, ctx, { place: C.place, grows: () => false });
    if ( sig(a) === sig(b) && sig(a) === sig(c) && sig(a) === sig(d) ) same++;
  }
  ok(same === 1500, `without pins the placement (and the ladder at today's step) decides as the base commit ${BASE}: ${same} of 1500`);
  // (the burning fires' crowding: the same answer as the base commit when the spots carry no size of their own)
  let bs = 0;
  for ( let i = 0; i < 400; i++ ) {
    const pts = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => ({ x: rnd() * 3000, y: rnd() * 2000 })), taken = Array.from({ length: Math.floor(rnd() * 6) }, () => ({ x: rnd() * 3000, y: rnd() * 2000 }));
    const em = 20 + rnd() * 120;
    if ( C0.burnCrowded(pts, taken, em) === C.burnCrowded(pts, taken, em) ) bs++;
  }
  ok(bs === 400, "burnCrowded with plain spots = the base commit");
  ok(/const b = FIT\.wordBox\(hb, u\);\n\s*w\.bw = b\.bw; w\.bh = b\.bh;/.test(sfx) && /const md = measureOf\(w\.text, o, d\), hd = md \?\? holdOf\(w\.text, o, d\), hb = hd \?\? FIT\.estHold/.test(sfx), "measure boxes a word as before (the engine's hold box: L.measure, else L.planFor)");
});
await group("PINS", () => {
  let avoided = 0, freeExists = 0, satOnPin = 0, mains = 0;
  for ( let i = 0; i < 1200; i++ ) {
    const { specs, ctx } = scenario();
    const m = specs[0];
    // (a pin just beside the subject, where the main word would go)
    const px = (m.subject.x1 + m.bw * 0.3), py = (m.subject.y0 + m.subject.y1) / 2;
    const pins = [{ x0: px - 25, y0: py - 55, x1: px + 25, y1: py + 5 }];
    const r = C.place(specs, { ...ctx, pins });
    for ( const q of r ) if ( q.role !== "main" && pins.some((p) => inter(q.box, p) > 0) ) satOnPin++;
    const mm = r.find((q) => q.role === "main"); if ( !mm ) continue;
    mains++;
    // (is there a clean place for the main word at all, pins counted? then it must take one off the pins)
    const r2 = C.place([{ ...m, role: "main" }], { ...ctx, alive: [], pins });
    if ( r2[0] && FIT.isClean(r2[0].pen) ) { freeExists++; if ( !pins.some((p) => inter(r2[0].box, p) > 0) ) avoided++; }
  }
  ok(satOnPin === 0, "a side word is never laid over a pin (it is dropped or moved)");
  ok(freeExists > 100 && avoided === freeExists, `a main word with a clean place keeps off the pins: ${avoided} of ${freeExists} (${mains} placed)`);
  // (MAPSFXSEAT: the TABLE placement gets the pins every seat counts; an unlocated word keeps off this seat's own pins on its screen)
  ok(/return \{ view: v, ui: \[\], tokens: d\.tokens\?\.\(v\) \?\? \[\], pins: d\.pins\?\.\(v\) \?\? \[\], alive: d\.ledger\.boxes\(t0, t1, skip\) \};/.test(sfx) && /tokens: sharedTokens, pins: sharedPins,/.test(sfx) && /pins: pinRects\(\), zoom: 1 \}\)/.test(sfx), "every placement of the runtime gets the pins");
  // (MAPSFXSEAT2: an unlocated word's seat layout takes the pins as pins - seatLayout's `pins`, no longer appended to its panels)
  ok(/if \( !n\.visible \|\| n\.destroyed \) continue;/.test(sfx) && /if \( !SEAT\.sharedPin\(players, /.test(sfx), "a pin a seat does not see is no obstacle (nothing of a hidden note shows in a player's placement: the table counts only pins every player may see)");
});

/* ---------------------------------------------------------------- LADDER (pure) */
await group("LADDER", () => {
  let tried = 0, cleanAt3 = 0, cleanAny = 0, neverSmaller = true, dropsBefore = 0, dropsAfter = 0;
  for ( let i = 0; i < 1500; i++ ) {
    const { specs, ctx } = scenario();
    const pins = [{ x0: specs[0].x + 30, y0: specs[0].y - 60, x1: specs[0].x + 80, y1: specs[0].y }];
    const today = specs.map((w) => ({ ...w })), K = 1.4;
    // (the stepped words: 1.4 x today's box; the ladder's share f keeps that part of the extra size)
    const grown = (w, f) => ({ ...w, fitK: f, bw: w.bw0 * (1 + (K - 1) * f), bh: w.bh0 * (1 + (K - 1) * f) });
    const s3 = today.map((w) => grown({ ...w, bw0: w.bw, bh0: w.bh }, 1));
    const c = { ...ctx, pins };
    const plain = C.place(s3, c), r = FIT.ladderPlace(s3, c, { place: C.place, grows: () => true, resize: grown });
    tried++;
    dropsBefore += s3.length - plain.length; dropsAfter += s3.length - r.length;
    for ( const q of r ) if ( (q.fitK ?? 1) < 0 ) neverSmaller = false;
    const m = r.find((q) => q.role === "main"), m0 = C.place(today, c).find((q) => q.role === "main");
    if ( m0 && FIT.isClean(m0.pen) ) { cleanAny++; if ( m && FIT.isClean(m.pen) ) cleanAt3++; }
  }
  ok(neverSmaller, "never under today's size");
  ok(cleanAt3 === cleanAny, `where today's size has a clean place for the main word, step 3 finds one too: ${cleanAt3} of ${cleanAny}`);
  ok(dropsAfter <= dropsBefore && dropsAfter < dropsBefore, `fewer side words dropped at step 3: ${dropsBefore} -> ${dropsAfter} of the scenarios' words`);
  ok(/function placeFit\(specs, ctx, d\) \{\n  return FIT\.ladderPlace\(specs, ctx, \{ place: C\.place, grows: \(w\) => !!w\.text && !w\.stream && !w\.path && d\.step\(grpOf\(w\)\) > SZ\.SIZE_DEFAULT,/.test(sfx), "only a word at a BIGGER step than today's climbs down the ladder");
  ok(/px = s > SZ\.SIZE_DEFAULT && Number\.isFinite\(fitK\) && fitK < 1 \? px \+ \(st - px\) \* Math\.max\(0, fitK\) : st;/.test(seatSrc), "the ladder's share is a share of the EXTRA size (0 = the table's step-2 size; sfx-seat tableSize)");
  if ( V ) console.log("LADDER", { tried, cleanAt3, cleanAny, dropsBefore, dropsAfter });
});

/* ---------------------------------------------------------------- RIDE (pure): a wave word's way */
await group("RIDE", () => {
  const v = { x0: 1000, y0: 1000, x1: 2600, y1: 1900 }, ui = [{ x0: 1000, y0: 1000, x1: 1088, y1: 1900 }];
  // (a way inside the view and off the panels is today's, the same array)
  const clean = [{ x: 1800, y: 1400, ms: 0 }, { x: 1600, y: 1400, ms: 300 }, { x: 1500, y: 1400, ms: 400 }];
  ok(FIT.rideFit(clean, v, ui, 300, 80, 1.15, 16) === clean, "a clean way is left as it is");
  // (live: the wave rode out to the left past the edge and under the controls column)
  const out = [{ x: 1800, y: 1400, ms: 0 }, { x: 1250, y: 1400, ms: 300 }, { x: 1050, y: 1400, ms: 400 }];
  const r = FIT.rideFit(out, v, ui, 300, 80, 1.15, 16);
  ok(r.every((q) => q.x - 300 * 1.15 / 2 >= v.x0 + 16 - 1e-6 && FIT.hitOf({ x0: q.x - 150, y0: q.y - 40, x1: q.x + 150, y1: q.y + 40 }, ui, null) === 0), "a way past the edge and under a panel is held inside the view, off the panel");
  ok(r.map((q) => q.ms).join() === "0,300,400" && r[2].x < r[0].x, "its times and its direction are kept");
  // (MAPSFXSEAT: on the table - the reference view, the shared pins, the table's main word and words up; the seat rule then moves the
  // whole way off this seat's panels; its reach is the engine's own measure of the word)
  ok(/const avoid = \[\.\.\.\(env\.mainBox \? \[env\.mainBox\] : \[\]\), \.\.\.upNow\(\), \.\.\.env\.pins\];/.test(sfx) && /spec\.path = FIT\.rideFit\(wr\.ride, vw, avoid, spec\.bw \?\? G, spec\.bh \?\? G \* 0\.4, spec\.rk \?\? FIT\.REACH\.other, FIT\.EDGE \/ z\);/.test(sfx), "the runtime fits the wave's way (off the pins, the main word, the words up; its measured reach)");
  ok(/\.\.\.ledger\.boxes\(sharedNow\(\), sharedNow\(\) \+ 1000\), \.\.\.pinBoxes\(v\)\], em = burnSize/.test(sfx), "a burning fire's spots keep off the pins");
  ok(/PG\.waveRide\(w\.wave\.at, w\.wave\.r0, w\.wave\.reach, w\.wave\.rim, \{ avoid, /.test(sfx), "the wave's way is chosen off the pins");
  // (MAPSFXSEAT, live at step 3: the wave word crossed the map pin BETWEEN two clean points of its way - the box is checked along it)
  const pin = { x0: 1500, y0: 1370, x1: 1560, y1: 1430 };
  const cross = [{ x: 1800, y: 1400, ms: 0 }, { x: 1250, y: 1400, ms: 300 }, { x: 1150, y: 1400, ms: 400 }];
  const along = (pth) => { for ( let i = 1; i < pth.length; i++ ) for ( let k = 0; k <= 20; k++ ) { const f = k / 20, x = pth[i - 1].x + (pth[i].x - pth[i - 1].x) * f, y = pth[i - 1].y + (pth[i].y - pth[i - 1].y) * f;
    if ( FIT.hitOf({ x0: x - 150, y0: y - 40, x1: x + 150, y1: y + 40 }, [pin], null) > 0 ) return true; } return false; };
  ok(along(cross), "the way as planned crosses the pin between its clean points");
  const rc = FIT.rideFit(cross, v, [pin], 300, 80, 1.15, 16);
  ok(rc.slice(1).every((q, i) => { const a = rc[i]; for ( let k = 1; k <= FIT.RIDE_SAMPLES; k++ ) { const f = k / FIT.RIDE_SAMPLES; if ( FIT.hitOf({ x0: a.x + (q.x - a.x) * f - 150, y0: a.y + (q.y - a.y) * f - 40, x1: a.x + (q.x - a.x) * f + 150, y1: a.y + (q.y - a.y) * f + 40 }, [pin], null) > 0 ) return false; } return true; }) || FIT.hitOf({ x0: rc[0].x - 150, y0: rc[0].y - 40, x1: rc[0].x + 150, y1: rc[0].y + 40 }, [pin], null) > 0,
    "a way whose points are clean but whose box crosses a pin between them is drawn back off the pin (checked along the way)");
  // (the ladder with no clean size takes the size that covers least, not the biggest)
  const pen = (p) => ({ off: 0, pui: p, tok: 0, pin: 0, wrd: 0, sub: 0, pen: p });
  const fake = (specs) => specs.map((w) => ({ ...w, pen: pen(w.fitK === undefined ? 0.6 : w.fitK > 0.4 ? 0.4 : 0.1) }));
  const r2 = FIT.ladderPlace([{ role: "main", text: "KA-BOOM" }], {}, { place: fake, grows: () => true, resize: (w, f) => ({ ...w, fitK: f }) });
  ok(r2[0].fitK === 0, "a step-3 main word with no clean place anywhere stands at the size that covers least");
  // (MAPSFXSEAT2: seatLayout's `pins`, beside this seat's panels and the screen words still up on it)
  ok(/panels: \[\.\.\.\(uiCache\.rects \?\? \[\]\), \.\.\.screenUp\.filter\(/.test(sfx) && /pins: pinRects\(\), zoom: 1 \}\)/.test(sfx), "an unlocated word keeps off the map's pins too (this seat's: the seat rule)");
  // (MAPSFXSEAT: with no clean size the BIGGEST size within LADDER_SLACK of the least covering one - not today's size by default)
  const fake2 = (specs) => specs.map((w) => ({ ...w, pen: pen(w.fitK === undefined ? 0.45 : w.fitK > 0.4 ? 0.42 : 0.4) }));
  ok(FIT.ladderPlace([{ role: "main", text: "KA-BOOM" }], {}, { place: fake2, grows: () => true, resize: (w, f) => ({ ...w, fitK: f }) })[0].fitK === undefined, "a step-3 main word with no clean place keeps its stepped size when it covers barely more than today's");
});

/* ---------------------------------------------------------------- BURN (pure) */
await group("BURN", () => {
  // (spots along a path: kept spots' phrase areas never meet)
  let bad = 0, kept = 0, all = 0;
  for ( let i = 0; i < 600; i++ ) {
    const em = 15 + rnd() * 150, nP = 1 + Math.floor(rnd() * 3), L = (2 + rnd() * 16) * 100;
    const pts = Array.from({ length: nP }, (_, j) => ({ x: 1000 + (nP === 1 ? 0.5 : (j + 0.5) / nP) * L, y: 1000 + rnd() * 80 }));
    const idx = C.burnSpots(pts, em);
    all += pts.length; kept += idx.length;
    for ( let a = 0; a < idx.length; a++ ) for ( let b = a + 1; b < idx.length; b++ ) {
      const p = pts[idx[a]], q = pts[idx[b]];
      if ( Math.abs(p.x - q.x) < em * C.BURN_OWN.w && Math.abs(p.y - q.y) < em * C.BURN_OWN.h ) bad++;
    }
    ok(idx[0] === 0, "the first spot (the one riding the flame front) always stays");
  }
  ok(bad === 0, "no two kept spots of one fire stand on each other");
  ok(kept < all, `crowded spots are heard in the kept ones: ${kept} of ${all}`);
  // (today's spots of a burning fire at zoom 1: a six-square path, its letters 3.5-6.5 % of a 900 px view: all its spots stay)
  for ( const cap of [0.035 * 900, 0.065 * 900] ) {
    const em = cap * 1.25, pts = [0.75, 0.25].map((f) => ({ x: 1000 + f * 1200, y: 1000 }));
    ok(C.burnSpots(pts, em).length === 2, `a 12-square fire keeps both spots at zoom 1 (letters ${cap.toFixed(0)} px)`);
  }
  // (two fires: the smaller one is crowded by the bigger one's phrases)
  ok(C.burnCrowded([{ x: 1300, y: 1000 }], [{ x: 1000, y: 1000, em: 60 }], 20) && !C.burnCrowded([{ x: 1300, y: 1000 }], [{ x: 1000, y: 1000 }], 20), "a small fire is crowded by the BIGGER phrases");
  ok(/const idx = C\.burnSpots\(all, em\), pts = idx\.map\(\(i\) => all\[i\]\);/.test(sfx) && /spots\.push\(\.\.\.pts\.map\(\(q\) => \(\{ x: q\.x, y: q\.y, em \}\)\)\);/.test(sfx), "the runtime letters only the kept spots and records their size");
  ok(/return \(idx \?\? p\.points\.map\(\(_, i\) => i\)\)\.map\(\(i\) => \{/.test(sfx) && /seed: `\$\{seed\}\|\$\{i\}`/.test(sfx), "a kept spot keeps its own seed (the same phrases as today)");
  ok(/if \( d\.dx \|\| d\.dy \) ui\.push\(/.test(sfx), "a spot moved off a panel keeps off the next spot");
});

/* ---------------------------------------------------------------- the engine in node */
const { setup } = await import(pathToFileURL(path.join(root, "scripts/letters/testenv.mjs")).href);
const E = await setup({ gm: true });
const L = E.engine; L.lookStyle("invincible");
const hold = (text, o) => { const p = L._plan(text, o); L._settle(p); return { w: p._holdBox.w, h: p._holdBox.h, sk: p.sizeK }; };

await group("REACH", async () => {
  // MAPSFXSEAT: the map takes each word's reach from the ENGINE's own measure (L.measure, LETR 1.9.11) - its whole entrance and hold - and
  // fits that (FIT.reachFactor). The reach the engine then keeps in the view when it plays the word (h.reach) is that same reach, and the
  // map's fit holds it. Before, a factor per entrance (FIT.REACH) stood in for it and went stale: since LETR 1.9.10 a held word moves while
  // it stands, and a debris word reached 1.14 x 1.18 of its box, over the 1.15 of its factor (the trunk went red on exactly that).
  const words = [["thunder", { loud: 0.96, prefix: true }, "slam"], ["thunder", { loud: 0.72 }, "slam"], ["thunder", { loud: 0.32, long: 0.6 }, "grow"], ["rumble", { loud: 0.15, long: 0.8 }, "grow"],
    ["boom", { loud: 1, prefix: true }, "slam"], ["grenade", { loud: 0.7 }, "slam"], ["debris", { pieces: "large", material: "earth", loud: 0.5 }, "pop"], ["fire", { stage: "ignite", loud: 0.5 }, "rise"],
    ["fire", { stage: "out", loud: 0.3, long: 0.6 }, "pop"], ["shockwave", { loud: 0.7, long: 0.5 }, "grow"], ["zap", { loud: 0.2 }, "pop"]];
  let stale = 0, cases = 0;
  for ( const [kind, wo, inn] of words ) for ( const seed of ["a", "b", "c"] ) for ( const lang of ["en", "pl"] ) {
    const w = L.word(kind, { ...wo, seed, lang });
    const o = { ...w.play, in: inn, space: "screen", size: 60, fit: "screen", seed, at: { x: 800, y: 450 }, reduced: false };
    const m = L.measure(w.text, o), u = m.unit;
    const hb = { w: m.hold.w / u, h: m.hold.h / u }, reach = { l: m.reach.l / u, r: m.reach.r / u, u: m.reach.u / u, d: m.reach.d / u };
    const rk = FIT.reachFactor(hb, reach), b = FIT.wordBox(hb, 1);
    const h = L.play(w.text, o);
    await E.tick(120);
    const e = h.reach, k = h.size * h.plan.sizeK;
    cases++;
    // (the engine keeps exactly the measured reach in the view: the map's numbers are the engine's)
    ok(["l", "r", "u", "d"].every((s2) => Math.abs(e[s2] * k - m.reach[s2]) <= 1e-6 * Math.max(1, m.reach[s2])), `${kind} ${w.text} (${inn}): the reach the engine keeps in view is its measured reach`);
    // (and the map's fit factor holds it, on both axes)
    ok((e.l + e.r) / b.bw <= rk + 1e-9 && (e.u + e.d) / b.bh <= rk + 1e-9, `${kind} ${w.text} (${inn}): the map's measured reach factor ${rk.toFixed(2)} holds the engine's reach`);
    if ( (e.l + e.r) / b.bw > FIT.reachOf(inn) + 1e-6 || (e.u + e.d) / b.bh > FIT.reachOf(inn) + 1e-6 ) stale++;
    h.stop({ quick: true }); await E.tick(40);
  }
  ok(/w\.reachU = md\?\.reach \?\? null; w\.rk = md \? FIT\.reachFactor\(hb, md\.reach\) : FIT\.reachOf\(o\.in\);/.test(sfx) && /const m = d\.L\?\.measure\?\.\(text, \{ \.\.\.o, reduced: false/.test(sfx), "the runtime takes every world word's reach from L.measure (the factor only on an engine without it)");
  ok(/const rk = reach \? FIT\.reachFactor\(hold, reach\) : FIT\.reachOf\(stageIn\)/.test(seatSrc), "and every unlocated word's");
  if ( V ) console.log("REACH", { cases, overTheOldFactor: stale });
});

await group("THUNDER", async () => {
  // A close strike beyond the view: its word at the edge toward it, rank 5 (level 3) or 4, at every step, on four screens, on a GM's seat
  // with his usual panels and on a player's with none. MAPSFXSEAT: laid out ONCE in the reference window (sfx-seat screenLayout: the rank's
  // share of the reference height, the engine's measured reach, off the shared panel zones), then drawn by the seat rule (seatScreen: the
  // reference window centred, shifted off this seat's panels, smaller only when its reach is bigger than this window). Before, every seat
  // sized it by its own height and shrank it around its own panels: the GM's word was smaller than the player's (defect 3).
  let before = 0, after = 0, cases = 0, sizeOrder = 0, sameSeats = 0, seatPairs = 0, fitOnly = 0;
  const drawn = (ref, s3) => {
    const f = s3.k, cx = s3.at.x, cy = s3.at.y, dx = cx - ref.x, dy = cy - ref.y;
    const sc = (b) => ({ x0: cx + (b.x0 + dx - cx) * f, x1: cx + (b.x1 + dx - cx) * f, y0: cy + (b.y0 + dy - cy) * f, y1: cy + (b.y1 + dy - cy) * f });
    return { box: sc(ref.box), reach: sc(ref.reach) };
  };
  for ( const [W, H] of SCREENS ) {
    globalThis.innerWidth = W; globalThis.innerHeight = H;
    const ui = panels(W, H);
    for ( const dir of [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] ) for ( const lv of [1, 2, 3] ) for ( const seed of ["s1", "s2"] ) {
      const v = { x0: 0, y0: 0, x1: W, y1: H };
      const place = { x: W / 2 + dir[0] * W, y: H / 2 + dir[1] * H };
      const fw = EV.flashWord({ kind: "close", k: 7, t: 1000, lv, strokes: [1] }, place, v, seed);
      const word = L.word("thunder", { ...fw.wo, seed: `${seed}|${fw.seed}`, lang: seed === "s1" ? "en" : "pl" });
      const o0 = { ...word.play, in: "slam", holdKind: "rattle", space: "screen", seed: fw.seed, reduced: false };
      const sizes = [];
      for ( const step of [1, 2, 3] ) {
        cases++;
        // (today, before THUNDERFIT: the box of the WORLD word, the screen word at its rank's share of THIS view's height, its spot clamped)
        const hb = hold(word.text, o0);
        const zw = L.sizeOf(word.text, { ...word.play, space: "world", size: EV.rankSize(fw.rank, H), ceilK: 1, magnitude: 1.5 });
        const ob = FIT.wordBox(hb, zw.size * hb.sk);
        let bw = ob.bw, bh = ob.bh;
        const o = { ...o0, size: EV.rankSize(fw.rank, H), fit: "screen" };
        if ( step !== 2 ) {
          const s0 = o.size;
          const loud = L.sizeOf(word.text, { ...o, fit: "legible", size: 20 * H, scale: 1, ceilK: 1, magnitude: SZ.LOUD_MAG }).px / L.sizeModel.hardHi;
          o.size = SZ.screenSizeAt(s0, step, step > 2 ? loud : 0, hb.sk);
          bw *= o.size / s0; bh *= o.size / s0;
        }
        const fx = bw * 0.5 + 16, fy = bh * 0.75 + 16;
        const today = { x: Math.min(Math.max(fw.screen.fx * W, fx), Math.max(fx, W - fx)), y: Math.min(Math.max(fw.screen.fy * H, fy), Math.max(fy, H - fy)) };
        const real = FIT.wordBox(hb, o.size * hb.sk), rk0 = FIT.reachOf("slam");
        const r0 = boxAt(today.x, today.y, real.bw * rk0, real.bh * rk0), b0 = boxAt(today.x, today.y, real.bw, real.bh);
        if ( area(r0) - inter(r0, { x0: 16, y0: 16, x1: W - 16, y1: H - 16 }) > 1 || ui.some((q) => inter(b0, q) > 1) ) before++;
        // (now: the table's layout - the same call on every seat - then the seat rule on the GM's seat and on a player's)
        const plan = { sizeK: hb.sk, hold: { w: hb.w } };
        const so = { ...o0, size: EV.rankSize(fw.rank, SEAT.REF_VH), fit: "screen" };
        const size = SEAT.tableScreenSize(sizeFor, L.sizeModel, so, plan, step);
        const m = L.measure(word.text, { ...so, size, at: { x: 0, y: 0 } }), u = m.unit;
        const ref = SEAT.screenLayout({ hold: { w: m.hold.w / u, h: m.hold.h / u }, reach: { l: m.reach.l / u, r: m.reach.r / u, u: m.reach.u / u, d: m.reach.d / u }, cap: size * m.sizeK, fixed: fw.screen });
        const gm = SEAT.seatScreen(ref, { W, H, panels: ui }), pl = SEAT.seatScreen(ref, { W, H, panels: [] });
        const g = drawn(ref, gm);
        const out = area(g.reach) - inter(g.reach, { x0: 15, y0: 15, x1: W - 15, y1: H - 15 }) > 1, under = ui.some((q) => inter(g.box, q) > 1);
        if ( out || under ) { after++; if ( V ) console.log("still bad", W, H, dir, lv, step, word.text, gm.fit.rules, out, under); }
        // (the GM with his panels and a player with none draw it the SAME size: only the "fit" rule - its reach bigger than the window -
        // may make it smaller, the same on both: a window, not panels)
        seatPairs++;
        if ( Math.abs(gm.k - pl.k) < 1e-9 ) sameSeats++;
        if ( gm.k < 1 && !gm.fit.rules.includes("fit") ) fitOnly++;
        sizes.push(size * ref.k * gm.k);
        // (the engine draws it there: no shift of its own - its whole reach is inside the window)
        if ( step === 2 && seed === "s1" && (dir[0] + dir[1]) % 2 === 0 ) {
          const h = L.play(word.text, { ...so, size: size * ref.k * gm.k, at: gm.at });
          await E.tick(120);
          ok(h.lastPos && Math.hypot(h.lastPos.x - gm.at.x, h.lastPos.y - gm.at.y) < 2, `${W}x${H} the engine keeps the fitted word where it was put (${word.text})`);
          h.stop({ quick: true }); await E.tick(30);
        }
      }
      if ( sizes[0] <= sizes[1] * 1.005 && sizes[1] <= sizes[2] * 1.005 ) sizeOrder++; else if ( V ) console.log("order", W, H, dir, lv, word.text, sizes.map((q) => q.toFixed(1)));
    }
  }
  ok(before > 0, `today's rule: the close strike's word ran off the view or under the panels in ${before} of ${cases} cases`);
  ok(after === 0, `now: whole inside the view and off the GM's panels in every case (${after} of ${cases} not)`);
  ok(sameSeats === seatPairs && fitOnly === 0, `the GM's seat and a player's draw it the same size (${sameSeats} of ${seatPairs}); smaller only by the window's fit rule`);
  ok(sizeOrder === cases / 3, `step 1 <= step 2 <= step 3 (within the fit's half-percent search) for every flash and screen: ${sizeOrder} of ${cases / 3}`);
  if ( V ) console.log("THUNDER", { cases, before, after });
  ok(/const ref = screenPlace\(spec\.text, o, fixed, spec\.seed\);/.test(sfx) && /return SEAT\.screenLayout\(\{ hold: hd, reach: md\?\.reach \?\? null, /.test(sfx) && /const f = SEAT\.seatLayout\(\[item\], \{ view: \{ x0: 0, y0: 0, x1: W, y1: H \}, /.test(sfx), "the runtime lays out and draws every unlocated word this way");
  // (MAPSFXSEAT2: the reference layout centred in this window, then this seat's size - sfx-table screenCaps - laid out by seatLayout; was seatScreen)
});
globalThis.innerWidth = 1600; globalThis.innerHeight = 900;
fs.rmSync(base, { recursive: true, force: true });

if ( failed.length ) { console.error(failed.join("\n")); console.error(`sfx-fit: ${failed.length} group(s) failed, ${n} checks passed`); process.exit(1); }
console.log(`sfx-fit: ${n} checks passed`);
