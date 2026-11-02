import { registerSection } from "../workspace/registry.mjs";
import { esc, T, optRange, optSelect, optCheck, optHint } from "../workspace/ui.mjs";
import { MODULE_ID } from "../config.mjs";
import * as Model from "./model.mjs";
import * as Editor from "./editor.mjs";
import * as D from "./destruction.mjs";

/**
 * Destruction as a workspace section (takes over the "destruction" placeholder of workspace/soon.mjs).
 *  - bar: a hand (the map as usual), the damage brush and the eraser; the brush's options are its size, its level (cracked, broken,
 *    crater), the kind of damage and its cause (what did it; "scene default" stores none); Detonate replays the break for everyone.
 *  - dock: Damage (every stroke, newest first: its kind, the surface it tore up and its cause, changeable per stroke; the bake state,
 *    variation, clear), Look (the scene's default cause, how much debris, how far it flies, how it heaves, rubble, halo, ragged edge,
 *    the surface underneath) and Motion.
 */
const TOOLS = { "mm-d-pick": null, "mm-d-paint": "paint", "mm-d-erase": "erase" };
const TYPE_ICON = { blast: "fa-solid fa-explosion", collapse: "fa-solid fa-hill-rockslide", scorch: "fa-solid fa-fire", flood: "fa-solid fa-water", cracks: "fa-solid fa-burst", gash: "fa-solid fa-paw" };
const LEVEL_COLOR = ["", "#f2c14e", "#ef8a3a", "#e0453a"];
/** Causes (what did the damage): an icon and an ink each; "none" is the scene default. */
const CAUSE_ICON = { none: "fa-regular fa-circle", fire: "fa-solid fa-fire-flame-curved", acid: "fa-solid fa-flask", lightning: "fa-solid fa-bolt", arcane: "fa-solid fa-wand-sparkles",
  impact: "fa-solid fa-meteor", claws: "fa-solid fa-dragon", water: "fa-solid fa-droplet", decay: "fa-solid fa-hourglass-half", frost: "fa-solid fa-snowflake" };
const CAUSE_INK = { none: "", fire: "#ff8a3c", acid: "#a8e04a", lightning: "#9fd2ff", arcane: "#c08cff", impact: "#d9c3a5", claws: "#e8dcc8", water: "#6fb7ff", decay: "#9aa868", frost: "#dff0ff" };
const causeName = (c) => T(c ? `Destr.cause.${Model.CAUSES[c]}` : "Destr.causeNone");
/** The cause options of a select: 0 = the scene default (named), then every cause. */
const causeOptions = (zeroLabel) => Model.CAUSES.map((c, i) => [i, i ? causeName(i) : zeroLabel]);

/**
 * Kill switch, per browser: localStorage "mm-destruction" = "off" leaves the feature out entirely (no hooks, no section; the
 * placeholder stays). Default: on.
 */
const OFF = (() => { try { return globalThis.localStorage?.getItem("mm-destruction") === "off"; } catch { return false; } })();

// the engine's hooks and API come with the section: importing this file (workspace/sections.mjs) is the whole wiring
if ( !OFF ) D.registerDestruction();

/**
 * Write a value into a control WITHOUT it reporting a change: Foundry's <range-picker> dispatches "change" whenever its value is set
 * from code (even to the same value). Echoing a stored value back into a control must never look like the user's edit, or
 * control -> setting -> hook -> control loops forever (this froze the whole client once).
 */
let echoing = 0;
function writeControl(c, v) {
  if ( c.matches("input[type=checkbox]") ) { if ( c.checked !== !!v ) c.checked = !!v; return; }
  if ( String(c.value) === String(v) || Number(c.value) === Number(v) ) return;
  echoing++;
  try { c.value = v; } finally { echoing--; }
}

/** Wire controls named after scene params to the engine (sliders commit on release, checkboxes and selects at once). */
function bindParams(host) {
  const read = (c) => c.matches("input[type=checkbox]") ? c.checked : c.matches("range-picker, input[type=number]") ? Number(c.value) : c.value;
  const onChange = (ev) => {
    if ( echoing ) return;
    const c = ev.target.closest?.("[name]"); if ( !c?.name?.startsWith("p.") ) return;
    D.setParams({ [c.name.slice(2)]: read(c) });
  };
  host.addEventListener("change", onChange);
  const id = Hooks.on("moinenMapsDestruction", (kind) => {
    if ( kind !== "loaded" && kind !== "params" ) return;
    const P = D.state()?.params ?? Model.PARAM_DEFAULTS;
    for ( const c of host.querySelectorAll("[name^='p.']") ) {
      if ( c.contains(document.activeElement) ) continue;
      writeControl(c, P[c.name.slice(2)]);
    }
  });
  return () => { host.removeEventListener("change", onChange); Hooks.off("moinenMapsDestruction", id); };
}

/* ---------------------------------------------------------------- the bar */

function bar(host, ctx) {
  const mode = TOOLS[ctx.tool];
  const P0 = () => D.state()?.params ?? Model.PARAM_DEFAULTS;
  const quick = (k, icon, label) => `<button type="button" class="mm-ws-toolbtn" data-quick="${k}" aria-pressed="${!!P0()[k]}" aria-label="${esc(T(label))}" data-tooltip="${esc(T(label))}"><i class="${icon}" inert></i></button>`;
  const carryOn = () => !!game.settings.get(MODULE_ID, "destrCarry");
  const carryBtn = `<button type="button" class="mm-ws-toolbtn" data-carry aria-pressed="${carryOn()}" aria-label="${esc(T("Destr.quickCarry"))}" data-tooltip="${esc(T("Destr.quickCarryHint"))}"><i class="fa-solid fa-people-carry-box" inert></i></button>`;
  const superOn = () => !!game.settings.get(MODULE_ID, "destrSuper");
  const superBtn = `<button type="button" class="mm-ws-toolbtn" data-super aria-pressed="${superOn()}" aria-label="${esc(T("Destr.quickSuper"))}" data-tooltip="${esc(T("Destr.quickSuperHint"))}"><i class="fa-solid fa-mask" inert></i></button>`;
  if ( !mode ) { host.innerHTML = optHint(T("Destr.pickHint")); return; }
  const b = Editor.brush();
  const size = optRange({ name: "size", label: T("Destr.size"), value: b.size, min: 0.25, max: 10, step: 0.25, hint: T("Destr.sizeHint") });
  if ( mode === "erase" ) { host.innerHTML = `${size}${optHint(T("Destr.eraseHint"))}`; }
  else {
    const levels = Model.LEVELS.map((l) => `<button type="button" class="mm-ws-toolbtn mm-d-level" data-level="${l}" aria-pressed="${l === b.level}" style="--mm-tool:${LEVEL_COLOR[l]}" data-tooltip="${esc(T(`Destr.levelHint${l}`))}"><span class="mm-d-dot" inert></span><span>${esc(T(`Destr.level${l}`))}</span></button>`).join("");
    const types = Model.TYPES.map((t, i) => `<button type="button" class="mm-ws-toolbtn" data-type="${i}" aria-pressed="${i === b.type}" aria-label="${esc(T(`Destr.type.${t}`))}" data-tooltip="${esc(`${T(`Destr.type.${t}`)}: ${T(`Destr.typeHint.${t}`)}`)}"><i class="${TYPE_ICON[t]}" inert></i></button>`).join("");
    // the cause: 0 = the scene's default (the stroke stores none), named in its tooltip
    const sceneCause = causeName(P0().cause ?? 0);
    const causes = Model.CAUSES.map((c, i) => {
      const name = i ? causeName(i) : game.i18n.format("MOINENMAPS.Destr.causeDefault", { cause: sceneCause });
      const tip = `${name}: ${T(`Destr.causeHint.${c}`)} (Shift+${i})`;
      return `<button type="button" class="mm-ws-toolbtn mm-d-causebtn" data-cause="${i}" aria-pressed="${i === b.cause}" aria-label="${esc(name)}" data-tooltip="${esc(tip)}"${CAUSE_INK[c] ? ` style="--mm-tool:${CAUSE_INK[c]}"` : ""}><i class="${CAUSE_ICON[c]}" inert></i></button>`;
    }).join("");
    host.innerHTML = `${size}
      <div class="mm-ws-opt"><span class="mm-ws-label">${esc(T("Destr.level"))}</span><div class="mm-ws-tools mm-d-levels" role="group" aria-label="${esc(T("Destr.level"))}">${levels}</div></div>
      <div class="mm-ws-opt"><span class="mm-ws-label">${esc(T("Destr.kind"))}</span><div class="mm-ws-tools" role="group" aria-label="${esc(T("Destr.kind"))}">${types}</div></div>
      <div class="mm-ws-opt"><span class="mm-ws-label">${esc(T("Destr.causeLabel"))}</span><div class="mm-ws-tools mm-d-causes" role="group" aria-label="${esc(T("Destr.causeLabel"))}">${causes}</div></div>
      <div class="mm-ws-opt"><div class="mm-ws-tools" role="group">${quick("jagged", "fa-solid fa-wave-square", "Destr.quickJagged")}${quick("directional", "fa-solid fa-route", "Destr.quickDirectional")}${carryBtn}${superBtn}</div></div>
      <span class="mm-ws-hint mm-d-carryhint"${carryOn() ? "" : " hidden"}>${esc(T("Destr.carryArmedHint"))}</span>
      ${optHint(T("Destr.paintHint"))}`;
  }
  const onClick = (ev) => {
    if ( ev.target.closest("[data-carry]") ) game.settings.set(MODULE_ID, "destrCarry", !carryOn());
    if ( ev.target.closest("[data-super]") ) game.settings.set(MODULE_ID, "destrSuper", !superOn());
    const lb = ev.target.closest("[data-level]"), tb = ev.target.closest("[data-type]"), qb = ev.target.closest("[data-quick]"), cb = ev.target.closest("[data-cause]");
    if ( qb ) D.setParams({ [qb.dataset.quick]: !P0()[qb.dataset.quick] });
    if ( cb && Number(cb.dataset.cause) !== Editor.brush().cause ) game.settings.set(MODULE_ID, "destrCause", Number(cb.dataset.cause));
    if ( lb && Number(lb.dataset.level) !== Editor.brush().level ) game.settings.set(MODULE_ID, "destrLevel", Number(lb.dataset.level));
    if ( tb && Number(tb.dataset.type) !== Editor.brush().type ) game.settings.set(MODULE_ID, "destrType", Number(tb.dataset.type));
  };
  const onChange = (ev) => {
    if ( echoing ) return;
    const c = ev.target.closest?.("[name=size]"); if ( !c ) return;
    const v = Math.min(10, Math.max(0.25, Number(c.value) || 1.5));
    if ( v !== Editor.brush().size ) game.settings.set(MODULE_ID, "destrBrush", v);
  };
  host.addEventListener("click", onClick); host.addEventListener("change", onChange);
  const id = Hooks.on("moinenMapsDestruction", (kind) => {
    if ( kind === "params" || kind === "loaded" ) {
      for ( const x of host.querySelectorAll("[data-quick]") ) x.setAttribute("aria-pressed", String(!!P0()[x.dataset.quick]));
      // the "scene default" button names the scene's cause
      const d0 = host.querySelector("[data-cause='0']");
      if ( d0 ) { const name = game.i18n.format("MOINENMAPS.Destr.causeDefault", { cause: causeName(P0().cause ?? 0) }); d0.setAttribute("aria-label", name); d0.dataset.tooltip = `${name}: ${T("Destr.causeHint.none")} (Shift+0)`; }
      return;
    }
    if ( kind !== "brush" ) return;
    const nb = Editor.brush();
    host.querySelector("[data-carry]")?.setAttribute("aria-pressed", String(carryOn()));
    host.querySelector("[data-super]")?.setAttribute("aria-pressed", String(superOn()));
    const ch = host.querySelector(".mm-d-carryhint"); if ( ch ) ch.hidden = !carryOn();
    for ( const x of host.querySelectorAll("[data-level]") ) x.setAttribute("aria-pressed", String(Number(x.dataset.level) === nb.level));
    for ( const x of host.querySelectorAll("[data-type]") ) x.setAttribute("aria-pressed", String(Number(x.dataset.type) === nb.type));
    for ( const x of host.querySelectorAll("[data-cause]") ) x.setAttribute("aria-pressed", String(Number(x.dataset.cause) === nb.cause));
    const s = host.querySelector("[name=size]"); if ( s && !s.contains(document.activeElement) ) writeControl(s, nb.size);
  });
  return () => { host.removeEventListener("click", onClick); host.removeEventListener("change", onChange); Hooks.off("moinenMapsDestruction", id); };
}

/* ---------------------------------------------------------------- the dock */

function statusLine() {
  const st = D.getStatus(), S = D.state();
  // strokes gone missing are said first, even when nothing is left to show
  if ( st.warning ) return `${T("Destr.warning")}: ${st.warning}`;
  if ( !S || !Model.hasPaint(S) ) return T("Destr.empty");
  if ( st.error ) return `${T("Destr.error")}: ${st.error}`;
  if ( st.baking ) {
    const line = game.i18n.format("MOINENMAPS.Destr.baking", { pct: Math.round(st.progress * 100) });
    // strokes baked of how many, and about how long is left (from the pace so far)
    const total = st.bakeTotal ?? 0, done = st.bakeDone || Math.round((st.progress ?? 0) * total);
    if ( total < 2 || !done ) return line;
    const eta = Math.max(1, Math.round(((Date.now() - (st.bakeStart ?? Date.now())) / done) * (total - done) / 1000));
    return `${line} · ${game.i18n.format("MOINENMAPS.Destr.bakingCount", { done, total, eta })}`;
  }
  if ( st.waiting ) return T("Destr.waiting");
  const n = st.stats;
  const parts = [game.i18n.format("MOINENMAPS.Destr.areas", { n: st.areas.length })];
  if ( n ) parts.push(game.i18n.format("MOINENMAPS.Destr.pieces", { n: n.shards }));
  // where the strokes came from: status.source is "memory" or "chunk 3, baked 1" (destruction.mjs); unknown words are left out
  for ( const part of (st.source || "").split(",") ) {
    const [k, n] = part.trim().split(/\s+/);
    if ( k && game.i18n.has(`MOINENMAPS.Destr.src.${k}`) ) parts.push(game.i18n.format(`MOINENMAPS.Destr.src.${k}`, { n: n ?? "" }));
  }
  if ( S.baked?.key && st.key === S.baked.key ) parts.push(T("Destr.published"));
  // strokes still in a compatible older look (their new look is baked later: in the background, or on Rebake all)
  if ( st.compat ) parts.push(game.i18n.format(`MOINENMAPS.Destr.oldLook.${st.compat.mode === "ask" ? "ask" : "background"}`, { v: st.compat.from, n: st.compat.left }));
  // a Rebake all running, or the strokes pinned to the look of an older version (about half a second each to bake again)
  if ( st.rebake ) parts.push(game.i18n.format(st.rebake.paused ? "MOINENMAPS.Destr.rebakePaused" : "MOINENMAPS.Destr.rebaking", { done: st.rebake.done + (st.rebake.live ?? 0), total: st.rebake.total }));
  else if ( st.olderLook ) parts.push(game.i18n.format("MOINENMAPS.Destr.olderLook", { n: st.olderLook.n, from: st.olderLook.from, to: st.olderLook.to, eta: Math.max(1, Math.round(st.olderLook.n * 0.6)) }));
  return parts.join(" · ");
}

function mountDamage(host) {
  const render = () => {
    const st = D.getStatus(), S = D.state();
    // one row per stroke (newest first): its kind, the surface it tore up, and its cause (a select: change it and only that stroke
    // bakes again); "scene default" names the cause it follows
    const matOf = new Map();
    for ( const a of st.areas ) if ( a.obj && !matOf.has(a.obj) ) matOf.set(a.obj, a.mat);
    const def = Model.causeOf(S?.params?.cause), zero = game.i18n.format("MOINENMAPS.Destr.causeDefault", { cause: causeName(def) });
    const gm = game.user.isGM, older = new Set(st.olderLook?.ids ?? []);
    const rows = (S?.objects ?? []).filter((o) => !o.k).reverse().map((o) => {
      const t = Model.TYPES[o.t] ?? "blast", c = Model.causeOf(o.c), eff = Model.CAUSES[c || def], mat = matOf.get(o.id);
      const opts = causeOptions(zero).map(([v, l]) => `<option value="${v}"${v === c ? " selected" : ""}>${esc(l)}</option>`).join("");
      // the dock is narrow: kind and cause on the row, the surface it tore up in the kind's tooltip
      const kind = T(`Destr.type.${t}`), tip = mat ? `${kind} · ${T(`Destr.mat.${mat}`)}` : kind;
      return `<li data-obj="${esc(o.id)}"><i class="${TYPE_ICON[t] ?? TYPE_ICON.blast}" inert></i><span class="mm-d-kind" data-tooltip="${esc(tip)}">${esc(kind)}</span>
        <span class="mm-d-cause"${CAUSE_INK[eff] ? ` style="--mm-tool:${CAUSE_INK[eff]}"` : ""}><i class="${CAUSE_ICON[eff]}" inert></i><select data-cause-of="${esc(o.id)}" aria-label="${esc(T("Destr.causeOf"))}"${gm ? "" : " disabled"}>${opts}</select></span>${gm && older.has(o.id) && !st.rebake ? `<button type="button" class="mm-d-rebake" data-act="rebakeOne" data-obj="${esc(o.id)}" data-tooltip="${esc(T("Destr.rebakeOne"))}" aria-label="${esc(T("Destr.rebakeOne"))}"><i class="fa-solid fa-rotate" inert></i></button>` : ""}</li>`;
    }).join("");
    host.innerHTML = `<p class="mm-d-status" role="status">${esc(statusLine())}</p>
      ${rows ? `<ul class="mm-d-areas mm-d-objs" aria-label="${esc(T("Destr.strokesLabel"))}">${rows}</ul>` : ""}
      <div class="mm-d-actions">
        <button type="button" class="mm-ws-btn" data-act="detonate"${S && Model.hasPaint(S) ? "" : " disabled"}><i class="fa-solid fa-explosion" inert></i> ${esc(T("Destr.detonate"))}</button>
        <button type="button" class="mm-ws-btn" data-act="variation"${S && Model.hasPaint(S) ? "" : " disabled"} data-tooltip="${esc(T("Destr.variationHint"))}"><i class="fa-solid fa-dice" inert></i> ${esc(T("Destr.variation"))}</button>
        <button type="button" class="mm-ws-btn" data-act="clear"${S && Model.hasPaint(S) ? "" : " disabled"}><i class="fa-solid fa-trash" inert></i> ${esc(T("Destr.clear"))}</button>
        ${gm && st.paused ? `<button type="button" class="mm-ws-btn" data-act="bakeNow" data-tooltip="${esc(T("Destr.bakeNowHint"))}"><i class="fa-solid fa-rotate" inert></i> ${esc(T("Destr.bakeNow"))}</button>` : ""}
        ${gm && (st.compat || st.olderLook) && !st.paused && !st.rebake ? `<button type="button" class="mm-ws-btn" data-act="rebakeAll" data-tooltip="${esc(T("Destr.rebakeAllHint"))}"><i class="fa-solid fa-wand-magic-sparkles" inert></i> ${esc(T("Destr.rebakeAll"))}</button>` : ""}
        ${gm && st.rebake ? `<button type="button" class="mm-ws-btn" data-act="rebakePause"><i class="fa-solid ${st.rebake.paused ? "fa-play" : "fa-pause"}" inert></i> ${esc(T(st.rebake.paused ? "Destr.rebakeResume" : "Destr.rebakePause"))}</button>
          <button type="button" class="mm-ws-btn" data-act="rebakeCancel"><i class="fa-solid fa-xmark" inert></i> ${esc(T("Destr.rebakeCancel"))}</button>` : ""}
      </div>
      ${optCheck({ name: "enabled", label: T("Destr.enabled"), checked: S ? S.enabled : true, hint: T("Destr.enabledHint") })}`;
  };
  render();
  const onClick = async (ev) => {
    const b = ev.target.closest("[data-act]"); if ( !b ) return;
    b.blur();   // the button must not keep the keyboard (Ctrl+Z right after Detonate undoes the last stroke)
    if ( b.dataset.act === "detonate" ) D.detonate();
    else if ( b.dataset.act === "variation" ) D.newVariation();
    else if ( b.dataset.act === "bakeNow" ) D.bakeNow();
    else if ( b.dataset.act === "rebakeAll" ) D.rebakeAll();
    else if ( b.dataset.act === "rebakePause" ) D.rebakePause(!D.getStatus().rebake?.paused);
    else if ( b.dataset.act === "rebakeCancel" ) D.rebakeCancel();
    else if ( b.dataset.act === "rebakeOne" ) D.rebakeAll([b.dataset.obj]);
    else if ( b.dataset.act === "clear" ) {
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: T("Destr.clear") }, content: `<p>${esc(T("Destr.clearConfirm"))}</p>` });
      if ( ok ) D.clearAll();
    }
  };
  const onChange = (ev) => {
    if ( ev.target.name === "enabled" && ev.target.checked !== (D.state()?.enabled ?? true) ) D.setEnabled(ev.target.checked);
    if ( ev.target.dataset?.causeOf ) { D.setObjectCause(ev.target.dataset.causeOf, Number(ev.target.value)); ev.target.blur(); }
  };
  host.addEventListener("click", onClick); host.addEventListener("change", onChange);
  let frame = 0;
  const id = Hooks.on("moinenMapsDestruction", () => { if ( frame ) return; frame = requestAnimationFrame(() => { frame = 0; if ( !host.contains(document.activeElement) || document.activeElement === document.body ) render(); else host.querySelector(".mm-d-status").textContent = statusLine(); }); });
  return () => { host.removeEventListener("click", onClick); host.removeEventListener("change", onChange); Hooks.off("moinenMapsDestruction", id); cancelAnimationFrame(frame); };
}

function mountLook(host) {
  const P = D.state()?.params ?? Model.PARAM_DEFAULTS, L = Model.LIMITS;
  const range = (k, step = 0.05) => optRange({ name: `p.${k}`, label: T(`Destr.f.${k}`), value: P[k], min: L[k][0], max: L[k][1], step, hint: T(`Destr.h.${k}`) });
  host.innerHTML = `<div class="mm-d-form">
    ${optSelect({ name: "p.cause", label: T("Destr.f.cause"), value: Model.causeOf(P.cause), hint: T("Destr.h.cause"), options: causeOptions(T("Destr.causeNone")) })}
    ${optSelect({ name: "p.material", label: T("Destr.f.material"), value: P.material, hint: T("Destr.h.material"), options: Model.MATERIALS.map((m) => [m, T(`Destr.mat.${m}`)]) })}
    ${range("debris")}${range("scatter")}${range("lift")}${range("rubble")}${range("halo")}${range("edge")}
    ${optCheck({ name: "p.jagged", label: T("Destr.f.jagged"), checked: P.jagged, hint: T("Destr.h.jagged") })}
    <div class="mm-d-jag"${P.jagged ? "" : " hidden"}>${range("jag")}</div>
    ${optCheck({ name: "p.directional", label: T("Destr.f.directional"), checked: P.directional, hint: T("Destr.h.directional") })}
    <p class="mm-ws-hint">${esc(T("Destr.lookNewOnly"))}</p>
    <div class="mm-d-carry">
    ${optCheck({ name: "c.destrCarry", label: T("Destr.f.carry"), checked: game.settings.get(MODULE_ID, "destrCarry"), hint: T("Destr.h.carry") })}
    ${optCheck({ name: "c.destrSuper", label: T("Destr.f.super"), checked: game.settings.get(MODULE_ID, "destrSuper"), hint: T("Destr.h.super") })}
    ${optSelect({ name: "c.carryEnds", label: T("Destr.carryEnds"), value: game.settings.get(MODULE_ID, "carryEnds"), hint: T("Destr.carryEndsHint"), options: [["real", T("Destr.carryEndsReal")], ["return", T("Destr.carryEndsReturn")]] })}
    ${optCheck({ name: "c.carrySnap", label: T("Destr.carrySnap"), checked: game.settings.get(MODULE_ID, "carrySnap"), hint: T("Destr.carrySnapHint") })}
    </div>
    <button type="button" class="mm-ws-btn" data-act="applyLook" data-tooltip="${esc(T("Destr.applyLookHint"))}"><i class="fa-solid fa-paintbrush" inert></i> ${esc(T("Destr.applyLook"))}</button></div>`;
  const onApply = async (ev) => {
    const b = ev.target.closest?.("[data-act=applyLook]"); if ( !b || !game.user.isGM ) return;
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: T("Destr.applyLook") }, content: `<p>${esc(T("Destr.applyLookConfirm"))}</p>`, rejectClose: false, modal: true });
    if ( ok ) ui.notifications.info(game.i18n.format("MOINENMAPS.Destr.applyLookDone", { n: D.applyParams() }));
  };
  host.addEventListener("click", onApply);
  // the carry controls are the client's own settings (not the scene's): stored at once, updated when changed elsewhere (the bar's button)
  const onCarry = (ev) => {
    const c = ev.target.closest?.("[name^='c.']"); if ( !c ) return;
    game.settings.set(MODULE_ID, c.name.slice(2), c.matches("input[type=checkbox]") ? c.checked : c.value);
  };
  host.addEventListener("change", onCarry);
  const idC = Hooks.on("moinenMapsDestruction", (kind) => {
    if ( kind !== "brush" ) return;
    for ( const c of host.querySelectorAll("[name^='c.']") ) { if ( c.contains(document.activeElement) ) continue; writeControl(c, game.settings.get(MODULE_ID, c.name.slice(2))); }
  });
  // the tearing slider only while torn borders are on
  const id = Hooks.on("moinenMapsDestruction", (kind) => {
    if ( kind !== "loaded" && kind !== "params" ) return;
    const j = host.querySelector(".mm-d-jag"); if ( j ) j.hidden = !(D.state()?.params ?? Model.PARAM_DEFAULTS).jagged;
  });
  const off = bindParams(host);
  return () => { off(); host.removeEventListener("click", onApply); host.removeEventListener("change", onCarry); Hooks.off("moinenMapsDestruction", id); Hooks.off("moinenMapsDestruction", idC); };
}

function mountMotion(host) {
  const P = D.state()?.params ?? Model.PARAM_DEFAULTS;
  host.innerHTML = `<div class="mm-d-form">
    ${optCheck({ name: "p.anim", label: T("Destr.f.anim"), checked: P.anim, hint: T("Destr.h.anim") })}
    ${optCheck({ name: "p.idle", label: T("Destr.f.idle"), checked: P.idle, hint: T("Destr.h.idle") })}
    ${optSelect({ name: "p.fxWho", label: T("Destr.f.fxWho"), value: P.fxWho, options: [["all", T("Destr.o.all")], ["gm", T("Destr.o.gm")]] })}
    ${optCheck({ name: "p.entry", label: T("Destr.f.entry"), checked: P.entry, hint: T("Destr.h.entry") })}
    ${optRange({ name: "p.entrySpeed", label: T("Destr.f.entrySpeed"), value: P.entrySpeed, min: Model.LIMITS.entrySpeed[0], max: Model.LIMITS.entrySpeed[1], step: 0.1, hint: T("Destr.h.entrySpeed") })}
    ${optRange({ name: "p.entryPower", label: T("Destr.f.entryPower"), value: P.entryPower, min: Model.LIMITS.entryPower[0], max: Model.LIMITS.entryPower[1], step: 0.1, hint: T("Destr.h.entryPower") })}
    <p class="mm-ws-hint">${esc(T("Destr.motionHint"))}</p></div>`;
  return bindParams(host);
}

if ( !OFF ) registerSection({
  id: "destruction", order: 4, title: "MOINENMAPS.WS.destruction", icon: "fa-solid fa-house-crack", color: "#e0453a",
  activeTool: "mm-d-pick",
  tools: () => [
    { name: "mm-d-pick", order: 1, title: "MOINENMAPS.Destr.tool.pick", icon: "fa-solid fa-arrow-pointer" },
    { name: "mm-d-paint", order: 2, title: "MOINENMAPS.Destr.tool.paint", icon: "fa-solid fa-house-crack", color: "#ef8a3a" },
    { name: "mm-d-erase", order: 3, title: "MOINENMAPS.Destr.tool.erase", icon: "fa-solid fa-trowel-bricks", color: "#ffffff" },
    { name: "mm-d-detonate", order: 10, button: true, title: "MOINENMAPS.Destr.detonate", icon: "fa-solid fa-explosion", onClick: () => D.detonate() }
  ],
  onToolChange: (tool, active) => { if ( tool in TOOLS ) Editor.setMode(active ? TOOLS[tool] : null); },
  bar,
  panels: [
    { id: "damage", title: "MOINENMAPS.Destr.pDamage", icon: "fa-solid fa-house-crack", mount: mountDamage },
    { id: "look", title: "MOINENMAPS.Destr.pLook", icon: "fa-solid fa-sliders", mount: mountLook },
    { id: "motion", title: "MOINENMAPS.Destr.pMotion", icon: "fa-solid fa-person-running", open: false, mount: mountMotion }
  ]
});
