// MAPSAME: one table picture on every seat - the same side of the thing for EVERY word of a page, the size steps as drawn on every seat,
// and the seat layout's cost on a crowded view (scripts/sfx/sfx-seat.mjs seatLayout, scripts/sfx/sfx-table.mjs planPage / seatItems).
// The take's blast (The Warehouse, grid 350, the bomb page seed 777) on the take's two seats (GM 1600x900 at 0.6, Test Gracz 1 1366x768 at
// Foundry's largest zoom for that scene, 0.7314; their recorded panels and the bomb's pin) and a spread of windows and zooms, steps 1-3, on
// the real engine in node (scripts/letters/testenv.mjs). PREV = the trunk before (2208be5), where each check fails.
//   SIDE   every word a seat shows (standing words and riders) stands on the TABLE's side of what it letters (live 2026-11-15: the blast's
//          word down-left of the bomb on the GM's seat, right of it on the player's; the rising word right of the pin / above it)
//   ORDER  every word a seat shows at all three steps: step 1 < step 2 < step 3 as drawn, each at least MIN_GAIN apart unless the
//          legibility floor holds the lower one ("floor"); the same place at every step (live: step 3 = step 2, 185 / 186)
//   ROOM   a word drawn smaller than its step's own size on a seat: no clean spot on its side holds its envelope one size up (brute force
//          over the whole view: off the pin, inside the view, its subject's share, panels and earlier words at most an edge)
//   COST   the seat layout of the page on a crowded view (40 tokens, 6 pins, the GM's recorded panels): mean and worst single layout per
//          seat under a stated budget (the trunk: 7.4 / 9.5 / 13.9 ms live per step; before the series 0.5 - 1.5 ms)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { revTree } from "./lib/baseline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const PG = await imp("scripts/sfx/sfx-page.mjs");
const T = await imp("scripts/sfx/sfx-table.mjs"), SEAT = await imp("scripts/sfx/sfx-seat.mjs");
const PREV = revTree(root, "2208be5", "scripts/sfx", fs.mkdtempSync(path.join(os.tmpdir(), "mapsame-prev-")));
const PT = await import(pathToFileURL(path.join(PREV, "sfx-table.mjs")).href), PS = await import(pathToFileURL(path.join(PREV, "sfx-seat.mjs")).href);
const { setup } = await imp("scripts/letters/testenv.mjs");
const { sizeFor } = await imp("scripts/letters/size.mjs");
const PC = await imp("scripts/presets/core.mjs"), { BUILTIN } = await imp("scripts/presets/defs.mjs"), FM = await imp("scripts/fire/model.mjs");
const MC = await imp("scripts/presets/meteor-core.mjs"), { fallAt } = await imp("scripts/presets/landing-fx.mjs");
const E = await setup({ gm: true });
const L = E.engine; L.lookStyle("invincible");

let n = 0; const failed = [], V = !!process.env.SAME_VERBOSE;
const ok = (c, m) => { if ( c ) { n++; if ( V ) console.log("  ok", m); } else failed.push(m); };
const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const on = (a, b) => area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
const inkBox = (b, k) => { const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, hw = ((b.x1 - b.x0) * k[0]) / 2, hh = ((b.y1 - b.y0) * k[1]) / 2; return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh }; };
const sideOf = (b, s) => { const r = SEAT.sideOfBox(b, s); return r ? `${r.x},${r.y}` : "over"; };

// ---- the take (as dev/sfx-seat.test.mjs SEAT2)
const REC_UI = {
  gm: [[1232,48,1542,159],[1232,165,1542,276],[16,792,216,884],[1236,826,1536,886],[0,534,196,612],[0,618,196,696],[0,702,196,780],[96,92,360,144],[104,16,274,48],[219,858,368,890],[95,500,226,528],[450,824,510,884],[518,824,578,884],[586,824,646,884],[654,824,714,884],[722,824,782,884],[790,824,850,884],[858,824,918,884],[926,824,986,884],[994,824,1054,884],[1062,824,1122,884],[1432,11,1540,39],[16,16,48,48],[16,56,48,88],[16,96,48,128],[16,136,48,168],[16,176,48,208],[16,216,48,248],[16,256,48,288],[16,296,48,328],[16,336,48,368],[16,376,48,408],[16,416,48,448],[16,456,48,488],[16,496,48,528],[56,16,88,48],[56,56,88,88],[56,96,88,128],[56,136,88,168],[56,176,88,208],[56,216,88,248],[56,256,88,288],[56,296,88,328],[1552,726,1584,758],[1552,758,1584,790],[1552,790,1584,822],[1552,822,1584,854],[1552,854,1584,886],[1552,16,1584,48],[1552,56,1584,88],[1552,96,1584,128],[1552,136,1584,168],[1552,176,1584,208],[1552,216,1584,248],[1552,256,1584,288],[1552,296,1584,328],[1552,336,1584,368],[1552,376,1584,408],[1552,416,1584,448],[1552,456,1584,488],[1552,496,1584,528],[1552,536,1584,568],[1552,576,1584,608],[234,500,264,528],[280,20,304,44],[418,827,442,851],[418,857,442,881],[1130,824,1154,848],[1130,860,1154,884],[1158,828,1182,852],[1158,856,1182,880],[1132,844,1152,864]],
  p1: [[998,48,1308,158],[998,164,1308,274],[16,660,216,752],[1002,694,1302,754],[0,380,100,458],[0,464,100,542],[0,548,100,626],[104,16,274,48],[0,346,130,374],[503,624,563,684],[571,624,631,684],[639,624,699,684],[707,624,767,684],[775,624,835,684],[503,692,563,752],[571,692,631,752],[639,692,699,752],[707,692,767,752],[775,692,835,752],[1198,11,1306,39],[16,16,48,48],[16,56,48,88],[16,96,48,128],[16,136,48,168],[16,176,48,208],[16,216,48,248],[56,16,88,48],[56,56,88,88],[56,96,88,128],[56,136,88,168],[56,176,88,208],[1318,594,1350,626],[1318,626,1350,658],[1318,658,1350,690],[1318,690,1350,722],[1318,722,1350,754],[1318,16,1350,48],[1318,56,1350,88],[1318,96,1350,128],[1318,136,1350,168],[1318,176,1350,208],[1318,216,1350,248],[1318,256,1350,288],[1318,296,1350,328],[1318,336,1350,368],[1318,376,1350,408],[1318,416,1350,448],[1318,456,1350,488],[1318,496,1350,528],[1318,536,1350,568],[138,346,168,374],[280,20,304,44],[471,661,495,685],[471,691,495,715],[843,658,867,682],[843,694,867,718],[871,662,895,686],[871,690,895,714],[845,678,865,698]]
};
const WG = 350, BOMB = { x: 2555, y: 3885 }, CAM = { x: 2555, y: 3780 };
const PIN = { x0: 2111, y0: 3468, x1: 2439, y1: 3879 };
const REC = { gm: { name: "gm", W: 1600, H: 900, z: 0.6, ui: REC_UI.gm }, p1: { name: "p1", W: 1366, H: 768, z: 0.7314285714285714, ui: REC_UI.p1 } };
const panelsOf = (W, H) => [[0, 0, 40, H], [45, 0.27 * H, 140, 0.44 * H], [W - 190, 0, W - 30, 0.16 * H], [W - 30, 0, W, H], [0.13 * W, H - 48, 0.75 * W, H], [W - 330, H - 60, W - 30, H]];
const SPREAD = [];
for ( const [W, H] of [[1366, 768], [1600, 900], [1920, 1080], [2560, 1440]] ) for ( const z of [0.35, 0.45, 0.6, 0.9, 1.35] ) SPREAD.push({ name: `${W}x${H}@${z}`, W, H, z, ui: panelsOf(W, H) });
const SEATS = [REC.gm, REC.p1, ...SPREAD];

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
const wordsOf = (tb) => [...tb.values()].filter((q) => q && !q.dropped && !q.screenAt && !q.stream && Number.isFinite(q.x) && Number.isFinite(q.y));

/** how a seat draws the page at a step: per key { cap (layout units), side (drawn), table (the table's side), rules, w, item, box, env } */
function drawSeat(S, step, prev = false, extra = {}) {
  enterSeat(S);
  const TT = prev ? PT : T, SS = prev ? PS : SEAT, d = wdeps(step), ws = wordsOf(pageAt(step, prev));
  const view = viewOf(S), panels = S.ui.map(toScene(S));
  const items = TT.seatItems(ws, d, { vw: S.W, vh: S.H, zoom: S.z, scale: 1 });
  const lay = SS.seatLayout(items, { view, panels, pins: [PIN, ...(extra.pins ?? [])], tokens: extra.tokens ?? [], zoom: S.z });
  const out = new Map();
  for ( const it of items ) {
    const f = lay.get(it.key), sub = it.sub;
    if ( !f || !sub ) continue;
    const ride = it.ride && (it.path?.length ?? 0) > 1;
    let drawn = null, table = null;
    const wayBox = (way, k) => { const bw = it.w.bw * k, bh = it.w.bh * k; let b = null; for ( const q of way ) { const r = { x0: q.x - bw / 2, y0: q.y - bh / 2, x1: q.x + bw / 2, y1: q.y + bh / 2 }; b = b ? { x0: Math.min(b.x0, r.x0), y0: Math.min(b.y0, r.y0), x1: Math.max(b.x1, r.x1), y1: Math.max(b.y1, r.y1) } : r; } return b; };
    if ( ride ) {
      if ( !f.way ) { out.set(it.key, { rules: f.rules, shown: false, w: it.w }); continue; }
      const k3 = (it.nom?.[2] ?? it.sizes[0]) / it.u;
      drawn = sideOf(wayBox(f.way, k3), sub);
      table = sideOf(wayBox(it.path, k3), sub);
    } else {
      drawn = sideOf(f.box, sub);
      table = it.side ? `${it.side.x},${it.side.y}` : sideOf(it.box2 ?? it.box, sub);
    }
    const shown = !f.rules.includes("off") && !f.rules.includes("noroom") && on(f.box, view) > 0;
    out.set(it.key, { cap: f.cap, side: drawn, table, rules: f.rules, shown, w: it.w, item: it, box: f.box, env: f.env, ride });
  }
  return { out, view, panels, items, lay };
}

// ---- SIDE and ORDER, now and before
const sideMoved = [];
const sideFaults = (prev) => {
  const bad = []; let cases = 0;
  for ( const S of SEATS ) for ( const step of [1, 2, 3] ) for ( const q of drawSeat(S, step, prev).out.values() ) {
    if ( !q.shown ) continue;
    cases++;
    if ( q.side !== q.table && q.rules.includes("side") && !/^(gm|p1)$/.test(S.name) ) { if ( !prev ) sideMoved.push(`${S.name} s${step} ${q.w.text}`); continue; }
    if ( q.side !== q.table ) bad.push(`${S.name} s${step} ${q.w.text} ${q.table} -> ${q.side} (${q.rules.join("+")})`);
  }
  return { bad, cases };
};
const orderFaults = (prev) => {
  const bad = []; let cases = 0;
  for ( const S of SEATS ) {
    const r = [1, 2, 3].map((s) => drawSeat(S, s, prev).out);
    for ( const key of r[1].keys() ) {
      const a = r.map((m) => m.get(key));
      if ( !a.every((q) => q?.shown) ) continue;
      cases++;
      const G = SEAT.MIN_GAIN * 0.999, fl = (q) => q.rules.includes("floor") || q.rules.includes("tight");
      const ok1 = (a[0].cap < a[1].cap - 1e-6 || (fl(a[1]) && a[0].cap <= a[1].cap + 1e-6)) && (a[1].cap < a[2].cap - 1e-6 || (fl(a[2]) && a[1].cap <= a[2].cap + 1e-6)), ok2 = (fl(a[1]) || a[1].cap >= a[0].cap * G) && (fl(a[2]) || a[2].cap >= a[1].cap * G);
      if ( !ok1 || !ok2 ) bad.push(`${S.name} ${a[1].w.text} ${a.map((q) => `${q.cap.toFixed(1)}:${q.rules.join("+")}`).join(" / ")}`);
    }
  }
  return { bad, cases };
};
const sNow = sideFaults(false), sPrev = sideFaults(true);
ok(sPrev.bad.length > 0, `PREV: words on another side of the thing than the table's on some seat (${sPrev.bad.length} of ${sPrev.cases}: ${sPrev.bad.filter((q) => /^(gm|p1) /.test(q)).slice(0, 4).join("; ")})`);
ok(sideMoved.length <= 0.05 * sNow.cases, `SIDE: a word stands on another side only where its own has no clean spot even at its floor (rule side), on at most 5 % (${sideMoved.length} of ${sNow.cases}: ${sideMoved.slice(0, 4).join("; ")})`);
ok(sNow.bad.length === 0, `SIDE: every word every seat shows stands on the table's side of the thing (${sNow.cases} word x seat x step; ${sNow.bad.length} not: ${sNow.bad.slice(0, 4).join("; ")})`);
// (the take's two seats: every word on the same side on both, at every step)
let pairs = 0, pairBad = [];
for ( const step of [1, 2, 3] ) {
  const a = drawSeat(REC.gm, step).out, b = drawSeat(REC.p1, step).out;
  for ( const [k, q] of a ) { const r = b.get(k); if ( q.shown && r?.shown ) { pairs++; if ( q.side !== r.side ) pairBad.push(`s${step} ${q.w.text} ${q.side}/${r.side}`); } }
}
ok(pairs >= 20 && !pairBad.length, `SIDE: the take's GM and player seats show every shared word on the same side (${pairs} pairs; ${pairBad.join("; ")})`);
const oNow = orderFaults(false), oPrev = orderFaults(true);
ok(oPrev.bad.length > 0, `PREV: the steps not apart as drawn on some seat (${oPrev.bad.length} of ${oPrev.cases}: ${oPrev.bad.slice(0, 3).join("; ")})`);
ok(oNow.bad.length === 0, `ORDER: step 1 < 2 < 3 as drawn, each at least ${SEAT.MIN_GAIN} x apart unless at the floor (${oNow.cases} word x seat; ${oNow.bad.length} not: ${oNow.bad.slice(0, 4).join("; ")})`);
// (the take's main word, drawn: world cap and its share of the seat's height on screen)
const mainRows = [];
for ( const S of [REC.gm, REC.p1] ) for ( const step of [1, 2, 3] ) {
  const r = drawSeat(S, step), m = [...r.out.values()].find((q) => q.w.role === "main"), sk = m.w.size / (T.optsOf(m.w, wdeps(step)).size || 1);
  mainRows.push({ S: S.name, step, cap: m.cap, opt: m.cap / sk, px: m.cap * S.z, share: (m.cap * S.z) / S.H, rules: m.rules.join("+"), side: m.side });
}
if ( V ) for ( const q of mainRows ) console.log(`main ${q.S} s${q.step}: cap ${q.cap.toFixed(1)} world (play size ${q.opt.toFixed(1)}), ${q.px.toFixed(0)} px = ${(q.share * 100).toFixed(1)} % of the height, side ${q.side} ${q.rules}`);
// (the take's main word on both seats: its step-2 size here is its room - ROOM below proves no clean spot on its side holds it one size up)
for ( const S of ['gm', 'p1'] ) { const r = mainRows.filter((q) => q.S === S); ok(r[0].cap < r[1].cap && r[1].cap < r[2].cap && r.every((q) => q.side === "0,1"),
  `the take's main word on ${S}: below the bomb at every step, step 1 < 2 < 3 (${r.map((q) => `${q.cap.toFixed(1)} ${q.side} ${q.rules}`).join(" / ")})`); }

// ---- ROOM: a word drawn under its step's own size has no clean spot on its side for its envelope one size up (brute force)
{
  let checked = 0; const bad = [];
  for ( const S of [REC.gm, REC.p1, ...SPREAD.filter((_, i) => i % 3 === 0)] ) for ( const step of [2, 3] ) {
    const r = drawSeat(S, step), m = SEAT.SEAT_EDGE / S.z, v = { x0: r.view.x0 + m, y0: r.view.y0 + m, x1: r.view.x1 - m, y1: r.view.y1 - m };
    const sorted = [...r.out.values()].filter((q) => q.shown && !q.ride).sort((a, b) => (a.item.prio ?? 9) - (b.item.prio ?? 9));
    for ( const q of sorted ) {
      if ( !q.rules.includes("room") || q.rules.includes("tight") || q.rules.includes("side") ) continue;
      const it = q.item, env = q.env, cap = Math.min(it.nom[2], ((env.y1 - env.y0) / (it.box.y1 - it.box.y0)) * it.u / 0.95);
      if ( cap <= ((env.y1 - env.y0) / (it.box.y1 - it.box.y0)) * it.u * 1.001 ) continue;
      checked++;
      const f = cap / it.u, bw = (it.box.x1 - it.box.x0) * f, bh = (it.box.y1 - it.box.y0) * f, sub = it.sub;
      const cov = Math.max(it.cover ?? 0.3, Number.isFinite(it.cov2) ? it.cov2 : on(it.box, sub) / area(sub)) + 0.02;
      // (the words laid out before it and up with it: standing words' envelopes' ink; a rider's way at its envelope size, every tenth of
      // each stretch - stricter than the layout's samples)
      const meets = (o) => (o.item.prio ?? 9) < (it.prio ?? 9) && o.item.life[0] < it.life[1] && it.life[0] < o.item.life[1];
      const before = [...r.out.values()].filter((o) => o.shown && meets(o)).flatMap((o) => {
        if ( !o.ride ) return o.env ? [inkBox(o.env, o.item.ink)] : [];
        const fr = r.lay.get(o.item.key), way = fr?.way, ke = (fr?.env ?? fr?.cap ?? o.item.u) / o.item.u, hw = (o.w.bw * ke * o.item.ink[0]) / 2, hh = (o.w.bh * ke * o.item.ink[1]) / 2, out = [];
        for ( let i = 0; way && i < way.length; i++ ) for ( let j = 0; j < (i + 1 < way.length ? 10 : 1); j++ ) {
          const x = way[i].x + (i + 1 < way.length ? (way[i + 1].x - way[i].x) * j / 10 : 0), y = way[i].y + (i + 1 < way.length ? (way[i + 1].y - way[i].y) * j / 10 : 0);
          out.push({ x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh });
        }
        return out;
      });
      // (clean, with a margin: the spot and its four neighbours half a scan step away - a knife-edge spot is not room a search must find)
      const clean = (cx, cy) => {
        const b = { x0: cx - bw / 2, y0: cy - bh / 2, x1: cx + bw / 2, y1: cy + bh / 2 };
        if ( b.x0 < v.x0 || b.y0 < v.y0 || b.x1 > v.x1 || b.y1 > v.y1 || sideOf(b, sub) !== q.table ) return false;
        const k = inkBox(b, it.ink);
        if ( on(k, PIN) > 0 || on(k, sub) > cov * area(sub) + 1e-6 ) return false;
        return [...r.panels, ...before].reduce((s, o) => s + on(k, o), 0) <= SEAT.SOFT_OK * area(k) * 0.9;
      };
      let room = null;
      for ( let cy = v.y0 + bh / 2; cy <= v.y1 - bh / 2 && !room; cy += bh / 10 ) for ( let cx = v.x0 + bw / 2; cx <= v.x1 - bw / 2 && !room; cx += bw / 20 ) {
        if ( clean(cx, cy) && clean(cx - bw / 40, cy) && clean(cx + bw / 40, cy) && clean(cx, cy - bh / 20) && clean(cx, cy + bh / 20) ) room = [Math.round(cx), Math.round(cy)];
      }
      if ( room ) bad.push(`${S.name} s${step} ${q.w.text} env ${(cap * 0.95).toFixed(0)} -> room for ${cap.toFixed(0)} at ${room}`);
    }
  }
  ok(checked > 0 && bad.length === 0, `ROOM: a word smaller than its step's size has no clean spot on its side one size up (${checked} checked by brute force; ${bad.slice(0, 3).join("; ")})`);
}

// ---- COST: the seat layout on a crowded view (40 tokens, 6 pins), each seat, each step
{
  const ms = () => Number(process.hrtime.bigint()) / 1e6;
  // (the budget: one layout per page per seat (and again only when this seat's view changes), made in an idle moment before the page's
  // first word - sfx.mjs prepPage -, not in the frame a word starts in; at most the trunk's and under these on the crowded view. A median
  // of 12 runs per seat and step: a machine busy with other work moves single runs by milliseconds)
  const BUDGET = { median: 10, spread: 16 };
  const rows = [], worst = { now: 0, prev: 0 }, mean = { now: [], prev: [] };
  for ( const S of [REC.gm, REC.p1] ) {
    const view = viewOf(S), panels = S.ui.map(toScene(S));
    const tokens = Array.from({ length: 40 }, (_, i) => { const x = view.x0 + 200 + (i % 10) * ((view.x1 - view.x0 - 400) / 10), y = view.y0 + 200 + Math.floor(i / 10) * ((view.y1 - view.y0 - 400) / 4); return { x0: x, y0: y, x1: x + 120, y1: y + 120 }; });
    const pins = Array.from({ length: 5 }, (_, i) => ({ x0: 2000 + i * 300 - 600, y0: 3600 - (i % 2) * 500, x1: 2190 + i * 300 - 600, y1: 3830 - (i % 2) * 500 }));
    for ( const step of [1, 2, 3] ) for ( const prev of [false, true] ) {
      enterSeat(S);
      const TT = prev ? PT : T, SS = prev ? PS : SEAT, d = wdeps(step), ws = wordsOf(pageAt(step, prev));
      const run = () => SS.seatLayout(TT.seatItems(ws, d, { vw: S.W, vh: S.H, zoom: S.z, scale: 1 }), { view, panels, pins: [PIN, ...pins], tokens, zoom: S.z });
      run();
      const t = []; for ( let i = 0; i < 12; i++ ) { const t0 = ms(); run(); t.push(ms() - t0); }
      const avg = t.slice().sort((a, b) => a - b)[t.length >> 1], mx = Math.max(...t), k = prev ? "prev" : "now";
      worst[k] = Math.max(worst[k], mx); mean[k].push(avg);
      rows.push(`${S.name} s${step} ${k} ${avg.toFixed(2)} ms (worst ${mx.toFixed(2)})`);
    }
  }
  if ( V ) console.log(rows.join("\n"));
  const mNow = Math.max(...mean.now), mPrev = Math.max(...mean.prev);
  ok(mNow <= BUDGET.median && mNow < mPrev, `COST: the crowded view's seat layout costs at most ${BUDGET.median} ms per page per seat (median; the worst seat and step) and less than the trunk (now ${mNow.toFixed(2)} ms, the trunk ${mPrev.toFixed(2)} ms; single runs now up to ${worst.now.toFixed(2)}, the trunk ${worst.prev.toFixed(2)})`);
  globalThis.__sameBudget = BUDGET;
}
// ---- the worst single layout over the whole spread, crowded (every seat window and zoom, steps 1-3)
{
  const ms = () => Number(process.hrtime.bigint()) / 1e6;
  let worst = 0, at = "";
  for ( const S of SEATS ) for ( const step of [1, 2, 3] ) {
    const view = viewOf(S), panels = S.ui.map(toScene(S));
    const tokens = Array.from({ length: 40 }, (_, i) => { const x = view.x0 + 100 + (i % 10) * ((view.x1 - view.x0 - 200) / 10), y = view.y0 + 100 + Math.floor(i / 10) * ((view.y1 - view.y0 - 200) / 4); return { x0: x, y0: y, x1: x + 120, y1: y + 120 }; });
    enterSeat(S);
    const d = wdeps(step), ws = wordsOf(pageAt(step, false));
    const run = () => SEAT.seatLayout(T.seatItems(ws, d, { vw: S.W, vh: S.H, zoom: S.z, scale: 1 }), { view, panels, pins: [PIN], tokens, zoom: S.z });
    run();
    const t = []; for ( let i = 0; i < 5; i++ ) { const t0 = ms(); run(); t.push(ms() - t0); }
    const md = t.sort((a, b) => a - b)[2]; if ( md > worst ) { worst = md; at = `${S.name} s${step}`; }
  }
  const B = globalThis.__sameBudget;
  ok(worst <= B.spread, `COST: the worst crowded layout over every seat window and zoom of the spread is at most ${B.spread} ms (median of 5: ${worst.toFixed(2)} ms at ${at})`);
}
// ---- the layout is made ahead of the page's first word, in an idle moment (sfx.mjs; the live take checks its frame times)
{
  const src = fs.readFileSync(path.join(root, "scripts/sfx/sfx.mjs"), "utf8");
  const prep = src.slice(src.indexOf("function prepPage(p) {"), src.indexOf("function prepPage(p) {") + 500);
  ok(src.includes("later(`pg|${rec.id}|prep`, first - PREP_LEAD - performance.now(), () => idle(() => prepPage(p)));") && prep.includes("tablePage(p);") && prep.includes("groupLayout(p.group, view(),"),
    "a page's table and this seat's layout are made in an idle moment before its first word (prepPage)");
}
// ---- a fire whose source is off this seat's view: lettered only when its run's whole block is off it too (live 2026-11-15 the second
// of two fires lettered its run in from the player's view edge, cut by it)
{
  const v = viewOf(REC.p1), k = 60, cx = (v.x0 + v.x1) / 2;
  const below = { x: cx, y: v.y1 + 1 * k }, far = { x: cx, y: v.y1 + 20 * k }, side = { x: v.x0 - 2 * k, y: (v.y0 + v.y1) / 2 };
  const PREVoff = (q) => !(q.x > v.x0 && q.x < v.x1 && q.y > v.y0 && q.y < v.y1) ? "lettered" : "laid out";
  ok(PREVoff(below) === "lettered" && SEAT.offSpot(below, k, v) === "cut" && SEAT.offSpot(side, k, v) === "cut" && SEAT.offSpot(far, k, v) === "out",
    "PREV lettered a run whose source is just off the view (its block reaching in, cut by the edge); now such a spot is \"cut\" - not lettered on this seat -, one wholly off it \"out\"");
  const src = fs.readFileSync(path.join(root, "scripts/sfx/sfx.mjs"), "utf8");
  ok(src.includes("ok: SEAT.offSpot(p.at(i, now), k, v0, motion) === \"out\", off: true"), "burnRooms letters an off-view spot only when offSpot says its run lies wholly outside the view");
}
// ---- seeded, nothing per seat at random
const sig = () => JSON.stringify([...drawSeat(REC.p1, 3).out].map(([k, q]) => [k, q.cap, q.box]));
ok(sig() === sig(), "a seat draws the same picture twice");

if ( failed.length ) { console.error(failed.join("\n")); console.error(`sfx-same: ${failed.length} failed, ${n} passed`); process.exit(1); }
console.log(`sfx-same: ${n} checks passed`);
