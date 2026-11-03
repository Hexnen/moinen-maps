import { MODULE_ID } from "../config.mjs";
import * as Cin from "./cinematic-core.mjs";
import { esc, T, optRange, optSelect, optCheck, optHint, isEcho, writeControl, onSetting, bindSettings } from "../workspace/ui.mjs";
import { extendSection } from "../workspace/registry.mjs";
import { CinematicFx, clientOpts } from "./cinematic-fx.mjs";

/**
 * The cinematic SETTINGS PANEL: renderCinematicPanel(container, { scene, readOnly, store }) builds it into `container` and returns the
 * cleanup. It is also registered as a dock panel of the Damage workspace section ("cinematic-fx"), so it appears without any change to
 * section.mjs. The panel edits the scene's `params.cinematic` block (preset + overrides: only what differs from the preset is stored);
 * the GM's own presets live in the world setting `cinUserPresets` ({ id: { name, values } }).
 *
 * Every control is written back WITHOUT echoing (ui.mjs writeControl + isEcho) AND a change that equals the stored value is dropped, so
 * a control -> setting -> hook -> control loop cannot start (an old range-picker echo froze a client once).
 */

const D = () => game.modules.get(MODULE_ID)?.api?.destruction;
export const defaultStore = {
  block: () => Cin.sanitize(D()?.state?.()?.params?.cinematic),
  setBlock: (b) => D()?.setParams({ cinematic: b }),
  users: () => game.settings.get(MODULE_ID, "cinUserPresets") ?? {},
  setUsers: (u) => game.settings.set(MODULE_ID, "cinUserPresets", u)
};

/** The control groups: a toggle (the element's switch) and the parameters under it, in order. */
export const GROUPS = [
  { id: "letterbox", toggle: "lbOn", keys: ["lbHeight", "lbAlpha", "lbColor", "lbIn", "lbOut", "lbEase"], aspect: true },
  { id: "vignette", toggle: "vgOn", keys: ["vgStrength", "vgRadius", "vgTint"] },
  { id: "flash", toggle: "flOn", keys: ["flIntensity", "flDur", "flColor"] },
  { id: "shake", toggle: "shOn", keys: ["shIntensity", "shFreq", "shDecay", "shBias", "shMax"] },
  { id: "slowmo", toggle: "smOn", keys: ["smFactor", "smIn", "smOut", "smThreshold"] },
  { id: "camera", toggle: "camOn", keys: ["camMode", "camZoomMin", "camZoomMax", "camLead", "camHold", "camReturn", "camEase"] },
  { id: "pace", toggle: null, keys: ["pace", "timeScale", "gap", "pauseBefore", "pauseAfter"] }
];
const OPTS = ["cinNoLetterbox", "cinNoVignette", "cinNoShake", "cinNoFlash", "cinNoSlow"];
const ASPECTS = { "2.39": 2.39, "1.85": 1.85 };

/** Slider step by unit. */
export function stepFor(k) {
  const u = Cin.NUM[k]?.[3];
  return u === "ms" ? 10 : u === "px" || u === "Hz" ? 1 : u === "art px" ? 5 : u === "%" ? 0.5 : 0.05;
}

const CSS = `
.mm-cin-panel { display: flex; flex-direction: column; gap: 0.5rem; font-size: var(--font-size-12, 0.75rem); }
.mm-cin-panel fieldset { border: 1px solid var(--color-border-light-2, #8884); border-radius: 4px; margin: 0; padding: 0.25rem 0.5rem 0.4rem; display: flex; flex-direction: column; gap: 0.25rem; }
.mm-cin-panel fieldset.mm-cin-off > .mm-cin-body { opacity: 0.45; }
.mm-cin-panel legend { display: flex; align-items: center; gap: 0.35rem; padding: 0 0.25rem; font-weight: bold; }
.mm-cin-panel .mm-cin-row { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; }
.mm-cin-panel .mm-ws-opt { display: flex; justify-content: space-between; white-space: normal; }
.mm-cin-panel .mm-ws-range range-picker { width: 10rem; }
.mm-cin-panel button { width: auto; flex: 0 1 auto; padding: 0 0.5rem; line-height: 1.6; }
.mm-cin-panel textarea { width: 100%; min-height: 4rem; font-family: monospace; }
.mm-cin-summary { font-style: italic; color: var(--mm-ws-muted, #aaa); }
.mm-cin-panel input[type=color] { width: 3rem; height: 1.4rem; padding: 0; }
`;
let styled = false;
function ensureStyle() { if ( styled ) return; styled = true; const s = document.createElement("style"); s.textContent = CSS; s.dataset.mmCin = ""; document.head.appendChild(s); }

const label = (k) => T(`Destr.cin.p.${k}`) + (Cin.NUM[k]?.[3] ? ` (${Cin.NUM[k][3]})` : "");
const hint = (k) => T(`Destr.cin.h.${k}`);
const presetName = (id, users) => Cin.PRESETS[id] ? T(`Destr.cin.pn.${id}`) : id === "custom" ? T("Destr.cin.pn.custom") : (users[id]?.name ?? id);

/** The effective-state summary text for the resolved settings `r` and this client's opt-outs. */
export function summary(r, opts = clientOpts()) {
  const e = Cin.effective(r, opts), names = ["letterbox", "shake", "vignette", "slowmo", "flash", "camera"].filter((k) => e[k]).map((k) => T(`Destr.cin.${k}`));
  return game.i18n.format("MOINENMAPS.Destr.cin.willSee", { list: names.length ? names.join(", ") : T("Destr.cin.willSeeNone") });
}

function controlHtml(k, r) {
  if ( k in Cin.NUM ) return optRange({ name: k, label: label(k), value: r[k], min: Cin.NUM[k][1], max: Cin.NUM[k][2], step: stepFor(k), hint: hint(k) });
  if ( k in Cin.ENUMS ) return optSelect({ name: k, label: label(k), value: r[k], options: Cin.ENUMS[k].map((v) => [v, T(`Destr.cin.e.${k}.${v}`)]), hint: hint(k) });
  return `<div class="mm-ws-opt"><label for="mm-cin-${k}" data-tooltip="${esc(hint(k))}">${esc(label(k))}</label><input type="color" id="mm-cin-${k}" name="${k}" value="${esc(r[k])}"></div>`;
}

export function renderCinematicPanel(container, { scene = null, readOnly = false, store = defaultStore } = {}) {
  ensureStyle();
  const block = () => store.block(), users = () => store.users();
  const valuesMap = () => Object.fromEntries(Object.entries(users()).map(([id, u]) => [id, u?.values ?? {}]));
  const resolved = () => Cin.resolve(block(), valuesMap());
  const r0 = resolved(), dis = readOnly ? " disabled" : "";
  const presetOptions = (b) => [...Cin.PRESET_IDS, ...Object.keys(users()), "custom"].map((id) => [id, presetName(id, users()) + (id === b.preset && Object.keys(b.over).length ? " *" : "")]);
  const group = (g) => `<fieldset data-group="${g.id}"><legend>${g.toggle ? `<input type="checkbox" name="${g.toggle}"${r0[g.toggle] ? " checked" : ""}${dis}>` : ""}${esc(T(`Destr.cin.g.${g.id}`))}</legend><div class="mm-cin-body">${
    g.aspect ? optSelect({ name: "aspect", label: T("Destr.cin.aspect"), value: "", options: [["", T("Destr.cin.aspectPick")], ["2.39", "2.39:1"], ["1.85", "1.85:1"]], hint: T("Destr.cin.h.aspect") }) : ""}${g.keys.map((k) => controlHtml(k, r0)).join("")}</div></fieldset>`;
  container.innerHTML = `<div class="mm-cin-panel">
    <div class="mm-cin-row">${optSelect({ name: "preset", label: T("Destr.cin.preset"), value: block().preset, options: presetOptions(block()), hint: T("Destr.cin.h.preset") })}</div>
    <div class="mm-cin-row mm-cin-actions">
      <button type="button" data-act="saveas"${dis}>${esc(T("Destr.cin.saveAs"))}</button><button type="button" data-act="duplicate"${dis}>${esc(T("Destr.cin.duplicate"))}</button>
      <button type="button" data-act="delete"${dis}>${esc(T("Destr.cin.delete"))}</button><button type="button" data-act="reset"${dis}>${esc(T("Destr.cin.reset"))}</button>
      <button type="button" data-act="export">${esc(T("Destr.cin.export"))}</button><button type="button" data-act="import"${dis}>${esc(T("Destr.cin.import"))}</button>
    </div>
    <div class="mm-cin-io" hidden><textarea spellcheck="false" placeholder="${esc(T("Destr.cin.ioHint"))}"></textarea></div>
    ${optCheck({ name: "fx", label: T("Destr.cin.fx"), checked: r0.fx, hint: T("Destr.cin.h.fx") })}
    ${GROUPS.map(group).join("")}
    <div class="mm-cin-row"><button type="button" data-act="preview">${esc(T("Destr.cin.test"))}</button></div>
    <div class="mm-cin-summary"></div>
    <fieldset class="mm-cin-client"><legend>${esc(T("Destr.cin.myOptions"))}</legend>
      ${OPTS.map((k) => optCheck({ name: k, label: T(`Destr.cin.${k.replace(/^cinNo/, "no")}`), checked: !!game.settings.get(MODULE_ID, k) })).join("")}
      ${optSelect({ name: "cinCamera", label: T("Destr.cin.cameraSetting"), value: game.settings.get(MODULE_ID, "cinCamera"), options: [["auto", T("Destr.cin.camAuto")], ["on", T("Destr.cin.camOn")], ["off", T("Destr.cin.noCamera")]] })}
      ${optSelect({ name: "cinReduced", label: T("Destr.cin.reducedSetting"), value: game.settings.get(MODULE_ID, "cinReduced"), options: [["auto", T("Destr.cin.redAuto")], ["on", T("Destr.cin.redOn")], ["off", T("Destr.cin.redOff")]], hint: T("Destr.cin.reducedHint") })}
      ${optHint(T("Destr.cin.hintOptOut"))}
    </fieldset></div>`;
  if ( readOnly ) for ( const c of container.querySelectorAll(".mm-cin-panel fieldset:not(.mm-cin-client) :is(input, select, range-picker), [name=preset], [name=fx]") ) c.disabled = true;

  const q = (sel) => container.querySelector(sel), io = q(".mm-cin-io"), ta = io.querySelector("textarea");
  const ctl = (name) => q(`[name="${name}"]`);

  /** Bring every control to the stored state (silently), then the dependent bits. */
  function refresh() {
    const b = block(), r = resolved();
    const sel = ctl("preset");
    if ( sel && !sel.contains(document.activeElement) ) {
      const want = JSON.stringify(presetOptions(b));
      if ( sel.dataset.opts !== want ) { sel.innerHTML = presetOptions(b).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(""); sel.dataset.opts = want; }
      writeControl(sel, b.preset);
    }
    for ( const k of Cin.KEYS ) { const c = ctl(k); if ( c && !c.contains(document.activeElement) ) writeControl(c, r[k]); }
    for ( const g of GROUPS ) q(`[data-group="${g.id}"]`)?.classList.toggle("mm-cin-off", !(g.toggle ? r[g.toggle] : true) || !r.fx);
    const del = q("[data-act=delete]"); if ( del ) del.disabled = readOnly || !users()[b.preset];
    q(".mm-cin-summary").textContent = summary(r);
  }
  const commit = (b) => { store.setBlock(b); refresh(); };

  const read = (c) => c.matches("input[type=checkbox]") ? c.checked : c.matches("range-picker, input[type=number]") ? Number(c.value) : c.value;
  const onChange = (ev) => {
    if ( isEcho() || readOnly ) return;
    const c = ev.target.closest?.("[name]"); if ( !c ) return;
    const b = block(), r = resolved();
    if ( c.name === "preset" ) {
      if ( c.value === b.preset ) return;
      commit({ ...b, preset: c.value, over: c.value === "custom" ? Cin.cleanPartial(r) : {} });        // "custom" keeps what you see
    } else if ( c.name === "aspect" ) {
      const t = ASPECTS[c.value]; c.value = ""; if ( !t ) return;
      const h = Cin.ratioHeight(t, innerWidth / Math.max(1, innerHeight));
      commit({ ...b, over: { ...b.over, lbHeight: Cin.cleanValue("lbHeight", h) } });
    } else if ( Cin.KEYS.includes(c.name) ) {
      const v = Cin.cleanValue(c.name, read(c));
      if ( v === undefined || v === r[c.name] ) { refresh(); return; }                                // junk: back to the stored value; same: nothing
      commit({ ...b, over: { ...b.over, [c.name]: v } });
    }
  };
  container.addEventListener("change", onChange);

  const askName = async (def) => {
    try { const res = await foundry.applications.api.DialogV2.input({ window: { title: T("Destr.cin.saveAs") }, content: `<input type="text" name="name" value="${esc(def)}" autofocus>`, ok: { label: T("Destr.cin.saveAs") } }); return String(res?.name ?? "").trim().slice(0, 60); } catch { return ""; }
  };
  const saveUser = async (name, values) => {
    const u = { ...users() }, id = Cin.presetId(name, Object.keys(u));
    u[id] = { name, values: Cin.cleanPartial(values) };
    await store.setUsers(u);
    commit({ ...block(), preset: id, over: {} });
  };
  const onClick = async (ev) => {
    const a = ev.target.closest?.("[data-act]")?.dataset.act; if ( !a ) return;
    const b = block(), r = resolved();
    if ( a === "reset" ) commit({ ...b, over: {} });
    else if ( a === "saveas" || a === "duplicate" ) { const name = await askName(a === "duplicate" ? `${presetName(b.preset, users())} 2` : presetName(b.preset, users())); if ( name ) await saveUser(name, r); }
    else if ( a === "delete" ) {
      const u = { ...users() }; if ( !u[b.preset] ) return;
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: T("Destr.cin.delete") }, content: `<p>${esc(u[b.preset].name)}</p>` }).catch(() => false);
      if ( !ok ) return;
      delete u[b.preset]; await store.setUsers(u); commit({ ...block(), preset: "epic", over: {} });
    } else if ( a === "export" ) {
      io.hidden = false; ta.value = Cin.exportPreset(presetName(b.preset, users()), r); ta.select();
      try { await navigator.clipboard.writeText(ta.value); ui.notifications?.info(T("Destr.cin.copied")); } catch { /* the text is selected: Ctrl+C */ }
    } else if ( a === "import" ) {
      if ( io.hidden ) { io.hidden = false; ta.value = ""; ta.focus(); return; }
      const p = Cin.importPreset(ta.value);
      if ( !p ) { ui.notifications?.warn(T("Destr.cin.importBad")); return; }
      await saveUser(p.name, p.values); ta.value = ""; io.hidden = true;
    } else if ( a === "preview" ) {
      const btn = ev.target.closest("button"); btn.disabled = true;
      try { await CinematicFx.preview(resolved()); } finally { btn.disabled = false; }
    }
  };
  container.addEventListener("click", onClick);

  // the player's own options (client settings) follow their settings both ways
  const offBind = bindSettings(container, Object.fromEntries([...OPTS, "cinCamera", "cinReduced"].map((k) => [k, k])));
  const offSet = onSetting([...OPTS, "cinCamera", "cinReduced"], () => refresh());
  const hook = Hooks.on("moinenMapsDestruction", (kind) => { if ( kind === "loaded" || kind === "params" ) refresh(); });
  refresh();
  return () => {
    container.removeEventListener("change", onChange); container.removeEventListener("click", onClick);
    try { offBind?.(); } catch { /* gone */ }
    try { offSet?.(); } catch { /* gone */ }
    Hooks.off("moinenMapsDestruction", hook);
    container.innerHTML = "";
  };
}

// a dock panel of the Damage section; the Hooks.once keeps the order independent of the import order of the sections
Hooks.once("init", () => extendSection("destruction", {
  panels: [{ id: "cinematic-fx", title: "MOINENMAPS.Destr.cin.fxTitle", icon: "fa-solid fa-film", open: false, mount: (host) => renderCinematicPanel(host, { scene: globalThis.canvas?.scene, readOnly: !game.user.isGM }) }]
}));
