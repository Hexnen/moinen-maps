import { MODULE_ID } from "../config.mjs";
import * as D from "./director.mjs";

/**
 * THE GM'S DIRECTOR BAR: a small strip at the bottom-left of the canvas during play (GMs only, while the director is on). It says what
 * the director is doing (idle, a take-over and of what, paused, the destruction show) and holds: pause / resume, cut to (the selected
 * token, a spot picked on the map, the last event), skip the current shot, and the intensity for the players. It folds to one button.
 * It listens only to the director's hook (no ticker).
 */

const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const CSS = `
#mm-dir-bar { position: fixed; z-index: 31; bottom: 10px; left: 330px; display: flex; align-items: center; gap: 2px; height: 32px; padding: 0 4px; border-radius: 16px;
  background: rgba(14,12,10,0.86); border: 1px solid rgba(233,196,106,0.35); box-shadow: 0 4px 16px rgba(0,0,0,0.45); color: #ece6da; font-size: 0.78rem; pointer-events: auto; }
#mm-dir-bar button { width: 26px; height: 26px; min-height: 0; padding: 0; margin: 0; border: 0; border-radius: 13px; background: transparent; color: inherit; display: grid; place-items: center; line-height: 1; box-shadow: none; }
#mm-dir-bar button:hover, #mm-dir-bar button:focus-visible { background: rgba(233,196,106,0.18); color: #fff; }
#mm-dir-bar button[aria-pressed=true] { color: #e9c46a; }
#mm-dir-bar button.is-picking { background: rgba(233,196,106,0.3); color: #fff; }
#mm-dir-bar .mm-dir-st { display: flex; align-items: center; gap: 6px; padding: 0 8px 0 4px; max-width: 15rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#mm-dir-bar .mm-dir-dot { width: 8px; height: 8px; border-radius: 50%; background: #6b6458; flex: none; }
#mm-dir-bar[data-st=take] .mm-dir-dot { background: #e05a47; box-shadow: 0 0 8px #e05a47; }
#mm-dir-bar[data-st=soft] .mm-dir-dot, #mm-dir-bar[data-st=show] .mm-dir-dot { background: #e9c46a; box-shadow: 0 0 8px #e9c46a; }
#mm-dir-bar[data-st=paused] .mm-dir-dot { background: #8aa4c8; }
#mm-dir-bar .mm-dir-sep { width: 1px; height: 18px; background: rgba(255,255,255,0.14); margin: 0 3px; }
#mm-dir-bar input[type=range] { width: 64px; margin: 0 4px; accent-color: #e9c46a; height: 4px; }
#mm-dir-bar.is-folded > :not(.mm-dir-keep) { display: none; }
`;
let el = null, picking = null, hookId = null, folded = false;

function ensureStyle() { if ( document.querySelector("style[data-mm-dir-bar]") ) return; const s = document.createElement("style"); s.textContent = CSS; s.dataset.mmDirBar = ""; document.head.appendChild(s); }
const btn = (act, icon, key, extra = "") => `<button type="button" data-act="${act}" aria-label="${esc(T(key))}" data-tooltip="${esc(T(key))}"${extra}><i class="${icon}" inert></i></button>`;

function wanted() { return !!game.user?.isGM && canvas?.ready && !D.killed() && D.R().enabled; }

export function syncBar() {
  if ( !wanted() ) { removeBar(); return; }
  if ( !el ) build();
  update();
  place();
}
function build() {
  ensureStyle();
  try { folded = !!game.settings.get(MODULE_ID, "dirBarFolded"); } catch { folded = false; }
  el = document.createElement("div");
  el.id = "mm-dir-bar"; el.setAttribute("role", "toolbar"); el.setAttribute("aria-label", T("Dir.bar.title"));
  el.innerHTML = `${btn("fold", "fa-solid fa-clapperboard", "Dir.bar.fold", ' class="mm-dir-keep"')}
    <span class="mm-dir-st" role="status" aria-live="polite"><span class="mm-dir-dot"></span><span data-st-text></span></span>
    <span class="mm-dir-sep"></span>
    ${btn("pause", "fa-solid fa-pause", "Dir.bar.pause")}${btn("skip", "fa-solid fa-forward-step", "Dir.bar.skip")}
    <span class="mm-dir-sep"></span>
    ${btn("cutToken", "fa-solid fa-user-large", "Dir.bar.cutToken")}${btn("cutSpot", "fa-solid fa-crosshairs", "Dir.bar.cutSpot")}${btn("cutLast", "fa-solid fa-clock-rotate-left", "Dir.bar.cutLast")}
    <span class="mm-dir-sep"></span>
    <i class="fa-solid fa-sun" inert style="opacity:.6;margin-left:4px"></i><input type="range" min="0" max="1" step="0.05" name="k" aria-label="${esc(T("Dir.bar.intensity"))}" data-tooltip="${esc(T("Dir.bar.intensity"))}">`;
  el.classList.toggle("is-folded", folded);
  el.addEventListener("click", onClick);
  el.querySelector("[name=k]").addEventListener("change", (ev) => D.setGmIntensity(Number(ev.target.value)));
  (document.getElementById("interface") ?? document.body).appendChild(el);
  hookId = Hooks.on(D.HOOK, (kind) => { if ( kind !== "event" ) update(); });
  window.addEventListener("resize", place);
}
export function removeBar() {
  if ( !el ) return;
  stopPick();
  el.remove(); el = null;
  if ( hookId !== null ) Hooks.off(D.HOOK, hookId); hookId = null;
  window.removeEventListener("resize", place);
}
/** Next to the left column of Foundry's interface (scene controls, players), above the bottom edge. */
function place() {
  if ( !el ) return;
  const left = document.getElementById("ui-left") ?? document.getElementById("scene-controls");
  const r = left?.getBoundingClientRect?.();
  const x = r && r.width ? Math.round(r.right + 12) : 330;
  el.style.left = `${Math.min(x, Math.max(8, innerWidth - el.offsetWidth - 330))}px`;
}

function update() {
  if ( !el ) return;
  const s = D.status();
  const st = s.show ? "show" : s.take ? "take" : s.soft.length ? "soft" : s.paused ? "paused" : "idle";
  el.dataset.st = st;
  const what = s.last?.caption?.title ? ` · ${s.last.caption.title}` : "";
  const text = st === "show" ? T("Dir.bar.stShow") : st === "take" ? `${T("Dir.bar.stTake")}${what}` : st === "soft" ? `${T("Dir.bar.stSoft")}${what}` : st === "paused" ? T("Dir.bar.stPaused") : T("Dir.bar.stIdle");
  const t = el.querySelector("[data-st-text]"); if ( t.textContent !== text ) t.textContent = text;
  const p = el.querySelector("[data-act=pause]");
  p.setAttribute("aria-pressed", String(!!s.paused));
  p.querySelector("i").className = s.paused ? "fa-solid fa-play" : "fa-solid fa-pause";
  const pl = T(s.paused ? "Dir.bar.resume" : "Dir.bar.pause"); p.setAttribute("aria-label", pl); p.dataset.tooltip = pl;
  el.querySelector("[data-act=skip]").disabled = !(s.take || s.soft.length || s.show || s.queued);
  const k = el.querySelector("[name=k]"); if ( document.activeElement !== k ) k.value = String(s.k ?? 1);
}

function onClick(ev) {
  const a = ev.target.closest("[data-act]")?.dataset.act; if ( !a ) return;
  if ( a === "fold" ) { folded = !folded; el.classList.toggle("is-folded", folded); try { game.settings.set(MODULE_ID, "dirBarFolded", folded); } catch { /* not registered */ } place(); return; }
  if ( a === "pause" ) D.setPaused(!D.status().paused);
  else if ( a === "skip" ) D.skip();
  else if ( a === "cutLast" ) { if ( !D.cutTo("last") ) ui.notifications?.info(T("Dir.bar.noLast")); }
  else if ( a === "cutToken" ) {
    const t = canvas.tokens?.controlled?.[0] ?? [...(game.user.targets ?? [])][0];
    if ( !t ) { ui.notifications?.info(T("Dir.bar.noToken")); return; }
    D.cutTo({ token: t.document.id });
  } else if ( a === "cutSpot" ) { if ( picking ) stopPick(); else startPick(); }
}

/** "Cut to a spot": the next left click on the map is the spot (Esc or the button again: cancel). */
function startPick() {
  const b = el?.querySelector("[data-act=cutSpot]"); b?.classList.add("is-picking");
  const board = document.getElementById("board");
  const onDown = (ev) => {
    if ( ev.target !== board || ev.button !== 0 ) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    const p = canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
    stopPick();
    D.cutTo({ x: p.x, y: p.y });
  };
  const onKey = (ev) => { if ( ev.key === "Escape" ) { ev.preventDefault(); ev.stopImmediatePropagation(); stopPick(); } };
  window.addEventListener("pointerdown", onDown, true); window.addEventListener("keydown", onKey, true);
  if ( board ) board.style.cursor = "crosshair";
  picking = () => { window.removeEventListener("pointerdown", onDown, true); window.removeEventListener("keydown", onKey, true); if ( board ) board.style.cursor = ""; b?.classList.remove("is-picking"); };
}
function stopPick() { picking?.(); picking = null; }

export function registerBar() {
  Hooks.once("init", () => game.settings.register(MODULE_ID, "dirBarFolded", { scope: "client", config: false, type: Boolean, default: false }));
  Hooks.on("canvasReady", syncBar);
  Hooks.on("canvasTearDown", removeBar);
  Hooks.on(D.HOOK, (kind) => { if ( kind === "state" ) syncBar(); });
  Hooks.on("collapseSidebar", () => setTimeout(place, 50));
}
