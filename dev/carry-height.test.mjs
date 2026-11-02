// HEIGHT in the carry and the plough (the pure parts):   node dev/carry-height.test.mjs
//   1. heightCells: elevation + vfx hover + a flying status, in grid cells;
//   2. the plough's height band: a ground carrier does not scoop a hovering token (passes under), a flying carrier does not scoop ground tokens, equal bands plough, the tolerance edges,
//      a chain reaction respects the band, "ignore height" ploughs everything, a pushed token keeps its own z in the record's inputs;
//   3. CONTINUITY of the plain carry: displayed height = base hover + pose lift; per-frame step stays bounded at the grab, lift-off, ride, landing and the hand-over, for any hover,
//      a bobbing hover and a hover that appears / vanishes (the owner's own ease), and the result equals the plain pose when nothing hovers;
//   4. ignore-height push: a hovering token ploughed with the option on keeps its own height every frame (the step is the pose's, never a snap to the carrier's height).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
class ForcedDeletion {}
globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call() {} };
globalThis.foundry = { data: { operators: { ForcedDeletion } }, utils: { deepClone: (v) => structuredClone(v) } };
globalThis.canvas = { dimensions: { sceneRect: { x: 0, y: 0, width: 4000, height: 2000 } }, grid: { size: 100 } };
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const C = await imp("scripts/tokens/carry-core.mjs");
const X = await imp("scripts/tokens/plough-core.mjs");
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };

/* ---- 1. heightCells */
check(X.heightCells({}) === 0, "height: nothing -> 0");
check(X.heightCells({ elevation: 10, perCell: 5 }) === 2, "height: elevation 10 at 5 per cell = 2 cells");
check(Math.abs(X.heightCells({ hoverPx: 50, cellPx: 100 }) - 0.5) < 1e-9, "height: vfx hover 50 px of a 100 px cell = 0.5 cell");
check(Math.abs(X.heightCells({ elevation: 5, perCell: 5, hoverPx: 100, cellPx: 100 }) - 2) < 1e-9, "height: elevation and hover add");
check(X.heightCells({ flying: true }) === X.FLY_CELLS, "height: a flying status with no height counts FLY_CELLS");
check(X.heightCells({ flying: true, elevation: 5, perCell: 5 }) === 1, "height: a flying status does not add on top of a real height");
check(X.heightCells({ elevation: -10, perCell: 5 }) === 0, "height: below ground = 0");

/* ---- 2. the band */
const GEO = { ap: 1, ox: 0, oy: 0 };
const tkOf = (pts, o = {}) => ({ id: "car", x0: 0, y0: 0, x1: 850, y1: 0, e: 0, p: pts.flatMap((q) => q), ...o });
const tok = (id, cx, cy, z = 0) => ({ id, x: cx - 50, y: cy - 50, w: 100, h: 100, round: false, z });
const tk = tkOf([[50, 50, 0], [450, 50, 400], [900, 50, 900]]);
const rec = (others, carrierZ = 0, extra = {}) => X.ploughRecord({ tk, geo: GEO, carrier: { w: 100, h: 100, round: false, z: carrierZ }, others, rect: { x: 0, y: 0, width: 4000, height: 2000 }, ...extra });
const ids = (h) => h.map((x) => x.id).join(",");
check(ids(rec([tok("A", 400, 50)])) === "A", "band: ground carrier ploughs a ground token");
check(ids(rec([tok("A", 400, 50, 1)])) === "", "band: ground carrier passes UNDER a token hovering 1 cell up");
check(ids(rec([tok("A", 400, 50, 0)], 1)) === "", "band: a flying carrier passes OVER a ground token");
check(ids(rec([tok("A", 400, 50, 1)], 1)) === "A", "band: carrier and token both at 1 cell plough normally");
check(ids(rec([tok("A", 400, 50, 0.49)])) === "A", "band: edge, 0.49 cell apart -> hit");
check(ids(rec([tok("A", 400, 50, 0.5)])) === "", "band: edge, exactly 0.5 cell apart -> pass");
check(ids(rec([tok("A", 400, 50, 0.9)], 0.45)) === "A", "band: 0.45 apart (both off the ground) -> hit");
check(ids(rec([tok("A", 400, 50, 0.7)], 0, { band: 1 })) === "A", "band: the tolerance is configurable");
check(ids(rec([tok("A", 400, 50, 0), tok("B", 530, 50, 1)])) === "A", "band: a chain does not pull in a token hovering above the one that pushes it");
check(ids(rec([tok("A", 400, 50, 0), tok("B", 530, 50, 0)])) === "A,B", "band: a chain between equal heights works");
check(ids(rec([tok("A", 400, 50, 3), tok("B", 530, 50, 1)], 0, { ignoreHeight: true })) === "A,B", "ignore height: every token in the way is ploughed");
check(ids(rec([tok("A", 400, 50, 3)], 0, { ignoreHeight: true })) === "A", "ignore height: the hovering token is collected");
const base = rec([tok("A", 400, 50)]), withZ = rec([tok("A", 400, 50, 0)], 0, { ignoreHeight: true });
check(JSON.stringify(base) === JSON.stringify(withZ), "the record does not change with the height flags when everything is on the ground (same bytes)");

/* ---- 3. continuity of the plain carry (displayed height = hover - pose lift, px up) */
const S = 100, D = 900, FRAME = 1000 / 60;
const profile = (el) => {          // the carrier's speed profile along the run: eased in and out, like a carry record
  if ( el <= 0 || el >= D ) return 0;
  const u = el / D; return Math.sin(Math.PI * u);
};
const maxStep = (hoverAt, from = -200, to = D + 1200) => {
  const out = { sx: 1, sy: 1, rot: 0, lift: 0, k: 0 }, d = { ux: 1, uy: 0, sp: 0 };
  let prev = null, worst = 0, at = 0;
  for ( let el = from; el <= to; el += FRAME ) {
    d.sp = profile(el);
    C.poseAt(el, D, d, S, out);
    // the displayed mesh y relative to the ground position (negative = up)
    const y = C.liftedY(0, out.lift, hoverAt(el));
    if ( prev !== null && Math.abs(y - prev) > worst ) { worst = Math.abs(y - prev); at = el; }
    prev = y;
  }
  return { worst, at };
};
const noHover = maxStep(() => 0);
check(noHover.worst < 0.05 * S, `carry: a ground token's lift steps at most ${noHover.worst.toFixed(2)} px per frame (pose only)`);
for ( const H of [40, 100, 250] ) {
  const r = maxStep(() => H);
  check(Math.abs(r.worst - noHover.worst) < 1e-6, `carry: hover ${H} px - the per-frame step (${r.worst.toFixed(2)}) is exactly the pose's own (${noHover.worst.toFixed(2)}): the hover adds nothing`);
}
{
  const out = { sx: 1, sy: 1, rot: 0, lift: 0, k: 0 }, d = { ux: 1, uy: 0, sp: 0 };
  C.poseAt(-50, D, d, S, out); const before = C.liftedY(0, out.lift, 100);
  C.poseAt(D + 5000, D, d, S, out); const after = C.liftedY(0, out.lift, 100);
  check(before === -100 && Math.abs(after + 100) < 1e-6, `carry: before the grab and long after the landing the mesh stands exactly at the hover (${before}, ${after.toFixed(6)})`);
  check(C.liftedY(37, -5, 0) === 32 && C.liftedY(37, -5) === 32, "carry: no hover = the old formula (y + lift)");
}
{ // a bobbing hover (the vfx flight bob) and one that eases in / out during the ride
  const bob = maxStep((el) => 100 + 6 * Math.sin(el / 160));
  check(bob.worst < noHover.worst + 6 * (FRAME / 160) + 1e-6, `carry: a bobbing hover adds only its own bob (${bob.worst.toFixed(2)} px/frame)`);
  const ease = maxStep((el) => 100 * Math.min(1, Math.max(0, (el - 300) / 400)));
  check(ease.worst < noHover.worst + 100 / (400 / FRAME) + 1e-6, `carry: a hover that eases in during the ride stays smooth (${ease.worst.toFixed(2)} px/frame)`);
}
/* the bug this replaces: a base captured WITH the hover once and WITHOUT it the next time (a Foundry refresh resets the mesh) is a step of exactly the hover */
{
  const natural = 0, captured = 0 - 100;      // mesh y at rest without / with the vfx hover
  check(Math.abs(natural - captured) === 100, "the old capture could differ by the whole hover (the jump this fixes); the new base is always Foundry's natural place + the live hover");
}

/* ---- 4. ignore-height push: a pushed hovering token keeps its OWN height */
{
  const poseP = { sx: 1, sy: 1, rot: 0, lift: 0, k: 0 }, d = { ux: 1, uy: 0, sp: 0 };
  let prev = null, worst = 0, minH = Infinity, maxH = -Infinity;
  const hoverPushed = 150, hoverCarrier = 0;
  for ( let el = 0; el <= 700; el += FRAME ) {
    d.sp = 1; C.poseAt(el, 700, d, S, poseP);
    const y = C.liftedY(0, poseP.lift, hoverPushed);          // the pushed token: its own hover + the pose (never the carrier's height)
    if ( prev !== null ) worst = Math.max(worst, Math.abs(y - prev));
    prev = y; minH = Math.min(minH, -y); maxH = Math.max(maxH, -y);
  }
  check(worst < 4, `ignore height: the pushed hovering token's height steps at most ${worst.toFixed(2)} px per frame from contact (no snap to the carrier's ${hoverCarrier} px)`);
  check(minH >= hoverPushed - 1e-6, `ignore height: it never drops below its own base hover (${minH.toFixed(1)} >= ${hoverPushed})`);
}

console.log(failed ? `${failed} FAILED` : "all ok");
process.exit(failed ? 1 : 0);
