// THUNDERFIT: every map sound word whole inside the view and clear of the panels, measured by what the engine will really draw
// (scripts/sfx/sfx-fit.mjs + its wiring in sfx.mjs and sfx-core.mjs). Each group names what it holds; the groups marked (engine) run the
// real lettering engine in node (scripts/letters/testenv.mjs, read only) with the invincible style the table uses.
//   THUNDER  a close strike's word (unlocated, at the edge toward the strike) at steps 1 / 2 / 3 on several screens with a GM's usual
//            panels: today's rule ran it off the view and under the panels; now its whole reach stays in the view and its box off them
//   REACH    the placement box with the entrance reach factor holds what the engine keeps in the view (its reach)
//   FIT      the pure fitting: free runs, today's spot kept when clean, the nearest clean spot, smaller only when nothing holds it
//   PINS     note pins are obstacles like tokens; with no pins the placement is today's, decision for decision (base commit)
//   LADDER   a step-3 word that finds no clean place takes a smaller size, never under today's; at step 2 nothing changes
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
import { revTree } from "./lib/baseline.mjs";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const failed = [];
const group = async (id, fn) => { try { await fn(); } catch ( err ) { failed.push(`${id}: ${String(err?.message ?? err).split(/\r?\n/)[0]}`); } };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sfx = fs.readFileSync(path.join(root, "scripts/sfx/sfx.mjs"), "utf8");
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
  ok(/const b = FIT\.wordBox\(hb, u\);\n\s*w\.bw = b\.bw; w\.bh = b\.bh;/.test(sfx) && /const hd = holdOf\(w\.text, o\), hb = hd \?\? FIT\.estHold/.test(sfx), "measure boxes a word as before (the engine's hold box, live from L.planFor)");
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
  ok(/pins: pinBoxes\(v\)/.test(sfx) && /const v = view\(\), tokens = tokenBoxes\(v\), ui = uiBoxes\(\), pins = pinBoxes\(v\);/.test(sfx) && /\{ view: v, ui, tokens, pins, alive:/.test(sfx), "every placement of the runtime gets this seat's pins");
  ok(/if \( !n\.visible \|\| n\.destroyed \) continue;/.test(sfx), "a pin this seat does not see is no obstacle (nothing of a hidden note shows in a player's placement)");
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
  ok(/function placeFit\(specs, ctx\) \{\n  return FIT\.ladderPlace\(specs, ctx, \{ place: C\.place, grows: \(w\) => !!w\.text && !w\.stream && !w\.path && stepFor\(grpOf\(w\)\) > SZ\.SIZE_DEFAULT,/.test(sfx), "only a word at a BIGGER step than today's climbs down the ladder");
  ok(/if \( step > SZ\.SIZE_DEFAULT && Number\.isFinite\(fitK\) && fitK < 1 \) px = z\.px \+ \(px - z\.px\) \* Math\.max\(0, fitK\);/.test(sfx), "the ladder's share is a share of the EXTRA size (0 = today's drawn size)");
  if ( V ) console.log("LADDER", { tried, cleanAt3, cleanAny, dropsBefore, dropsAfter });
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
  // (the map's words with their entrances: the engine's reach around the word / the placement box must stay under the REACH factor)
  const words = [["thunder", { loud: 0.96, prefix: true }, "slam"], ["thunder", { loud: 0.72 }, "slam"], ["thunder", { loud: 0.32, long: 0.6 }, "grow"], ["rumble", { loud: 0.15, long: 0.8 }, "grow"],
    ["boom", { loud: 1, prefix: true }, "slam"], ["grenade", { loud: 0.7 }, "slam"], ["debris", { pieces: "large", material: "earth", loud: 0.5 }, "pop"], ["fire", { stage: "ignite", loud: 0.5 }, "rise"],
    ["fire", { stage: "out", loud: 0.3, long: 0.6 }, "pop"], ["shockwave", { loud: 0.7, long: 0.5 }, "grow"], ["zap", { loud: 0.2 }, "pop"]];
  let worst = {};
  for ( const [kind, wo, inn] of words ) for ( const seed of ["a", "b", "c"] ) for ( const lang of ["en", "pl"] ) {
    const w = L.word(kind, { ...wo, seed, lang });
    const h = L.play(w.text, { ...w.play, in: inn, space: "screen", size: 60, fit: "screen", seed, at: { x: 800, y: 450 } });
    await E.tick(120);
    const e = h.reach, b = FIT.wordBox(h.plan._holdBox, 1), R = FIT.reachOf(inn);
    const rw = (e.l + e.r) / b.bw, rh = (e.u + e.d) / b.bh;
    worst[inn] = Math.max(worst[inn] ?? 0, rw, rh);
    ok(rw <= R + 1e-6 && rh <= R + 1e-6, `${kind} ${w.text} (${inn}): the engine's reach ${rw.toFixed(2)} x ${rh.toFixed(2)} of the box, under ${R}`);
    h.stop({ quick: true }); await E.tick(40);
  }
  if ( V ) console.log("REACH worst", worst);
});

await group("THUNDER", async () => {
  // a close strike beyond the view: its word at the edge toward it, rank 5 (level 3) or 4, at every step, on every screen
  const zoom = 1;
  let before = 0, after = 0, cases = 0, sizeOrder = 0, shrunkToday = 0;
  for ( const [W, H] of SCREENS ) {
    globalThis.innerWidth = W; globalThis.innerHeight = H;
    const ui = panels(W, H), view = { x0: 0, y0: 0, x1: W, y1: H - 0 };
    for ( const dir of [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] ) for ( const lv of [1, 2, 3] ) for ( const seed of ["s1", "s2"] ) {
      const v = { x0: 0, y0: 0, x1: W, y1: H };
      const place = { x: W / 2 + dir[0] * W, y: H / 2 + dir[1] * H };
      const fw = EV.flashWord({ kind: "close", k: 7, t: 1000, lv, strokes: [1] }, place, v, seed);
      const word = L.word("thunder", { ...fw.wo, seed: `${seed}|${fw.seed}`, lang: seed === "s1" ? "en" : "pl" });
      const o0 = { ...word.play, in: "slam", holdKind: "rattle", space: "screen", seed: fw.seed };
      const sizes = [];
      for ( const step of [1, 2, 3] ) {
        cases++;
        // (today: the box of the WORLD word - rank size in scene px, the engine's legibility clamp - times the zoom; the screen word
        // drawn at its rank's share of the view height, unclamped; the spot clamped by that box: sfx.mjs playScreen before THUNDERFIT)
        const hb = hold(word.text, o0);
        const zw = L.sizeOf(word.text, { ...word.play, space: "world", size: EV.rankSize(fw.rank, H / zoom), ceilK: 1, magnitude: 1.5 });
        const ob = FIT.wordBox(hb, zw.size * hb.sk);
        let bw = ob.bw * zoom, bh = ob.bh * zoom;
        const o = { ...o0, size: EV.rankSize(fw.rank, H), fit: "screen" };
        if ( step !== 2 ) {
          const s0 = o.size;
          const loud = L.sizeOf(word.text, { ...o, fit: "legible", size: 20 * H, scale: 1, ceilK: 1, magnitude: SZ.LOUD_MAG }).px / L.sizeModel.hardHi;
          o.size = SZ.screenSizeAt(s0, step, step > 2 ? loud : 0, hb.sk);
          bw *= o.size / s0; bh *= o.size / s0;
        }
        const fx = bw * 0.5 + 16, fy = bh * 0.75 + 16;
        const today = { x: Math.min(Math.max(fw.screen.fx * W, fx), Math.max(fx, W - fx)), y: Math.min(Math.max(fw.screen.fy * H, fy), Math.max(fy, H - fy)) };
        const real = FIT.wordBox(hb, o.size * hb.sk), rk = FIT.reachOf("slam");
        const bad = (x, y, k) => { const b = boxAt(x, y, real.bw * k, real.bh * k), r = boxAt(x, y, real.bw * k * rk, real.bh * k * rk);
          return area(r) - inter(r, { x0: 16, y0: 16, x1: W - 16, y1: H - 16 }) > 1 || ui.some((u) => inter(b, u) > 1); };
        if ( bad(today.x, today.y, 1) ) before++;
        // (now: sfx.mjs screenPlace)
        const kv = FIT.viewFit(real.bw * rk, real.bh * rk, W, H);
        const r = FIT.screenFit({ today: kv >= 1 ? today : null, want: { x: fw.screen.fx * W, y: fw.screen.fy * H }, bw: real.bw * kv, bh: real.bh * kv, rk, view, ui });
        const k = kv * r.k;
        if ( bad(r.x, r.y, k) ) { after++; if ( V ) console.log("still bad", W, H, dir, lv, step, word.text, k.toFixed(2)); }
        if ( step === 2 && k < 1 ) shrunkToday++;
        sizes.push(o.size * k);
        // (the engine draws it there: no shift of its own - its whole reach is inside the view)
        if ( step === 2 && seed === "s1" && (dir[0] + dir[1]) % 2 === 0 ) {
          const h = L.play(word.text, { ...o, size: o.size * k, at: { x: r.x, y: r.y } });
          await E.tick(120);
          ok(h.lastPos && Math.hypot(h.lastPos.x - r.x, h.lastPos.y - r.y) < 2, `${W}x${H} the engine keeps the fitted word where it was put (${word.text})`);
          h.stop({ quick: true }); await E.tick(30);
        }
      }
      if ( sizes[0] <= sizes[1] * 1.005 && sizes[1] <= sizes[2] * 1.005 ) sizeOrder++; else if ( V ) console.log("order", W, H, dir, lv, word.text, sizes.map((q) => q.toFixed(1)));
    }
  }
  ok(before > 0, `today's rule: the close strike's word ran off the view or under the panels in ${before} of ${cases} cases`);
  ok(after === 0, `now: whole inside the view and off the panels in every case (${after} of ${cases} not)`);
  ok(sizeOrder === cases / 3, `step 1 <= step 2 <= step 3 (within the fit's half-percent search) for every flash and screen: ${sizeOrder} of ${cases / 3}`);
  if ( V ) console.log("THUNDER", { cases, before, after, shrunkToday });
  ok(/const fit = screenPlace\(spec\.text, o, at, fixed\);/.test(sfx) && /const rk = FIT\.reachOf\(o\.in\), kv = FIT\.viewFit\(b\.bw \* rk, b\.bh \* rk, W, H\);/.test(sfx), "the runtime fits every unlocated word this way");
});
globalThis.innerWidth = 1600; globalThis.innerHeight = 900;
fs.rmSync(base, { recursive: true, force: true });

if ( failed.length ) { console.error(failed.join("\n")); console.error(`sfx-fit: ${failed.length} group(s) failed, ${n} checks passed`); process.exit(1); }
console.log(`sfx-fit: ${n} checks passed`);
