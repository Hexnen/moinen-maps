// Weather vs CAMERA MOVES, in real time (lane GM or player page, the Browser pane SHOWN and the tab fronted: a hidden page has no
// requestAnimationFrame).   const V = await import("/modules/moinen-maps/dev/weather-move.mjs")
//
// `await V.move(kind, { ms })` drives one real camera move with real input events and records every frame the canvas draws:
//   drag     right-button drag pan (pointerdown / a pointermove every vsync along a figure eight / pointerup on the board);
//   wheel    wheel notches (bursts in, then out: 0.5x .. ~4x, through the smooth-zoom glide);
//   animate  canvas.animatePan legs (zoom in to 3, out to 0.6, across the scene).
// Per frame: the interval since the frame before (what the user sees: a dropped vsync shows as one interval of k+1 vsyncs), the
// CPU of the ticker step (all listeners + the render submit), its GPU time (a timer query around the step), the weather tickers'
// CPU, and what happened in it (render textures made, GL textures made, shaders compiled / linked, pixels read back, heap fall = GC).
// Input delay = from an input event to the end of the first frame drawn after it.
// `await V.pair(setup, kinds, { reps })`: the same moves with the weather OFF and ON, interleaved (off on off on ...): `setup(on)`.
// Summaries: p50 / p95 / max (never a mean), long frames (work > 16.7 ms), late frames (interval > the pacing's frame + half a vsync).
const W = () => game.modules.get("moinen-maps").api.weather;
const raf = () => new Promise((r) => requestAnimationFrame(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (a, p) => { if ( !a.length ) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const r2 = (x) => Math.round(x * 100) / 100;

/** Install the recorder: wraps the ticker step, the weather tickers and the GL / PIXI calls that can stall a frame. */
export function recorder() {
  const R = canvas.app.renderer, gl = R.gl, T = canvas.app.ticker, ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const rec = { frames: [], events: [], loaf: [], cur: null, on: false };
  const undo = [];
  const wrap = (o, k, fn) => { if ( !o?.[k] ) return; const f = o[k]; o[k] = function(...a) { return fn.call(this, f, a); }; undo.push(() => { o[k] = f; }); };
  const count = (name) => (f, a, self) => { if ( rec.cur ) rec.cur[name] = (rec.cur[name] ?? 0) + 1; return f.apply(self, a); };
  for ( const [o, k, n] of [[gl, "createTexture", "glTex"], [gl, "compileShader", "compile"], [gl, "linkProgram", "link"], [gl, "readPixels", "readback"],
    [gl, "getProgramParameter", "progQuery"], [gl, "finish", "finish"], [gl, "getError", "getError"], [gl, "texImage2D", "texUpload"]] ) {
    const c = count(n); wrap(o, k, function(f, a) { return c(f, a, this); });
  }
  const crt = count("rtMade"); wrap(PIXI.RenderTexture, "create", function(f, a) { return crt(f, a, this); });
  // the weather tickers (their listeners call the instance's tick)
  const wx = [["display", W().display()], ["lens", W().lensDisplay()], ["tornado", W().tornadoDisplay?.()], ["steam", W().steamDisplay?.()]];
  for ( const [n, o] of wx ) if ( o?.tick ) {
    const f = o.tick; o.tick = function(...a) { const t = performance.now(); try { return f.apply(this, a); } finally { if ( rec.cur ) rec.cur.wx = (rec.cur.wx ?? 0) + performance.now() - t; } };
    undo.push(() => { delete o.tick; if ( o.tick !== f ) o.tick = f; });
  }
  // the ticker step
  const pend = [];
  const up = T.update;
  T.update = function(now) {
    if ( !rec.on ) return up.call(this, now);
    const fr = { t: performance.now(), heap: performance.memory?.usedJSHeapSize ?? 0 }; rec.cur = fr;
    let qq = null;
    if ( ext ) { qq = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, qq); }
    try { return up.call(this, now); }
    finally {
      if ( qq ) { gl.endQuery(ext.TIME_ELAPSED_EXT); pend.push([fr, qq]); }
      fr.cpu = performance.now() - fr.t; rec.cur = null; fr.px = canvas.stage.pivot.x; fr.s = canvas.stage.scale.x; rec.frames.push(fr);
      // (older queries: read when ready)
      while ( pend.length && gl.getQueryParameter(pend[0][1], gl.QUERY_RESULT_AVAILABLE) ) {
        const [f2, q2] = pend.shift();
        f2.gpu = gl.getQueryParameter(q2, gl.QUERY_RESULT) / 1e6; f2.dis = !!gl.getParameter(ext.GPU_DISJOINT_EXT); gl.deleteQuery(q2);
      }
    }
  };
  undo.push(() => { T.update = up; });
  let po = null;
  try { po = new PerformanceObserver((l) => { for ( const e of l.getEntries() ) if ( rec.on && e.startTime >= rec.t0 ) rec.loaf.push({ t: e.startTime, d: e.duration, b: e.blockingDuration ?? 0, render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0, scripts: (e.scripts ?? []).filter((x) => x.duration > 3).map((x) => `${x.invoker ?? x.name}@${(x.sourceURL ?? '').split('/').pop()}:${x.sourceFunctionName ?? ''} ${Math.round(x.duration)}`) }); }); po.observe({ type: "long-animation-frame", buffered: false }); } catch { po = null; }
  rec.stop = async () => {
    rec.on = false;
    for ( let i = 0; i < 20 && pend.length; i++ ) {
      await new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = r; c.port2.postMessage(0); }); gl.finish();   // (a hidden page has no animation frames)
      while ( pend.length && gl.getQueryParameter(pend[0][1], gl.QUERY_RESULT_AVAILABLE) ) { const [f2, q2] = pend.shift(); f2.gpu = gl.getQueryParameter(q2, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q2); }
    }
    for ( const [, q2] of pend.splice(0) ) gl.deleteQuery(q2);
    po?.disconnect(); for ( const u of undo.reverse() ) u();
  };
  return rec;
}

const board = () => canvas.app.view;
const ptr = (type, x, y, buttons) => new PointerEvent(type, { clientX: x, clientY: y, button: type === "pointermove" ? -1 : 2, buttons, pointerId: 1, pointerType: "mouse",
  isPrimary: true, bubbles: true, cancelable: true, composed: true, view: window });

/** One move (see the header); returns the summary row and the raw frames. `c` = scene point to start at (default the scene centre). */
export async function move(kind, { ms = 2500, z = 1, c = null, settle = 600 } = {}) {
  const sr = canvas.dimensions.sceneRect; c ??= [sr.x + sr.width / 2, sr.y + sr.height / 2];
  canvas.pan({ x: c[0], y: c[1], scale: z });
  await sleep(settle);
  const rec = recorder(), ev = rec.events, b = board().getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
  rec.on = true;
  const t0 = rec.t0 = performance.now();
  try {
    if ( kind === "drag" ) {
      board().dispatchEvent(ptr("pointerdown", cx, cy, 2)); ev.push(performance.now());
      const A = Math.min(b.width, b.height) * 0.3;
      while ( performance.now() - t0 < ms ) {
        await raf();
        const u = (performance.now() - t0) / 1000 * 2.4;
        const e = ptr("pointermove", cx + A * Math.sin(u), cy + A * Math.sin(2 * u) * 0.5, 2);
        board().dispatchEvent(e); ev.push(performance.now());
      }
      board().dispatchEvent(ptr("pointerup", cx, cy, 0)); window.dispatchEvent(ptr("pointerup", cx, cy, 0));
    } else if ( kind === "wheel" ) {
      // bursts: 12 notches in (one every 40 ms), a pause, 18 out, 12 in ...
      const seq = [[-1, 12], [1, 18], [-1, 14], [1, 8]];
      outer: for ( const [s, n] of seq ) {
        for ( let i = 0; i < n; i++ ) {
          if ( performance.now() - t0 > ms * 2 ) break outer;
          const x = cx + (s < 0 ? 80 : -60), y = cy + (s < 0 ? -40 : 30);
          board().dispatchEvent(new WheelEvent("wheel", { deltaY: s * 100, deltaMode: 0, clientX: x, clientY: y, bubbles: true, cancelable: true, view: window }));
          ev.push(performance.now());
          await sleep(40);
        }
        await sleep(250);
      }
      await sleep(400);
    } else if ( kind === "animate" ) {
      const legs = [{ x: c[0] + 300, y: c[1] - 200, scale: 3, duration: 700 }, { x: c[0] - 400, y: c[1] + 250, scale: 0.6, duration: 900 }, { x: c[0], y: c[1], scale: 1.6, duration: 700 }];
      for ( const l of legs ) { ev.push(performance.now()); await canvas.animatePan(l); }
    }
    await sleep(200);
  } finally { await rec.stop(); }
  return summarize(kind, rec);
}

/** The row: intervals, work, weather CPU, input delay, stall causes. */
export function summarize(kind, rec) {
  const F = rec.frames; if ( F.length < 3 ) return { kind, frames: F.length };
  const P = game.modules.get("moinen-maps").api.view?.pacing?.() ?? {}, per = (P.period ?? 1000 / 60) * (P.k ?? 1), vs = P.period ?? per;
  const iv = []; for ( let i = 1; i < F.length; i++ ) iv.push(F[i].t - F[i - 1].t);
  const work = F.map((f) => f.cpu + (f.gpu ?? 0));
  const late = iv.filter((d) => d > per + vs * 0.5).length;
  const delay = rec.events.map((t) => { const f = F.find((x) => x.t > t); return f ? f.t + f.cpu - t : null; }).filter((x) => x !== null);
  let gc = 0, gcMB = 0; for ( let i = 1; i < F.length; i++ ) { const d = F[i - 1].heap - F[i].heap; if ( d > 1 << 20 ) { gc++; gcMB += d / 1048576; } }
  const sum = (k) => F.reduce((s, f) => s + (f[k] ?? 0), 0);
  const longs = F.map((f, i) => [i, f]).filter(([, f]) => f.cpu + (f.gpu ?? 0) > 16.7).slice(0, 6)
    .map(([i, f]) => `#${i} cpu ${r2(f.cpu)} gpu ${r2(f.gpu ?? -1)} wx ${r2(f.wx ?? 0)}${["rtMade", "glTex", "compile", "link", "readback", "texUpload"].map((k) => f[k] ? ` ${k}${f[k]}` : "").join("")}`);
  const desc = (f) => `cpu ${r2(f.cpu)} gpu ${r2(f.gpu ?? -1)} wx ${r2(f.wx ?? 0)} z ${r2(f.s)}${["rtMade", "glTex", "compile", "link", "readback", "texUpload", "finish"].map((k) => f[k] ? ` ${k}${f[k]}` : "").join("")}`;
  const lates = []; for ( let i = 1; i < F.length && lates.length < 6; i++ ) if ( iv[i - 1] > per + vs * 0.5 ) lates.push(`iv ${r2(iv[i - 1])} before #${i} (${desc(F[i])}); prev #${i - 1} (${desc(F[i - 1])})`);
  return {
    lates, kind, frames: F.length, frameMs: r2(per), moved: { px: Math.round(Math.max(...F.map((f) => f.px)) - Math.min(...F.map((f) => f.px))), z: [r2(Math.min(...F.map((f) => f.s))), r2(Math.max(...F.map((f) => f.s)))] },
    iv: { p50: r2(q(iv, 0.5)), p95: r2(q(iv, 0.95)), max: r2(Math.max(...iv)) }, late,
    cpu: { p50: r2(q(F.map((f) => f.cpu), 0.5)), p95: r2(q(F.map((f) => f.cpu), 0.95)), max: r2(Math.max(...F.map((f) => f.cpu))) },
    gpu: { p50: r2(q(F.map((f) => f.gpu ?? 0), 0.5)), p95: r2(q(F.map((f) => f.gpu ?? 0), 0.95)), max: r2(Math.max(...F.map((f) => f.gpu ?? 0))), n: F.filter((f) => f.gpu !== undefined).length },
    work: { p95: r2(q(work, 0.95)), max: r2(Math.max(...work)), long: work.filter((w) => w > 16.7).length },
    wx: { p50: r2(q(F.map((f) => f.wx ?? 0), 0.5)), p95: r2(q(F.map((f) => f.wx ?? 0), 0.95)), max: r2(Math.max(...F.map((f) => f.wx ?? 0))) },
    delay: { n: delay.length, p50: r2(q(delay, 0.5)), p95: r2(q(delay, 0.95)), max: r2(delay.length ? Math.max(...delay) : 0) },
    loaf: { n: rec.loaf.length, max: r2(Math.max(0, ...rec.loaf.map((l) => l.d))), block: r2(Math.max(0, ...rec.loaf.map((l) => l.b))) },
    stalls: { rtMade: sum("rtMade"), glTex: sum("glTex"), compile: sum("compile"), link: sum("link"), readback: sum("readback"), texUpload: sum("texUpload"), finish: sum("finish"), gc, gcMB: r2(gcMB) },
    longs
  };
}

/** Weather OFF / ON interleaved over the moves: `setup(on)` (async) sets the case. Rows: { kind, rep, on, ...summary }. */
export async function pair(setup, kinds = ["drag", "wheel", "animate"], { reps = 2, ...o } = {}) {
  const rows = [];
  for ( let r = 0; r < reps; r++ ) for ( const on of [false, true] ) {
    await setup(on);
    for ( const k of kinds ) rows.push({ rep: r, on, ...(await move(k, o)) });
  }
  return rows;
}

/** A compact line per row (for the report). */
export const line = (x) => `${x.kind.padEnd(7)} ${x.on ? "ON " : "off"} r${x.rep} | iv p95 ${x.iv.p95} max ${x.iv.max} late ${x.late}/${x.frames} | pan ${x.moved.px} z ${x.moved.z.join('-')} | work p95 ${x.work.p95} max ${x.work.max} long ${x.work.long} | cpu p95 ${x.cpu.p95} gpu p95 ${x.gpu.p95} max ${x.gpu.max} | wx p95 ${x.wx.p95} max ${x.wx.max} | delay p95 ${x.delay.p95} max ${x.delay.max} | loaf ${x.loaf.n} ${x.loaf.max} | ${Object.entries(x.stalls).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(" ")}`;

/** The heavy cases: [name, setup(on)] (dev/weather-cost.mjs setCase; the tornado on a drawn path through the view). */
export async function heavyCases() {
  const C = await import("./weather-cost.mjs"), sr = canvas.dimensions.sceneRect, cx = sr.x + sr.width / 2, cy = sr.y + sr.height / 2;
  const path = [[cx - 500, cy - 300], [cx - 200, cy + 100], [cx + 150, cy - 50], [cx + 450, cy + 250], [cx + 600, cy - 200]];
  return [["rain3+lens", (on) => C.setCase(on ? "rain" : "off", 3)], ["sand3", (on) => C.setCase(on ? "sand" : "off", 3)],
    ["wind3", (on) => C.setCase(on ? "wind" : "off", 3)], ["tornado3", (on) => C.setCase(on ? "tornado" : "off", 3, { path })],
    ["storm3", (on) => C.setCase(on ? "storm" : "off", 3)]];
}

/**
 * The whole matrix in the background (a javascript call would time out): `start(label, opts)` returns at once; `window.__mm`
 * = { done, i, rows, err }. Rows: { case, dpr, dark, rep, on, ...summary }. Saved to mm-rec/move-<label>.json at the end.
 */
/**
 * CPU THROTTLE EMULATION (no CDP from the page): every ticker step (Foundry's own listeners, the weather's, the render submit) is
 * stretched to `rate` x its time by a busy wait after it, so the frame's main-thread work costs what it would on a CPU `rate` x
 * slower. Input handlers and GC are not stretched. Returns the undo.
 */
export function throttle(rate) {
  if ( !(rate > 1) ) return () => {};
  const T = canvas.app.ticker, f = T.update;
  T.update = function(...a) {
    const t = performance.now(); const r = f.apply(this, a);
    const end = performance.now() + (performance.now() - t) * (rate - 1);
    while ( performance.now() < end ) { /* the slower CPU */ }
    return r;
  };
  return () => { delete T.update; if ( T.update !== f ) T.update = f; };
}

export function start(label, { cases = null, kinds = ["drag", "wheel", "animate"], reps = 2, dprs = [1, 2], darks = [0, 1], cpus = [1], ...o } = {}) {
  const S = window.__mm = { done: false, i: 0, rows: [], err: null, label };
  (async () => {
    const H = await import("./perf-harness.mjs"), list = await heavyCases(), dpr0 = canvas.app.renderer.resolution, dk0 = canvas.scene.environment.darknessLevel;
    try {
      for ( const dark of darks ) {
        await canvas.scene.update({ "environment.darknessLevel": dark ? 0.9 : 0 }, { animateDarkness: 0 }); await sleep(1500);
        for ( const dpr of dprs ) {
          await H.setDPR(dpr);
          for ( const [name, setup] of list ) {
            if ( cases && !cases.includes(name) ) continue;
            for ( const cpu of cpus ) for ( let r = 0; r < reps; r++ ) for ( const on of [false, true] ) {
              await setup(on);
              const un = throttle(cpu);
              try { for ( const k of kinds ) { S.rows.push({ case: name, dpr, dark, rep: r, on, cpu, ...(await move(k, o)) }); S.i++; } } finally { un(); }
            }
          }
        }
      }
      await (await import("./weather-cost.mjs")).setCase("off", 1);
    } catch ( e ) { S.err = String(e?.stack ?? e); }
    finally {
      await H.setDPR(dpr0); await canvas.scene.update({ "environment.darknessLevel": dk0 }, { animateDarkness: 0 });
      try {
        const FP = foundry.applications.apps.FilePicker.implementation;
        await FP.upload("data", "mm-rec", new File([JSON.stringify(S.rows)], `move-${label}.json`, { type: "application/json" }), {}, { notify: false });
      } catch ( e ) { S.err = (S.err ?? "") + " save: " + e; }
      S.done = true;
    }
  })();
  return S;
}

/**
 * The frame guard live: a ticker listener burns `load` ms of CPU per frame for `secs` (frames come late), then stops; every frame's
 * q (api.weather.guard), the drawn drops + particles and the interval are kept. Returns q every 0.5 s, the largest q change in one
 * frame, the instance counts, the time to the floor and back. `guard: false` = the control (CONFIG.moinenMaps.weatherGuard = false).
 */
export async function guardCheck({ load = 26, secs = 6, after = 8, guard = true } = {}) {
  const T = canvas.app.ticker, d = W().display(), cm = (CONFIG.moinenMaps ??= {});
  const was = cm.weatherGuard; if ( !guard ) cm.weatherGuard = false;
  const rows = [], t0 = performance.now();
  let on = true;
  const burn = () => { if ( !on ) return; const e = performance.now() + load; while ( performance.now() < e ); };
  const look = () => { const g = W().guard(); rows.push({ t: performance.now() - t0, q: g.q, late: g.late, inst: (d?.stats.instances ?? 0) + (d?.stats.parts ?? 0), dt: T.elapsedMS }); };
  T.add(burn); T.add(look, null, PIXI.UPDATE_PRIORITY.UTILITY);
  try { await sleep(secs * 1000); on = false; await sleep(after * 1000); }
  finally { T.remove(burn); T.remove(look); if ( !guard ) cm.weatherGuard = was; }
  let dq = 0; for ( let i = 1; i < rows.length; i++ ) dq = Math.max(dq, Math.abs(rows[i].q - rows[i - 1].q));
  const floor = rows.find((r) => r.q <= 0.351), back = rows.find((r) => r.t > secs * 1000 && r.q >= 0.999);
  const every = []; for ( let s = 0; s < secs + after; s += 0.5 ) { const r = rows.find((x) => x.t >= s * 1000); if ( r ) every.push(`${s}s q ${r.q} inst ${r.inst}`); }
  return { frames: rows.length, maxStepQ: r2(dq), floorAt: floor ? r2(floor.t / 1000) : null, backAt: back ? r2(back.t / 1000 - secs) : null, every };
}

/**
 * The guard on video (virtual clock, as tornado-dev recIvf: VP9 frames into an IVF, mm-rec/<name>): the weather's time steps exactly
 * 1 / fps per frame, but the ticker is told the frames came `lateMs` apart from `t1` to `t2` (ms of video), so the guard sees a
 * sustained slow-down there and only there. Returns [bytes, path, frames, q per 0.5 s].
 */
export async function guardVideo(name, { ms = 16000, t1 = 2000, t2 = 7000, lateMs = 26, fps = 60, bitrate = 9e6 } = {}) {
  const V = canvas.app.view, Wd = V.width & ~1, Ht = V.height & ~1;
  const C = Object.assign(document.createElement("canvas"), { width: Wd, height: Ht }), g2 = C.getContext("2d");
  const chunks = [], qs = [];
  const enc = new VideoEncoder({ output: (c) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); chunks.push([b, c.timestamp]); }, error: (e) => console.error(e) });
  enc.configure({ codec: "vp09.00.10.08", width: Wd, height: Ht, bitrate, framerate: fps });
  const T = canvas.app.ticker, mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const G = await import("../scripts/weather/guard.mjs"); G.setPacingOverride({ frame: 1000 / fps, slack: 1000 / fps / 4 });
  const realNow = Date.now, dt = 1000 / fps, n = Math.round(ms / dt);
  const base = Math.ceil(realNow() / 1000) * 1000 + 1;
  let vt = base, pt = performance.now();
  Date.now = () => Math.floor(vt);
  try {
    for ( let i = 0; i < n; i++ ) {
      const at = i * dt; vt = base + at;
      pt += at >= t1 && at < t2 ? lateMs : dt;
      T.update(pt); g2.drawImage(V, 0, 0);
      if ( i % Math.round(fps / 2) === 0 ) qs.push(`${(at / 1000).toFixed(1)}s q ${W().guard().q}`);
      const f = new VideoFrame(C, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      enc.encode(f, { keyFrame: i % 120 === 0 }); f.close();
      while ( enc.encodeQueueSize > 2 ) await sleep(5);
      await sleep(1);
    }
  } finally { G.setPacingOverride(null); Date.now = realNow; T.maxFPS = mf; T.lastTime = performance.now(); if ( st ) T.start(); }
  await enc.flush(); enc.close();
  const total = 32 + chunks.reduce((a, [b]) => a + 12 + b.length, 0), out = new Uint8Array(total), dv = new DataView(out.buffer);
  out.set([68, 75, 73, 70], 0); dv.setUint16(4, 0, true); dv.setUint16(6, 32, true); out.set([86, 80, 57, 48], 8);
  dv.setUint16(12, Wd, true); dv.setUint16(14, Ht, true); dv.setUint32(16, fps, true); dv.setUint32(20, 1, true); dv.setUint32(24, chunks.length, true);
  let o = 32;
  for ( const [b, ts] of chunks ) { dv.setUint32(o, b.length, true); dv.setBigUint64(o + 4, BigInt(Math.round(ts * fps / 1e6)), true); out.set(b, o + 12); o += 12 + b.length; }
  const FP = foundry.applications.apps.FilePicker.implementation;
  const r = await FP.upload("data", "mm-rec", new File([out], name, { type: "application/octet-stream" }), {}, { notify: false });
  return [total, r?.path, chunks.length, qs];
}

/**
 * HIDDEN-PANE fallback (no requestAnimationFrame: real input and frame intervals cannot be measured): the same three camera paths
 * stepped by hand on a 60 Hz virtual clock, each frame's CPU (the ticker step) and GPU (a timer query; read after gl.finish), the
 * weather tickers' CPU and the stall counters. Frame work > 16.7 ms is what would be a long frame on a visible page.
 */
export function stepMove(kind, { n = 150, z = 1, c = null } = {}) {
  const sr = canvas.dimensions.sceneRect; c ??= [sr.x + sr.width / 2, sr.y + sr.height / 2];
  const T = canvas.app.ticker, R = canvas.app.renderer, gl = R.gl, ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const rec = recorder(); rec.on = true; rec.t0 = performance.now();
  const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const realNow = Date.now; let vt = realNow(), pt = performance.now(); Date.now = () => Math.floor(vt);
  const path = (i) => {
    const u = i / (n - 1);
    if ( kind === "drag" ) return [c[0] + 300 * Math.sin(u * 6.28), c[1] + 150 * Math.sin(u * 12.57), z];
    if ( kind === "wheel" ) return [c[0], c[1], Math.exp(Math.log(0.6) + (Math.log(5) - Math.log(0.6)) * (0.5 - 0.5 * Math.cos(u * 6.28)))];
    return [c[0] + 400 * (u - 0.5), c[1] - 250 * Math.sin(u * 3.14), Math.exp(Math.log(0.7) + Math.log(3 / 0.7) * Math.sin(u * 3.14))];
  };
  try {
    for ( let i = 0; i < n; i++ ) {
      const [x, y, s] = path(i); canvas.pan({ x, y, scale: s });
      vt += 1000 / 60; pt += 1000 / 60; T.update(pt); gl.finish();
    }
  } finally { Date.now = realNow; T.maxFPS = mf; T.lastTime = performance.now(); if ( st ) T.start(); rec.on = false; }
  return rec;
}
/** stepMove summarized (after the GPU queries are read). */
export async function stepMoveRow(kind, o = {}) {
  const rec = stepMove(kind, o); await rec.stop();
  const F = rec.frames, work = F.map((f) => f.cpu + (f.gpu ?? 0)), cpu = F.map((f) => f.cpu), gpu = F.map((f) => f.gpu ?? 0), wx = F.map((f) => f.wx ?? 0);
  const sum = (k) => F.reduce((s, f) => s + (f[k] ?? 0), 0);
  return { kind, frames: F.length, gpuN: F.filter((f) => f.gpu !== undefined).length,
    cpu: { p50: r2(q(cpu, 0.5)), p95: r2(q(cpu, 0.95)), max: r2(Math.max(...cpu)) }, gpu: { p50: r2(q(gpu, 0.5)), p95: r2(q(gpu, 0.95)), max: r2(Math.max(...gpu)) },
    work: { p95: r2(q(work, 0.95)), max: r2(Math.max(...work)), long: work.filter((w) => w > 16.7).length }, wx: { p95: r2(q(wx, 0.95)), max: r2(Math.max(...wx)) },
    stalls: { rtMade: sum("rtMade"), glTex: sum("glTex"), compile: sum("compile"), link: sum("link"), readback: sum("readback"), texUpload: sum("texUpload") } };
}

/**
 * COLD START: the frames while a weather case starts (the scene flag written, the display built, its passes compiled and its
 * targets made on their first draws), in real time (the pane shown). Run it first on a fresh page load for the cold numbers, again
 * for the warm ones. Returns the summary (longs: the frames over 16.7 ms and what they did).
 */
export async function coldStart(e, l = 3, { ms = 2000, at = null } = {}) {
  const C = await import("./weather-cost.mjs"), rec = recorder();
  rec.on = true; rec.t0 = performance.now();
  try { await C.setCase(e, l, { at }); await sleep(ms); } finally { await rec.stop(); }
  const s = summarize("cold", rec), F = rec.frames;
  const top = F.map((f, i) => [i, f]).sort((a, b) => (b[1].cpu + (b[1].gpu ?? 0)) - (a[1].cpu + (a[1].gpu ?? 0))).slice(0, 4)
    .map(([i, f]) => `#${i} cpu ${r2(f.cpu)} gpu ${r2(f.gpu ?? -1)}${["rtMade", "glTex", "compile", "link", "readback", "texUpload", "progQuery"].map((k) => f[k] ? ` ${k}${f[k]}` : "").join("")}`);
  return { e, l, frames: s.frames, work: s.work, cpu: s.cpu, stalls: s.stalls, late: s.late, ivMax: s.iv.max, top };
}
