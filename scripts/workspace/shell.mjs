import { MODULE_ID } from "../config.mjs";
import { GROUP, activeSection, sectionById, sectionTool } from "./registry.mjs";
import { registerMarkerSettings, markerOpacity, previewMarkerOpacity, setMarkerOpacity, onMarkers } from "./markers.mjs";
import { isEcho, writeControl } from "./ui.mjs";

/**
 * The workspace on screen while one of our sections is picked in the second column of the scene controls (GM only):
 *  - a bar across the top of the canvas: the section's tools (left), the active tool's options (middle), the section's actions and
 *    shortcuts to its dock panels (right);
 *  - a dock of collapsible panels on the right, left of Foundry's sidebar: choices, lists and settings.
 * The active tool lives here, not in Foundry's scene controls (whose active "tool" is the section); `workspaceTool()` is what the
 * engines read, and the hook "moinenMapsTool" (tool, previousTool, sectionId) tells them when it changes.
 * Bar and dock are plain regions of one frameless application placed inside #interface; their edges follow the scene controls,
 * the scene navigation, the sidebar (expanded or collapsed) and the hotbar. What is folded and which tool each section had is
 * remembered per user.
 */

const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const L = (k) => game.i18n.localize(k);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const GAP = 12;
/** Widgets of other modules that sit in the dock's corner, left of the sidebar (the Invincible challenge tracker). */
const AVOID = ["#invincible-challenges"];

export function registerWorkspaceSettings() {
  game.settings.register(MODULE_ID, "workspace", { scope: "client", config: false, type: Object, default: { bar: true, dock: true, panels: {}, tools: {} } });
  registerMarkerSettings();
}

/**
 * The marker opacity slider of the bar: dragging previews (nothing stored), the release stores once. A value changed elsewhere is
 * written back silently (never read as an edit, see ui.mjs writeControl) and never while the slider is held.
 */
function wireMarkers(box) {
  const picker = box.querySelector("range-picker");
  const onIn = (ev) => { if ( isEcho() ) return; if ( ev.target.matches?.("input[type=range]") ) previewMarkerOpacity(ev.target.valueAsNumber); };
  const onChange = (ev) => { if ( isEcho() ) return; const t = ev.target, v = t.matches?.("input") ? Number(t.value) : Number(picker.value); if ( Number.isFinite(v) ) setMarkerOpacity(v); };
  box.addEventListener("input", onIn);
  box.addEventListener("change", onChange);
  const off = onMarkers((v) => { if ( !picker.contains(document.activeElement) ) writeControl(picker, v); });
  return () => { box.removeEventListener("input", onIn); box.removeEventListener("change", onChange); off(); previewMarkerOpacity(null); };
}

const getState = () => { try { return { bar: true, dock: true, panels: {}, tools: {}, ...(game.settings.get(MODULE_ID, "workspace") ?? {}) }; } catch { return { bar: true, dock: true, panels: {}, tools: {} }; } };
const saveState = (patch) => { try { return game.settings.set(MODULE_ID, "workspace", { ...getState(), ...patch }); } catch { return null; } };
const panelKey = (s, p) => `${s.id}.${p.id}`;
const panelOpen = (s, p) => getState().panels[panelKey(s, p)] ?? (p.open !== false);
const toolsOf = (s) => s.soon ? [] : [...(s.tools?.() ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
/** The section's tool in hand: the one last used (remembered per user), else the section's default, else its first. */
function resolveTool(s) {
  const modes = toolsOf(s).filter((t) => !t.button), want = getState().tools?.[s.id];
  return (modes.find((t) => t.name === want) ?? modes.find((t) => t.name === s.activeTool) ?? modes[0])?.name ?? "";
}

class Workspace extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "moinen-maps-workspace", tag: "div", classes: ["mm-ws"],
    window: { frame: false, positioned: false }
  };

  /** The section and tool the current markup was built for. */
  section = null;
  tool = "";
  #cleanups = new Map();   // "bar" | panel id -> cleanup
  #observer = null;
  #onResize = () => this.layout();

  /** Live in #interface, before Foundry's own regions, so chat cards and the hotbar stay above the dock. */
  _insertElement(element) {
    const host = document.getElementById("interface") ?? document.body;
    const old = host.querySelector(`#${element.id}`);
    if ( old ) old.replaceWith(element); else host.prepend(element);
  }

  async _renderHTML() {
    const s = this.section, st = getState(), frag = document.createDocumentFragment();
    const title = L(s.title);
    const bar = document.createElement("section");
    bar.className = "mm-ws-bar"; bar.dataset.mm = "barwrap";
    bar.setAttribute("aria-label", game.i18n.format("MOINENMAPS.WS.barLabel", { section: title }));
    bar.classList.toggle("is-folded", !st.bar);
    bar.innerHTML = `<span class="mm-ws-tag${s.soon ? " is-soon" : ""}"><i class="${esc(s.icon)}" inert></i><span>${esc(title)}</span></span>
      <div class="mm-ws-bar-body" data-mm="bar"${st.bar ? "" : " hidden"}></div>
      <button type="button" class="mm-ws-fold" data-act="bar" aria-expanded="${st.bar}" aria-label="${esc(T(st.bar ? "WS.barFold" : "WS.barOpen"))}" data-tooltip="${esc(T(st.bar ? "WS.barFold" : "WS.barOpen"))}"><i class="fa-solid ${st.bar ? "fa-chevron-left" : "fa-chevron-right"}" inert></i></button>`;
    const dock = document.createElement("aside");
    dock.className = "mm-ws-dock"; dock.dataset.mm = "dock";
    dock.setAttribute("aria-label", game.i18n.format("MOINENMAPS.WS.dockLabel", { section: title }));
    dock.classList.toggle("is-folded", !st.dock);
    const panels = s.panels.map((p) => {
      const open = panelOpen(s, p), id = `mm-ws-p-${s.id}-${p.id}`;
      return `<section class="mm-ws-panel${open ? " is-open" : ""}" data-panel="${esc(p.id)}">
        <h3 class="mm-ws-panel-head"><button type="button" data-act="panel" aria-expanded="${open}" aria-controls="${id}"><i class="${esc(p.icon)}" inert></i><span>${esc(L(p.title))}</span><i class="fa-solid fa-chevron-down mm-ws-chev" inert></i></button></h3>
        <div class="mm-ws-panel-body" id="${id}" data-mm="panel"${open ? "" : " hidden"}></div></section>`;
    }).join("");
    const rail = s.panels.map((p) => `<button type="button" data-act="rail" data-panel="${esc(p.id)}" aria-label="${esc(L(p.title))}" data-tooltip="${esc(L(p.title))}" data-tooltip-direction="LEFT"><i class="${esc(p.icon)}" inert></i></button>`).join("");
    dock.innerHTML = `<header class="mm-ws-dock-head">
        <span class="mm-ws-dock-title">${esc(T("WS.panels"))}</span>
        <button type="button" class="mm-ws-fold" data-act="dock" aria-expanded="${st.dock}" aria-label="${esc(T(st.dock ? "WS.dockFold" : "WS.dockOpen"))}" data-tooltip="${esc(T(st.dock ? "WS.dockFold" : "WS.dockOpen"))}" data-tooltip-direction="LEFT"><i class="fa-solid ${st.dock ? "fa-chevron-right" : "fa-chevron-left"}" inert></i></button>
      </header>
      <div class="mm-ws-panels"${st.dock ? "" : " hidden"}>${panels}</div>
      <nav class="mm-ws-rail" aria-label="${esc(T("WS.panels"))}"${st.dock ? " hidden" : ""}>${rail}</nav>`;
    frag.append(bar, dock);
    return frag;
  }

  _replaceHTML(result, content) {
    this.#cleanupAll();
    content.replaceChildren(result);
    content.dataset.section = this.section.id;
    if ( !content._mmWired ) {
      content._mmWired = true;
      content.addEventListener("click", (ev) => this.#onClick(ev));
    }
    content.style.setProperty("--mm-sec", this.section.color ?? "var(--mm-accent)");
    this.#mountBar();
    for ( const p of this.section.panels ) if ( panelOpen(this.section, p) && getState().dock ) this.#mountPanel(p);
    this.#watch();
    const bar = content.querySelector(".mm-ws-bar"); if ( bar ) this.#observer.observe(bar);
    this.layout();
  }

  #watch() {
    if ( this.#observer ) return;
    window.addEventListener("resize", this.#onResize);
    // the sidebar expanding or collapsing, the hotbar or the scene navigation changing size all move our edges
    this.#observer = new ResizeObserver(this.#onResize);
    for ( const sel of ["#sidebar", "#hotbar", "#scene-navigation", "#scene-controls", "#chat-notifications", ...AVOID] ) { const el = document.querySelector(sel); if ( el ) this.#observer.observe(el); }
  }

  _onClose() {
    this.#cleanupAll();
    window.removeEventListener("resize", this.#onResize);
    this.#observer?.disconnect(); this.#observer = null;
  }

  /* ------------------------------------------------------------ mounting */

  #ctx() { return { section: this.section, tool: this.tool, revealPanel: (id) => this.revealPanel(id) }; }

  #run(key, fn) {
    try { const c = fn(); if ( typeof c === "function" ) this.#cleanups.set(key, c); }
    catch ( err ) { console.error(`${MODULE_ID} | workspace ${key}`, err); }
  }
  #cleanup(key) { const c = this.#cleanups.get(key); this.#cleanups.delete(key); try { c?.(); } catch ( err ) { console.error(`${MODULE_ID} | workspace ${key}`, err); } }
  #cleanupAll() { for ( const k of [...this.#cleanups.keys()] ) this.#cleanup(k); }

  #mountBar() {
    this.#cleanup("bar");
    const host = this.element?.querySelector('[data-mm="bar"]'); if ( !host ) return;
    const focus = host.contains(document.activeElement) ? document.activeElement.dataset.tool ?? document.activeElement.dataset.action : null;
    const s = this.section, tools = toolsOf(s), modes = tools.filter((t) => !t.button), actions = tools.filter((t) => t.button);
    const btn = (t, attr) => `<button type="button" class="mm-ws-toolbtn" ${attr} aria-label="${esc(L(t.title))}" data-tooltip="${esc(L(t.title))}"${t.color ? ` style="--mm-tool:${esc(t.color)}"` : ""}><i class="${esc(t.icon)}" inert></i></button>`;
    const active = modes.find((t) => t.name === this.tool);
    const markers = modes.length ? `<div class="mm-ws-markers" data-tooltip="${esc(T("WS.markersHint"))}"><i class="fa-solid fa-eye" inert></i>
      <range-picker name="markerOpacity" value="${markerOpacity()}" min="0" max="1" step="0.05" aria-label="${esc(T("WS.markers"))}"></range-picker></div>` : "";
    host.innerHTML = `${modes.length ? `<div class="mm-ws-tools" role="group" aria-label="${esc(T("WS.tools"))}">${modes.map((t) => btn(t, `data-tool="${esc(t.name)}" aria-pressed="${t.name === this.tool}"`)).join("")}</div>` : ""}
      ${active ? `<span class="mm-ws-tool">${esc(L(active.title))}</span>` : ""}<div class="mm-ws-opts"></div>
      <div class="mm-ws-side">${markers}${actions.map((t) => btn(t, `data-action="${esc(t.name)}"`)).join("")}
        ${s.panels.map((p) => `<button type="button" class="mm-ws-toolbtn mm-ws-paneltog" data-act="rail" data-panel="${esc(p.id)}" aria-label="${esc(L(p.title))}" data-tooltip="${esc(L(p.title))}"><i class="${esc(p.icon)}" inert></i></button>`).join("")}</div>`;
    const box = host.querySelector(".mm-ws-opts");
    this.#cleanup("markers");
    const mk = host.querySelector(".mm-ws-markers"); if ( mk ) this.#run("markers", () => wireMarkers(mk));
    if ( s.bar && getState().bar ) this.#run("bar", () => s.bar(box, this.#ctx()));
    if ( focus ) host.querySelector(`[data-tool="${CSS.escape(focus)}"], [data-action="${CSS.escape(focus)}"]`)?.focus();
  }

  #mountPanel(p) {
    const body = this.element?.querySelector(`.mm-ws-panel[data-panel="${p.id}"] > [data-mm="panel"]`); if ( !body ) return;
    this.#cleanup(`panel:${p.id}`);
    body.replaceChildren();
    this.#run(`panel:${p.id}`, () => p.mount(body, this.#ctx()));
  }

  /** The active tool changed inside the same section: only the bar is rebuilt. */
  refreshBar() {
    if ( this.rendered ) this.#mountBar();
  }

  /** Open one panel (and the dock), e.g. "manage presets" from the palette. */
  async revealPanel(id) {
    const s = this.section, p = s?.panels.find((x) => x.id === id); if ( !p ) return;
    const panels = { ...getState().panels, [panelKey(s, p)]: true };
    await saveState({ panels });
    if ( !getState().dock ) await this.#foldDock(true);
    this.#setPanel(p, true);
    const sec = this.element?.querySelector(`.mm-ws-panel[data-panel="${id}"]`);
    sec?.scrollIntoView({ block: "nearest" });
    sec?.querySelector(".mm-ws-panel-head button")?.focus();
  }

  /** Open or close one panel; an open panel that already has its content keeps it. */
  #setPanel(p, open) {
    const sec = this.element?.querySelector(`.mm-ws-panel[data-panel="${p.id}"]`); if ( !sec ) return;
    const btn = sec.querySelector(".mm-ws-panel-head button"), body = sec.querySelector('[data-mm="panel"]');
    sec.classList.toggle("is-open", open); btn.setAttribute("aria-expanded", String(open)); body.hidden = !open;
    if ( !open ) { this.#cleanup(`panel:${p.id}`); body.replaceChildren(); }
    else if ( !body.childElementCount ) this.#mountPanel(p);
  }

  async #onClick(ev) {
    const t = ev.target.closest("button[data-tool], button[data-action]");
    if ( t?.dataset.tool ) return useTool(this.section.id, t.dataset.tool);
    if ( t?.dataset.action ) return toolsOf(this.section).find((x) => x.name === t.dataset.action)?.onClick?.();
    const b = ev.target.closest("button[data-act]"); if ( !b ) return;
    const s = this.section, act = b.dataset.act;
    if ( act === "bar" ) return this.#foldBar(!getState().bar);
    if ( act === "dock" ) return this.#foldDock(!getState().dock);
    if ( act === "rail" ) return this.revealPanel(b.dataset.panel);
    if ( act === "panel" ) {
      const p = s.panels.find((x) => x.id === b.closest(".mm-ws-panel").dataset.panel); if ( !p ) return;
      const open = !panelOpen(s, p);
      saveState({ panels: { ...getState().panels, [panelKey(s, p)]: open } });
      this.#setPanel(p, open);
    }
  }

  /** Swap a fold button's state (the buttons stay where they are, so focus stays on them). */
  #foldButton(b, open, openKey, foldKey, icons) {
    const label = T(open ? foldKey : openKey);
    b.setAttribute("aria-expanded", String(open)); b.setAttribute("aria-label", label); b.dataset.tooltip = label;
    b.firstElementChild.className = `fa-solid ${open ? icons[0] : icons[1]}`;
  }

  async #foldBar(open) {
    await saveState({ bar: open });
    const wrap = this.element?.querySelector('[data-mm="barwrap"]'); if ( !wrap ) return;
    wrap.classList.toggle("is-folded", !open);
    wrap.querySelector('[data-mm="bar"]').hidden = !open;
    this.#foldButton(wrap.querySelector('[data-act="bar"]'), open, "WS.barOpen", "WS.barFold", ["fa-chevron-left", "fa-chevron-right"]);
    if ( open ) this.#mountBar(); else this.#cleanup("bar");
    this.layout();
  }

  async #foldDock(open) {
    await saveState({ dock: open });
    const dock = this.element?.querySelector('[data-mm="dock"]'); if ( !dock ) return;
    dock.classList.toggle("is-folded", !open);
    dock.querySelector(".mm-ws-panels").hidden = !open;
    dock.querySelector(".mm-ws-rail").hidden = open;
    this.#foldButton(dock.querySelector('[data-act="dock"]'), open, "WS.dockOpen", "WS.dockFold", ["fa-chevron-right", "fa-chevron-left"]);
    for ( const p of this.section.panels ) {
      if ( open && panelOpen(this.section, p) ) this.#setPanel(p, true);
      else if ( !open ) { this.#cleanup(`panel:${p.id}`); dock.querySelector(`.mm-ws-panel[data-panel="${p.id}"] > [data-mm="panel"]`)?.replaceChildren(); }
    }
    this.layout();
  }

  /* ------------------------------------------------------------ layout */

  /** Keep clear of the scene controls and navigation on the left, the sidebar on the right and the hotbar at the bottom. */
  layout() {
    const el = this.element; if ( !el ) return;
    const r = (sel) => { const e = document.querySelector(sel); if ( !e?.getClientRects().length ) return null; const b = e.getBoundingClientRect(); return b.width ? b : null; };
    const ctl = r("#scene-controls"), nav = r("#scene-navigation"), side = r("#sidebar"), hot = r("#hotbar");
    // the navigation column is wide even when it shows a single scene: measure what it really draws
    const navItems = nav ? [...document.querySelectorAll("#scene-navigation > *")].map((e) => e.getBoundingClientRect()).filter((b) => b.width && b.top < 120) : [];
    const navRight = navItems.length ? Math.max(...navItems.map((b) => b.right)) : 0;
    const left = Math.max(ctl?.right ?? 0, navRight) + GAP;
    const right = innerWidth - (side?.left ?? innerWidth) + GAP;
    el.style.setProperty("--mm-ws-left", `${Math.round(left)}px`);
    el.style.setProperty("--mm-ws-right", `${Math.round(right)}px`);
    // other modules' widgets pinned in the same top-right corner (see AVOID): the bar ends before them, the dock starts below them
    const widgets = AVOID.map(r).filter((w) => w && w.top < innerHeight / 3 && w.left < innerWidth - right);
    const bar = el.querySelector(".mm-ws-bar");   // offsets, not the box: the entrance animation moves the box for a moment
    let barRight = Math.max(right, ...widgets.map((w) => innerWidth - w.left + GAP)), barTop = 16;
    // too little room beside them (a narrow window): the bar runs full width below them instead
    if ( innerWidth - barRight - left < 540 ) { barRight = right; barTop = Math.max(16, ...widgets.map((w) => w.bottom + 8)); }
    el.style.setProperty("--mm-ws-bar-right", `${Math.round(barRight)}px`);
    el.style.setProperty("--mm-ws-bar-top", `${Math.round(barTop)}px`);
    const barBottom = bar ? barTop + bar.offsetHeight : 60;
    // the dock starts below the bar (which grows when its options wrap) ...
    const dock = el.querySelector(".mm-ws-dock"), d = dock?.getBoundingClientRect();
    const dockLeft = innerWidth - right - (d?.width || 300);
    let top = barBottom + 8;
    for ( const w of widgets ) if ( w.right > dockLeft ) top = Math.max(top, w.bottom + 8);
    el.style.setProperty("--mm-ws-top", `${Math.round(top)}px`);
    // ... and above the hotbar and the chat input (shown beside a collapsed sidebar) when they share its column
    let bottom = 16;
    for ( const b of [hot, r("#chat-notifications #chat-message")] ) if ( b && b.right > dockLeft && b.left < innerWidth - right ) bottom = Math.max(bottom, innerHeight - b.top + GAP);
    el.style.setProperty("--mm-ws-bottom", `${Math.round(bottom)}px`);
  }
}

let app = null;
let lastSig = "";
let current = { section: null, tool: "" };   // what the engines see

/** The workspace tool in hand ("" while no section is open). Tool names are unique across sections. */
export const workspaceTool = () => current.tool;

/** Tell the engines that the tool in hand changed (the section's own hook first, then everyone through "moinenMapsTool"). */
function apply(section, tool) {
  if ( section === current.section && tool === current.tool ) return false;
  const prev = current;
  current = { section, tool };
  try { prev.section?.onToolChange?.(prev.tool, false); section?.onToolChange?.(tool, true); }
  catch ( err ) { console.error(`${MODULE_ID} | workspace tool`, err); }
  Hooks.callAll("moinenMapsTool", tool, prev.tool, section?.id ?? null);
  return true;
}

/** Show, update or hide the workspace to match the scene controls. Cheap to call often (every controls render and tool change). */
export function syncWorkspace() {
  const s = game.user?.isGM && canvas?.ready ? activeSection() : null;
  if ( !s ) {
    lastSig = "";
    apply(null, "");
    if ( app?.rendered ) app.close({ animate: false });
    document.body.classList.remove("mm-ws-on");
    return;
  }
  app ??= new Workspace();
  document.body.classList.add("mm-ws-on");
  const tool = resolveTool(s);
  apply(s, tool);
  const sig = `${s.id}|${game.i18n.lang}`;
  if ( !app.rendered || sig !== lastSig || app.section !== s ) {
    lastSig = sig; app.section = s; app.tool = tool;
    app.render({ force: true });
  } else if ( tool !== app.tool ) { app.tool = tool; app.refreshBar(); }
}

/**
 * Pick a tool of a section, opening the section first when needed (the palette's pins, the water panel's "draw rods" button).
 * @param {string} sectionId
 * @param {string} tool
 */
export async function useTool(sectionId, tool) {
  const s = sectionById(sectionId); if ( !s ) return;
  await saveState({ tools: { ...getState().tools, [s.id]: tool } });
  if ( activeSection() !== s ) await ui.controls.activate({ control: GROUP, tool: sectionTool(s) });
  syncWorkspace();
}

/** The open workspace (or null), e.g. to reveal a panel from a section's own code. */
export const workspace = () => app?.rendered ? app : null;
