import { extendSection } from "../workspace/registry.mjs";
import { esc, T, optRange, optSelect, optCheck, optHint, isEcho, writeControl, bindSettings, onSetting } from "../workspace/ui.mjs";
import { MODULE_ID } from "../config.mjs";
import * as M from "./model.mjs";
import * as Fire from "./fire.mjs";
import * as Editor from "./editor.mjs";
import { PRESETS } from "./look.mjs";

/**
 * FIRE AND SMOKE in the Destruction workspace (added with extendSection: section.mjs is unchanged):
 *  - tools: a fire brush, a smoke brush, a DUST brush (ground dust and grit kicked up by something moving: a motorbike, a car, small or
 *    large rubble dragged - its kind and level 1..3), an eraser of this layer;
 *  - bar: size, strength and wind (direction + strength) of the brush in hand; the fire brush's FIRE LEVEL and its own SMOKE LEVEL
 *    side by side (smoke with "off"), its style (fire / fireball) and its COLOUR (the scene's, seven presets, a custom colour);
 *    the smoke brush's smoke level - the same level buttons as
 *    destruction's (client settings, each remembered; pinned on each stroke); TORN EDGES on / off (the scene's setting, as
 *    destruction's quick torn-borders button: new strokes pin it);
 *  - dock panel "Fire and smoke": the layer on/off, who sees it, flame height, plume length, smoke from fire, speed, how fast fire
 *    catches, grows and goes out, the scene's fire colour, the smoke tint, the light (on, radius, intensity, colour follows the
 *    fire or an override, flicker), torn edges + tearing, and the list of strokes (newest first, its
 *    levels - click to change them -, torn on / off for that stroke, and delete one), Clear.
 */
const TOOLS = { "mm-fire-paint": "fire", "mm-fire-smoke": "smoke", "mm-fire-dust": "dust", "mm-fire-erase": "erase" };
const KIND_ICON = { fire: "fa-solid fa-fire", smoke: "fa-solid fa-smog", erase: "fa-solid fa-eraser", dust: "fa-solid fa-wind" };
const KIND_INK = { fire: "#ff8a24", smoke: "#a8a29a", erase: "#ffffff", dust: "#c8b48c" };
/** DUST AND GRIT (dust-model.mjs): what passed along the path, and the level colours (light dust ... a thick cloud). */
const DUST_KINDS = ["bike", "car", "drag", "heavy"];
const DUST_KIND_INK = { bike: "#d9c9a3", car: "#c8b48c", drag: "#a8987a", heavy: "#8a7a62" };
const DUST_COLOR = ["#8c8c8c", "#e3d6b8", "#c8b48c", "#9a8664"];
/** The eight wind directions (degrees, screen: 0 = right, 90 = down), drawn as one arrow turned. */
const DIRS = [270, 315, 0, 45, 90, 135, 180, 225];
/** Level colours, as destruction's level buttons (0: smoke off). */
const LEVEL_COLOR = ["#8c8c8c", "#f2c14e", "#ef8a3a", "#e0453a"];
const SMK = (l) => T(`Fire.smk${l}`), SMKH = (l) => T(`Fire.smkHint${l}`);
const SMOKE_COLOR = ["#5a5a5a", "#c9c5bf", "#8f8a84", "#4a4541"];

/** The fire brush's colour row: the scene's colour (""), the presets, a custom colour. */
function colorRow(cur) {
  const sw = (v, name, ink) => `<button type="button" class="mm-ws-toolbtn mm-d-level" data-fire-color="${v}" aria-pressed="${v === cur}" style="--mm-tool:${ink}" data-tooltip="${esc(T(`Fire.colHint.${name}`))}"><span class="mm-d-dot" inert></span><span>${esc(T(`Fire.col.${name}`))}</span></button>`;
  const custom = cur && !Object.values(PRESETS).includes(cur);
  return `<div class="mm-ws-opt"><span class="mm-ws-label">${esc(T("Fire.color"))}</span><div class="mm-ws-tools mm-d-levels mm-fire-colors" role="group" aria-label="${esc(T("Fire.color"))}">
    ${sw("", "scene", Fire.params0().fireColor)}${Object.entries(PRESETS).map(([k, v]) => sw(v, k, v)).join("")}
    <label class="mm-fire-custom" data-tooltip="${esc(T("Fire.colHint.custom"))}" aria-pressed="${custom}"><input type="color" name="fireBrushColor" value="${esc(cur || PRESETS.natural)}" aria-label="${esc(T("Fire.col.custom"))}"><span>${esc(T("Fire.col.custom"))}</span></label></div></div>`;
}

/** One row of level buttons (destruction's control style): `attr` the data attribute, `vals`, the current value. */
function levelRow(label, attr, vals, cur, name, hint, colors) {   // name / hint: (value) -> text
  const btn = (l) => `<button type="button" class="mm-ws-toolbtn mm-d-level" data-${attr}="${l}" aria-pressed="${l === cur}" style="--mm-tool:${colors[l]}" data-tooltip="${esc(hint(l))}"><span class="mm-d-dot" inert></span><span>${esc(name(l))}</span></button>`;
  return `<div class="mm-ws-opt"><span class="mm-ws-label">${esc(T(label))}</span><div class="mm-ws-tools mm-d-levels" role="group" aria-label="${esc(T(label))}">${vals.map(btn).join("")}</div></div>`;
}

/* ---------------------------------------------------------------- the bar */

function bar(host, ctx) {
  const mode = TOOLS[ctx.tool], b = Editor.brush();
  const size = optRange({ name: "fireBrush", label: T("Fire.size"), value: b.size, min: 0.25, max: 10, step: 0.25, hint: T("Fire.sizeHint") });
  if ( mode === "erase" ) host.innerHTML = `${size}${optHint(T("Fire.eraseHint"))}`;
  else if ( mode === "dust" ) {
    const dirs = DIRS.map((d) => `<button type="button" class="mm-ws-toolbtn" data-wind-dir="${d}" aria-pressed="${d === b.windDir}" aria-label="${esc(T(`Fire.dir.${d}`))}" data-tooltip="${esc(T(`Fire.dir.${d}`))}"><i class="fa-solid fa-arrow-right fa-rotate-by" style="--fa-rotate-angle:${d}deg" inert></i></button>`).join("");
    host.innerHTML = `${size}
      ${levelRow("Fire.dustKind", "dust-kind", DUST_KINDS, b.dust, (k) => T(`Fire.dk.${k}`), (k) => T(`Fire.dkHint.${k}`), DUST_KIND_INK)}
      ${levelRow("Fire.dustLevel", "dust-level", [1, 2, 3], b.dustLevel, (l) => T(`Fire.dst${l}`), (l) => T(`Fire.dstHint${l}`), DUST_COLOR)}
      ${optRange({ name: "fireWind", label: T("Fire.wind"), value: b.wind, min: 0, max: 1, step: 0.05, hint: T("Fire.dustWindHint") })}
      <div class="mm-ws-opt"><span class="mm-ws-label">${esc(T("Fire.windDir"))}</span><div class="mm-ws-tools" role="group" aria-label="${esc(T("Fire.windDir"))}">${dirs}</div></div>
      ${optHint(T("Fire.dustHint"))}`;
  } else {
    const dirs = DIRS.map((d) => `<button type="button" class="mm-ws-toolbtn" data-wind-dir="${d}" aria-pressed="${d === b.windDir}" aria-label="${esc(T(`Fire.dir.${d}`))}" data-tooltip="${esc(T(`Fire.dir.${d}`))}"><i class="fa-solid fa-arrow-right fa-rotate-by" style="--fa-rotate-angle:${d}deg" inert></i></button>`).join("");
    const levels = mode === "smoke"
      ? levelRow("Fire.smokeLevel", "smoke-level", [1, 2, 3], b.smokeLevel, SMK, SMKH, SMOKE_COLOR)
      : `${levelRow("Fire.level", "fire-level", [1, 2, 3], b.level, (l) => T(`Fire.lvl${l}`), (l) => T(`Fire.lvlHint${l}`), LEVEL_COLOR)}
         ${levelRow("Fire.smokeLevel", "fire-smoke", [0, 1, 2, 3], b.fireSmoke, SMK, SMKH, SMOKE_COLOR)}
         ${levelRow("Fire.style", "fire-style", ["fire", "fireball"], b.style, (l) => T(`Fire.sty.${l}`), (l) => T(`Fire.styHint.${l}`), { fire: "#ff8a24", fireball: "#ffb030" })}
         ${colorRow(b.color)}`;
    host.innerHTML = `${size}${levels}
      ${optRange({ name: "fireStrength", label: T("Fire.strength"), value: b.strength, min: 0.1, max: 1, step: 0.05, hint: T("Fire.strengthHint") })}
      ${optRange({ name: "fireWind", label: T("Fire.wind"), value: b.wind, min: 0, max: 1, step: 0.05, hint: T("Fire.windHint") })}
      <div class="mm-ws-opt"><span class="mm-ws-label">${esc(T("Fire.windDir"))}</span><div class="mm-ws-tools" role="group" aria-label="${esc(T("Fire.windDir"))}">${dirs}</div></div>
      <div class="mm-ws-opt"><div class="mm-ws-tools" role="group"><button type="button" class="mm-ws-toolbtn" data-fire-torn aria-pressed="${!!Fire.params0().torn}" aria-label="${esc(T("Fire.quickTorn"))}" data-tooltip="${esc(T("Fire.quickTorn"))}"${game.user.isGM ? "" : " disabled"}><i class="fa-solid fa-wave-square" inert></i></button></div></div>
      ${optHint(mode === "smoke" ? T("Fire.smokeHint") : T("Fire.paintHint"))}`;
  }
  const off = bindSettings(host, { fireBrush: "fireBrush", fireStrength: "fireStrength", fireWind: "fireWind" });
  const PICK = { windDir: "fireWindDir", fireLevel: "fireLevel", fireSmoke: "fireSmoke", smokeLevel: "smokeLevel", fireStyle: "fireStyle", fireColor: "fireBrushColor", dustKind: "dustKind", dustLevel: "dustLevel" };
  const STR = new Set(["fireStyle", "fireColor", "dustKind"]);
  const onClick = (ev) => {
    if ( ev.target.closest?.("[data-fire-torn]") ) { Fire.setParams({ torn: !Fire.params0().torn }); return; }
    for ( const k of Object.keys(PICK) ) {
      const d = ev.target.closest?.(`[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`); if ( !d ) continue;
      const v = d.dataset[k]; game.settings.set(MODULE_ID, PICK[k], STR.has(k) ? v : Number(v)); return;
    }
  };
  // the custom colour (a colour input): picking it makes it the brush's colour
  const onInput = (ev) => { const c = ev.target.closest?.("input[name=fireBrushColor]"); if ( c ) game.settings.set(MODULE_ID, "fireBrushColor", c.value.toLowerCase()); };
  host.addEventListener("click", onClick); host.addEventListener("change", onInput);
  const sync = () => {
    const nb = Editor.brush(), cur = { windDir: nb.windDir, fireLevel: nb.level, fireSmoke: nb.fireSmoke, smokeLevel: nb.smokeLevel, fireStyle: nb.style, fireColor: nb.color, dustKind: nb.dust, dustLevel: nb.dustLevel };
    for ( const k of Object.keys(PICK) ) for ( const x of host.querySelectorAll(`[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`) ) {
      x.setAttribute("aria-pressed", String((STR.has(k) ? x.dataset[k] : Number(x.dataset[k])) === cur[k]));
    }
    const cu = host.querySelector(".mm-fire-custom");
    if ( cu ) { const own = !!nb.color && !Object.values(PRESETS).includes(nb.color); cu.setAttribute("aria-pressed", String(own)); if ( own ) cu.querySelector("input").value = nb.color; }
  };
  const offDir = onSetting(Object.values(PICK), sync);
  const idT = Hooks.on("moinenMapsFire", (kind) => { if ( kind === "params" || kind === "loaded" ) host.querySelector("[data-fire-torn]")?.setAttribute("aria-pressed", String(!!Fire.params0().torn)); });
  return () => { off(); offDir(); Hooks.off("moinenMapsFire", idT); host.removeEventListener("click", onClick); host.removeEventListener("change", onInput); };
}

/* ---------------------------------------------------------------- the dock */

function mountPanel(host) {
  if ( game.user.isGM ) Fire.warmUp();                                 // (the fire panel open: a stroke is coming)
  const gm = game.user.isGM;
  const rowsOf = (P) => Fire.list().reverse().map((s) => {
      const name = T(`Fire.kind.${s.k}`) + (s.st === "fireball" ? ` (${T("Fire.sty.fireball")})` : s.k === "dust" ? ` (${T(`Fire.dk.${s.dk}`)})` : "");
      const tip = s.k === "erase" ? name : s.k === "dust" ? `${name} · ${T("Fire.wind")} ${Math.round(s.ws * 100)}%` : `${name} · ${Math.round(s.s * 100)}% · ${T("Fire.wind")} ${Math.round(s.ws * 100)}%`;
      // the levels: click to step them (fire 1..3, smoke 0..3 / 1..3)
      const lvl = s.k === "fire" ? `<button type="button" class="mm-fire-lv" data-act="lv" data-id="${esc(s.id)}" style="--mm-tool:${LEVEL_COLOR[s.lv]}" data-tooltip="${esc(`${T("Fire.level")}: ${T(`Fire.lvl${s.lv}`)}`)}"${gm ? "" : " disabled"}>${esc(T("Fire.lvlShort"))}${s.lv}</button>`
        : s.k === "dust" ? `<button type="button" class="mm-fire-lv" data-act="lv" data-id="${esc(s.id)}" style="--mm-tool:${DUST_COLOR[s.lv]}" data-tooltip="${esc(`${T("Fire.dustLevel")}: ${T(`Fire.dst${s.lv}`)}`)}"${gm ? "" : " disabled"}>${esc(T("Fire.lvlShort"))}${s.lv}</button>` : "";
      const smk = s.k !== "erase" && s.k !== "dust" ? `<button type="button" class="mm-fire-lv" data-act="sm" data-id="${esc(s.id)}" style="--mm-tool:${SMOKE_COLOR[s.sm]}" data-tooltip="${esc(`${T("Fire.smokeLevel")}: ${T(`Fire.smk${s.sm}`)}`)}"${gm ? "" : " disabled"}>${esc(T("Fire.smkShort"))}${s.sm}</button>` : "";
      const torn = s.k !== "erase" && s.k !== "dust" && s.st !== "fireball" ? `<button type="button" class="mm-fire-lv" data-act="torn" data-id="${esc(s.id)}" aria-pressed="${!!s.tn}" style="--mm-tool:${s.tn ? "#ef8a3a" : "#8c8c8c"}" data-tooltip="${esc(T(s.tn ? "Fire.tornOn" : "Fire.tornOff"))}"${gm ? "" : " disabled"}><i class="fa-solid fa-wave-square" inert></i></button>` : "";
      return `<li data-stroke="${esc(s.id)}"><i class="${KIND_ICON[s.k]}" style="color:${s.k === "fire" ? esc(s.c ?? P.fireColor) : KIND_INK[s.k]}" inert></i><span class="mm-d-kind" data-tooltip="${esc(tip)}">${esc(name)}</span><span class="mm-fire-lvs">${lvl}${smk}${torn}</span>
        ${gm ? `<button type="button" class="mm-fire-del" data-act="del" data-id="${esc(s.id)}" aria-label="${esc(T("Fire.delete"))}" data-tooltip="${esc(T("Fire.delete"))}"><i class="fa-solid fa-trash" inert></i></button>` : "<span></span>"}</li>`;
    }).join("");
  const statusOf = (st) => game.i18n.format("MOINENMAPS.Fire.status", { n: st.strokes, a: st.areas, l: st.lights });
  const listOf = (rows) => (rows ? `<ul class="mm-d-areas mm-d-objs mm-fire-list" aria-label="${esc(T("Fire.strokes"))}">${rows}</ul>` : `<p class="mm-ws-hint">${esc(T("Fire.empty"))}</p>`);
  const render = () => {
    const P = Fire.params0(), L = M.LIMITS, st = Fire.fireApi.status();
    const range = (k, step = 0.05) => optRange({ name: `p.${k}`, label: T(`Fire.f.${k}`), value: P[k], min: L[k][0], max: L[k][1], step, hint: T(`Fire.h.${k}`) });
    const rows = rowsOf(P);
    host.innerHTML = `<div class="mm-d-form mm-fire-panel">
      <p class="mm-d-status" role="status">${esc(statusOf(st))}</p>
      ${listOf(rows)}
      <div class="mm-d-actions"><button type="button" class="mm-ws-btn" data-act="clear"${st.strokes && gm ? "" : " disabled"}><i class="fa-solid fa-trash" inert></i> ${esc(T("Fire.clear"))}</button></div>
      ${optCheck({ name: "p.on", label: T("Fire.f.on"), checked: P.on, hint: T("Fire.h.on") })}
      ${optSelect({ name: "p.who", label: T("Fire.f.who"), value: P.who, options: [["all", T("Fire.o.all")], ["gm", T("Fire.o.gm")]] })}
      ${range("flame")}${range("plume", 0.25)}${range("smoke")}${range("speed")}
      ${range("spread", 0.5)}${range("grow", 0.1)}${range("out", 0.1)}
      ${optCheck({ name: "p.torn", label: T("Fire.f.torn"), checked: P.torn, hint: T("Fire.h.torn") })}
      <div class="mm-fire-tear"${P.torn ? "" : " hidden"}>${range("tear")}</div>
      <div class="mm-ws-opt"><label data-tooltip="${esc(T("Fire.h.fireColor"))}">${esc(T("Fire.f.fireColor"))}</label><input type="color" name="p.fireColor" value="${esc(P.fireColor)}"></div>
      ${range("smokeTint")}
      <fieldset class="mm-fire-light"><legend>${esc(T("Fire.light"))}</legend>
        ${optCheck({ name: "p.light", label: T("Fire.f.light"), checked: P.light, hint: T("Fire.h.light") })}
        ${range("lightRadius", 0.1)}${range("lightIntensity")}${range("lightFlicker")}
        ${optCheck({ name: "p.lightFollow", label: T("Fire.f.lightFollow"), checked: P.lightFollow, hint: T("Fire.h.lightFollow") })}
        <div class="mm-ws-opt"><label data-tooltip="${esc(T("Fire.h.lightColor"))}">${esc(T("Fire.f.lightColor"))}</label><input type="color" name="p.lightColor" value="${esc(P.lightColor)}"></div>
      </fieldset></div>`;
    if ( !gm ) for ( const c of host.querySelectorAll("[name^='p.']") ) c.disabled = true;
  };
  // A12c: an EDIT (a stroke painted, erased, undone - kind "edited") rewrites only the status line, the stroke list and the clear
  // button: rebuilding the whole panel (its sliders, pickers and fieldsets) cost a long frame of layout on an older CPU at every release
  const renderList = () => {
    const form = host.querySelector(".mm-fire-panel"), s = form?.querySelector(":scope > .mm-d-status"), l = form?.querySelector(":scope > .mm-fire-list, :scope > .mm-ws-hint");
    if ( !s || !l ) { render(); return; }
    if ( l.contains(document.activeElement) ) return;                // (a list button in focus: left as it is, as before)
    const st = Fire.fireApi.status();
    s.textContent = statusOf(st);
    l.outerHTML = listOf(rowsOf(Fire.params0()));
    const clr = form.querySelector(":scope > .mm-d-actions [data-act='clear']"); if ( clr ) clr.disabled = !(st.strokes && gm);
  };
  render();
  const read = (c) => c.matches("input[type=checkbox]") ? c.checked : c.matches("range-picker, input[type=number]") ? Number(c.value) : c.value;
  const onChange = (ev) => {
    if ( isEcho() || !gm ) return;
    const c = ev.target.closest?.("[name^='p.']"); if ( !c ) return;
    const k = c.name.slice(2), v = read(c);
    if ( v !== Fire.params0()[k] ) Fire.setParams({ [k]: v });
  };
  const onClick = async (ev) => {
    const b = ev.target.closest?.("[data-act]"); if ( !b || !gm ) return;
    b.blur();
    if ( b.dataset.act === "del" ) Fire.remove(b.dataset.id);
    else if ( b.dataset.act === "torn" ) { const st = Fire.list().find((x) => x.id === b.dataset.id); if ( st ) Fire.setTorn(st.id, st.tn ? 0 : true); }
    else if ( b.dataset.act === "lv" || b.dataset.act === "sm" ) {
      const st = Fire.list().find((x) => x.id === b.dataset.id); if ( !st ) return;
      if ( b.dataset.act === "lv" ) Fire.setLevels(st.id, { lv: st.lv % 3 + 1 });
      else Fire.setLevels(st.id, { sm: st.k === "smoke" ? st.sm % 3 + 1 : (st.sm + 1) % 4 });
    }
    else if ( b.dataset.act === "clear" ) {
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: T("Fire.clear") }, content: `<p>${esc(T("Fire.clearConfirm"))}</p>` }).catch(() => false);
      if ( ok ) Fire.clear();
    }
  };
  host.addEventListener("change", onChange); host.addEventListener("click", onClick);
  let frame = 0, full = false;
  const id = Hooks.on("moinenMapsFire", (kind) => {
    if ( kind !== "edited" ) full = true;
    if ( frame ) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const all = full; full = false;
      if ( !all ) { renderList(); return; }
      if ( !host.contains(document.activeElement) || document.activeElement === document.body ) { render(); return; }
      const P = Fire.params0();
      for ( const c of host.querySelectorAll("[name^='p.']") ) if ( !c.contains(document.activeElement) ) writeControl(c, P[c.name.slice(2)]);
      const tr = host.querySelector(".mm-fire-tear"); if ( tr ) tr.hidden = !P.torn;
    });
  });
  return () => { host.removeEventListener("change", onChange); host.removeEventListener("click", onClick); Hooks.off("moinenMapsFire", id); cancelAnimationFrame(frame); };
}

/* ---------------------------------------------------------------- wiring */

const OFF = (() => { try { return globalThis.localStorage?.getItem("mm-destruction") === "off" || globalThis.localStorage?.getItem("mm-fire") === "off"; } catch { return false; } })();

if ( !OFF ) {
  Fire.registerFire();
  Hooks.once("init", () => Editor.registerFireSettings(() => Fire.tell("brush")));
  Hooks.on("canvasReady", () => Editor.onCanvasReady());
  Hooks.on("canvasTearDown", () => Editor.teardown());
  Hooks.once("init", () => extendSection("destruction", {
    tools: () => [
      { name: "mm-fire-paint", order: 4, title: "MOINENMAPS.Fire.tool.fire", icon: "fa-solid fa-fire", color: KIND_INK.fire },
      { name: "mm-fire-smoke", order: 5, title: "MOINENMAPS.Fire.tool.smoke", icon: "fa-solid fa-smog", color: KIND_INK.smoke },
      { name: "mm-fire-dust", order: 5.5, title: "MOINENMAPS.Fire.tool.dust", icon: KIND_ICON.dust, color: KIND_INK.dust },
      { name: "mm-fire-erase", order: 6, title: "MOINENMAPS.Fire.tool.erase", icon: "fa-solid fa-fire-extinguisher", color: KIND_INK.erase }
    ],
    bars: Object.fromEntries(Object.keys(TOOLS).map((t) => [t, bar])),
    onToolChange: (tool, active) => {
      if ( !(tool in TOOLS) ) return;
      Editor.setMode(active ? TOOLS[tool] : null);
      if ( active && TOOLS[tool] !== "erase" ) Fire.warmUp();          // (the fire's programs warmed before the first stroke: fire.mjs)
    },
    panels: [{ id: "fire", title: "MOINENMAPS.Fire.panel", icon: "fa-solid fa-fire", open: true, mount: mountPanel }]
  }));
}
