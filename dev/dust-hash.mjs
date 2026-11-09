// DUST HASH A/B (lane GM page):   const X = await import("/modules/moinen-maps/dev/dust-hash.mjs")
// "Nothing outside the dust changes": deterministic canvas shots on a virtual clock at a FIXED shared time (T0), so two builds, or two
// page loads, draw the same frames.
//   await X.shots({ dust, times, view })   wipes the strokes, places a fixed set of fire / smoke / fireball strokes (and, with `dust`, two
//                                dust strokes in a region of their own), then for each time (ms after T0) renders the frame and reads it
//                                back; returns { shots: [{ t, hash, px }], dustBox: the dust's screen rect or null }. `px` stays on
//                                window.__dh for compare.
//   X.compare(a, b, box, aa)     pixels that differ between two shot sets (outside `box`, if given; with `aa`, a second shot set of
//                                `a`'s case, only the pixels that are stable a/a count): { diff, total, maxDelta } per time
//   await X.hashes(opts)         the same as shots, but only { t, hash } (to compare across page loads / builds by string)
const MOD = "moinen-maps", T0 = 1794150000000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const api = () => game.modules.get(MOD).api.fire;

export const FIRE = [
  { id: "hf1", k: "fire", s: 0.9, r: 30, lv: 2, sm: 2, st: "fire", p: [700, 300, 820, 320] },
  { id: "hf2", k: "fire", s: 0.8, r: 26, lv: 3, sm: 1, st: "fireball", p: [980, 420, 1040, 450] },
  { id: "hs1", k: "smoke", s: 0.8, r: 40, sm: 2, p: [860, 560, 940, 600] }
];
export const DUST = [
  { id: "hd1", k: "dust", dk: "car", lv: 3, r: 24, s: 1, p: [120, 520, 300, 535, 480, 510, 620, 525] },
  { id: "hd2", k: "dust", dk: "heavy", lv: 2, r: 36, s: 1, p: [140, 760, 380, 770] }
];

function hashOf(px) { let h = 2166136261 >>> 0; for ( let i = 0; i < px.length; i++ ) { h ^= px[i]; h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); }

export async function shots({ dust = false, times = [0, 1500, 3000, 6000], view = [640, 560, 1], steps = 3, together = false } = {}) {
  const FM = await import("../scripts/fire/fire.mjs"), CK = await import("../scripts/shared-clock.mjs"), M = await import("../scripts/fire/model.mjs");
  const keys = Object.keys(canvas.scene.flags[MOD]?.fireStrokes ?? {});
  if ( keys.length ) await canvas.scene.update(Object.fromEntries(keys.map((k) => [`flags.${MOD}.fireStrokes.-=${k}`, null])));
  await wait(800);
  // the fire first, made ready and lit (its areas shown, its lights synced), THEN the dust: the normal case of dust painted where a fire
  // already burns (`together`: both arrive at once, as on a scene load - then the fire's areas wait for the dust's in the same staged
  // swap, and its lights fade in that much later)
  const fire = FIRE.map((s, i) => ({ ...s, wd: 0, ws: 0, q: T0 - 8000 + i })), dl = dust ? DUST.map((s, i) => ({ ...s, wd: 0, ws: 0, q: T0 - 1000 + i })) : [];
  const put = (l) => canvas.scene.update(Object.fromEntries(l.map((s) => [`flags.${MOD}.fireStrokes.${s.id}`, s])));
  if ( together ) await put([...fire, ...dl]);
  else {
    await put(fire);
    for ( let k = 0; k < 300 && (api().status().areas < FIRE.length || api().status().pending); k++ ) await wait(20);
    await wait(500);
    if ( dl.length ) await put(dl);
  }
  canvas.pan({ x: view[0], y: view[1], scale: view[2] });
  const R = canvas.app.renderer, gl = R.gl, T = canvas.app.ticker, mf = T.maxFPS, st = T.started, realNow = Date.now;
  const skew = CK.sharedNow() - realNow();
  // (the page clock too: animations elsewhere on the canvas (water, rings, Foundry's own) read performance.now / the ticker's time -
  // fixed here so two loads draw the same frame; requestAnimationFrame is left alone)
  let pt = 1e7;
  let vt = T0; Date.now = () => Math.floor(vt - skew); performance.now = () => pt;
  CK.holdClock(true); T.maxFPS = 0; T.stop();
  const out = [], px = [], perf0 = 1e7;
  try {
    for ( const t of times ) {
      vt = T0 + t; pt = perf0 + t;
      for ( let k = 0; k < 600 && (api().status().pending - api().status().adopting) > 0; k++ ) await wait(10);
      FM.draw();
      for ( let k = 0; k < 600 && api().status().pending > 0; k++ ) { await wait(10); T.update(perf0 + t); }
      FM.draw();
      // (the lights follow a frame after new areas show (display.lightsNext, a requestAnimationFrame): let it run, as live)
      for ( let k = 0; k < 2; k++ ) { await new Promise((r) => requestAnimationFrame(() => r())); T.update(perf0 + t); }
      // (two steps at the same time: the art pass, then the frame drawn from it)
      for ( let k = 0; k < steps; k++ ) { T.update(perf0 + t); R.render(canvas.app.stage); }
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, a = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, a);
      out.push({ t, hash: hashOf(a), W, H }); px.push(a);
    }
  } finally { Date.now = realNow; delete performance.now; T.maxFPS = mf; if ( st ) T.start(); CK.holdClock(false); }
  // the dust's own screen rectangle (its areas' whole reach), in drawing-buffer pixels (y up, as readPixels)
  let box = null;
  if ( dust ) {
    const geo = api().geo(), P = M.cleanParams(api().params()), areas = M.areasOf(M.strokesOf(canvas.scene.flags[MOD].fireStrokes), geo, P, T0).filter((a) => a.style === "dust");
    const res = R.resolution, Hc = gl.drawingBufferHeight;
    box = areas.map((a) => { const r = a.rect, p0 = canvas.stage.toGlobal({ x: geo.ox + r.x0 * geo.ap, y: geo.oy + r.y0 * geo.ap }), p1 = canvas.stage.toGlobal({ x: geo.ox + r.x1 * geo.ap, y: geo.oy + r.y1 * geo.ap });
      return [Math.floor(p0.x * res) - 2, Hc - Math.ceil(p1.y * res) - 2, Math.ceil(p1.x * res) + 2, Hc - Math.floor(p0.y * res) + 2]; });
  }
  window.__dh ??= {}; window.__dh[dust ? "dust" : "none"] = px;
  return { shots: out, dustBox: box };
}

export function compare(a, b, box = null, aa = null) {
  return a.map((A, i) => {
    const B = b[i], C = aa?.[i], w = canvas.app.renderer.gl.drawingBufferWidth; let diff = 0, total = 0, maxDelta = 0;
    for ( let p = 0; p < A.length; p += 4 ) {
      const x = (p / 4) % w, y = Math.floor(p / 4 / w);
      if ( box && box.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1) ) continue;
      if ( C && (A[p] !== C[p] || A[p + 1] !== C[p + 1] || A[p + 2] !== C[p + 2]) ) continue;
      total++;
      const d = Math.max(Math.abs(A[p] - B[p]), Math.abs(A[p + 1] - B[p + 1]), Math.abs(A[p + 2] - B[p + 2]));
      if ( d ) { diff++; if ( d > maxDelta ) maxDelta = d; }
    }
    return { diff, total, maxDelta };
  });
}

export async function hashes(o) { const r = await shots(o); return r.shots.map(({ t, hash }) => ({ t, hash })); }

// ACROSS BUILDS: a shot set kept in this origin's IndexedDB survives a page reload onto another build (`save` on the old build,
// `load` on the new one, then `compare(old, new, null, newAgain)`: only pixels stable a/a on the new build count)
const db = () => new Promise((res, rej) => { const r = indexedDB.open("mm-dust-hash", 1); r.onupgradeneeded = () => r.result.createObjectStore("s"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export async function save(name, px) { const d = await db(); await new Promise((res, rej) => { const t = d.transaction("s", "readwrite"); t.objectStore("s").put(px, name); t.oncomplete = res; t.onerror = () => rej(t.error); }); d.close(); }
export async function load(name) { const d = await db(); const v = await new Promise((res, rej) => { const r = d.transaction("s").objectStore("s").get(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); d.close(); return v; }
export async function drop() { await new Promise((res) => { const r = indexedDB.deleteDatabase("mm-dust-hash"); r.onsuccess = r.onerror = r.onblocked = () => res(); }); }
