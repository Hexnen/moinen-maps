// Tornado look-development: contact sheets on the virtual clock.   const L = await import("/modules/moinen-maps/dev/tornado-look.mjs")
// `sheet(name, { at, dt, n, cols, rect: [x, y, w, h] (screen css px), k })` renders n frames at shared ms at + i dt (Date.now faked, the
// ticker stepped by hand, so a hidden pane works too) and uploads one png (nearest-neighbour zoom k) to Data/mm-rec.
// `pass(on)` hides / shows the tornado's stage meshes (for the zero-diff-outside proof).
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const view = () => [...(game.modules.get("moinen-maps").api.weather.tornado.display()?.views.values() ?? [])][0] ?? null;

function renderAt(t) {
  const realNow = Date.now;
  Date.now = () => Math.floor(t);
  try { canvas.app.ticker.update(performance.now()); canvas.app.renderer.render(canvas.app.stage); }
  finally { Date.now = realNow; }
}

async function upload(c, name) {
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const FP = foundry.applications.apps.FilePicker.implementation;
  const r = await FP.upload("data", "mm-rec", new File([blob], name, { type: "image/png" }), {}, { notify: false });
  return r?.path;
}

export async function sheet(name, { at = Date.now(), dt = 100, n = 8, cols = 4, rect = null, k = 1, marks = null } = {}) {
  canvas.controls.cursors.visible = false;
  const V = canvas.app.view, dpr = V.width / V.clientWidth;
  const [x, y, w, h] = (rect ?? [0, 0, V.clientWidth, V.clientHeight]).map((v) => Math.round(v * dpr));
  const rows = Math.ceil(n / cols);
  const c = Object.assign(document.createElement("canvas"), { width: w * k * cols + (cols - 1) * 4, height: h * k * rows + (rows - 1) * 4 }), g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = false;
  for ( let i = 0; i < n; i++ ) {
    renderAt(at + i * dt);
    const ox = (i % cols) * (w * k + 4), oy = Math.floor(i / cols) * (h * k + 4);
    g.drawImage(V, x, y, w, h, ox, oy, w * k, h * k);
    const m = marks?.[i];
    if ( m ) {
      // an annotation of the evidence sheet only (never drawn in the game): a ring round the tracked piece and its depth
      g.strokeStyle = m[2] === "front" ? "#3cff6e" : "#ffd23c"; g.lineWidth = 2;
      g.beginPath(); g.arc(ox + (m[0] * dpr - x) * k, oy + (m[1] * dpr - y) * k, 14 * k, 0, Math.PI * 2); g.stroke();
      g.font = `${10 * k}px sans-serif`; g.fillStyle = g.strokeStyle; g.fillText(m[2], ox + 4, oy + 12 * k);
    }
  }
  return upload(c, name);
}

/** The tornado's stage meshes on / off. */
export function pass(on) {
  const v = view(); if ( !v ) return;
  if ( on ) { delete v._off; return; }
  v._off = true;
}

/** Pixels of a frame at shared ms t with the tornado shown and hidden: { changedOutside, changedInside, box }. box: screen px rect that may change. */
export async function zeroDiff(t, box, maskName = null) {
  const V = canvas.app.view, W = V.width, H = V.height, gl = canvas.app.renderer.gl;
  const read = () => { const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
  const v = view(); const ms = [v.ground, v.marks, v.show];
  renderAt(t); const a = read();
  const vis = ms.map((m) => m.visible);
  const realNow = Date.now; Date.now = () => Math.floor(t);
  try {
    canvas.app.ticker.update(performance.now());
    ms.forEach((m) => { m.visible = false; });
    canvas.app.renderer.render(canvas.app.stage);
  } finally { Date.now = realNow; }
  const b = read();
  ms.forEach((m, i) => { m.visible = vis[i]; });
  if ( maskName ) {
    const c = Object.assign(document.createElement("canvas"), { width: W, height: H }), g = c.getContext("2d"), im = g.createImageData(W, H);
    for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
      const o = (y * W + x) * 4, q = ((H - 1 - y) * W + x) * 4;
      const d = Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]);
      im.data[q] = d ? 255 : b[o] * 0.4; im.data[q + 1] = d ? Math.min(255, d * 4) : b[o + 1] * 0.4; im.data[q + 2] = b[o + 2] * 0.4; im.data[q + 3] = 255;
    }
    g.putImageData(im, 0, 0); await upload(c, maskName);
  }
  let out = 0, inn = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
  for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
    const o = (y * W + x) * 4;
    if ( a[o] === b[o] && a[o + 1] === b[o + 1] && a[o + 2] === b[o + 2] ) continue;
    const yy = H - 1 - y;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, yy); y1 = Math.max(y1, yy);
    if ( box && (x < box[0] || x >= box[0] + box[2] || yy < box[1] || yy >= box[1] + box[3]) ) out++; else inn++;
  }
  return { changedOutside: out, changedInside: inn, bbox: [x0, y0, x1, y1], W, H };
}

/** After a page reload: place a level-`lv` tornado (formed `ago` ms ago), then a full frame and an 8-frame base sequence. */
export async function go(tag, lv = 3, { x = 800, y = 560, zoom = 1.6, ago = 20000, rect = null, dt = 120, path = null, speed = 0.6, crops = true } = {}) {
  const D = await import("/modules/moinen-maps/dev/tornado-dev.mjs");
  const errs = [], ow = console.warn; console.warn = (...a) => { errs.push(a.map(String).join(" ").slice(0, 300)); ow(...a); };
  try { await D.place(lv, { x, y, zoom, ago, path, speed }); } finally { console.warn = ow; }
  const t = Date.now();
  const v = view(), g = v.owner.geo, [ax, ay] = v.baseArt(t), b = canvas.stage.toGlobal({ x: g.ox + ax * g.ap, y: g.oy + ay * g.ap });
  const full = await sheet(`${tag}-full.png`, { at: t, n: 1, cols: 1 });
  const seq = await sheet(`${tag}-seq.png`, { at: t, dt, n: 8, cols: 4, rect: rect ?? [b.x - 170, b.y - 190, 340, 280] });
  const out = { t, b, full, seq, stats: view()?.stats, errs: errs.filter((e) => !e.includes("deprecated")) };
  if ( crops ) {
    out.base = await sheet(`${tag}-base-x3.png`, { at: t, dt: 250, n: 3, cols: 3, rect: [b.x - 90, b.y - 110, 180, 150], k: 3 });
    const top = canvas.stage.toGlobal({ x: g.ox + v.ax[39].cx * g.ap, y: g.oy + v.ax[39].sy * g.ap });
    out.top = await sheet(`${tag}-top-x3.png`, { at: t, dt: 250, n: 3, cols: 3, rect: [top.x - 100, top.y - 90, 200, 150], k: 3 });
  }
  return out;
}

/** Map fragments over time (CPU tables only): { [seed]: [[t, x, y, front, rr], ...] } for shared ms t0 .. t0 + ms. */
export function trackFrags(t0, ms = 3000, dt = 50) {
  const v = view(), vr = v.owner.viewRect(), out = {};
  for ( let t = t0; t <= t0 + ms; t += dt ) {
    v.frame(t, (t / 1000) % 3600, vr, false, 3);
    for ( const [I, front] of [[v.Lb, 0], [v.Lf, 1]] ) for ( let i = 0; i < I.n; i++ ) {
      const o = i * 16; if ( I.d[o + 5] !== 1 ) continue;
      (out[I.d[o + 6]] ??= []).push([t, I.d[o], I.d[o + 1], front, I.d[o + 15]]);
    }
  }
  return out;
}
