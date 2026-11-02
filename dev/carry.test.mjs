// Carry a token with a destruction stroke (the pure parts):   node dev/carry.test.mjs
//   1. pickToken: the topmost token under the point (elevation, then sort), locked / invisible ones skipped, a miss is null;
//   2. classifyPress: a click (< 8 px) vs a drag;
//   3. the path -> position clock: the token follows the stroke's path at the very times of the entry's front (pathTimes), ends at the
//      path end, holds before the start, never allocates new objects per call;
//   4. the pose and the offset weight: finite, neutral before the run, settles after, "real" waits for the hand-over, "return" glides back;
//   5. makeTk (the record): a tap carries nothing, the end is the grab + the stroke's displacement (clamped, snapped), flat path;
//   6. flag format: `tk` is in no signature (baked pixels and chunk ids cannot change), survives a save / load, and an older reader that
//      knows nothing of it loads the same strokes.
//   7. the carried token is always in front (carry-core frontKeys / OVER_KEYS / drawsOver, carry-front.mjs hold / release with a stubbed canvas and clock);
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
class ForcedDeletion {}
globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call() {} };
globalThis.foundry = { data: { operators: { ForcedDeletion } }, utils: { deepClone: (v) => structuredClone(v) } };
globalThis.canvas = { dimensions: { sceneRect: { x: 0, y: 0, width: 1200, height: 800 } }, grid: { size: 100 } };
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const C = await imp("scripts/tokens/carry-core.mjs");
const EC = await imp("scripts/destruction/entry-clock.mjs");
const Model = await imp("scripts/destruction/model.mjs");
const Store = await imp("scripts/destruction/store.mjs");

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

/* ---- 1. pick */
{
  const T = (id, x, y, o = {}) => ({ id, x, y, w: 100, h: 100, elevation: 0, sort: 0, locked: false, visible: true, ...o });
  const list = [T("a", 0, 0), T("b", 50, 50, { sort: 5 }), T("c", 50, 50, { elevation: 1 }), T("d", 300, 300, { locked: true }), T("e", 0, 300, { visible: false })];
  check(C.pickToken(list, { x: 10, y: 10 }) === "a", "pick: a single token");
  check(C.pickToken(list, { x: 60, y: 60 }) === "c", "pick: higher elevation wins over sort");
  check(C.pickToken(list.filter((t) => t.id !== "c"), { x: 60, y: 60 }) === "b", "pick: higher sort wins");
  check(C.pickToken(list, { x: 320, y: 320 }) === null, "pick: a locked token is skipped");
  check(C.pickToken(list, { x: 20, y: 320 }) === null, "pick: an invisible token is skipped");
  check(C.pickToken(list, { x: 700, y: 700 }) === null && C.pickToken([], { x: 1, y: 1 }) === null, "pick: a miss is null");
  check(C.pickToken(list, { x: 100, y: 10 }) === null && C.pickToken(list, { x: 99.9, y: 10 }) === "a", "pick: the far edge is outside");
}

/* ---- 2. click vs drag */
check(C.classifyPress(0) === "click" && C.classifyPress(7.9, 1000) === "click", "press: under 8 px is a click, however long");
check(C.classifyPress(8) === "drag" && C.classifyPress(300, 30) === "drag", "press: 8 px and more is a drag");

/* ---- 3. the clock */
const art = [[10, 10, 0], [40, 10, 200], [80, 30, 600], [120, 30, 700], [200, 90, 1500]];
const flat = art.flatMap((q) => q);
const tk = { id: "tok", x0: 100, y0: 100, x1: 100 + 380, y1: 100 + 160, e: 0, p: flat };
check(C.validTk(tk) && !C.validTk({ ...tk, p: [1, 2] }) && !C.validTk(null) && !C.validTk({ ...tk, id: "" }), "tk: validity");
const ap = 2, ox = 50, oy = 20, k = 1.25;
const tl = C.buildTimeline(tk, { ap, ox, oy, k });
const P = EC.pathTimes(art, k);
check(tl && P && near(tl.D, P.D) && tl.n === art.length, "timeline: the entry's own pathTimes (same duration, same points)");
const out = { x: 0, y: 0, ux: 0, uy: 0, sp: 0 };
let okHead = true, maxErr = 0;
for ( let el = 0; el <= P.D; el += P.D / 97 ) {
  C.displacementAt(tl, el, out);
  const h = P.head(el);
  if ( !h ) continue;
  const ex = (h[0] - art[0][0]) * ap, ey = (h[1] - art[0][1]) * ap;
  maxErr = Math.max(maxErr, Math.hypot(out.x - ex, out.y - ey));
  if ( !Number.isFinite(out.x + out.y + out.ux + out.uy + out.sp) ) okHead = false;
}
check(okHead && maxErr < 1e-6, `timeline: the token is exactly at the front's head all along the run (max error ${maxErr.toExponential(1)} scene px)`);
C.displacementAt(tl, -500, out);
check(out.x === 0 && out.y === 0 && out.sp === 0, "timeline: before the front starts the token is at its grab point");
C.displacementAt(tl, P.D + 5000, out);
check(near(out.x, (art.at(-1)[0] - art[0][0]) * ap) && near(out.y, (art.at(-1)[1] - art[0][1]) * ap) && out.sp === 0, "timeline: after the run it is at the path end");
check(near(tl.dx, 380) && near(tl.dy, 160), "timeline: the displacement is the path's end minus its start in scene px");
{ // monotone along the path in time, and a rewind gives the same numbers (the cursor is only a cache)
  const a = { x: 0, y: 0, ux: 0, uy: 0, sp: 0 }, b = { x: 0, y: 0, ux: 0, uy: 0, sp: 0 };
  C.displacementAt(tl, P.D * 0.8, a); C.displacementAt(tl, P.D * 0.2, b); C.displacementAt(tl, P.D * 0.8, out);
  check(near(a.x, out.x) && near(a.y, out.y) && b.x < a.x, "timeline: scrubbing back and forth is consistent");
}
check(C.buildTimeline({ ...tk, p: [10, 10, 0, 12, 10, 50] }, { k: 1 }) === null, "timeline: a tap (path under 12 art px) has none");
check(C.buildTimeline(null) === null, "timeline: no record, no timeline");

/* ---- 4. pose and weights */
{
  const pose = { sx: 1, sy: 1, rot: 0, lift: 0, k: 0 }, d = { ux: 1, uy: 0, sp: 1 };
  let fine = true;
  for ( let el = -100; el < tl.D + 1500; el += 7 ) { C.poseAt(el, tl.D, d, 100, pose); if ( ![pose.sx, pose.sy, pose.rot, pose.lift].every(Number.isFinite) || pose.sx < 0.3 || pose.sy < 0.3 || pose.sx > 2 || pose.sy > 2 ) fine = false; }
  check(fine, "pose: finite and bounded over the whole carry");
  C.poseAt(-10, tl.D, d, 100, pose);
  check(pose.sx === 1 && pose.sy === 1 && pose.rot === 0 && pose.lift === 0, "pose: neutral before the front starts");
  C.poseAt(tl.D / 2, tl.D, d, 100, pose);
  check(pose.sx > 1 && pose.rot > 0 && pose.lift < 0, "pose: in flight it is stretched along the travel, leans into it and is lifted");
  C.poseAt(tl.D + 3000, tl.D, d, 100, pose);
  check(near(pose.sy, 1, 1e-3) && near(pose.rot, 0, 1e-3) && near(pose.lift, 0, 1e-3), "pose: settled after the landing");
  const D = tl.D;
  check(C.startWeight(0) === 0 && C.startWeight(C.PICK_MS) === 1 && C.weightAt(0, D, "real", false).w === 1 && C.weightAt(D / 2, D, "real", false).w === 1, "weight: the lift-off blends in the grab offset, the glide weight is 1 on the path");
  check(C.weightAt(D + C.LAND_MS + 50, D, "real", false, 100).w === 1 && !C.weightAt(D + C.LAND_MS + 50, D, "real", false, 100).done, "weight: 'real' waits at the path end for the token's hand-over");
  check(C.weightAt(D + C.LAND_MS + 5000, D, "real", false, 1000).done, "weight: but not for ever");
  const g = C.weightAt(D + C.LAND_MS + 100, D, "real", true, 0);
  check(g.w < 1 && g.w > 0, "weight: once handed over it glides the rest");
  check(C.weightAt(D + C.HOLD_RETURN_MS - 10, D, "return", false).w === 1 && C.weightAt(D + C.HOLD_RETURN_MS + C.GLIDE_MS + 10, D, "return", false).done, "weight: 'return' holds, then glides home and is done");
}

/* ---- 5. the record */
{
  const grab = { id: "tok", x0: 200, y0: 300, w: 100, h: 100 };
  const path = [[1, 1, 0], [30, 1, 100], [90, 1, 400]];
  const a = { x: 500, y: 500 }, b = { x: 680, y: 530 };
  const r = C.makeTk({ grab, a, b, path });
  check(r && r.x1 === 380 && r.y1 === 330 && r.e === 0 && r.id === "tok" && r.p.length === 9 && r.p[3] === 30, "makeTk: end = grab + stroke displacement, flat path");
  check(C.makeTk({ grab, a, b, path, ends: "return" }).e === 1, "makeTk: 'return' is stored");
  check(C.makeTk({ grab, a, b, path: [[1, 1, 0], [5, 1, 50]] }) === null && C.makeTk({ grab, a, b, path: [[1, 1, 0]] }) === null && C.makeTk({ grab: null, a, b, path }) === null, "makeTk: a tap or a missing token carries nothing");
  const rc = C.makeTk({ grab, a, b: { x: 99999, y: -99999 }, path, rect: { x: 0, y: 0, width: 1200, height: 800 } });
  check(rc.x1 === 1150 && rc.y1 === -50, "makeTk: the token's centre stays inside the scene");
  const rs = C.makeTk({ grab, a, b, path, snap: { grid: 100, gx: 0, gy: 0 } });
  check((rs.x1 + 50) % 100 === 50 && (rs.y1 + 50) % 100 === 50, "makeTk: snapped, the token's centre is the centre of a cell");
  const rf = C.makeTk({ grab, a, b, path, snap: (x, y) => [x + 1, y + 2] });
  check(rf.x1 === 381 && rf.y1 === 332, "makeTk: a snap function is used as given");
}

/* ---- 6. the flag format */
{
  const S = { params: { ...Model.PARAM_DEFAULTS, pin: true }, objects: [] };
  const buf = new Uint8Array(40 * 30).fill(3);
  const mk = (id, extra = {}) => Object.assign(Model.makeObject(buf, 40, { x0: 2, y0: 2, x1: 12, y1: 9 }, { id, type: 0, path: [[1, 1, 0], [50, 40, 300]] }), extra);
  const plain = mk("s1"), carried = mk("s1", { tk: { ...tk } });
  const sig = (o) => Store.objSig({ params: { ...S.params, directional: true }, objects: [o] }, o);
  check(sig(plain) === sig(carried), "format: `tk` is in no stroke signature (no re-bake, same chunk ids)");
  const sigOff = (o) => Store.objSig({ params: { ...S.params, directional: false, pin: false }, objects: [o] }, o);
  check(sigOff(plain) === sigOff(carried), "format: nor with directional off");
  const key = (o) => Store.baseKey ? JSON.stringify([Store.sigsOf({ ...S, objects: [o] }).map((q) => q.sig)]) : "";
  check(key(plain) === key(carried), "format: nor in the scene's stroke signatures");
  // a save and a load keep it; an older reader (which reads only the fields it knows) gets the same stroke
  const scene = { flags: { [Store.MODULE_ID ?? "moinen-maps"]: {} } };
  const S2 = { ...S, ap: 4, seed: 1, enabled: true, objects: [carried], entries: [], seen: new Set() };
  const upd = Store.flagUpdate(S2, scene);
  const stored = upd["flags.moinen-maps.destructionObjects"]?.s1 ?? upd["flags.moinen-maps.destructionObjects.s1"];
  check(stored && stored.tk && stored.tk.id === "tok" && stored.tk.p.length === flat.length, "format: the stroke's own flag key holds `tk`");
  const readOld = (o) => ({ id: o.id, k: o.k, t: o.t, x0: o.x0, y0: o.y0, w: o.w, h: o.h, m: o.m, p: o.p, c: o.c, pr: o.pr });
  check(JSON.stringify(readOld(stored)) === JSON.stringify(readOld(plain)) || JSON.stringify(readOld({ ...stored, s: undefined })) === JSON.stringify(readOld(plain)), "format: a reader that does not know `tk` reads the same stroke");
  const back = Model.objectsOf({ v: 3 }, { s1: stored }, { mw: 40, mh: 30 });
  check(back.length === 1 && back[0].tk?.id === "tok" && C.validTk(back[0].tk), "format: a load keeps `tk`");
  const cp = Model.withCause(back[0], 2), pp = Model.withPin(back[0], { debris: 0.2 }, 1);
  check(cp.tk?.id === "tok" && pp.tk?.id === "tok", "format: a cause or a pinned setting changed on the stroke keeps `tk`");
}

/* ---- 7. the carried token is always in front: the order rule and the hold (carry-front.mjs, with a stubbed canvas) */
{
  const T = { elevation: 0, sortLayer: C.TOKEN_LAYER, sort: 3 };
  const layers = [247, 249, 250, 251, 255, 500, 650].map((l) => ({ elevation: 0, sortLayer: l, sort: 0 }));   // the destruction, districts, lights, tiles, drawings
  check(layers.every((l) => C.drawsOver(C.frontKeys(T), l)), "front: a carried token draws over every layer of the destruction and the scene (247 ... 650, elevation 0)");
  const low = C.frontKeys({ elevation: 0, sortLayer: 100, sort: 1 });
  check(low.sortLayer === C.TOKEN_LAYER && low.sort === 1 && low.elevation === 0, "front: a mesh that lost its layer gets the tokens' own; its own sort and elevation are kept");
  check(C.frontKeys({ elevation: 5, sortLayer: 700, sort: 0 }).elevation === 5 && C.frontKeys({}).sortLayer === C.TOKEN_LAYER, "front: an elevated token keeps its elevation; missing keys default");
  const under = C.OVER_KEYS;
  check(layers.every((l) => C.drawsOver(under, l)) && C.drawsOver(C.frontKeys(T), under) && C.drawsOver(C.frontKeys({ elevation: 5, sortLayer: 700, sort: 0 }), under),
    "front: the editor's overlay and cursor lie over the destruction and under every token (elevation 0 and above)");
  check(!C.drawsOver(T, T) && C.drawsOver({ elevation: 1 }, { elevation: 0, sortLayer: 9999 }) && C.drawsOver({ sortLayer: 2 }, { sortLayer: 1, sort: 9 }), "front: the comparator is Foundry's (elevation, then sortLayer, then sort)");


  // the ORDER RULE with pushed tokens: the carrier over every pushed token, those over every other token, whatever their `sort`
  {
    const norm = (sort, sl = 700, el = 0) => ({ elevation: el, sortLayer: sl, sort });
    const rk = (k, r) => C.frontKeys(k, r);
    for ( const [name, sc, sp, so] of [["equal sorts", 5, 5, 5], ["the carrier's sort lowest", 0, 50, 9], ["the carrier's sort highest", 90, 4, 7], ["inverted sorts", 1, 1000, 100000]] ) {
      const car = rk(norm(sc), C.RANK_CARRIER), pu = [0, 1, 2].map((i) => rk(norm(sp + i * 11 - 11), C.RANK_PUSHED)), other = norm(so);
      check(pu.every((p) => C.drawsOver(car, p) && !C.drawsOver(p, car)), `rank: ${name}: the carrier draws over every one of three pushed tokens`);
      check(pu.every((p) => C.drawsOver(p, other)) && C.drawsOver(car, other), `rank: ${name}: pushed tokens and the carrier draw over every other token`);
      check(layers.every((l) => pu.every((p) => C.drawsOver(p, l)) && C.drawsOver(car, l)) && pu.every((p) => C.drawsOver(p, C.OVER_KEYS)), `rank: ${name}: all of them over the destruction and the editor overlay`);
    }
    check(rk(norm(3, 100), 0).sortLayer === 700 && rk(norm(3, 700), 2).sortLayer === 702 && rk({}, 1).sortLayer === 701 && rk(norm(3), -4).sortLayer === 700, "rank: a plain token keeps the tokens' layer, ranks lift by whole steps, a bad rank is 0");
    check(rk(norm(3, 700, 5), C.RANK_PUSHED).elevation === 5 && rk(norm(3), 2).sort === 3, "rank: elevation and sort are never touched");
  }

  // the hold, with a stubbed canvas and clock
  let now = 1000;
  const realNow = performance.now.bind(performance); performance.now = () => now;
  const listeners = new Set(), meshes = new Map(), unders = [];
  const mk = (id, sl = 100) => { const t = { document: { id }, mesh: { elevation: 0, sortLayer: sl, sort: 0, destroyed: false } }; meshes.set(id, t); return t; };
  globalThis.canvas = { tokens: { get: (id) => meshes.get(id) }, primary: { sortDirty: false }, app: { ticker: { add: (f) => listeners.add(f), remove: (f) => listeners.delete(f) } } };
  const F = await imp("scripts/tokens/carry-front.mjs");
  F.onUnder((on) => unders.push(on));
  const a = mk("a"), b = mk("b", 700);
  const step = (ms) => { now += ms; for ( const f of [...listeners] ) f(); };
  F.hold("a", "grab");
  check(a.mesh.sortLayer === 700 + C.RANK_CARRIER && canvas.primary.sortDirty && unders.at(-1) === true, "front: a hold gives the mesh the tokens' layer and puts the overlay under the tokens");
  F.hold("a", "carry:1"); F.release("a", "grab");
  check(F._frontState().holds.length === 1 && unders.at(-1) === true, "front: the carry takes the hold over from the grab with no gap");
  a.mesh.sortLayer = 100; F.onRefresh(a); check(a.mesh.sortLayer === 700 + C.RANK_CARRIER, "front: Foundry's refresh resets the mesh, the refresh hook gives the keys back");
  b.mesh.sortLayer = 650; F.onRefresh(b); check(b.mesh.sortLayer === 650, "front: a token that is not held is never touched");
  let live = true;
  F.release("a", "carry:1", 300, () => live);
  check(F._frontState().pending === 1 && listeners.size === 1, "front: a release that waits runs on one ticker listener");
  step(200); check(F._frontState().holds.length === 1, "front: it waits at least its grace");
  step(200); check(F._frontState().holds.length === 1, "front: and while the entry still runs");
  live = false; step(16);
  check(F._frontState().holds.length === 0 && unders.at(-1) === false && listeners.size === 0 && !F._frontState().ticking, "front: it lets go when the entry has ended: the overlay is back on top, the ticker listener is gone");
  F.hold("a", "grab"); F.release("a", "grab", 8000); F.hold("a", "grab"); step(9000);
  check(F._frontState().holds.length === 1, "front: a new hold of the same tag cancels a waiting release (a stale timer must not drop it)");
  F.release("a", "grab", 100, () => true); step(100 + F.MAX_WAIT_MS + 20);
  check(F._frontState().holds.length === 0, "front: a release never waits longer than MAX_WAIT_MS for an entry that does not end");
  F.hold("a", "x"); F.release("a", "x", 500); F.clear();
  check(F._frontState().holds.length === 0 && F._frontState().pending === 0 && listeners.size === 0 && unders.at(-1) === false, "front: clear (the scene goes away) lets go of everything");

  // hold with ranks: a carrier and three pushed tokens whose own sorts are HIGHER than the carrier's
  {
    const car = mk("car"), ps = ["p1", "p2", "p3"].map((id) => mk(id)), plain = mk("plain");
    car.mesh.sort = 1; ps.forEach((p, i) => { p.mesh.sort = 50 + i; p.mesh.sortLayer = 700; }); car.mesh.sortLayer = 700; plain.mesh.sort = 999; plain.mesh.sortLayer = 700;
    const key = (t) => [t.mesh.elevation, t.mesh.sortLayer, t.mesh.sort];
    const over = (x, y) => C.drawsOver({ elevation: x.mesh.elevation, sortLayer: x.mesh.sortLayer, sort: x.mesh.sort }, { elevation: y.mesh.elevation, sortLayer: y.mesh.sortLayer, sort: y.mesh.sort });
    F.hold("car", "carry:s", C.RANK_CARRIER);
    for ( const p of ps ) F.hold(p.document.id, "carry:s", C.RANK_PUSHED);
    check(ps.every((p) => over(car, p) && !over(p, car)) && ps.every((p) => over(p, plain)) && over(car, plain), "rank hold: the carrier over three pushed tokens with higher sorts, those over a plain token with the highest sort");
    check(key(plain)[1] === 700 && plain.mesh.sort === 999, "rank hold: a plain token keeps its keys");
    ps.forEach((p) => { p.mesh.sortLayer = 700; F.onRefresh(p); }); car.mesh.sortLayer = 700; F.onRefresh(car);
    check(ps.every((p) => over(car, p)) && ps.every((p) => p.mesh.sortLayer === 701) && car.mesh.sortLayer === 702, "rank hold: Foundry's refresh resets, the keys come back exactly (no compounding after repeated refreshes)");
    for ( let i = 0; i < 5; i++ ) { F.onRefresh(car); F.hold("car", "carry:s", C.RANK_CARRIER); }
    check(car.mesh.sortLayer === 702, "rank hold: re-enforcing never compounds");
    F.hold("p1", "grab", C.RANK_CARRIER); check(ps[0].mesh.sortLayer === 702, "rank hold: the highest rank of a token's holds wins");
    F.release("p1", "grab"); check(ps[0].mesh.sortLayer === 701, "rank hold: ... and a released hold drops back to the next one");
    for ( const p of ps ) F.release(p.document.id, "carry:s"); F.release("car", "carry:s");
    check(F._frontState().holds.length === 0 && ps.every((p) => p.mesh.sortLayer === 700) && car.mesh.sortLayer === 700 && car.mesh.sort === 1 && ps[2].mesh.sort === 52, "rank hold: all released: every mesh has its own layer and sort back");
  }
  const idle = JSON.stringify(F._frontState()); F.onRefresh(a); check(JSON.stringify(F._frontState()) === idle && listeners.size === 0, "front: idle - nothing held, no listener, a token refresh costs one lookup");
  performance.now = realNow;
}

/* ---- 7. the hand-over: judged against the real target, never stuck, no pop on a remote client */
{
  const D = 655, out = { x: 0, y: 0, w: 1, done: false };
  const base = { D, mode: "real", c0x: 100, c0y: 100, dx: 0, dy: 0 };
  // (a) snapped: the document goes to the SNAPPED target (off the raw path end); the carry ends soon after it arrives
  const run = (target, bAt) => {
    const st = { waitFrom: 0, arrivedAt: 0 }; let doneAt = null;
    for ( let el = -200; el < 6000; el += 16 ) {
      const arrivedNow = el >= bAt;
      C.offsetAt(st, { ...base, now: el + 1000, el, bx: arrivedNow ? target[0] : 100, by: arrivedNow ? target[1] : 100, tx: target[0], ty: target[1], dx: el > 0 ? Math.min(el / D, 1) * 400 : 0, dy: 0 }, out);
      if ( out.done ) { doneAt = el; break; }
    }
    return doneAt;
  };
  const snapped = run([520, 114], D + 40);
  check(snapped !== null && snapped < D + 40 + C.LAND_MS + C.GLIDE_MS + 300, `hand-over: a snapped carry (target off the raw path end) is over ${snapped} ms in (hand-over at ${D + 40})`);
  const never = run([520, 114], 1e9);
  check(never !== null && never <= D + C.LAND_MS + C.WAIT_MS + C.GLIDE_MS + 450, `hand-over: a document that never arrives lets go at ${never} ms (the cap is ${D + C.LAND_MS + C.WAIT_MS + C.GLIDE_MS + 450})`);
  const plain = run([500, 100], D + 40);
  check(plain !== null && plain < D + 40 + C.LAND_MS + C.GLIDE_MS + 300, "hand-over: an unsnapped carry is over soon after its hand-over");
  // (b) no pop on a remote client: the document is already at the target before the ride begins here: the token waits at the grab point
  const st = { waitFrom: 0, arrivedAt: 0 };
  let maxJump = 0, prev = null, ok = true;
  for ( let el = -600; el < D + 800; el += 8 ) {
    const dx = el > 0 ? Math.min(el / D, 1) * 420 : 0;
    C.offsetAt(st, { ...base, now: el + 5000, el, bx: 520, by: 100, tx: 520, ty: 100, dx, dy: 0 }, out);
    const shown = 520 + out.x;                        // base + offset: where the token is drawn
    if ( el < 0 && Math.abs(shown - 100) > 1e-6 ) ok = false;           // at the grab point until its own front starts
    if ( prev !== null ) maxJump = Math.max(maxJump, Math.abs(shown - prev));
    prev = shown;
  }
  check(ok && maxJump < 20, `hand-over: a remote token whose document is already at the end waits at the grab point, then rides (max step ${maxJump.toFixed(1)} px, no jump)`);
  // (c) the GM's own live case is unchanged: the document is at the start until the hand-over
  const st2 = { waitFrom: 0, arrivedAt: 0 }; C.offsetAt(st2, { ...base, now: 1, el: -50, bx: 100, by: 100, tx: 520, ty: 100, dx: 0, dy: 0 }, out);
  check(out.x === 0 && out.y === 0, "hand-over: the carrier's own client before the front starts: no offset");
  // (d) a returning carry never waits for a document
  const st3 = { waitFrom: 0, arrivedAt: 0 }; let ret = null;
  for ( let el = 0; el < 4000 && ret === null; el += 16 ) { C.offsetAt(st3, { ...base, mode: "return", now: el, el, bx: 100, by: 100, tx: 520, ty: 100, dx: 400, dy: 0 }, out); if ( out.done ) ret = el; }
  check(ret !== null && ret < D + C.HOLD_RETURN_MS + C.GLIDE_MS + 50, "hand-over: a returning token holds, glides home and is done");
  check(C.weightAt(D + 400000, D, "real", false, 400000).done, "weight: a huge wait (the old stuck state: waited grows as fast as the time) is done");
}

console.log(failed ? `${failed} FAILED` : "carry: all ok");
process.exit(failed ? 1 : 0);
