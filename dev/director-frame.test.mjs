// FRAMING WHAT A COMBAT MODULE NAMES, the pure parts (scripts/director/stage-core.mjs; dev/zones-api.md 38):   node dev/director-frame.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SC = await import(pathToFileURL(path.join(root, "scripts/director/stage-core.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// a 1600x900 window; the free stretch: under a 100 px tracker, above a 160 px dock, left of a 300 px sidebar
const rect = { x: 0, y: 100, w: 1300, h: 640 }, view = { x: 1000, y: 1000, scale: 1, vw: 1600, vh: 900 };
const box = (cx, cy, r = 50) => ({ x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r });
const scr = (b, v) => SC.toScreenBox(b, { ...view, ...v });
const inside = (b, v, f = 0) => SC.comfortable(b, { ...view, ...v }, rect, f - 1e-9);

/* nothing moves for what is on screen; the zoom is never changed */
ok(SC.framePlan([], view, rect) === null && SC.framePlan([{ x0: NaN }], view, rect) === null, "no subject: null");
ok(same(SC.framePlan([box(850, 970)], view, rect), { moved: false }), "in the free stretch: nothing moves");
for ( const sc of [0.4, 1, 2.3] ) {
  const v = { ...view, scale: sc }, p = SC.framePlan([box(4000, 3000)], v, rect);
  ok(p.moved && p.scale === sc, `off screen at zoom ${sc}: a move at the same zoom`);
  ok(SC.comfortable(box(4000, 3000), { ...v, x: p.x, y: p.y }, rect, SC.FRAME_F), `... and it ends inside the free stretch (zoom ${sc})`);
}
/* the least slide: a subject off one side moves the view along that axis only, and no further than FRAME_IN inside */
const right = SC.framePlan([box(1900, 970)], view, rect);
ok(right.moved && Math.abs(right.y - view.y) < 1e-6 && right.x > view.x, "off the right edge: a slide to the right only");
ok(Math.abs(scr(box(1900, 970), right).x1 - (rect.x + rect.w * (1 - SC.FRAME_IN))) < 1e-6, "... by the least that puts it FRAME_IN inside");
/* under the dock (screen y 760..860): out from under it; under the tracker: down */
const under = SC.framePlan([box(850, 1360)], view, rect);
ok(under.moved && under.y > view.y && Math.abs(under.x - view.x) < 1e-6 && scr(box(850, 1360), under).y1 <= rect.y + rect.h, "under the dock: slid out from under it");
const over = SC.framePlan([box(850, 620)], view, rect);
ok(over.moved && over.y < view.y && scr(box(850, 620), over).y0 >= rect.y, "under the tracker: slid out from under it");
/* several that fit come in together; the result is whole */
const pair = SC.framePlan([box(1900, 970), box(1500, 800)], view, rect);
ok(pair.moved && pair.whole && inside(box(1900, 970), pair, SC.FRAME_F) && inside(box(1500, 800), pair, SC.FRAME_F), "a pair that fits: both in");
/* a pair that does not fit at the user's zoom: the focus whole, the frame leans toward the other, the zoom stays */
const wide = SC.framePlan([box(5000, 1000), box(1000, 1000)], view, rect);
ok(wide.moved && !wide.whole && wide.scale === 1 && inside(box(5000, 1000), wide, 0), "too far apart: the focus is whole in the frame");
ok(scr(box(5000, 1000), wide).x0 > rect.x + rect.w / 2, "... and the frame leans toward the other one (the focus stands on its far side)");
ok(same(SC.framePlan([box(850, 970), box(9000, 9000)], view, rect), { moved: false }), "too far apart with the focus on screen: nothing moves");
ok(same(SC.framePlan([box(850, 970), box(9000, 9000)], view, rect, { fit: false }), { moved: false }) && SC.framePlan([box(9000, 9000), box(850, 970)], view, rect, { fit: false }).moved, "fit: false = the focus alone");
/* a longer way takes longer, within bounds */
const a = SC.framePlan([box(1900, 970)], view, rect), b = SC.framePlan([box(9000, 970)], view, rect);
ok(b.ms > a.ms && a.ms >= 315 && b.ms <= 924, "the glide: longer for a longer way, 0.75..2.2 x the base");

/* HIDDEN INFORMATION: a token this client is not shown never moves the view, and the view never leans toward it */
const shown = { hero: box(850, 970), foe: box(1900, 970) };          // "ghost" is not drawn for this user
const boxOf = (id) => shown[id] ?? null;
ok(SC.frameSubjects(["ghost", "hero"], boxOf) === null, "a focus this user is not shown: nothing is framed");
ok(same(SC.frameSubjects(["foe", "ghost", "hero"], boxOf), [shown.foe, shown.hero]), "a token not shown is left out");
ok(same(SC.frameSubjects([], boxOf), []) && SC.frameSubjects(["x"], () => { throw new Error("x"); }) === null, "no ids / a lookup that throws");
// wherever the ghost stands, the plan is the plan without it
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let moves = 0, differs = 0;
for ( let i = 0; i < 400; i++ ) {
  const v = { ...view, x: rnd() * 6000, y: rnd() * 6000, scale: 0.3 + rnd() * 2 };
  const pos = { hero: box(rnd() * 6000, rnd() * 6000), foe: box(rnd() * 6000, rnd() * 6000) };
  const ghost = box(rnd() * 6000, rnd() * 6000), look = (id) => pos[id] ?? null, all = (id) => (id === "ghost" ? ghost : pos[id] ?? null);
  const without = SC.framePlan(SC.frameSubjects(["foe", "hero"], look), v, rect);
  const withG = SC.framePlan(SC.frameSubjects(["foe", "ghost", "hero"], look), v, rect);
  ok(same(without, withG), "the plan does not depend on a token this user is not shown");
  if ( !same(SC.framePlan(SC.frameSubjects(["foe", "ghost", "hero"], all), v, rect), without) ) differs++;      // (control: were it shown, the plan would differ)
  if ( without?.moved ) { moves++; ok(without.scale === v.scale, "never a zoom"); ok(SC.comfortable(pos.foe, { ...v, x: without.x, y: without.y }, rect, 0), "the focus ends whole in the free stretch"); }
}
ok(moves > 100 && differs > 20, "control: the runs do move the view, and a shown third token does change the plan");

/* THE GATE: the switch, the hand, the take-back */
const st = SC.newStage(); st.turn = "1:a";
const g = (o) => SC.frameGate(st, { follow: "turn", now: 100000, ...o });
ok(g({}) === null && g({ level: "all" }) === "level" && SC.frameGate(st, { follow: "all", level: "all", now: 1e5 }) === null, "level: a beat for 'all' does not play for 'turn'");
ok(SC.frameGate(st, { follow: "off", hand: true, now: 1e5 }) === "off", "off is off, also for the user's own act");
ok(g({ held: true }) === "held" && g({ screen: true }) === "busy" && g({ busy: true }) === "hand" && g({ busy: true, hand: true }) === "hand", "a held camera, a busy screen, a hand on the map");
st.ownAt = 98000;
ok(g({}) === "hand" && g({ hand: true }) === null && g({ now: 104000 }) === null, "the user moved the camera: quiet for `back` seconds, not for their own act");
st.ownAt = -Infinity; st.out = "1:a";
ok(g({}) === "hand" && g({ hand: true }) === null, "'My view' this turn: no more moves this turn");
SC.turnChange(st, "1:b", false, false);
ok(g({}) === null, "... the next turn is framed again");

/* home / parked: what "My view" goes back to */
const s2 = SC.newStage(), v0 = { x: 10, y: 20, scale: 1 }, t1 = { x: 500, y: 20, scale: 1 }, t2 = { x: 900, y: 20, scale: 1 };
SC.frameStart(s2, v0); SC.frameEnd(s2, t1, true, false, 1);
ok(same(s2.home, v0) && same(s2.parked, t1), "after a frame: home = the user's view, parked = where it went");
SC.frameStart(s2, t1); SC.frameEnd(s2, t2, true, false, 2);
ok(same(s2.home, v0) && same(s2.parked, t2), "a second frame keeps the first home");
SC.frameSettle(s2);
ok(s2.home === null && s2.parked === null, "not asked for in time: the view is the user's");
SC.frameStart(s2, v0); SC.frameEnd(s2, t1, false, false, 77);
ok(s2.home === null && s2.parked === null && s2.ownAt === 77, "the user stopped the move: the camera is theirs, quiet from now");
SC.frameStart(s2, v0, true); SC.frameEnd(s2, t1, true, true, 3);
ok(s2.home === null && s2.parked === null, "the user's own act leaves no 'My view'");

/* a driven fight: which director shots stand down */
const toks = new Set(["t1", "t2"]);
ok(SC.drivenShot({ kind: "turn", lane: "cbt-c1" }, "c1", toks) && SC.drivenShot({ kind: "attack" }, "c1", toks) && SC.drivenShot({ kind: "damage" }, "c1", toks) && SC.drivenShot({ kind: "roll" }, "c1", toks), "turn, attack, roll, damage stand down");
ok(SC.drivenShot({ kind: "move", tokens: ["t2"] }, "c1", toks) && !SC.drivenShot({ kind: "move", tokens: ["zz"] }, "c1", toks), "a combatant's move stands down, a bystander's does not");
ok(!SC.drivenShot({ kind: "destruction" }, "c1", toks) && !SC.drivenShot({ kind: "fire" }, "c1", toks) && !SC.drivenShot({ kind: "turn" }, null, toks), "the map's own events play as before; no fight: nothing stands down");
/* uxd (U142) fit "near": the focus and, nearest first, as many of the others as fit with it at the user's zoom */
{
  const mover = box(850, 970), near1 = box(1450, 970), near2 = box(1650, 970), far = box(4000, 970);
  const all = SC.framePlan([mover, near1, near2, far], view, rect);
  ok(same(all, { moved: false }), "fit true, all of them too wide, the focus on screen: nothing moves (what U142 saw: zones off screen)");
  const n0 = SC.framePlan([mover, near1, near2, far], view, rect, { fit: "near" });
  const at = { ...view, x: n0.x, y: n0.y };
  ok(n0.moved && SC.comfortable(mover, at, rect, 0) && SC.comfortable(near1, at, rect, 0) && SC.comfortable(near2, at, rect, 0) && !SC.comfortable(far, at, rect, 0) && n0.whole === false, "fit near: the mover and the two nearest zones come in, the far one is left out");
  ok(same(SC.framePlan([mover, box(900, 900)], view, rect, { fit: "near" }), { moved: false }), "fit near, all of them on screen: nothing moves");
  ok(SC.framePlan([mover, near1], view, rect, { fit: "near" }).whole === true, "fit near, all of them fit: whole");
}
/* uxd (U142) avoidRect: a panel narrows the free stretch like a window; a panel that would leave no room is passed over */
{
  const r = { x: 100, y: 80, w: 1150, h: 640 };
  ok(SC.avoidRect(r, []) === r && SC.avoidRect(r, null) === r, "no panels: the stretch as it was");
  const desk = { x0: 897, y0: 362, x1: 1240, y1: 675 }, band = { x0: 935, y0: 50, x1: 1240, y1: 275 };
  const a = SC.avoidRect(r, [desk, band]);
  ok(a.x === 100 && a.x + a.w === 897 && a.y === 80 && a.h === 640, `a GM's desk and challenges band at the right: the stretch left of them (${JSON.stringify(a)})`);
  ok(same(SC.avoidRect(r, [{ x0: 0, y0: 0, x1: 2000, y1: 2000 }]), r), "a panel over everything: passed over, the stretch stands");
  ok(same(SC.avoidRect(r, [{ x0: 2000, y0: 0, x1: 2100, y1: 50 }]), r), "a panel off the stretch: nothing changes");
  const party = SC.avoidRect(r, [{ x0: 0, y0: 460, x1: 170, y1: 740 }]);
  ok(party.x === 170 && party.w === 1080 && party.h === 640, "a party panel at the left: the stretch right of it");
}
console.log(`director-frame: ${n} checks passed`);
