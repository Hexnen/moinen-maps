import { edgeSpot } from "./core.mjs";

/**
 * DIRECTOR OVERLAYS (DOM, this client only): the caption of a take-over (a film lower third over the bottom letterbox bar), and the soft
 * forms: a ping on the spot when it is on screen, an arrow on the screen edge pointing to it when it is not, each with a short caption.
 * Nothing exists while no shot plays. The markers follow the camera through the "canvasPan" hook (no ticker listener): the hook is held
 * only while a marker is up.
 */

const CSS = `
.mm-dir { position: fixed; inset: 0; pointer-events: none; z-index: 2; overflow: hidden; font-family: var(--font-primary, sans-serif); }
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
 */
function safeRect() {
  const mid = document.getElementById("ui-middle")?.getBoundingClientRect?.();
  let x0 = mid?.width ? mid.left : 0, x1 = mid?.width ? mid.right : innerWidth, y0 = 0, y1 = innerHeight;
  const top = document.getElementById("navigation")?.getBoundingClientRect?.(), bot = document.getElementById("hotbar")?.getBoundingClientRect?.();
  if ( top?.height && top.bottom < innerHeight / 3 ) y0 = Math.max(y0, top.bottom);
  if ( bot?.height && bot.top > innerHeight * 2 / 3 ) y1 = Math.min(y1, bot.top);
  if ( x1 - x0 < 300 ) { x0 = 0; x1 = innerWidth; }
  if ( y1 - y0 < 240 ) { y0 = 0; y1 = innerHeight; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
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
 * so the caption sits in the bottom bar when it is tall enough, else just above the bottom. Returns { out(), remove() }.
 */
export function caption({ kick, title, icon, lb = 0, hint = "" }) {
  const el = document.createElement("div");
  el.className = `mm-dir-cap${lb >= 7 ? "" : " is-low"}`;
  el.style.setProperty("--mm-dir-lb", `${lb}vh`);
  el.innerHTML = `<div class="mm-dir-kick">${icon ? `<i class="${esc(icon)}" inert></i>` : ""}<span>${esc(kick)}</span></div><div class="mm-dir-title">${esc(title)}</div>${hint ? `<div class="mm-dir-hint">${esc(hint)}</div>` : ""}`;
  host().appendChild(el);
  void el.offsetWidth;
  el.classList.add("is-in");
  let gone = false;
  const remove = () => { if ( gone ) return; gone = true; el.remove(); maybeDrop(); };
  return { el, out: (ms = 420) => { if ( gone ) return; el.classList.add("is-out"); setTimeout(remove, ms); }, remove };
}

/**
 * A soft marker at scene point (x, y): a ping when on screen, an edge arrow when not; `text` its caption, `icon` the kind's icon.
 * `onClick` (the arrow): the player chooses to look (the camera goes there; it is theirs then). Returns { out(), remove() }.
 */
export function marker({ x, y, text, icon, onClick }) {
  const el = document.createElement("div");
  el.className = "mm-dir-mark";
  host().appendChild(el);
  const m = { el, x, y, kind: null, onClick, text, icon };
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
    }
    el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`;
    el.style.setProperty("--mm-dir-a", `${s.a}rad`);
    const lab = el.querySelector(".mm-dir-label");
    if ( lab ) {   // the label stays on screen: below the marker, above it near the bottom, pushed in from the sides
      const below = s.y < a.y + a.h - 90;
      lab.style.top = below ? "34px" : "auto"; lab.style.bottom = below ? "auto" : "34px";
      const half = (lab.offsetWidth || 160) / 2, dx = Math.max(0, a.x + half + 8 - s.x) - Math.max(0, s.x + half + 8 - (a.x + a.w));
      lab.style.transform = `translate(calc(-50% + ${Math.round(dx)}px), 0)`;
    }
  };
  m.place = place;
  marks.add(m);
  if ( panHook === null ) panHook = Hooks.on("canvasPan", () => { for ( const q of marks ) q.place(); });
  place();
  void el.offsetWidth;
  el.classList.add("is-in");
  let gone = false;
  const remove = () => { if ( gone ) return; gone = true; marks.delete(m); el.remove(); maybeDrop(); };
  /** A new caption (a cued shot's result): the label's text changes in place with a short flash. */
  const setText = (t) => {
    if ( gone ) return;
    m.text = String(t ?? "");
    const span = el.querySelector(".mm-dir-label > span");
    if ( !span ) { m.kind = null; place(); return; }
    span.textContent = m.text;
    span.animate?.([{ filter: "brightness(2.2)", opacity: 0.4 }, { filter: "none", opacity: 1 }], { duration: 420, easing: "ease-out" });
    place();
  };
  return { el, out: (ms = 600) => { if ( gone ) return; el.classList.add("is-out"); setTimeout(remove, ms); }, remove, setText, get kind() { return m.kind; } };
}

/** Everything off at once (scene change, kill switch). */
export function clearAll() { for ( const m of [...marks] ) { marks.delete(m); m.el.remove(); } root?.remove(); root = null; maybeDrop(); }
export const debug = () => ({ root: !!root, marks: marks.size, panHook: panHook !== null, captions: root?.querySelectorAll(".mm-dir-cap").length ?? 0 });
