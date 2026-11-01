/**
 * Live regression check (paste into the console of a GM client on a scene with painted water, or run with javascript_exec):
 * the water reflections layer (scripts/water/reflect.mjs, sortLayer 248) must never stop the layers sorted above it from being drawn.
 * A sprite mask over Texture.EMPTY did exactly that (everything above 248 vanished: the destruction's dust and entries, districts,
 * lights, roads, the token rings), e.g. on the first frames after the canvas was drawn with a frozen or replayed clock.
 *
 * Probes: three squares at sortLayer 249, 250 and 260. Cases: reflections on; the layer just rebuilt with the clock frozen at 100 ms
 * (the old failure); reflections off. Every probe must show its own colour in every case. Resolves with { ok, cases }.
 */
(async () => {
  const W = await import("/modules/moinen-maps/scripts/water/water.mjs");
  const Reflect = await import("/modules/moinen-maps/scripts/water/reflect.mjs");
  const R = canvas.app.renderer, r = canvas.dimensions.sceneRect;
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const colors = [0xff0000, 0x00ff00, 0x0000ff], layers = [249, 250, 260];
  const probes = layers.map((L, k) => {
    const g = new PIXI.Graphics(); g.beginFill(colors[k]).drawRect(cx - 120 + k * 80, cy, 60, 60).endFill();
    Object.assign(g, { elevation: 0, sortLayer: L, sort: 0, _lastSortedIndex: 0, eventMode: "none" });
    canvas.primary.addChild(g); return g;
  });
  canvas.primary.sortDirty = true;
  const realNow = performance.now.bind(performance);
  const sample = () => {
    R.render(canvas.app.stage);
    const px = R.extract.pixels();
    return probes.map((g, k) => {
      const p = canvas.stage.worldTransform.apply({ x: cx - 90 + k * 80, y: cy + 30 });
      const o = (Math.round(p.y) * R.width + Math.round(p.x)) * 4;
      const want = [(colors[k] >> 16) & 255, (colors[k] >> 8) & 255, colors[k] & 255];
      return { layer: layers[k], ok: want.every((v, i) => Math.abs(px[o + i] - v) < 8), got: [px[o], px[o + 1], px[o + 2]] };
    });
  };
  const before = W.state()?.params?.reflectOn;
  const cases = {};
  try {
    W.setParams({ reflectOn: true });
    canvas.app.ticker.update(); cases.on = sample();
    // the old failure: the layer made anew and its first frames drawn with the clock frozen near 0
    performance.now = () => 100;
    Reflect.onCanvasReady(); canvas.primary.sortDirty = true;
    canvas.app.ticker.update(100); cases.frozenStart = sample();
    performance.now = realNow;
    W.setParams({ reflectOn: false }); canvas.app.ticker.update(); cases.off = sample();
  } finally {
    performance.now = realNow;
    W.setParams({ reflectOn: !!before });
    for ( const g of probes ) g.destroy();
  }
  const ok = Object.values(cases).every((c) => c.every((q) => q.ok));
  console[ok ? "log" : "error"](`moinen-maps | reflection layer check: ${ok ? "OK" : "FAILED"}`, cases);
  return { ok, cases };
})();
