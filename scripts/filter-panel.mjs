import { MODULE_ID, sceneConfig, allPresets, findPinType, typeLabel, pinTypeOf } from "./config.mjs";
import { NOTE_CAT, categoryOf, hiddenState, setHidden } from "./filter.mjs";
import { thumb } from "./presets.mjs";

/**
 * The floating pin filter: a small draggable legend on scenes where pins are on. Pins are grouped by type; a group's eye hides or shows
 * the whole type, its arrow unfolds the list of that type's pins, and each pin can be hidden on its own (or panned to). Client-side only.
 */

const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const MARGIN = 8;

let el = null, sig = "", raf = 0;

/** Redraw soon (many notes refresh in one frame). */
export function schedulePanel() {
  if ( raf ) return;
  raf = requestAnimationFrame(() => { raf = 0; refreshPanel(); });
}

export function removePanel() { el?.remove(); el = null; sig = ""; }

const typeOfCat = (id) => findPinType(id) ?? pinTypeOf({ flags: { [MODULE_ID]: { pin: id } } });

/** The pins the user currently sees, grouped by type in preset order: [{ id, pins: [{ id, label, x, y }] }]. */
function collect() {
  const scene = canvas.scene;
  if ( !canvas.ready || !scene || !sceneConfig(scene).enabled ) return null;
  const by = new Map();
  for ( const note of canvas.notes.placeables ) {
    if ( !note.isVisible ) continue;
    const d = note.document, id = categoryOf(d);
    (by.get(id) ?? by.set(id, []).get(id)).push(d);
  }
  if ( !by.size ) return null;
  const order = allPresets().flatMap((p) => p.types.map((t) => t.id)).concat(NOTE_CAT);
  const rank = (id) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
  return [...by].sort((a, b) => rank(a[0]) - rank(b[0])).map(([id, docs]) => {
    const base = id === NOTE_CAT ? T("Filter.notes") : typeLabel(typeOfCat(id));
    const pins = docs.map((d, i) => ({ id: d.id, x: d.x, y: d.y, label: (d.text || d.entry?.name || "").trim() || game.i18n.format("MOINENMAPS.Filter.pinN", { type: base, n: i + 1 }) }));
    return { id, label: base, pins };
  });
}

const getState = () => game.settings.get(MODULE_ID, "pinPanelState") ?? {};
const saveState = (patch) => game.settings.set(MODULE_ID, "pinPanelState", { ...getState(), ...patch });

function clamp(left, top) {
  const w = el?.offsetWidth ?? 200, h = el?.offsetHeight ?? 60;
  return [Math.max(MARGIN, Math.min(left, innerWidth - w - MARGIN)), Math.max(MARGIN, Math.min(top, innerHeight - h - MARGIN))];
}
function place() {
  if ( !el ) return;
  const s = getState();
  const [x, y] = clamp(s.x ?? 96, s.y ?? 92);
  el.style.left = `${x}px`; el.style.top = `${y}px`;
}

const eyeIcon = (state) => state === "true" ? "fa-eye" : state === "false" ? "fa-eye-slash" : "fa-circle-half-stroke";

export function refreshPanel() {
  const groups = game.settings.get(MODULE_ID, "pinPanel") ? collect() : null;
  if ( !groups ) return removePanel();
  const scene = canvas.scene, hs = hiddenState(scene.id), st = getState(), collapsed = !!st.collapsed, open = st.open ?? {};
  const isOff = (g, p) => hs.t.has(g.id) || hs.n.has(p.id);
  const next = JSON.stringify([scene.id, groups, [...hs.t], [...hs.n], collapsed, open, game.i18n.lang]);
  if ( el && next === sig ) return;
  sig = next;
  const total = groups.reduce((a, g) => a + g.pins.length, 0);
  const shown = groups.reduce((a, g) => a + g.pins.filter((p) => !isOff(g, p)).length, 0);
  const rows = groups.map((g) => {
    const off = g.pins.filter((p) => isOff(g, p)).length, state = off === 0 ? "true" : off === g.pins.length ? "false" : "mixed";
    const t = g.id === NOTE_CAT ? null : typeOfCat(g.id);
    const img = t ? thumb(t.glyph, t.color) : thumb("book", sceneConfig(scene).color);
    const isOpen = !!open[g.id];
    const pins = isOpen ? `<ul class="mm-filter-pins" id="mm-fg-${esc(g.id)}">${g.pins.map((p) => {
      const po = isOff(g, p);
      return `<li class="mm-filter-pin${po ? " is-off" : ""}"><button type="button" class="mm-filter-pinrow" role="switch" aria-checked="${!po}" data-pin="${esc(p.id)}" data-group="${esc(g.id)}">
        <span class="mm-filter-label">${esc(p.label)}</span><i class="fa-solid ${po ? "fa-eye-slash" : "fa-eye"}" inert></i></button>
        <button type="button" class="mm-filter-go" data-go="${esc(p.id)}" aria-label="${esc(T("Filter.locate"))}" data-tooltip="${esc(T("Filter.locate"))}"><i class="fa-solid fa-crosshairs" inert></i></button></li>`;
    }).join("")}</ul>` : "";
    return `<li class="mm-filter-group${state === "false" ? " is-off" : ""}">
      <div class="mm-filter-grouprow">
        <button type="button" class="mm-filter-fold" data-fold="${esc(g.id)}" aria-expanded="${isOpen}" ${isOpen ? `aria-controls="mm-fg-${esc(g.id)}"` : ""} aria-label="${esc(T(isOpen ? "Filter.foldClose" : "Filter.foldOpen"))}: ${esc(g.label)}"><i class="fa-solid ${isOpen ? "fa-chevron-down" : "fa-chevron-right"}" inert></i></button>
        <button type="button" class="mm-filter-row" role="switch" aria-checked="${state}" data-group="${esc(g.id)}" data-tooltip="${esc(T("Filter.hint"))}">
          <img src="${img}" alt="" inert><span class="mm-filter-label">${esc(g.label)}</span>
          <span class="mm-filter-n">${state === "mixed" ? `${g.pins.length - off}/${g.pins.length}` : g.pins.length}</span><i class="fa-solid ${eyeIcon(state)}" inert></i></button>
      </div>${pins}</li>`;
  }).join("");
  const fresh = !el;
  if ( fresh ) {
    el = document.createElement("aside");
    el.id = "mm-filter"; el.className = "mm-filter"; el.setAttribute("aria-label", T("Filter.title"));
    document.body.append(el);
    el.addEventListener("click", onClick);
    el.addEventListener("pointerdown", onDragStart);
  }
  const keep = el.querySelector(".mm-filter-list")?.scrollTop ?? 0;
  el.classList.toggle("is-collapsed", collapsed);
  el.innerHTML = `<header class="mm-filter-head">
      <i class="fa-solid fa-location-dot" inert></i><span class="mm-filter-title">${esc(T("Filter.title"))}</span>
      <span class="mm-filter-count" aria-label="${esc(game.i18n.format("MOINENMAPS.Filter.shown", { n: shown, total }))}">${shown}/${total}</span>
      <button type="button" data-act="collapse" aria-expanded="${!collapsed}" aria-label="${esc(T(collapsed ? "Filter.expand" : "Filter.collapse"))}" data-tooltip="${esc(T(collapsed ? "Filter.expand" : "Filter.collapse"))}"><i class="fa-solid ${collapsed ? "fa-chevron-down" : "fa-chevron-up"}" inert></i></button>
      <button type="button" data-act="close" aria-label="${esc(T("Filter.close"))}" data-tooltip="${esc(T("Filter.close"))}"><i class="fa-solid fa-xmark" inert></i></button>
    </header>
    <div class="mm-filter-body"${collapsed ? " hidden" : ""}>
      <div class="mm-filter-tools"><button type="button" data-act="all">${esc(T("Filter.showAll"))}</button><button type="button" data-act="none">${esc(T("Filter.hideAll"))}</button></div>
      <ul class="mm-filter-list">${rows}</ul>
      <p class="mm-filter-hint">${esc(T("Filter.hint"))}</p>
    </div>`;
  const list = el.querySelector(".mm-filter-list"); if ( list ) list.scrollTop = keep;
  place();
}

async function onClick(ev) {
  const b = ev.target.closest("button"); if ( !b ) return;
  const scene = canvas.scene, groups = collect() ?? [], hs = hiddenState(scene.id);
  const allIds = groups.map((g) => g.id), find = (id) => groups.find((g) => g.id === id);
  if ( b.dataset.act === "collapse" ) { await saveState({ collapsed: !getState().collapsed }); return refreshPanel(); }
  if ( b.dataset.act === "close" ) { await game.settings.set(MODULE_ID, "pinPanel", false); return ui.notifications.info(T("Filter.closed")); }
  if ( b.dataset.act === "all" ) return setHidden(scene.id, { t: new Set(), n: new Set() });
  if ( b.dataset.act === "none" ) return setHidden(scene.id, { t: new Set(allIds), n: hs.n });
  if ( b.dataset.fold ) { const open = { ...(getState().open ?? {}) }; open[b.dataset.fold] = !open[b.dataset.fold]; await saveState({ open }); return refreshPanel(); }
  if ( b.dataset.go ) {
    const d = scene.notes.get(b.dataset.go); if ( !d ) return;
    return canvas.animatePan({ x: d.x, y: d.y, duration: 400 });
  }
  if ( b.dataset.pin ) {
    // a single pin. Showing one inside a hidden type unfolds the type: the others stay hidden one by one
    const g = find(b.dataset.group), id = b.dataset.pin;
    if ( !g ) return;
    if ( hs.t.has(g.id) ) { hs.t.delete(g.id); for ( const p of g.pins ) if ( p.id !== id ) hs.n.add(p.id); hs.n.delete(id); }
    else hs.n.has(id) ? hs.n.delete(id) : hs.n.add(id);
    return setHidden(scene.id, hs);
  }
  if ( b.dataset.group ) {
    const g = find(b.dataset.group); if ( !g ) return;
    const mineIds = new Set(g.pins.map((p) => p.id));
    if ( ev.ctrlKey || ev.shiftKey || ev.metaKey ) {     // show only this type
      const alone = allIds.length > 1 && allIds.every((x) => x === g.id || hs.t.has(x)) && !hs.t.has(g.id);
      for ( const x of mineIds ) hs.n.delete(x);
      return setHidden(scene.id, { t: alone ? new Set() : new Set(allIds.filter((x) => x !== g.id)), n: hs.n });
    }
    const allShown = !hs.t.has(g.id) && g.pins.every((p) => !hs.n.has(p.id));
    if ( allShown ) hs.t.add(g.id); else { hs.t.delete(g.id); for ( const x of mineIds ) hs.n.delete(x); }
    return setHidden(scene.id, hs);
  }
}

/** Drag by the header; the position is remembered per user. */
function onDragStart(ev) {
  const head = ev.target.closest(".mm-filter-head");
  if ( !head || ev.target.closest("button") || ev.button !== 0 ) return;
  ev.preventDefault();
  const r = el.getBoundingClientRect(), dx = ev.clientX - r.left, dy = ev.clientY - r.top;
  head.setPointerCapture(ev.pointerId);
  const move = (e) => { const [x, y] = clamp(e.clientX - dx, e.clientY - dy); el.style.left = `${x}px`; el.style.top = `${y}px`; };
  const up = () => {
    head.removeEventListener("pointermove", move); head.removeEventListener("pointerup", up); head.removeEventListener("pointercancel", up);
    saveState({ x: Math.round(parseFloat(el.style.left)), y: Math.round(parseFloat(el.style.top)) });
  };
  head.addEventListener("pointermove", move); head.addEventListener("pointerup", up); head.addEventListener("pointercancel", up);
}

window.addEventListener("resize", () => place());
