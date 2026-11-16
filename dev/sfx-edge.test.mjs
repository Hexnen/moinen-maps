// MAPEDGE (ADVM r2 items 5 and 6): no map sound word cut by a seat's window edge, under its panels or on the padding round the map, no two
// moments' words on each other, and a burst of gunfire lettered where its rounds land. On the real engine in node
// (scripts/letters/testenv.mjs) and the pure seat rule (scripts/sfx/sfx-seat.mjs). PREV = the trunk before (f04d889): each group names
// what failed there.
//   INK     a big blast's word laid out at a seat's view edge (the take's detonate: two old damage areas far off the view, their words
//           pulled in): its STANDING INK (the engine's measure: turned by its rotation, a tucked prefix, the duplicate block, the rim) is
//           whole in the view - before only its box was, and the turned word ran off the edge
//   UP      two moments a beat apart (the detonate's two areas): the second word keeps off the first as THIS seat drew it (seatLayout `up`)
//           - before each moment was laid out alone and the player's KRROOOOMM!! stood on its KA-KRROOOOMM!!
//   PANEL   a seat's panel lies on no more than PANEL_OK of a word's ink (the thunder's KRA-KA- on the GM's party panel, a 6 % share before)
//   SCENE   a seat's view of the map is its view inside the scene's rectangle: a word whose thing lies on the padding is not lettered there
//   STREAM  a stream (a gun's report or its impacts) whose source is off this seat's view letters at the view's edge toward it, OFF_K of
//           its size, its syllables running into the view, off the panels (before: no seat rule, the DRRT cut at the top edge)
//           - and its whole STACK (the rows of syllables up at once, both lane columns) inside the view: its beats thinned to STREAM_ROWS
//           on the table's data, the source moved the least to fit (live: the heli's 6 lanes, rows behind the source off the window)
//   RUN     a fire spot off this view keeps its run to the block offSpot judged (before: no room, its phrases reached in, cut at the top)
//           and a run replaced or gone out plays its exit where this seat last seated it, in its last room (before: the raw spot)
//   UIWALK  the panel walk reaches a panel after the first 900 elements (live: plus-ultra's party panel on a v14 page of ~8 000)
//   PUSH    a word this seat laid out is not shoved by a later blast (the engine's shove differs per seat: the player's word off the window)
//   GUN     a gun's walk has no page: its record does not silence its pocks (sfx-page mayPage; the page test checks every preset)
//   WIRING  the runtime uses all of it
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { revTree } from "./lib/baseline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const C = await imp("scripts/sfx/sfx-core.mjs"), PG = await imp("scripts/sfx/sfx-page.mjs");
const T = await imp("scripts/sfx/sfx-table.mjs"), SEAT = await imp("scripts/sfx/sfx-seat.mjs");
const PREV = revTree(root, "f04d889", "scripts/sfx", fs.mkdtempSync(path.join(os.tmpdir(), "mapedge-prev-")));
const PT = await import(pathToFileURL(path.join(PREV, "sfx-table.mjs")).href), PS = await import(pathToFileURL(path.join(PREV, "sfx-seat.mjs")).href);
const PPG = await import(pathToFileURL(path.join(PREV, "sfx-page.mjs")).href);
const { setup } = await imp("scripts/letters/testenv.mjs");
const { sizeFor } = await imp("scripts/letters/size.mjs");
const E = await setup({ gm: true });
const L = E.engine; L.lookStyle("invincible");

let n = 0; const failed = [], V = !!process.env.EDGE_VERBOSE;
const ok = (c, m) => { if ( c ) { n++; if ( V ) console.log("  ok", m); } else failed.push(m); };
const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const on = (a, b) => area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
const inkBox = (b, k) => { const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, hw = ((b.x1 - b.x0) * k[0]) / 2, hh = ((b.y1 - b.y0) * k[1]) / 2; return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh }; };
/** a word's standing ink as drawn: its drawn box's centre +- its measured reach (cap heights) at its drawn cap */
const standOf = (box, R, cap) => { const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2; return { x0: cx - R.l * cap, y0: cy - R.u * cap, x1: cx + R.r * cap, y1: cy + R.d * cap }; };
const cutOf = (b, v) => area(b) - on(b, v);

// ---- the take's detonate (The Warehouse, grid 350, scene 5102 x 6650): two old damage areas, the player 1280 x 720 at 0.686 looking at
// the middle of the map, the GM 1600 x 900 at 0.6
const WG = 350, SCENE = { x: 0, y: 0, width: 5102, height: 6650 };
const SEATS = [{ name: "p1", W: 1280, H: 720, z: 0.686, cam: { x: 1480, y: 2080 } }, { name: "gm", W: 1600, H: 900, z: 0.6, cam: { x: 1630, y: 2100 } }];
for ( const [W, H] of [[1366, 768], [1920, 1080]] ) for ( const z of [0.45, 0.8] ) SEATS.push({ name: `${W}x${H}@${z}`, W, H, z, cam: { x: 1500 + W * 0.1, y: 2200 } });
const panelsOf = (W, H) => [[0, 0, 40, H], [45, 0.27 * H, 140, 0.44 * H], [W - 190, 0, W - 30, 0.16 * H], [W - 30, 0, W, H], [0.13 * W, H - 48, 0.75 * W, H], [W - 330, H - 60, W - 30, H]];
const wdeps = () => ({ L, sizeFor, grid: WG, sceneId: "vL4Lqhd60r7UHjPT", lang: "en", known: null, ledger: SEAT.makeLedger(), toPerf: (t) => t, toShared: (t) => t, layer: { layer: "overlay" },
  step: () => 2, memo: new Map(), tokens: () => [], pins: () => [], warn: () => {} });
const enterSeat = (S) => { globalThis.innerWidth = S.W; globalThis.innerHeight = S.H; canvas.stage.scale.x = canvas.stage.scale.y = S.z; canvas.grid.size = WG; L.prefs = { ...(L.prefs ?? {}), scale: 1 }; };
const viewOf = (S) => ({ x0: S.cam.x - S.W / 2 / S.z, y0: S.cam.y - S.H / 2 / S.z, x1: S.cam.x + S.W / 2 / S.z, y1: S.cam.y + S.H / 2 / S.z });
const toScene = (S) => (r) => ({ x0: S.cam.x + (r[0] - S.W / 2) / S.z, y0: S.cam.y + (r[1] - S.H / 2) / S.z, x1: S.cam.x + (r[2] - S.W / 2) / S.z, y1: S.cam.y + (r[3] - S.H / 2) / S.z });
// (the two areas: big blasts, far off the seats' views, their subjects reaching into them)
const AREAS = [{ at: { x: 2974, y: 5790 }, ap: 900, t: 1_800_000_000_000, key: "a" }, { at: { x: 912, y: 3210 }, ap: 820, t: 1_800_000_000_120, key: "b" }];
const BLASTS = [{ type: "blast", cause: 0, mat: 2, rect: { x0: -2.4, y0: -4.6, x1: 2.4, y1: 1.2 } }, { type: "blast", cause: 0, mat: 2, rect: { x0: -1.2, y0: -2.2, x1: 2.6, y1: 1.4 } }];
const moments = new Map();
const momentOf = (prev, i) => {
  const k = `${prev}|${i}`;
  if ( !moments.has(k) ) {
    const a = AREAS[i], ev = C.entryEvent(BLASTS[i], a.at, a.ap, a.t, { key: `d|${a.key}|1`, sid: `d|${a.key}`, objId: `d${a.key}` });
    const out = (prev ? PT : T).planMoment([ev], wdeps());
    moments.set(k, out.flatMap((m) => m.placed ?? []).filter((w) => w && !w.stream && w.text && Number.isFinite(w.x)));
  }
  return moments.get(k);
};
/** a seat draws the two moments one after the other (now: the second with the first's words up as drawn here) */
function drawDet(S, prev) {
  enterSeat(S);
  const TT = prev ? PT : T, SS = prev ? PS : SEAT, d = wdeps(), view = viewOf(S), panels = panelsOf(S.W, S.H).map(toScene(S));
  const up = [], drawn = [];
  for ( let i = 0; i < AREAS.length; i++ ) {
    const ws = momentOf(prev, i), items = TT.seatItems(ws, d, { vw: S.W, vh: S.H, zoom: S.z, scale: 1 });
    const lay = SS.seatLayout(items, { view, panels, pins: [], tokens: [], zoom: S.z, ...(prev ? {} : { up: up.slice() }) });
    for ( const it of items ) {
      const f = lay.get(it.key);
      if ( !f || f.rule === "off" || f.rule === "noroom" || f.rules?.includes("off") ) continue;
      // (its standing ink: the engine's own measure of THIS word - measured now on both builds, the table's options)
      const R = momentOf(false, i).find((w) => w.key === it.w.key)?.inkU ?? it.reach;
      drawn.push({ i, text: it.w.text, f, it, ink: inkBox(f.box, it.ink ?? [1, 1]), stand: R ? standOf(f.box, R, f.cap) : f.box });
      up.push({ box: f.box, life: it.life });
    }
  }
  return { drawn, view, panels };
}
{
  // INK: every drawn word's standing ink whole inside the view (less the edge): now on every seat; before, cut on some
  let cases = 0; const bad = [], badPrev = [];
  for ( const S of SEATS ) for ( const prev of [false, true] ) {
    const r = drawDet(S, prev), m = SEAT.SEAT_EDGE / S.z * 0.5, v = { x0: r.view.x0 + m, y0: r.view.y0 + m, x1: r.view.x1 - m, y1: r.view.y1 - m };
    for ( const q of r.drawn ) {
      if ( !prev ) cases++;
      const cut = cutOf(q.stand, v) / Math.max(1, area(q.stand));
      if ( cut > 0.002 ) (prev ? badPrev : bad).push(`${S.name} ${q.text} ${(cut * 100).toFixed(1)} % of its ink off the view (${q.f.rules.join("+")})`);
    }
  }
  if ( V ) console.log("INK prev:", badPrev.join("; "));
  ok(badPrev.length > 0, `PREV: a detonate word's standing ink ran off a seat's view (${badPrev.slice(0, 3).join("; ")})`);
  ok(cases >= 6 && bad.length === 0, `INK: every detonate word's standing ink stands whole in every seat's view (${cases} word x seat; ${bad.slice(0, 3).join("; ")})`);
}
{
  // UP: the second moment's words keep off the first moment's words as this seat drew them (at most SOFT_OK of their ink)
  let pairs = 0; const bad = [], badPrev = [];
  for ( const S of SEATS ) for ( const prev of [false, true] ) {
    const r = drawDet(S, prev);
    for ( const a of r.drawn.filter((q) => q.i === 0) ) for ( const b of r.drawn.filter((q) => q.i === 1) ) {
      if ( !prev ) pairs++;
      const sh = on(a.ink, b.ink) / Math.max(1, Math.min(area(a.ink), area(b.ink)));
      if ( sh > SEAT.SOFT_OK + 1e-6 ) (prev ? badPrev : bad).push(`${S.name} ${a.text} / ${b.text} ${(sh * 100).toFixed(0)} %`);
    }
  }
  ok(badPrev.length > 0, `PREV: the detonate's two moments drawn on each other on some seat (${badPrev.slice(0, 3).join("; ")})`);
  ok(pairs >= 4 && bad.length === 0, `UP: two moments a beat apart keep off each other as this seat drew them (${pairs} pairs; ${bad.slice(0, 3).join("; ")})`);
}

// ---- PANEL: a word's ink under a panel - the seat moves it off or makes it smaller (PANEL_OK); the words up keep their SOFT_OK share
{
  // (a wide unlocated word across the reference window: its lead-in on the tool bar at the left edge by ~2 % of it; no room to move)
  const view = { x0: 0, y0: 0, x1: 1600, y1: 900 }, box = { x0: 30, y0: 380, x1: 1570, y1: 600 }, panel = { x0: 0, y0: 0, x1: 60, y1: 900 };
  const item = { key: "s", prio: 0, box, u: 150, sub: null, sizes: [150], min: 110, small: 110, floor: 110, nom: null, life: [0, 1000] };
  const share = (f) => on(f.box, panel) / area(f.box);
  const now = SEAT.seatLayout([item], { view, panels: [panel], pins: [], zoom: 1 }).get("s"), prev = PS.seatLayout([item], { view, panels: [panel], pins: [], zoom: 1 }).get("s");
  ok(on(box, panel) / area(box) > 0.01 && on(box, panel) / area(box) < PS.SOFT_OK, `the case: a panel on ${(on(box, panel) / area(box) * 100).toFixed(1)} % of the word, inside the old share`);
  ok(share(prev) > 0, `PREV: the word stood on the panel (${(share(prev) * 100).toFixed(1)} %, ${prev.rules.join("+")})`);
  ok(share(now) <= SEAT.PANEL_OK + 1e-9 && now.cap < 150 && now.cap >= 110 - 1e-6, `PANEL: off the panel, a little smaller (${(share(now) * 100).toFixed(1)} %, cap ${now.cap.toFixed(0)}, ${now.rules.join("+")})`);
  // (the same box under a word up with it instead: kept at its size, its edge on it - SOFT_OK)
  const nowUp = SEAT.seatLayout([item], { view, panels: [], up: [{ box: panel, life: [0, 1000] }], pins: [], zoom: 1 }).get("s");
  ok(Math.abs(nowUp.cap - 150) < 1e-6 && nowUp.clean === false && nowUp.rules.includes("edge"), `a word up with it may still lie on its edge (SOFT_OK: ${nowUp.rules.join("+")})`);
}

// ---- SCENE: the view inside the scene's rectangle
{
  const v = { x0: -400, y0: 5900, x1: 1500, y1: 7000 }, sv = SEAT.sceneView(v, SCENE);
  ok(sv.x0 === 0 && sv.y1 === 6650 && sv.x1 === 1500 && sv.y0 === 5900, `sceneView clips the view to the map (${JSON.stringify(sv)})`);
  ok(SEAT.sceneView({ x0: 6000, y0: 0, x1: 7000, y1: 500 }, SCENE).x0 === 6000, "a view wholly off the map is kept as it is");
  // (a fire-out word over a fire on the padding below the map: off on a seat whose map view does not hold it)
  const item = { key: "o", prio: 3, box: { x0: 500, y0: 6700, x1: 800, y1: 6800 }, u: 60, sub: { x0: 560, y0: 6680, x1: 700, y1: 6780 }, sizes: [60], min: 60, life: [0, 1000] };
  ok(PS.seatLayout([item], { view: v, panels: [], zoom: 1 }).get("o").rule !== "off", "PREV: lettered on the padding");
  ok(SEAT.seatLayout([item], { view: sv, panels: [], zoom: 1 }).get("o").rule === "off", "SCENE: a word whose thing lies on the padding is not lettered there");
}

// ---- STREAM: the seat rule of a stream
{
  const view = { x0: 1000, y0: 1000, x1: 2866, y1: 2050 }, unit = 60;
  const inV = SEAT.streamSeat({ x: 1900, y: 1500 }, { view, unit, dir: -90, zoom: 0.686 });
  ok(inV.rule === "ok" && inV.at.x === 1900 && inV.at.y === 1500 && inV.dir === -90 && inV.k === 1, "a source in the view: as asked");
  const inset = (v, z) => { const e = SEAT.SEAT_EDGE / z; return { x0: v.x0 + e, y0: v.y0 + e, x1: v.x1 - e, y1: v.y1 - e }; };
  const inside = (f, v) => f.x0 >= v.x0 - 1e-6 && f.y0 >= v.y0 - 1e-6 && f.x1 <= v.x1 + 1e-6 && f.y1 <= v.y1 + 1e-6;
  const above = SEAT.streamSeat({ x: 1900, y: 400 }, { view, unit, dir: -90, zoom: 0.686 });
  const fa = SEAT.streamFoot(above.at, above.dir, unit * above.k, 1);
  ok(above.rule === "away" && Math.abs(fa.y0 - inset(view, 0.686).y0) < 1e-6 && above.at.x === 1900 && above.dir === 90 && above.k === SEAT.OFF_K, `a shooter above the view: its stack against the top edge, running down into it, OFF_K (${JSON.stringify(above)})`);
  const left = SEAT.streamSeat({ x: 200, y: 1500 }, { view, unit, dir: -90, zoom: 1 });
  ok(left.rule === "away" && left.dir === 0 && left.at.x > view.x0 && inside(SEAT.streamFoot(left.at, 0, unit * left.k, 1), inset(view, 1)), "beyond the left edge: running right into the view, inside it");
  // (its first syllables would stand under a panel at the top edge: moved off it)
  const panel = { x0: 1700, y0: 1000, x1: 2100, y1: 1400 };
  const off = SEAT.streamSeat({ x: 1900, y: 400 }, { view, unit, dir: -90, zoom: 0.686, panels: [panel] });
  const fo = SEAT.streamFoot(off.at, off.dir, unit * off.k, 1);
  ok(off.rule === "away" && !(fo.x0 < panel.x1 && fo.x1 > panel.x0 && fo.y0 < panel.y1 && fo.y1 > panel.y0) && inside(fo, inset(view, 0.686)), `moved off this seat's panel, still in the view (x ${off.at.x.toFixed(0)})`);
  ok(typeof PS.streamSeat !== "function", "PREV: streams had no seat rule");

  // (live, take B after: the heli run's impact stream - 8 beats bunched into 6 lanes at once; the engine stacks lanes in front of the
  // source only as far as the view has room and the rest BEHIND it, so near the bottom edge rows fell off the window on both seats)
  const heli = [0, 60, 130, 190, 260, 330, 400, 900];
  ok(SEAT.streamRows(heli) >= 6, `the heli's beats open ${SEAT.streamRows(heli)} lanes at once (live: 6)`);
  const thin = SEAT.thinBeats(heli);
  ok(SEAT.streamRows(thin) <= SEAT.STREAM_ROWS && thin[0] === 0 && thin.at(-1) === 900 && thin.every((b) => heli.includes(b)), `thinned on the table's beats: ${JSON.stringify(thin)}, at most ${SEAT.STREAM_ROWS} up at once, first and last kept`);
  let worst = 0;
  for ( let n = 0; n < 400; n++ ) { const bs = Array.from({ length: 2 + (n % 9) }, (_, i) => Math.round(((n * 37 + i * 97) % 211) * (1 + (i % 3)))); worst = Math.max(worst, SEAT.streamRows(SEAT.thinBeats(bs))); }
  ok(worst <= SEAT.STREAM_ROWS, `any beats thinned: at most ${SEAT.STREAM_ROWS} lanes (worst ${worst})`);
  const gmV = { x0: 800, y0: 100, x1: 4000, y1: 1900 }, gMv = () => gmV, p1V = { x0: 1523, y0: 1007, x1: 3277, y1: 1993 }, hu = 178.3, rows = SEAT.streamRows(thin);
  const src0 = { x: 2734, y: 1618 }, gI = inset(gMv(), 0.5);
  ok(SEAT.streamFoot(src0, -90, hu, SEAT.streamRows(heli)).y0 < gI.y0, "PREV: the 6 lanes do not fit in front of the source (the engine put the rest behind it, off the bottom)");
  const g = SEAT.streamSeat(src0, { view: gmV, unit: hu, dir: -90, zoom: 0.5, rows });
  ok(g.rule === "ok" && g.k === 1 && inside(SEAT.streamFoot(g.at, g.dir, hu * g.k, rows), gI), "GM 1600x900 z0.5: thinned, the whole stack stands in front of the source in the view, full size, where it is");
  const g2 = SEAT.streamSeat({ x: 2734, y: 1850 }, { view: gmV, unit: hu, dir: -90, zoom: 0.5, rows });
  ok(g2.rule === "shift" && g2.k === 1 && inside(SEAT.streamFoot(g2.at, g2.dir, hu, rows), gI), `a source at the bottom edge: moved up ${(1850 - g2.at.y).toFixed(0)} px, the stack inside`);
  const p = SEAT.streamSeat({ x: 2900, y: 1640 }, { view: p1V, unit: hu, dir: -90, zoom: 0.73, rows });
  ok(p.k < 1 && p.k >= SEAT.STREAM_MIN_K && inside(SEAT.streamFoot(p.at, p.dir, hu * p.k, rows), inset(p1V, 0.73)), `player 1280x720 z0.73: the stack is taller than the view at full size - drawn at ${p.k.toFixed(2)} of it, inside`);
  const kept = SEAT.streamSeat({ x: 2900, y: 1640 }, { view: p1V, unit: hu, dir: -90, zoom: 0.73, rows, scale: 1 });
  ok(kept.k === 1, "a stream already playing keeps the size it was called at");
  // (any source, direction and view: the stack inside the view whenever it can fit at STREAM_MIN_K)
  let bad = 0, tried = 0;
  for ( let n = 0; n < 600; n++ ) {
    const vw = 900 + (n * 131) % 2600, vh = 500 + (n * 71) % 1500, z = 0.3 + ((n * 13) % 90) / 100, uu = 40 + (n * 29) % 200, rr = 1 + (n % 3);
    const V = { x0: 500, y0: 300, x1: 500 + vw, y1: 300 + vh }, d = [-90, 90, 0, 180, -60, 30, 145][n % 7];
    const s0 = { x: 500 - 800 + ((n * 977) % (vw + 1600)), y: 300 - 600 + ((n * 613) % (vh + 1200)) };
    const r = SEAT.streamSeat(s0, { view: V, unit: uu, dir: d, zoom: z, rows: rr });
    const f = SEAT.streamFoot(r.at, r.dir, uu * r.k, rr), I = inset(V, z);
    const minF = SEAT.streamFoot({ x: 0, y: 0 }, r.dir, uu * SEAT.STREAM_MIN_K * (r.rule === "away" ? SEAT.OFF_K : 1), rr);
    if ( minF.x1 - minF.x0 > I.x1 - I.x0 || minF.y1 - minF.y0 > I.y1 - I.y0 ) continue;
    tried++; if ( !inside(f, I) ) bad++;
  }
  ok(bad === 0 && tried > 300, `600 random streams: the stack inside the view in ${tried - bad} of ${tried} that can fit`);
}

// ---- GUN: a gun's record does not own its pocks (dev/sfx-page.test.mjs MAPEDGE-GUN checks every preset)
{
  const uzi = { id: "g", t0: 1, f: [{ id: "p0", key: "puffs.0~0" }], d: [{ id: "d0", key: "pocks" }], walk: { hits: [[0, 0, 0, 0], [10, 0, 50, 0]] }, pending: { accent: [{ kind: "muzzle" }, { kind: "hitFx" }] } };
  const bomb = { id: "b", t0: 1, f: [{ id: "x", key: "burst.burst" }], d: [{ id: "d1", key: "crater" }], walk: null, pending: { accent: [] } };
  ok(!PG.mayPage(uzi) && PG.mayPage(bomb), "a gun's walk has no page, a bomb has");
  ok(typeof PPG.mayPage !== "function", "PREV: every record owned its strokes (sfx.mjs planPage)");
}

// ---- RUN: a fire spot off the view keeps its run to the block judged "out"
{
  let bad = 0, outs = 0;
  const view = { x0: 1000, y0: 1000, x1: 3000, y1: 2200 };
  for ( let n = 0; n < 500; n++ ) {
    const q = { x: 200 + (n * 173) % 3600, y: 200 + (n * 97) % 2800 }, k = 20 + (n * 7) % 60;
    if ( q.x > view.x0 && q.x < view.x1 && q.y > view.y0 && q.y < view.y1 ) continue;
    if ( SEAT.offSpot(q, k, view, n % 2 ? "stepped" : "smooth") !== "out" ) continue;
    outs++; const b = SEAT.runBox(q, k);
    if ( b.x0 < view.x1 && b.x1 > view.x0 && b.y0 < view.y1 && b.y1 > view.y0 ) bad++;
  }
  ok(outs > 50 && bad === 0, `a spot judged "out" (${outs}): its run's block - its room now - lies wholly off the view`);
}

// ---- UIWALK: a fixed panel late in a big page is a panel
{
  const el = (cs, kids = [], r = null) => ({ nodeType: 1, tagName: "DIV", cs, children: kids, childNodes: [], getBoundingClientRect: () => r ?? { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } });
  const plain = { display: "block", visibility: "visible", opacity: "1", backgroundColor: "rgba(0, 0, 0, 0)", backgroundImage: "none", borderTopWidth: "0" };
  const filler = Array.from({ length: 1200 }, () => el(plain));
  const party = el({ ...plain, backgroundColor: "rgb(20, 20, 30)" }, [], { left: 96, top: 510, right: 336, bottom: 790, width: 240, height: 280 });
  const roots = [el(plain, filler), party], env = { style: (e) => e.cs, vw: 1600, vh: 900 };
  const hit = (rs) => rs.some((r) => r.x0 === 96 && r.y0 === 510);
  const src = fs.readFileSync(path.join(root, "scripts/sfx/sfx.mjs"), "utf8"), mx = Number(/const UI_VISIT = (\d+);/.exec(src)?.[1]);
  ok(!hit(C.uiRects(roots, env)) && mx >= 6000 && hit(C.uiRects(roots, { ...env, max: mx })) && /vh: innerHeight, max: UI_VISIT,/.test(src), `PREV the walk stopped at 900 elements and missed the party panel; the seat walks ${mx}`);
}

// ---- WIRING
{
  const src = fs.readFileSync(path.join(root, "scripts/sfx/sfx.mjs"), "utf8"), tab = fs.readFileSync(path.join(root, "scripts/sfx/sfx-table.mjs"), "utf8");
  ok(/if \( PG\.mayPage\(rec\) \) \{\n\s*for \( const d of rec\.d \?\? \[\] \) if \( d\?\.id \) owned\.d\.add\(d\.id\);/.test(src), "planPage owns a record's strokes only when it may page");
  ok(/const beats = SEAT\.thinBeats\(C\.streamBeats\(W\)\), rows = SEAT\.streamRows\(beats\);/.test(src), "a stream's beats are thinned to its rows before it plays");
  ok(/seat = SEAT\.streamSeat\(at\(\), \{ view: mapView\(\), unit, panels: uiBoxes\(\), dir, zoom, rows, scale: kFix \}\)/.test(src) && /at: \(\) => seatNow\(\)\.at, to, dir,/.test(src) && /logCall\(\{ \.\.\.w, text: w\.text \?\? w\.kind \}/.test(src), "a located stream plays through its seat rule and is logged");
  ok(/const up = \[\.\.\.alive\]\.filter\(\(r\) => r\.box && r\.grp !== grp\)/.test(src) && /grp: w\.group \?\? null, life: \[ts0, ts0 \+ lifeMs\(w\)\]/.test(src), "a group's layout counts this seat's other words up");
  ok(/room: SEAT\.runBox\(q, k\), ok: SEAT\.offSpot\(q, k, v0, motion\) === "out", off: true/.test(src), "a fire spot off the view letters its run inside the block it was judged by");
  // (MAPBURN2: restated - a fire is lettered line by line, there is no run whose exit phrases could jump to the raw spot: a line is one
  // word, handed to the engine once with the place this seat gave it, and plays its own exit there)
  ok(/const q = p\.at\(i, now\), at = o \? \{ x: q\.x \+ o\.dx, y: q\.y \+ o\.dy \} : q;/.test(src) && /size, at, startAt: toPerf\(line\.t0\)/.test(src) && !/last\.at/.test(src), "a fire's word is lettered once at the place this seat gave it: nothing of it is left to move when its fire goes out or regroups");
  // (MAPBURN2: restated - no run, so no last-breath phrase to suppress; a regrouped fire's area has had its line this turn whatever key it burns under)
  ok(/for \( const k of \[\.\.\.burns\.keys\(\)\] \) if \( !want\.has\(k\) \) burns\.delete\(k\);/.test(src) && /const id = `\$\{a\.id\}\|\$\{sl\.turn\}`; if \( spoken\.has\(id\) \) continue;/.test(src) && !/burnGoesOn/.test(src), "a fire regrouped under a new key burns on: no extra word, its area speaks once a turn");
  ok(/oo\.pushable = false;/.test(src) && /function seatCall\(w\)[\s\S]*?oo\.pushable = false;[\s\S]*?return \{ o: oo/.test(src), "a word this seat laid out is not shoved off its checked place");
  ok(/const vw = mapView\(\), zoom/.test(src) && /v0 = mapView\(\), z = canvas/.test(src) && /return SEAT\.sceneView\(view\(\), canvas\.dimensions\?\.sceneRect\)/.test(src), "words and runs stand in the seat's view of the map");
  ok(/panels: uiCache\.rects \?\? \[\], up: screenUp\.filter/.test(src), "an unlocated word: panels are panels, words up are words up");
  ok(/if \( o\.from && Number\.isFinite\(o\.from\.x\) && Number\.isFinite\(o\.from\.y\) \) oo\.from = sh\(o\.from\);/.test(src), "the side a word's sound comes from moves with the word (the table's direction on every seat)");
  ok(/view: INK_VIEW \}\)\?\.stand;/.test(tab) && /reach: w\.inkU \?\? null/.test(tab), "the table measures each word's standing ink and the seat items carry it");
}

if ( process.env.EDGE_DUMP ) for ( const S of SEATS ) for ( const prev of [false, true] ) { const r = drawDet(S, prev); console.log(S.name, prev ? "PREV" : "NOW", JSON.stringify(r.view, (k, v) => typeof v === "number" ? Math.round(v) : v));
  for ( let i = 0; i < 2; i++ ) for ( const w of momentOf(prev, i) ) { const q = r.drawn.find((d) => d.it.w.key === w.key); console.log("  ", i, w.role, w.text, "rot", w.rotation?.toFixed(1), "tab", Math.round(w.x), Math.round(w.y), q ? `cap ${q.f.cap.toFixed(0)} ${q.f.rules.join("+")} box ${[q.f.box.x0, q.f.box.y0, q.f.box.x1, q.f.box.y1].map(Math.round)} stand ${[q.stand.x0, q.stand.y0, q.stand.x1, q.stand.y1].map(Math.round)}` : "not drawn"); } }
if ( failed.length ) { console.log(failed.join("\n")); console.log(`sfx-edge: ${failed.length} failed, ${n} passed`); process.exit(1); }
console.log(`sfx-edge: ${n} checks passed`);
