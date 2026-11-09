// Lens "no squares" A/B across builds (lane GM page).   const S = await import("/modules/moinen-maps/dev/lens-smooth.mjs")
// `S.capture(label)`: every lens effect (rain, snow, sand, dust, embers with the heat lens) at the fixed shared time T0, per zoom x
// DPR x darkness, whole-canvas shots kept as mm-rec/ls-<label>-<case>-z<z>-d<dpr>-n<dark>-<i>.png (swap the build on disk, reload,
// capture the other label). `S.offHashes()`: the same views with the lens OFF, hashed (the frame outside the lens: equal on both
// builds = nothing but the lens changed). `S.video(name, effect, dark, {z, dpr})`: a webm at shared time T0 + 6 s (virtual clock).
// Compare and crop in node: dev/lens-smooth-cmp.mjs.
const T0 = 1794150000000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const TIMES = [5000, 7300].map((d) => T0 + d);
export const CASES = [["rain", 3], ["snow", 3], ["sand", 3], ["dust", 3], ["embers", 3]];

async function setup(effect, level, dpr, dark, z, { lens = "auto", c = [768, 512] } = {}) {
  const H = await import("./perf-harness.mjs"), C = await import("./weather-cost.mjs"), R = await import("./weather-rec.mjs");
  if ( canvas.app.renderer.resolution !== dpr ) await H.setDPR(dpr);
  if ( (canvas.scene.environment?.darknessLevel ?? 0) !== dark ) await R.dark(dark);
  canvas.pan({ x: c[0], y: c[1], scale: z }); await wait(300);
  await C.setCase(effect, level, { t: T0, lens });
  if ( effect === "embers" && lens !== false ) {   // (the heat lens is opt-in)
    const f = canvas.scene.getFlag("moinen-maps", "weather");
    await canvas.scene.update({ "flags.moinen-maps.weather.lens": { ...f.lens, heat: true } });
    await wait(1200); game.modules.get("moinen-maps").api.weather.refresh(); await wait(600);
  }
  return C;
}

function prep() {
  const M = (CONFIG.moinenMaps ??= {});
  M.weatherGuard = false;
  M.weatherLensBands = 1;   // (a new build draws the lens in bands over frames: whole at once here, so a shot is the step's image)
}

export async function capture(label, { cases = CASES, zs = [1, 3], dprs = [1, 2], darks = [0, 1] } = {}) {
  prep();
  const out = {};
  for ( const [e, l] of cases ) for ( const z of (e === "rain" ? zs : [3]) ) for ( const dpr of dprs ) for ( const dark of darks ) {
    const C = await setup(e, l, dpr, dark, z);
    const sh = C.shots(e === "rain" ? TIMES : TIMES.slice(1));
    for ( let i = 0; i < sh.length; i++ ) await png(`ls-${label}-${e}-z${z}-d${dpr}-n${dark}-${i}.png`, sh[i]);
    out[`${e} z${z} d${dpr} n${dark}`] = sh.map(C.hash);
  }
  return out;
}

/** The same views with the lens off: hashes of the frames (outside the lens; must match across builds). */
export async function offHashes({ cases = CASES, zs = [1, 3], dprs = [1, 2], darks = [0, 1] } = {}) {
  prep();
  const out = {};
  for ( const [e, l] of cases ) for ( const z of zs ) for ( const dpr of dprs ) for ( const dark of darks ) {
    const C = await setup(e, l, dpr, dark, z, { lens: false });
    out[`${e} z${z} d${dpr} n${dark}`] = C.shots(TIMES).map(C.hash);
  }
  return out;
}

/** The lens-off shots of the same views at DPR 1, kept as ls-OFF-...png (the frame under the lens: dev/lens-smooth-cmp.mjs blocks). */
export async function offPng({ cases = CASES, zs = [1, 3], darks = [0, 1] } = {}) {
  prep();
  for ( const [e, l] of cases ) for ( const z of (e === "rain" ? zs : [3]) ) for ( const dark of darks ) {
    const C = await setup(e, l, 1, dark, z, { lens: false });
    const sh = C.shots(e === "rain" ? TIMES : TIMES.slice(1));
    for ( let i = 0; i < sh.length; i++ ) await png(`ls-OFF-${e}-z${z}-d1-n${dark}-${i}.png`, sh[i]);
  }
}

/** A shot (RGBA, bottom row first) kept losslessly as an upright opaque png in mm-rec. */
async function png(name, b) {
  const gl = canvas.app.renderer.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h }), g = c.getContext("2d"), im = g.createImageData(w, h);
  for ( let y = 0; y < h; y++ ) {
    im.data.set(b.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    for ( let x = 3; x < w * 4; x += 4 ) im.data[y * w * 4 + x] = 255;
  }
  g.putImageData(im, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const FP = foundry.applications.apps.FilePicker.implementation;
  return (await FP.upload("data", "mm-rec", new File([blob], name, { type: "image/png" }), {}, { notify: false }))?.path;
}

/** A webm of `effect` 3 + lens from shared time T0 + 6 s (the same frames on any build), `ms` long. */
export async function video(name, effect, dark, { ms = 4000, z = 3, dpr = 1, bands = 1 } = {}) {
  prep(); CONFIG.moinenMaps.weatherLensBands = bands;
  await setup(effect, 3, dpr, dark, z);
  return rec(name, ms, T0 + 6000);
}

/**
 * A webm of the canvas from shared time t0, 60 fps on the virtual clock, every frame read back with readPixels (a hidden page never
 * presents its frames: a 2d copy of the WebGL canvas then holds a stale frame).
 */
export async function rec(name, ms, t0, { fps = 60, pace = 45 } = {}) {
  const R = canvas.app.renderer, gl = R.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, T = canvas.app.ticker;
  const C = Object.assign(document.createElement("canvas"), { width: w, height: h }), g = C.getContext("2d"), im = g.createImageData(w, h);
  const st = C.captureStream(0), tr = st.getVideoTracks()[0], mf = T.maxFPS, started = T.started;
  const rc = new MediaRecorder(st, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 12e6 }), parts = [];
  rc.ondataavailable = (e) => parts.push(e.data);
  const buf = new Uint8Array(w * h * 4), real = Date.now, n = Math.round(ms * fps / 1000), perf0 = performance.now();
  T.maxFPS = 0; T.stop();
  let vt = t0; Date.now = () => Math.floor(vt);
  rc.start();
  try {
    for ( let i = 0; i < n; i++ ) {
      vt = t0 + i * 1000 / fps;
      T.update(perf0 + i * 1000 / fps);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      for ( let y = 0; y < h; y++ ) im.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      for ( let k = 3; k < im.data.length; k += 4 ) im.data[k] = 255;
      g.putImageData(im, 0, 0); tr.requestFrame();
      await wait(pace);
    }
  } finally { Date.now = real; T.maxFPS = mf; if ( started ) T.start(); }
  rc.stop(); await new Promise((r) => { rc.onstop = r; });
  const FP = foundry.applications.apps.FilePicker.implementation;
  const r = await FP.upload("data", "mm-rec", new File(parts, name, { type: "video/webm" }), {}, { notify: false });
  return [parts.reduce((a, b) => a + b.size, 0), r?.path, n];
}

/** Put the lane back: weather off, DPR 1, day, zoom 1, the dev overrides gone. */
export async function clean() {
  const H = await import("./perf-harness.mjs"), C = await import("./weather-cost.mjs"), R = await import("./weather-rec.mjs");
  await C.setCase("off", 1);
  if ( canvas.app.renderer.resolution !== 1 ) await H.setDPR(1);
  if ( (canvas.scene.environment?.darknessLevel ?? 0) !== 0 ) await R.dark(0);
  canvas.pan({ scale: 1 });
  const M = CONFIG.moinenMaps ?? {};
  delete M.weatherGuard; delete M.weatherLensBands;
}
