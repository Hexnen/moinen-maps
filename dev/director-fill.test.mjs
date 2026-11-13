// fxm2 (U206, FF6): the GM's turn camera framed The Immortal at the map's edge - most of the screen the black void past the scene's
// edge, the actor's zone under the Pins panel. A frame that moves (stage-core framePlan with `scene`) now slides on toward showing the
// map as far as the subject stays FRAME_IN inside the free stretch; the map's own panels narrow the stretch (source-stage avoidBoxes).
import assert from "node:assert/strict";
import * as SC from "../scripts/director/stage-core.mjs";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const box = (cx, cy, h = 60) => ({ x0: cx - h, y0: cy - h, x1: cx + h, y1: cy + h });
const inside = (b, view, rect, f) => SC.comfortable(b, view, rect, f - 1e-9);
const voidPx = (view, rect, scene) => {        // screen px of the stretch not covered by the scene, per axis
  const s = SC.toScreenBox(scene, view);
  return [Math.max(0, s.x0 - rect.x) + Math.max(0, rect.x + rect.w - s.x1), Math.max(0, s.y0 - rect.y) + Math.max(0, rect.y + rect.h - s.y1)];
};

// the FF6 seat: 1600 x 900, the free stretch right of the Pins panel and left of the desk, under the initiative bar
const scene = { x0: 0, y0: 0, x1: 5000, y1: 5000 }, rect = { x: 320, y: 90, w: 870, h: 660 };
const base = { vw: 1600, vh: 900, scale: 0.5 };

// the actor stands near the scene's right edge, the view looks at the void right of it
{
  const view = { ...base, x: 5600, y: 2500 }, actor = box(4700, 2500);
  const old = SC.framePlan([actor], view, rect), plan = SC.framePlan([actor], view, rect, { scene });
  ok(old.moved && plan.moved, "the actor is off the stretch: the view moves");
  const vOld = { ...view, x: old.x, y: old.y }, vNew = { ...view, x: plan.x, y: plan.y };
  ok(voidPx(vOld, rect, scene)[0] > rect.w * 0.3, `before: a third of the stretch is void (${voidPx(vOld, rect, scene)[0]} px)`);
  ok(voidPx(vNew, rect, scene)[0] < rect.w * 0.01, `after: the map fills the stretch but a sliver the actor's margin needs (${voidPx(vNew, rect, scene)[0]} px void)`);
  ok(inside(actor, vNew, rect, SC.FRAME_IN), "the actor stays FRAME_IN inside the stretch");
  ok(plan.scale === view.scale, "the zoom stays the user's");
}
// the actor stands right at the scene's corner: as much map as the actor allows, the actor still comfortably inside
{
  const view = { ...base, x: 6000, y: 6000 }, actor = box(4960, 4960, 40);
  const plan = SC.framePlan([actor], view, rect, { scene }), v = { ...view, x: plan.x, y: plan.y };
  ok(inside(actor, v, rect, SC.FRAME_IN), "corner: the actor FRAME_IN inside");
  const old = SC.framePlan([actor], view, rect), vo = { ...view, x: old.x, y: old.y };
  ok(voidPx(v, rect, scene)[0] <= voidPx(vo, rect, scene)[0] && voidPx(v, rect, scene)[1] <= voidPx(vo, rect, scene)[1], "corner: never more void than the least slide");
}
// a scene smaller than the stretch: centred in it (the subject inside)
{
  const small = { x0: 0, y0: 0, x1: 1200, y1: 800 }, view = { ...base, x: 3000, y: 3000 }, actor = box(600, 400);
  const plan = SC.framePlan([actor], view, rect, { scene: small }), v = { ...view, x: plan.x, y: plan.y }, s = SC.toScreenBox(small, v);
  ok(Math.abs((s.x0 + s.x1) / 2 - (rect.x + rect.w / 2)) < 1 && Math.abs((s.y0 + s.y1) / 2 - (rect.y + rect.h / 2)) < 1, "a small scene sits in the middle of the stretch");
  ok(inside(actor, v, rect, SC.FRAME_IN), "and its subject inside");
}
// random: the fill never puts the subject outside FRAME_IN and never shows more void than the least slide; nothing on screen moves nothing
{
  let seed = 5; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for ( let i = 0; i < 2000; i++ ) {
    const sc = { x0: 0, y0: 0, x1: 1000 + rnd() * 8000, y1: 1000 + rnd() * 8000 };
    const view = { ...base, scale: 0.2 + rnd() * 1.3, x: (rnd() * 1.6 - 0.3) * sc.x1, y: (rnd() * 1.6 - 0.3) * sc.y1 };
    const actors = [box(rnd() * sc.x1, rnd() * sc.y1, 30 + rnd() * 60)];
    if ( rnd() < 0.4 ) actors.push(box(rnd() * sc.x1, rnd() * sc.y1, 30 + rnd() * 60));
    const fit = rnd() < 0.3 ? "near" : rnd() < 0.5;
    const old = SC.framePlan(actors, view, rect, { fit }), plan = SC.framePlan(actors, view, rect, { fit, scene: sc });
    if ( !old.moved ) { ok(!plan.moved, `case ${i}: on screen already: still nothing moves`); continue; }
    if ( !plan.moved ) { n++; continue; }
    const vo = { ...view, x: old.x, y: old.y }, v = { ...view, x: plan.x, y: plan.y };
    if ( inside(actors[0], vo, rect, SC.FRAME_IN) ) ok(inside(actors[0], v, rect, SC.FRAME_IN - 1e-6), `case ${i}: the focus stays inside`);
    const a = voidPx(vo, rect, sc), b = voidPx(v, rect, sc);
    ok(b[0] <= a[0] + 1e-6 && b[1] <= a[1] + 1e-6, `case ${i}: no more void than before (${a} -> ${b})`);
  }
}
console.log(`director-fill: ${n} checks passed`);
