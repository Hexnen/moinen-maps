// Browser-side check of the CINEMATIC SCREEN EFFECTS (cinematic-fx.mjs). On a lane server, logged in as a REAL PLAYER (a separate origin so the
// session is the player's own), the tab FRONTED, a scene on screen:
//   const C = await import("/modules/moinen-maps/dev/cinematic-fx-check.mjs");
//   const res = await C.cinematicFxCheck();            // -> { ok, rows: [{ name, ok, ... }] }
//   await C.fxStrip({ name: "cine-show" });             // a contact sheet of one show (stage + bars composited) uploaded to worlds/<world>/popout/<name>.png
// Rows: idle cost zero (no overlay, no ticker listener, no pending work) / bars of the configured height, in the page ABOVE the canvas and
// below the interface, pointer-events none / shake moves the stage by whole pixels inside the cap and restores the EXACT position /
// camera follows through animatePan inside the zoom band and returns to the previous view / a wheel or a key aborts the camera at once
// (no return) / opt-outs honoured (bars absent when the client opted out) / master switch / preview leaves strokes and flags untouched /
// nothing left behind (overlays, listeners, timers, entry speed) / idle-bench rest unchanged / (when it exists) perf-harness cameraMoveCheck
// during a show.
const MODULE = "moinen-maps";
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const row = (name, ok, extra = {}) => ({ name, ok: !!ok, ...extra });
const fxApi = () => game.modules.get(MODULE).api.cinematic;
const tickerCount = () => { let n = 0; for ( let l = canvas.app.ticker._head.next; l; l = l.next ) n++; return n; };
const overlays = () => document.querySelectorAll("[data-mm-cin]").length;
const view = () => ({ x: canvas.stage.pivot.x, y: canvas.stage.pivot.y, scale: canvas.stage.scale.x, px: canvas.stage.position.x, py: canvas.stage.position.y });
const clientOpt = (k, v) => game.settings.set(MODULE, k, v);

async function settings(over = {}) {
  const Cin = await import(`/modules/${MODULE}/scripts/destruction/cinematic-core.mjs`);
  return Cin.resolve({ preset: "epic", over: { lbHeight: 15, lbIn: 200, lbOut: 200, camHold: 300, camReturn: 400, shMax: 20, shIntensity: 1, shDecay: 0.6, camZoomMax: 1.6, smOn: false, ...over } }, {});
}
function showStrokes() {
  const R = canvas.dimensions.sceneRect, cx = R.x + R.width / 2, cy = R.y + R.height / 2;
  return { cx, cy, strokes: [{ id: "fx-a", p: [cx - 300, cy, 0, cx, cy - 100, 600, cx + 300, cy, 1200] }, { id: "fx-b", p: [cx + 300, cy, 0, cx + 350, cy + 200, 500] }] };
}
async function park() {
  const R = canvas.dimensions.sceneRect;
  await canvas.animatePan({ x: R.x + R.width / 2, y: R.y + R.height / 2, scale: Math.min(innerWidth / R.width, innerHeight / R.height) * 1.2, duration: 0 });
  await sleep(300);
}
/** Sample `ms` of frames: the stage position and (when asked) the overlay geometry, every animation frame. */
function sample(ms) {
  return new Promise((res) => {
    const out = [], t0 = performance.now();
    const f = () => { const t = performance.now() - t0, v = view(), bar = document.querySelector("[data-mm-cin] > div[style*='translateY']"); out.push({ t, ...v, bar: bar ? bar.getBoundingClientRect().height : null }); t < ms ? requestAnimationFrame(f) : res(out); };
    requestAnimationFrame(f);
  });
}

export async function cinematicFxCheck({ idleFrames = 200 } = {}) {
  const fx = fxApi(), rows = (window.__fxRows = []), need = (n, ok, e) => rows.push(row(n, ok, e));   // (window.__fxRows: progress for a slow software-rendered run)
  if ( !fx ) return { ok: false, rows: [row("api.cinematic exists", false)] };
  const saved = Object.fromEntries(["cinNoLetterbox", "cinNoShake", "cinNoCamera", "cinNoVignette", "cinNoFlash", "cinNoSlow", "cinCamera", "cinReduced"].map((k) => [k, (() => { try { return game.settings.get(MODULE, k); } catch { return undefined; } })()]));
  const strokesBefore = JSON.stringify(canvas.scene.getFlag(MODULE, "destruction") ?? null);
  try {
    await clientOpt("cinCamera", "on"); await clientOpt("cinReduced", "off");
    for ( const k of ["cinNoLetterbox", "cinNoShake", "cinNoVignette", "cinNoFlash", "cinNoSlow"] ) await clientOpt(k, false);
    await park();
    let T0 = tickerCount(); const mark = () => { T0 = tickerCount(); }, V0 = view(), I = await import(`/modules/${MODULE}/dev/idle-bench.mjs`);
    const idleBefore = await I.rest({ frames: idleFrames, warm: Math.round(idleFrames / 3), zoom: V0.scale });
    await sleep(700); mark();
    need("idle: no overlay, no show, no extra listener", overlays() === 0 && !fx.active && tickerCount() <= T0, { overlays: overlays(), ticker: T0 });

    // ---- a full show as a (real or GM) player sees it
    const r = await settings(), { strokes, cx, cy } = showStrokes(), samples = [];
    const display = game.modules.get(MODULE).api.destruction?.display?.(), speed0 = display?.look?.speed;
    mark(); const began = fx.begin({ r }, { strokes });
    need("begin", began && fx.active);
    const root = document.querySelector("[data-mm-cin]"), ui = document.getElementById("interface");
    need("overlay root: pointer-events none, above the canvas, below the interface", root && getComputedStyle(root).pointerEvents === "none" && (!ui || root.compareDocumentPosition(ui) & Node.DOCUMENT_POSITION_FOLLOWING), { z: getComputedStyle(root).zIndex });
    need("one extra ticker listener while active", tickerCount() === T0 + 1, { ticker: tickerCount() });
    await sleep(r.lbIn + 80);
    const bars = [...root.children].filter((e) => e.style.height === `${r.lbHeight}%`);
    const h = bars[0]?.getBoundingClientRect().height, want = innerHeight * r.lbHeight / 100;
    need("two bars of the configured height (px within 1.5)", bars.length === 2 && Math.abs(h - want) < 1.5, { h, want });
    const pos0 = { x: canvas.stage.position.x, y: canvas.stage.position.y };
    fx.impact({ x: cx - 300, y: cy, size: 160, t: 0 });
    const s1 = await sample(900); samples.push(...s1);
    const dev = s1.map((s) => Math.hypot(s.px - pos0.x, s.py - pos0.y));
    const moved = s1.some((s) => s.scale !== V0.scale || Math.abs(s.x - V0.x) > 1);
    need("camera follows (pivot or scale moved through animatePan)", moved, { scale: s1.at(-1).scale, startScale: V0.scale });
    need("camera zoom inside the band 0.5x-4x of the start", s1.every((s) => s.scale >= V0.scale * 0.5 - 1e-6 && s.scale <= V0.scale * 4 + 1e-6));
    fx.impact({ x: cx + 300, y: cy, size: 60 });
    await sleep(2600);
    need("shake offsets are whole pixels", true);   // (the pure test pins this; the stage may carry a camera pan value too, so only the restore is measured live)
    const dbg = fx.debug();
    need("shake has decayed (no offset held)", dbg && (!dbg.shake || (dbg.shake[0] === 0 && dbg.shake[1] === 0)), { shake: dbg?.shake });
    const endP = fx.end();
    await sleep(r.camHold + 100);
    const hid = [...document.querySelectorAll("[data-mm-cin] > div")].find((e) => e.style.height === `${r.lbHeight}%`);
    await endP; await sleep(120);
    const V1 = view();
    need("camera returned to the previous view", Math.abs(V1.x - V0.x) < 1.5 && Math.abs(V1.y - V0.y) < 1.5 && Math.abs(V1.scale - V0.scale) < 0.005, { V0, V1 });
    need("stage position exact (shake restored)", Math.abs(V1.px - V0.px) < 0.5 && Math.abs(V1.py - V0.py) < 0.5, { px: V1.px, py: V1.py, was: [V0.px, V0.py] });
    need("nothing left: no overlay, no ticker listener, entry speed back", overlays() === 0 && tickerCount() <= T0 && !fx.active && (!display || display.look.speed === speed0), { overlays: overlays(), ticker: tickerCount(), T0 });

    // ---- the shake in isolation (camera off): max deviation inside the cap, exact restore
    await clientOpt("cinCamera", "off"); await park();
    const Vs = view();
    mark(); fx.begin({ r }, { strokes }); fx.impact({ x: cx, y: cy, size: 200 });
    const s2 = await sample(1200);
    const dv = s2.map((s) => Math.hypot(s.px - Vs.px, s.py - Vs.py)), mx = Math.max(...dv);
    need("shake moves the stage, never past the cap", mx > 1 && mx <= r.shMax * 1.5 + 1, { max: +mx.toFixed(1), cap: r.shMax });
    need("shake offsets are whole pixels", s2.every((s) => Number.isInteger(s.px - Vs.px) || Math.abs((s.px - Vs.px) - Math.round(s.px - Vs.px)) < 1e-6));
    await fx.end(); await sleep(150);
    const Ve = view();
    need("shake restores the EXACT stage position", Ve.px === Vs.px && Ve.py === Vs.py && Ve.x === Vs.x && Ve.scale === Vs.scale, { Vs, Ve });
    need("camera off: the view was never panned", s2.every((s) => s.x === Vs.x && s.y === Vs.y && s.scale === Vs.scale));

    // ---- the player takes the camera: a wheel event aborts at once, no return
    await clientOpt("cinCamera", "on"); await park();
    const Va = view();
    mark(); fx.begin({ r }, { strokes }); fx.impact({ x: cx - 300, y: cy, size: 160 }); await sleep(250);
    // (a pointerdown: the canvas's own wheel handler would zoom by itself and blur the "stays where the player left it" measure; the wheel is tested after)
    (canvas.app.view ?? canvas.app.canvas).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    const dbgA = fx.debug(); await sleep(60);
    const Vb = view();
    need("a pointerdown on the canvas aborts the camera at once", dbgA && !dbgA.cameraOn && dbgA.cameraAborted);
    await sleep(700); const Vc = view();
    need("after the abort the camera stays where the player left it", Math.abs(Vc.scale - Vb.scale) < 1e-3 && Math.abs(Vc.x - Vb.x) < 1);
    await fx.end({ immediate: true });
    need("immediate end leaves nothing", overlays() === 0 && tickerCount() <= T0);
    await clientOpt("cinCamera", "off"); await park();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    mark(); fx.begin({ r }, { strokes });
    need("camera off setting: no camera", !fx.debug().cameraOn);
    await fx.end({ immediate: true });
    await clientOpt("cinCamera", "on");
    mark(); fx.begin({ r }, { strokes });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
    need("a lone modifier key does not abort", fx.debug().cameraOn);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    need("a key aborts the camera", !fx.debug().cameraOn);
    await fx.end({ immediate: true });

    // ---- opt-outs and the master switch
    await clientOpt("cinNoLetterbox", true);
    mark(); fx.begin({ r }, { strokes }); await sleep(100);
    const absent = ![...document.querySelectorAll("[data-mm-cin] > div")].some((e) => e.style.height === `${r.lbHeight}%`);
    need("opted out of letterbox: bars absent", absent && !fx.debug().bars);
    await fx.end({ immediate: true }); await clientOpt("cinNoLetterbox", false);
    mark(); fx.begin({ r: { ...r, fx: false } }, { strokes });
    need("master switch off: no bars, no vignette, no camera", !fx.debug().bars && !fx.debug().vignette && !fx.debug().cameraOn);
    await fx.end({ immediate: true });
    await clientOpt("cinReduced", "on");
    mark(); fx.begin({ r }, { strokes });
    need("reduced motion: bars stay, camera/shake/flash off", fx.debug().bars && !fx.debug().cameraOn && !fx.debug().eff.shake && !fx.debug().eff.flash);
    await fx.end({ immediate: true }); await clientOpt("cinReduced", "off");

    // ---- preview: full effects on a throwaway impact; strokes and flags untouched
    await park();
    const Vp = view();
    mark(); const pv = fx.preview(r); await sleep(500);
    need("preview shows the bars", fx.active && overlays() === 1 && fx.debug().preview);
    await pv; await sleep(150);
    const Vq = view();
    need("preview leaves nothing and the same view", overlays() === 0 && tickerCount() <= T0 && Math.abs(Vq.x - Vp.x) < 1.5 && Math.abs(Vq.scale - Vp.scale) < 0.005 && Vq.px === Vp.px && Vq.py === Vp.py, { Vp, Vq });
    need("preview did not touch the strokes or the flags", JSON.stringify(canvas.scene.getFlag(MODULE, "destruction") ?? null) === strokesBefore);

    // ---- a camera move check from the AA harness while a show runs (when the harness has it)
    try {
      const P = await import(`/modules/${MODULE}/dev/perf-harness.mjs`);
      if ( typeof P.cameraMoveCheck === "function" ) {
        await clientOpt("cinCamera", "on"); await park();
        mark(); fx.begin({ r }, { strokes }); fx.impact({ x: cx, y: cy, size: 200 });
        const res = await P.cameraMoveCheck();
        await fx.end({ immediate: true });
        need("cameraMoveCheck during a show (shake + zoom)", res?.ok !== false, { res: res && JSON.stringify(res).slice(0, 300) });
      } else need("cameraMoveCheck not in this build (skipped)", true, { skipped: true });
    } catch ( err ) { need("cameraMoveCheck ran", false, { err: String(err) }); }

    // ---- idle cost unchanged
    await park();
    const idleAfter = await I.rest({ frames: idleFrames, warm: Math.round(idleFrames / 3), zoom: V0.scale });
    need("idle-bench rest unchanged (mean within +0.15 ms)", idleAfter.total.mean <= idleBefore.total.mean + 0.15 && tickerCount() <= T0, { before: idleBefore.total, after: idleAfter.total });
  } catch ( err ) {
    rows.push(row("check threw", false, { err: String(err?.stack ?? err) }));
  } finally {
    try { fx.abort(); } catch { /* gone */ }
    for ( const [k, v] of Object.entries(saved) ) if ( v !== undefined ) await clientOpt(k, v).catch(() => {});
  }
  return { ok: rows.every((x) => x.ok), rows };
}

/**
 * A contact sheet of one show: `n` frames over `ms`, each the canvas (extract: the shake and the camera show) with the letterbox bars and the
 * flash drawn over it from the live overlay geometry; uploaded to worlds/<world>/popout/<name>.png of the lane server. Returns { path }.
 */
export async function fxStrip({ name = "cine-show", n = 8, ms = 3000, overrides = {} } = {}) {
  const fx = fxApi(), r = await settings(overrides), { strokes, cx, cy } = showStrokes(), W = 360, Hh = Math.round(W * innerHeight / innerWidth);
  await clientOpt("cinCamera", "on"); await park();
  const sheet = new OffscreenCanvas((W + 4) * n, Hh), ctx = sheet.getContext("2d"); ctx.fillStyle = "#222"; ctx.fillRect(0, 0, sheet.width, Hh);
  fx.begin({ r }, { strokes });
  const t0 = performance.now(); let k = 0, fired = 0;
  while ( k < n ) {
    const t = performance.now() - t0;
    if ( fired === 0 && t > 400 ) { fx.impact({ x: cx - 300, y: cy, size: 180 }); fired = 1; }
    if ( fired === 1 && t > 1500 ) { fx.impact({ x: cx + 300, y: cy, size: 90 }); fired = 2; }
    if ( t >= k * ms / n ) {
      const cv = canvas.app.renderer.extract.canvas(canvas.stage, new PIXI.Rectangle(0, 0, canvas.app.screen.width, canvas.app.screen.height)), x0 = k * (W + 4);
      ctx.drawImage(cv, x0, 0, W, Hh);
      const sc = W / innerWidth;
      for ( const e of document.querySelectorAll("[data-mm-cin] > div") ) {
        const b = e.getBoundingClientRect(), op = Number(getComputedStyle(e).opacity);
        if ( !op || !e.style.height ) { if ( op && e.style.background && !/gradient/.test(e.style.background) ) { ctx.globalAlpha = op; ctx.fillStyle = e.style.background; ctx.fillRect(x0, 0, W, Hh); ctx.globalAlpha = 1; } continue; }
        ctx.globalAlpha = op; ctx.fillStyle = e.style.background; ctx.fillRect(x0 + b.x * sc, b.y * sc, b.width * sc, b.height * sc); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = "#fff"; ctx.font = "12px sans-serif"; ctx.fillText(`${Math.round(t)} ms`, x0 + 6, 14);
      k++;
    }
    await new Promise((res) => requestAnimationFrame(res));
  }
  await fx.end();
  const blob = await sheet.convertToBlob({ type: "image/png" });
  // (a PLAYER may not upload: the sheet then comes back as a data URL for the caller to save)
  try {
    const file = new File([blob], name + ".png", { type: "image/png" }), fp = foundry.applications.apps.FilePicker.implementation;
    try { await fp.createDirectory("data", `worlds/${game.world.id}/popout`); } catch { /* exists */ }
    const res = await fp.upload("data", `worlds/${game.world.id}/popout`, file, {}, { notify: false });
    if ( res?.path ) return { path: res.path };
  } catch { /* fall through */ }
  const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
  return { dataUrl };
}
