import { MODULE_ID } from "./config.mjs";
import { LAYERS, WARN, want, onSample, lastSample, sample, registerVramSettings } from "./vram.mjs";

/**
 * The VRAM meter: a small draggable card over the canvas, per client (vram.mjs counts, this shows).
 *  - folded: "VRAM 2.3 / 8 GB" and a bar split by layer, with a tick where the warning starts; amber from 75 % of the budget,
 *    red from 90 %;
 *  - open: the layers (size, textures), what is counted and what is estimated, the budget and where it comes from (card model,
 *    shared memory, set by the user), a field to set it, lost WebGL contexts.
 * Setting "vramMeter": auto (the GM always, players only while it warns), always, warn (everyone only while it warns), off.
 * Samples are taken at idle every 3 s while the card is on screen (2 s open, 5 s while it waits to warn); never per frame.
 */

const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const F = (k, d) => game.i18n.format(`MOINENMAPS.${k}`, d);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const MARGIN = 8;
const ROWS = [...LAYERS, "buffers", "canvas"];
const GB = 1024 ** 3;

let el = null, release = null, offSample = null, shownByWarn = false, sigStatic = "";

const getState = () => { try { return game.settings.get(MODULE_ID, "vramMeterState") ?? {}; } catch { return {}; } };
const saveState = (patch) => { try { return game.settings.set(MODULE_ID, "vramMeterState", { ...getState(), ...patch }); } catch { return null; } };
const mode = () => { try { return game.settings.get(MODULE_ID, "vramMeter"); } catch { return "off"; } };

/** "2.3 GB" / "640 MB" in the user's language (the number formats are made once per language). */
let nf = null;
function fmt() {
  const lang = game.i18n.lang;
  if ( nf?.lang !== lang ) {
    const mk = (d) => new Intl.NumberFormat(lang, { maximumFractionDigits: d, minimumFractionDigits: d });
    nf = { lang, f0: mk(0), f1: mk(1), g: new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }) };
  }
  return nf;
}
function size(b) {
  const f = fmt();
  if ( b >= GB ) return `${(b >= 10 * GB ? f.f0 : f.f1).format(b / GB)} GB`;
  return `${f.f0.format(Math.round(b / 1048576))} MB`;
}
const gbOf = (b) => fmt().g.format(b / GB);

/** Show, hide or re-time the meter to match the setting and the last sample. */
function sync() {
  const m = mode();
  if ( m === "off" || !canvas?.ready ) return hide(true);
  const always = m === "always" || (m === "auto" && game.user?.isGM);
  // waiting to warn: sample slowly, show on the first warning, hide again a little below it
  offSample ??= onSample(onSampled);
  if ( always ) return show();
  const s = lastSample();
  if ( s && (s.ratio >= WARN || (shownByWarn && s.ratio >= WARN - 0.05)) ) { shownByWarn = true; return show(); }
  shownByWarn = false;
  hide(false);
  release?.(); release = want("meter", 5000);
}

function show() {
  const fresh = !el;
  if ( fresh ) {
    el = document.createElement("aside");
    el.id = "mm-vram"; el.className = "mm-vram";
    document.body.append(el);
    el.addEventListener("click", onClick);
    el.addEventListener("change", onChange);
    el.addEventListener("pointerdown", onDragStart);
  }
  const open = !!getState().open;
  release?.(); release = want("meter", open ? 2000 : 3000);
  if ( fresh || el.dataset.lang !== game.i18n.lang ) build();
  const s = lastSample() ?? sample();
  if ( s ) update(s);
  place();
}

function hide(stop) {
  el?.remove(); el = null; sigStatic = "";
  if ( stop ) { release?.(); release = null; offSample?.(); offSample = null; shownByWarn = false; }
}

/** The fixed markup (rebuilt on open/fold and language change); the numbers are written by update(). */
function build() {
  const open = !!getState().open;
  el.dataset.lang = game.i18n.lang;
  el.classList.toggle("is-open", open);
  el.setAttribute("aria-label", T("Vram.title"));
  const rows = ROWS.map((k) => `<li class="mm-vram-row" data-layer="${k}"><i class="mm-vram-sw" inert></i><span class="mm-vram-name">${esc(T(`Vram.layer.${k}`))}</span>
    <span class="mm-vram-mb"></span><span class="mm-vram-n"></span></li>`).join("");
  el.innerHTML = `<header class="mm-vram-head">
      <i class="fa-solid fa-memory" inert></i><span class="mm-vram-title">${esc(T("Vram.short"))}</span>
      <span class="mm-vram-val"></span>
      <button type="button" data-act="open" aria-expanded="${open}" aria-controls="mm-vram-body" aria-label="${esc(T(open ? "Vram.fold" : "Vram.unfold"))}" data-tooltip="${esc(T(open ? "Vram.fold" : "Vram.unfold"))}"><i class="fa-solid ${open ? "fa-chevron-up" : "fa-chevron-down"}" inert></i></button>
    </header>
    <div class="mm-vram-bar" role="meter" aria-label="${esc(T("Vram.title"))}" aria-valuemin="0" aria-valuemax="100">${ROWS.map((k) => `<i data-layer="${k}"></i>`).join("")}<b class="mm-vram-tick" style="left:${WARN * 100}%" inert></b></div>
    <div class="mm-vram-body" id="mm-vram-body"${open ? "" : " hidden"}>
      <ul class="mm-vram-rows">${rows}</ul>
      <p class="mm-vram-sum"></p>
      <div class="mm-vram-budget"><label for="mm-vram-gb">${esc(T("Vram.budget"))}</label>
        <span class="mm-vram-gbin"><input id="mm-vram-gb" type="number" name="budget" min="0" max="64" step="0.5" inputmode="decimal"> GB</span>
        <button type="button" data-act="auto" data-tooltip="${esc(T("Vram.autoHint"))}">${esc(T("Vram.auto"))}</button></div>
      <p class="mm-vram-src"></p>
      <p class="mm-vram-lost" hidden></p>
      <p class="mm-vram-hint">${esc(T("Vram.hint"))}</p>
    </div>`;
  sigStatic = "";
}

/** Write a sample's numbers into the card (text only; nothing is rebuilt). */
function update(s) {
  if ( !el ) return;
  const b = s.budget.bytes || 1, pct = Math.round(s.ratio * 100);
  el.dataset.level = s.level;
  el.querySelector(".mm-vram-val").textContent = `${size(s.total)} / ${gbOf(s.budget.bytes)} GB`;
  el.querySelector(".mm-vram-head").dataset.tooltip = F(`Vram.level.${s.level}`, { pct });
  const bar = el.querySelector(".mm-vram-bar");
  bar.setAttribute("aria-valuenow", String(Math.min(100, pct)));
  bar.setAttribute("aria-valuetext", F("Vram.valueText", { used: size(s.total), budget: `${gbOf(s.budget.bytes)} GB`, pct }));
  for ( const k of ROWS ) bar.querySelector(`[data-layer="${k}"]`).style.width = `${Math.min(100, (s.layers[k]?.bytes ?? 0) / b * 100).toFixed(2)}%`;
  if ( !getState().open ) return;
  for ( const k of ROWS ) {
    const row = el.querySelector(`.mm-vram-row[data-layer="${k}"]`), L = s.layers[k] ?? { bytes: 0, n: 0 };
    row.querySelector(".mm-vram-mb").textContent = size(L.bytes);
    row.querySelector(".mm-vram-n").textContent = k === "canvas" ? T("Vram.est") : k === "buffers" ? "" : String(L.n);
    row.classList.toggle("is-empty", !L.bytes);
  }
  el.querySelector(".mm-vram-sum").textContent = F("Vram.sum", { counted: size(s.counted), est: size(s.estimated), n: fmt().f0.format(s.textures), peak: size(s.peak) });
  const B = s.budget;
  const src = B.source === "manual" ? T("Vram.src.manual") : B.source === "table" ? F(B.alt ? "Vram.src.tableAlt" : "Vram.src.table", { model: B.model, alt: B.alt })
    : B.source === "shared" ? F("Vram.src.shared", { model: B.model }) : F("Vram.src.unknown", { model: B.model || T("Vram.masked") });
  const sig = `${B.source}|${src}|${B.bytes}`;
  if ( sig !== sigStatic ) {
    sigStatic = sig;
    el.querySelector(".mm-vram-src").textContent = src;
    const inp = el.querySelector('input[name="budget"]');
    if ( document.activeElement !== inp ) inp.value = String(+(B.bytes / GB).toFixed(1));
    el.querySelector('[data-act="auto"]').disabled = B.source !== "manual";
  }
  const lost = el.querySelector(".mm-vram-lost");
  lost.hidden = !s.contextLost;
  if ( s.contextLost ) lost.textContent = F("Vram.lost", { n: s.contextLost });
}

function onSampled(s) {
  const m = mode();
  if ( m === "warn" || (m === "auto" && !game.user?.isGM) ) {
    const should = s.ratio >= WARN || (shownByWarn && s.ratio >= WARN - 0.05);
    if ( should !== !!el ) return sync();
  }
  update(s);
}

async function onClick(ev) {
  const b = ev.target.closest("button[data-act]"); if ( !b ) return;
  if ( b.dataset.act === "open" ) {
    const st = getState();
    if ( Number.isFinite(st.x) && !("bottom" in st) ) await remember();   // anchor a dragged card before it changes height
    await saveState({ open: !getState().open });
    build(); show();
    el?.querySelector('[data-act="open"]')?.focus();
  }
  if ( b.dataset.act === "auto" ) await game.settings.set(MODULE_ID, "vramBudget", 0);
}

async function onChange(ev) {
  if ( ev.target.name !== "budget" ) return;
  const v = Math.max(0, Math.min(64, Number(ev.target.value) || 0));
  await game.settings.set(MODULE_ID, "vramBudget", v);
}

/* ---------------------------------------------------------------- place and drag (like the pin filter) */

function clamp(left, top) {
  const w = el?.offsetWidth ?? 200, h = el?.offsetHeight ?? 50;
  return [Math.max(MARGIN, Math.min(left, innerWidth - w - MARGIN)), Math.max(MARGIN, Math.min(top, innerHeight - h - MARGIN))];
}
/**
 * The card's place: where the user dragged it, else low on the left just above the players list. It grows and shrinks from its
 * bottom edge when it sits in the lower half of the screen (opening the details never pushes it under the players list), else from
 * its top edge.
 */
function place() {
  if ( !el ) return;
  const s = getState(), h = el.offsetHeight;
  let x = s.x, y = s.y;
  if ( !Number.isFinite(x) || !Number.isFinite(y) ) {
    const p = document.getElementById("players")?.getBoundingClientRect();
    x = p?.width ? p.left : 16;
    y = (p?.height ? p.top : innerHeight - 120) - MARGIN - h;
  } else if ( Number.isFinite(s.bottom) ) y = innerHeight - s.bottom - h;
  [x, y] = clamp(x, y);
  el.style.left = `${x}px`; el.style.top = `${y}px`;
}

/** Remember where the card is; `bottom` (distance of its bottom edge to the screen's) when it sits in the lower half. */
function remember() {
  if ( !el ) return;
  const r = el.getBoundingClientRect(), low = r.top + r.height / 2 > innerHeight / 2;
  return saveState({ x: Math.round(r.left), y: Math.round(r.top), bottom: low ? Math.round(innerHeight - r.bottom) : null });
}

function onDragStart(ev) {
  const head = ev.target.closest(".mm-vram-head");
  if ( !head || ev.target.closest("button") || ev.button !== 0 ) return;
  ev.preventDefault();
  const r = el.getBoundingClientRect(), dx = ev.clientX - r.left, dy = ev.clientY - r.top;
  head.setPointerCapture(ev.pointerId);
  const move = (e) => { const [x, y] = clamp(e.clientX - dx, e.clientY - dy); el.style.left = `${x}px`; el.style.top = `${y}px`; };
  const up = () => {
    head.removeEventListener("pointermove", move); head.removeEventListener("pointerup", up); head.removeEventListener("pointercancel", up);
    remember();
  };
  head.addEventListener("pointermove", move); head.addEventListener("pointerup", up); head.addEventListener("pointercancel", up);
}

window.addEventListener("resize", () => place());
Hooks.once("init", () => registerVramSettings());
Hooks.on("canvasReady", () => sync());
Hooks.on("moinenMapsVram", () => { if ( el ) { build(); sigStatic = ""; } sync(); });
