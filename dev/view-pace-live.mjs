// VIEW PACING UNDER LOAD, live (page module; dev/view-pace-live-run.mjs drives it): the real ticker on the real display (the page must
// be fronted), a ticker listener burning CPU each drawn frame, and the gate of scripts/view-smooth.mjs with its period held to the
// display's stable one (new) or its own trimmed mean alone (old: CONFIG.moinenMaps.viewStable = false). Measured per run:
//  - the cadence: drawn-frame gaps p50 / p95, the share of irregular steps (a gap more than 2 ms off the one before), fps, k;
//  - a pan (canvas.animatePan across and back): its gaps p95 / max and irregular share;
//  - input latency: wheel notches (a WheelEvent on the canvas) to the first drawn frame that shows the new zoom.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (a, f) => { if ( !a.length ) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const r2 = (x) => (x === null ? null : Math.round(x * 100) / 100);
const cadence = (t) => {
  const g = t.slice(1).map((x, i) => x - t[i]); let irr = 0;
  for ( let i = 1; i < g.length; i++ ) if ( Math.abs(g[i] - g[i - 1]) > 2 ) irr++;
  return { n: g.length, p50: r2(q(g, 0.5)), p95: r2(q(g, 0.95)), max: r2(q(g, 1)), irregular: r2(irr / Math.max(1, g.length - 1)), fps: r2(1000 / (g.reduce((a, b) => a + b, 0) / Math.max(1, g.length))) };
};

/** `burn`: 0, a number (ms a frame) or "vary" (4-28 ms, changing frame to frame); `stable` false = the old period estimate. */
export async function measure({ burn = 0, stable = true, secs = 6 } = {}) {
  const T = canvas.app.ticker, cm = (CONFIG.moinenMaps ??= {}), was = cm.viewStable;
  if ( stable ) delete cm.viewStable; else cm.viewStable = false;
  const work = () => (burn === "vary" ? 16 + 12 * Math.sin(performance.now() * 0.37) * Math.cos(performance.now() * 0.013) : burn);
  let on = false;
  const burner = () => { if ( !on ) return; const e = performance.now() + work(); while ( performance.now() < e ); };
  let rec = null;
  const look = () => { if ( rec ) rec.push(T.lastTime); };
  T.add(burner, null, PIXI.UPDATE_PRIORITY.HIGH); T.add(look, null, PIXI.UPDATE_PRIORITY.UTILITY);
  const out = { burn, stable };
  try {
    canvas.pan({ x: 768, y: 512, scale: 1 }); await sleep(2500);       // (idle: the display's rate measured)
    on = true; await sleep(2500);                                        // (the load settles)
    rec = []; await sleep(secs * 1000); out.cadence = cadence(rec);
    out.pacing = game.modules.get("moinen-maps").api.view.pacing();
    // a pan across and back
    rec = [];
    await canvas.animatePan({ x: 1200, y: 700, scale: 1.4, duration: 1500 }); await canvas.animatePan({ x: 768, y: 512, scale: 1, duration: 1500 });
    out.pan = cadence(rec); rec = null;
    // input latency: 12 wheel notches, 350 ms apart, in and out
    const lat = [], view = canvas.app.view, R = view.getBoundingClientRect();
    for ( let i = 0; i < 12; i++ ) {
      const s0 = canvas.stage.scale.x;
      let hit = null; const seen = () => { if ( hit === null && Math.abs(canvas.stage.scale.x - s0) > 1e-6 ) hit = performance.now(); };
      T.add(seen, null, PIXI.UPDATE_PRIORITY.UTILITY);
      const t0 = performance.now();
      view.dispatchEvent(new WheelEvent("wheel", { deltaY: i % 2 ? 100 : -100, clientX: R.left + R.width / 2, clientY: R.top + R.height / 2, bubbles: true, cancelable: true }));
      await sleep(350); T.remove(seen);
      if ( hit !== null ) lat.push(hit - t0);
    }
    out.wheel = { n: lat.length, p50: r2(q(lat, 0.5)), p95: r2(q(lat, 0.95)), max: r2(q(lat, 1)) };
  } finally {
    on = false; T.remove(burner); T.remove(look);
    if ( was === undefined ) delete cm.viewStable; else cm.viewStable = was;
  }
  return out;
}
