import { registerSection } from "../workspace/registry.mjs";
import { esc, T, optRange, optSelect, optCheck, optHint, isEcho, writeControl, bindSettings, onSetting, setting } from "../workspace/ui.mjs";
import { MODULE_ID } from "../config.mjs";
import * as M from "./model.mjs";
import * as TM from "./tornado-model.mjs";
import * as Wx from "./weather.mjs";
import { VIEW_PRESETS } from "../view-angle.mjs";

/**
 * THE WEATHER SECTION of the Moinen Maps workspace (GM):
 *  - tools: the pointer (the map as usual), the WIND ARROW (drag on the map: the wind blows along the arrow, its length is the
 *    strength; a pixel arrow shows while you drag) and the TORNADO (click: one that stays and wanders there; drag: its path - it
 *    travels along it with the dock's level, speed and end);
 *  - bar: the weather (Clear / Rain / ...), its LEVEL 1 / 2 / 3 (keys 1-3 while the section is open), the CLOUDS (off / scattered /
 *    broken / overcast: a layer kept through preset changes; their look: clouds with shadows or shadows only; godrays), the fine intensity within the
 *    level, the wind (eight directions + strength), how long a change takes ("over N s"), the lens on / off and its level;
 *  - dock: Weather (status, on / off, who sees it, the layers and their levels), Wind (direction, strength, gusts), Tornadoes (the
 *    next one's level / speed / end, the list with each one's level and rope-out, rope out all), Ground (how fast it
 *    wets and dries, puddles, whether rain puts fire out), Lens (on, level, strength), View (the oblique angle, shared with fire), This client (detail and lens
 *    caps: the same settings every player has in Configure Settings).
 * Every change is one key on the timeline (one scene write); every client ramps to it from the shared clock.
 */
const DIRS = [270, 315, 0, 45, 90, 135, 180, 225];
const LEVEL_COLOR = ["", "#9fd0f5", "#4f9de0", "#2a5fb8"];
const PRESET_COLOR = { clear: "#f2c14e", rain: "#4f9de0", snow: "#e8f1fb", sand: "#d9a55b", dust: "#e6d3a3", embers: "#f07a2a", wind: "#9fd38a", storm: "#5b7fa8", blizzard: "#cfe3f5", clouds: "#c9d6e3" };
const CLOUD_COLOR = ["#f2c14e", "#dfe8f1", "#b9c8d8", "#8b9bb0"];
const TOOLS = { "mm-wx-pick": null, "mm-wx-wind": "wind", "mm-wx-tornado": "tornado" };

const over = () => Math.max(0, Number(setting("weatherOver")) || 0) * 1000;
const cur = () => M.current(Wx.params0());
const curPreset = () => cur()?.preset ?? "clear";
const curLevel = () => cur()?.level ?? 2;
const curI = () => cur()?.i ?? 0.5;
const curWind = () => cur()?.wind ?? { dir: 0, str: 0, gust: 0.5 };

function btnRow(label, attr, vals, isOn, name, hint, color, icon = null) {
  const b = (v) => `<button type="button" class="mm-ws-toolbtn mm-d-level" data-${attr}="${v}" aria-pressed="${isOn(v)}" style="--mm-tool:${color(v)}" data-tooltip="${esc(hint(v))}">${icon ? `<i class="${icon(v)}" inert></i>` : `<span class="mm-d-dot" inert></span>`}<span>${esc(name(v))}</span></button>`;
  return `<div class="mm-ws-opt"><span class="mm-ws-label">${esc(T(label))}</span><div class="mm-ws-tools mm-d-levels" role="group" aria-label="${esc(T(label))}">${vals.map(b).join("")}</div></div>`;
}

const presetRow = () => btnRow("Weather.preset", "wx-preset", Object.keys(M.PRESETS), (v) => v === curPreset(), (v) => T(`Weather.p.${v}`), (v) => T(`Weather.ph.${v}`), (v) => PRESET_COLOR[v] ?? "#ccc", (v) => M.PRESET_ICONS[v]);
const levelRow = () => btnRow("Weather.level", "wx-level", [1, 2, 3], (v) => v === curLevel(), (v) => T(`Weather.lvl${v}`), (v) => T(`Weather.lvlHint${v}`), (v) => LEVEL_COLOR[v]);
const dirRow = () => {
  const w = curWind();
  return `<div class="mm-ws-opt"><span class="mm-ws-label">${esc(T("Weather.windDir"))}</span><div class="mm-ws-tools" role="group" aria-label="${esc(T("Weather.windDir"))}">${DIRS.map((d) => `<button type="button" class="mm-ws-toolbtn" data-wx-dir="${d}" aria-pressed="${w.str > 0 && Math.abs(((w.dir - d + 540) % 360) - 180) < 1}" aria-label="${esc(T(`Fire.dir.${d}`))}" data-tooltip="${esc(T(`Fire.dir.${d}`))}"><i class="fa-solid fa-arrow-right fa-rotate-by" style="--fa-rotate-angle:${d}deg" inert></i></button>`).join("")}</div></div>`;
};
// the cloud layer: off / scattered / broken / overcast (kept through preset changes), its look (bodies + shadows or shadows only), godrays
const curClouds = () => cur()?.fx?.clouds?.l ?? 0;
const cloudRow = () => {
  const C = Wx.params0().clouds, b = (attr, on, icon, label, hint) => `<button type="button" class="mm-ws-toolbtn" data-${attr} aria-pressed="${on}" aria-label="${esc(T(label))}" data-tooltip="${esc(T(hint))}"><i class="${icon}" inert></i></button>`;
  return btnRow("Weather.clouds", "wx-clouds", [0, 1, 2, 3], (v) => v === curClouds(), (v) => T(`Weather.cl.${v}`), (v) => T(`Weather.clh.${v}`), (v) => CLOUD_COLOR[v], (v) => v ? "fa-solid fa-cloud" : "fa-solid fa-sun")
    + `<div class="mm-ws-opt"><div class="mm-ws-tools" role="group" aria-label="${esc(T("Weather.cloudLook"))}">${b("wx-cmode=\"sky\"", C.mode === "sky", "fa-solid fa-cloud-sun", "Weather.cm.sky", "Weather.cmh.sky")}${b("wx-cmode=\"shadows\"", C.mode === "shadows", "fa-solid fa-circle-half-stroke", "Weather.cm.shadows", "Weather.cmh.shadows")}${b("wx-rays", C.rays, "fa-solid fa-sun-bright", "Weather.rays", "Weather.raysHint")}</div></div>`;
};
const lensRow = () => {
  const L = Wx.params0().lens;
  return `<div class="mm-ws-opt"><div class="mm-ws-tools" role="group"><button type="button" class="mm-ws-toolbtn" data-wx-lens aria-pressed="${L.on}" aria-label="${esc(T("Weather.lensOn"))}" data-tooltip="${esc(T("Weather.lensOnHint"))}"><i class="fa-solid fa-glasses" inert></i></button></div>
    ${optSelect({ name: "wx.lensLevel", label: T("Weather.lensLevel"), value: L.level, options: [["auto", T("Weather.lensAuto")], [1, T("Weather.lvl1")], [2, T("Weather.lvl2")], [3, T("Weather.lvl3")]], hint: T("Weather.lensLevelHint") })}</div>`;
};

/* ---------------------------------------------------------------- the bar */

function bar(host, ctx) {
  const render = () => {
    host.innerHTML = `${presetRow()}${levelRow()}${cloudRow()}
      ${optRange({ name: "wx.i", label: T("Weather.intensity"), value: curI(), min: 0, max: 1, step: 0.05, hint: T("Weather.intensityHint") })}
      ${dirRow()}
      ${optRange({ name: "wx.str", label: T("Weather.windStr"), value: curWind().str, min: 0, max: 1, step: 0.05, hint: T("Weather.windStrHint") })}
      ${optRange({ name: "weatherOver", label: T("Weather.over"), value: setting("weatherOver") ?? 20, min: 0, max: 120, step: 1, hint: T("Weather.overHint") })}
      ${lensRow()}
      ${optHint(TOOLS[ctx.tool] === "wind" ? T("Weather.windHint") : TOOLS[ctx.tool] === "tornado" ? T("Weather.tornadoHint") : T("Weather.barHint"))}`;
  };
  render();
  const offS = bindSettings(host, { weatherOver: "weatherOver" });
  const onClick = (ev) => {
    const t = ev.target;
    const p = t.closest?.("[data-wx-preset]"); if ( p ) { Wx.change({ preset: p.dataset.wxPreset }, { over: over() }); return; }
    const l = t.closest?.("[data-wx-level]"); if ( l ) { if ( Number(l.dataset.wxLevel) !== curLevel() ) Wx.change({ level: Number(l.dataset.wxLevel) }, { over: over() }); return; }
    const c = t.closest?.("[data-wx-clouds]"); if ( c ) { if ( Number(c.dataset.wxClouds) !== curClouds() ) Wx.change({ clouds: Number(c.dataset.wxClouds) }, { over: over() }); return; }
    const cm = t.closest?.("[data-wx-cmode]"); if ( cm ) { Wx.setCloudLook({ mode: cm.dataset.wxCmode }); return; }
    if ( t.closest?.("[data-wx-rays]") ) { Wx.setCloudLook({ rays: !Wx.params0().clouds.rays }); return; }
    const d = t.closest?.("[data-wx-dir]"); if ( d ) { const w = curWind(); Wx.change({ wind: { dir: Number(d.dataset.wxDir), str: w.str > 0 ? w.str : 0.4 } }, { over: Math.min(over(), 5000) }); return; }
    if ( t.closest?.("[data-wx-lens]") ) { Wx.setParams({ lens: { on: !Wx.params0().lens.on } }); }
  };
  const onChange = (ev) => {
    if ( isEcho() ) return;
    const c = ev.target.closest?.("[name]"); if ( !c ) return;
    if ( c.name === "wx.i" ) Wx.change({ i: Number(c.value) }, { over: over() });
    else if ( c.name === "wx.str" ) Wx.change({ wind: { str: Number(c.value) } }, { over: Math.min(over(), 5000) });
    else if ( c.name === "wx.lensLevel" ) Wx.setParams({ lens: { level: c.value === "auto" ? "auto" : Number(c.value) } });
  };
  host.addEventListener("click", onClick); host.addEventListener("change", onChange);
  let frame = 0;
  const id = Hooks.on("moinenMapsWeather", (kind) => {
    if ( kind === "state" || frame ) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if ( host.contains(document.activeElement) && document.activeElement !== document.body ) {
        const i = host.querySelector("[name='wx.i']"); if ( i && !i.contains(document.activeElement) ) writeControl(i, curI());
        const s = host.querySelector("[name='wx.str']"); if ( s && !s.contains(document.activeElement) ) writeControl(s, curWind().str);
        sync(); return;
      }
      render();
    });
  });
  const sync = () => {
    for ( const b of host.querySelectorAll("[data-wx-preset]") ) b.setAttribute("aria-pressed", String(b.dataset.wxPreset === curPreset()));
    for ( const b of host.querySelectorAll("[data-wx-level]") ) b.setAttribute("aria-pressed", String(Number(b.dataset.wxLevel) === curLevel()));
    for ( const b of host.querySelectorAll("[data-wx-clouds]") ) b.setAttribute("aria-pressed", String(Number(b.dataset.wxClouds) === curClouds()));
    const C = Wx.params0().clouds;
    for ( const b of host.querySelectorAll("[data-wx-cmode]") ) b.setAttribute("aria-pressed", String(b.dataset.wxCmode === C.mode));
    for ( const b of host.querySelectorAll("[data-wx-rays]") ) b.setAttribute("aria-pressed", String(C.rays));
  };
  // keys 1-3: the level, while the section is open (not while typing)
  const key = (e) => {
    const tg = e.target; if ( tg instanceof HTMLElement && (tg.isContentEditable || /^(input|textarea|select)$/i.test(tg.tagName)) ) return;
    if ( e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !/^[123]$/.test(e.key) ) return;
    e.preventDefault(); e.stopPropagation();
    if ( Number(e.key) !== curLevel() ) Wx.change({ level: Number(e.key) }, { over: over() });
  };
  window.addEventListener("keydown", key, true);
  return () => { offS(); host.removeEventListener("click", onClick); host.removeEventListener("change", onChange); Hooks.off("moinenMapsWeather", id); cancelAnimationFrame(frame); window.removeEventListener("keydown", key, true); };
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
  const fx = Object.entries(st.state?.fx ?? {}).map(([e, f]) => `${T(`Weather.fx.${e}`)} ${T("Weather.lvlShort")}${(f.s + 1).toFixed(1)} · ${pct(f.p)}`).join(", ") || T("Weather.none");
  const core = canvas.scene?.weather ? `<p class="mm-ws-hint mm-wx-warn"><i class="fa-solid fa-triangle-exclamation" inert></i> ${esc(T("Weather.coreWarn"))}</p>` : "";
  return `<p class="mm-d-status" role="status">${esc(game.i18n.format("MOINENMAPS.Weather.status", { preset: T(`Weather.p.${k?.preset ?? "clear"}`), level: k?.level ?? 2, fx, wet: pct(st.state?.wet ?? 0), cover: pct(st.state?.cover ?? 0) }))}</p>
    ${st.state && !st.state.steady ? `<p class="mm-ws-hint">${esc(T("Weather.changing"))}</p>` : ""}${core}
    ${optCheck({ name: "g.on", label: T("Weather.f.on"), checked: P.on, hint: T("Weather.h.on") })}
    ${optSelect({ name: "g.who", label: T("Weather.f.who"), value: P.who, options: [["all", T("Weather.o.all")], ["gm", T("Weather.o.gm")]], hint: T("Weather.h.who") })}
    <p class="mm-ws-hint">${esc(game.i18n.format("MOINENMAPS.Weather.cost", { n: (st.instances ?? 0) + (st.parts ?? 0), ms: (st.tickMs ?? 0).toFixed(3), lens: st.lens ? T("Weather.lensOnShort") : T("Weather.lensOffShort") }))}</p>`;
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
  { id: "tornado", title: "MOINENMAPS.Weather.pTornado", icon: "fa-solid fa-tornado", open: false, mount: panel({
    kinds: ["changed", "params", "loaded"],
    html: () => {
      const gm = game.user.isGM, dis = gm ? "" : " disabled";
      const lvBtns = (cur, act, id = "") => [1, 2, 3].map((v) => `<button type="button" class="mm-ws-toolbtn mm-d-level" data-act="${act}" data-id="${id}" data-v="${v}" aria-pressed="${v === cur}" style="--mm-tool:${LEVEL_COLOR[v]}"${dis}><span class="mm-d-dot" inert></span><span>${esc(T(`Weather.lvl${v}`))}</span></button>`).join("");
      const ends = TM.ENDS.map((e) => [e, T(`Weather.tEnd.${e}`)]);
      const rows = Wx.tornadoApi.list().filter((t) => !t.phase.gone).map((t, i) => `<div class="mm-ws-opt"><span class="mm-ws-label">${esc(game.i18n.format("MOINENMAPS.Weather.tornadoN", { n: i + 1, end: T(`Weather.tEnd.${t.end}`) }))}${t.out !== null ? ` · ${esc(T("Weather.tornadoGoing"))}` : ""}</span>
        <div class="mm-ws-tools mm-d-levels" role="group">${lvBtns(t.level, "tlv", t.id)}<button type="button" class="mm-ws-toolbtn" data-act="tout" data-id="${t.id}" data-tooltip="${esc(T("Weather.tornadoOutHint"))}" aria-label="${esc(T("Weather.tornadoOut"))}"${dis}><i class="fa-solid fa-wind" inert></i></button></div></div>`).join("");
      return `<div class="mm-d-form">
        <div class="mm-ws-opt"><span class="mm-ws-label">${esc(T("Weather.tornadoNew"))}</span><div class="mm-ws-tools mm-d-levels" role="group">${lvBtns(newT.level, "tnew")}</div></div>
        ${optRange({ name: "t.speed", label: T("Weather.tornadoSpeed"), value: newT.speed, min: TM.LIMITS.speed[0], max: TM.LIMITS.speed[1], step: 0.05, hint: T("Weather.tornadoSpeedHint") })}
        ${optSelect({ name: "t.end", label: T("Weather.tornadoEnd"), value: newT.end, options: ends, hint: T("Weather.tornadoEndHint") })}
        ${rows || `<p class="mm-ws-hint">${esc(T("Weather.tornadoNone"))}</p>`}
        <div class="mm-d-actions"><button type="button" class="mm-ws-btn" data-act="tall"${gm && rows ? "" : " disabled"}><i class="fa-solid fa-wind" inert></i> ${esc(T("Weather.tornadoAllOut"))}</button></div>
        <p class="mm-ws-hint">${esc(T("Weather.tornadoHint"))}</p></div>`;
    },
    onChange: (n, v) => { if ( n === "t.speed" ) newT.speed = Number(v); else if ( n === "t.end" && TM.ENDS.includes(v) ) newT.end = v; },
    onClick: (b) => {
      const a = b.dataset.act, v = Number(b.dataset.v);
      if ( a === "tnew" ) { newT.level = v; for ( const x of b.parentElement.querySelectorAll("[data-act=tnew]") ) x.setAttribute("aria-pressed", String(Number(x.dataset.v) === v)); }
      else if ( a === "tlv" ) Wx.tornadoApi.update(b.dataset.id, { level: v });
      else if ( a === "tout" ) Wx.tornadoApi.remove(b.dataset.id);
      else if ( a === "tall" ) Wx.tornadoApi.clear();
    }
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
      ${optSelect({ name: "g.lensLevel", label: T("Weather.lensLevel"), value: L.level, options: [["auto", T("Weather.lensAuto")], [1, T("Weather.lvl1")], [2, T("Weather.lvl2")], [3, T("Weather.lvl3")]], hint: T("Weather.lensLevelHint") })}
      ${optRange({ name: "g.lensStrength", label: T("Weather.lensStrength"), value: L.strength, min: 0, max: 1, step: 0.05, hint: T("Weather.lensStrengthHint") })}
      ${optCheck({ name: "g.lensHeat", label: T("Weather.lensHeat"), checked: L.heat, hint: T("Weather.lensHeatHint") })}
      <p class="mm-ws-hint">${esc(T("Weather.lensPlayers"))}</p></div>`; },
    onChange: (n, v) => {
      if ( n === "g.lensOn" ) Wx.setParams({ lens: { on: v } });
      else if ( n === "g.lensLevel" ) Wx.setParams({ lens: { level: v === "auto" ? "auto" : Number(v) } });
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
