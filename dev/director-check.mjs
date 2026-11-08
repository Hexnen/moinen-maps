// Browser-side checks of the DIRECTOR (scripts/director). Lane server, a GM page AND a REAL PLAYER page (another origin), both ticking
// (fronted, or a headless Chrome: dev/tools/cdp-rec.mjs). Rows of { name, ok, ... }.
//   const C = await import("/modules/moinen-maps/dev/director-check.mjs");
//   PLAYER page:  window.__dc = C.watchShot({ act: "none" | "esc" | "click" | "wheel" | "busy", timeout })   arm, then make the GM act
//                 await window.__dc                                         the rows: what this page showed, the camera's way and return
//   GM page:      C.gmCut(x, y)  /  C.gmPaint(x, y, r, type)  /  await C.gmLeaveMidShot()
//   either page:  C.probe()      status, overlays, the screen engine, ticker listeners
//                 await C.idle(frames)   per-frame ms of the module's listeners at rest (idle-bench)
const MODULE = "moinen-maps";
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const API = () => game.modules.get(MODULE).api;
const row = (name, ok, extra = {}) => ({ name, ok: !!ok, ...extra });
const view = () => ({ x: canvas.stage.pivot.x, y: canvas.stage.pivot.y, scale: canvas.stage.scale.x });
const near = (a, b, px = 6) => Math.hypot(a.x - b.x, a.y - b.y) <= px / Math.max(0.1, b.scale) && Math.abs(a.scale / b.scale - 1) < 0.02;

export function probe() {
  const d = API().director;
  return { user: game.user.name, gm: game.user.isGM, status: d.status(), debug: d._debug(), view: view(), overlays: document.querySelectorAll(".mm-cin, .mm-dir").length,
    tickers: canvas.app.ticker.count, screen: API().cinematic?.active ?? null };
}

/**
 * Arm this page for the next shot and report on it: the form it got, the camera's way (start, closest to the target, end), the
 * return to the view it had, the overlays and the screen engine cleaned up. `act`: what the "player" does mid-shot.
 */
export function watchShot({ act = "none", timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    const rows = [], home = view(), board = document.getElementById("board");
    let shot = null, form = null, samples = [], t0 = 0, ended = null, timer = null;
    if ( act === "busy" ) board.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, buttons: 1, clientX: 600, clientY: 400 }));
    const h = Hooks.on("moinenMapsDirector", (kind, data) => {
      if ( kind === "shot" && !shot ) {
        shot = data.shot; form = data.form; t0 = performance.now();
        const f = () => samples.push({ t: performance.now() - t0, ...view() });
        canvas.app.ticker.add(f); samples.f = f;
        if ( act === "esc" ) setTimeout(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), shot.lead + 250);
        if ( act === "click" ) setTimeout(() => { board.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, buttons: 1, clientX: 700, clientY: 400 })); window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); }, shot.lead + 250);
        if ( act === "wheel" ) setTimeout(() => { board.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -100, clientX: 700, clientY: 400 })); canvas.pan({ scale: canvas.stage.scale.x * 1.05 }); }, shot.lead + 250);
      }
      if ( kind === "end" && shot && data.shot.id === shot.id ) { ended = { why: data.why, t: performance.now() - t0 }; setTimeout(done, 2600); }
    });
    timer = setTimeout(done, timeout);
    function done() {
      if ( done.ran ) return; done.ran = true;
      clearTimeout(timer); Hooks.off("moinenMapsDirector", h);
      if ( samples.f ) canvas.app.ticker.remove(samples.f);
      if ( act === "busy" ) window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      if ( !shot ) { resolve([row("a shot reached this page", false)]); return; }
      const tx = shot.x, ty = shot.y;
      const dist = (s) => Math.hypot(s.x - tx, s.y - ty);
      const closest = samples.reduce((m, s) => (dist(s) < dist(m) ? s : m), samples[0] ?? { ...home, t: 0 });
      const end = view();
      rows.push(row("a shot reached this page", true, { form, kind: shot.kind, planned: shot.form }));
      if ( form === "take" ) {
        rows.push(row("the camera went to the place", dist(closest) < Math.hypot(home.x - tx, home.y - ty) * 0.5 || dist(closest) < 200, { from: Math.round(Math.hypot(home.x - tx, home.y - ty)), closest: Math.round(dist(closest)), at: Math.round(closest.t), scale: +closest.scale.toFixed(2) }));
        if ( act === "wheel" ) rows.push(row("wheel: the camera stays with the player (no return)", !near(end, home, 20), { end }));
        else rows.push(row("the camera is back where the player had it", near(end, home), { home, end }));
        if ( act === "esc" || act === "click" ) rows.push(row(`${act}: the shot was cut short`, ended?.why === "cut" && ended.t < shot.lead + 600, { ended }));
        else if ( act === "none" ) rows.push(row("the shot ended on its time", ended?.why === "done" && ended.t <= shot.len + 2400, { ended, len: shot.len }));
      } else rows.push(row(`soft form: the camera did not move${act === "busy" ? " (busy player)" : ""}`, samples.every((s) => near(s, home)), { form }));
      setTimeout(() => {
        const p = probe();
        rows.push(row("everything cleaned up (overlays, the screen engine, the take-over)", p.overlays === 0 && !p.screen && !p.status.take && !p.debug.overlay.panHook, { overlays: p.overlays, screen: p.screen, panHook: p.debug.overlay.panHook }));
        resolve(rows);
      }, act === "none" ? 400 : 4500);
    }
  });
}

export const gmCut = (x, y) => API().director.cutTo({ x, y });
export const gmPaint = (x, y, r = 90, type = "collapse", level = 3) => API().destruction.paint(x, y, r, { level, type });

/** The idle cost: ms per frame of every ticker listener of this page at rest, by listener (no director listener should exist). */
export async function idle(frames = 120) {
  const t = canvas.app.ticker, before = t.count;
  let n = 0; const t0 = performance.now();
  await new Promise((res) => { const f = () => { if ( ++n >= frames ) { t.remove(f); res(); } }; t.add(f); });
  return { listeners: before, frames, msPerFrame: (performance.now() - t0) / frames, director: probe().status, overlayHook: probe().debug.overlay.panHook };
}
