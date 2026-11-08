// Tornado: look-development helpers for a lane GM page.   const D = await import("/modules/moinen-maps/dev/tornado-dev.mjs")
// `place(level, { path, x, y, ago, ... })` replaces the scene's tornadoes with one (formed `ago` ms ago), `solo([...passes])` draws only
// those passes into its art texture (null = all), `snap(name)` / `crop(name, x, y, w, h)` upload a png (crop: scene px rect, scaled up).
const W = () => game.modules.get("moinen-maps").api.weather;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const R = () => import("/modules/moinen-maps/dev/weather-rec.mjs");

export const view = () => [...(W().tornado.display()?.views.values() ?? [])][0] ?? null;

export async function place(level = 3, { path = null, x = 780, y = 600, ago = 20000, wander = 0.15, speed = 0.6, end = "loop", size = 1, zoom = 1.6, pan = true } = {}) {
  W().tornado.clear({ now: true });
  await wait(600);
  const id = W().tornado.add(path ?? [[x, y]], { level, wander, speed, end, size, at: Date.now() - ago });
  await wait(900);
  if ( pan ) { const L = W().tornado.list()[0]; canvas.pan({ x: L.x, y: L.y - 110, scale: zoom }); }
  await wait(200);
  return id;
}

const ORDER = ["curtain", "skirt", "back", "debB", "wallB", "column", "debF", "wallF", "front", "deck"];
export function solo(list = null) {
  const v = view(); if ( !v ) return;
  delete v.render;
  if ( !list ) return;
  const r = canvas.app.renderer, base = Object.getPrototypeOf(v).render;
  v.render = function() {
    let first = true;
    for ( const k of ORDER ) {
      if ( !list.includes(k) ) continue;
      r.render(this[k], { renderTexture: this.art, clear: first }); first = false;
    }
    if ( first ) r.render(this.curtain, { renderTexture: this.art, clear: true });
  };
  return base;
}

export async function snap(name, at = null) { canvas.controls.cursors.visible = false; return (await R()).snap(name, at); }

/** Hide or show the stage parts (ground, marks, show) of the tornado. */
export function stage({ ground = true, marks = true, show = true } = {}) { const v = view(); if ( !v ) return; v._stage = { ground, marks, show }; }

/** A zoom-`k` crop (nearest neighbour) of the screen rect x, y, w, h (screen px) as png `name`. */
export async function crop(name, x, y, w, h, k = 3) {
  canvas.controls.cursors.visible = false;
  canvas.app.ticker.update(performance.now()); canvas.app.renderer.render(canvas.app.stage);
  const c = Object.assign(document.createElement("canvas"), { width: w * k, height: h * k }), g = c.getContext("2d");
  g.imageSmoothingEnabled = false; g.drawImage(canvas.app.view, x, y, w, h, 0, 0, w * k, h * k);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const FP = foundry.applications.apps.FilePicker.implementation;
  const r = await FP.upload("data", "mm-rec", new File([blob], name, { type: "image/png" }), {}, { notify: false });
  return r?.path;
}

/**
 * Record `ms` of effect time on a virtual clock (as weather-rec `rec`) but encoded with WebCodecs (VP9) into an IVF file: every frame
 * is encoded with its own timestamp, so nothing is dropped even when the page is in the background (MediaRecorder drops frames
 * there). Convert: `ffmpeg -i x.ivf -c copy x.webm`. `during` = [[atMs, fn], ...]. Returns [bytes, path, frames].
 */
export async function recIvf(name, ms, { fps = 60, during = [], bitrate = 9e6 } = {}) {
  canvas.controls.cursors.visible = false;
  const V = canvas.app.view, W = V.width & ~1, H = V.height & ~1;
  const C = Object.assign(document.createElement("canvas"), { width: W, height: H }), g2 = C.getContext("2d");
  const chunks = [];
  const enc = new VideoEncoder({ output: (c) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); chunks.push([b, c.timestamp]); }, error: (e) => console.error(e) });
  enc.configure({ codec: "vp09.00.10.08", width: W, height: H, bitrate, framerate: fps });
  const T = canvas.app.ticker, mf = T.maxFPS; T.maxFPS = 0;
  const realNow = Date.now, dt = 1000 / fps, n = Math.round(ms / dt);
  const base = Math.ceil(realNow() / 1000) * 1000 + 1, perf0 = performance.now(), fired = new Set();
  let vt = base;
  Date.now = () => Math.floor(vt);
  try {
    for ( let i = 0; i < n; i++ ) {
      vt = base + i * dt;
      for ( const [at, fn] of during ) if ( i * dt >= at && !fired.has(at) ) { fired.add(at); fn(); }
      T.update(perf0 + i * dt); canvas.app.renderer.render(canvas.app.stage); g2.drawImage(V, 0, 0);
      const f = new VideoFrame(C, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      enc.encode(f, { keyFrame: i % 120 === 0 }); f.close();
      while ( enc.encodeQueueSize > 2 ) await wait(5);
      await wait(1);
    }
  } finally { Date.now = realNow; T.maxFPS = mf; }
  await enc.flush(); enc.close();
  const total = 32 + chunks.reduce((a, [b]) => a + 12 + b.length, 0), out = new Uint8Array(total), dv = new DataView(out.buffer);
  out.set([68, 75, 73, 70], 0); dv.setUint16(4, 0, true); dv.setUint16(6, 32, true); out.set([86, 80, 57, 48], 8);
  dv.setUint16(12, W, true); dv.setUint16(14, H, true); dv.setUint32(16, fps, true); dv.setUint32(20, 1, true); dv.setUint32(24, chunks.length, true);
  let o = 32;
  for ( const [b, ts] of chunks ) { dv.setUint32(o, b.length, true); dv.setBigUint64(o + 4, BigInt(Math.round(ts * fps / 1e6)), true); out.set(b, o + 12); o += 12 + b.length; }
  const FP = foundry.applications.apps.FilePicker.implementation;
  const r = await FP.upload("data", "mm-rec", new File([out], name, { type: "application/octet-stream" }), {}, { notify: false });
  return [total, r?.path, chunks.length];
}
