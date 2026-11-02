// LIVE check of "follows the stroke" (directional) in a browser, on a lane server (NOT main). Load on a FRONTED tab:
//   const L = await import("/modules/moinen-maps/dev/direction-live.mjs")
//   await L.prepare()                                  open the destruction paint tool on an empty scene (make one first: a copy of the map without flags)
//   await L.runCase({ type: "blast", dirOn: false, rtl: false })     one stroke painted with REAL pointer events (daily-bench drive), then
//                                                      - the live entry's options (display.enter is watched),
//                                                      - frame strips (virtual clock, t = 0 60 120 250 500 900 ms) of the live options and of the Detonate options,
//                                                      - per piece start times (spread, correlation with x) and the ruin's front (first change per x bin).
//   await L.runAll()                                   every kind x directional off/on x left->right / right->left
//   await L.pinned()                                   the toggle semantics (new strokes only, "Apply to existing strokes", Detonate replay)
// Strips go to worlds/<world>/popout/<name>.png of the lane server (a page cannot post to the host).
import * as B from "./daily-bench.mjs";

const MODULE = "moinen-maps";
const A = () => game.modules.get(MODULE).api.destruction;
const D = () => A().display();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const KINDS = ["blast", "collapse", "scorch", "flood", "cracks", "gash"];
export const TIMES = [0, 60, 120, 250, 500, 900];

const pearson = (xs, ts) => {
  const n = xs.length; if ( n < 3 ) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, mt = ts.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0, syy = 0;
  for ( let i = 0; i < n; i++ ) { sxy += (xs[i] - mx) * (ts[i] - mt); sxx += (xs[i] - mx) ** 2; syy += (ts[i] - mt) ** 2; }
  return +(sxy / Math.sqrt(sxx * syy || 1)).toFixed(2);
};

/** Open the paint tool and centre the view on the scene at `scale`. */
export async function prepare(scale = 1) {
  const SH = await import(`/modules/${MODULE}/scripts/workspace/shell.mjs`);
  await SH.useTool("destruction", "mm-d-paint"); await wait(600);
  const R = canvas.dimensions.sceneRect;
  canvas.pan({ x: R.x + R.width / 2, y: R.y + R.height / 2, scale }); await wait(1200);
  return { scene: canvas.scene.name, scale: canvas.stage.scale.x, visible: document.visibilityState, focus: document.hasFocus() };
}

/** Watch display.enter: every call is logged with the options it got (the live entry of a stroke). */
export function watch() {
  const d = D(), orig = d.enter, log = [];
  d.enter = function(g, o = {}) {
    const r = orig.call(this, g, o);
    log.push({ objId: g.objId, type: g.info.type, simul: !!o.simul, path: o.path?.length ?? 0, o: !!o.o, dir: !!o.dir, spine: o.spine?.length ?? 0, under: o.under?.length ?? 0,
      opts: { o: o.o ?? null, dir: o.dir ?? null, path: o.path ?? null, spine: o.spine ?? null, simul: !!o.simul } });
    return r;
  };
  return { log, stop() { if ( d.enter === orig ) return; delete d.enter; } };
}

/** Wait until the layer holds areas of a stroke that is not in `known`, is baked and its live entry has ended. */
async function settleNew(known, ms = 25000) {
  const end = performance.now() + ms; let seen = 0;
  while ( performance.now() < end ) {
    await wait(250);
    const d = D(), st = A().status();
    const fresh = d ? d.order.filter((g) => g.objId && !known.has(g.objId)) : [];
    if ( fresh.length ) { seen++; if ( !st.baking && !st.waiting && !fresh.some((g) => g.anim || g.shell || g.atlasFree) && seen > 3 ) return fresh; }
  }
  const d = D(); return d ? d.order.filter((g) => g.objId && !known.has(g.objId)) : [];
}

/** A stroke of `kind` along y (scene px), from x0 to x1, real pointer events. Returns the groups it made, the watched enters and the drive info. */
export async function paintStroke({ kind, x0 = 420, x1 = 1100, y = 512, n = 40, dt = 12, size = 1.5 } = {}) {
  await A().setBrush({ type: KINDS.indexOf(kind), size, level: 3 });
  const known = new Set((D()?.order ?? []).map((g) => g.objId)), w = D() ? watch() : null;
  const R = canvas.dimensions.sceneRect;
  const pts = Array.from({ length: n + 1 }, (_, i) => ({ x: R.x + x0 + (x1 - x0) * i / n, y: R.y + y }));
  const dr = await B.drive(pts, { dt });
  const w2 = w ?? watch();
  const groups = await settleNew(known);
  w2.stop();
  return { groups, enters: w2.log.filter((e) => groups.some((g) => g.objId === e.objId)), drive: { pts: pts.length, dt, upCostMs: +dr.upCost.toFixed(1) } };
}

/** The start spread / x correlation of the pieces of `groups` right after an enter (virtual clock `F`). */
function pieceStats(groups, F) {
  const xs = [], ts = [];
  for ( const g of groups ) for ( const it of g.anim?.list ?? [] ) { xs.push(it.p.sx + g.info.x); ts.push(it.t0 - F); }
  return { pieces: xs.length, spread: xs.length ? Math.round(Math.max(...ts) - Math.min(...ts)) : 0, corr: pearson(xs, ts), t0min: xs.length ? Math.round(Math.min(...ts)) : null };
}

const wideStrip = async (frames, [W, H], name, labels) => {
  const n = frames.length, cw = W, ch = H, outW = (cw + 4) * n, outH = ch * 2 + 4, out = new Uint8Array(outW * outH * 4);
  for ( let q = 0; q < n; q++ ) for ( let y = 0; y < ch; y++ ) for ( let x = 0; x < cw; x++ ) {
    const j = (y * W + x) * 4, g = ((x >> 3) + (y >> 3)) & 1 ? 150 : 110, o = (y * outW + q * (cw + 4) + x) * 4, o2 = ((y + ch + 4) * outW + q * (cw + 4) + x) * 4, al = frames[q][j + 3] / 255;
    const pv = frames[Math.max(0, q - 1)];
    for ( let p = 0; p < 3; p++ ) { out[o + p] = frames[q][j + p] * al + g * (1 - al); out[o2 + p] = q ? Math.min(255, Math.abs(frames[q][j + p] - pv[j + p]) * 8) : 0; }
    out[o + 3] = 255; out[o2 + 3] = 255;
  }
  const c = new OffscreenCanvas(outW, outH), ctx = c.getContext("2d"); ctx.putImageData(new ImageData(new Uint8ClampedArray(out.buffer), outW, outH), 0, 0);
  ctx.font = "bold 14px sans-serif"; ctx.fillStyle = "#ff0"; ctx.strokeStyle = "#000"; ctx.lineWidth = 3;
  labels.forEach((s, q) => { ctx.strokeText(s, q * (cw + 4) + 6, 18); ctx.fillText(s, q * (cw + 4) + 6, 18); });
  const file = new File([await c.convertToBlob({ type: "image/png" })], name + ".png", { type: "image/png" }), fp = foundry.applications.apps.FilePicker.implementation;
  try { await fp.createDirectory("data", `worlds/${game.world.id}/popout`); } catch { /* exists */ }
  const r = await fp.upload("data", `worlds/${game.world.id}/popout`, file, {}, { notify: false });
  return r?.path;
};

/**
 * Replay the entry of `groups` on a virtual clock (the static cache on, real frames): `optsOf(g)` the options, frames grabbed every `dt` ms to 1000 ms;
 * the `TIMES` frames go into a strip. Returns { pieces: {spread, corr}, ruin: {arrival per x bin}, strip }.
 */
export async function replay(groups, optsOf, { name, dt = 10, bins = 8 } = {}) {
  const d = D(), T = canvas.app.ticker, real = performance.now.bind(performance), rnd = Math.random, R = canvas.app.renderer;
  CONFIG.moinenMaps ??= {}; const was = CONFIG.moinenMaps.noClockWorker; CONFIG.moinenMaps.noClockWorker = true;
  const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const hidden = [];
  for ( const g of d.order ) for ( const ch of g.cont.children ) if ( ch !== g.patch && ch !== g.baseCont && ch !== g.shardCont && ch.visible ) { ch.visible = false; hidden.push(ch); }
  const rect = groups.reduce((a, g) => ({ x0: Math.min(a.x0, g.info.rect.x0), y0: Math.min(a.y0, g.info.rect.y0), x1: Math.max(a.x1, g.info.rect.x1), y1: Math.max(a.y1, g.info.rect.y1) }), { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
  const M = canvas.primary.worldTransform, k = R.resolution, PW = Math.round(R.screen.width * k), PH = Math.round(R.screen.height * k), m = 30;
  const sx0 = Math.max(0, Math.floor((rect.x0 * M.a + M.tx - m) * k)), sy0 = Math.max(0, Math.floor((rect.y0 * M.d + M.ty - m) * k));
  const sx1 = Math.min(PW, Math.ceil((rect.x1 * M.a + M.tx + m) * k)), sy1 = Math.min(PH, Math.ceil((rect.y1 * M.d + M.ty + m) * k)), W = sx1 - sx0, H = sy1 - sy0;
  const grab = () => {
    const rt = PIXI.RenderTexture.create({ width: R.screen.width, height: R.screen.height, resolution: R.resolution }), tr = canvas.primary.worldTransform.clone();
    R.render(d.objs, { renderTexture: rt, transform: tr, clear: true });
    if ( d.fx?.visible ) R.render(d.fx, { renderTexture: rt, transform: tr, clear: false });
    const px = R.extract.pixels(rt); rt.destroy(true);
    const o = new Uint8Array(W * H * 4); for ( let y = sy0; y < sy1; y++ ) o.set(px.subarray((y * PW + sx0) * 4, (y * PW + sx1) * 4), (y - sy0) * W * 4); return o;
  };
  let seed = 777; Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const out = { opts: groups.map((g) => { const o = optsOf(g); return { type: g.info.type, simul: !!o.simul, path: o.path?.length ?? 0, spine: o.spine?.length ?? 0, o: !!o.o, dir: !!o.dir }; }) };
  try {
    let F = real(); performance.now = () => F; T.update(F);
    for ( let i = 0; i < 4; i++ ) { F += 16; T.update(F); }
        const start = F + 5;
    for ( const g of groups ) {
      d.enter(g, { start, ...optsOf(g) });
      d.clockSlice(1e9, { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 }); d.materialize(g, Infinity);
      if ( g.tex && !g.tex.destroyed ) R.texture.bind(g.tex, 0);
    }
    out.pieces = pieceStats(groups, start);
    const frames = [], arrive = new Array(bins).fill(null), binW = Math.max(1, Math.floor(W / bins)), changed = new Array(bins).fill(0), final = new Array(bins).fill(0);
    let ref = null;                                         // the frame at t = 0 (the ruin not yet revealed): change is measured against it
    const dtl = (A1, B1, j) => Math.abs(A1[j] - B1[j]) + Math.abs(A1[j + 1] - B1[j + 1]) + Math.abs(A1[j + 2] - B1[j + 2]) + Math.abs(A1[j + 3] - B1[j + 3]);
    const series = [];
    for ( let t = 0; t <= 1000; t += dt ) {
      while ( F < start + t ) { F = Math.min(start + t, F + 16); T.update(F); }
      const px = grab(); ref ??= px;
      const cnt = new Array(bins).fill(0);
      for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) if ( dtl(px, ref, (y * W + x) * 4) > 40 ) cnt[Math.min(bins - 1, Math.floor(x / binW))]++;
      series.push(cnt);
      if ( TIMES.includes(t) ) frames.push(px);
    }
    // the ruin's front: the first time a bin shows 12% of the change it shows at 1000 ms (and at least 20 pixels) against the frame at t = 0
    const fin = series[series.length - 1];
    for ( let b = 0; b < bins; b++ ) {
      if ( fin[b] < 40 ) continue;
      const i = series.findIndex((c) => c[b] >= Math.max(20, fin[b] * 0.12));
      arrive[b] = i < 0 ? null : i * dt;
    }
    const ab = arrive.map((v, b) => [b, v]).filter(([, v]) => v != null);
    out.ruin = { arrive, spread: ab.length ? Math.max(...ab.map((q) => q[1])) - Math.min(...ab.map((q) => q[1])) : 0, corr: pearson(ab.map((q) => q[0]), ab.map((q) => q[1])), bins: ab.length };
    out.series = TIMES.map((t) => series[t / dt]);
    if ( name ) out.strip = await wideStrip(frames, [W, H], name, TIMES.map((t) => `${name.split("-").slice(1).join(" ")}  t=${t}ms`));
    out.crop = [W, H];
  } finally {
    performance.now = real; Math.random = rnd;
    for ( const g of groups ) d.endAnim(g);
    for ( const g of d.order ) if ( g.anim ) d.endAnim(g);
    let F2 = real() + 20000; performance.now = () => F2; T.update(F2); performance.now = real; T.lastTime = real();
    hidden.forEach((h) => { h.visible = true; }); CONFIG.moinenMaps.noClockWorker = was; T.maxFPS = mf; if ( st ) T.start();
  }
  return out;
}

/** Clear every stroke and wait until the layer is empty. */
export async function clearAll() {
  A().clear(); const end = performance.now() + 15000;
  while ( performance.now() < end ) { await wait(250); const d = D(); const st = A().status(); if ( (!d || !d.order.length) && !st.baking ) break; }
  await wait(400);
}

/** The whole case: paint with the current setting `dirOn` (set through the same setParams the checkbox calls), then replay live / Detonate options. */
export async function runCase({ kind, dirOn, rtl, fresh = true, tag = "" } = {}) {
  if ( fresh ) await clearAll();
  A().setParams({ directional: !!dirOn }); await wait(300);
  const [x0, x1] = rtl ? [1100, 420] : [420, 1100];
  const p = await paintStroke({ kind, x0, x1 });
  const gs = p.groups, label = `${kind}-${dirOn ? "ON" : "OFF"}-${rtl ? "rtl" : "ltr"}${tag}`;
  const liveOpts = new Map(p.enters.map((e) => [e.objId, e.opts]));
  const res = { label, kind, dirOn: !!dirOn, rtl: !!rtl, areas: gs.length, types: [...new Set(gs.map((g) => g.info.type))], liveEnters: p.enters.map(({ opts, ...r }) => r) };
  if ( !gs.length ) return { ...res, error: "no area baked" };
  res.detonateOpts = gs.map((g) => { const o = D().entryOptsFor?.(g) ?? {}; return { simul: !!o.simul, path: o.path?.length ?? 0 }; });
  res.live = await replay(gs, (g) => liveOpts.get(g.objId) ?? { simul: !dirOn }, { name: `dir-${label}-live` });
  res.det = await replay(gs, (g) => D().entryOptsFor?.(g) ?? {}, { name: `dir-${label}-det` });
  return res;
}

const brief = (r) => ({ label: r.label, areas: r.areas, enter: r.liveEnters?.map((e) => `${e.simul ? "simul" : "path"}${e.path ? "+p" + e.path : ""}${e.spine ? "+sp" : ""}`).join(","),
  live: r.live && { pieces: r.live.pieces, ruin: { spread: r.live.ruin.spread, corr: r.live.ruin.corr, arrive: r.live.ruin.arrive }, strip: r.live.strip },
  det: r.det && { pieces: r.det.pieces, ruin: { spread: r.det.ruin.spread, corr: r.det.ruin.corr, arrive: r.det.ruin.arrive }, strip: r.det.strip }, error: r.error });

export async function runAll({ kinds = KINDS, report = null } = {}) {
  const rows = [];
  for ( const kind of kinds ) for ( const dirOn of [false, true] ) for ( const rtl of [false, true] ) {
    const r = await runCase({ kind, dirOn, rtl }); rows.push(brief(r)); report?.(rows.at(-1));
  }
  return rows;
}
