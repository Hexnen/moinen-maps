// HOVER WITHOUT api.visual + A CONTINUOUS TOUCH-DOWN (the pure parts of tokens/carry.mjs):   node dev/carry-fallback.test.mjs
// The user's live moinen-pixel-vfx has no api.visual: its motion table writes a hovering token's mesh every frame, absolutely, at the document's centre
// plus its displacement (a jet pack: -22 px). A frame is simulated the way Foundry's ticker runs it:
//   early (the carry's nudge)  ->  Foundry's refresh (only when the document moved: mesh back to its natural place, the carry's refreshed() re-captures and re-applies)
//   ->  the vfx motion tick (writes centre + hover while it holds the token)  ->  the carry's late pass (measure, then apply)  ->  render (what is sampled).
//   1. a plough's hand-over (the document moves to the final mid-carry): the displayed height stays at the hover every frame (the old way, base captured from the mesh
//      and re-captured at Foundry's refresh, lost it: 22 px drop, back 0.6 s later: the user's "pop at the end");
//   2. a ride at rest whose pose equals what the vfx writes (the same value): no flicker (the nudge tells "rewritten" from "left alone");
//   3. the vfx lets go mid-carry (the passive ends): the displacement goes with it, no stale hover;
//   4. the carry's last frame (end): the mesh keeps the hover in that frame too;
//   5. extOf ignores a mesh Foundry has not placed yet; rewritten's eps;
//   6. blendLanding: the touch-down continues the flight's last pose (lean, size, lift): the per-frame change stays small; the raw pose snaps (documented); the landing
//      converges to the plain landing pose; no flight frame seen = unchanged.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call() {} };
const C =await import(pathToFileURL(path.join(root, "scripts/tokens/carry-core.mjs")).href);
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };

/* ---- a model of one token under a carry, frame by frame (the algorithm of carry.mjs, with the pose and the ride reduced to an offset `off(f)`) */
function simulate({ frames = 120, hover = 22, handoverAt = 60, vfxUntil = Infinity, off = (f) => ({ x: Math.min(f, 50) * 16, y: 0 }), legacy = false, endAt = Infinity }) {
  const doc = { cx: 500, cy: 500 };                 // the document's centre (moves at the hand-over)
  const mesh = { x: doc.cx, y: doc.cy - hover };    // at rest: the vfx holds it raised
  const fin = off(handoverAt);
  // the carry's constructor: ext read before anything resets the mesh, the base = the captured place minus its own displacement (legacy: the captured mesh as is)
  const ext = C.extOf(mesh, { x: doc.cx, y: doc.cy }, { x: 0, y: 0 });
  const base = { x: mesh.x, y: mesh.y };
  if ( !legacy ) { const q = C.extOf(base, { x: doc.cx, y: doc.cy }); base.x -= q.x; base.y -= q.y; }
  let wrote = null, moved = false, rideOff = { x: 0, y: 0 }, ended = false;
  const out = [];
  const apply = () => { const e = legacy ? { x: 0, y: 0 } : ext; mesh.x = base.x + rideOff.x + e.x; mesh.y = base.y + rideOff.y + e.y; wrote = { x: mesh.x, y: mesh.y }; };
  for ( let f = 0; f < frames; f++ ) {
    // early
    if ( !legacy && !ended && wrote ) { mesh.x = wrote.x + C.NUDGE; wrote.x = mesh.x; }
    // the ride's offset: on the path, then (after the hand-over) "where the carry wants it minus where Foundry has it"
    const o = off(f);
    // Foundry's refresh: the document moved to the final at the hand-over: the mesh goes to its natural place and the carry re-captures it
    if ( f === handoverAt ) { doc.cx = 500 + fin.x; doc.cy = 500 + fin.y; mesh.x = doc.cx; mesh.y = doc.cy; moved = true; if ( !ended ) { base.x = mesh.x; base.y = mesh.y; rideOff = { x: o.x - fin.x, y: o.y - fin.y }; apply(); if ( !legacy ) { mesh.x = wrote.x + C.NUDGE; wrote.x = mesh.x; } } }   // (refreshed(): apply, then the nudge again: the vfx tick that follows may write exactly this value)
    // the vfx motion tick: absolute, from the document's centre
    if ( f < vfxUntil ) { mesh.x = doc.cx; mesh.y = doc.cy - hover; }
    // the carry's late pass
    if ( !ended ) {
      rideOff = moved ? { x: o.x - fin.x, y: o.y - fin.y } : o;
      if ( !legacy ) {
        if ( !wrote ) { if ( C.rewritten(mesh, { x: doc.cx, y: doc.cy }) ) C.extOf(mesh, { x: doc.cx, y: doc.cy }, ext); }
        else if ( C.rewritten(mesh, wrote) ) C.extOf(mesh, { x: doc.cx, y: doc.cy }, ext);
        else { ext.x = 0; ext.y = 0; }
      }
      if ( f >= endAt ) {                           // end(): restoreExact (natural place) then the displacement for this frame
        ended = true; mesh.x = doc.cx; mesh.y = doc.cy;
        if ( !legacy ) { mesh.x += ext.x; mesh.y += ext.y; }
      } else apply();
    }
    // render: the height above the ground the token is shown at, and the mesh
    out.push({ h: doc.cy + (rideOff.y ?? 0) - mesh.y + (ended ? 0 : 0), x: mesh.x, y: mesh.y, ground: (ended ? doc.cy : base.y + rideOff.y) - mesh.y });
  }
  return out;
}
const maxStep = (a, k) => { let m = 0; for ( let i = 1; i < a.length; i++ ) m = Math.max(m, Math.abs(a[i][k] - a[i - 1][k])); return m; };

/* ---- 1. the hand-over */
{
  const now = simulate({}), old = simulate({ legacy: true });
  const hNow = now.map((r) => r.ground), hOld = old.map((r) => r.ground);
  check(hNow.every((h) => Math.abs(h - 22) < 0.3), `hand-over: the hover is kept every frame (min ${Math.min(...hNow).toFixed(2)}, max ${Math.max(...hNow).toFixed(2)})`);
  check(Math.min(...hOld.slice(60)) < 1, `hand-over, the OLD way: the height is lost after Foundry's refresh (min ${Math.min(...hOld.slice(60)).toFixed(1)}: the reported pop; documents the bug)`);
  check(maxStep(now.slice(55), "y") < 0.5, `hand-over: the mesh never steps in y around the hand-over (max ${maxStep(now.slice(55), "y").toFixed(2)})`);
}
/* ---- 2. at rest, the pose equals the vfx write: no flicker */
{
  const r = simulate({ off: () => ({ x: 0, y: 0 }), handoverAt: 1e9 });
  check(r.every((q) => Math.abs(q.ground - 22) < 0.3), `at rest (the carry writes exactly what the vfx writes): no flicker between hover and ground (min ${Math.min(...r.map((q) => q.ground)).toFixed(2)})`);
}
/* ---- 3. the vfx lets go mid-carry */
{
  const r = simulate({ vfxUntil: 30, handoverAt: 80 });
  check(r.slice(32, 79).every((q) => Math.abs(q.ground) < 0.3), "the vfx lets go mid-carry: the displacement goes with it (no stale hover)");
}
/* ---- 4. the last frame */
{
  const r = simulate({ handoverAt: 60, endAt: 90, frames: 100 });
  check(r.slice(85).every((q) => Math.abs(q.ground - 22) < 0.3), `the carry's last frame (and after): the mesh keeps the hover (min ${Math.min(...r.slice(85).map((q) => q.ground)).toFixed(2)})`);
  check(maxStep(r.slice(85), "y") < 0.3 && maxStep(r.slice(85), "x") < 0.3, "the end changes nothing on screen");
}
/* ---- 5. extOf, rewritten */
{
  const o = C.extOf({ x: 50, y: 50 }, { x: 3000, y: 5000 }, { x: 9, y: 9 }, 400);
  check(o.x === 0 && o.y === 0, "extOf: a mesh Foundry has not placed yet (thousands of px off) is no displacement");
  const p = C.extOf({ x: 100, y: 78 }, { x: 100, y: 100 });
  check(p.x === 0 && p.y === -22, "extOf: a hover of 22 px reads (0, -22)");
  check(!C.rewritten({ x: 1, y: 1 }, { x: 1.0005, y: 1 }) && C.rewritten({ x: 1, y: 1 }, { x: 1 + C.NUDGE, y: 1 }) && !C.rewritten({ x: 1, y: 1 }, null), "rewritten: eps under the nudge, the nudge is seen, no record = false");
}
/* ---- 6. blendLanding */
{
  const S = 100, D = 600, d = { x: 0, y: 0, ux: 1, uy: 0, sp: 1 }, P = { sx: 1, sy: 1, rot: 0, lift: 0, k: 0 };
  const raw = [], blended = [], st = {};
  for ( let el = 0; el <= D + 1000; el += 16 ) {
    const dd = el >= D ? { ...d, sp: 0 } : d;
    C.poseAt(el, D, dd, S, P); raw.push({ ...P });
    C.blendLanding(st, el, D, P); blended.push({ ...P });
  }
  const step = (a, k) => maxStep(a, k);
  check(step(raw, "rot") > 0.25, `the raw pose snaps upright at the path's end (${(step(raw, "rot") * 180 / Math.PI).toFixed(1)} deg in a frame: documents the pop)`);
  check(step(blended, "rot") < 0.11, `blended: the lean never changes more than ${(step(blended, "rot") * 180 / Math.PI).toFixed(1)} deg a frame (< 6.3)`);
  // the touch-down frame itself (the first frame at or past D): the raw pose jumps there, the blended one continues the flight's last frame
  const iD = raw.findIndex((_, i) => i * 16 >= D), jump = (a, k) => Math.abs(a[iD][k] - a[iD - 1][k]);
  check(jump(raw, "sy") > 0.1 && jump(raw, "lift") > 5, `the raw touch-down jumps (sy ${jump(raw, "sy").toFixed(3)}, lift ${jump(raw, "lift").toFixed(1)} px in one frame: documents the pop)`);
  check(jump(blended, "sy") < 1e-9 && jump(blended, "sx") < 1e-9 && jump(blended, "lift") < 1e-9 && jump(blended, "rot") < 1e-9, "blended: the touch-down frame shows the flight's last pose exactly (no jump in size, lift, lean)");
  const landRaw = Math.max(...["sy", "lift"].map((k) => maxStep(raw.slice(iD + 1), k) / (k === "lift" ? 10 : 0.1))), landBl = Math.max(...["sy", "lift"].map((k) => maxStep(blended.slice(iD), k) / (k === "lift" ? 10 : 0.1)));
  check(landBl <= landRaw * 1.25, `blended: after the touch-down the squash / lift move no faster than the landing's own motion (${landBl.toFixed(2)} vs ${landRaw.toFixed(2)})`);
  const a = blended.at(-1), b = raw.at(-1);
  check(Math.abs(a.rot - b.rot) < 1e-3 && Math.abs(a.sy - b.sy) < 1e-3 && Math.abs(a.lift - b.lift) < 1e-2, "blended: the landing converges to the plain landing pose");
  const P2 = { sx: 0.8, sy: 1.1, rot: 0.1, lift: -3 }; C.blendLanding({}, D + 10, D, P2);
  check(P2.sx === 0.8 && P2.rot === 0.1, "blendLanding: no flight frame seen here = the pose is unchanged");
}

console.log(failed ? `${failed} FAILED` : "all carry-fallback checks passed");
process.exit(failed ? 1 : 0);
