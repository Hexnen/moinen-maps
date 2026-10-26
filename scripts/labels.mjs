/**
 * Label typography for districts (and the note tooltip text of pins): font picker, style resolution
 * (built-in default <- scene default <- per-district override), font loading, and the label builder.
 * A label is built once per change (PIXI.Text caches its own texture); per-glyph builds are used only for curved / small-caps text.
 * Only fonts that already exist in Foundry (CONFIG.fontDefinitions, user-added fonts) are offered here; nothing is bundled or downloaded.
 */
import { sceneConfig, reducedMotion } from "./config.mjs";

const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const BASE = 64;                       // labels are rendered large and scaled down, so they stay sharp when zooming in
const INK = "#15110f", CREAM = "#fff3e2";

/** Every family Foundry knows: built-in, definitions, and the user's custom fonts (FontConfig). */
export function fontFamilies() {
  const set = new Set();
  try { for ( const f of foundry.applications.settings.menus.FontConfig.getAvailableFonts() ) set.add(f); } catch {}
  for ( const f of Object.keys(CONFIG.fontDefinitions ?? {}) ) set.add(f);
  try { for ( const f of Object.keys(game.settings.get("core", "fonts") ?? {}) ) set.add(f); } catch {}
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Resolve the effective label style of a district. 0 / false / "" from an override are real values; only undefined/null inherit. */
export function labelCfg(d) {
  const base = foundry.utils.deepClone(sceneConfig(canvas.scene).label ?? {});
  const o = d?.label?.on ? d.label : {};
  for ( const [k, v] of Object.entries(o) ) if ( k !== "on" && v !== undefined && v !== null && !(k === "family" && v === "") ) base[k] = v;
  // the scene tab stores the auto-contrast switch as its own checkbox; a district override stores color === "auto"
  base.autoColor = o.color !== undefined ? o.color === "auto" : (base.autoColor ?? base.color === "auto");
  if ( base.autoColor ) base.color = "auto";
  return base;
}

const loaded = new Map();
/** Resolve once the face is available, so a label is never baked with the fallback font. */
export function ensureFont(family, weight = "400", italic = false) {
  if ( !family ) return Promise.resolve();
  const key = `${family}|${weight}|${italic}`;
  if ( !loaded.has(key) ) {
    const spec = `${italic ? "italic " : ""}${weight} ${BASE}px "${family}"`;
    loaded.set(key, document.fonts.load(spec, "Aa").catch(() => []).then(() => document.fonts.ready));
  }
  return loaded.get(key);
}

const luminance = (hex) => { try { const c = Color.from(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; } catch { return 1; } };

/** Build the label node. `fit` = {d, S}: radius of the largest inscribed circle and the grid size. `tint` = the district colour (for auto contrast). */
export function buildLabel(text, cfg, { d, S, tint }) {
  const family = cfg.family || CONFIG.defaultFontFamily;
  const none = !tint || tint === "none";
  const dark = !none && luminance(tint) < 0.36;
  const fill = cfg.color === "auto" || !cfg.color ? (dark ? CREAM : INK) : cfg.color;
  const stroke = cfg.color === "auto" || !cfg.color ? (dark ? INK : cfg.halo || CREAM) : cfg.halo || CREAM;
  const k = BASE / 36;
  const mk = (size) => new PIXI.TextStyle({
    fontFamily: `"${family}", ${CONFIG.defaultFontFamily}, sans-serif`, fontWeight: String(cfg.weight), fontStyle: cfg.italic ? "italic" : "normal", fontSize: size,
    fill, stroke, strokeThickness: cfg.haloWidth * k, letterSpacing: cfg.spacing * k, lineJoin: "round", align: "center",
    dropShadow: !!cfg.shadow, dropShadowColor: "#000000", dropShadowAlpha: 0.5, dropShadowBlur: 4, dropShadowDistance: 3 * k, dropShadowAngle: Math.PI / 3
  });
  const mode = cfg.caseMode;
  let str = String(text);
  if ( mode === "upper" ) str = str.toUpperCase(); else if ( mode === "lower" ) str = str.toLowerCase();
  const res = Math.max(2, window.devicePixelRatio || 1);
  const node = new PIXI.Container();
  const perGlyph = cfg.curved || mode === "smallcaps";
  if ( !perGlyph ) {
    const t = new PIXI.Text(str, mk(BASE)); t.anchor.set(0.5); t.resolution = res; node.addChild(t);
  } else {
    const glyphs = [...str].map((ch) => {
      const small = mode === "smallcaps" && ch !== ch.toUpperCase();
      const size = small ? BASE * 0.78 : BASE, c = small ? ch.toUpperCase() : ch, st = mk(size);
      return { c, st, w: PIXI.TextMetrics.measureText(c, st).width };
    });
    const total = glyphs.reduce((n, g) => n + g.w, 0), R = Math.max(total * 1.15, 1);
    let x = -total / 2;
    for ( const g of glyphs ) {
      const t = new PIXI.Text(g.c, g.st); t.resolution = res; t.anchor.set(0.5, 0.5);
      const cx = x + g.w / 2; x += g.w;
      if ( cfg.curved ) { const th = cx / R; t.position.set(Math.sin(th) * R, (1 - Math.cos(th)) * R - R * 0.18); t.rotation = th; }
      else t.position.set(cx, 0);
      node.addChild(t);
    }
  }
  const b = node.getLocalBounds();
  const w = Math.max(1, b.width), h = Math.max(1, b.height);
  const s = cfg.sizeMode === "abs" ? cfg.size / BASE : Math.min(1, (d * 1.8) / w, (S * 0.55) / h);
  node.scale.set(s);
  node.rotation = (cfg.angle || 0) * Math.PI / 180;
  node.alpha = cfg.opacity ?? 1;
  return { node, width: w * s, height: h * s };
}

/* ------------------------------------------------------------------ UI */

const opt = (v, cur, label) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(label ?? v)}</option>`;

/**
 * A fold that opens at the bottom of a scrolling area grows out of sight, so the user sees nothing happen. Bring the fold's heading to the top
 * of its scroll area as soon as it opens, which puts its first controls in view.
 */
export function revealFoldsOnOpen(root) {
  root.addEventListener("toggle", (e) => {
    const d = e.target;
    if ( d?.tagName !== "DETAILS" || !d.open ) return;
    requestAnimationFrame(() => d.querySelector(":scope > summary")?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" }));
  }, true);
}

/**
 * Keep a dialog inside the viewport: its body scrolls (see maps.css), and whenever its height changes (a fold opens, a row is added)
 * it is nudged up so the footer buttons stay on screen. Safe to call from any dialog's render callback.
 */
export function fitDialog(app) {
  const el = app?.element; if ( !el || el._mmFit ) return;
  el._mmFit = true;
  revealFoldsOnOpen(el);
  const ro = new ResizeObserver(() => clamp());
  const clamp = () => {
    if ( !el.isConnected || !app.element ) return ro.disconnect();   // closed: nothing left to position
    const r = el.getBoundingClientRect(), m = 8;
    if ( r.bottom > innerHeight - m || r.top < m ) app.setPosition({ top: Math.max(m, Math.min(r.top, innerHeight - m - r.height)) });
  };
  ro.observe(el);
  el.addEventListener("toggle", clamp, true);
  clamp();
}

/** The "live preview" strip shown in every editor: changes already show on the map; Reset returns to the saved look. */
export function liveBarHtml(active = true) {
  return `<div class="mm-live${active ? "" : " is-idle"}" role="status" title="${esc(T("Live.hint"))}"><span class="mm-live-dot" aria-hidden="true"></span><span class="mm-live-text">${esc(T(active ? "Live.label" : "Live.noCanvas"))}</span>${active ? `<button type="button" class="mm-live-reset" data-act="live-reset"><i class="fa-solid fa-rotate-left" inert></i> ${esc(T("Live.reset"))}</button>` : ""}</div>`;
}
export function wireLiveBar(root, onReset) { root.querySelector('[data-act="live-reset"]')?.addEventListener("click", onReset); }

/** Call `fn` at most once per animation frame while the user keeps editing. */
export function frameThrottle(fn) {
  let raf = 0;
  return () => { if ( raf ) return; raf = requestAnimationFrame(() => { raf = 0; fn(); }); };
}

let UID = 0;
/**
 * One labelled form row. The label is tied to its control (`for`/`id`) and a hint, when given, is announced with it (`aria-describedby`).
 * `field` is trusted markup whose first control element receives the id. Text arguments are already localised.
 */
export function fg(label, field, hint = "", cls = "") {
  const n = ++UID, id = `mm-f${n}`, hid = `mm-h${n}`;
  const html = String(field).replace(/<(select|input|range-picker|color-picker|textarea)/, `<$1 id="${id}"${hint ? ` aria-describedby="${hid}"` : ""}`);
  return `<div class="form-group${cls ? " " + cls : ""}"><label for="${id}">${esc(label)}</label><div class="form-fields">${html}</div>${hint ? `<p class="hint" id="${hid}">${esc(hint)}</p>` : ""}</div>`;
}
/** A row whose control is a group of buttons (swatches): the label names the group instead of a single input. */
export function fgGroup(label, inner, cls = "") {
  const id = `mm-g${++UID}`;
  return `<div class="form-group stacked${cls ? " " + cls : ""}" role="group" aria-labelledby="${id}"><label id="${id}">${esc(label)}</label>${inner}</div>`;
}

/** The label controls. `p` is the field-name prefix, `v` the current values. Fields are plain named inputs. */
export function labelFieldsHtml(p, v) {
  const fam = [`<option value=""${!v.family ? " selected" : ""}>${esc(T("Label.default"))}</option>`]
    .concat(fontFamilies().map((f) => `<option value="${esc(f)}" style="font-family:'${esc(f)}'"${f === v.family ? " selected" : ""}>${esc(f)}</option>`)).join("");
  const g = (label, field, hint) => fg(T(label), field, hint ? T(hint) : "");
  const rng = (n, val, min, max, step) => `<range-picker name="${p}${n}" value="${val}" min="${min}" max="${max}" step="${step}"></range-picker>`;
  const chk = (n, val) => `<input type="checkbox" name="${p}${n}"${val ? " checked" : ""}>`;
  const sel = (n, val, opts) => `<select name="${p}${n}">${opts.map(([a, b]) => opt(a, val, b)).join("")}</select>`;
  return `<div class="mm-fontpreview" data-mm="fontpreview" aria-hidden="true">${esc(T("Label.sample"))}</div>
    ${g("Label.family", `<select name="${p}family" class="mm-fontselect">${fam}</select>`)}
    ${g("Label.sizeMode", sel("sizeMode", v.sizeMode, [["fit", T("Label.fit")], ["abs", T("Label.abs")]]))}
    ${g("Label.size", rng("size", v.size, 8, 160, 1), "Label.sizeHint")}
    ${g("Label.weight", sel("weight", v.weight, [["400", T("Label.regular")], ["700", T("Label.bold")]]) + `<label class="mm-inline">${chk("italic", v.italic)} ${esc(T("Label.italic"))}</label>`)}
    ${g("Label.spacing", rng("spacing", v.spacing, -2, 20, 0.5))}
    ${g("Label.case", sel("caseMode", v.caseMode, [["none", T("Label.caseNone")], ["upper", T("Label.caseUpper")], ["lower", T("Label.caseLower")], ["smallcaps", T("Label.caseSmall")]]))}
    ${g("Label.color", `<label class="mm-inline">${chk("autoColor", v.autoColor ?? (v.color === "auto" || !v.color))} ${esc(T("Label.auto"))}</label><color-picker name="${p}color" value="${esc(v.color && v.color !== "auto" ? v.color : INK)}"></color-picker>`, "Label.colorHint")}
    ${g("Label.halo", `<color-picker name="${p}halo" value="${esc(v.halo || CREAM)}"></color-picker>`)}
    ${g("Label.haloWidth", rng("haloWidth", v.haloWidth, 0, 20, 0.5))}
    ${g("Label.shadow", chk("shadow", v.shadow))}
    ${g("Label.opacity", rng("opacity", v.opacity, 0, 1, 0.05))}
    ${g("Label.curved", chk("curved", v.curved))}
    ${g("Label.angle", rng("angle", v.angle, -90, 90, 1))}
    ${g("Label.offsetX", rng("offsetX", v.offsetX, -2, 2, 0.05))}
    ${g("Label.offsetY", rng("offsetY", v.offsetY, -2, 2, 0.05))}`;
}

/** Read label values out of already-collected form values (see readForm). */
export function readLabelValues(vals, p) {
  const num = (k) => Number(vals[p + k]);
  return {
    family: vals[p + "family"] ?? "", sizeMode: vals[p + "sizeMode"], size: num("size"), weight: vals[p + "weight"], italic: !!vals[p + "italic"],
    spacing: num("spacing"), caseMode: vals[p + "caseMode"], color: vals[p + "autoColor"] ? "auto" : vals[p + "color"], halo: vals[p + "halo"],
    haloWidth: num("haloWidth"), shadow: !!vals[p + "shadow"], opacity: num("opacity"), curved: !!vals[p + "curved"],
    angle: num("angle"), offsetX: num("offsetX"), offsetY: num("offsetY")
  };
}

/** Keep the preview line in sync with the controls (each family in the picker already renders in its own face). */
export function wireFontPreview(root, p) {
  const prev = root.querySelector('[data-mm="fontpreview"]');
  if ( !prev ) return;
  const val = (k) => root.querySelector(`[name="${p}${k}"]`);
  const dep = (k, on) => { const g = val(k)?.closest(".form-group"); if ( g ) { g.classList.toggle("is-off", !on); g.inert = !on; } };
  const update = async () => {
    dep("size", val("sizeMode")?.value === "abs");   // a fixed pixel size only matters in "fixed size" mode
    const cp = val("color"); if ( cp ) { cp.inert = !!val("autoColor")?.checked; cp.classList.toggle("is-off", cp.inert); }   // the colour only matters with auto contrast off
    const fam = val("family")?.value || CONFIG.defaultFontFamily, weight = val("weight")?.value ?? "700", italic = !!val("italic")?.checked;
    await ensureFont(fam, weight, italic);
    const auto = !!val("autoColor")?.checked, halo = val("halo")?.value || CREAM, hw = Number(val("haloWidth")?.value ?? 0);
    const cs = val("caseMode")?.value;
    Object.assign(prev.style, {
      fontFamily: `"${fam}", sans-serif`, fontWeight: weight, fontStyle: italic ? "italic" : "normal",
      letterSpacing: `${Number(val("spacing")?.value ?? 0) * 0.5}px`,
      textTransform: cs === "upper" ? "uppercase" : cs === "lower" ? "lowercase" : "none", fontVariant: cs === "smallcaps" ? "small-caps" : "normal",
      color: auto ? INK : val("color")?.value, background: "#e8dcc0", opacity: String(Number(val("opacity")?.value ?? 1)),
      textShadow: hw ? [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 2], [0, -2], [2, 0], [-2, 0]].map(([x, y]) => `${x * hw / 8}px ${y * hw / 8}px 0 ${halo}`).join(",") : "none",
      transform: `rotate(${Number(val("angle")?.value ?? 0)}deg)`
    });
  };
  root.addEventListener("change", update); root.addEventListener("input", update);
  update();
}

/** Pin tooltip text (scene level). */
export function applyPinText(note, cfg) {
  const tt = note.tooltip, pt = cfg.pinText;
  if ( !tt || !pt ) return;
  if ( !(pt.family || pt.size || pt.color || pt.halo || pt.haloWidth) ) return;
  const st = tt.style, fam = pt.family || note.document.fontFamily || CONFIG.defaultFontFamily;
  const want = { fontFamily: fam, fontSize: pt.size || note.document.fontSize, fill: pt.color || note.document.textColor, stroke: pt.halo || st.stroke, strokeThickness: pt.haloWidth || st.strokeThickness };
  let dirty = false;
  for ( const [k, v] of Object.entries(want) ) {
    if ( (k === "fill" ? Color.from(st.fill).valueOf() !== Color.from(v).valueOf() : st[k] !== v) ) { st[k] = v; dirty = true; }
  }
  if ( dirty ) ensureFont(fam, "400", false).then(() => { tt.dirty = true; });
}
