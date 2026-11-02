// Carry a token with a destruction stroke (the pure parts):   node dev/carry.test.mjs
//   1. pickToken: the topmost token under the point (elevation, then sort), locked / invisible ones skipped, a miss is null;
//   2. classifyPress: a click (< 8 px) vs a drag;
//   3. the path -> position clock: the token follows the stroke's path at the very times of the entry's front (pathTimes), ends at the
//      path end, holds before the start, never allocates new objects per call;
//   4. the pose and the offset weight: finite, neutral before the run, settles after, "real" waits for the hand-over, "return" glides back;
//   5. makeTk (the record): a tap carries nothing, the end is the grab + the stroke's displacement (clamped, snapped), flat path;
//   6. flag format: `tk` is in no signature (baked pixels and chunk ids cannot change), survives a save / load, and an older reader that
//      knows nothing of it loads the same strokes.
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

console.log(failed ? `${failed} FAILED` : "carry: all ok");
process.exit(failed ? 1 : 0);
