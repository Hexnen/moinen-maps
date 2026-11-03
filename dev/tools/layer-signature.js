// Paste into a lane GM tab (needs H = perf-harness import as `H`: window.H = await import("/modules/moinen-maps/dev/perf-harness.mjs")). Returns a hash/ink signature of the destruction layer at a scale.
window.sig = async (scale = 1) => {
  const d = game.modules.get("moinen-maps").api.destruction.display();
  const hid = [];
  for (const g of d.order) for (const ch of g.cont.children) if (ch !== g.patch && ch !== g.baseCont && ch !== g.shardCont && ch.visible) { ch.visible = false; hid.push(ch); }
  try {
    const r = canvas.dimensions.sceneRect;
    canvas.pan({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), scale });
    await new Promise(r => setTimeout(r, 300)); H.step(6);
    const a = H.grab(); let h = 2166136261, nz = 0, sum = 0;
    const B = 16, W = 1024, Hh = 768, blocks = new Array(B * B).fill(0);
    for (let i = 0; i < a.length; i++) { h = Math.imul(h ^ a[i], 16777619); }
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; const v = a[i] + a[i + 1] + a[i + 2]; if (a[i + 3]) nz++; blocks[((y * B / Hh) | 0) * B + ((x * B / W) | 0)] += v; }
    return { hash: (h >>> 0).toString(16), nz, blocks: blocks.map(v => Math.round(v / (W * Hh / (B * B)))) , scale};
  } finally { hid.forEach(c => { c.visible = true; }); }
};
'sig defined'
