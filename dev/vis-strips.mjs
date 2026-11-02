// Frame strips of the destruction entries on a known map (visual review). In a lane server's GM tab:
//   const V = await import("/modules/moinen-maps/dev/vis-strips.mjs");
//   await V.capture({ name: "grass-kinds", bg: "worlds/invincible/vis3/grass-4.png", rows: [[["blast",0,1],["blast",0,2],["blast",0,3]], ...], post: "http://localhost:8765", tag: "before" })
// Every row is three cells [kind, cause, level] on a 120 x 120 art-pixel grid (ap 3); kind: blast|collapse|scorch|flood|cracks|tear. The scene is made
// (and replaced) by name; strokes are painted through the module's own paint path; every area enters at once on a frozen, seeded clock; the destruction
// layer alone is drawn at 1 scene px per canvas px into one big texture per frame, and each cell's crop is posted to a receiver as raw RGBA
// (frames side by side: one POST per stroke); the receiver composes it over the known map (the same procedural texture).
const CELL = 120, AP = 3, SZ = CELL * AP;
const api = () => game.modules.get("moinen-maps").api.destruction;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KIND = { blast: 0, collapse: 1, scorch: 2, flood: 3, cracks: 4, tear: 5 };

export async function makeScene(name, bg, rows) {
  for ( const s of game.scenes.filter((s) => s.name === name) ) await s.delete();
  const sc = await Scene.create({ name, width: SZ * 3, height: SZ * rows, padding: 0, grid: { size: 100, type: 1 }, levels: [{ _id: "defaultLevel0000", name: "Level", elevation: { bottom: 0, top: 20 }, background: { color: "#808080", src: bg } }], tokenVision: false, fog: { exploration: false }, environment: { darknessLevel: 0 } });
  await sc.view(); await sleep(1500);
  for ( let i = 0; i < 80 && !canvas.ready; i++ ) await sleep(250);
  return sc;
}

export async function paintAll(rows) {
  const D = await import("/modules/moinen-maps/scripts/destruction/destruction.mjs"), Model = await import("/modules/moinen-maps/scripts/destruction/model.mjs");
  D.ensureState(); const A = api(); A.setParams?.({ entry: true, anim: true, idle: true, fxWho: "all" });
  const ids = [];
  rows.forEach((row, r) => row.forEach(([kind, cause, level], c) => {
    const cx = c * SZ + SZ / 2, cy = r * SZ + SZ / 2, before = new Set((D.state().objects ?? []).map((o) => o.id));
    if ( kind === "tear" ) {
      const L = 48 * AP, pts = [[cx - L, cy + 6 * AP], [cx - L / 3, cy - 4 * AP], [cx + L / 3, cy + 5 * AP], [cx + L, cy - 5 * AP]], s = D.ensureState();
      const buf = { mask: new Uint8Array(s.mw * s.mh), mw: s.mw, mh: s.mh, mpx: s.mpx }; let box = null;
      for ( let k = 0; k < pts.length - 1; k++ ) {
        const [ax, ay] = pts[k], [bx, by] = pts[k + 1], n = Math.ceil(Math.hypot(bx - ax, by - ay) / 6);
        for ( let q = 0; q <= n; q++ ) { const b = Model.stamp(buf, ax + (bx - ax) * q / n, ay + (by - ay) * q / n, 7 * AP * 2, { mode: "raise", level, type: 5 }); if ( b ) box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b; }
      }
      D.edited(box, { buf: buf.mask, erase: false, type: 5, cause: Model.causeOf(cause), a: { x: pts[0][0], y: pts[0][1] }, b: { x: pts[3][0], y: pts[3][1] }, path: pts.map(([x, y], i) => [x, y, i * 400]) });
    } else A.paint(cx, cy, 12 * 2 * AP, { level, type: KIND[kind], cause });
    const o = (D.state().objects ?? []).find((o) => !before.has(o.id)); ids.push(o?.id);
  }));
  return ids;
}

async function waitBaked(n, ms = 90000) {
  const end = performance.now() + ms;
  while ( performance.now() < end ) { const st = api().status?.(); if ( st && !st.baking && st.areas?.length >= n ) return true; await sleep(400); }
  return false;
}

/** the destruction layer alone at 1 scene px per px (whole scene) as RGBA */
function grabScene() {
  const R = canvas.app.renderer, r = canvas.dimensions.sceneRect, D = api().display();
  const rt = PIXI.RenderTexture.create({ width: r.width, height: r.height, resolution: 1 });
  R.render(D.objs, { renderTexture: rt, transform: new PIXI.Matrix(1, 0, 0, 1, -r.x, -r.y), clear: true });
  const px = R.extract.pixels(rt); rt.destroy(true); return px;
}

export async function capture({ name, bg, rows, times = [0, 90, 200, 400, 800, 1500, 3600], post, tag = "x", zoom = null } = {}) {
  await makeScene(name, bg, rows.length);
  const ids = await paintAll(rows);
  const baked = await waitBaked(rows.length * 3);
  const H = await import("/modules/moinen-maps/dev/perf-harness.mjs");
  H.fit(zoom ?? Math.min(innerWidth / (SZ * 3), innerHeight / (SZ * rows.length)));
  const boot = await H.boot();
  // every area needs its pixels (an area shown as a shell / with its atlas freed has no entry to play: it waits for them on the real clock)
  for ( let i = 0; i < 6 && api().display().order.some((g) => g.shell || g.atlasFree); i++ ) { await api().replay(); await sleep(50); }
  const d = api().display(), T = canvas.app.ticker, real = performance.now.bind(performance);
  CONFIG.moinenMaps ??= {}; const was = [CONFIG.moinenMaps.noDestructionCache, CONFIG.moinenMaps.noClockWorker];
  CONFIG.moinenMaps.noDestructionCache = true; CONFIG.moinenMaps.noClockWorker = true;
  const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const rnd = Math.random; let seed = 12345; Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  let F = real(); performance.now = () => F;
  const shots = []; let entered = -1;
  try {
    // (no tick between the reset and the entries: a tick frees the atlas of an area at rest, and an area without its pixels does not play)
    const start = F + 5;
    for ( const g of d.order ) d.enter(g, { start });
    // (every clock made now, on the page: on a frozen clock the slices that make them in the background may come late, and an entry whose clock is late plays from the middle)
    d.clockSlice(1e9, { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 });
    entered = d.order.filter((g) => g.anim).length;
    for ( const g of d.order ) d.materialize(g, Infinity);
    for ( const g of d.order ) if ( g.tex && !g.tex.destroyed ) canvas.app.renderer.texture.bind(g.tex, 0);
    let t = F;
    for ( const dt of times ) { while ( t < start + dt ) { t = Math.min(start + dt, t + 16); F = t; T.update(F); } shots.push(grabScene()); }
    for ( const g of d.order ) d.endAnim(g);
    F += 10000; T.update(F); shots.push(grabScene());   // the resting look
  } finally { performance.now = real; Math.random = rnd; [CONFIG.moinenMaps.noDestructionCache, CONFIG.moinenMaps.noClockWorker] = was; T.maxFPS = mf; if ( st ) T.start(); }
  // post one strip per stroke (frames side by side)
  const W = SZ * 3, nF = shots.length; let sent = 0;
  for ( let r = 0; r < rows.length; r++ ) for ( let c = 0; c < 3; c++ ) {
    const strip = new Uint8Array(SZ * nF * SZ * 4);
    for ( let f = 0; f < nF; f++ ) for ( let y = 0; y < SZ; y++ ) {
      const src = ((r * SZ + y) * W + c * SZ) * 4;
      strip.set(shots[f].subarray(src, src + SZ * 4), (y * SZ * nF + f * SZ) * 4);
    }
    const q = new URLSearchParams({ tag, name, r, c, nF, sz: SZ, spec: rows[r][c].join("-") });
    await fetch(`${post}/strip?${q}`, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: strip }); sent++;
  }
  return { baked, boot, entered, areas: d.order.length, sent, frames: nF, times: [...times, "rest"], ids };
}
