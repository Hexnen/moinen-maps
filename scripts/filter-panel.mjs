import { MODULE_ID, sceneConfig, allPresets, findPinType, typeLabel, pinTypeOf } from "./config.mjs";
import { NOTE_CAT, categoryOf, hiddenIds, setHidden } from "./filter.mjs";
import { thumb } from "./presets.mjs";

/**
 * The floating pin filter: a small draggable legend on scenes where pins are on, listing the kinds of pins the user can see with a
 * count each. Click a row to hide or show that kind (Ctrl/Shift-click shows only that kind). Purely client-side.
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

/** The categories the user currently sees on this scene, in preset order, with counts. */
function collect() {
  const scene = canvas.scene;
  if ( !canvas.ready || !scene || !sceneConfig(scene).enabled ) return null;
  const counts = new Map();
  for ( const note of canvas.notes.placeables ) {
    if ( !note.isVisible ) continue;
    const id = categoryOf(note.document);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if ( !counts.size ) return null;
  const order = allPresets().flatMap((p) => p.types.map((t) => t.id)).concat(NOTE_CAT);
  const rank = (id) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
  return [...counts].sort((a, b) => rank(a[0]) - rank(b[0])).map(([id, n]) => ({ id, n }));
}

function describe(id, scene) {
  if ( id === NOTE_CAT ) return { label: T("Filter.notes"), img: thumb("book", sceneConfig(scene).color) };
  const t = findPinType(id) ?? pinTypeOf({ flags: { [MODULE_ID]: { pin: id } } });
  return { label: typeLabel(t), img: thumb(t.glyph, t.color) };
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

export function refreshPanel() {
  const cats = game.settings.get(MODULE_ID, "pinPanel") ? collect() : null;
  if ( !cats ) return removePanel();
  const scene = canvas.scene, hidden = hiddenIds(scene.id), collapsed = !!getState().collapsed;
  const next = JSON.stringify([scene.id, cats, [...hidden], collapsed, game.i18n.lang]);
  if ( el && next === sig ) return;
  sig = next;
  const total = cats.reduce((a, c) => a + c.n, 0), shown = cats.reduce((a, c) => a + (hidden.has(c.id) ? 0 : c.n), 0);
  const rows = cats.map((c) => {
    const d = describe(c.id, scene), off = hidden.has(c.id);
    return `<li><button type="button" class="mm-filter-row${off ? " is-off" : ""}" role="switch" aria-checked="${!off}" data-id="${esc(c.id)}">
      <img src="${d.img}" alt="" inert><span class="mm-filter-label">${esc(d.label)}</span><span class="mm-filter-n">${c.n}</span>
      <i class="fa-solid ${off ? "fa-eye-slash" : "fa-eye"}" inert></i></button></li>`;
  }).join("");
  const fresh = !el;
  if ( fresh ) {
    el = document.createElement("aside");
    el.id = "mm-filter"; el.className = "mm-filter"; el.setAttribute("aria-label", T("Filter.title"));
    document.body.append(el);
    el.addEventListener("click", onClick);
    el.addEventListener("pointerdown", onDragStart);
  }
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
  place();
}

async function onClick(ev) {
  const b = ev.target.closest("button"); if ( !b ) return;
  const scene = canvas.scene, cats = collect() ?? [], all = cats.map((c) => c.id);
  if ( b.dataset.act === "collapse" ) { await saveState({ collapsed: !getState().collapsed }); return refreshPanel(); }
  if ( b.dataset.act === "close" ) { await game.settings.set(MODULE_ID, "pinPanel", false); return ui.notifications.info(T("Filter.closed")); }
  if ( b.dataset.act === "all" ) return setHidden(scene.id, new Set());
  if ( b.dataset.act === "none" ) return setHidden(scene.id, new Set(all));
  const id = b.dataset.id; if ( !id ) return;
  const hidden = hiddenIds(scene.id);
  if ( ev.ctrlKey || ev.shiftKey || ev.metaKey ) {
    const only = all.length > 1 && all.every((x) => x === id || hidden.has(x)) && !hidden.has(id);
    return setHidden(scene.id, only ? new Set() : new Set(all.filter((x) => x !== id)));
  }
  hidden.has(id) ? hidden.delete(id) : hidden.add(id);
  return setHidden(scene.id, hidden);
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
