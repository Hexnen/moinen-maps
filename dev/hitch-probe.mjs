// HITCH PROBE (page module; dev/hitch-run.mjs drives it): every drawn frame's interval on the real ticker, and for each one over `long`
// ms what overlapped it: the Long Animation Frame entries (their scripts: invoker, source, function, duration), the JS heap (a drop =
// a GC), timed WebGL calls (texture uploads, shader compile / link and the program-status query that waits for it, read-backs, buffer
// uploads), worker messages and socket events handled, Foundry's own hooks of note. The page must be the fronted tab.
const now = () => performance.now();
const heap = () => performance.memory?.usedJSHeapSize ?? 0;
let S = null;

export function start({ long = 34 } = {}) {
  stop();
  const T = canvas.app.ticker, gl = canvas.app.renderer.gl;
  S = { long, frames: 0, iv: [], hitches: [], zones: [], loaf: [], undo: [], t0: now(), lastH: heap() };
  const zone = (name, t0, t1 = now()) => { if ( t1 - t0 >= 0.5 ) { S.zones.push([name, t0, t1]); if ( S.zones.length > 20000 ) S.zones.splice(0, 5000); } };
  const wrap = (o, k, name) => {
    const f = o[k]; if ( typeof f !== "function" || f.__hp ) return;
    const w = function(...a) { const t = now(); try { return f.apply(this, a); } finally { zone(typeof name === "function" ? name(a) : name, t); } };
    w.__hp = true; o[k] = w; S.undo.push(() => { o[k] = f; });
  };
  for ( const k of ["texImage2D", "texSubImage2D", "texStorage2D", "compressedTexImage2D", "readPixels", "bufferData", "bufferSubData", "compileShader", "linkProgram", "generateMipmap", "finish", "getError"] ) wrap(gl, k, `gl.${k}`);
  wrap(gl, "getProgramParameter", (a) => (a[1] === gl.LINK_STATUS ? "gl.programStatus" : "gl.getProgramParameter"));
  wrap(gl, "getShaderParameter", "gl.shaderStatus");
  // worker messages (any worker: ours and Foundry's) and the socket's events
  const WP = Worker.prototype, ael = WP.addEventListener;
  WP.addEventListener = function(type, fn, ...r) {
    if ( type === "message" && typeof fn === "function" ) { const g = function(ev) { const t = now(); try { return fn.call(this, ev); } finally { zone("worker.message", t); } }; return ael.call(this, type, g, ...r); }
    return ael.call(this, type, fn, ...r);
  };
  S.undo.push(() => { WP.addEventListener = ael; });
  const sock = game.socket;
  if ( sock?.onevent ) { const oe = sock.onevent; sock.onevent = function(...a) { const t = now(); try { return oe.apply(this, a); } finally { zone(`socket.${a[0]?.[0] ?? "?"}`, t); } }; S.undo.push(() => { sock.onevent = oe; }); }
  // Foundry's per-frame and periodic work worth timing
  for ( const [o, k, n] of [[canvas.perception, "update", "perception.update"], [canvas.perception, "applyRenderFlags", "perception.applyRenderFlags"]] ) if ( o && n ) wrap(o, k, n);
  // the frame record: the interval, the heap change since the last frame
  let last = T.lastTime;
  const look = () => {
    const t = T.lastTime, dt = t - last, h = heap(); last = t;
    S.frames++; S.iv.push(dt);
    if ( dt > S.long && S.frames > 2 ) S.hitches.push({ t0: t - dt, t1: t, dt, dHeap: h - S.lastH, heap: h });
    S.lastH = h;
  };
  T.add(look, null, PIXI.UPDATE_PRIORITY.UTILITY - 1);
  S.undo.push(() => T.remove(look));
  try {
    const po = new PerformanceObserver((l) => { for ( const e of l.getEntries() ) if ( e.duration >= S.long ) S.loaf.push(e.toJSON()); });
    po.observe({ type: "long-animation-frame", buffered: false });
    S.undo.push(() => po.disconnect());
    const pl = new PerformanceObserver((l) => { for ( const e of l.getEntries() ) S.zones.push([`longtask(${e.name})`, e.startTime, e.startTime + e.duration]); });
    pl.observe({ type: "longtask", buffered: false }); S.undo.push(() => pl.disconnect());
  } catch ( err ) { S.noLoaf = String(err); }
  return { t0: S.t0, loaf: !S.noLoaf };
}

/** Stop: the frames, the hitches with what overlapped each (zones summed, LoAF scripts over 1 ms), the interval distribution. */
export function stop() {
  if ( !S ) return null;
  for ( const u of S.undo.reverse() ) try { u(); } catch {}
  const s = S; S = null;
  const sorted = [...s.iv].sort((a, b) => a - b), q = (f) => +(sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] ?? 0).toFixed(1);
  const hitches = s.hitches.map((h) => {
    const z = {};
    for ( const [n, a, b] of s.zones ) { const o = Math.min(b, h.t1) - Math.max(a, h.t0); if ( o > 0 ) z[n] = +((z[n] ?? 0) + o).toFixed(1); }
    const lf = s.loaf.filter((e) => e.startTime < h.t1 && e.startTime + e.duration > h.t0).map((e) => ({
      start: +(e.startTime - h.t0).toFixed(1), dur: +e.duration.toFixed(1), block: +(e.blockingDuration ?? 0).toFixed(1),
      render: e.renderStart ? +(e.startTime + e.duration - e.renderStart).toFixed(1) : null, style: e.styleAndLayoutStart ? +(e.startTime + e.duration - e.styleAndLayoutStart).toFixed(1) : null,
      scripts: (e.scripts ?? []).filter((x) => x.duration >= 1).map((x) => ({ inv: x.invoker, type: x.invokerType, src: (x.sourceURL ?? "").replace(/^https?:\/\/[^/]+/, ""), fn: x.sourceFunctionName, dur: +x.duration.toFixed(1), at: +(x.startTime - h.t0).toFixed(1) }))
    }));
    return { t: +((h.t0 - s.t0) / 1000).toFixed(2), t0: h.t0, t1: h.t1, dt: +h.dt.toFixed(1), dHeapMB: +(h.dHeap / 1048576).toFixed(2), heapMB: +(h.heap / 1048576).toFixed(0), zones: z, loaf: lf };
  });
  return { frames: s.frames, secs: +((now() - s.t0) / 1000).toFixed(1), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), noLoaf: s.noLoaf, hitches };
}
