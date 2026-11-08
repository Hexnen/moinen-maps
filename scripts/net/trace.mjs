/**
 * A load timeline for tests (cheap, always on): from `canvasInit` of a scene it records marks (canvasReady, the first damage on screen,
 * all damage on screen, water frames, ...), the main thread's long tasks and the frames longer than 34 ms, for 30 s.
 * `api.destruction.net.trace()` returns it with times in ms since canvasInit.
 */
const state = { t0: 0, marks: [], longtasks: [], hitches: [], until: 0 };

export function mark(name, data = null) {
  if ( !state.t0 ) return;
  if ( state.marks.some((m) => m.name === name && m.once) ) return;
  state.marks.push({ name, t: Math.round(performance.now() - state.t0), ...(data ? { data } : {}) });
}
/** A mark kept only the first time in a load. */
export function markOnce(name, data = null) {
  if ( !state.t0 || state.marks.some((m) => m.name === name) ) return;
  state.marks.push({ name, t: Math.round(performance.now() - state.t0), once: true, ...(data ? { data } : {}) });
}

try {
  new PerformanceObserver((list) => {
    if ( !state.t0 || performance.now() > state.until ) return;
    for ( const e of list.getEntries() ) state.longtasks.push({ t: Math.round(e.startTime - state.t0), ms: Math.round(e.duration) });
  }).observe({ type: "longtask", buffered: false });
} catch { /* not in this browser */ }

let last = 0, polls = 0, loop = 0;
function frame(now, my) {
  if ( my !== loop ) return;                  // a newer scene load runs its own loop
  if ( !state.t0 || now > state.until ) { last = 0; return; }
  if ( last && now - last > 34 ) state.hitches.push({ t: Math.round(last - state.t0), ms: Math.round(now - last) });
  last = now;
  // the flooded holes keep their own state: all of them ready is a mark too
  if ( !(++polls % 15) && !state.marks.some((m) => m.name === "flood:all") ) {
    const holes = game.modules.get("moinen-maps")?.api?.destruction?.flood?.status?.()?.holes;
    if ( holes?.length && holes.every((h) => h.state === "ready") ) markOnce("flood:all", { holes: holes.length });
  }
  requestAnimationFrame((t) => frame(t, my));
}

Hooks.on("canvasInit", () => {
  Object.assign(state, { t0: performance.now(), marks: [], longtasks: [], hitches: [], until: performance.now() + 30000, frames: [] });
  last = 0; const my = ++loop; requestAnimationFrame((t) => frame(t, my));
  // tests in a hidden browser pane (no requestAnimationFrame there): localStorage "mm-trace-pump" = "1" drives the canvas ticker
  // itself every 16 ms and records what each frame cost (texture uploads included)
  let pump = false; try { pump = localStorage.getItem("mm-trace-pump") === "1"; } catch { /* blocked */ }
  if ( pump ) {
    clearInterval(state.pump); state.lastPump = 0; state.filmAt = 0;
    try { state.film = localStorage.getItem("mm-trace-film") === "1" ? [] : null; } catch { state.film = null; }
    state.pump = setInterval(() => {
      if ( performance.now() > state.until || !canvas.app ) { clearInterval(state.pump); return; }
      const t = performance.now();
      // a pump that comes late: the main thread was busy (long tasks are not reported in a hidden pane)
      if ( state.lastPump && t - state.lastPump > 66 ) state.longtasks.push({ t: Math.round(state.lastPump - state.t0), ms: Math.round(t - state.lastPump - 16), lag: true });
      state.lastPump = t;
      try { canvas.app.ticker.update(t); } catch { /* the canvas is being torn down */ }
      const ms = performance.now() - t;
      state.frames.push(ms);
      // a film of the load (a small picture every 150 ms, read right after the render): what the user sees
      if ( state.film && t - (state.filmAt ?? 0) >= 150 && state.film.length < 80 && canvas.app?.view ) {
        state.filmAt = t;
        const c = document.createElement("canvas"); c.width = 240; c.height = 135;
        try { c.getContext("2d").drawImage(canvas.app.view, 0, 0, 240, 135); state.film.push({ t: Math.round(t - state.t0), c }); } catch { /* no picture */ }
      }
      if ( ms > 34 ) state.hitches.push({ t: Math.round(t - state.t0), ms: Math.round(ms), pumped: true });
      if ( !(++polls % 15) && !state.marks.some((m) => m.name === "flood:all") ) {
        const holes = game.modules.get("moinen-maps")?.api?.destruction?.flood?.status?.()?.holes;
        if ( holes?.length && holes.every((h) => h.state === "ready") ) markOnce("flood:all", { holes: holes.length });
      }
    }, 16);
  }
});
Hooks.on("canvasReady", () => markOnce("canvasReady"));

/** The film as one picture on top of the page (tests: take a screenshot of it); `from`..`to` ms, `cols` per row. Removed by a click. */
export function showFilm({ from = 0, to = 1e9, cols = 6, step = 1 } = {}) {
  const shots = (state.film ?? []).filter((f, i) => f.t >= from && f.t <= to && !(i % step)).slice(0, cols * 5);
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;z-index:100000;background:#111;display:grid;gap:2px;padding:4px;grid-template-columns:repeat(" + cols + ",1fr);align-content:start";
  for ( const f of shots ) {
    const cell = document.createElement("div"); cell.style.cssText = "position:relative";
    f.c.style.cssText = "width:100%;display:block"; cell.append(f.c);
    const l = document.createElement("span"); l.textContent = `${f.t} ms`; l.style.cssText = "position:absolute;left:2px;top:0;color:#ff0;font:bold 12px monospace;text-shadow:0 0 2px #000";
    cell.append(l); host.append(cell);
  }
  host.onclick = () => host.remove();
  document.body.append(host);
  return shots.length;
}

/**
 * Why the client did something on its own (a bake started, a publish skipped, a remote change taken over, the breaker tripped): the
 * last 200 events with wall-clock time, kept for the whole session (not only a load) so a loop can be seen afterwards.
 */
const events = [];
export function event(reason, data = null) {
  events.push({ at: new Date().toISOString().slice(11, 23), reason, ...(data ? { data } : {}) });
  if ( events.length > 200 ) events.shift();
}

export function report() {
  const lt = state.longtasks;
  const fr = state.frames ?? [];
  return { t0: state.t0, events: events.slice(), frames: { n: fr.length, total: Math.round(fr.reduce((a, b) => a + b, 0)), max: Math.round(Math.max(0, ...fr)) }, marks: state.marks.map(({ once, ...m }) => m), longtasks: { count: lt.length, total: lt.reduce((a, e) => a + e.ms, 0), max: Math.max(0, ...lt.map((e) => e.ms)), list: lt },
    hitches: { count: state.hitches.length, max: Math.max(0, ...state.hitches.map((e) => e.ms)), list: state.hitches } };
}
