// Tornado x fire: a scripted pass on a virtual clock with a per-frame trace.   const TF = await import("/modules/moinen-maps/dev/tornado-fire-trace.mjs")
// `await TF.setup("cross" | "beside")` paints one fire stroke and lays one tornado path across it (or 3 squares beside it), formed and
// arriving after `lead` ms; `await TF.trace(ms)` steps the shared clock at 60 fps (Date.now frozen per frame, nothing dropped) and returns
// per frame: t (s), the art pass's uLean, uWind.x (area), the fuel pass's uWind.x, the front layer's sortLayer, and the fire's glow
// (mean of R - B over the fire's screen box, frame read back) - so any STEP (a jump between two frames) shows as a number.
// `steps(rows, key)` = the largest frame-to-frame change of `key` and where.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const api = () => game.modules.get("moinen-maps").api;

export const FIRE = [[700, 640], [760, 645], [820, 640]];
export const PATHS = { cross: [[360, 610], [1150, 690]], beside: [[360, 520], [1150, 520]] };   // (the fire: x 700-820, y 640; beside = 3 squares up)

export async function setup(kind = "cross", { level = 2, speed = 1, zoom = 1.4, lead = 0 } = {}) {
  const A = api(), FM = await import("../scripts/fire/fire.mjs");
  A.weather.tornado.clear({ now: true }); A.fire.clear?.();
  await A.weather.set("clear", { over: 0 }); A.weather.lens({ on: false });
  await wait(500);
  await A.fire.paint(FIRE, { kind: "fire", radius: 34, strength: 0.9, level: 2 });
  for ( let i = 0; i < 40; i++ ) { FM.draw(); canvas.app.ticker.update(performance.now()); await wait(40); }   // (the fire grows in)
  const id = A.weather.tornado.add(PATHS[kind], { level, wander: 0, speed, end: "stop", at: Date.now() - 7000 + lead });   // (formed: 7 s, moving from the path start; it reaches the fire ~4 s later)
  canvas.pan({ x: 760, y: 560, scale: zoom });
  await wait(600);
  return id;
}

function fireBox() {
  const F = api().fire.display(), a = [...(F?.areas?.values() ?? [])][0]; if ( !a ) return null;
  const g = F.geo, b = a.area.box ?? a.area.rect, st = canvas.stage;
  const p0 = st.toGlobal({ x: g.ox + b.x0 * g.ap, y: g.oy + b.y0 * g.ap - 80 }), p1 = st.toGlobal({ x: g.ox + b.x1 * g.ap, y: g.oy + b.y1 * g.ap });
  const res = canvas.app.renderer.resolution;
  return { a, F, x: Math.max(0, Math.floor(p0.x * res)), y: Math.max(0, Math.floor(p0.y * res)), w: Math.ceil((p1.x - p0.x) * res), h: Math.ceil((p1.y - p0.y) * res) };
}

export async function trace(ms, { fps = 60, glow = true } = {}) {
  const T = canvas.app.ticker, r = canvas.app.renderer, gl = r.gl, realNow = Date.now, dt = 1000 / fps, n = Math.round(ms / dt);
  const base = realNow(), perf0 = performance.now(), rows = [];
  const fb = fireBox(); if ( !fb ) return null;
  const H = gl.drawingBufferHeight, buf = new Uint8Array(fb.w * fb.h * 4);
  let vt = base; Date.now = () => Math.floor(vt);
  try {
    for ( let i = 0; i < n; i++ ) {
      vt = base + i * dt;
      T.update(perf0 + i * dt);
      const u = fb.a.mesh.pass?.shader?.uniforms, f = fb.a.mesh.fuelPass?.shader?.uniforms;
      const row = { t: +(i * dt / 1000).toFixed(3), lean: +u.uLean.toFixed(4), wx: +u.uWind[0].toFixed(4), fwx: +(f?.uWind?.[0] ?? 0).toFixed(4), front: fb.F.front.sortLayer };
      if ( glow ) {
        r.render(canvas.app.stage);
        gl.readPixels(fb.x, H - fb.y - fb.h, fb.w, fb.h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        let s = 0; for ( let k = 0; k < buf.length; k += 4 ) { const v = buf[k] - buf[k + 2]; if ( v > 0 ) s += v; }
        row.glow = +(s / (fb.w * fb.h)).toFixed(2);
      }
      rows.push(row);
      if ( i % 20 === 0 ) await wait(1);
    }
  } finally { Date.now = realNow; }
  return rows;
}

/** The largest frame-to-frame change of `key` over the rows (and its time), and the 95th percentile of the changes. */
export function steps(rows, key) {
  let max = 0, at = 0; const d = [];
  for ( let i = 1; i < rows.length; i++ ) { const v = Math.abs(rows[i][key] - rows[i - 1][key]); d.push(v); if ( v > max ) { max = v; at = rows[i].t; } }
  d.sort((a, b) => a - b);
  return { max: +max.toFixed(4), at, p95: +(d[Math.floor(d.length * 0.95)] ?? 0).toFixed(4), range: [Math.min(...rows.map((x) => x[key])), Math.max(...rows.map((x) => x[key]))] };
}

/** Upload rows as CSV to mm-rec/<name>. */
export async function csv(name, rows) {
  const keys = Object.keys(rows[0]), txt = [keys.join(","), ...rows.map((r) => keys.map((k) => r[k]).join(","))].join("\n");
  const FP = foundry.applications.apps.FilePicker.implementation;
  return (await FP.upload("data", "mm-rec", new File([txt], name, { type: "text/csv" }), {}, { notify: false }))?.path;
}
