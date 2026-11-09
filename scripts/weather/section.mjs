import { registerSection } from "../workspace/registry.mjs";
import { esc, T, optRange, optSelect, optCheck, optHint, isEcho, writeControl, bindSettings, onSetting, setting } from "../workspace/ui.mjs";
import { MODULE_ID } from "../config.mjs";
import * as M from "./model.mjs";
import * as TM from "./tornado-model.mjs";
import * as Wx from "./weather.mjs";
import { VIEW_PRESETS } from "../view-angle.mjs";
import { sharedNow } from "../shared-clock.mjs";

/**
 * THE WEATHER SECTION of the Moinen Maps workspace (GM):
 *  - tools: the pointer (the map as usual), the WIND ARROW (drag on the map: the wind blows along the arrow, its length is the
 *    strength; a pixel arrow shows while you drag) and the TORNADO (click: one that stays and wanders there; drag: its path - it
 *    travels along it with the dock's level, speed and end);
 *  - bar: the presets (Clear / Rain / ...: quick sets at the current preset strength), a STRENGTH SLIDER per weather type (Rain,
 *    Snow, Sand, Dust, Embers, Wind, Clouds: 0 off, 1 light, 2 medium, 3 heavy, above 3 overdrive; each writes one key when let go
 *    and shows the live value while the weather ramps), the clouds' look (clouds with shadows or shadows only; godrays), the wind
 *    (eight directions + strength), how long a change takes ("over N s"), the lightning, the lens on / off and its strength (Auto or
 *    fixed). Keys while the section is open: 0-3 the current preset's strength, [ ] nudge the last-touched slider by 0.25;
 *  - dock: Weather (status, on / off, who sees it, each layer's strength), Wind (direction, strength, gusts), Tornadoes (the
 *    next one's strength / speed / end, the list with each one's strength slider and rope-out, rope out all), Ground (how fast it
 *    wets and dries, puddles, whether rain puts fire out), Lens (on, Auto / fixed strength, how much shows), View (the oblique
 *    angle, shared with fire), This client (detail and lens caps: the same settings every player has in Configure Settings).
 * Every change is one key on the timeline (one scene write); every client ramps to it from the shared clock.
 */
const DIRS = [270, 315, 0, 45, 90, 135, 180, 225];
const PRESET_COLOR = { clear: "#f2c14e", rain: "#4f9de0", snow: "#e8f1fb", sand: "#d9a55b", dust: "#e6d3a3", embers: "#f07a2a", wind: "#9fd38a", storm: "#5b7fa8", blizzard: "#cfe3f5", clouds: "#c9d6e3" };
const TOOLS = { "mm-wx-pick": null, "mm-wx-wind": "wind", "mm-wx-tornado": "tornado" };
// the strength sliders: 0 (off) .. 1 light / 2 medium / 3 heavy .. M.V_MAX (overdrive); [ ] nudge by NUDGE
const V_STEP = 0.05, NUDGE = 0.25;

const over = () => Math.max(0, Number(setting("weatherOver")) || 0) * 1000;
const cur = () => M.current(Wx.params0());
const curPreset = () => cur()?.preset ?? "clear";
const curWind = () => cur()?.wind ?? { dir: 0, str: 0, gust: 0.5 };
/** { preset, level, target: { eff: v }, live: { eff: v }, steady, until } (the world's, no client cap: the GM sets the world). */
const strengths = () => M.strengthsOf(Wx.params0(), sharedNow());
/** A strength for people: at most 2 decimals, in the client's language (2,4 in Polish). */
const fmt = (v) => (Math.round((Number(v) || 0) * 100) / 100).toLocaleString(game.i18n.lang || undefined, { maximumFractionDigits: 2 });
/** A live value worth showing next to its target (a ramp is running and has not arrived). */
const moving = (live, target) => Math.abs((live ?? 0) - (target ?? 0)) > 0.005;
/**
 * Show where the weather is NOW on a strength row while it ramps to the slider's value: the value under the name and a marker on the
 * track (styles: .mm-wx-moving, --mm-livef). Nothing while it has arrived. Returns whether it is still moving.
 */
function showLive(row, live, target) {
  if ( !row ) return false;
  const go = moving(live, target), s = row.querySelector("[data-wx-live]");
  const txt = go ? game.i18n.format("MOINENMAPS.Weather.liveNow", { v: fmt(live) }) : "";
  if ( s && s.textContent !== txt ) s.textContent = txt;
  row.classList.toggle("mm-wx-moving", go);
  if ( go ) {
    const st = getComputedStyle(row), lo = Number(st.getPropertyValue("--mm-vmin")) || 0, hi = Number(st.getPropertyValue("--mm-vmax")) || M.V_MAX;
    row.style.setProperty("--mm-livef", String(Math.min(1, Math.max(0, ((live ?? 0) - lo) / (hi - lo)))));
  }
  return go;
}

function btnRow(label, attr, vals, isOn, name, hint, color, icon = null) {
  const b = (v) => `<button type="button" class="mm-ws-toolbtn mm-d-level" data-${attr}="${v}" aria-pressed="${isOn(v)}" style="--mm-tool:${color(v)}" data-tooltip="${esc(hint(v))}">${icon ? `<i class="${icon(v)}" inert></i>` : `<span class="mm-d-dot" inert></span>`}<span>${esc(name(v))}</span></button>`;
  return `<div class="mm-ws-opt"><span class="mm-ws-label">${esc(T(label))}</span><div class="mm-ws-tools mm-d-levels" role="group" aria-label="${esc(T(label))}">${vals.map(b).join("")}</div></div>`;
}

// the presets: QUICK SETS (a click puts the preset's effects at the current preset strength; pressed = these effects are on)
const presetRow = () => btnRow("Weather.preset", "wx-preset", Object.keys(M.PRESETS), (v) => v === curPreset(), (v) => T(`Weather.p.${v}`), (v) => T(`Weather.ph.${v}`), (v) => PRESET_COLOR[v] ?? "#ccc", (v) => M.PRESET_ICONS[v]);
const dirOn = (w, d) => w.str > 0 && Math.abs(((w.dir - d + 540) % 360) - 180) < 1;
const dirRow = () => {
  const w = curWind();
  return `<div class="mm-ws-opt"><span class="mm-ws-label">${esc(T("Weather.windDir"))}</span><div class="mm-ws-tools" role="group" aria-label="${esc(T("Weather.windDir"))}">${DIRS.map((d) => `<button type="button" class="mm-ws-toolbtn" data-wx-dir="${d}" aria-pressed="${dirOn(w, d)}" aria-label="${esc(T(`Fire.dir.${d}`))}" data-tooltip="${esc(T(`Fire.dir.${d}`))}"><i class="fa-solid fa-arrow-right fa-rotate-by" style="--fa-rotate-angle:${d}deg" inert></i></button>`).join("")}</div></div>`;
};

/**
 * A STRENGTH SLIDER: the workspace's optRange row (a <range-picker> in an mm-ws-opt) whose label is the type's icon in its colour;
 * the slider carries tick marks at the whole levels and the overdrive band above 3 (styles: .mm-wx-str, --mm-vmax), and a live
 * value while a ramp runs. `extra` = markup after the slider (the clouds' look buttons).
 */
let sid = 0;
function strRow(e, v, { name = `wx.v.${e}`, min = 0, max = M.V_MAX, step = V_STEP, last = false, label = T(`Weather.fx.${e}`), hint, extra = "", color = PRESET_COLOR[e], icon = M.PRESET_ICONS[e] } = {}) {
  const id = `mm-ws-wxv-${e}-${++sid}`;
  return `<div class="mm-ws-opt mm-ws-range mm-wx-str${v > 0 ? "" : " mm-wx-off"}${last ? " mm-wx-last" : ""}" data-wx-str="${e}" style="--mm-tool:${color};--mm-vmin:${min};--mm-vmax:${max}">`
    + `<label for="${id}" data-tooltip="${esc(hint ?? game.i18n.format("MOINENMAPS.Weather.strHint", { what: T(`Weather.sh.${e}`) }))}"><i class="${icon}" inert></i><span>${esc(label)}</span><span class="mm-wx-live" data-wx-live="${e}"></span></label>`
    + `<range-picker id="${id}" name="${esc(name)}" value="${Number(v)}" min="${min}" max="${max}" step="${step}"></range-picker>${extra}</div>`;
}

// the clouds' look: bodies + shadows or shadows only, godrays (after the Clouds slider)
const cloudLook = () => {
  const C = Wx.params0().clouds, b = (attr, on, icon, label, hint) => `<button type="button" class="mm-ws-toolbtn" data-${attr} aria-pressed="${on}" aria-label="${esc(T(label))}" data-tooltip="${esc(T(hint))}"><i class="${icon}" inert></i></button>`;
  return `<div class="mm-ws-tools" role="group" aria-label="${esc(T("Weather.cloudLook"))}">${b("wx-cmode=\"sky\"", C.mode === "sky", "fa-solid fa-cloud-sun", "Weather.cm.sky", "Weather.cmh.sky")}${b("wx-cmode=\"shadows\"", C.mode === "shadows", "fa-solid fa-circle-half-stroke", "Weather.cm.shadows", "Weather.cmh.shadows")}${b("wx-rays", C.rays, "fa-solid fa-sun-bright", "Weather.rays", "Weather.raysHint")}</div>`;
};
const strRows = (last) => {
  const S = strengths();
  return `<div class="mm-wx-strs" role="group" aria-label="${esc(T("Weather.strength"))}">${M.EFFECTS.map((e) => strRow(e, S.target[e] ?? 0, { last: e === last, extra: e === "clouds" ? cloudLook() : "" })).join("")}</div>`;
};

// the rain's lightning: on / off in the bar (its settings in the dock's Lightning panel)
const stormOn = () => !!Wx.params0().storm?.on;
const stormRow = () => `<div class="mm-ws-opt"><div class="mm-ws-tools" role="group" aria-label="${esc(T("Weather.lt.title"))}"><button type="button" class="mm-ws-toolbtn" data-wx-storm aria-pressed="${stormOn()}" aria-label="${esc(T("Weather.lt.on"))}" data-tooltip="${esc(T("Weather.lt.barHint"))}"><i class="fa-solid fa-bolt-lightning" inert></i></button></div></div>`;

/**
 * THE LENS'S STRENGTH: "auto" (follows the weather) or fixed 0..V_MAX: a select Auto / Fixed and, when fixed, a slider (hidden, not
 * removed, while auto: a select keeps the focus after a change, so nothing re-renders). `pre` = the controls' name prefix.
 */
const lensFixed = (L) => L.level !== "auto";
const lensLevelHtml = (L, pre) => `${optSelect({ name: `${pre}.lensMode`, label: T("Weather.lensLevel"), value: lensFixed(L) ? "fixed" : "auto", options: [["auto", T("Weather.lensAuto")], ["fixed", T("Weather.lensFixed")]], hint: T("Weather.lensLevelHint") })}`
  + `<div class="mm-wx-lensv" data-wx-lensv${lensFixed(L) ? "" : " hidden"}>${strRow("lens", lensFixed(L) ? L.level : 2, { name: `${pre}.lensLevel`, label: T("Weather.lensFixedAt"), hint: T("Weather.lensFixedHint"), color: "#9fd0f5", icon: "fa-solid fa-glasses" })}</div>`;
/** A lens mode / strength control changed (bar or dock): write the lens level; the slider shows or hides at once. */
function lensChange(kind, value, c) {
  if ( kind === "lensMode" ) {
    const fixed = value === "fixed", box = c.closest(".mm-wx-lens, .mm-d-form")?.querySelector("[data-wx-lensv]");
    if ( box ) box.hidden = !fixed;
    if ( fixed === lensFixed(Wx.params0().lens) ) return;
    Wx.weatherApi.lens({ level: fixed ? (Number(box?.querySelector("range-picker")?.value) || 2) : "auto" });
  } else if ( kind === "lensLevel" ) Wx.weatherApi.lens({ level: Number(value) });
}
const lensRow = () => {
  const L = Wx.params0().lens;
  return `<div class="mm-ws-opt mm-wx-lens"><div class="mm-ws-tools" role="group"><button type="button" class="mm-ws-toolbtn" data-wx-lens aria-pressed="${L.on}" aria-label="${esc(T("Weather.lensOn"))}" data-tooltip="${esc(T("Weather.lensOnHint"))}"><i class="fa-solid fa-glasses" inert></i></button></div>${lensLevelHtml(L, "wx")}</div>`;
};
/** A lens block's controls follow the scene (never the focused one). */
function lensSync(root, pre) {
  const L = Wx.params0().lens, mode = root.querySelector(`[name='${pre}.lensMode']`), box = root.querySelector("[data-wx-lensv]");
  if ( mode && !mode.contains(document.activeElement) ) { writeControl(mode, lensFixed(L) ? "fixed" : "auto"); if ( box ) box.hidden = !lensFixed(L); }
  const lv = root.querySelector(`[name='${pre}.lensLevel']`);
  if ( lv && lensFixed(L) && !lv.contains(document.activeElement) ) writeControl(lv, L.level);
}

/* ---------------------------------------------------------------- the bar */

// the slider the [ ] keys nudge: the last one the GM touched (this client; kept while the section is closed and opened again)
let lastTouched = null;
// the effects the keys 0-3 drove last (this client): after 0 turned them off, 1-3 bring them back
let lastDriven = [];
function bar(host, ctx) {
  const lastOf = () => lastTouched ?? M.drivenFx(curPreset(), strengths().target)[0] ?? "rain";
  const render = () => {
    host.innerHTML = `${presetRow()}${strRows(lastOf())}
      ${dirRow()}
      ${optRange({ name: "wx.str", label: T("Weather.windStr"), value: curWind().str, min: 0, max: 1, step: 0.05, hint: T("Weather.windStrHint") })}
      ${optRange({ name: "weatherOver", label: T("Weather.over"), value: setting("weatherOver") ?? 20, min: 0, max: 120, step: 1, hint: T("Weather.overHint") })}
      ${stormRow()}
      ${lensRow()}
      ${optHint(TOOLS[ctx.tool] === "wind" ? T("Weather.windHint") : TOOLS[ctx.tool] === "tornado" ? T("Weather.tornadoHint") : T("Weather.barHint"))}`;
    live();
  };
  const offS = bindSettings(host, { weatherOver: "weatherOver" });
  const touch = (e) => {
    if ( !M.EFFECTS.includes(e) || e === lastTouched ) return;
    lastTouched = e;
    for ( const r of host.querySelectorAll("[data-wx-str]") ) r.classList.toggle("mm-wx-last", r.dataset.wxStr === e);
  };
  // [ ] NUDGES: the slider moves at once; ONE key is written when the presses stop (a held key repeats: still one write)
  let pend = null;
  const flush = () => {
    if ( !pend ) return;
    clearTimeout(pend.timer);
    const { e, v } = pend; pend = null;
    if ( Math.abs(v - (strengths().target[e] ?? 0)) > 1e-4 ) Wx.weatherApi.strength({ [e]: v }, { over: over() });
  };
  const nudge = (dir) => {
    const e = lastOf();
    if ( pend && pend.e !== e ) flush();
    const from = pend?.v ?? (strengths().target[e] ?? 0);
    // (along the 0.25 grid: 1.3 ] -> 1.5, 1.5 ] -> 1.75, 3.25 ] -> the overdrive's top)
    const g = dir > 0 ? Math.floor(from / NUDGE + 1e-6) + 1 : Math.ceil(from / NUDGE - 1e-6) - 1;
    const v = Math.round(Math.min(M.V_MAX, Math.max(0, g * NUDGE)) * 100) / 100;
    if ( v === from ) return;
    touch(e);
    const c = host.querySelector(`[name='wx.v.${e}']`);
    if ( c ) { writeControl(c, v); c.closest("[data-wx-str]")?.classList.toggle("mm-wx-off", !(v > 0)); }
    clearTimeout(pend?.timer);
    pend = { e, v, timer: setTimeout(flush, 450) };
  };
  const onClick = (ev) => {
    const t = ev.target;
    const p = t.closest?.("[data-wx-preset]"); if ( p ) { flush(); Wx.weatherApi.set(p.dataset.wxPreset, { over: over() }); return; }
    const cm = t.closest?.("[data-wx-cmode]"); if ( cm ) { Wx.setCloudLook({ mode: cm.dataset.wxCmode }); return; }
    if ( t.closest?.("[data-wx-rays]") ) { Wx.setCloudLook({ rays: !Wx.params0().clouds.rays }); return; }
    const d = t.closest?.("[data-wx-dir]"); if ( d ) { const w = curWind(); Wx.change({ wind: { dir: Number(d.dataset.wxDir), str: w.str > 0 ? w.str : 0.4 } }, { over: Math.min(over(), 5000) }); return; }
    if ( t.closest?.("[data-wx-storm]") ) { Wx.setStorm({ on: !stormOn() }); return; }
    if ( t.closest?.("[data-wx-lens]") ) { Wx.setParams({ lens: { on: !Wx.params0().lens.on } }); }
  };
  // a strength slider writes ONE key when it is let go (a range-picker reports "change" on release, never while dragging)
  const onChange = (ev) => {
    if ( isEcho() ) return;
    const c = ev.target.closest?.("[name]"); if ( !c ) return;
    if ( c.name.startsWith("wx.v.") ) {
      const e = c.name.slice(5), v = Number(c.value);
      touch(e);
      if ( pend?.e === e ) { clearTimeout(pend.timer); pend = null; }
      c.closest("[data-wx-str]")?.classList.toggle("mm-wx-off", !(v > 0));
      if ( Number.isFinite(v) && Math.abs(v - (strengths().target[e] ?? 0)) > 1e-4 ) Wx.weatherApi.strength({ [e]: v }, { over: over() });
    }
    else if ( c.name === "wx.str" ) Wx.change({ wind: { str: Number(c.value) } }, { over: Math.min(over(), 5000) });
    else if ( c.name === "wx.lensMode" || c.name === "wx.lensLevel" ) lensChange(c.name.slice(3), c.value, c);
  };
  const onTouch = (ev) => { const e = ev.target.closest?.("[data-wx-str]")?.dataset.wxStr; if ( e ) touch(e); };
  // the slider under the GM's hand (pointer down on it): a change from elsewhere never moves it (focus alone does not hold it: a
  // slider keeps the focus after it is let go, and the keys 0-3 / [ ] must still move it)
  let held = null;
  const onDown = (ev) => {
    held = ev.target.closest?.("range-picker") ?? null; if ( !held ) return;
    window.addEventListener("pointerup", () => { held = null; }, { once: true, capture: true });
  };
  const free = (c) => c !== held && !(c.contains(document.activeElement) && document.activeElement?.type === "number");
  host.addEventListener("click", onClick); host.addEventListener("change", onChange);
  host.addEventListener("pointerdown", onTouch); host.addEventListener("focusin", onTouch);
  host.addEventListener("pointerdown", onDown, true);

  // THE LIVE VALUE while a ramp runs: only the small texts are written, 4 times a second, until the ramp has arrived
  let liveTimer = 0;
  function live() {
    clearTimeout(liveTimer); liveTimer = 0;
    // (a change starts LEAD_MS ahead: until then the state is steady at the old values, but a key is coming: `until` is its start)
    const S = strengths(), going = !S.steady || S.until !== null;
    for ( const e of M.EFFECTS ) showLive(host.querySelector(`[data-wx-str="${e}"]`), going ? S.live[e] : S.target[e], S.target[e]);
    if ( going ) liveTimer = setTimeout(live, 250);
  }

  let frame = 0;
  const id = Hooks.on("moinenMapsWeather", (kind) => {
    if ( kind === "state" || frame ) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      // never re-rendered under the GM's hand: with focus in the bar only the values are written (never into the focused control)
      if ( host.contains(document.activeElement) && document.activeElement !== document.body ) { sync(); live(); return; }
      render();
    });
  });
  const sync = () => {
    for ( const b of host.querySelectorAll("[data-wx-preset]") ) b.setAttribute("aria-pressed", String(b.dataset.wxPreset === curPreset()));
    const S = strengths();
    for ( const e of M.EFFECTS ) {
      const c = host.querySelector(`[name='wx.v.${e}']`); if ( !c ) continue;
      if ( free(c) ) writeControl(c, pend?.e === e ? pend.v : (S.target[e] ?? 0));
      c.closest("[data-wx-str]")?.classList.toggle("mm-wx-off", !(Number(c.value) > 0));
    }
    const w = curWind();
    for ( const b of host.querySelectorAll("[data-wx-dir]") ) b.setAttribute("aria-pressed", String(dirOn(w, Number(b.dataset.wxDir))));
    const s = host.querySelector("[name='wx.str']"); if ( s && free(s) ) writeControl(s, w.str);
    const C = Wx.params0().clouds;
    for ( const b of host.querySelectorAll("[data-wx-cmode]") ) b.setAttribute("aria-pressed", String(b.dataset.wxCmode === C.mode));
    for ( const b of host.querySelectorAll("[data-wx-rays]") ) b.setAttribute("aria-pressed", String(C.rays));
    for ( const b of host.querySelectorAll("[data-wx-storm]") ) b.setAttribute("aria-pressed", String(stormOn()));
    for ( const b of host.querySelectorAll("[data-wx-lens]") ) b.setAttribute("aria-pressed", String(Wx.params0().lens.on));
    lensSync(host, "wx");
  };
  render();
  // KEYS while the section is open (not while typing: a slider's range input does not count as typing): 0-3 the current preset's
  // strength (0 = its effects off, clouds kept), [ ] nudge the last-touched slider by 0.25
  const key = (e) => {
    const tg = e.target;
    if ( tg instanceof HTMLElement && (tg.isContentEditable || /^(textarea|select)$/i.test(tg.tagName) || (tg.tagName === "INPUT" && tg.type !== "range")) ) return;
    if ( e.ctrlKey || e.metaKey || e.altKey || e.shiftKey ) return;
    if ( e.key === "[" || e.key === "]" ) { e.preventDefault(); e.stopPropagation(); nudge(e.key === "]" ? 1 : -1); return; }
    if ( !/^[0-3]$/.test(e.key) ) return;
    e.preventDefault(); e.stopPropagation();
    flush();
    const n = Number(e.key), S = strengths(), driven = M.drivenFx(S.preset, S.target);
    if ( driven.length ) lastDriven = driven;
    else {
      // (after 0 nothing is driven: 1-3 bring back the effects 0 turned off, at that strength)
      if ( n > 0 && lastDriven.length ) Wx.weatherApi.strength(Object.fromEntries(lastDriven.map((x) => [x, n])), { over: over() });
      return;
    }
    if ( driven.every((x) => Math.abs((S.target[x] ?? 0) - n) < 1e-4) ) return;
    Wx.weatherApi.level(n, { over: over() });
  };
  window.addEventListener("keydown", key, true);
  return () => {
    flush(); offS(); clearTimeout(liveTimer);
    host.removeEventListener("click", onClick); host.removeEventListener("change", onChange);
    host.removeEventListener("pointerdown", onTouch); host.removeEventListener("focusin", onTouch); host.removeEventListener("pointerdown", onDown, true);
    Hooks.off("moinenMapsWeather", id); cancelAnimationFrame(frame); window.removeEventListener("keydown", key, true);
  };
}

/* ---------------------------------------------------------------- the wind arrow (a tool: drag on the map) */

let arrow = null, drag = null, ls = null;
function windTool(on) {
  if ( !on ) {
    if ( ls ) { window.removeEventListener("pointerdown", ls.down, true); window.removeEventListener("pointermove", ls.move); window.removeEventListener("pointerup", ls.up); ls = null; }
    if ( arrow && !arrow.destroyed ) arrow.destroy(); arrow = null; drag = null;
    return;
  }
  if ( ls || !game.user.isGM || !canvas.ready ) return;
  arrow = new PIXI.Graphics(); arrow.eventMode = "none"; arrow.zIndex = 900;
  canvas.interface.sortableChildren = true; canvas.interface.addChild(arrow);
  const pt = (ev) => canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
  const full = () => canvas.grid.size * 4;      // an arrow 4 squares long = full strength
  const draw = (a, b) => {
    const z = canvas.stage.scale.x, dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy); arrow.clear(); if ( L < 2 ) return;
    const ang = Math.atan2(dy, dx), h = Math.max(10 / z, Math.min(L * 0.25, canvas.grid.size * 0.5)), px = Math.max(3, Math.round(3 / z));
    // a pixel arrow: square dots along the shaft, a chevron head
    arrow.beginFill(0xdff0ff, 0.95);
    for ( let s = 0; s < L - h * 0.5; s += px * 2 ) arrow.drawRect(Math.round(a.x + Math.cos(ang) * s - px / 2), Math.round(a.y + Math.sin(ang) * s - px / 2), px, px);
    for ( const side of [-1, 1] ) for ( let s = 0; s < h; s += px ) { const aa = ang + Math.PI - side * 0.55; arrow.drawRect(Math.round(b.x + Math.cos(aa) * s - px / 2), Math.round(b.y + Math.sin(aa) * s - px / 2), px, px); }
    arrow.endFill();
    const str = Math.min(1, L / full());
    arrow.lineStyle(Math.max(1, 1.5 / z), 0x15110f, 0.5).drawCircle(a.x, a.y, full() * str);
  };
  ls = {
    down: (ev) => { if ( ev.button !== 0 || ev.target !== canvas.app?.view ) return; ev.stopImmediatePropagation(); ev.preventDefault(); drag = { a: pt(ev) }; },
    move: (ev) => { if ( drag ) draw(drag.a, pt(ev)); },
    up: (ev) => {
      if ( !drag ) return;
      const a = drag.a, b = pt(ev); drag = null; arrow?.clear();
      const L = Math.hypot(b.x - a.x, b.y - a.y); if ( L < canvas.grid.size * 0.2 ) return;
      const dir = Math.round(((Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI) + 360) % 360), str = Math.round(Math.min(1, L / full()) * 100) / 100;
      Wx.change({ wind: { dir, str } }, { over: Math.min(over(), 5000) });
    }
  };
  window.addEventListener("pointerdown", ls.down, true); window.addEventListener("pointermove", ls.move); window.addEventListener("pointerup", ls.up);
}

/* ---------------------------------------------------------------- the tornado (a tool: click or drag a path on the map) */

const newT = { level: 2, speed: 0.6, end: "loop" };      // (the next tornado: set in the dock, this client only)
let tor = null;
function tornadoTool(on) {
  if ( !on ) {
    if ( tor ) {
      window.removeEventListener("pointerdown", tor.down, true); window.removeEventListener("pointermove", tor.move); window.removeEventListener("pointerup", tor.up);
      Hooks.off("moinenMapsWeather", tor.hook); if ( !tor.g.destroyed ) tor.g.destroy();
    }
    tor = null;
    return;
  }
  if ( tor || !game.user.isGM || !canvas.ready ) return;
  const g = new PIXI.Graphics(); g.eventMode = "none"; g.zIndex = 900;
  canvas.interface.sortableChildren = true; canvas.interface.addChild(g);
  const pt = (ev) => canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
  // pixel dots along the path being drawn (bright) and the paths of the scene's tornadoes (dim), with a ring where each one is now
  const dots = (pts, color, alpha) => {
    const z = canvas.stage.scale.x, px = Math.max(3, Math.round(3 / z)), gap = px * 3;
    g.beginFill(color, alpha);
    for ( let i = 1; i < pts.length; i++ ) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], L = Math.hypot(bx - ax, by - ay);
      for ( let s = 0; s < L; s += gap ) g.drawRect(Math.round(ax + (bx - ax) * s / L - px / 2), Math.round(ay + (by - ay) * s / L - px / 2), px, px);
    }
    g.endFill();
  };
  const draw = () => {
    if ( g.destroyed ) return;
    g.clear();
    const z = canvas.stage.scale.x;
    for ( const t of Wx.tornadoApi.list() ) {
      if ( t.phase.gone ) continue;
      dots(t.path, 0xb8c4d6, 0.6);
      g.lineStyle(Math.max(1, 2 / z), 0xb8c4d6, 0.8).drawCircle(t.x, t.y, canvas.grid.size * 0.6).lineStyle(0);
    }
    if ( tor?.path ) dots(tor.path, 0xdff0ff, 0.95);
  };
  tor = {
    g, path: null,
    down: (ev) => { if ( ev.button !== 0 || ev.target !== canvas.app?.view ) return; ev.stopImmediatePropagation(); ev.preventDefault(); const p = pt(ev); tor.path = [[p.x, p.y]]; draw(); },
    move: (ev) => {
      if ( !tor?.path ) return;
      const p = pt(ev), last = tor.path.at(-1);
      if ( Math.hypot(p.x - last[0], p.y - last[1]) >= canvas.grid.size * 0.25 ) { tor.path.push([p.x, p.y]); draw(); }
    },
    up: () => {
      if ( !tor?.path ) return;
      let path = tor.path; tor.path = null;
      const L = path.reduce((a, q, i) => i ? a + Math.hypot(q[0] - path[i - 1][0], q[1] - path[i - 1][1]) : 0, 0);
      if ( L < canvas.grid.size * 0.5 ) path = [path[0]];                // (a click: it stays there, wandering)
      Wx.tornadoApi.add(path, { level: newT.level, speed: newT.speed, end: newT.end });
      draw();
    },
    hook: Hooks.on("moinenMapsWeather", (kind) => { if ( kind === "changed" || kind === "loaded" ) draw(); })
  };
  window.addEventListener("pointerdown", tor.down, true); window.addEventListener("pointermove", tor.move); window.addEventListener("pointerup", tor.up);
  draw();
}

/* ---------------------------------------------------------------- the dock */

/** A panel that re-renders on weather changes (keeping focus): `html()` builds it; `onChange(name, value)`, `onClick(el)`. */
function panel({ html, onChange, onClick, kinds = null }) {
  return (host) => {
    const gm = game.user.isGM;
    const render = () => { host.innerHTML = html(); if ( !gm ) for ( const c of host.querySelectorAll("[name^='g.']") ) c.disabled = true; };
    render();
    const read = (c) => c.matches("input[type=checkbox]") ? c.checked : c.matches("range-picker, input[type=number]") ? Number(c.value) : c.value;
    const ch = (ev) => { if ( isEcho() ) return; const c = ev.target.closest?.("[name]"); if ( c ) onChange?.(c.name, read(c), c); };
    const cl = (ev) => { const b = ev.target.closest?.("[data-act]"); if ( b ) { b.blur(); onClick?.(b); } };
    host.addEventListener("change", ch); host.addEventListener("click", cl);
    let frame = 0;
    const id = Hooks.on("moinenMapsWeather", (kind) => {
      if ( (kinds && !kinds.includes(kind)) || frame ) return;
      frame = requestAnimationFrame(() => { frame = 0; if ( !host.contains(document.activeElement) || document.activeElement === document.body ) render(); });
    });
    return () => { host.removeEventListener("change", ch); host.removeEventListener("click", cl); Hooks.off("moinenMapsWeather", id); cancelAnimationFrame(frame); };
  };
}

const pct = (x) => `${Math.round(x * 100)}%`;
function statusHtml() {
  const P = Wx.params0(), st = Wx.weatherApi.status(), k = cur();
  const fx = Object.entries(st.state?.fx ?? {}).map(([e, f]) => `${T(`Weather.fx.${e}`)} ${fmt(f.v)}`).join(", ") || T("Weather.none");
  const core = canvas.scene?.weather ? `<p class="mm-ws-hint mm-wx-warn"><i class="fa-solid fa-triangle-exclamation" inert></i> ${esc(T("Weather.coreWarn"))}</p>` : "";
  return `<p class="mm-d-status" role="status">${esc(game.i18n.format("MOINENMAPS.Weather.status", { preset: T(`Weather.p.${k?.preset ?? "clear"}`), level: fmt(k?.level ?? 2), fx, wet: pct(st.state?.wet ?? 0), cover: pct(st.state?.cover ?? 0) }))}</p>
    ${st.state && !st.state.steady ? `<p class="mm-ws-hint">${esc(T("Weather.changing"))}</p>` : ""}${core}
    ${optCheck({ name: "g.on", label: T("Weather.f.on"), checked: P.on, hint: T("Weather.h.on") })}
    ${optSelect({ name: "g.who", label: T("Weather.f.who"), value: P.who, options: [["all", T("Weather.o.all")], ["gm", T("Weather.o.gm")]], hint: T("Weather.h.who") })}
    <p class="mm-ws-hint">${esc(game.i18n.format("MOINENMAPS.Weather.cost", { n: (st.instances ?? 0) + (st.parts ?? 0), ms: (st.tickMs ?? 0).toFixed(3), lens: st.lens ? T("Weather.lensOnShort") : T("Weather.lensOffShort") }))}</p>`;
}

/**
 * TORNADOES: the next one's strength (1..3, this client) / speed / end; each tornado's strength slider (1..3, written on release: it
 * ramps over 5 s from where it is, a float) with its live value while it ramps, and its rope-out button (a slider never ropes out).
 */
const T_COLOR = "#b8c4d6";
const tornadoRow = (t, i, gm) => strRow(`tornado-${t.id}`, t.level, { name: `g.tlv.${t.id}`, min: 1, max: 3, step: 0.05, color: T_COLOR, icon: "fa-solid fa-tornado",
  label: `${game.i18n.format("MOINENMAPS.Weather.tornadoN", { n: i + 1 })}${t.out !== null ? ` · ${T("Weather.tornadoGoing")}` : ""}`,
  hint: `${T("Weather.tornadoEnd")}: ${T(`Weather.tEnd.${t.end}`)}. ${T("Weather.tornadoLevelHint")}`,
  extra: `<button type="button" class="mm-ws-toolbtn" data-act="tout" data-id="${t.id}" data-tooltip="${esc(T("Weather.tornadoOutHint"))}" aria-label="${esc(T("Weather.tornadoOut"))}"${gm ? "" : " disabled"}><i class="fa-solid fa-wind" inert></i></button>` });
const tornadoPanelBody = panel({
  kinds: ["changed", "params", "loaded"],
  html: () => {
    const gm = game.user.isGM, ends = TM.ENDS.map((e) => [e, T(`Weather.tEnd.${e}`)]);
    const rows = Wx.tornadoApi.list().filter((t) => !t.phase.gone).map((t, i) => tornadoRow(t, i, gm)).join("");
    return `<div class="mm-d-form">
      ${strRow("tornado", newT.level, { name: "t.level", min: 1, max: 3, step: 0.05, color: T_COLOR, icon: "fa-solid fa-tornado", label: T("Weather.tornadoNew"), hint: T("Weather.tornadoNewHint") })}
      ${optRange({ name: "t.speed", label: T("Weather.tornadoSpeed"), value: newT.speed, min: TM.LIMITS.speed[0], max: TM.LIMITS.speed[1], step: 0.05, hint: T("Weather.tornadoSpeedHint") })}
      ${optSelect({ name: "t.end", label: T("Weather.tornadoEnd"), value: newT.end, options: ends, hint: T("Weather.tornadoEndHint") })}
      ${rows || `<p class="mm-ws-hint">${esc(T("Weather.tornadoNone"))}</p>`}
      <div class="mm-d-actions"><button type="button" class="mm-ws-btn" data-act="tall"${gm && rows ? "" : " disabled"}><i class="fa-solid fa-wind" inert></i> ${esc(T("Weather.tornadoAllOut"))}</button></div>
      <p class="mm-ws-hint">${esc(T("Weather.tornadoHint"))}</p></div>`;
  },
  onChange: (n, v) => {
    if ( n === "t.level" ) newT.level = TM.cleanLevel(v);
    else if ( n === "t.speed" ) newT.speed = Number(v);
    else if ( n === "t.end" && TM.ENDS.includes(v) ) newT.end = v;
    else if ( n.startsWith("g.tlv.") && Number.isFinite(v) ) {
      const id = n.slice(6), T0 = Wx.params0().tornadoes.find((t) => t.id === id);
      if ( T0 && Math.abs(T0.level - v) > 1e-4 ) Wx.tornadoApi.update(id, { level: v });
    }
  },
  onClick: (b) => {
    const a = b.dataset.act;
    if ( a === "tout" ) Wx.tornadoApi.remove(b.dataset.id);
    else if ( a === "tall" ) Wx.tornadoApi.clear();
  }
});
/** The panel, plus the live strength of each tornado while its 5 s ramp runs (only the small texts; nothing while none ramps). */
function tornadoPanel(host) {
  const off = tornadoPanelBody(host);
  let timer = 0;
  const tick = () => {
    clearTimeout(timer); timer = 0;
    let any = false;
    for ( const t of Wx.tornadoApi.list() ) if ( showLive(host.querySelector(`[data-wx-str="tornado-${t.id}"]`), t.v, t.level) ) any = true;
    if ( any ) timer = setTimeout(tick, 250);
  };
  const id = Hooks.on("moinenMapsWeather", (kind) => { if ( kind === "changed" || kind === "loaded" || kind === "params" ) setTimeout(tick, 50); });
  tick();
  return () => { off(); clearTimeout(timer); Hooks.off("moinenMapsWeather", id); };
}

const PANELS = [
  { id: "weather", title: "MOINENMAPS.Weather.panel", icon: "fa-solid fa-cloud-sun-rain", mount: panel({
    html: () => `<div class="mm-d-form mm-wx-panel">${statusHtml()}</div>`,
    onChange: (n, v) => { if ( n === "g.on" ) Wx.setParams({ on: v }); else if ( n === "g.who" ) Wx.setParams({ who: v }); }
  }) },
  { id: "wind", title: "MOINENMAPS.Weather.pWind", icon: "fa-solid fa-wind", open: false, mount: panel({
    kinds: ["changed", "params", "loaded"],
    html: () => { const w = curWind(); return `<div class="mm-d-form">
      ${optRange({ name: "g.dir", label: T("Weather.windDirDeg"), value: w.dir, min: 0, max: 359, step: 1, hint: T("Weather.windDirHint") })}
      ${optRange({ name: "g.str", label: T("Weather.windStr"), value: w.str, min: 0, max: 1, step: 0.05, hint: T("Weather.windStrHint") })}
      ${optRange({ name: "g.gust", label: T("Weather.gust"), value: w.gust, min: 0, max: 1, step: 0.05, hint: T("Weather.gustHint") })}
      <p class="mm-ws-hint">${esc(T("Weather.windFire"))}</p></div>`; },
    onChange: (n, v) => { const k = { "g.dir": "dir", "g.str": "str", "g.gust": "gust" }[n]; if ( k ) Wx.change({ wind: { [k]: v } }, { over: Math.min(over(), 5000) }); }
  }) },
  { id: "tornado", title: "MOINENMAPS.Weather.pTornado", icon: "fa-solid fa-tornado", open: false, mount: tornadoPanel },
  { id: "lightning", title: "MOINENMAPS.Weather.lt.title", icon: "fa-solid fa-bolt-lightning", open: false, mount: panel({
    kinds: ["params", "loaded", "changed"],
    html: () => {
      const S = Wx.weatherApi.lightning(), SL = Wx.weatherApi.stormModel.LIMITS, gm = game.user.isGM;
      const rain = (Wx.weatherApi.state()?.fx?.rain?.p ?? 0) > 0.01 || ["rain", "storm"].includes(curPreset());
      const pv = ["far", "mid", "close"].map((k) => `<button type="button" class="mm-ws-btn" data-act="lpv" data-v="${k}"${gm && rain ? "" : " disabled"} data-tooltip="${esc(T(`Weather.lt.pvh.${k}`))}"><i class="fa-solid ${k === "close" ? "fa-bolt-lightning" : k === "mid" ? "fa-cloud-bolt" : "fa-cloud"}" inert></i> ${esc(T(`Weather.lt.pv.${k}`))}</button>`).join("");
      return `<div class="mm-d-form">
      ${optCheck({ name: "g.ltOn", label: T("Weather.lt.on"), checked: S.on, hint: T("Weather.lt.onHint") })}
      ${optRange({ name: "g.ltRate", label: T("Weather.lt.rate"), value: S.rate, min: SL.rate[0], max: SL.rate[1], step: 1, hint: T("Weather.lt.rateHint") })}
      ${optRange({ name: "g.ltPower", label: T("Weather.lt.power"), value: S.power, min: 0, max: 1, step: 0.05, hint: T("Weather.lt.powerHint") })}
      ${optRange({ name: "g.ltNear", label: T("Weather.lt.near"), value: S.near, min: 0, max: 1, step: 0.05, hint: T("Weather.lt.nearHint") })}
      ${optCheck({ name: "g.ltBolts", label: T("Weather.lt.bolts"), checked: S.bolts, hint: T("Weather.lt.boltsHint") })}
      ${rain ? "" : `<p class="mm-ws-hint mm-wx-warn"><i class="fa-solid fa-triangle-exclamation" inert></i> ${esc(T("Weather.lt.needsRain"))}</p>`}
      <span class="mm-ws-label">${esc(T("Weather.lt.preview"))}</span><div class="mm-d-actions">${pv}</div>
      <p class="mm-ws-hint">${esc(T("Weather.lt.hint"))}</p></div>`;
    },
    onChange: (n, v) => {
      const k = { "g.ltOn": "on", "g.ltRate": "rate", "g.ltPower": "power", "g.ltNear": "near", "g.ltBolts": "bolts" }[n];
      if ( k ) Wx.setStorm({ [k]: v });
    },
    onClick: (b) => { if ( b.dataset.act === "lpv" ) Wx.weatherApi.previewFlash(b.dataset.v); }
  }) },
  { id: "ground", title: "MOINENMAPS.Weather.pGround", icon: "fa-solid fa-water", open: false, mount: panel({
    kinds: ["params", "loaded", "changed"],
    html: () => { const g = Wx.params0().ground, L = M.LIMITS; return `<div class="mm-d-form">
      ${optRange({ name: "g.wetRate", label: T("Weather.wetRate"), value: g.wetRate, min: L.wetRate[0], max: L.wetRate[1], step: 5, hint: T("Weather.wetRateHint") })}
      ${optRange({ name: "g.dryRate", label: T("Weather.dryRate"), value: g.dryRate, min: L.dryRate[0], max: L.dryRate[1], step: 10, hint: T("Weather.dryRateHint") })}
      ${optCheck({ name: "g.puddles", label: T("Weather.puddles"), checked: g.puddles, hint: T("Weather.puddlesHint") })}
      ${optRange({ name: "g.snowRate", label: T("Weather.snowRate"), value: g.snowRate, min: L.snowRate[0], max: L.snowRate[1], step: 5, hint: T("Weather.snowRateHint") })}
      ${optRange({ name: "g.meltRate", label: T("Weather.meltRate"), value: g.meltRate, min: L.meltRate[0], max: L.meltRate[1], step: 10, hint: T("Weather.meltRateHint") })}
      ${optCheck({ name: "g.fireOut", label: T("Weather.fireOut"), checked: Wx.params0().fire.out, hint: T("Weather.fireOutHint") })}
      <div class="mm-d-actions"><button type="button" class="mm-ws-btn" data-act="dry"${game.user.isGM ? "" : " disabled"}><i class="fa-solid fa-sun" inert></i> ${esc(T("Weather.dryNow"))}</button></div></div>`; },
    onChange: (n, v) => {
      if ( n === "g.fireOut" ) { Wx.setParams({ fire: { out: v } }); return; }
      const k = { "g.wetRate": "wetRate", "g.dryRate": "dryRate", "g.puddles": "puddles", "g.snowRate": "snowRate", "g.meltRate": "meltRate" }[n]; if ( k ) Wx.setParams({ ground: { [k]: v } });
    },
    onClick: (b) => { if ( b.dataset.act === "dry" ) Wx.dryNow(); }
  }) },
  { id: "lens", title: "MOINENMAPS.Weather.pLens", icon: "fa-solid fa-glasses", open: false, mount: panel({
    kinds: ["params", "loaded", "client"],
    html: () => { const L = Wx.params0().lens; return `<div class="mm-d-form">
      ${optCheck({ name: "g.lensOn", label: T("Weather.lensOn"), checked: L.on, hint: T("Weather.lensOnHint") })}
      ${lensLevelHtml(L, "g")}
      ${optRange({ name: "g.lensStrength", label: T("Weather.lensStrength"), value: L.strength, min: 0, max: 1, step: 0.05, hint: T("Weather.lensStrengthHint") })}
      ${optCheck({ name: "g.lensHeat", label: T("Weather.lensHeat"), checked: L.heat, hint: T("Weather.lensHeatHint") })}
      <p class="mm-ws-hint">${esc(T("Weather.lensPlayers"))}</p></div>`; },
    onChange: (n, v, c) => {
      if ( n === "g.lensOn" ) Wx.setParams({ lens: { on: v } });
      else if ( n === "g.lensMode" || n === "g.lensLevel" ) lensChange(n.slice(2), v, c);
      else if ( n === "g.lensStrength" ) Wx.setParams({ lens: { strength: v } });
      else if ( n === "g.lensHeat" ) Wx.setParams({ lens: { heat: v } });
    }
  }) },
  { id: "view", title: "MOINENMAPS.Weather.pView", icon: "fa-solid fa-cube", open: false, mount: panel({
    kinds: ["changed", "loaded"],
    html: () => { const v = Wx.weatherApi.view(); return `<div class="mm-d-form">
      ${optSelect({ name: "g.view", label: T("Weather.view"), value: v.preset, options: [...Object.keys(VIEW_PRESETS).map((k) => [k, T(`Weather.v.${k}`)]), ...(v.preset === "custom" ? [["custom", T("Weather.v.custom")]] : [])], hint: T("Weather.viewHint") })}</div>`; },
    onChange: (n, v) => { if ( n === "g.view" && v in VIEW_PRESETS ) Wx.setView(v); }
  }) },
  { id: "client", title: "MOINENMAPS.Weather.pClient", icon: "fa-solid fa-user-gear", open: false, mount: (host) => {
    const opts = [["off", T("Weather.cap.off")], ["1", T("Weather.cap.1")], ["2", T("Weather.cap.2")], ["3", T("Weather.cap.3")]];
    host.innerHTML = `<div class="mm-d-form">
      ${optSelect({ name: "weatherDetail", label: T("Weather.set.detail"), value: setting("weatherDetail") ?? "3", options: opts, hint: T("Weather.set.detailHint") })}
      ${optSelect({ name: "weatherLens", label: T("Weather.set.lens"), value: setting("weatherLens") ?? "3", options: opts, hint: T("Weather.set.lensHint") })}
      <p class="mm-ws-hint">${esc(T("Weather.clientHint"))}</p></div>`;
    return bindSettings(host, { weatherDetail: "weatherDetail", weatherLens: "weatherLens" });
  } }
];

/* ---------------------------------------------------------------- wiring */

const OFF = (() => { try { return globalThis.localStorage?.getItem("mm-weather") === "off"; } catch { return false; } })();

if ( !OFF ) {
  Wx.registerWeather();
  registerSection({
    id: "weather", order: 3.5, title: "MOINENMAPS.Weather.title", icon: "fa-solid fa-cloud-sun-rain", color: "#7fb8e6",
    activeTool: "mm-wx-pick",
    tools: () => [
      { name: "mm-wx-pick", order: 1, title: "MOINENMAPS.Weather.tool.pick", icon: "fa-solid fa-arrow-pointer" },
      { name: "mm-wx-wind", order: 2, title: "MOINENMAPS.Weather.tool.wind", icon: "fa-solid fa-wind", color: "#dff0ff" },
      { name: "mm-wx-tornado", order: 3, title: "MOINENMAPS.Weather.tool.tornado", icon: "fa-solid fa-tornado", color: "#b8c4d6" }
    ],
    onToolChange: (tool, active) => { if ( tool === "mm-wx-wind" ) windTool(active); else if ( tool === "mm-wx-tornado" ) tornadoTool(active); },
    bar,
    panels: PANELS
  });
  Hooks.on("canvasTearDown", () => { windTool(false); tornadoTool(false); });
}
