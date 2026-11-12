import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as D from "./director.mjs";
import { barSpot } from "./core.mjs";

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
#mm-dir-bar button:disabled { opacity: 0.32; background: transparent; cursor: default; }
#mm-dir-bar input[type=range] { -webkit-appearance: none; appearance: none; width: 64px; height: 4px; margin: 0 4px; padding: 0; border: 0; border-radius: 2px; box-shadow: none; outline: none;
  background: linear-gradient(to right, #e9c46a var(--p, 100%), rgba(255,255,255,0.22) var(--p, 100%)); }
#mm-dir-bar input[type=range]::-webkit-slider-runnable-track { background: transparent; border: 0; box-shadow: none; height: 4px; }
#mm-dir-bar input[type=range]::-moz-range-track { background: transparent; border: 0; height: 4px; }
#mm-dir-bar input[type=range]::-webkit-slider-thumb { margin-top: -4px;  -webkit-appearance: none; appearance: none; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #1a1612; background: #e9c46a; box-shadow: 0 0 0 1px rgba(233,196,106,0.5); }
#mm-dir-bar input[type=range]::-moz-range-thumb { width: 10px; height: 10px; border-radius: 50%; border: 2px solid #1a1612; background: #e9c46a; }
#mm-dir-bar input[type=range]:focus-visible { box-shadow: 0 0 0 2px rgba(233,196,106,0.45); }
#mm-dir-bar .mm-dir-k { min-width: 2.4em; padding-right: 6px; text-align: right; font-variant-numeric: tabular-nums; opacity: 0.8; }
#mm-dir-bar.is-folded > :not(.mm-dir-keep) { display: none; }
#mm-dir-bar.is-off > :not(.mm-dir-keep):not(.mm-dir-st) { display: none; }
#mm-dir-bar.is-off { border-color: rgba(255,255,255,0.14); }
#mm-dir-bar.is-off .mm-dir-st { opacity: 0.7; }
`;
let el = null, picking = null, hookId = null, hotHook = null, folded = false;

function ensureStyle() { if ( document.querySelector("style[data-mm-dir-bar]") ) return; const s = document.createElement("style"); s.textContent = CSS; s.dataset.mmDirBar = ""; document.head.appendChild(s); }
const btn = (act, icon, key, extra = "") => `<button type="button" data-act="${act}" aria-label="${esc(T(key))}" data-tooltip="${esc(T(key))}"${extra}><i class="${icon}" inert></i></button>`;

// (shown to a GM also while the director is off: then it is the power button and "Off" only)
function wanted() { return !!game.user?.isGM && canvas?.ready && !D.killed(); }

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
  el.innerHTML = `${btn("fold", "fa-solid fa-clapperboard", "Dir.bar.fold", ' class="mm-dir-keep"')}${btn("power", "fa-solid fa-power-off", "Dir.bar.power", ' class="mm-dir-keep" aria-pressed="false"')}
    <span class="mm-dir-st" role="status" aria-live="polite"><span class="mm-dir-dot"></span><span data-st-text></span></span>
    <span class="mm-dir-sep"></span>
    ${btn("pause", "fa-solid fa-pause", "Dir.bar.pause")}${btn("skip", "fa-solid fa-forward-step", "Dir.bar.skip")}
    <span class="mm-dir-sep"></span>
    ${btn("cutToken", "fa-solid fa-user-large", "Dir.bar.cutToken")}${btn("cutSpot", "fa-solid fa-crosshairs", "Dir.bar.cutSpot")}${btn("cutLast", "fa-solid fa-clock-rotate-left", "Dir.bar.cutLast")}
    <span class="mm-dir-sep"></span>
    <i class="fa-solid fa-sun" inert style="opacity:.6;margin-left:4px"></i><input type="range" min="0" max="1" step="0.05" name="k" aria-label="${esc(T("Dir.bar.intensity"))}" data-tooltip="${esc(T("Dir.bar.intensity"))}"><span class="mm-dir-k" aria-hidden="true"></span>`;
  el.classList.toggle("is-folded", folded);
  el.addEventListener("click", onClick);
  const kIn = el.querySelector("[name=k]");
  kIn.addEventListener("input", () => showK(Number(kIn.value)));
  kIn.addEventListener("change", (ev) => D.setGmIntensity(Number(ev.target.value)));
  (document.getElementById("interface") ?? document.body).appendChild(el);
  hookId = Hooks.on(D.HOOK, (kind) => { if ( kind !== "event" ) update(); });
  window.addEventListener("resize", place);
  hotHook = [["renderHotbar", Hooks.on("renderHotbar", () => requestAnimationFrame(place))], ["renderPlayers", Hooks.on("renderPlayers", () => requestAnimationFrame(place))],["collapseSidebar", Hooks.on("collapseSidebar", () => setTimeout(place, 300))]];
}
export function removeBar() {
  if ( !el ) return;
  stopPick();
  el.remove(); el = null;
  if ( hookId !== null ) Hooks.off(D.HOOK, hookId); hookId = null;
  window.removeEventListener("resize", place);
  for ( const [n, id] of hotHook ?? [] ) Hooks.off(n, id); hotHook = null;
  ro?.disconnect(); ro = null;
}
/** Bottom left, next to Foundry's left column (scene controls) and the players list; lifted above the hotbar when it would sit on it,
 * kept left of the right column (chat notifications, sidebar) and off the panels other modules declared (core.barSpot). */
function place() {
  if ( !el ) return;
  const rect = (id) => { const r = document.getElementById(id)?.getBoundingClientRect?.(); return r && r.width > 0 && r.height > 0 ? r : null; };
  let avoid = [];
  try { avoid = moduleApi.zones?.uiAvoids?.() ?? []; } catch { /* no zones API */ }
  const { x, bottom } = barSpot({ vw: innerWidth, vh: innerHeight, w: el.offsetWidth || 400, h: el.offsetHeight || 32, col: rect("ui-left-column-1") ?? rect("scene-controls"),
    players: playersRect(), right: rect("ui-right"), hot: rect("hotbar"), avoid });
  el.style.left = `${x}px`; el.style.bottom = `${bottom}px`;
  watchPlayers();
}
/** fxz: what the players list covers: its element box is the left column's width (72 px at 1920x1080) while its rows - the names,
 * the latency - stand out of it to ~216 px; the union of the list and its rows (a dozen elements), or null when it is not shown. */
function playersRect() {
  const p = document.getElementById("players"); if ( !p ) return null;
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for ( const e of [p, ...p.querySelectorAll("li, #performance-stats, #latency, #fps")] ) {
    const q = e.getBoundingClientRect(); if ( !(q.width > 0 && q.height > 0) ) continue;
    l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
  }
  return r > l ? { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t } : null;
}
/** The players list grows and shrinks (expanded, a user comes or goes) and the hotbar folds: placed again. */
let ro = null;
function watchPlayers() {
  if ( ro || typeof ResizeObserver !== "function" ) return;
  ro = new ResizeObserver(() => requestAnimationFrame(place));
  for ( const id of ["players", "hotbar"] ) { const n = document.getElementById(id); if ( n ) ro.observe(n); }
}

/** A combat on this scene with the combat stage on: the players' cameras may be parked with the action. */
function staged() {
  try { const c = game.combats?.viewed ?? game.combat; return !!moduleApi.directorStage?.settings?.().on && !!c?.started && (!c.scene || c.scene.id === canvas.scene?.id); } catch { return false; }
}
function update() {
  if ( !el ) return;
  const s = D.status();
  el.classList.toggle("is-off", !s.on);
  const pw = el.querySelector("[data-act=power]"); pw.setAttribute("aria-pressed", String(!!s.on));
  if ( !s.on ) { el.dataset.st = "off"; const t = el.querySelector("[data-st-text]"), off = T("Dir.bar.stOff"); if ( t.textContent !== off ) t.textContent = off; return; }
  // (a GM's client in "bar" mode plays nothing itself: what the table sees now is in s.watch)
  const w = (s.watch ?? []).filter((q) => q.on), table = w.some((q) => q.form === "take") ? "take" : w.length ? "soft" : null;
  const st = s.show ? "show" : s.take || table === "take" ? "take" : s.soft.length || table ? "soft" : s.paused ? "paused" : "idle";
  el.dataset.st = st;
  const what = s.last?.caption?.title ? ` · ${s.last.caption.title}` : "";
  const text = st === "show" ? T("Dir.bar.stShow") : st === "take" ? `${T("Dir.bar.stTake")}${what}` : st === "soft" ? `${T("Dir.bar.stSoft")}${what}` : st === "paused" ? T("Dir.bar.stPaused") : T("Dir.bar.stIdle");
  const t = el.querySelector("[data-st-text]"); if ( t.textContent !== text ) t.textContent = text;
  const p = el.querySelector("[data-act=pause]");
  p.setAttribute("aria-pressed", String(!!s.paused));
  p.querySelector("i").className = s.paused ? "fa-solid fa-play" : "fa-solid fa-pause";
  const pl = T(s.paused ? "Dir.bar.resume" : "Dir.bar.pause"); p.setAttribute("aria-label", pl); p.dataset.tooltip = pl;
  // (skip also while a combat is staged: the players' camera may be parked with the last beat - skip sends it home)
  el.querySelector("[data-act=skip]").disabled = !(s.take || s.soft.length || s.show || s.queued || s.watch?.length || staged());
  const k = el.querySelector("[name=k]"); if ( document.activeElement !== k ) { k.value = String(s.k ?? 1); showK(Number(k.value)); }
}
/** The intensity slider's fill and its percent. */
function showK(v) {
  if ( !el ) return;
  const k = el.querySelector("[name=k]"), p = `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
  k.style.setProperty("--p", p); k.setAttribute("aria-valuetext", p);
  const lab = el.querySelector(".mm-dir-k"); if ( lab.textContent !== p ) lab.textContent = p;
}

function onClick(ev) {
  const a = ev.target.closest("[data-act]")?.dataset.act; if ( !a ) return;
  if ( a === "fold" ) { folded = !folded; el.classList.toggle("is-folded", folded); try { game.settings.set(MODULE_ID, "dirBarFolded", folded); } catch { /* not registered */ } place(); return; }
  if ( a === "power" ) { D.setOn(!D.isOn()); return; }
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
  for ( const h of ["updateCombat", "deleteCombat", "createCombat"] ) Hooks.on(h, () => { if ( el ) { update(); setTimeout(place, 400); } });
  Hooks.on("collapseSidebar", () => setTimeout(place, 50));
}
