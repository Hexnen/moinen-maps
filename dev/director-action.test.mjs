// THE ACTION CAMERA OF A DRIVEN FIGHT, the pure parts (scripts/director/action-core.mjs; dev/zones-api.md 39):   node dev/director-action.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = (f) => import(pathToFileURL(path.join(root, f)).href);
const AC = await load("scripts/director/action-core.mjs"), SC = await load("scripts/director/stage-core.mjs"), BC = await load("scripts/zones/board-core.mjs");
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// a 1600x900 window; the free stretch: under a 100 px tracker, above a 160 px dock, left of a 300 px sidebar
const rect = { x: 0, y: 100, w: 1300, h: 640 }, view = { x: 1000, y: 1000, scale: 1, vw: 1600, vh: 900 };
const box = (cx, cy, r = 50) => ({ x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r });
const at = (c) => ({ ...view, x: c.x, y: c.y, scale: c.scale });

/* ---- the switch: the action camera is its own setting; "all", "turn" and "off" play no shot */
ok(BC.FOLLOW.includes("action") && BC.followOf("action") === "action" && BC.followOf("auto", "action") === "action" && BC.followOf("turn", "action") === "turn" && BC.followOf("auto") === "all", "follow: the action camera is a choice and a default; without either the old default stands");
const st0 = { turn: "1:a", out: null, ownAt: -Infinity };
ok(AC.shotGate(st0, { follow: "action" }) === null, "gate: the action camera, a free hand: plays");
ok(AC.shotGate(st0, { follow: "off" }) === "off" && AC.shotGate(st0, { follow: "turn" }) === "level" && AC.shotGate(st0, { follow: "all" }) === "level" && AC.shotGate(st0) === "level", "gate: off, turned down, the old 'all', nothing said: no shot");
ok(AC.shotGate(st0, { follow: "action", held: true }) === "held" && AC.shotGate(st0, { follow: "action", screen: true }) === "busy" && AC.shotGate(st0, { follow: "action", covered: true }) === "covered", "gate: a held camera, the map's own take-over, a window over the map");
ok(AC.shotGate(st0, { follow: "action", busy: true }) === "hand", "gate: the user's hand on the map");
ok(AC.shotGate({ ...st0, out: "1:a" }, { follow: "action" }) === "hand" && AC.shotGate({ ...st0, out: "1:b" }, { follow: "action" }) === null, "gate: a shot cut this turn silences the rest of that turn only");
ok(AC.shotGate({ ...st0, ownAt: 1000 }, { follow: "action", now: 3000, backMs: 5000 }) === "hand" && AC.shotGate({ ...st0, ownAt: 1000 }, { follow: "action", now: 7000, backMs: 5000 }) === null, "gate: the user's own camera move is left alone for the stage's seconds");
ok(AC.shotGate(st0, { follow: "off", held: true, busy: true }) === "off", "gate: the switch is said first");

/* ---- how each beat is played */
const P = (b, o) => AC.beatPlan(b, o);
ok(P("nonsense") === null && P("close") === null, "plan: an unknown beat and 'close' have no staging");
for ( const bars of ["hits", "attacks", "never"] ) {
  const open = P("open", { bars, away: true }), hit = P("hit", { bars, away: true }), miss = P("miss", { bars, away: true }), kill = P("kill", { bars, away: true }), rev = P("reveal", { bars, away: true }), mv = P("move", { bars, away: true });
  ok(open.rest && !open.back && open.impact === 0 && open.bars === (bars === "attacks"), `plan (${bars}): an opening waits at the pair, without a blow; bars only for 'every attack'`);
  ok(hit.back && !hit.rest && hit.impact === 1 && hit.bars === (bars !== "never"), `plan (${bars}): a hit has the blow and goes back`);
  ok(miss.back && miss.impact === 0 && miss.bars === (bars === "attacks"), `plan (${bars}): a miss has no blow`);
  ok(kill.back && kill.impact === 2 && kill.push && kill.bars === (bars !== "never") && kill.hold > hit.hold, `plan (${bars}): a kill is the strongest and the longest`);
  ok(rev.back && rev.impact === 0 && rev.bars === (bars !== "never"), `plan (${bars}): a reveal`);
  ok(mv.back && mv.follow && !mv.bars && mv.impact === 0, `plan (${bars}): a walk is followed, never with bars`);
}
for ( const b of ["open", "hit", "miss", "kill", "reveal", "move"] ) {
  const inPlace = P(b, { away: false }), quiet = P(b, { away: false, still: true });
  ok(!inPlace.back && !inPlace.rest && !inPlace.push, `plan: ${b} in place never sends the view anywhere`);
  ok(!quiet.back && !quiet.rest && !quiet.push && !quiet.follow, `plan: ${b} for a user with a question moves nothing`);
}
ok(!P("kill", { away: true, reduced: true }).push, "plan: no push-in under reduced motion");
ok(AC.RANK.kill > AC.RANK.hit && AC.RANK.hit > AC.RANK.miss && AC.RANK.miss > AC.RANK.open, "rank: kill over hit over miss over the opening");
ok(Object.values(AC.TIMES.hold).every((ms) => ms <= 2200) && AC.TIMES.lead * 1.9 + AC.TIMES.hold.kill + AC.TIMES.back < 4000, "times: no beat holds the view longer than 4 s from its first frame to the view being back");

/* ---- where the camera goes */
ok(AC.shotCamera([], view, rect) === null && AC.shotCamera([{ x0: NaN }], view, rect) === null, "camera: nothing named: nothing");
ok(AC.shotCamera([box(700, 950), box(900, 1050)], view, rect, { base: 1 }) === null, "camera: the pair stands in the free stretch: in place");
for ( const sc of [0.5, 1, 2] ) {
  const v = { ...view, scale: sc }, c = AC.shotCamera([box(4000, 3000), box(4300, 3100)], v, rect, { base: sc });
  ok(!!c && c.scale >= sc * SC.ZOOM_BAND[0] - 1e-9 && c.scale <= sc * SC.ZOOM_BAND[1] + 1e-9, `camera: off screen at zoom ${sc}: a view within the zoom band of the user's own`);
  ok(SC.comfortable(box(4000, 3000), at(c), rect, 0) && SC.comfortable(box(4300, 3100), at(c), rect, 0), `... that holds both (zoom ${sc})`);
  ok(c.ms >= AC.TIMES.lead * 0.8 && c.ms <= AC.TIMES.lead * 1.9, `... in a glide of bounded length (zoom ${sc})`);
  const r = AC.shotCamera([box(4000, 3000), box(4300, 3100)], v, rect, { base: sc, reduced: true });
  ok(!!r && r.scale === sc, `camera: reduced motion (and a walk) never changes the zoom (zoom ${sc})`);
}
const far = AC.shotCamera([box(6000, 1000), box(1000, 1000)], view, rect, { base: 1 });
ok(!!far && SC.comfortable(box(6000, 1000), at(far), rect, 0) && far.scale >= SC.ZOOM_BAND[0] - 1e-9, "camera: a pair too far apart: the focus whole, the zoom still inside the band");
ok(AC.inSight(box(700, 950), view, rect) && !AC.inSight(box(4000, 3000), view, rect) && !AC.inSight(box(700, 60), view, rect), "in sight: on the free stretch, not off screen, not under a bar");
const push = AC.pushCamera(box(1100, 1000), view, [0.1, 3]);
ok(push.scale > 1 && push.scale <= 1.07 && push.x > view.x && push.x < 1100, "push: a little closer, toward the focus");
ok(AC.pushCamera(box(1100, 1000), { ...view, scale: 3 }, [0.1, 3]).scale === 3, "push: never past the canvas zoom limit");

/* ---- HIDDEN INFORMATION: what this client is not shown changes nothing, and a concealed focus plays nothing.
   The Foundry side hands frameSubjects() only the boxes of tokens the canvas draws for this user (source-stage.mjs seenTok). */
let seed = 20261112; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const J = (x) => JSON.stringify(x);
let moved = 0, changed = 0;
for ( let i = 0; i < 600; i++ ) {
  const sc = [0.5, 1, 1.6][i % 3], v = { ...view, scale: sc, x: 800 + rnd() * 3000, y: 600 + rnd() * 2000 };
  const shown = { a: box(500 + rnd() * 4000, 400 + rnd() * 2600), b: box(500 + rnd() * 4000, 400 + rnd() * 2600) };
  const hidden = { h: box(500 + rnd() * 4000, 400 + rnd() * 2600) };
  const boxOf = (id) => shown[id] ?? null;                                    // the canvas of this user draws a and b, never h
  const withH = SC.frameSubjects(["a", "h", "b"], boxOf), without = SC.frameSubjects(["a", "b"], boxOf);
  const c1 = AC.shotCamera(withH, v, rect, { base: sc }), c0 = AC.shotCamera(without, v, rect, { base: sc });
  ok(J(c1) === J(c0), `hidden ${i}: a concealed token named with the others changes nothing of the camera`);
  ok(SC.frameSubjects(["h", "a", "b"], boxOf) === null, `hidden ${i}: a concealed focus: no subject at all, so no shot`);
  if ( c0 ) moved++;
  /* the control: were it shown, the camera would differ (so the equality above is not empty) */
  const cs = AC.shotCamera(SC.frameSubjects(["a", "h", "b"], (id) => shown[id] ?? hidden[id] ?? null), v, rect, { base: sc });
  if ( J(cs) !== J(c0) ) changed++;
  for ( const b of ["open", "hit", "miss", "kill", "reveal", "move"] ) ok(J(AC.beatPlan(b, { away: !!c1 })) === J(AC.beatPlan(b, { away: !!c0 })), `hidden ${i}: ... nor of how the ${b} is played`);
}
ok(moved > 200 && changed > 200, `hidden: the layouts did move the camera (${moved}) and a shown third token would have changed it (${changed})`);
ok(same(SC.frameSubjects([], () => null), []), "hidden: nothing named: nothing");

console.log(`director-action: ${n} checks passed`);
