import { edgeSpot } from "./core.mjs";
import { restyle } from "./screen.mjs";

/**
 * DIRECTOR OVERLAYS (DOM, this client only): the caption of a take-over (a film lower third over the bottom letterbox bar), and the soft
 * forms: a ping on the spot when it is on screen, an arrow on the screen edge pointing to it when it is not, each with a short caption.
 * Nothing exists while no shot plays. The markers follow the camera through the "canvasPan" hook (no ticker listener): the hook is held
 * only while a marker is up.
 */

const CSS = `
.mm-dir { position: fixed; inset: 0; pointer-events: none; z-index: 2; overflow: hidden; contain: strict; font-family: var(--font-primary, sans-serif); }
.mm-dir-cap { position: absolute; left: 50%; bottom: calc(var(--mm-dir-lb, 0%) * 0.5); transform: translate(-50%, 50%); display: flex; flex-direction: column; align-items: center; gap: 0.15rem;
  color: #f4efe6; text-align: center; text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 0 18px rgba(0,0,0,0.6); max-width: min(80vw, 56rem); }
.mm-dir-cap.is-low { bottom: 9vh; transform: translate(-50%, 0); }
.mm-dir-kick { font-size: 0.72rem; letter-spacing: 0.32em; text-transform: uppercase; opacity: 0; color: #e9c46a; display: flex; align-items: center; gap: 0.55em;
  transform: translateY(6px); transition: opacity 420ms ease-out, transform 620ms cubic-bezier(0.16, 0.8, 0.3, 1); }
.mm-dir-kick::before, .mm-dir-kick::after { content: ""; height: 1px; width: 0; background: currentColor; opacity: 0.7; transition: width 700ms cubic-bezier(0.16, 0.8, 0.3, 1) 120ms; }
.mm-dir-title { font-family: "Modesto Condensed", var(--font-primary, serif); font-size: clamp(1.25rem, 2.6vw, 2.2rem); line-height: 1.05; letter-spacing: 0.04em; opacity: 0;
  transform: translateY(10px); filter: blur(3px); transition: opacity 520ms ease-out 140ms, transform 760ms cubic-bezier(0.16, 0.8, 0.3, 1) 140ms, filter 520ms ease-out 140ms; }
.mm-dir-hint { font-size: 0.62rem; letter-spacing: 0.14em; opacity: 0; color: #cfc8bb; transition: opacity 600ms ease-out 900ms; margin-top: 0.2rem; }
.mm-dir-cap.is-in .mm-dir-kick { opacity: 0.95; transform: none; }
.mm-dir-cap.is-in .mm-dir-kick::before, .mm-dir-cap.is-in .mm-dir-kick::after { width: 2.2rem; }
.mm-dir-cap.is-in .mm-dir-title { opacity: 1; transform: none; filter: none; }
.mm-dir-cap.is-in .mm-dir-hint { opacity: 0.55; }
.mm-dir-cap.is-out .mm-dir-kick, .mm-dir-cap.is-out .mm-dir-title, .mm-dir-cap.is-out .mm-dir-hint { opacity: 0; transition: opacity 380ms ease-in; transition-delay: 0ms; }

.mm-dir-mark { position: absolute; left: 0; top: 0; width: 0; height: 0; opacity: 0; transition: opacity 360ms ease-out; }
.mm-dir-mark.is-in { opacity: 1; }
.mm-dir-mark.is-out { opacity: 0; transition: opacity 600ms ease-in; }
.mm-dir-ring { position: absolute; left: -26px; top: -26px; width: 52px; height: 52px; border-radius: 50%; border: 3px solid #f2cf73;
  box-shadow: 0 0 0 1.5px rgba(0,0,0,0.75), inset 0 0 0 1.5px rgba(0,0,0,0.6), 0 0 16px rgba(242,207,115,0.7); animation: mm-dir-ping 1600ms cubic-bezier(0.2, 0.7, 0.3, 1) infinite; }
.mm-dir-ring.r2 { animation-delay: 800ms; }
.mm-dir-reticle { position: absolute; left: -24px; top: -24px; width: 48px; height: 48px; animation: mm-dir-close 700ms cubic-bezier(0.16, 0.8, 0.3, 1) both; filter: drop-shadow(0 0 1.5px rgba(0,0,0,0.9)) drop-shadow(0 0 6px rgba(242,207,115,0.6)); }
.mm-dir-dot { position: absolute; left: -5px; top: -5px; width: 10px; height: 10px; border-radius: 50%; background: #f2cf73; box-shadow: 0 0 0 2px rgba(0,0,0,0.7), 0 0 12px #f2cf73; }
@keyframes mm-dir-ping { 0% { transform: scale(0.4); opacity: 0; } 12% { opacity: 1; } 100% { transform: scale(1.9); opacity: 0; } }
@keyframes mm-dir-close { 0% { transform: scale(1.8) rotate(-20deg); opacity: 0; } 100% { transform: none; opacity: 1; } }
.mm-dir-arrow { position: absolute; left: -24px; top: -24px; width: 48px; height: 48px; border-radius: 50%; background: radial-gradient(circle at 50% 38%, rgba(48,38,22,0.97), rgba(12,10,8,0.95));
  border: 2px solid #f2cf73; box-shadow: 0 0 0 1.5px rgba(0,0,0,0.7), 0 3px 14px rgba(0,0,0,0.7), 0 0 20px rgba(242,207,115,0.5); display: grid; place-items: center; color: #f2cf73;
  pointer-events: auto; cursor: pointer; animation: mm-dir-nudge 1100ms ease-in-out infinite; }
.mm-dir-arrow:hover { background: radial-gradient(circle at 50% 38%, rgba(84,66,34,0.98), rgba(24,20,14,0.96)); color: #fff; }
.mm-dir-arrow > i { font-size: 19px; }
.mm-dir-chev { position: absolute; left: -40px; top: -40px; width: 80px; height: 80px; transform: rotate(var(--mm-dir-a, 0rad)); pointer-events: none; overflow: visible; }
@keyframes mm-dir-nudge { 0%, 100% { translate: 0 0; } 50% { translate: calc(cos(var(--mm-dir-a, 0rad)) * 4px) calc(sin(var(--mm-dir-a, 0rad)) * 4px); } }
.mm-dir-label { position: absolute; white-space: nowrap; padding: 0.3rem 0.75rem; border-radius: 3px; background: rgba(12,10,8,0.82); color: #f4efe6; font-size: 0.92rem;
  letter-spacing: 0.03em; box-shadow: 0 2px 8px rgba(0,0,0,0.5); border-left: 2px solid #e9c46a; transform: translate(-50%, 0); left: 0; top: 30px; }
.mm-dir-label > i { color: #e9c46a; margin-right: 0.4em; }
@media (prefers-reduced-motion: reduce) { .mm-dir-ring, .mm-dir-arrow, .mm-dir-reticle { animation: none; } .mm-dir-title { filter: none; } }
`;
let styled = false;
function ensureStyle() { if ( styled ) return; styled = true; const s = document.createElement("style"); s.textContent = CSS; s.dataset.mmDir = ""; document.head.appendChild(s); }

// four corner brackets that close in on the spot (a film reticle), and the chevron of the edge arrow (pointing right; rotated by --mm-dir-a)
const RETICLE = `<svg class="mm-dir-reticle" viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="#f2cf73" stroke-width="3.2" stroke-linecap="square"><path d="M3 14V3h11"/><path d="M34 3h11v11"/><path d="M45 34v11H34"/><path d="M14 45H3V34"/></g></svg>`;
const CHEVRON = `<svg class="mm-dir-chev" viewBox="0 0 80 80" aria-hidden="true"><path d="M66 31 L77 40 L66 49" fill="none" stroke="rgba(0,0,0,0.8)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M66 31 L77 40 L66 49" fill="none" stroke="#f2cf73" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

let root = null, panHook = null;
const marks = new Set();
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

function host() {
  ensureStyle();
  if ( root?.isConnected ) return root;
  const ui = document.getElementById("interface");
  root = document.createElement("div"); root.className = "mm-dir"; root.dataset.mmDir = "";
  (ui?.parentNode ?? document.body).insertBefore(root, ui ?? null);
  return root;
}
function maybeDrop() { if ( root && !root.children.length ) { root.remove(); root = null; } if ( !marks.size && panHook !== null ) { Hooks.off("canvasPan", panHook); panHook = null; } }

/**
 * The part of the screen where the map is not covered by Foundry's interface: the middle column (#ui-middle: between the scene controls
 * and the sidebar), less the navigation on top and the hotbar below. An arrow on the edge of THIS rect is never under the chat or the
 * scene controls.
 * Cost: the three rects force a style + layout pass whenever the page wrote to the DOM since the last one (every camera frame: Foundry's
 * HUD, a marker): the rect is kept SAFE_MS (the interface columns do not move in that time; a window resize drops it at once), so a
 * marker following a pan, or the stage's checks of one beat, do not force a layout each.
 */
const SAFE_MS = 200;
let safeMemo = null, safeAt = -Infinity, safeWired = false;
export function safeRect() {
  const now = performance.now();
  if ( safeMemo && now - safeAt < SAFE_MS ) return { ...safeMemo };
  if ( !safeWired ) { safeWired = true; window.addEventListener("resize", () => { safeMemo = null; }, { passive: true }); }
  safeMemo = measureSafe(); safeAt = now;
  return { ...safeMemo };
}
function measureSafe() {
  const mid = document.getElementById("ui-middle")?.getBoundingClientRect?.();
  let x0 = mid?.width ? mid.left : 0, x1 = mid?.width ? mid.right : innerWidth, y0 = 0, y1 = innerHeight;
  const top = document.getElementById("navigation")?.getBoundingClientRect?.(), bot = document.getElementById("hotbar")?.getBoundingClientRect?.();
  if ( top?.height && top.bottom < innerHeight / 3 ) y0 = Math.max(y0, top.bottom);
  if ( bot?.height && bot.top > innerHeight * 2 / 3 ) y1 = Math.min(y1, bot.top);
  if ( x1 - x0 < 300 ) { x0 = 0; x1 = innerWidth; }
  if ( y1 - y0 < 240 ) { y0 = 0; y1 = innerHeight; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/** The screen rects of the open windows (framed ApplicationV2 and the old Application windows), minimised ones left out. */
export function windowRects() {
  const out = [];
  const add = (el) => {
    const e = el instanceof HTMLElement ? el : el?.[0]; if ( !e?.getBoundingClientRect || !e.isConnected ) return;   // (v1 windows: jQuery)
    if ( e.classList?.contains("minimized") || getComputedStyle(e).display === "none" ) return;
    const r = e.getBoundingClientRect(); if ( r.width > 40 && r.height > 40 ) out.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
  };
  try { for ( const a of foundry.applications?.instances?.values?.() ?? [] ) if ( a.hasFrame && a.rendered && !a.minimized ) add(a.element); } catch { /* */ }
  try { for ( const a of Object.values(ui.windows ?? {}) ) if ( a?.rendered && !a._minimized ) add(a.element); } catch { /* */ }
  return out;
}
/**
 * The part of the safe rect (safeRect) that no open window covers: the biggest free piece left of, right of, above or below each
 * window (the biggest windows first). A take-over frames its place into it, so the subject is not under a sheet or a dialog. When the
 * windows leave no usable piece, the safe rect itself with `covered: true` (the player is reading a big window: the take-over comes
 * soft, the camera is not moved behind it).
 */
export function freeRect() {
  const a = safeRect();
  let r = { x0: a.x, y0: a.y, x1: a.x + a.w, y1: a.y + a.h };
  const area = (q) => Math.max(0, q.x1 - q.x0) * Math.max(0, q.y1 - q.y0);
  const ws = windowRects().sort((p, q) => area(q) - area(p));
  let covered = false;
  for ( const w of ws ) {
    if ( w.x1 <= r.x0 || w.x0 >= r.x1 || w.y1 <= r.y0 || w.y0 >= r.y1 ) continue;
    const parts = [{ ...r, x1: Math.min(r.x1, w.x0) }, { ...r, x0: Math.max(r.x0, w.x1) }, { ...r, y1: Math.min(r.y1, w.y0) }, { ...r, y0: Math.max(r.y0, w.y1) }]
      .filter((q) => q.x1 - q.x0 >= 280 && q.y1 - q.y0 >= 200).sort((p, q) => area(q) - area(p));
    if ( parts.length ) r = parts[0];
    else { covered = true; break; }
  }
  if ( covered ) return { x: a.x, y: a.y, w: a.w, h: a.h, covered: true };
  return { x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 };
}

/** On the screen at all (a ping is shown where it is, even near the edge). */
const inside = (p) => p.x >= 8 && p.y >= 8 && p.x <= innerWidth - 8 && p.y <= innerHeight - 8 && !document.elementFromPoint?.(p.x, p.y)?.closest?.("#ui-left, #ui-right, #sidebar, #hotbar, #navigation, #chat-message");

/** Screen px of a scene point (the canvas element is full-window in Foundry). */
export function toScreen(x, y) {
  const p = canvas.stage.worldTransform.apply({ x, y });   // (CSS px: Foundry's renderer uses autoDensity, like canvas.clientCoordinatesFromCanvas)
  return { x: p.x, y: p.y };
}

/**
 * The take-over caption: `kick` (kind, small caps with the icon), `title` (what happened); `lb` = the letterbox height (% of the screen)
 * so the caption sits in the bottom bar when it is tall enough, else just above the bottom. Returns { el, reveal(), out(), remove() }.
 * `hold`: it is made and placed now but slides in only at reveal() (a take-over makes its caption when the camera sets off, so the place
 * is known by the moment it is due, also on a slow client); without `hold` it slides in as soon as its place is known.
 */
export function caption({ kick, title, icon, lb = 0, hint = "", hold = false }) {
  const el = document.createElement("div");
  el.className = `mm-dir-cap${lb >= 7 ? "" : " is-low"}`;
  el.style.setProperty("--mm-dir-lb", `${lb}vh`);
  el.innerHTML = `<div class="mm-dir-kick">${icon ? `<i class="${esc(icon)}" inert></i>` : ""}<span>${esc(kick)}</span></div><div class="mm-dir-title">${esc(title)}</div>${hint ? `<div class="mm-dir-hint">${esc(hint)}</div>` : ""}`;
  host().appendChild(el);
  let gone = false, leaving = false, shown = false, placed = false, want = !hold;
  // (it slides in once its place is known AND it is due: until then every part of it is transparent - the hidden state of the slide-in)
  const show = () => { if ( gone || leaving || shown || !placed || !want ) return; shown = true; restyle(el); el.classList.add("is-in"); };
  clearOfUi(el, () => !gone && !leaving, () => { placed = true; show(); });
  const remove = () => { if ( gone ) return; gone = true; el.remove(); maybeDrop(); };
  return {
    el, remove, get placed() { return placed; }, get shown() { return shown; },
    reveal: () => { want = true; show(); },
    out: (ms = 420) => { if ( gone || leaving ) return; leaving = true; el.classList.add("is-out"); setTimeout(remove, ms); }
  };
}

/**
 * HIT TESTS OF THE INTERFACE (where the caption and the turn banner may sit): what is on top at a screen point, past the director's own
 * layers. A hit test (elementsFromPoint) costs ~0.3 ms on a page with a long chat log and ~2-4 ms on a slow client (4x CPU), and a
 * caption needs dozens: the answers are kept per point (HITS, on a 4 px grid) - the interface around the map hardly ever moves - so a
 * caption whose points are known is placed at once, on any client. What can make a kept answer wrong: the window size (all go), a
 * window opened / closed / moved (the points under it go), anything else (a module's buttons): a caption placed from kept answers
 * re-checks its points afterwards, live, in slices, and moves if its place changed.
 */
const SKIP = ".mm-dir, .mm-cin, .mm-dmv, .mm-dst-chip";
const OPEN = new Set(["board", "interface", "ui-top", "ui-middle", "ui-left", "ui-right", "ui-bottom"]);
const HITS = new Map();
let hitView = "", hitWins = [];
const snap = (v) => Math.round(v / 4) * 4;
/** What is at (x, y) now: { kind: "open" (the map, an empty interface region), "full" (a full-screen layer) or "ui" (interface), top, bottom }. */
function probe(x, y) {
  for ( const e of document.elementsFromPoint?.(x, y) ?? [] ) {
    if ( e.closest?.(SKIP) ) continue;
    if ( e === document.body || e === document.documentElement || OPEN.has(e.id) || e.tagName === "CANVAS" ) return { kind: "open" };
    const b = e.getBoundingClientRect();
    return { kind: b.height > innerHeight * 0.6 || b.width > innerWidth * 0.9 ? "full" : "ui", top: b.top, bottom: b.bottom };
  }
  return { kind: "open" };
}
/** The answer at (x, y) (snapped to the grid): kept, or a live hit test (then kept). `memo` false: always live. { kind, top, bottom, kept } */
let probeMs = 1;                         // (a live hit test's cost here, smoothed: idleSliced keeps one of them inside the idle time)
export function hitAt(x, y, memo = true) {
  const sx = snap(x), sy = snap(y), k = `${sx}|${sy}`;
  if ( memo ) { const h = HITS.get(k); if ( h ) return { ...h, kept: true }; }
  const t = performance.now(), h = probe(sx, sy);
  probeMs = Math.min(20, probeMs * 0.8 + (performance.now() - t) * 0.2);
  if ( HITS.size > 6000 ) HITS.clear();
  HITS.set(k, h);
  return { ...h, kept: false };
}
/** Before a placement: drop the kept answers the window size or the open windows may have changed since. */
export function hitsFresh() {
  const view = `${innerWidth}x${innerHeight}`;
  if ( view !== hitView ) { HITS.clear(); hitView = view; hitWins = windowRects(); return; }
  const now = windowRects(), key = (r) => `${Math.round(r.x0)},${Math.round(r.y0)},${Math.round(r.x1)},${Math.round(r.y1)}`;
  const was = new Set(hitWins.map(key)), is = new Set(now.map(key));
  const changed = [...hitWins.filter((r) => !is.has(key(r))), ...now.filter((r) => !was.has(key(r)))];
  hitWins = now;
  if ( !changed.length || !HITS.size ) return;
  for ( const k of [...HITS.keys()] ) {
    const [x, y] = k.split("|").map(Number);
    if ( changed.some((r) => x >= r.x0 - 4 && x <= r.x1 + 4 && y >= r.y0 - 4 && y <= r.y1 + 4) ) HITS.delete(k);
  }
}

/**
 * The lower third never sits under Foundry's interface: centred over the free part of the screen (not under an open window), and lifted
 * above the hotbar (macro slots, the chat input...) when the letterbox bar puts it there.
 * The hit tests (hitAt: 21 to 80 of them) run in slices of SLICE_MS between frames, never as one long frame in the middle of the camera
 * move; kept answers cost nothing, so a caption whose points are known is placed in the same frame. `alive()` false: stop; `done()` once
 * the place is set (then a live re-check of the kept answers, which moves the caption only when the interface changed under it).
 */
const SLICE_MS = 4;
const COL = 80;                          // px between two probed columns, from the caption's middle (the same columns for every caption)
/** The next slice: after the next frame is drawn (one slice per frame; a hidden tab, where frames stop, goes on after 120 ms). */
export const later = (fn) => { let ran = false; const go = () => { if ( !ran ) { ran = true; fn(); } }; requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 120); };
/** Runs `step(t0)` (true = finished) once per slice until it finishes or `alive()` turns false; then `done()`. */
export function sliced(step, alive, done) {
  const go = () => {
    if ( !alive() ) return;
    let fin = true;
    try { fin = step(performance.now()); } catch { fin = true; }
    if ( fin ) done(); else later(go);
  };
  go();
}
/**
 * The same slices for work nobody waits to see (the live re-check of a caption placed from kept answers, the warm-up): each runs in
 * the browser's IDLE time after a frame (requestIdleCallback), only as long as that idle time lasts, less one hit test - so it never
 * makes a frame later when the page has idle time (a fixed SLICE_MS slice after every frame did: ~4-6 ms on top of a busy frame).
 * Same steps, same answers; only when they run. A page with no idle time still gets a SLICE_MS slice at least every IDLE_WAIT ms
 * (about one 60 Hz frame, the cadence sliced() had), so the work never finishes later than it did. Without requestIdleCallback: sliced().
 */
const IDLE_WAIT = 16;
export function idleSliced(step, alive, done) {
  const ric = globalThis.requestIdleCallback;
  if ( typeof ric !== "function" ) { later(() => sliced(step, alive, done)); return; }
  const go = (dl) => {
    if ( !alive() ) return;
    const left = dl?.didTimeout ? SLICE_MS : (dl?.timeRemaining?.() ?? 0) - probeMs;
    if ( left <= 0.5 ) { ric(go, { timeout: IDLE_WAIT }); return; }
    let fin = true;
    // (step() stops once SLICE_MS has passed since its t0: a t0 that makes that moment `left` ms from now)
    try { fin = step(performance.now() - SLICE_MS + left); } catch { fin = true; }
    if ( fin ) done(); else ric(go, { timeout: IDLE_WAIT });
  };
  ric(go, { timeout: IDLE_WAIT });
}
/**
 * The caption's place (arithmetic over the hit answers): from its default box `R0` (screen px, centred on `cx`), points across its width
 * and height; anything of the interface there (its top below 45 % of the screen) lifts it above the highest one, and the lifted box is
 * probed again (three passes at most). `res` = { lift, bottom (px from the screen bottom), kept (a kept answer was used) }.
 */
function placement(R0, cx, memo) {
  const res = { lift: false, bottom: null, kept: false };
  let R = R0, pass = 0, pts = null, k = 0, top = Infinity;
  const points = (r) => {
    const half = Math.max(1, r.width / 2 - 1), n = Math.floor(half / COL), xs = [];
    for ( let j = -n; j <= n; j++ ) xs.push(cx + j * COL);
    if ( half - n * COL > 8 ) xs.push(cx - half, cx + half);
    const out = [];
    for ( const x of xs ) for ( const fy of [0.2, 0.6, 0.95] ) out.push([x, r.top + r.height * fy]);
    return out;
  };
  const step = (t0) => {
    for ( ;; ) {
      if ( !pts ) { pts = points(R); k = 0; top = Infinity; }
      while ( k < pts.length ) {
        const h = hitAt(pts[k][0], pts[k][1], memo); k++;
        if ( h.kept ) res.kept = true;
        if ( h.kind === "ui" && h.top > innerHeight * 0.45 ) top = Math.min(top, h.top);
        if ( k < pts.length && !h.kept && performance.now() - t0 > SLICE_MS ) return false;
      }
      if ( top === Infinity ) return true;
      res.lift = true; res.bottom = Math.round(innerHeight - top + 10);
      R = { left: R.left, width: R.width, height: R.height, top: innerHeight - res.bottom - R.height };   // (is-low: its bottom edge there)
      pts = null;
      if ( ++pass >= 3 ) return true;
      if ( performance.now() - t0 > SLICE_MS ) return false;
    }
  };
  return { res, step };
}
function clearOfUi(el, alive = () => true, done = () => {}) {
  let cx = 0, R0 = null;
  const low0 = el.classList.contains("is-low");
  try {
    const f = freeRect();
    cx = Math.round(f.x + f.w / 2);
    el.style.left = `${cx}px`;
    el.style.maxWidth = `${Math.round(Math.max(260, f.w - 24))}px`;
    hitsFresh();
    const r = el.getBoundingClientRect(); R0 = { left: r.left, width: r.width, top: r.top, height: r.height };
  } catch { done(); return; }
  const apply = (res, ease = false) => {
    if ( ease ) el.style.transition = "bottom 260ms ease-out";
    if ( res.lift ) { el.classList.add("is-low"); el.style.bottom = `${res.bottom}px`; }
    else { el.classList.toggle("is-low", low0); el.style.bottom = ""; }
  };
  const p = placement(R0, cx, true);
  sliced(p.step, alive, () => {
    apply(p.res);
    done();
    if ( !p.res.kept ) return;
    // (placed from kept answers: the same points live once more, in slices, after it is up; it moves only when the interface changed)
    const q = placement(R0, cx, false);
    idleSliced(q.step, alive, () => { if ( q.res.lift !== p.res.lift || q.res.bottom !== p.res.bottom ) apply(q.res, true); });
  });
}
/**
 * Fills the kept answers for the captions to come (the widest one, where it sits with and without the letterbox bars `lbs`), in slices,
 * once the page is idle: the first caption of a take-over is then placed at once too, also on a slow client. Points already kept cost
 * nothing; nothing is shown.
 */
let warming = false;
export function warmCaptions(lbs = [0]) {
  if ( warming || !document.getElementById("interface") ) return;
  warming = true;
  const todo = [...new Set(lbs.map((v) => (v >= 7 ? v : 0)))];
  const next = () => {
    const lb = todo.shift(); if ( lb === undefined ) { warming = false; return; }
    const el = document.createElement("div");
    el.className = `mm-dir-cap${lb >= 7 ? "" : " is-low"}`; el.style.setProperty("--mm-dir-lb", `${lb}vh`); el.style.visibility = "hidden";
    el.innerHTML = `<div class="mm-dir-kick"><i class="fa-solid fa-burst" inert></i><span>Wwwww</span></div><div class="mm-dir-title" style="white-space:nowrap;overflow:hidden">${"W".repeat(80)}</div><div class="mm-dir-hint">W</div>`;
    host().appendChild(el);
    let gone = false;
    const end = () => { if ( gone ) return; gone = true; el.remove(); maybeDrop(); idle(next, IDLE_WAIT); };
    try {
      const f = freeRect(), cx = Math.round(f.x + f.w / 2);
      el.style.left = `${cx}px`; el.style.maxWidth = `${Math.round(Math.max(260, f.w - 24))}px`;
      hitsFresh();
      const r = el.getBoundingClientRect(), p = placement({ left: r.left, width: r.width, top: r.top, height: r.height }, cx, true);
      idleSliced(p.step, () => !gone, end);
    } catch { end(); }
  };
  idle(next, 3000);
}
// (the next lb's box is made and measured at the start of an idle period of its own, not at the end of the one its slices used up)
const idle = (fn, timeout) => (globalThis.requestIdleCallback ?? ((f) => setTimeout(f, 200)))(() => fn(), { timeout });

/**
 * A soft marker at scene point (x, y): a ping when on screen, an edge arrow when not; `text` its caption, `icon` the kind's icon.
 * `onClick` (the arrow): the player chooses to look (the camera goes there; it is theirs then). Returns { out(), remove() }.
 */
export function marker({ x, y, text, icon, onClick }) {
  const el = document.createElement("div");
  el.className = "mm-dir-mark";
  host().appendChild(el);
  const m = { el, x, y, kind: null, onClick, text, icon, labW: 0, w: {} };
  // (the writes only when a value changed, and the label's width measured once per text: a pan moves the marker every frame, and a
  // read of the layout after a write forced a style + layout pass per marker per frame)
  const put = (node, k, v, set) => { if ( m.w[k] !== v ) { m.w[k] = v; set(node, v); } };
  const place = () => {
    const p = toScreen(m.x, m.y), a = safeRect(), q = edgeSpot({ x: p.x - a.x, y: p.y - a.y }, a.w, a.h, 58);
    const s = { ...q, x: q.x + a.x, y: q.y + a.y }, kind = q.on || inside(p) ? "ping" : "arrow";
    if ( kind === "ping" ) { s.x = p.x; s.y = p.y; }
    if ( kind !== m.kind ) {
      m.kind = kind;
      const lab = m.text ? `<div class="mm-dir-label">${icon ? `<i class="${esc(icon)}" inert></i>` : ""}<span>${esc(m.text)}</span></div>` : "";
      el.innerHTML = kind === "ping" ? `<div class="mm-dir-ring"></div><div class="mm-dir-ring r2"></div>${RETICLE}<div class="mm-dir-dot"></div>${lab}`
        : `${CHEVRON}<div class="mm-dir-arrow" role="button" tabindex="-1"><i class="${esc(icon || "fa-solid fa-eye")}" inert></i></div>${lab}`;
      el.querySelector(".mm-dir-arrow")?.addEventListener("click", (ev) => { ev.stopPropagation(); m.onClick?.(); });
      m.lab = el.querySelector(".mm-dir-label"); m.labW = 0; m.w = {};
    }
    put(el, "t", `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`, (n, v) => { n.style.transform = v; });
    put(el, "a", `${s.a}rad`, (n, v) => n.style.setProperty("--mm-dir-a", v));
    const lab = m.lab;
    if ( lab ) {   // the label stays on screen: below the marker, above it near the bottom, pushed in from the sides
      const below = s.y < a.y + a.h - 90;
      put(lab, "b", below, (n, v) => { n.style.top = v ? "34px" : "auto"; n.style.bottom = v ? "auto" : "34px"; });
      m.labW ||= lab.offsetWidth;
      const half = (m.labW || 160) / 2, dx = Math.max(0, a.x + half + 8 - s.x) - Math.max(0, s.x + half + 8 - (a.x + a.w));
      put(lab, "x", `translate(calc(-50% + ${Math.round(dx)}px), 0)`, (n, v) => { n.style.transform = v; });
    }
  };
  m.place = place;
  marks.add(m);
  if ( panHook === null ) panHook = Hooks.on("canvasPan", () => { for ( const q of marks ) q.place(); });
  place();
  restyle(el);
  el.classList.add("is-in");
  let gone = false;
  const remove = () => { if ( gone ) return; gone = true; marks.delete(m); el.remove(); maybeDrop(); };
  /** A new caption (a cued shot's result): the label's text changes in place with a short flash. */
  const setText = (t) => {
    if ( gone ) return;
    m.text = String(t ?? "");
    const span = el.querySelector(".mm-dir-label > span");
    if ( !span ) { m.kind = null; place(); return; }
    span.textContent = m.text; m.labW = 0;
    span.animate?.([{ filter: "brightness(2.2)", opacity: 0.4 }, { filter: "none", opacity: 1 }], { duration: 420, easing: "ease-out" });
    place();
  };
  return { el, out: (ms = 600) => { if ( gone ) return; el.classList.add("is-out"); setTimeout(remove, ms); }, remove, setText, get kind() { return m.kind; } };
}

/** Everything off at once (scene change, kill switch). */
export function clearAll() { for ( const m of [...marks] ) { marks.delete(m); m.el.remove(); } root?.remove(); root = null; maybeDrop(); }
export const debug = () => ({ root: !!root, marks: marks.size, panHook: panHook !== null, captions: root?.querySelectorAll(".mm-dir-cap").length ?? 0, hits: HITS.size });
