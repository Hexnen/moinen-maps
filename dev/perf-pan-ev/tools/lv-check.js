// P1: with a LockView bounding box on (GM set it up), every camera move must stay inside it: canvas.pan / animatePan / a drag,
// and the strip still follows. Returns per move the view rect vs the box and whether the viewbox emit ran.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const box = canvas.scene.drawings.find((d) => d.flags?.LockView?.boundingBox);
if ( !box ) return "no box";
const B = { x0: box.x, y0: box.y, x1: box.x + box.shape.width, y1: box.y + box.shape.height };
let emits = 0; const oe = lockView.socket.emitViewbox.bind(lockView.socket); lockView.socket.emitViewbox = function () { emits++; return oe(); };
const view = () => { const s = canvas.stage.scale.x, c = canvas.stage.pivot; return { x0: c.x - innerWidth / 2 / s, y0: c.y - innerHeight / 2 / s, x1: c.x + innerWidth / 2 / s, y1: c.y + innerHeight / 2 / s, s }; };
const inside = (v) => v.x0 >= B.x0 - 1 && v.y0 >= B.y0 - 1 && v.x1 <= B.x1 + 1 && v.y1 <= B.y1 + 1;
const out = { applyLocks: lockView.locks.applyLocks, bb: lockView.locks.boundingBox, box: B, moves: [] };
const watch = async (name, fn) => {
  let frames = 0, outside = 0, worst = 0; emits = 0; let on = true;
  const f = () => { if ( !on ) return; frames++; const v = view(); if ( !inside(v) ) { outside++; worst = Math.max(worst, B.x0 - v.x0, B.y0 - v.y0, v.x1 - B.x1, v.y1 - B.y1); } requestAnimationFrame(f); };
  requestAnimationFrame(f); await fn(); await sleep(300); on = false;
  const v = view(); out.moves.push({ name, frames, outside, worstPx: +worst.toFixed(1), emits, end: { x: +canvas.stage.pivot.x.toFixed(1), y: +canvas.stage.pivot.y.toFixed(1), s: +v.s.toFixed(4) } });
};
const mid = { x: (B.x0 + B.x1) / 2, y: (B.y0 + B.y1) / 2 };
await canvas.animatePan({ ...mid, scale: 0.5, duration: 0 }); await sleep(300);
await watch("pan far left", async () => { canvas.pan({ x: B.x0 - 3000, y: mid.y, scale: 0.5 }); await sleep(200); });
await watch("animatePan far right", () => canvas.animatePan({ x: B.x1 + 3000, y: mid.y, scale: 0.5, duration: 900 }));
await watch("animatePan far up zoom out", () => canvas.animatePan({ x: mid.x, y: B.y0 - 3000, scale: 0.15, duration: 900 }));
await watch("back to middle", () => canvas.animatePan({ ...mid, scale: 0.5, duration: 600 }));
lockView.socket.emitViewbox = oe;
return out;
