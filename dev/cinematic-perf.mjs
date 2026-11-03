// Browser-side PERFORMANCE bench of a real CINEMATIC show (destruction/cinematic.mjs + cinematic-fx.mjs). Lane server, GM page:
//   const P = await import("/modules/moinen-maps/dev/cinematic-perf.mjs");
//   await P.showBench({ strokes: 4, label: "default" })       paint N staged drags, Action!, the whole show measured frame by frame
//   await P.showBench({ opts: { cinNoShake: true } })          the same with this client's opt-outs (A/B: what each effect costs)
// Works with a HIDDEN pane: the app ticker is pumped by hand at `hz` on a wall clock (MessageChannel slots, so the show's own timers run
// between the frames as in a browser). Per frame: CPU = ticker update (every listener + the render) + gl.finish, each ticker listener's ms
// (also the ones added while the show runs, e.g. the fx tick), timer callbacks run before it, GL texture creates / uploads, render textures
// made, the static cache's band re-draws (stats.bakes), and the show's state (fx on, shaking, slow, camera pan). Phases from the show's hooks:
// pre (idle), barsIn (fx begin -> first impact), impact (each impact -80..+400 ms), between, tail (last impact -> show end), after.
// NOT measured here: the compositor's cost of the DOM overlays over the canvas (a hidden pane does not composite; see overlayBench).
const MODULE = "moinen-maps";
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const D = () => game.modules.get(MODULE).api.destruction;
const pct = (a, p) => { if ( !a.length ) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2); };
const dist = (a) => ({ n: a.length, p50: pct(a, 0.5), p95: pct(a, 0.95), max: a.length ? +Math.max(...a).toFixed(1) : null, over16: a.filter((x) => x > 16.7).length });

/* ------------------------------------------------------------------ the pump */

let P = null;
/**
 * Pump the app ticker by hand at `hz` (wall clock). Returns the pump { rec(on), rows, stop() }; a second call returns the running one.
 * Each listener's emit is wrapped once (per listener object, so ticker.remove(fn) still finds it).
 */
export function pump({ hz = 60 } = {}) {
  if ( P ) return P;
  const R = canvas.app.renderer, gl = R.gl, T = canvas.app.ticker, per = 1000 / hz;
  const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const fr = { l: {}, gl: {}, tasks: 0 }, undo = [];
  const bump = (o, k, v = 1) => { o[k] = (o[k] ?? 0) + v; };
  for ( const n of ["createTexture", "texImage2D", "texSubImage2D", "drawElements", "bindFramebuffer"] ) { const o = gl[n]; gl[n] = function(...a) { bump(fr.gl, n); return o.apply(gl, a); }; undo.push(() => { gl[n] = o; }); }
  { const o = PIXI.RenderTexture.create; PIXI.RenderTexture.create = function(...a) { bump(fr.gl, "RT"); return o.apply(this, a); }; undo.push(() => { PIXI.RenderTexture.create = o; }); }
  for ( const k of ["setTimeout", "setInterval"] ) {
    const o = globalThis[k];
    globalThis[k] = function(fn, ...a) {
      if ( typeof fn !== "function" ) return o.call(this, fn, ...a);
      return o.call(this, function(...b) { const t = performance.now(); try { return fn.apply(this, b); } finally { const ms = performance.now() - t; fr.tasks += ms;
        if ( ms > 0.2 ) bump(fr.l, `timer:${String(fn).slice(0, 50).replace(/\s+/g, " ")}`, ms); } }, ...a);
    };
    undo.push(() => { globalThis[k] = o; });
  }
  const wrapped = new WeakSet(), emit = Object.getPrototypeOf(T._head).emit;      // (TickerListener is not on the PIXI namespace)
  const wrapAll = () => {
    for ( let l = T._head.next; l; l = l.next ) {
      if ( wrapped.has(l) ) continue; wrapped.add(l);
      const fn = l.fn, label = `${l.context?.constructor?.name ?? ""}.${fn?.name || "anon"}@${l.priority}:${String(fn).slice(0, 40).replace(/\s+/g, " ")}`;
      l.emit = function(dt) { const t = performance.now(); try { return emit.call(this, dt); } finally { bump(fr.l, label, performance.now() - t); } };
    }
  };
  const ch = new MessageChannel(); let wake = null; ch.port1.onmessage = () => wake?.();
  const yieldTask = () => new Promise((r) => { wake = r; ch.port2.postMessage(0); });
  const p = P = { rows: [], recording: false, on: true, marks: [], t00: performance.now() };
  p.rec = (on) => { p.recording = on; if ( on ) { p.rows = []; p.marks = []; p.t00 = performance.now(); } };
  p.mark = (kind, x = {}) => { if ( p.recording ) p.marks.push({ kind, t: performance.now() - p.t00, ...x }); };
  p.done = (async () => {
    let slot = performance.now();
    try {
      while ( p.on ) {
        slot += per;
        while ( performance.now() < slot - 0.3 ) await yieldTask();
        if ( performance.now() - slot > per ) slot = performance.now();          // late: start again from now
        if ( !canvas.ready ) continue;
        wrapAll();
        const bakes0 = D().display()?.cache?.stats?.bakes ?? 0, tasks = fr.tasks, tl = fr.l;      // (the timer callbacks run since the last frame)
        fr.l = {}; fr.gl = {}; fr.tasks = 0;
        const t = performance.now();
        T.update(t); gl.finish();
        const cpu = performance.now() - t;
        if ( !p.recording ) { fr.l = {}; fr.gl = {}; continue; }
        const fx = game.modules.get(MODULE).api.cinematic?.debug?.();
        const pan = !!foundry.canvas.animation.CanvasAnimation.animations?.["canvas.animatePan"];
        // (a long frame: the display tick's own parts, ms, and the static cache's update)
        const ds = D().display()?.stats, dp = cpu > 3 && ds ? { ...Object.fromEntries(Object.entries(ds.parts ?? {}).filter(([, v]) => v > 0.3).map(([k, v]) => [k, +v.toFixed(1)])), cache: +(ds.cacheMs ?? 0).toFixed(1) } : null;
        p.rows.push({ t: t - p.t00, cpu, tasks, dp, bakes: (D().display()?.cache?.stats?.bakes ?? 0) - bakes0, l: { ...tl, ...fr.l }, gl: fr.gl, z: canvas.stage.scale.x,
          fx: !!fx, shake: !!fx?.shaking, slow: !!fx?.slow, pan, anim: (D().display()?.order ?? []).filter((g) => g.anim).length });
        fr.l = {}; fr.gl = {};
      }
    } finally {
      for ( const u of undo.reverse() ) u();
      for ( let l = T._head.next; l; l = l.next ) delete l.emit;
      T.maxFPS = mf; T.lastTime = performance.now(); if ( st ) T.start(); ch.port1.close();
    }
  })();
  p.stop = async () => { p.on = false; await p.done; P = null; };
  const hook = Hooks.on("moinenMapsCinematic", (kind, x) => p.mark(kind, { id: x?.id }));
  undo.push(() => Hooks.off("moinenMapsCinematic", hook));
  return p;
}
export const stopPump = async () => P?.stop();

/* ------------------------------------------------------------------ summary */

/** Per phase: CPU (+ the timer work before the frame) distribution, band re-draws, render textures, GL creates/uploads; the top listeners. */
export function summarize(rows, marks) {
  const imp = marks.filter((m) => m.kind === "impact").map((m) => m.t), start = marks.find((m) => m.kind === "start")?.t ?? 0, end = marks.find((m) => m.kind === "end")?.t ?? Infinity;
  const fxOn = rows.find((r) => r.fx)?.t ?? start;
  const phaseOf = (r) => {
    if ( r.t < start ) return "pre";
    if ( r.t > end ) return "after";
    if ( imp.some((t) => r.t >= t - 80 && r.t <= t + 400) ) return "impact";
    if ( !imp.length || r.t < imp[0] ) return r.t >= fxOn ? "barsIn" : "lead";
    if ( r.t > imp.at(-1) + 400 ) return "tail";
    return "between";
  };
  const out = {}, groups = {};
  for ( const r of rows ) (groups[phaseOf(r)] ??= []).push(r);
  groups.show = rows.filter((r) => r.t >= start && r.t <= end);
  for ( const [k, g] of Object.entries(groups) ) {
    const sum = (f) => g.reduce((s, r) => s + (f(r) ?? 0), 0), l = {};
    for ( const r of g ) for ( const [n, v] of Object.entries(r.l) ) l[n] = (l[n] ?? 0) + v;
    out[k] = { frames: g.length, cpu: dist(g.map((r) => r.cpu)), cost: dist(g.map((r) => r.cpu + r.tasks)), bakes: sum((r) => r.bakes), RT: sum((r) => r.gl.RT), createTexture: sum((r) => r.gl.createTexture),
      texImage2D: sum((r) => r.gl.texImage2D), texSub: sum((r) => r.gl.texSubImage2D), draws: g.length ? Math.round(sum((r) => r.gl.drawElements) / g.length) : 0,
      top: Object.entries(l).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, v]) => [n.slice(0, 70), +(v / Math.max(1, g.length)).toFixed(2)]) };
  }
  const spikes = rows.map((r) => ({ ...r, c: r.cpu + r.tasks })).sort((a, b) => b.c - a.c).slice(0, 8).map((r) => ({ t: Math.round(r.t), ms: +r.c.toFixed(1), phase: phaseOf(r), bakes: r.bakes, RT: r.gl.RT ?? 0, tex: r.gl.createTexture ?? 0,
    z: +r.z.toFixed(3), shake: r.shake, pan: r.pan, slow: r.slow, dp: r.dp, by: Object.entries(r.l).filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, v]) => `${n.slice(0, 50)}=${v.toFixed(1)}`) }));
  return { phases: out, spikes, marks: marks.map((m) => [m.kind, Math.round(m.t)]) };
}

/**
 * A PLAYER page (or any page that does not run the show): pumped and recorded from now until a show has started and ended here (+1.5 s),
 * with this client's opt-outs `opts` (default: everything on, camera on). Start it, then Action! on the GM page. -> { show: summarize(...) }.
 */
export async function watchBench({ opts = {}, hz = 60, timeout = 90000, label = "" } = {}) {
  const p = pump({ hz }), saved = Object.fromEntries(OPT_KEYS.map((k) => [k, game.settings.get(MODULE, k)]));
  try {
    for ( const [k, v] of Object.entries({ ...CLEAN, ...opts }) ) await game.settings.set(MODULE, k, v);
    p.rec(true);
    const t0 = performance.now();
    while ( performance.now() - t0 < timeout && !p.marks.some((m) => m.kind === "end") ) await sleep(200);
    await sleep(1500);
    p.rec(false);
    window.__cinPerf = { rows: p.rows, marks: p.marks };
    return { label, user: game.user.name, show: summarize(p.rows, p.marks) };
  } finally {
    for ( const [k, v] of Object.entries(saved) ) await game.settings.set(MODULE, k, v).catch(() => {});
  }
}

/* ------------------------------------------------------------------ a show */

const OPT_KEYS = ["cinNoLetterbox", "cinNoVignette", "cinNoShake", "cinNoFlash", "cinNoSlow", "cinCamera", "cinReduced"];
const CLEAN = { cinNoLetterbox: false, cinNoVignette: false, cinNoShake: false, cinNoFlash: false, cinNoSlow: false, cinCamera: "on", cinReduced: "off" };

/** Paint `strokes` staged drags spread over the scene (real pointer events), wait for the bakes. Returns their ids. */
export async function stage({ strokes = 4, base = 0, preset = "epic", over = {} } = {}) {
  const C = await import(`/modules/${MODULE}/dev/cinematic-check.mjs`), d = D();
  await C.gmSetup({ mode: "off", preview: false });
  // `base` settled strokes first (mode off): damage already on the map, i.e. the static cache's bands the camera moves over
  for ( let i = 0; i < base; i++ ) await C.gmPaint({ from: [0.1 + 0.8 * ((i * 0.29) % 1), 0.1 + 0.8 * ((i * 0.53) % 1)], to: [0.1 + 0.8 * ((i * 0.29) % 1) + 0.12, 0.12 + 0.8 * ((i * 0.53) % 1)], wait: false });
  d.setCinematic({ mode: "drags", preview: false, preset, over });
  const ids = [];
  for ( let i = 0; i < strokes; i++ ) {
    const y = 0.2 + 0.6 * ((i * 0.37) % 1), x0 = 0.15 + 0.5 * ((i * 0.61) % 1);
    const o = await C.gmPaint({ from: [x0, y], to: [x0 + 0.22, y + 0.05], wait: false });
    if ( o ) ids.push(o.id);
  }
  // the bakes settle (status().baking off for 2 s)
  let quiet = 0;
  for ( let k = 0; k < 120 && quiet < 4; k++ ) { await sleep(500); quiet = d.status?.()?.baking ? 0 : quiet + 1; }
  return ids;
}

/**
 * One whole show measured: stage, park the view (fit x1.1, as gmSetup), this client's opt-outs `opts` (default: everything on, camera on
 * as a player has it), Action!, until the show is over + 1.5 s. -> { label, show: summarize(...), staged }.
 */
export async function showBench({ strokes = 4, base = 0, preset = "epic", over = {}, opts = {}, label = "", hz = 60, keepRows = false } = {}) {
  const C = await import(`/modules/${MODULE}/dev/cinematic-check.mjs`);
  const p = pump({ hz });
  const saved = Object.fromEntries(OPT_KEYS.map((k) => [k, game.settings.get(MODULE, k)]));
  try {
    for ( const [k, v] of Object.entries({ ...CLEAN, ...opts }) ) await game.settings.set(MODULE, k, v);
    const ids = await stage({ strokes, base, preset, over });
    await sleep(800);
    p.rec(true);
    await sleep(1000);
    const show = await C.gmAction();
    if ( !show ) throw new Error("no show");
    await C.waitShow(60000);
    await sleep(1500);
    p.rec(false);
    const res = { label, staged: ids.length, show: summarize(p.rows, p.marks), dpr: canvas.app.renderer.resolution, screen: [innerWidth, innerHeight] };
    if ( keepRows ) res.rows = p.rows;
    window.__cinPerf = { rows: p.rows, marks: p.marks };
    return res;
  } finally {
    for ( const [k, v] of Object.entries(saved) ) await game.settings.set(MODULE, k, v).catch(() => {});
  }
}
