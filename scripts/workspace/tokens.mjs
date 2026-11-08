import { registerSection } from "./registry.mjs";
import { esc, T, isEcho, writeControl, optRange, optSelect, optHint, tipHints } from "./ui.mjs";
import { workspaceTool } from "./shell.mjs";
import { MODULE_ID, sceneConfig, DEFAULTS } from "../config.mjs";
import { fg } from "../labels.mjs";
import * as St from "../tokens/styles.mjs";
import { FX_FLAG, tokenFlag } from "../tokens/settings.mjs";
import { preview, refreshTokenFx, isDeadDoc } from "../tokens/fx.mjs";
import { addDeletion } from "../flag-diff.mjs";

/**
 * Tokens: how tokens enter and leave the scene, their idle motion and their death (scripts/tokens), plus the older token effects
 * (drop, hide / reveal, targeting reticle, combat entry; token-drop.mjs) that used to live only in the Scene Config.
 *
 *  - tools: pick tokens on the map (the section keeps its own selection; Foundry's token selection is its starting point), and
 *    buttons that play an effect on the picked tokens on this screen only (nothing is stored): enter, leave, death, idle; and one
 *    that marks the picked tokens dead or alive (it toggles the core "dead" status, the same as the token HUD).
 *  - bar: the effect set in hand, its style for the scene, intensity, speed, "apply to picked" (a per-token override)
 *  - dock: Entering, Leaving, Idle, Death, Targeting & combat, and the per-token overrides of the scene's tokens
 * Settings live in the scene flag (flags.moinen-maps.config.tokens) and in each token's flag (flags.moinen-maps.fx). Writes are
 * silent: a value already stored is never written again, and a value changed elsewhere is written back into the controls without
 * looking like an edit (ui.mjs writeControl / isEcho).
 */

const PICK = "mm-t-pick";
const N = `flags.${MODULE_ID}.config.tokens`;
const SETS = {
  enter:  { key: "enterStyle",  table: St.ENTER_STYLES, label: "TokFx.set.enter",  play: "enter" },
  reveal: { key: "revealStyle", table: St.ENTER_STYLES, label: "TokFx.set.reveal", play: "enter" },
  leave:  { key: "leaveStyle",  table: St.LEAVE_STYLES, label: "TokFx.set.leave",  play: "leave" },
  hide:   { key: "hideStyle",   table: St.LEAVE_STYLES, label: "TokFx.set.hide",   play: "leave" },
  idle:   { key: "idleStyle",   table: St.IDLE_STYLES,  label: "TokFx.set.idle",   play: "idle" },
  death:  { key: "deathStyle",  table: St.DEATH_STYLES, label: "TokFx.set.death",  play: "death" }
};
const FAMILY = { enter: "enter", reveal: "enter", leave: "leave", hide: "leave", idle: "idle", death: "death" };
const styleLabel = (set, id) => T(`TokFx.${FAMILY[set]}.${id}`);
const styleDesc = (set, id) => T(`TokFx.${FAMILY[set]}Desc.${id}`);

/* ================================================================== state: the scene's settings, the picked tokens */

const scene = () => canvas?.scene ?? null;
const cfg = () => sceneConfig(scene()).tokens;
let barSet = (() => { try { return localStorage.getItem("mm-tokfx-set") || "enter"; } catch { return "enter"; } })();
if ( !SETS[barSet] ) barSet = "enter";

/** The section's own selection of tokens (ids on the viewed scene). Foundry's selection seeds it when the section opens. */
const picked = new Set();
const pickedTokens = () => [...picked].map((id) => canvas.tokens?.get(id)).filter((t) => t && !t.destroyed);
function seedPicks() {
  for ( const id of [...picked] ) if ( !canvas.tokens?.get(id) ) picked.delete(id);
  if ( !picked.size ) for ( const t of canvas.tokens?.controlled ?? [] ) picked.add(t.id);
}
function setPicked(ids) { picked.clear(); for ( const id of ids ) picked.add(id); changed("picks"); }

/** Listeners of the open bar / panels: "scene" (a stored value changed), "tokens" (token flags / list), "picks" (the selection). */
const LISTENERS = new Set();
function changed(what) { for ( const f of [...LISTENERS] ) { try { f(what); } catch ( err ) { console.error(`${MODULE_ID} | tokens panel`, err); } } if ( what === "picks" ) drawPicks(); }
const listen = (f) => { LISTENERS.add(f); return () => LISTENERS.delete(f); };

/** Store some scene keys; only what differs from the stored (effective) value is written, in one update. */
let pendingPatch = null, pendingTimer = 0;
function writeScene(patch) {
  const s = scene(); if ( !s || !game.user.isGM ) return;
  const cur = cfg();
  for ( const [k, v] of Object.entries(patch) ) {
    if ( cur[k] === v || (typeof v === "number" && Number(cur[k]) === v) ) { if ( pendingPatch ) delete pendingPatch[k]; continue; }
    (pendingPatch ??= {})[k] = v;
  }
  if ( !pendingPatch || !Object.keys(pendingPatch).length ) { pendingPatch = null; return; }
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    const p = pendingPatch; pendingPatch = null;
    if ( !p || !Object.keys(p).length ) return;
    s.update(Object.fromEntries(Object.entries(p).map(([k, v]) => [`${N}.${k}`, v])));
  }, 60);
}

/** Store one per-token override on some tokens: a style, or "" = inherit the scene (the key is removed). Unchanged tokens are skipped. */
async function writeOverride(tokens, key, value) {
  const s = scene(); if ( !s || !game.user.isGM ) return 0;
  const updates = [];
  for ( const t of tokens ) {
    const has = Object.prototype.hasOwnProperty.call(tokenFlag(t.document), key), cur = tokenFlag(t.document)[key];
    if ( value === "" ) { if ( has ) { const u = { _id: t.id }; addDeletion(u, `flags.${MODULE_ID}.${FX_FLAG}.${key}`); updates.push(u); } }
    else if ( cur !== value ) updates.push({ _id: t.id, [`flags.${MODULE_ID}.${FX_FLAG}.${key}`]: value });
  }
  if ( updates.length ) await s.updateEmbeddedDocuments("Token", updates);
  return updates.length;
}
async function clearOverrides(tokens) {
  const s = scene(); if ( !s || !game.user.isGM ) return;
  const updates = tokens.filter((t) => Object.keys(tokenFlag(t.document)).length).map((t) => { const u = { _id: t.id }; addDeletion(u, `flags.${MODULE_ID}.${FX_FLAG}`); return u; });
  if ( updates.length ) await s.updateEmbeddedDocuments("Token", updates);
}

/** Play the effect of a set on the picked tokens (this screen only). Nothing picked: a hint. */
function playSet(set, style = null, quiet = false) {
  const list = pickedTokens();
  if ( !list.length ) { if ( !quiet ) ui.notifications.info(T("TokFx.pickFirst")); return; }
  const kind = SETS[set]?.play ?? set;
  list.slice(0, St.MAX_BURST).forEach((t, i) => preview(t, kind, style, kind === "idle" ? 0 : Math.min(i * 0.075, 0.75)));
}

/** Mark the picked tokens dead, or alive when they all are dead: the core "dead" status (as the token HUD does). */
async function toggleDead() {
  const list = pickedTokens(); if ( !list.length ) { ui.notifications.info(T("TokFx.pickFirst")); return; }
  const id = CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
  const allDead = list.every((t) => t.actor?.statuses?.has(id));
  for ( const t of list ) { try { await t.actor?.toggleStatusEffect(id, { active: !allDead, overlay: true }); } catch ( err ) { console.error(`${MODULE_ID} | toggle dead`, err); } }
}

/* ================================================================== the picks on the map */

let ring = null;
function drawPicks() {
  if ( !canvas?.ready ) return;
  const show = workspaceTool() === PICK;
  if ( !ring || ring.destroyed ) { ring = new PIXI.Graphics(); ring.eventMode = "none"; canvas.interface.addChild(ring); }
  ring.clear();
  if ( !show ) return;
  const w = Math.max(2, canvas.dimensions.size / 40);
  for ( const t of pickedTokens() ) {
    const { width: W, height: H } = t.document.getSize();
    ring.lineStyle({ width: w * 2.2, color: 0x15110f, alpha: 0.6 }).drawRoundedRect(t.document.x - w * 2, t.document.y - w * 2, W + w * 4, H + w * 4, w * 4);
    ring.lineStyle({ width: w, color: 0x5fd39a, alpha: 1 }).drawRoundedRect(t.document.x - w * 2, t.document.y - w * 2, W + w * 4, H + w * 4, w * 4);
  }
}
Hooks.on("canvasTearDown", () => { ring = null; picked.clear(); });
Hooks.on("refreshToken", (t) => { if ( picked.has(t.id) && ring && !ring.destroyed && ring.geometry.graphicsData.length ) drawPicksSoon(); });
let ringFrame = 0;
function drawPicksSoon() { if ( !ringFrame ) ringFrame = requestAnimationFrame(() => { ringFrame = 0; drawPicks(); }); }

/** The pick tool: a click on a token picks it (shift: adds / removes), a click on nothing clears. */
function onCanvasDown(ev) {
  if ( workspaceTool() !== PICK || ev.button !== 0 || !canvas.ready ) return;
  const p = canvas.canvasCoordinatesFromClient?.({ x: ev.clientX, y: ev.clientY }) ?? canvas.mousePosition;
  const hit = [...canvas.tokens.placeables].reverse().find((t) => t.visible && t.bounds.contains(p.x, p.y));
  if ( !hit ) { if ( !ev.shiftKey && picked.size ) setPicked([]); return; }
  if ( ev.shiftKey ) { if ( picked.has(hit.id) ) picked.delete(hit.id); else picked.add(hit.id); changed("picks"); }
  else setPicked([hit.id]);
}
let pickWired = false;
function wirePick(on) {
  const view = canvas.app?.view; if ( !view ) return;
  if ( on && !pickWired ) { view.addEventListener("pointerdown", onCanvasDown, true); pickWired = true; }
  else if ( !on && pickWired ) { view.removeEventListener("pointerdown", onCanvasDown, true); pickWired = false; }
}
Hooks.on("canvasTearDown", () => wirePick(false));

/* ================================================================== controls */

/** A grid of style buttons (one pressed). `set` names the table; the description of the pressed one is shown under it. */
function chipsHtml(set, value) {
  const ids = Object.keys(SETS[set].table);
  return `<div class="mm-tfx-chips" role="radiogroup" aria-label="${esc(T(SETS[set].label))}" data-set="${set}">
    ${ids.map((id) => `<button type="button" role="radio" class="mm-tfx-chip" data-style="${esc(id)}" aria-checked="${id === value}">${esc(styleLabel(set, id))}</button>`).join("")}
    </div><p class="mm-tfx-desc" data-desc="${set}">${esc(styleDesc(set, value))}</p>`;
}
function syncChips(host, set, value) {
  for ( const b of host.querySelectorAll(`.mm-tfx-chips[data-set="${set}"] .mm-tfx-chip`) ) b.setAttribute("aria-checked", String(b.dataset.style === value));
  const d = host.querySelector(`[data-desc="${set}"]`); if ( d ) d.textContent = styleDesc(set, value);
}

/** Scene-key controls inside a panel: `name` = the tokens key. */
const rowCheck = (k, label, hint = "") => fg(T(label), `<input type="checkbox" name="${k}"${cfg()[k] ? " checked" : ""}>`, hint ? T(hint) : "");
const rowRange = (k, label, min, max, step, hint = "") => fg(T(label), `<range-picker name="${k}" value="${Number(cfg()[k])}" min="${min}" max="${max}" step="${step}"></range-picker>`, hint ? T(hint) : "");
const rowSelect = (k, label, opts, hint = "") => fg(T(label), `<select name="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(cfg()[k]) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`, hint ? T(hint) : "");
const rowColor = (k, label) => fg(T(label), `<color-picker name="${k}" value="${esc(cfg()[k])}"></color-picker>`);
const rowText = (k, label, placeholder, hint = "") => fg(T(label), `<input type="text" name="${k}" value="${esc(cfg()[k] ?? "")}" placeholder="${esc(placeholder)}" spellcheck="false">`, hint ? T(hint) : "");

/**
 * Wire a panel: chips write their set's style (and play it on the picked tokens); named controls write their key on change
 * (sliders preview nothing while dragged and commit once on release); stored changes from elsewhere flow back silently.
 * `deps` = [[selector, () => enabled]] dims what does not apply.
 */
function wirePanel(host, { deps = [], playOnChange = null } = {}) {
  const valueOf = (c) => c.matches("input[type=checkbox]") ? c.checked : c.matches("range-picker, input[type=number]") ? Number(c.value) : c.value;
  // what does not apply is hidden (and inert) until it does
  const dim = () => { for ( const [sel, on] of deps ) for ( const el of host.querySelectorAll(sel) ) { const off = !on(); el.hidden = off; el.inert = off; } };
  host.classList.add("mm-ws-form");
  tipHints(host);
  const onClick = (ev) => {
    const chip = ev.target.closest(".mm-tfx-chip"); if ( !chip ) return;
    const set = chip.closest(".mm-tfx-chips").dataset.set, style = chip.dataset.style;
    syncChips(host, set, style);
    writeScene({ [SETS[set].key]: style });
    if ( style !== "none" ) playSet(set, style, true);
  };
  const onChange = (ev) => {
    if ( isEcho() ) return;
    const c = ev.target.closest?.("[name]"); if ( !c || !(c.name in DEFAULTS.tokens) ) return;
    let v = valueOf(c);
    if ( typeof DEFAULTS.tokens[c.name] === "number" ) { v = Number(v); if ( !Number.isFinite(v) ) return; }
    if ( c.name === "hpPath" ) v = String(v).trim();
    writeScene({ [c.name]: v });
    dim();
    if ( playOnChange && typeof v !== "string" ) playOnChange(c.name);
  };
  host.addEventListener("click", onClick);
  host.addEventListener("change", onChange);
  const off = listen((what) => {
    if ( what !== "scene" ) return;
    const c = cfg();
    for ( const el of host.querySelectorAll("[name]") ) {
      if ( !(el.name in c) || el.contains(document.activeElement) ) continue;
      writeControl(el, c[el.name]);
    }
    for ( const set of Object.keys(SETS) ) if ( host.querySelector(`.mm-tfx-chips[data-set="${set}"]`) ) syncChips(host, set, c[SETS[set].key]);
    dim();
  });
  dim();
  return () => { host.removeEventListener("click", onClick); host.removeEventListener("change", onChange); off(); };
}

/* ================================================================== bar */

function tokensBar(host) {
  const draw = () => {
    const s = SETS[barSet], c = cfg(), styles = Object.keys(s.table).map((id) => [id, styleLabel(barSet, id)]);
    const n = pickedTokens().length;
    host.innerHTML = `${optSelect({ name: "set", label: T("TokFx.barSet"), value: barSet, options: Object.entries(SETS).map(([k, v]) => [k, T(v.label)]) })}
      ${optSelect({ name: "style", label: T("TokFx.barStyle"), value: c[s.key], options: styles, hint: T("TokFx.barStyleHint") })}
      ${optRange({ name: "intensity", label: T("Tok.intensity"), value: c.intensity, min: 0.3, max: 1.6, step: 0.05 })}
      ${optRange({ name: "speed", label: T("TokFx.speed"), value: c.speed, min: 0.5, max: 2, step: 0.05, hint: T("TokFx.speedHint") })}
      <button type="button" class="mm-ws-btn" data-act="play" data-tooltip="${esc(T("TokFx.playHint"))}"${n ? "" : " disabled"}><i class="fa-solid fa-play" inert></i> ${esc(T("TokFx.play"))}</button>
      <button type="button" class="mm-ws-btn" data-act="apply" data-tooltip="${esc(T("TokFx.applyPickedHint"))}"${n ? "" : " disabled"}><i class="fa-solid fa-user-pen" inert></i> ${esc(T("TokFx.applyPicked"))}</button>
      ${optHint(n ? game.i18n.format("MOINENMAPS.TokFx.pickedN", { n }) : T("TokFx.pickHint"))}`;
  };
  const onChange = (ev) => {
    if ( isEcho() ) return;
    const c = ev.target.closest?.("[name]"); if ( !c ) return;
    if ( c.name === "set" ) { barSet = c.value; try { localStorage.setItem("mm-tokfx-set", barSet); } catch {} draw(); return; }
    if ( c.name === "style" ) { writeScene({ [SETS[barSet].key]: c.value }); if ( c.value !== "none" ) playSet(barSet, c.value, true); return; }
    if ( c.name === "intensity" || c.name === "speed" ) { const v = Number(c.value); if ( Number.isFinite(v) ) { writeScene({ [c.name]: v }); playSet(barSet, null, true); } }
  };
  const onClick = async (ev) => {
    const b = ev.target.closest("[data-act]"); if ( !b ) return;
    if ( b.dataset.act === "play" ) playSet(barSet);
    else if ( b.dataset.act === "apply" ) {
      const style = host.querySelector('[name="style"]').value, n = await writeOverride(pickedTokens(), barSet, style);
      ui.notifications.info(game.i18n.format("MOINENMAPS.TokFx.applied", { n }));
    }
  };
  host.addEventListener("change", onChange);
  host.addEventListener("click", onClick);
  const off = listen((what) => {
    if ( what === "picks" ) return draw();
    if ( what !== "scene" ) return;
    const c = cfg();
    for ( const [name, val] of [["style", c[SETS[barSet].key]], ["intensity", c.intensity], ["speed", c.speed]] ) {
      const el = host.querySelector(`[name="${name}"]`); if ( el && !el.contains(document.activeElement) ) writeControl(el, val);
    }
  });
  draw();
  return () => { off(); host.removeEventListener("change", onChange); host.removeEventListener("click", onClick); };
}

/* ================================================================== panels */

function generalPanel(host) {
  host.innerHTML = `${rowSelect("who", "Tok.who", [["all", T("Tok.whoAll")], ["gm", T("Tok.whoGM")]], "TokFx.clientNote")}
    ${rowSelect("filter", "Tok.filter", [["all", T("Tok.filterAll")], ["player", T("Tok.filterPlayer")], ["npc", T("Tok.filterNpc")]])}
    ${rowRange("intensity", "Tok.intensity", 0.3, 1.6, 0.05, "Tok.intensityHint")}
    ${rowRange("speed", "TokFx.speed", 0.5, 2, 0.05, "TokFx.speedHint")}`;
  return wirePanel(host);
}

function enterPanel(host) {
  const c = cfg();
  host.innerHTML = `${rowCheck("enabled", "TokFx.placedOn", "TokFx.placedOnHint")}
    <div class="mm-tfx-block" data-dep="placed">${chipsHtml("enter", c.enterStyle)}
      <details class="mm-fold mm-tfx-drop"><summary>${esc(T("TokFx.dropOptions"))}</summary><div class="mm-fold-body">
        ${rowRange("dropHeight", "DropHeight", 0.3, 2, 0.05)}${rowRange("bounce", "Bounce", 0, 1, 0.05)}${rowRange("squeeze", "Squeeze", 0, 1, 0.05)}
        ${rowCheck("shadow", "Tok.shadow")}${rowCheck("ripple", "Tok.ripple")}</div></details>
    </div>
    ${rowCheck("hide", "Tok.hide", "Tok.hideHint")}
    <div class="mm-tfx-block" data-dep="reveal"><h4 class="mm-tfx-h">${esc(T("TokFx.set.reveal"))}</h4>${chipsHtml("reveal", c.revealStyle)}</div>
    ${rowCheck("hop", "Tok.hop", "Tok.hopHint")}`;
  const on = (k) => !!host.querySelector(`[name="${k}"]`)?.checked;
  return wirePanel(host, { deps: [['[data-dep="placed"]', () => on("enabled")], ['[data-dep="reveal"]', () => on("hide")], [".mm-tfx-drop", () => cfg().enterStyle === "drop" || cfg().revealStyle === "drop"]] });
}

function leavePanel(host) {
  const c = cfg();
  host.innerHTML = `<h4 class="mm-tfx-h" data-tooltip="${esc(T("TokFx.leaveNote"))}">${esc(T("TokFx.set.leave"))}</h4>${chipsHtml("leave", c.leaveStyle)}
    <div class="mm-tfx-block" data-dep="hide"><h4 class="mm-tfx-h">${esc(T("TokFx.set.hide"))}</h4>${chipsHtml("hide", c.hideStyle)}</div>`;
  return wirePanel(host, { deps: [['[data-dep="hide"]', () => !!cfg().hide]] });
}

function idlePanel(host) {
  const c = cfg();
  host.innerHTML = `${chipsHtml("idle", c.idleStyle)}
    <div class="mm-tfx-block" data-dep="idle">
      ${rowRange("idleAmp", "TokFx.idleAmp", 0.2, 2.5, 0.05)}
      ${rowRange("idleSpeed", "TokFx.idleSpeed", 0.2, 3, 0.05)}
      ${fg(T("TokFx.idleWhen"), `<select name="idleWhen">${St.IDLE_WHEN.map((w) => `<option value="${esc(w)}"${w === String(cfg().idleWhen) ? " selected" : ""}>${esc(T(`TokFx.when.${w}`))}</option>`).join("")}</select>`, `${T("TokFx.idleWhenHint")} ${T("TokFx.idleNote")}`)}
      ${rowCheck("idleTurn", "TokFx.idleTurn", "TokFx.idleTurnHint")}
    </div>`;
  return wirePanel(host, { deps: [['[data-dep="idle"]', () => cfg().idleStyle !== "none"]], playOnChange: (k) => { if ( k === "idleAmp" || k === "idleSpeed" ) playSet("idle", null, true); } });
}

function deathPanel(host) {
  const c = cfg(), sysPath = St.hpPathFor(game.system?.id, "");
  host.innerHTML = `${rowCheck("death", "TokFx.deathOn", "TokFx.deathOnHint")}
    <div class="mm-tfx-block" data-dep="death">
      ${chipsHtml("death", c.deathStyle)}
      ${rowSelect("corpse", "TokFx.corpseLabel", St.CORPSE_STYLES.map((s) => [s, T(`TokFx.corpse.${s}`)]), "TokFx.corpseHint")}
      ${rowSelect("revive", "TokFx.reviveLabel", St.REVIVE_STYLES.map((s) => [s, T(`TokFx.revive.${s}`)]))}
      <h4 class="mm-ws-sub">${esc(T("TokFx.detect"))}</h4>
      ${rowCheck("deathDefeated", "TokFx.detectDefeated")}
      ${rowCheck("deathStatus", "TokFx.detectStatus")}
      ${rowCheck("deathHp", "TokFx.detectHp", "TokFx.detectHpHint")}
      <div data-dep="hp">${rowText("hpPath", "TokFx.hpPath", sysPath || "system.attributes.hp.value", sysPath ? "" : "TokFx.hpPathNone")}</div>
      <div class="mm-tfx-actions"><button type="button" data-act="dead"><i class="fa-solid fa-skull-crossbones" inert></i> ${esc(T("TokFx.toggleDead"))}</button></div>
    </div>`;
  const onClick = (ev) => { if ( ev.target.closest('[data-act="dead"]') ) toggleDead(); };
  host.addEventListener("click", onClick);
  const off = wirePanel(host, { deps: [['[data-dep="death"]', () => !!host.querySelector('[name="death"]')?.checked], ['[data-dep="hp"]', () => !!host.querySelector('[name="deathHp"]')?.checked]] });
  return () => { off(); host.removeEventListener("click", onClick); };
}

function combatPanel(host) {
  host.innerHTML = `${rowCheck("target", "Tok.target", "Tok.targetHint")}
    <div class="mm-tfx-block" data-dep="target">
      ${rowSelect("reticleStyle", "Tok.reticleStyle", [["crosshair", T("Tok.styleCrosshair")], ["brackets", T("Tok.styleBrackets")]])}
      ${rowCheck("reticleUser", "Tok.reticleUser", "Tok.reticleUserHint")}
      <div data-dep="color">${rowColor("reticleColor", "Tok.reticleColor")}</div>
      ${rowCheck("hideNative", "Tok.hideNative", "Tok.hideNativeHint")}
    </div>
    ${rowCheck("combat", "Tok.combat", "Tok.combatHint")}
    <div class="mm-tfx-block" data-dep="combat">
      ${rowCheck("combatStagger", "Tok.combatStagger", "Tok.combatStaggerHint")}
      ${rowCheck("combatRipple", "Tok.combatRipple")}
      ${rowCheck("combatNumber", "Tok.combatNumber")}
    </div>`;
  const on = (k) => !!host.querySelector(`[name="${k}"]`)?.checked;
  return wirePanel(host, { deps: [['[data-dep="target"]', () => on("target")], ['[data-dep="color"]', () => !on("reticleUser")], ['[data-dep="combat"]', () => on("combat")]] });
}

/** The scene's tokens with their own overrides; the picked ones get a form of every override key. */
function overridesPanel(host) {
  const KEYS = St.OVERRIDE_KEYS;
  const optionsOf = (k) => k === "corpse" ? St.CORPSE_STYLES.map((s) => [s, T(`TokFx.corpse.${s}`)]) : Object.keys(St.OVERRIDES[k].values).map((s) => [s, styleLabel(k, s)]);
  const keyLabel = (k) => k === "corpse" ? T("TokFx.corpseLabel") : T(SETS[k].label);
  const valueLabel = (k, v) => k === "corpse" ? T(`TokFx.corpse.${v}`) : styleLabel(k, v);
  const draw = () => {
    const toks = [...(canvas.tokens?.placeables ?? [])].sort((a, b) => a.document.name.localeCompare(b.document.name, game.i18n.lang));
    const sel = pickedTokens();
    // the form shows the value all picked tokens share ("" = inherit, "*" = mixed)
    const shared = (k) => { const vals = new Set(sel.map((t) => St.overridesOf(tokenFlag(t.document))[k] ?? "")); return vals.size === 1 ? [...vals][0] : "*"; };
    const rows = toks.map((t) => {
      const o = St.overridesOf(tokenFlag(t.document)), on = picked.has(t.id), dead = isDeadDoc(t.document);
      const chips = Object.entries(o).map(([k, v]) => `<span class="mm-tfx-ov"><span>${esc(keyLabel(k))}</span> ${esc(valueLabel(k, v))}</span>`).join("");
      return `<li class="${on ? "is-picked" : ""}"><label><input type="checkbox" data-pick="${esc(t.id)}" aria-label="${esc(t.document.name)}"${on ? " checked" : ""}>
        <img src="${esc(t.document.texture.src)}" alt="" inert><span class="mm-tfx-name">${esc(t.document.name)}${dead ? ` <i class="fa-solid fa-skull" data-tooltip="${esc(T("TokFx.isDead"))}" aria-label="${esc(T("TokFx.isDead"))}"></i>` : ""}</span></label>
        ${chips ? `<div class="mm-tfx-ovs">${chips}</div>` : ""}</li>`;
    }).join("");
    host.innerHTML = `<div class="mm-tfx-listhead"><button type="button" data-act="all">${esc(T("TokFx.pickAll"))}</button><button type="button" data-act="none">${esc(T("TokFx.pickNone"))}</button><span>${esc(game.i18n.format("MOINENMAPS.TokFx.pickedN", { n: sel.length }))}</span></div>
      ${toks.length ? `<ul class="mm-tfx-list">${rows}</ul>` : `<p class="hint">${esc(T("TokFx.noTokens"))}</p>`}
      <div class="mm-tfx-form"${sel.length ? "" : " hidden"}>
        <h4 class="mm-tfx-h">${esc(T("TokFx.overrides"))}</h4>
        ${KEYS.map((k) => { const v = shared(k); return fg(keyLabel(k), `<select data-ov="${k}">${v === "*" ? `<option value="*" selected>${esc(T("TokFx.mixed"))}</option>` : ""}<option value=""${v === "" ? " selected" : ""}>${esc(T("TokFx.inherit"))}</option>${optionsOf(k).map(([s, l]) => `<option value="${esc(s)}"${s === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`); }).join("")}
        <div class="mm-tfx-actions">
          <button type="button" data-act="toAll" data-tooltip="${esc(T("TokFx.applyAllHint"))}">${esc(T("TokFx.applyAll"))}</button>
          <button type="button" data-act="clear">${esc(T("TokFx.clearOverrides"))}</button>
        </div>
      </div>`;
  };
  const onChange = async (ev) => {
    const pick = ev.target.closest("[data-pick]");
    if ( pick ) { if ( pick.checked ) picked.add(pick.dataset.pick); else picked.delete(pick.dataset.pick); changed("picks"); return; }
    const ov = ev.target.closest("[data-ov]");
    if ( ov && ov.value !== "*" ) { await writeOverride(pickedTokens(), ov.dataset.ov, ov.value); if ( ov.value && ov.value !== "none" && SETS[ov.dataset.ov] ) playSet(ov.dataset.ov, ov.value, true); }
  };
  const onClick = async (ev) => {
    const b = ev.target.closest("[data-act]"); if ( !b ) return;
    const act = b.dataset.act;
    if ( act === "all" ) setPicked(canvas.tokens.placeables.map((t) => t.id));
    else if ( act === "none" ) setPicked([]);
    else if ( act === "clear" ) await clearOverrides(pickedTokens());
    else if ( act === "toAll" ) {
      // every override the picked tokens share is copied to every token of the scene
      const src = pickedTokens()[0]; if ( !src ) return;
      const o = St.overridesOf(tokenFlag(src.document)), all = canvas.tokens.placeables;
      for ( const k of KEYS ) await writeOverride(all, k, o[k] ?? "");
      ui.notifications.info(game.i18n.format("MOINENMAPS.TokFx.applied", { n: all.length }));
    }
  };
  host.addEventListener("change", onChange);
  host.addEventListener("click", onClick);
  host.classList.add("mm-ws-form");
  const off = listen((what) => { if ( what === "picks" || what === "tokens" ) draw(); });
  draw();
  return () => { off(); host.removeEventListener("change", onChange); host.removeEventListener("click", onClick); };
}

/* ================================================================== follow the documents */

Hooks.on("updateScene", (s, ch) => { if ( s.id === canvas.scene?.id && foundry.utils.hasProperty(ch, `flags.${MODULE_ID}`) ) { changed("scene"); refreshTokenFx(); } });
for ( const h of ["createToken", "deleteToken"] ) Hooks.on(h, (doc) => { if ( doc.parent?.id === canvas.scene?.id ) { if ( h === "deleteToken" ) picked.delete(doc.id); changed("tokens"); } });
Hooks.on("updateToken", (doc, ch) => { if ( doc.parent?.id === canvas.scene?.id && (foundry.utils.hasProperty(ch, `flags.${MODULE_ID}`) || "name" in ch || "texture" in ch) ) changed("tokens"); });
let deadFrame = 0;
const deadSoon = () => { if ( !deadFrame && LISTENERS.size ) deadFrame = requestAnimationFrame(() => { deadFrame = 0; changed("tokens"); }); };
for ( const h of ["updateCombatant", "createActiveEffect", "deleteActiveEffect", "updateActor"] ) Hooks.on(h, deadSoon);

/* ================================================================== the section */

registerSection({
  id: "tokens", order: 7, title: "MOINENMAPS.WS.tokens", icon: "fa-solid fa-chess-pawn", color: "#5fd39a",
  activeTool: PICK,
  tools: () => [
    { name: PICK, order: 1, title: "MOINENMAPS.TokFx.tool.pick", icon: "fa-solid fa-arrow-pointer" },
    { name: "mm-t-play-enter", order: 5, title: "MOINENMAPS.TokFx.tool.enter", icon: "fa-solid fa-right-to-bracket", button: true, onClick: () => playSet("enter") },
    { name: "mm-t-play-leave", order: 6, title: "MOINENMAPS.TokFx.tool.leave", icon: "fa-solid fa-right-from-bracket", button: true, onClick: () => playSet("leave") },
    { name: "mm-t-play-idle", order: 7, title: "MOINENMAPS.TokFx.tool.idle", icon: "fa-solid fa-wave-square", button: true, onClick: () => playSet("idle") },
    { name: "mm-t-play-death", order: 8, title: "MOINENMAPS.TokFx.tool.death", icon: "fa-solid fa-skull", button: true, onClick: () => playSet("death") },
    { name: "mm-t-dead", order: 9, title: "MOINENMAPS.TokFx.tool.dead", icon: "fa-solid fa-skull-crossbones", button: true, onClick: () => toggleDead() }
  ],
  onToolChange: (tool, active) => {
    if ( tool !== PICK ) return;
    wirePick(active);
    if ( active ) seedPicks();
    drawPicksSoon();
  },
  bar: (host) => tokensBar(host),
  panels: [
    { id: "general", title: "MOINENMAPS.TokFx.pGeneral", icon: "fa-solid fa-sliders", open: false, mount: (host) => generalPanel(host) },
    { id: "enter", title: "MOINENMAPS.TokFx.pEnter", icon: "fa-solid fa-right-to-bracket", mount: (host) => enterPanel(host) },
    { id: "leave", title: "MOINENMAPS.TokFx.pLeave", icon: "fa-solid fa-right-from-bracket", open: false, mount: (host) => leavePanel(host) },
    { id: "idle", title: "MOINENMAPS.TokFx.pIdle", icon: "fa-solid fa-wave-square", open: false, mount: (host) => idlePanel(host) },
    { id: "death", title: "MOINENMAPS.TokFx.pDeath", icon: "fa-solid fa-skull", open: false, mount: (host) => deathPanel(host) },
    { id: "combat", title: "MOINENMAPS.TokFx.pCombat", icon: "fa-solid fa-crosshairs", open: false, mount: (host) => combatPanel(host) },
    { id: "tokens", title: "MOINENMAPS.TokFx.pTokens", icon: "fa-solid fa-users", mount: (host) => overridesPanel(host) }
  ]
});
