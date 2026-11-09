// ============================================================================================================================
// moinen-maps - TEST STOŁU / TABLE CHECK
// ----------------------------------------------------------------------------------------------------------------------------
// PO POLSKU (dla gracza):
//   1. Wejdź do gry jak zwykle i otwórz scenę, na której jest ogień, dym i pogoda (MG powie którą). Odczekaj chwilę, aż wszystko się wczyta.
//   2. Naciśnij F12 (albo Ctrl+Shift+I) i wybierz kartę "Console" / "Konsola".
//      Jeśli przeglądarka nie pozwala wkleić, wpisz najpierw:  allow pasting  (i Enter).
//   3. Wklej CAŁY ten plik i naciśnij Enter. Nie ruszaj mapy przez ok. 10 s.
//   4. Gdy w konsoli pojawi się "PRZESUWAJ MAPĘ", przez 10 s przesuwaj i przybliżaj/oddalaj mapę (przeciąganie, kółko myszy).
//      Jeśli nic nie zrobisz, test sam poprowadzi kamerę. Potem obraz stanie na 1-3 s - to celowe (pomiar zapasu mocy).
//   5. Na końcu pojawi się podsumowanie i werdykt (OK / NA STYK / ZA CIĘŻKO) z radami. Blok JSON jest już w schowku
//      (jeśli nie, zaznacz ostatnią linię w konsoli i skopiuj ją). Wyślij go MG (Discord, czat) - całość, razem z nawiasami { }.
//   Test niczego nie zapisuje: nie zmienia świata, sceny, flag ani ustawień; inni gracze nic nie widzą (nawet Twojego kursora
//   podczas symulowanego przesuwania). Kamera wraca na miejsce.
//
// ENGLISH: open the scene with fire, smoke and weather, F12 > Console, paste this whole file, Enter. Keep still ~10 s, then pan and
//   zoom the map for 10 s when asked (or let it simulate); the picture then stops for 1-3 s (the headroom measurement). Send the JSON
//   block (already on the clipboard when possible) to the GM. Read-only: no world, scene, flag or setting is changed.
//
// HOW IT MEASURES (dev):
//   REST and PAN run on the REAL ticker - what the eye gets: frame intervals (rAF), Long Animation Frames with script attribution,
//   CPU per ticker listener, the weather guard q, the fire's adaptive level. No GPU timing there: on a paced ticker the GPU idles
//   between frames and clocks down, and a timer query also counts the GPU waiting for the CPU - it reads high and moves with load.
//   CAPACITY (last, so its blocks never disturb the rest / pan numbers or the guards): ~1.5 s of frames rendered back to back with real time (the ticker stopped and stepped by hand, then restored - as
//   dev/stack-bench.mjs measures): the GPU queue full and clocked up, so a timer query per ticker listener is GPU busy time; the
//   frame cost = wall time / frames (after gl.finish) = the frame rate this machine can hold. OWNERS: the same, with timer queries
//   around each owner's own objects (fire / weather / destruction / lighting; rest = the frame minus them).
//   Without EXT_disjoint_timer_query_webgl2 the GPU split is skipped; the frame cost still is measured.
//   globalThis.TABLE_CHECK = { slowGpu: 2 } before pasting EMULATES a GPU k x slower (an extra GPU pass each frame, fitted in the
//   back-to-back frames to (k - 1) x the frame's own GPU work); { auto: true } simulates the pan at once; { rest, pan, waitPan }
//   seconds; { copy: false } leaves the clipboard alone; { noTimer: true } acts as a browser without timer queries. The result: window.__tableCheck (the promise: window.__tableCheckP).
//   Ideas shared with dev/stack-bench.mjs (listener wrapping, owner attribution) and dev/tools/long-frame-probe.js.
// ============================================================================================================================
window.__tableCheckP = (async () => {
  const OPT = Object.assign({ rest: 8, pan: 10, waitPan: 3, capMs: 1500, ownMs: 1000, auto: false, slowGpu: 1, copy: true }, globalThis.TABLE_CHECK ?? {});
  const MOD = "moinen-maps", t00 = performance.now();
  const r2 = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 100) / 100);
  const qt = (a, f) => { if ( !a.length ) return null; const s = [...a].sort((x, y) => x - y); return r2(s[Math.min(s.length - 1, Math.floor(s.length * f))]); };
  const avg = (a) => (a.length ? r2(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const stat = (a) => ({ p50: qt(a, 0.5), p95: qt(a, 0.95), p99: qt(a, 0.99), max: qt(a, 1), mean: avg(a) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setting = (m, k) => { try { return game.settings.get(m, k); } catch { return undefined; } };
  if ( !globalThis.canvas?.ready ) { console.warn("table-check: brak sceny / no scene"); return null; }
  const A = game.modules.get(MOD)?.api ?? null, W = A?.weather ?? null;
  const R = canvas.app.renderer, gl = R.gl, T = canvas.app.ticker;

  // ------------------------------------------------------------------------------------------------ the machine and the scene
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const gpuName = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const gpuVendor = String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
  const backend = gpuName.match(/Direct3D11|Direct3D9|D3D11|D3D9|OpenGL ES|OpenGL|Vulkan|Metal|SwiftShader/i)?.[0] ?? null;
  const software = /SwiftShader|llvmpipe|Software|Basic Render/i.test(gpuName);
  const ext = OPT.noTimer ? null : gl.getExtension("EXT_disjoint_timer_query_webgl2");   // (noTimer: dev, a browser without it)
  const F = canvas.scene.flags?.[MOD] ?? {};
  const strokes = Object.values(F.fireStrokes ?? {});
  const wk = F.weather?.keys?.[F.weather.keys.length - 1] ?? null;
  const fd = A?.fire?.display?.() ?? null, dd = A?.destruction?.display?.() ?? null;
  let fst = null; try { fst = A?.fire?.status?.(); } catch {}
  let wst = null; try { wst = W?.status?.(); } catch {}
  const info = {
    when: new Date().toISOString(), user: game.user?.name, gm: !!game.user?.isGM, foundry: game.version, system: game.system?.id,
    module: game.modules.get(MOD)?.version ?? null, moduleActive: !!game.modules.get(MOD)?.active,
    gpu: gpuName, vendor: gpuVendor, backend, software, timerQuery: !!ext,
    browser: navigator.userAgent, cores: navigator.hardwareConcurrency ?? null, memGB: navigator.deviceMemory ?? null,
    dpr: window.devicePixelRatio, resolution: R.resolution, canvasCss: [R.screen.width, R.screen.height], canvasPx: [R.view.width, R.view.height],
    zoom: r2(canvas.stage.scale.x),
    scene: { name: canvas.scene.name, darkness: r2(canvas.scene.environment?.darknessLevel ?? canvas.environment?.darknessLevel ?? 0),
      fire: strokes.filter((s) => s.k !== "smoke").length, smoke: strokes.filter((s) => s.k === "smoke").length,
      fireAreas: fst?.areas ?? null, fireVisible: fst?.visible ?? null, fireLights: fst?.lights ?? null,
      weather: F.weather?.tornadoes?.length ? `tornado x${F.weather.tornadoes.length}` : (wk && wk.preset !== "clear" ? `${wk.preset} L${wk.level ?? "?"}` : "off"),
      weatherShown: wst?.shown ?? null, lens: !!W?.lensDisplay?.()?.sprite?.visible, destruction: Object.keys(F.destructionObjects ?? {}).length },
    settings: { corePerformance: setting("core", "performanceMode"), coreMaxFPS: setting("core", "maxFPS"), corePixelRatioScaling: setting("core", "pixelRatioResolutionScaling"),
      perfMode: setting(MOD, "performanceMode"), weatherDetail: setting(MOD, "weatherDetail"), weatherLens: setting(MOD, "weatherLens"),
      framePacing: setting(MOD, "framePacing"), reducedMotion: setting(MOD, "respectReducedMotion"), osReducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches },
    switches: { fireAdaptive: CONFIG.moinenMaps?.fireAdaptive !== false, fireAhead: CONFIG.moinenMaps?.fireAhead !== false, weatherGuard: CONFIG.moinenMaps?.weatherGuard !== false },
    options: { ...OPT }
  };

  // ------------------------------------------------------------------------------------------------ recorders (all undone in finally)
  const undo = [], S = { phase: "warm", frame: 0, cpu: 0, gpuOn: false, qActive: false, pend: [], dis: 0 };
  const wins = [];                   // [phase, start ms] - rAF intervals and LoAF entries are put in phases by their time
  const setPhase = (p) => { S.phase = p; wins.push([p, performance.now()]); };
  const phaseAt = (t) => { let p = "warm"; for ( const [q, s] of wins ) { if ( s <= t ) p = q; else break; } return p; };
  setPhase("warm");
  const frames = [];                 // per ticker frame: { phase, cpu, gpu, gk, burn, q, lv }
  const iv = [];                     // [time, ms] rAF intervals
  const loaf = [];
  const ownGpu = {}; let ownFrames = 0;
  const lsCpu = new Map(), lsGpu = new Map();
  const view0 = { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y, scale: canvas.stage.scale.x };
  const BURN = "EMULATED slow GPU";
  let burn = null;

  // GPU timer queries (never nested); results read when they come in
  const qBegin = () => { if ( !ext || S.qActive ) return null; const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); S.qActive = true; return q; };
  const qEnd = (q, tag) => { if ( !q ) return; try { R.batch?.flush?.(); } catch {} gl.endQuery(ext.TIME_ELAPSED_EXT); S.qActive = false; S.pend.push([q, S.frame, tag]); };
  const fr = (i) => frames[i] ??= { phase: S.phase, cpu: 0, gpu: 0, gk: 0 };
  function poll(all = false) {
    if ( !ext ) return;
    if ( gl.getParameter(ext.GPU_DISJOINT_EXT) ) { for ( const [q, f] of S.pend ) { gl.deleteQuery(q); fr(f).bad = true; } S.pend = []; S.dis++; return; }
    const keep = [];
    for ( const p of S.pend ) {
      const [q, f, tag] = p;
      if ( !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) ) { if ( all ) { fr(f).bad = true; gl.deleteQuery(q); } else keep.push(p); continue; }
      const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q);
      const x = fr(f); x.gk++;
      if ( tag[0] === "L" ) { x.gpu += ms; if ( tag[1] === BURN ) x.burn = (x.burn ?? 0) + ms; if ( x.phase === "cap" ) lsGpu.set(tag[1], (lsGpu.get(tag[1]) ?? 0) + ms); }
      else if ( x.phase === "owners" ) ownGpu[tag[1]] = (ownGpu[tag[1]] ?? 0) + ms;
    }
    S.pend = keep;
  }

  // the frame clock: the first listener of every tick closes the frame before (its CPU, the guards as they stand)
  const guardsNow = () => { let q = null; try { q = W?.guard?.()?.q ?? null; } catch {} return { q, lv: fd?.level ?? null }; };
  const onTick = () => {
    const prev = frames[S.frame];
    if ( prev ) { prev.cpu = S.cpu; Object.assign(prev, guardsNow()); }
    S.frame++; S.cpu = 0; fr(S.frame);
    if ( S.phase === "owners" ) ownFrames++;
    if ( S.phase !== "cap" && S.phase !== "owners" && !S.phase.startsWith("calib") ) poll();
  };
  T.add(onTick, null, (PIXI.UPDATE_PRIORITY?.INTERACTION ?? 50) + 1000); undo.push(() => T.remove(onTick, null));

  // `n` frames back to back with real time (the ticker stopped, stepped by hand, restored): -> wall ms per frame after gl.finish
  function saturate(phase, n) {
    setPhase(phase);
    const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
    const t0 = performance.now();
    // (a time strictly past the ticker's last one: a paced ticker may hold lastTime ahead of now, and PIXI skips a step that does not move)
    const f0 = S.frame; let tt = Math.max(performance.now(), T.lastTime ?? 0);
    try { for ( let i = 0; i < n; i++ ) { tt = Math.max(performance.now(), tt + 0.05); T.update(tt); } gl.finish(); }
    finally { T.maxFPS = mf; if ( st ) T.start(); }
    const per = S.frame - f0 >= n * 0.9 ? (performance.now() - t0) / n : null;   // (null: the ticker did not step)
    onTick();             // (closes the last stepped frame)
    poll();
    setPhase("settle");
    return per;
  }

  // emulated slow GPU (dev only): a pass after the render whose loop count is fitted to (k - 1) x the frame's own GPU work
  function makeBurn() {
    const VERT = `#version 300 es
precision highp float; in vec2 aVertexPosition; uniform mat3 projectionMatrix; uniform mat3 translationMatrix;
void main() { gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0); }`;
    const FRAG = `#version 300 es
precision highp float; uniform int uN; out vec4 o;
void main() { float v = gl_FragCoord.x * 0.013 + gl_FragCoord.y * 0.007; for ( int i = 0; i < uN; i++ ) v = fract(sin(v * 12.9898 + float(i)) * 43758.5453); o = vec4(v, v, v, 1.0); }`;
    const N = 256, g = new PIXI.Geometry().addAttribute("aVertexPosition", [0, 0, N, 0, N, N, 0, N], 2).addIndex([0, 1, 2, 0, 2, 3]);
    const mesh = new PIXI.Mesh(g, new PIXI.Shader(PIXI.Program.from(VERT, FRAG, "table-check-burn"), { uN: 1 }));
    const rt = PIXI.RenderTexture.create({ width: N, height: N });
    const b = { mesh, rt, n: 0 };
    b.fn = () => { if ( b.n > 0 ) { mesh.shader.uniforms.uN = b.n; R.render(mesh, { renderTexture: rt, clear: false }); } };
    return b;
  }

  // the ticker's listeners, wrapped: CPU per listener and per frame; a GPU timer query per listener while S.gpuOn
  function wrapListeners() {
    const ls = []; for ( let n = T._head?.next; n; n = n.next ) ls.push(n);
    const key = (l) => (l._fn ? "_fn" : "fn");
    const own = new Map();
    for ( const [k, o] of [["fire", fd], ["destruction", dd], ["weather", W?.display?.()], ["weather.lens", W?.lensDisplay?.()], ["weather.steam", W?.steamDisplay?.()], ["weather.tornado", W?.tornadoDisplay?.()]] ) if ( o?._tick ) own.set(o._tick, k);
    if ( burn ) own.set(burn.fn, BURN);
    const nameOf = (l, fn) => {
      if ( own.has(fn) ) return own.get(fn);
      if ( fn === canvas.app.render ) return "canvas render (PIXI: map, tokens, lights, layers)";
      const ctx = l.context?.constructor?.name ?? "";
      return `${ctx ? ctx + "." : ""}${fn?.name || "anon"}: ${String(fn).replace(/\s+/g, " ").slice(0, 36)}`;
    };
    const orig = ls.map((l) => l[key(l)]);
    ls.forEach((l, i) => {
      const fn = orig[i]; if ( fn === onTick ) return;
      const nm = nameOf(l, fn);
      l[key(l)] = function(...a) {
        const q = S.gpuOn ? qBegin() : null, t = performance.now();
        try { return fn.apply(this, a); }
        finally { const d = performance.now() - t; S.cpu += d; if ( S.phase === "rest" ) lsCpu.set(nm, (lsCpu.get(nm) ?? 0) + d); qEnd(q, ["L", nm]); }
      };
    });
    const rm = T.remove;
    T.remove = function(fn, ctx) { ls.forEach((l, i) => { if ( orig[i] === fn ) l[key(l)] = orig[i]; }); return rm.call(this, fn, ctx); };
    return () => { ls.forEach((l, i) => { if ( l[key(l)] !== orig[i] ) l[key(l)] = orig[i]; }); T.remove = rm; };
  }

  // GPU by owner: timer queries around each owner's own objects (no nesting: an object inside a timed one counts to the outer)
  function wrapOwners() {
    const un = [];
    const time = (owner, o, m = "render") => {
      if ( !o || typeof o[m] !== "function" || o[m].__tc ) return;
      const f = o[m], has = Object.prototype.hasOwnProperty.call(o, m);
      const w = function(...a) { if ( S.phase !== "owners" || S.qActive ) return f.apply(this, a); try { R.batch?.flush?.(); } catch {} const q = qBegin(); try { return f.apply(this, a); } finally { qEnd(q, ["O", owner]); } };
      w.__tc = 1; o[m] = w; un.push(() => { if ( has ) o[m] = f; else delete o[m]; });
    };
    // fire (the style's art passes on the shared prototype, each area's meshes, the display's particles)
    const areas = [...(fd?.areas?.values?.() ?? [])];
    const artProto = (() => { for ( const a of areas ) { let p = a.mesh && Object.getPrototypeOf(a.mesh); while ( p && p !== Object.prototype ) { if ( Object.prototype.hasOwnProperty.call(p, "renderArt") ) return p; p = Object.getPrototypeOf(p); } } return null; })();
    if ( artProto ) for ( const m of ["renderArt", "extendArt", "stepJob", "swapJob", "startPre"] ) time("fire", artProto, m);
    for ( const a of areas ) { const mm = a.mesh; if ( !mm ) continue; for ( const k of ["ground", "show", "smoke", "front", "glow"] ) if ( mm[k] ) time("fire", mm[k], "_render"); if ( !mm.isArt ) time("fire", mm); }
    for ( const k of ["particles", "sparks", "root", "embers"] ) if ( fd?.[k]?.render ) time("fire", fd[k]);
    // destruction
    if ( dd ) { time("destruction", dd.objs); time("destruction", dd.fx); }
    // weather (the same targets as dev/weather-cost.mjs)
    const d = W?.display?.(), L = W?.lensDisplay?.(), TD = W?.tornadoDisplay?.(), SD = W?.steamDisplay?.();
    if ( d?.ground ) { for ( const o of [d.ground, d.splash, d.air, d.haze, ...Object.values(d.parts ?? {})] ) time("weather", o); if ( d.groundCells ) { time("weather", d.groundCells, "draw"); time("weather", d.hazeCells, "draw"); } }
    if ( L?.slices ) { for ( const m of L.slices ) time("weather", m); if ( L.runMesh ) { time("weather", L.runMesh); time("weather", L.beadMesh); } time("weather", L.sprite); }
    else if ( L?.pass ) { time("weather", L.pass); time("weather", L.sprite); }
    if ( SD?.root ) time("weather", SD.root);
    for ( const v of TD?.views?.values?.() ?? [] ) { for ( const k of ["curtain", "skirt", "back", "debB", "wallB", "column", "debF", "wallF", "front", "curtainF", "deck", "ground", "marks", "show"] ) if ( v[k] ) time("weather", v[k]); if ( v.groundCells ) time("weather", v.groundCells, "draw"); }
    // lighting (Foundry's effects layers: the fire's lights and every other light, the darkness)
    for ( const k of ["illumination", "coloration", "background", "darkness"] ) if ( canvas.effects?.[k] ) time("lighting", canvas.effects[k]);
    return () => un.reverse().forEach((f) => f());
  }

  // rAF intervals (what the eye gets) and Long Animation Frames (who held the main thread)
  let rafOn = true, lastRaf = null;
  const raf = (t) => { if ( lastRaf !== null ) iv.push([t, t - lastRaf]); lastRaf = t; if ( rafOn ) requestAnimationFrame(raf); };
  requestAnimationFrame(raf); undo.push(() => { rafOn = false; });
  const hasLoaf = !!PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame");
  if ( hasLoaf ) {
    const po = new PerformanceObserver((l) => { for ( const e of l.getEntries() ) loaf.push({ start: e.startTime, t: Math.round(e.startTime - t00), d: Math.round(e.duration), block: Math.round(e.blockingDuration ?? 0),
      scripts: (e.scripts ?? []).map((s) => ({ d: Math.round(s.duration), fn: s.sourceFunctionName || "", url: s.sourceURL || "", inv: String(s.invoker ?? "").slice(0, 60) })) }); });
    po.observe({ type: "long-animation-frame", buffered: false }); undo.push(() => po.disconnect());
  }
  const whoUrl = (u) => {
    const m = u.match(/\/modules\/moinen-maps\/scripts\/([\w.-]+)/);
    if ( m ) return m[1] === "view-smooth.mjs" ? "moinen-maps/view-smooth (frame pacing: the whole ticker frame)" : `moinen-maps/${m[1].replace(/\.mjs$/, "")}`;
    if ( /\/modules\/moinen-maps\//.test(u) ) return "moinen-maps";
    const mm = u.match(/\/(modules|systems)\/([\w.-]+)\//); if ( mm ) return `${mm[1] === "systems" ? "system" : "module"}:${mm[2]}`;
    if ( /foundry\.mjs|pixi/.test(u) ) return "foundry/pixi";
    return u ? u.split("/").pop().slice(0, 40) : "(console / eval)";
  };

  // WHILE THE TEST MOVES THE CAMERA nothing of it may reach other users: (1) the camera moving the world under a still pointer makes
  // Foundry broadcast this user's cursor every 100 ms (they would see it drift): cursor-only activity is held back; (2) modules answer
  // a camera move with socket messages (Lock View wraps Canvas#pan and sends "updateViewbox" to the GM every frame): module messages
  // sent from inside canvas.pan or a canvasPan hook are held back. Everything else passes. The camera ends where it started, so what others last saw stays true.
  // Restored 250 ms after the move (the cursor broadcast is throttled to 100 ms).
  async function quietCamera(fn) {
    const U = game.user, own = Object.prototype.hasOwnProperty.call(U, "broadcastActivity") ? U.broadcastActivity : null;
    const sock = game.socket, emit = sock.emit, callAll = Hooks.callAll; let inPan = 0, held = 0;
    U.broadcastActivity = function(data = {}, o) { const k = Object.keys(data ?? {}); if ( k.length === 1 && k[0] === "cursor" ) { held++; return; } return (own ?? Object.getPrototypeOf(U).broadcastActivity).call(this, data, o); };
    Hooks.callAll = function(hook, ...a) { if ( hook !== "canvasPan" ) return callAll.call(this, hook, ...a); inPan++; try { return callAll.call(this, hook, ...a); } finally { inPan--; } };
    const ownPan = Object.prototype.hasOwnProperty.call(canvas, "pan") ? canvas.pan : null, pan = canvas.pan;
    canvas.pan = function(...a) { inPan++; try { return pan.apply(this, a); } finally { inPan--; } };
    sock.emit = function(ev, ...a) { if ( inPan > 0 && typeof ev === "string" && ev.startsWith("module.") ) { held++; return this; } return emit.call(this, ev, ...a); };
    try { await fn(); await sleep(250); }
    finally { if ( own ) U.broadcastActivity = own; else delete U.broadcastActivity; Hooks.callAll = callAll; sock.emit = emit; if ( ownPan ) canvas.pan = ownPan; else delete canvas.pan; S.held = (S.held ?? 0) + held; }
  }

  const log = (pl, en) => console.log(`%c[table-check] ${pl}\n              ${en}`, "color:#c80;font-weight:bold");
  let mv = { x: 0, y: 0, s: 1 }, panMode = "none", capWall = null, capN = 0, ownN = 0;
  const moved = () => Math.abs(canvas.stage.pivot.x - mv.x) + Math.abs(canvas.stage.pivot.y - mv.y) > 2 || Math.abs(canvas.stage.scale.x - mv.s) > 0.002;

  try {
    log("START - nie ruszaj mapy przez ok. 10 s.", "START - keep the map still for about 10 s.");
    let unwrapL = wrapListeners();
    undo.push(() => unwrapL());
    await sleep(2000);
    // a probe: how long one back-to-back frame takes here (sizes the capacity runs to ~capMs)
    const probe = saturate("probe", 10); await sleep(300);
    capN = Math.max(30, Math.min(240, Math.round(OPT.capMs / Math.max(1, probe))));
    ownN = Math.max(20, Math.min(150, Math.round(OPT.ownMs / Math.max(1, probe))));
    if ( OPT.slowGpu > 1 && ext ) {
      // (fitted in back-to-back frames, the GPU clocked up: burn = (k - 1) x the frame's own GPU work, measured in the same frames)
      burn = makeBurn();
      T.add(burn.fn, null, PIXI.UPDATE_PRIORITY?.UTILITY ?? -50);
      undo.push(() => { T.remove(burn.fn, null); burn.mesh.destroy(); burn.rt.destroy(true); });
      unwrapL(); unwrapL = wrapListeners();
      const fit = [], nb = Math.max(30, Math.round(350 / Math.max(0.5, probe)));
      saturate("calibW", nb); await sleep(100);   // (the GPU clocks up first)
      S.gpuOn = true;
      for ( let it = 0; it < 6; it++ ) {
        saturate(`calib${it}`, nb); await sleep(100); poll(); await sleep(100); poll();
        const fs = frames.filter((f) => f && f.phase === `calib${it}` && f.gk && !f.bad);
        const real = qt(fs.map((f) => f.gpu - (f.burn ?? 0)), 0.5) ?? 0, b = qt(fs.map((f) => f.burn ?? 0), 0.5) ?? 0, want = real * (OPT.slowGpu - 1);
        fit.push({ n: burn.n, real, burn: b });
        burn.n = burn.n === 0 ? 20000 : b > 0.02 ? Math.round(burn.n * Math.min(4, Math.max(0.25, want / b))) : burn.n * 4;
        burn.n = Math.max(1, Math.min(4e6, burn.n));
      }
      S.gpuOn = false;
      info.emulated = { slowGpu: OPT.slowGpu, extraSteps: burn.n, fit };
      await sleep(500);
    }
    // REST: the camera still, the real ticker
    setPhase("rest"); await sleep(OPT.rest * 1000);
    // PAN: the player moves the map, or a simulated camera path
    mv = { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y, s: canvas.stage.scale.x };
    let auto = !!OPT.auto;
    if ( !auto ) {
      log(`PRZESUWAJ MAPĘ: przez ${OPT.pan} s przesuwaj i przybliżaj/oddalaj mapę (przeciąganie, kółko myszy).`, `PAN THE MAP: drag and zoom the map for ${OPT.pan} s (drag, mouse wheel).`);
      setPhase("waitpan"); const end = performance.now() + OPT.waitPan * 1000;
      while ( performance.now() < end && !moved() ) await sleep(50);
      auto = !moved();
    }
    setPhase("pan");
    if ( auto ) {
      panMode = "simulated";
      log("Brak ruchu - test sam prowadzi kamerę.", "No movement - the test moves the camera itself.");
      const r = canvas.dimensions.sceneRect, cx = r.x + r.width / 2, cy = r.y + r.height / 2, s0 = Math.max(canvas.stage.scale.x, 0.5), seg = OPT.pan * 1000 / 5, z = Math.min(3, s0 * 2.5);
      const path = [{ x: r.x + r.width * 0.25, y: r.y + r.height * 0.3, scale: s0 }, { x: r.x + r.width * 0.75, y: r.y + r.height * 0.7, scale: s0 },
        { x: cx, y: cy, scale: z }, { x: r.x + r.width * 0.3, y: r.y + r.height * 0.6, scale: z }, { x: cx, y: cy, scale: s0 }];
      await quietCamera(async () => { for ( const p of path ) await canvas.animatePan({ ...p, duration: seg }); });
    } else { panMode = "player"; await sleep(OPT.pan * 1000); }
    setPhase("gap"); await sleep(300);
    log("Pomiar zapasu - obraz stanie na 1-3 s.", "Measuring headroom - the picture stops for 1-3 s.");
    // CAPACITY: back-to-back frames, GPU per listener
    saturate("capW", Math.max(10, Math.round(350 / Math.max(0.5, probe))));   // (>= 350 ms: a block the guards take for a stall, not a slow frame)   // (the GPU clocks up first)
    S.gpuOn = !!ext; capWall = saturate("cap", capN); S.gpuOn = false;
    await sleep(200); poll(); await sleep(200); poll();
    // OWNERS: back-to-back frames, GPU around each owner's objects
    if ( ext ) { const un = wrapOwners(); try { ownFrames = 0; saturate("owners", ownN); } finally { un(); } await sleep(200); poll(); await sleep(200); poll(); }
    setPhase("end"); await sleep(300);
    log("KONIEC pomiaru - liczę wynik.", "Measuring done - computing the result.");
  } finally {
    S.gpuOn = false; setPhase("end");
    undo.reverse().forEach((f) => { try { f(); } catch (e) { console.warn("table-check undo", e); } });
    await sleep(300); poll(true);
    try { await quietCamera(async () => canvas.pan(view0)); } catch {}
  }

  // ------------------------------------------------------------------------------------------------ the numbers
  const ph = (p) => frames.filter((f) => f && f.phase === p);
  const ivOf = (p) => iv.filter(([t]) => phaseAt(t) === p && phaseAt(t - 0.5) === p).map(([, d]) => d);
  const restIv = ivOf("rest"), panIv = ivOf("pan");
  const disp = Math.max(4, qt(restIv, 0.1) ?? 16.7);
  const restFps = restIv.length ? r2(1000 / avg(restIv)) : null, panFps = panIv.length ? r2(1000 / avg(panIv)) : null;
  const restN = ph("rest").length || 1;
  const listenersCpu = Object.fromEntries([...lsCpu].map(([k, v]) => [k, r2(v / restN)]).filter(([, v]) => v >= 0.01).sort((a, b) => b[1] - a[1]));
  const capF = ph("cap").filter((f) => f.gk && !f.bad);
  const listenersGpu = Object.fromEntries([...lsGpu].map(([k, v]) => [k, r2(v / Math.max(1, ph("cap").length))]).filter(([, v]) => v >= 0.01).sort((a, b) => b[1] - a[1]));
  const capGpu = capF.map((f) => f.gpu), capCpu = ph("cap").map((f) => f.cpu).filter((x) => x > 0);
  const owners = {}; for ( const [k, v] of Object.entries(ownGpu) ) owners[k] = r2(v / Math.max(1, ownFrames));
  if ( ext && capGpu.length ) { const sum = Object.values(owners).reduce((s, x) => s + x, 0); owners.rest = r2(Math.max(0, avg(capGpu) - (burn ? avg(capF.map((f) => f.burn ?? 0)) : 0) - sum)); if ( burn ) owners.emulated = r2(avg(capF.map((f) => f.burn ?? 0))); }
  const guards = (p) => { const fs = ph(p); const qs = fs.map((f) => f.q).filter((x) => typeof x === "number"), lv = fs.map((f) => f.lv).filter((x) => typeof x === "number");
    return { weatherQmin: qs.length ? r2(Math.min(...qs)) : null, weatherQend: qs.length ? r2(qs[qs.length - 1]) : null, fireLevelMax: lv.length ? Math.max(...lv) : null, fireLevelEnd: lv.length ? lv[lv.length - 1] : null }; };
  const loafBy = (p, secs) => { const L = loaf.filter((e) => phaseAt(e.start) === p), by = {}, fns = {};
    for ( const e of L ) { let sd = 0; for ( const s of e.scripts ) { const w = whoUrl(s.url); by[w] = (by[w] ?? 0) + s.d; sd += s.d; const k = `${w} ${s.fn || s.inv}`; fns[k] = (fns[k] ?? 0) + s.d; } if ( e.d - sd > 0 ) by["(render/style/paint)"] = (by["(render/style/paint)"] ?? 0) + e.d - sd; }
    return { count: L.length, perMin: r2(L.length / Math.max(1e-3, secs / 60)), maxMs: L.length ? Math.max(...L.map((e) => e.d)) : 0, msBy: by,
      top: Object.entries(fns).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}ms`) }; };
  const res = {
    tool: "moinen-maps table-check v1", info, seconds: r2((performance.now() - t00) / 1000),
    rest: { fps: restFps, display: { intervalMs: r2(disp), hz: r2(1000 / disp) }, frameMs: stat(restIv), frames: restIv.length,
      over25: restIv.filter((x) => x > 25).length, over34: restIv.filter((x) => x > 34).length, cpuMs: stat(ph("rest").map((f) => f.cpu).filter((x) => x > 0)),
      listenersCpu, loaf: hasLoaf ? loafBy("rest", OPT.rest) : null, guards: guards("rest") },
    capacity: { frameMs: r2(capWall), fps: capWall ? r2(1000 / capWall) : null, frames: capN, cpuMs: stat(capCpu), gpuMs: ext ? stat(capGpu) : null, gpuFrames: capGpu.length, listenersGpu },
    ownersGpuMs: ext ? owners : null, ownersFrames: ownFrames,
    pan: { mode: panMode, fps: panFps, frameMs: stat(panIv), frames: panIv.length, over25: panIv.filter((x) => x > 25).length, over34: panIv.filter((x) => x > 34).length,
      cpuMs: stat(ph("pan").map((f) => f.cpu).filter((x) => x > 0)), loaf: hasLoaf ? loafBy("pan", OPT.pan) : null, guards: guards("pan") },
    gpuDisjoint: S.dis, heldBack: S.held ?? 0
  };

  // ------------------------------------------------------------------------------------------------ the verdict and the advice
  // What the eye gets (fps against the display, hitches, the guards stepping down) and the HEADROOM under a 60 Hz frame (16.7 ms):
  // the capacity frame cost (back to back = max of the CPU's and the GPU's work, both clocked up) and the GPU p95 there.
  //   TOO HEAVY: it cannot hold 60 fps (cost > 16.7 ms), or it stutters (> 5 % of pan frames over 34 ms, rest under 40 fps), or software GL
  //   TIGHT:     cost > 11 ms (under a third of the frame left for the GM's moves, tokens, chat), GPU p95 > 14, rest under 90 % of the
  //              display's rate (up to 60), > 5 % of pan frames over 25 ms, or a guard stepped detail down during the test
  const target = Math.min(60, 1000 / disp);
  // (the cost: the slowest of wall time per frame, the GPU and the CPU per frame - none of them alone is safe from a timer quirk)
  const cost = Math.max(capWall ?? 0, res.capacity.gpuMs?.p50 ?? 0, res.capacity.cpuMs?.p50 ?? 0), gp95 = res.capacity.gpuMs?.p95 ?? 0;
  res.capacity.costMs = r2(cost);
  const panShare34 = panIv.length ? res.pan.over34 / panIv.length : 0, panShare25 = panIv.length ? res.pan.over25 / panIv.length : 0;
  const restShare25 = restIv.length ? res.rest.over25 / restIv.length : 0;
  const gSeq = ["rest", "pan"].flatMap((p) => ph(p)).filter((f) => typeof f.q === "number" || typeof f.lv === "number");
  // (a guard counts when it stepped DOWN during the test - not one still recovering from before it - and by more than a brief single
  // step: weather q under 0.9, the fire two levels down; or either still holding detail down when the test ends, however it got there)
  let qDrop = false, lvUp = false, qLow = 1, lvHi = 0;
  for ( let i = 1; i < gSeq.length; i++ ) { if ( gSeq[i].q < gSeq[i - 1].q - 0.001 ) { qDrop = true; qLow = Math.min(qLow, gSeq[i].q); } if ( gSeq[i].lv > gSeq[i - 1].lv ) { lvUp = true; lvHi = Math.max(lvHi, gSeq[i].lv); } }
  const lvEnd = gSeq[gSeq.length - 1]?.lv ?? 0;
  res.guardsAtStart = { weatherQ: gSeq[0]?.q ?? null, fireLevel: gSeq[0]?.lv ?? null };
  const heavy = [], tight = [];
  if ( software ) heavy.push("software renderer");
  if ( cost > 16.7 ) heavy.push(`frame cost ${r2(cost)} ms > 16.7 (max ~${r2(1000 / cost)} fps)`); else if ( cost > 11 ) tight.push(`frame cost ${r2(cost)} ms > 11`);
  if ( gp95 > 14 && cost <= 16.7 ) tight.push(`GPU p95 ${gp95} ms > 14`);
  if ( restFps !== null && restFps < 40 ) heavy.push(`rest ${restFps} fps < 40`); else if ( restFps !== null && restFps < 0.9 * target ) tight.push(`rest ${restFps} fps < ${r2(0.9 * target)}`);
  if ( panShare34 > 0.05 ) heavy.push(`pan ${Math.round(panShare34 * 100)}% frames > 34 ms`); else if ( panShare25 > 0.05 || restShare25 > 0.03 ) tight.push(`${Math.round(Math.max(panShare25, restShare25) * 100)}% frames > 25 ms`);
  const wqEnd = gSeq[gSeq.length - 1]?.q ?? 1;
  if ( (qDrop && qLow < 0.9) || (lvUp && lvHi >= 2) || wqEnd < 0.9 || lvEnd > 0 ) tight.push(`guards lowered detail (weather q end ${r2(wqEnd)}, fire level end ${lvEnd}; q min ${Math.min(res.rest.guards.weatherQmin ?? 1, res.pan.guards.weatherQmin ?? 1)}, fire level max ${Math.max(res.rest.guards.fireLevelMax ?? 0, res.pan.guards.fireLevelMax ?? 0)})`);
  const verdict = heavy.length ? "TOO HEAVY" : tight.length ? "TIGHT" : "OK";
  res.verdict = verdict; res.why = [...heavy, ...tight];
  // advice: the biggest share first
  const adv = [];
  const cpuSide = (res.capacity.cpuMs?.p50 ?? 0) > (res.capacity.gpuMs?.p50 ?? 0);
  const top = Object.entries(res.ownersGpuMs ?? {}).filter(([k]) => !["rest", "emulated"].includes(k)).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  if ( software ) adv.push(["Włącz sprzętowe przyspieszenie grafiki w przeglądarce (Ustawienia > System) i uruchom ją ponownie - teraz rysuje procesor.", "Turn on hardware acceleration in the browser (Settings > System) and restart it - the CPU is drawing now."]);
  if ( verdict !== "OK" ) {
    if ( !cpuSide && R.resolution > 1 && info.settings.corePixelRatioScaling ) adv.push([`Foundry: Ustawienia > Core > "Pixel Ratio Resolution Scaling" wyłącz (ekran HiDPI, DPR ${info.dpr}: karta rysuje ${r2(R.resolution * R.resolution)}x więcej pikseli).`, `Foundry: Settings > Core > "Pixel Ratio Resolution Scaling" off (HiDPI screen, DPR ${info.dpr}: the GPU draws ${r2(R.resolution * R.resolution)}x the pixels).`]);
    if ( !cpuSide && top === "weather" ) adv.push([`moinen-maps: "Szczegółowość pogody" na "Do poziomu 2", a "Pogoda na obiektywie" na "Wyłączone".`, `moinen-maps: "Weather detail" to "Up to level 2" and "Weather lens effects" to "Off".`]);
    if ( !cpuSide && (top === "fire" || top === "destruction") ) adv.push([`moinen-maps: "Tryb wydajności" na "Średni" (albo "Niski") - mniej cząstek ognia i zniszczeń.`, `moinen-maps: "Performance mode" to "Medium" (or "Low") - fewer fire and destruction particles.`]);
    if ( !cpuSide && top === "lighting" ) adv.push([`Foundry: Ustawienia > Core > "Performance Mode" o stopień niżej (światła i cienie).`, `Foundry: Settings > Core > "Performance Mode" one step lower (lights and shadows).`]);
    if ( cpuSide ) adv.push(["Procesor nie nadąża: zamknij inne karty i programy (gry, nagrywanie, wideo); moinen-maps: \"Tryb wydajności\" na \"Średni\".", "The CPU is the limit: close other tabs and programs (games, recording, video); moinen-maps: \"Performance mode\" to \"Medium\"."]);
    if ( !adv.length ) adv.push([`moinen-maps: "Tryb wydajności" na "Średni".`, `moinen-maps: "Performance mode" to "Medium".`]);
  }
  res.advice = adv.map(([pl, en]) => ({ pl, en }));

  // ------------------------------------------------------------------------------------------------ the summary (PL / EN) + JSON
  const VPL = { "OK": "OK - płynnie, z zapasem", "TIGHT": "NA STYK - działa, ale bez zapasu", "TOO HEAVY": "ZA CIĘŻKO - będą zacięcia" }[verdict];
  const VEN = { "OK": "OK - smooth, with headroom", "TIGHT": "TIGHT - works, little headroom", "TOO HEAVY": "TOO HEAVY - it will stutter" }[verdict];
  const NAMES = { fire: "ogień/fire", weather: "pogoda/weather", destruction: "zniszczenia/destruction", lighting: "światło/lighting", rest: "reszta/rest", emulated: "EMULACJA/emulated" };
  const ow = res.ownersGpuMs ? Object.entries(res.ownersGpuMs).map(([k, v]) => `${NAMES[k] ?? k} ${v}`).join(" · ") : "brak pomiaru GPU w tej przeglądarce / no GPU timing in this browser";
  const sc = info.scene, cap = res.capacity;
  const lines = [
    `moinen-maps · TEST STOŁU / TABLE CHECK · ${res.seconds} s`,
    `WERDYKT: ${VPL}`, `VERDICT: ${VEN}${res.why.length ? `  (${res.why.join("; ")})` : ""}`,
    `GPU: ${gpuName}${backend ? ` [${backend}]` : ""} · DPR ${info.dpr} · canvas ${info.canvasPx.join("x")} px${software ? " · RENDER PROGRAMOWY / SOFTWARE" : ""}${info.emulated ? ` · EMULACJA/EMULATED GPU x${OPT.slowGpu}` : ""}`,
    `Scena/scene: ogień/fire ${sc.fire} (obszary/areas ${sc.fireAreas ?? "-"}, widoczne/visible ${sc.fireVisible ?? "-"}) · dym/smoke ${sc.smoke} · pogoda/weather ${sc.weather}${sc.lens ? " + obiektyw/lens" : ""} · zniszczenia/destruction ${sc.destruction} · ciemność/darkness ${sc.darkness}`,
    `Spokój/rest: ${restFps} fps (ekran/display ~${r2(1000 / disp)} Hz) · klatka/frame p50 ${res.rest.frameMs.p50} p95 ${res.rest.frameMs.p95} p99 ${res.rest.frameMs.p99} max ${res.rest.frameMs.max} ms · >25ms ${res.rest.over25} · CPU ${res.rest.cpuMs.mean} ms/klatkę/frame`,
    `Zapas/headroom: koszt klatki/frame cost ${cap.costMs} ms (max ~${r2(1000 / Math.max(0.1, cap.costMs))} fps; budżet/budget 16.7 ms = 60 fps) · GPU ${cap.gpuMs ? `${cap.gpuMs.p50} ms (p95 ${cap.gpuMs.p95})` : "n.a."} · CPU ${cap.cpuMs.p50} ms (p95 ${cap.cpuMs.p95})`,
    `GPU wg warstwy/by layer (ms/klatkę/frame): ${ow}`,
    `CPU wg słuchacza/by listener (ms): ${Object.entries(listenersCpu).slice(0, 5).map(([k, v]) => `${k.slice(0, 30)} ${v}`).join(" · ")}`,
    `Przesuwanie/pan+zoom (${panMode === "player" ? "gracz/player" : "symulacja/simulated"}): ${panFps} fps · p95 ${res.pan.frameMs.p95} · max ${res.pan.frameMs.max} ms · >25ms ${res.pan.over25} · >34ms ${res.pan.over34}`,
    `Długie klatki/long frames (LoAF): spokój/rest ${res.rest.loaf?.count ?? "n.a."} · pan ${res.pan.loaf?.count ?? "n.a."}${res.pan.loaf?.top?.length || res.rest.loaf?.top?.length ? ` · ${[...(res.rest.loaf?.top ?? []), ...(res.pan.loaf?.top ?? [])].slice(0, 3).join(" | ")}` : ""}`,
    `Strażnicy/guards (rest/pan): pogoda/weather q min ${res.rest.guards.weatherQmin ?? "-"}/${res.pan.guards.weatherQmin ?? "-"} · ogień poziom/fire level max ${res.rest.guards.fireLevelMax ?? "-"}/${res.pan.guards.fireLevelMax ?? "-"} (1 / 0 = pełna jakość/full detail) · rysowanie z wyprzedzeniem/draw-ahead ${info.switches.fireAhead ? "on" : "off"}`,
    ...(adv.length ? ["RADY / ADVICE:", ...adv.flatMap(([pl, en]) => [` - ${pl}`, `   ${en}`])] : [])
  ];
  const json = JSON.stringify(res);
  console.log(`%c${lines.join("\n")}`, `font:12px monospace;color:${verdict === "OK" ? "#3a3" : verdict === "TIGHT" ? "#c80" : "#d33"}`);
  let copied = false;
  if ( OPT.copy ) {
    try { if ( typeof copy === "function" ) { copy(json); copied = true; } } catch {}
    if ( !copied ) try { copied = await Promise.race([navigator.clipboard.writeText(json).then(() => true), sleep(1500).then(() => false)]); } catch {}
  }
  console.log(copied ? "JSON jest w schowku - wklej go MG. / The JSON is on the clipboard - paste it to the GM." : "Skopiuj JSON poniżej (ostatnia linia) i wyślij MG. / Copy the JSON below (the last line) and send it to the GM.");
  console.log(json);
  window.__tableCheck = res;
  return res;
})();
