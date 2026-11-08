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
.mm-dir-ring { position: absolute; left: -22px; top: -22px; width: 44px; height: 44px; border-radius: 50%; border: 2px solid rgba(233,196,106,0.95);
  box-shadow: 0 0 12px rgba(233,196,106,0.55), inset 0 0 8px rgba(233,196,106,0.35); animation: mm-dir-ping 1500ms cubic-bezier(0.2, 0.7, 0.3, 1) infinite; }
.mm-dir-ring.r2 { animation-delay: 500ms; }
.mm-dir-dot { position: absolute; left: -4px; top: -4px; width: 8px; height: 8px; border-radius: 50%; background: #e9c46a; box-shadow: 0 0 10px #e9c46a; }
@keyframes mm-dir-ping { 0% { transform: scale(0.35); opacity: 0; } 15% { opacity: 1; } 100% { transform: scale(1.6); opacity: 0; } }
.mm-dir-arrow { position: absolute; left: -17px; top: -17px; width: 34px; height: 34px; border-radius: 50%; background: rgba(12,10,8,0.78); border: 1px solid rgba(233,196,106,0.85);
  box-shadow: 0 2px 10px rgba(0,0,0,0.6), 0 0 14px rgba(233,196,106,0.35); display: grid; place-items: center; color: #e9c46a; pointer-events: auto; cursor: pointer;
  animation: mm-dir-nudge 1100ms ease-in-out infinite; }
.mm-dir-arrow > i { font-size: 15px; }
.mm-dir-arrow .mm-dir-chev { position: absolute; inset: -9px; transform: rotate(var(--mm-dir-a, 0rad)); pointer-events: none; }
.mm-dir-arrow .mm-dir-chev::after { content: ""; position: absolute; right: -2px; top: 50%; margin-top: -6px; border: 6px solid transparent; border-left: 8px solid #e9c46a; }
@keyframes mm-dir-nudge { 0%, 100% { translate: 0 0; } 50% { translate: calc(cos(var(--mm-dir-a, 0rad)) * 4px) calc(sin(var(--mm-dir-a, 0rad)) * 4px); } }
.mm-dir-label { position: absolute; white-space: nowrap; padding: 0.22rem 0.6rem; border-radius: 3px; background: rgba(12,10,8,0.72); color: #f4efe6; font-size: 0.8rem;
  letter-spacing: 0.03em; box-shadow: 0 2px 8px rgba(0,0,0,0.5); border-left: 2px solid #e9c46a; transform: translate(-50%, 0); left: 0; top: 30px; }
.mm-dir-label > i { color: #e9c46a; margin-right: 0.4em; }
@media (prefers-reduced-motion: reduce) { .mm-dir-ring, .mm-dir-arrow { animation: none; } .mm-dir-title { filter: none; } }
`;
let styled = false;
function ensureStyle() { if ( styled ) return; styled = true; const s = document.createElement("style"); s.textContent = CSS; s.dataset.mmDir = ""; document.head.appendChild(s); }

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
    const p = toScreen(m.x, m.y), s = edgeSpot(p, innerWidth, innerHeight, 64), kind = s.on ? "ping" : "arrow";
    if ( kind !== m.kind ) {
      m.kind = kind;
      const lab = text ? `<div class="mm-dir-label">${icon ? `<i class="${esc(icon)}" inert></i>` : ""}${esc(text)}</div>` : "";
      el.innerHTML = kind === "ping" ? `<div class="mm-dir-ring"></div><div class="mm-dir-ring r2"></div><div class="mm-dir-dot"></div>${lab}`
        : `<div class="mm-dir-arrow" role="button" tabindex="-1"><i class="${esc(icon || "fa-solid fa-eye")}" inert></i><span class="mm-dir-chev"></span></div>${lab}`;
      el.querySelector(".mm-dir-arrow")?.addEventListener("click", (ev) => { ev.stopPropagation(); m.onClick?.(); });
    }
    el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`;
    el.style.setProperty("--mm-dir-a", `${s.a}rad`);
    const lab = el.querySelector(".mm-dir-label");
    if ( lab ) {   // the label stays on screen: below the marker, above it near the bottom, pushed in from the sides
      const below = s.y < innerHeight - 90;
      lab.style.top = below ? "28px" : "auto"; lab.style.bottom = below ? "auto" : "28px";
      const half = (lab.offsetWidth || 160) / 2, dx = Math.max(0, half + 8 - s.x) - Math.max(0, s.x + half + 8 - innerWidth);
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
  return { el, out: (ms = 600) => { if ( gone ) return; el.classList.add("is-out"); setTimeout(remove, ms); }, remove, get kind() { return m.kind; } };
}

/** Everything off at once (scene change, kill switch). */
export function clearAll() { for ( const m of [...marks] ) { marks.delete(m); m.el.remove(); } root?.remove(); root = null; maybeDrop(); }
export const debug = () => ({ root: !!root, marks: marks.size, panHook: panHook !== null, captions: root?.querySelectorAll(".mm-dir-cap").length ?? 0 });
