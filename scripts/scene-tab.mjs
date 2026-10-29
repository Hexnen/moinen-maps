import { MODULE_ID, IDLE_MODES, sceneConfig, setSceneDraft } from "./config.mjs";
import { compositePin } from "./pin-art.mjs";
import { dotsFieldsHtml, wireDotsFields } from "./dots.mjs";
import { labelFieldsHtml, fontFamilies, wireFontPreview, fg, revealFoldsOnOpen, liveBarHtml, wireLiveBar, frameThrottle } from "./labels.mjs";

const TAB = "moinenmaps";
const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const N = `flags.${MODULE_ID}.config`;

const row = (label, field, hint, cls = "") => fg(T(label), field, hint ? T(hint) : "", cls);
const range = (key, label, v, min, max, step, hint, cls) =>
  row(label, `<range-picker name="${N}.${key}" value="${v}" min="${min}" max="${max}" step="${step}"></range-picker>`, hint, cls);
const check = (key, label, v, hint, cls) =>
  row(label, `<input type="checkbox" name="${N}.${key}"${v ? " checked" : ""}>`, hint, cls);
const select = (key, label, v, opts, hint, cls) =>
  row(label, `<select name="${N}.${key}">${opts.map(([val, text]) => `<option value="${val}"${val === v ? " selected" : ""}>${esc(text)}</option>`).join("")}</select>`, hint, cls);
const legend = (icon, key) => `<legend><i class="fa-solid ${icon}" inert></i> ${esc(T(key))}</legend>`;
/** Rarely-touched blocks start folded so the tab stays short. */
const fold = (cls, icon, key, body) => `<details class="mm-fold ${cls}"><summary><i class="fa-solid ${icon}" inert></i> ${esc(T(key))}</summary><div class="mm-fold-body">${body}</div></details>`;

function tabHtml(scene, active) {
  const viewed = scene.id === canvas.scene?.id;
  const c = sceneConfig(scene);
  const idle = IDLE_MODES.map((m) => [m, T(`Idle.${m}`)]);
  return `<div class="tab scrollable moinen-maps-tab${active ? " active" : ""}" data-group="sheet" data-tab="${TAB}">
    ${liveBarHtml(viewed)}
    <header class="mm-hero">
      <button type="button" class="mm-stage" data-mm="replay" aria-label="${esc(T("Preview.Replay"))}" data-tooltip="${esc(T("Preview.Replay"))}">
        <span class="mm-ground"></span>
        <span class="mm-drop"><canvas class="mm-pin" width="320" height="352" aria-hidden="true"></canvas></span>
        <span class="mm-replay"><i class="fa-solid fa-rotate-right" inert></i></span>
      </button>
      <div class="mm-hero-fields">
        ${check("enabled", "Enabled", c.enabled, "EnabledHint")}
        ${row("Color", `<color-picker name="${N}.color" value="${esc(c.color)}"></color-picker>`)}
        ${check("useNoteTint", "UseNoteTint", c.useNoteTint, "UseNoteTintHint")}
      </div>
    </header>
    <div class="mm-sections" data-mm="sections">
      <h3 class="mm-group"><i class="fa-solid fa-location-dot" inert></i> ${esc(T("Scene.GroupPins"))}</h3>
      <fieldset class="mm-look">${legend("fa-paintbrush", "Scene.Pins")}
        ${range("size", "Size", c.size, 0.5, 2, 0.05)}
        ${select("glyph", "GlyphInside", c.glyph, [["note", T("GlyphNote")], ["dot", T("GlyphDot")]], "GlyphHint")}
        ${check("shadow", "Shadow", c.shadow)}
        ${check("glow", "Glow", c.glow, "GlowHint")}
      </fieldset>
      <fieldset class="mm-motion">${legend("fa-wand-magic-sparkles", "Scene.Motion")}
        ${check("drop", "Drop", c.drop, "DropHint")}
        <div class="mm-sub" data-mm="drop-sub">
          ${range("dropHeight", "DropHeight", c.dropHeight, 0.3, 2, 0.05)}
          ${range("bounce", "Bounce", c.bounce, 0, 1, 0.05)}
          ${range("squeeze", "Squeeze", c.squeeze, 0, 1, 0.05)}
        </div>
        ${check("hop", "Hop", c.hop, "HopHint")}
        ${select("idle", "IdleMode", c.idle, idle)}
        <div class="mm-sub" data-mm="idle-sub">
          ${range("idleStrength", "IdleStrength", c.idleStrength, 0, 1, 0.05)}
          ${range("idleSpeed", "IdleSpeed", c.idleSpeed, 0.2, 3, 0.05)}
        </div>
      </fieldset>
      ${fold("mm-pintext", "fa-tag", "Label.pinSection", `<p class="hint">${esc(T("Label.pinHint"))}</p>
        ${row("Label.family", `<select name="${N}.pinText.family"><option value=""${!c.pinText.family ? " selected" : ""}>${esc(T("Label.default"))}</option>${fontFamilies().map((f) => `<option value="${esc(f)}" style="font-family:'${esc(f)}'"${f === c.pinText.family ? " selected" : ""}>${esc(f)}</option>`).join("")}</select>`)}
        ${range("pinText.size", "Label.size", c.pinText.size, 0, 96, 1, "Label.pinSizeHint")}
        ${row("Label.textColor", `<color-picker name="${N}.pinText.color" value="${esc(c.pinText.color || "#ffffff")}"></color-picker>`)}
        ${row("Label.halo", `<color-picker name="${N}.pinText.halo" value="${esc(c.pinText.halo || "#000000")}"></color-picker>`)}
        ${range("pinText.haloWidth", "Label.haloWidth", c.pinText.haloWidth, 0, 16, 0.5)}`)}

      <h3 class="mm-group"><i class="fa-solid fa-user" inert></i> ${esc(T("Scene.GroupTokens"))}</h3>
      <fieldset class="mm-tokenset">${legend("fa-user", "Scene.Tokens")}
        ${select("tokens.who", "Tok.who", c.tokens.who, [["all", T("Tok.whoAll")], ["gm", T("Tok.whoGM")]])}
        ${select("tokens.filter", "Tok.filter", c.tokens.filter, [["all", T("Tok.filterAll")], ["player", T("Tok.filterPlayer")], ["npc", T("Tok.filterNpc")]])}
        ${range("tokens.intensity", "Tok.intensity", c.tokens.intensity, 0.3, 1.6, 0.05, "Tok.intensityHint")}
        ${check("tokens.enabled", "Tok.enabled", c.tokens.enabled, "Tok.enabledHint")}
        <div class="mm-sub" data-mm="tok-sub">
          ${range("tokens.dropHeight", "DropHeight", c.tokens.dropHeight, 0.3, 2, 0.05)}
          ${range("tokens.bounce", "Bounce", c.tokens.bounce, 0, 1, 0.05)}
          ${range("tokens.squeeze", "Squeeze", c.tokens.squeeze, 0, 1, 0.05)}
          ${check("tokens.shadow", "Tok.shadow", c.tokens.shadow)}
          ${check("tokens.ripple", "Tok.ripple", c.tokens.ripple)}
          ${check("tokens.hop", "Tok.hop", c.tokens.hop, "Tok.hopHint")}
        </div>
        ${check("tokens.hide", "Tok.hide", c.tokens.hide, "Tok.hideHint")}
        ${check("tokens.target", "Tok.target", c.tokens.target, "Tok.targetHint")}
        <div class="mm-sub" data-mm="tok-target-sub">
          ${select("tokens.reticleStyle", "Tok.reticleStyle", c.tokens.reticleStyle, [["crosshair", T("Tok.styleCrosshair")], ["brackets", T("Tok.styleBrackets")]])}
          ${check("tokens.reticleUser", "Tok.reticleUser", c.tokens.reticleUser, "Tok.reticleUserHint")}
          ${row("Tok.reticleColor", `<color-picker name="${N}.tokens.reticleColor" value="${esc(c.tokens.reticleColor)}"></color-picker>`)}
          ${check("tokens.hideNative", "Tok.hideNative", c.tokens.hideNative, "Tok.hideNativeHint")}
        </div>
        ${check("tokens.combat", "Tok.combat", c.tokens.combat, "Tok.combatHint")}
        <div class="mm-sub" data-mm="tok-combat-sub">
          ${check("tokens.combatStagger", "Tok.combatStagger", c.tokens.combatStagger, "Tok.combatStaggerHint")}
          ${check("tokens.combatRipple", "Tok.combatRipple", c.tokens.combatRipple)}
          ${check("tokens.combatNumber", "Tok.combatNumber", c.tokens.combatNumber)}
        </div>
      </fieldset>

      <h3 class="mm-group"><i class="fa-solid fa-draw-polygon" inert></i> ${esc(T("Scene.GroupDistricts"))}</h3>
      <fieldset class="mm-hoverset">${legend("fa-hand-pointer", "Scene.Districts")}
        ${select("hoverMode", "Hover.mode", c.hoverMode, [["none", T("Hover.none")], ["saturate", T("Hover.saturate")], ["highlight", T("Hover.highlight")], ["map", T("Hover.map")]], "Hover.hint")}
        ${row("Hover.color", `<color-picker name="${N}.hoverColor" value="${esc(c.hoverColor)}"></color-picker>`, "Hover.colorHint")}
        ${range("hoverStrength", "Hover.strength", c.hoverStrength, 0, 1, 0.05, "Hover.strengthHint")}
      </fieldset>
      <fieldset class="mm-attrset">${legend("fa-list-ol", "Scene.Attrs")}
        ${select("attrDisplay", "Attr.mode", c.attrDisplay, [["off", T("Attr.modeOff")], ["hover", T("Attr.modeHover")], ["always", T("Attr.modeAlways")]], "Attr.modeHint")}
      </fieldset>
      <fieldset class="mm-districtset">${legend("fa-pen-nib", "Scene.DistrictLook")}
        ${range("districtOpacity", "District.opacityDefault", c.districtOpacity, 0, 1, 0.05, "District.opacityHint")}
        ${select("districtInk", "District.ink", c.districtInk, [["ink", T("District.inkDark")], ["match", T("District.inkMatch")], ["custom", T("District.inkCustom")]])}
        ${row("District.inkCustomColor", `<color-picker name="${N}.districtInkColor" value="${esc(c.districtInkColor)}"></color-picker>`)}
        ${range("districtInkOpacity", "District.inkOpacity", c.districtInkOpacity, 0, 1, 0.05)}
        ${range("districtInkWidth", "District.inkWidth", c.districtInkWidth, 0.2, 4, 0.1)}
        ${check("districtNoBorder", "District.noOutline", c.districtNoBorder, "District.noOutlineHint")}
        ${check("districtNoColor", "District.noColor", c.districtNoColor, "District.noColorHint")}
      </fieldset>
      ${fold("mm-dotsset", "fa-braille", "Scene.Dots", dotsFieldsHtml(`${N}.dots.`, c.dots))}
      ${fold("mm-labelset", "fa-font", "Label.sceneSection", labelFieldsHtml(`${N}.label.`, c.label))}
      <fieldset class="mm-playerset">${legend("fa-users", "Scene.Players")}
        ${check("districtListForPlayers", "Panel.players", c.districtListForPlayers, "Panel.playersHint")}
      </fieldset>
    </div>
  </div>`;
}

/** Wire the live preview and the "dim what's off" behaviour. */
/** Every config field of the form as the nested object the scene flag would hold (custom elements included). */
function collectDraft(tab) {
  const pre = `${N}.`, out = {};
  for ( const el of tab.querySelectorAll(`[name^="${pre}"]`) ) {
    if ( el.type === "radio" && !el.checked ) continue;
    foundry.utils.setProperty(out, el.name.slice(pre.length), el.type === "checkbox" ? el.checked : el.value);
  }
  return out;
}

function wire(tab, scene, app) {
  const get = (k) => tab.querySelector(`[name="${N}.${k}"]`);
  const val = (k) => get(k)?.value;
  const on = (k) => !!get(k)?.checked;
  const stage = tab.querySelector(".mm-stage"), wrap = stage.querySelector(".mm-drop"), pin = stage.querySelector(".mm-pin");
  let color = "";
  const dep = (k, enabled) => { const g = get(k)?.closest(".form-group"); if ( g ) { g.classList.toggle("is-off", !enabled); g.inert = !enabled; } };

  const sync = () => {
    const c = val("color") || "#e5322d";
    if ( c !== color ) {
      color = c;
      const src = compositePin(0, c);
      pin.getContext("2d").clearRect(0, 0, 320, 352);
      pin.getContext("2d").drawImage(src, 0, 0);
    }
    const s = stage.style;
    s.setProperty("--mm-h", `${34 + 48 * (+val("dropHeight") || 1)}px`);
    s.setProperty("--mm-sq", String(+val("squeeze")));
    s.setProperty("--mm-bn", String(+val("bounce")));
    s.setProperty("--mm-is", String(+val("idleStrength")));
    s.setProperty("--mm-isp", `${(3.1 / (+val("idleSpeed") || 1)).toFixed(2)}s`);
    pin.dataset.idle = val("idle");
    stage.classList.toggle("no-shadow", !on("shadow"));
    stage.style.setProperty("--mm-scale", String(0.78 + 0.22 * (+val("size") || 1)));
    // switching pins off dims only what belongs to pins; districts are independent of it
    for ( const el of tab.querySelectorAll(".mm-look, .mm-motion, .mm-pintext, .mm-hero-fields .form-group:not(:first-child)") ) { el.classList.toggle("is-off", !on("enabled")); el.inert = !on("enabled"); }
    const dropOff = !on("drop") || !on("enabled"), dsub = tab.querySelector('[data-mm="drop-sub"]');
    dsub.classList.toggle("is-off", dropOff); dsub.inert = dropOff;
    const hm = val("hoverMode");
    dep("hoverColor", hm === "highlight");   // only the highlight effect uses a colour
    dep("hoverStrength", hm !== "none");
    dep("districtInkColor", val("districtInk") === "custom");
    const tokOff = !on("tokens.enabled"), tsub = tab.querySelector('[data-mm="tok-sub"]');
    tsub.classList.toggle("is-off", tokOff); tsub.inert = tokOff;
    for ( const [flag, sel] of [["tokens.target", "tok-target-sub"], ["tokens.combat", "tok-combat-sub"]] ) { const s = tab.querySelector(`[data-mm="${sel}"]`), off = !on(flag); s.classList.toggle("is-off", off); s.inert = off; }
    dep("tokens.reticleColor", on("tokens.target") && !on("tokens.reticleUser"));   // a fixed colour only when not using each user's own
    const idleOff = val("idle") === "none" || !on("enabled"), isub = tab.querySelector('[data-mm="idle-sub"]');
    isub.classList.toggle("is-off", idleOff); isub.inert = idleOff;
  };

  let timer = 0;
  const replay = () => {
    wrap.classList.remove("is-dropping"); stage.classList.remove("is-dropping");
    void wrap.offsetWidth;
    if ( on("drop") ) { wrap.classList.add("is-dropping"); stage.classList.add("is-dropping"); }
    clearTimeout(timer);
  };
  // live: unsaved form values are laid over the scene config as a draft; the pins and districts of the viewed scene follow
  const viewed = scene.id === canvas.scene?.id;
  const pushDraft = frameThrottle(() => { if ( tab.isConnected ) setSceneDraft(scene.id, collectDraft(tab)); });
  if ( viewed ) wireLiveBar(tab, () => app.render());   // re-rendering shows the saved values again and drops the draft
  const changed = (ev) => {
    sync();
    if ( viewed ) pushDraft();
    const n = ev.target?.name ?? "";
    // changing a drop parameter replays the drop so you can feel it
    if ( /\.(drop|dropHeight|bounce|squeeze)$/.test(n) ) { clearTimeout(timer); timer = setTimeout(replay, 120); }
  };
  tab.addEventListener("change", changed);
  tab.addEventListener("input", changed);
  stage.addEventListener("click", replay);
  sync();
  setTimeout(replay, 250);
}

export function onRenderSceneConfig(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if ( !root || !game.user.isGM ) return;
  const nav = root.querySelector("nav.sheet-tabs, nav.tabs");
  if ( !nav ) return;
  root.querySelectorAll(`.moinen-maps-tab, [data-tab="${TAB}"]`).forEach((el) => el.remove());
  const active = app.tabGroups?.sheet === TAB;
  const link = document.createElement("a");
  link.dataset.action = "tab"; link.dataset.group = "sheet"; link.dataset.tab = TAB;
  if ( active ) link.classList.add("active");
  link.innerHTML = `<i class="fa-solid fa-location-dot" inert></i><span>${esc(T("Scene.Tab"))}</span>`;
  const misc = nav.querySelector('[data-tab="misc"]');
  if ( misc ) misc.after(link); else nav.append(link);
  const tmp = document.createElement("div");
  tmp.innerHTML = tabHtml(app.document, active);
  const tab = tmp.firstElementChild;
  const miscTab = root.querySelector('.tab[data-tab="misc"]');
  if ( miscTab ) miscTab.after(tab); else (root.querySelector("footer") ?? root).before(tab);
  setSceneDraft(null);   // a fresh render shows the stored values: no stale draft
  wire(tab, app.document, app); revealFoldsOnOpen(tab); wireDotsFields(tab, `${N}.dots.`);
  wireFontPreview(tab, `${N}.label.`);
}
