// Weather at night: square check. On a lane GM page:   const N = await import("/modules/moinen-maps/dev/weather-night-check.mjs")
// `await N.run("tag")` shows rain L1, rain L3, snow L3 and sand L3 at darkness 0, 0.5 and 0.9 on one frozen clock and uploads one png per
// weather (zoom-3 crops, the three darkness levels side by side) to mm-rec/night-<tag>-<weather>.png. For each pass (ground, splash,
// air, particles, haze, lens) it renders the frame with the pass hidden and returns the diff: pixels changed, how many got darker, and
// the DARK BLOCKS - connected groups of darkened pixels whose bounding box is 4 x 4 to 48 x 48 px and at least 85 % filled (a square).
// World passes are diffed with the lens hidden in both frames (the lens refracts what is under it); the lens against no lens.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const W = () => game.modules.get("moinen-maps").api.weather;

function passes() {
  const m = canvas.primary.children.filter((c) => c.sortLayer >= 252 && c.sortLayer <= 253 || c.sortLayer >= 990 && c.sortLayer <= 995);
  const by = (f) => m.filter(f);
  const lens = canvas.stage.children.filter((c) => c.lens && c.shader || c.constructor?.name === "ScreenSprite");   // (the lens on screen; ScreenSprite: before 2026-11-08)
  return {
    ground: by((c) => c.sortLayer === 252), splash: by((c) => c.sortLayer === 253), air: by((c) => c.sortLayer === 995 && c.shader?.uniforms?.uMode === 0),
    parts: by((c) => c.sortLayer === 995 && c.shader?.uniforms?.uKind != null), haze: by((c) => c.sortLayer === 990), lens
  };
}

function frame(hide = []) {
  const r = canvas.app.renderer, gl = r.gl;
  const saved = hide.map((m) => m.visible); hide.forEach((m) => { m.visible = false; });
  r.render(canvas.app.stage);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  hide.forEach((m, i) => { m.visible = saved[i]; });
  return { w, h, px };
}

/** Diff of A (all) against B (a pass hidden): changed, darker, and the dark blocks (solid darkened rects >= 4 x 4). */
function diff(A, B) {
  const n = A.w * A.h, dark = new Uint8Array(n);
  let changed = 0, darker = 0;
  for ( let i = 0; i < n; i++ ) {
    const j = i * 4, a = A.px[j] + A.px[j + 1] + A.px[j + 2], b = B.px[j] + B.px[j + 1] + B.px[j + 2];
    if ( A.px[j] !== B.px[j] || A.px[j + 1] !== B.px[j + 1] || A.px[j + 2] !== B.px[j + 2] ) { changed++; if ( a < b - 3 ) { darker++; dark[i] = 1; } }
  }
  const seen = new Uint8Array(n), blocks = [], st = [];
  for ( let i = 0; i < n; i++ ) {
    if ( !dark[i] || seen[i] ) continue;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, cnt = 0;
    st.push(i); seen[i] = 1;
    while ( st.length ) {
      const k = st.pop(), x = k % A.w, y = (k / A.w) | 0; cnt++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for ( const q of [k - 1, k + 1, k - A.w, k + A.w] ) if ( q >= 0 && q < n && dark[q] && !seen[q] && Math.abs((q % A.w) - x) <= 1 ) { seen[q] = 1; st.push(q); }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if ( bw >= 4 && bh >= 4 && bw <= 48 && bh <= 48 && cnt >= 0.85 * bw * bh ) blocks.push([x0, A.h - 1 - y1, bw, bh]);   // (bigger: an area, as wet ground)
  }
  return { changed, darker, blocks: blocks.length, eg: blocks.slice(0, 3) };
}

async function cropPng(name, frames, x, y, w, h, k = 3) {
  const c = Object.assign(document.createElement("canvas"), { width: frames.length * (w * k + 6) - 6, height: h * k }), g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  frames.forEach((F, fi) => {
    const id = g.createImageData(w * k, h * k);
    for ( let yy = 0; yy < h * k; yy++ ) for ( let xx = 0; xx < w * k; xx++ ) {
      const sx = x + Math.floor(xx / k), sy = F.h - 1 - (y + Math.floor(yy / k)), si = (sy * F.w + sx) * 4, di = (yy * w * k + xx) * 4;
      id.data[di] = F.px[si]; id.data[di + 1] = F.px[si + 1]; id.data[di + 2] = F.px[si + 2]; id.data[di + 3] = 255;
    }
    g.putImageData(id, fi * (w * k + 6), 0);
  });
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const FP = foundry.applications.apps.FilePicker.implementation;
  return (await FP.upload("data", "mm-rec", new File([blob], name, { type: "image/png" }), {}, { notify: false }))?.path;
}

export const CASES = [["rainL1", "rain", 1], ["rainL3", "rain", 3], ["snow", "snow", 3], ["sand", "sand", 3]];

export async function run(tag, { cases = CASES, darks = [0, 0.5, 0.9], at = 1_800_000_000_000, crop = [420, 200, 140, 90], zoom = 1 } = {}) {
  canvas.controls.cursors.visible = false;
  canvas.pan({ x: canvas.dimensions.width / 2, y: canvas.dimensions.height / 2, scale: zoom });
  W().lens({ on: true, level: "auto", strength: 1 });
  const out = {}, realNow = Date.now;
  for ( const [name, preset, level] of cases ) {
    await W().set(preset, { level, over: 0 });
    await wait(3000);
    const fx = Object.keys(W().status().state?.fx ?? {});
    if ( fx.join() !== preset ) console.warn(`night-check: ${name} shows [${fx}]`);
    const shots = []; out[name] = {};
    for ( const d of darks ) {
      await canvas.scene.update({ "environment.darknessLevel": d }, { animateDarkness: 0 });
      await wait(1200);
      const T = canvas.app.ticker;
      T.update(performance.now());   // (on the real clock first: the display resolves its state when its 12 Hz step changes)
      Date.now = () => at;   // (one frozen clock: the same drops in every shot)
      try {
        for ( let i = 0; i < 24; i++ ) T.update(performance.now() + i * 17);
        // each world pass against the frame without it, the lens hidden in both (the lens refracts what is under it); the lens alone
        const P = passes(), A = frame(), A0 = frame(P.lens);
        const r = { dark: canvas.environment?.darknessLevel };
        for ( const [k, list] of Object.entries(P) ) {
          if ( !list.some((m) => m.visible) ) continue;
          r[k] = k === "lens" ? diff(A, A0) : diff(A0, frame([...P.lens, ...list]));
        }
        out[name][d] = r; shots.push(A);
      } finally { Date.now = realNow; }
    }
    out[name].png = await cropPng(`night-${tag}-${name}.png`, shots, ...crop);
  }
  await canvas.scene.update({ "environment.darknessLevel": 0 }, { animateDarkness: 0 });
  W().clear?.();
  return out;
}

/** Zoom-`k` crops of one spot on the current frame: all passes, the lens hidden, then the lens and each named pass hidden. */
export async function look(name, x, y, w = 24, h = 24, k = 8, hide = ["ground"]) {
  const P = passes();
  for ( let i = 0; i < 3; i++ ) canvas.app.ticker.update(performance.now() + i * 17);
  const shots = [frame(), frame(P.lens), ...hide.map((n) => frame([...P.lens, ...P[n]]))];
  return cropPng(name, shots, x, y, w, h, k);
}

/**
 * FIRE UNDER RAIN, paired: at each of a few frozen moments, the frame with the fire damped as rain levels 0-3 would damp it
 * (wind.mjs fire-wet provider forced to { dim, steam }; 3 s of ticks on the frozen clock first, so the fuel map and the lights
 * follow), so every level is compared on the very same flames. Returns per moment [dim, orange glow (sum of R - B > 30), hot px,
 * mean luminance]; `png` = mm-rec/<name> (zoom-k crops, dims side by side) of the first moment. Reload the page after (the
 * weather's own provider is replaced).
 */
export async function fireDamp(name, { dims = [0, 0.3, 0.55, 0.8], moments = 3, crop = null, k = 2 } = {}) {
  const Wd = await import("../scripts/wind.mjs");
  const r = canvas.app.renderer, gl = r.gl, realNow = Date.now, out = [];
  let shots = null;
  try {
    for ( let m = 0; m < moments; m++ ) {
      const base = realNow() + 5000 + m * 4000, row = [];
      for ( const dim of dims ) {
        Wd.setFireWetProvider(() => (dim > 0 ? { dim, steam: Math.min(1, dim / 0.8) } : null));
        for ( let j = 0; j < 30; j++ ) { const t = base - 3000 + j * 100; Date.now = () => t; canvas.app.ticker.update(performance.now()); }
        Date.now = () => base; canvas.app.ticker.update(performance.now());
        const F = frame();
        let e = 0, hot = 0, lum = 0;
        for ( let i = 0; i < F.w * F.h; i++ ) {
          const R = F.px[i * 4], G = F.px[i * 4 + 1], B = F.px[i * 4 + 2];
          if ( R - B > 30 ) e += R - B; if ( R > 180 && R - B > 60 ) hot++; lum += R + G + B;
        }
        row.push([dim, e, hot, Math.round(lum / (F.w * F.h))]);
        if ( m === 0 ) (shots ??= []).push(F);
      }
      out.push(row);
    }
  } finally { Date.now = realNow; }
  const [x, y, w, h] = crop ?? [0, 0, shots[0].w, shots[0].h];
  return { rows: out, png: await cropPng(name, shots, x, y, w, h, k) };
}

/** Zoom-`k` crops of one spot with each given list of display objects hidden in turn (the first crop hides nothing). */
export async function hideCompare(name, lists, x, y, w, h, k = 2) {
  for ( let i = 0; i < 3; i++ ) canvas.app.ticker.update(performance.now() + i * 17);
  const shots = [frame(), ...lists.map((l) => frame(l))];
  return cropPng(name, shots, x, y, w, h, k);
}
