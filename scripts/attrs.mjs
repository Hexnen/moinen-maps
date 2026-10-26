/**
 * District attributes: each district may carry any number of {id, name, value, players} attributes (value is a number or null).
 *
 * Storage. The scene flag syncs to every client, so it only ever holds the attributes marked "visible to players", published as
 * `district.attrs = [{id, name, value}]` (absent = none; the format of older scenes is unchanged). The complete list, including
 * GM-only attributes, lives in a hidden journal entry whose default ownership is NONE, keyed by scene and district id. Foundry
 * does not send documents a player cannot observe, so those values never reach player clients. GM clients read the journal and fall
 * back to the published flag when it has no entry for a district (e.g. a duplicated scene).
 *
 * The hover card is one reused DOM element; nothing here runs per frame.
 */
import { MODULE_ID, sceneConfig } from "./config.mjs";
import { labelCfg } from "./labels.mjs";

const FLAG = "districts";
export const HOOK = "moinenMaps.districtAttrChanged";
const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const norm = (s) => String(s ?? "").trim();
const sameName = (a, b) => norm(a).toLocaleLowerCase() === norm(b).toLocaleLowerCase();
const toNum = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) ? null : Number(v);
const round = (n) => Math.round(n * 1e6) / 1e6;

let fmtCache = null, fmtLang = "";
export function fmt(v) {
  if ( v === null || v === undefined ) return "–";
  if ( !fmtCache || fmtLang !== game.i18n.lang ) { fmtLang = game.i18n.lang; fmtCache = new Intl.NumberFormat(fmtLang, { maximumFractionDigits: 4 }); }
  return fmtCache.format(v);
}

/* ------------------------------------------------------------------ GM-only store */

let storeId = null;
const isStoreDoc = (j) => j?.flags?.[MODULE_ID]?.isStore === true;
export const isStore = isStoreDoc;
export const resetStore = () => { storeId = null; };
function storeDoc() {
  if ( !game.user.isGM ) return null;
  let d = storeId && game.journal.get(storeId);
  if ( d ) return d;
  d = game.journal.find(isStoreDoc) ?? null;
  storeId = d?.id ?? null;
  return d;
}
async function ensureStore() {
  const d = storeDoc();
  if ( d ) return d;
  const made = await JournalEntry.create({
    name: "Moinen Maps: district attributes (GM only, do not delete)", ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    flags: { [MODULE_ID]: { isStore: true, store: {} } }
  });
  storeId = made.id;
  return made;
}

/** The attributes of a district as this user may see them. GM: everything. Player: only what was published. */
export function attrsOf(d) {
  if ( !d ) return [];
  if ( d._attrs ) return d._attrs;   // live preview draft (never stored)
  if ( game.user.isGM ) {
    const s = storeDoc()?.flags?.[MODULE_ID]?.store?.[canvas.scene?.id]?.[d.id];
    if ( Array.isArray(s) ) return s;
  }
  return (d.attrs ?? []).map((a) => ({ players: true, ...a }));
}
const sceneList = () => canvas.scene?.flags?.[MODULE_ID]?.[FLAG] ?? [];
const districtById = (id) => sceneList().find((d) => d.id === id);

/** The two attributes most districts want, localised. They always head the suggestion list. */
export const usualNames = () => [T("Attr.sugSecurity"), T("Attr.sugWealth")];

/** Suggested names: the usual ones first, then every other name already used on this scene, in first-seen order. */
export function usedNames() {
  const seen = new Map(usualNames().map((n) => [n.toLocaleLowerCase(), n]));
  for ( const d of sceneList() ) for ( const a of attrsOf(d) ) { const k = norm(a.name).toLocaleLowerCase(); if ( k && !seen.has(k) ) seen.set(k, norm(a.name)); }
  return [...seen.values()];
}

/* ------------------------------------------------------------------ writing */

let chain = Promise.resolve();
const queued = (fn) => (chain = chain.then(fn, fn));

function diffAndFire(districtId, before, after) {
  const prev = new Map(before.map((a) => [a.id, a]));
  for ( const a of after ) {
    const p = prev.get(a.id);
    if ( !p || p.value !== a.value || p.name !== a.name ) Hooks.callAll(HOOK, districtId, a.name, a.value, p ? p.value : null);
    prev.delete(a.id);
  }
  for ( const p of prev.values() ) Hooks.callAll(HOOK, districtId, p.name, null, p.value);
}

/** Normalise raw editor rows the way they will be stored (used for the live preview as well as for saving). */
export const cleanAttrs = (attrs) => attrs.map((a) => ({ id: a.id || foundry.utils.randomID(), name: norm(a.name), value: toNum(a.value), players: !!a.players })).filter((a) => a.name);

/** Replace the complete attribute list of one district (GM only). Updates the hidden store, then publishes the player-visible subset. */
export function writeAttrs(districtId, attrs) {
  if ( !game.user.isGM ) return Promise.resolve(false);
  return queued(async () => {
    const scene = canvas.scene, d = districtById(districtId);
    if ( !scene || !d ) return false;
    const before = attrsOf(d).map((a) => ({ ...a }));
    const clean = attrs.map((a) => ({ id: a.id || foundry.utils.randomID(), name: norm(a.name), value: toNum(a.value), players: !!a.players })).filter((a) => a.name);
    if ( JSON.stringify(before) === JSON.stringify(clean) ) return true;
    const store = await ensureStore();
    await store.update({ [`flags.${MODULE_ID}.store.${scene.id}.${districtId}`]: clean });
    const list = foundry.utils.deepClone(sceneList()), cur = list.find((x) => x.id === districtId);
    if ( cur ) {
      const pub = clean.filter((a) => a.players).map(({ id, name, value }) => ({ id, name, value }));
      if ( !foundry.utils.objectsEqual(cur.attrs ?? [], pub) ) { cur.attrs = pub; await scene.update({ [`flags.${MODULE_ID}.${FLAG}`]: list }); }
    }
    diffAndFire(districtId, before, clean);
    return true;
  });
}

/** Drop store entries of districts that no longer exist on the scene. */
export function pruneStore(list) {
  const doc = storeDoc(), sid = canvas.scene?.id, map = doc?.flags?.[MODULE_ID]?.store?.[sid];
  if ( !map ) return;
  const ids = new Set(list.map((d) => d.id)), gone = Object.keys(map).filter((k) => !ids.has(k));
  if ( gone.length ) doc.update(Object.fromEntries(gone.map((k) => [`flags.${MODULE_ID}.store.${sid}.-=${k}`, null])));
}

/** Set one attribute's value by id (the panel stepper). */
export function setAttrById(districtId, attrId, value) {
  const d = districtById(districtId); if ( !d ) return Promise.resolve(false);
  const all = attrsOf(d).map((a) => ({ ...a }));
  const a = all.find((x) => x.id === attrId); if ( !a ) return Promise.resolve(false);
  a.value = toNum(value);
  return writeAttrs(districtId, all);
}
export const stepAttrById = (districtId, attrId, delta) => {
  const a = attrsOf(districtById(districtId)).find((x) => x.id === attrId);
  return setAttrById(districtId, attrId, round((a?.value ?? 0) + delta));
};

/* ------------------------------------------------------------------ public API (macros, other modules) */

export const api = {
  /** Districts of the current scene with the attributes this user may see. */
  getDistricts() {
    return sceneList().filter((d) => game.user.isGM || d.revealed)
      .map((d) => ({ id: d.id, name: d.name, color: d.color, revealed: !!d.revealed, attrs: attrsOf(d).map((a) => ({ ...a })) }));
  },
  /** Value of an attribute (case-insensitive name), or undefined when it does not exist. */
  getAttr(districtId, name) {
    const d = districtById(districtId);
    if ( !d || (!game.user.isGM && !d.revealed) ) return undefined;
    return attrsOf(d).find((a) => sameName(a.name, name))?.value;
  },
  /** Set (or create) an attribute. GM only. Pass `{ players: true }` to publish a new attribute. Resolves to the new value, or null on failure. */
  async setAttr(districtId, name, value, { players } = {}) {
    if ( !game.user.isGM ) { console.warn(`${MODULE_ID} | setAttr is GM only`); return null; }
    const d = districtById(districtId), nm = norm(name);
    if ( !d || !nm ) return null;
    const all = attrsOf(d).map((a) => ({ ...a })), cur = all.find((a) => sameName(a.name, nm));
    if ( cur ) { cur.value = toNum(value); if ( players !== undefined ) cur.players = !!players; }
    else all.push({ id: foundry.utils.randomID(), name: nm, value: toNum(value), players: !!players });
    return (await writeAttrs(districtId, all)) ? toNum(value) : null;
  },
  /** Add `delta` to an attribute (a missing or empty one counts as 0). GM only. Resolves to the new value. */
  async addToAttr(districtId, name, delta) {
    const cur = api.getAttr(districtId, name);
    return api.setAttr(districtId, name, round((cur ?? 0) + Number(delta)));
  }
};

/* ------------------------------------------------------------------ hover card (one reused element) */

let card = null, cardKey = "", cw = 0, ch = 0;
function ensureCard() {
  if ( card?.isConnected ) return card;
  card = document.createElement("div");
  card.className = "mm-card"; card.setAttribute("aria-hidden", "true");
  document.body.append(card);
  cardKey = "";
  return card;
}
const lum = (hex) => { try { const c = Color.from(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; } catch { return 1; } };

export function showCard(d, ev) {
  if ( sceneConfig(canvas.scene).attrDisplay !== "hover" ) return hideCard();
  const attrs = attrsOf(d).filter((a) => a.name);
  if ( !attrs.length ) return hideCard();
  const c = ensureCard(), cfg = labelCfg(d);
  const key = JSON.stringify([d.id, d.name, d.color, attrs, cfg.family, game.user.isGM]);
  if ( key !== cardKey ) {
    cardKey = key;
    const none = !d.color || d.color === "none";
    c.style.setProperty("--mm-card-dot", none ? "transparent" : d.color);
    c.style.fontFamily = cfg.family ? `"${cfg.family}", var(--font-primary), sans-serif` : "";
    c.classList.toggle("no-dot", none);
    c.innerHTML = `${d.name ? `<div class="mm-card-title"><span class="mm-card-dot"></span>${esc(d.name)}</div>` : ""}
      <dl>${attrs.map((a) => `<div class="${a.players || !game.user.isGM ? "" : "gm"}"><dt>${esc(a.name)}</dt><dd>${esc(fmt(a.value))}</dd></div>`).join("")}</dl>`;
    cw = c.offsetWidth; ch = c.offsetHeight;
  }
  moveCard(ev);
  c.classList.add("on");
}
export function moveCard(ev) {
  if ( !card ) return;
  const m = 8;
  let x = ev.clientX + 18, y = ev.clientY + 20;
  if ( x + cw > innerWidth - m ) x = ev.clientX - cw - 18;
  if ( y + ch > innerHeight - m ) y = innerHeight - ch - m;
  card.style.transform = `translate(${Math.max(m, x)}px, ${Math.max(m, y)}px)`;
}
export function hideCard() { card?.classList.remove("on"); }
export function destroyCard() { card?.remove(); card = null; cardKey = ""; }

/** Colour pair for text drawn over a district (matches the label's auto contrast). */
export const inkFor = (tint) => (tint && tint !== "none" && lum(tint) < 0.36) ? { fill: "#fff3e2", stroke: "#15110f" } : { fill: "#15110f", stroke: "#fff3e2" };

/* ------------------------------------------------------------------ editor (district dialog) */

let UID = 0;
const rowHtml = (a) => `<li class="mm-attr-row" data-id="${esc(a.id || foundry.utils.randomID())}">
  <input type="text" class="mm-attr-name" value="${esc(a.name)}" placeholder="${esc(T("Attr.namePh"))}" aria-label="${esc(T("Attr.name"))}" autocomplete="off">
  <input type="number" step="any" class="mm-attr-val" value="${a.value ?? ""}" aria-label="${esc(T("Attr.value"))}">
  <button type="button" class="mm-icon mm-attr-vis" data-act="vis" aria-pressed="${!!a.players}" aria-label="${esc(T("Attr.visible"))}" data-tooltip="${esc(T("Attr.visible"))}"><i class="fa-solid ${a.players ? "fa-eye" : "fa-eye-slash"}" inert></i></button>
  <button type="button" class="mm-icon" data-act="up" aria-label="${esc(T("Attr.up"))}" data-tooltip="${esc(T("Attr.up"))}"><i class="fa-solid fa-chevron-up" inert></i></button>
  <button type="button" class="mm-icon" data-act="down" aria-label="${esc(T("Attr.down"))}" data-tooltip="${esc(T("Attr.down"))}"><i class="fa-solid fa-chevron-down" inert></i></button>
  <button type="button" class="mm-icon mm-danger" data-act="del" aria-label="${esc(T("Attr.remove"))}" data-tooltip="${esc(T("Attr.remove"))}"><i class="fa-solid fa-xmark" inert></i></button>
</li>`;

export function attrEditorHtml(attrs) {
  const dl = `mm-attr-names-${++UID}`;
  return `<datalist id="${dl}">${usedNames().map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
    <div class="mm-attrs" data-mm="attrs" data-list="${dl}">
      <ol class="mm-attr-list" aria-label="${esc(T("Attr.title"))}">${attrs.map(rowHtml).join("")}</ol>
      <button type="button" class="mm-attr-usual" data-act="usual"${attrs.length ? " hidden" : ""}><i class="fa-solid fa-wand-magic-sparkles" inert></i> ${esc(game.i18n.format("MOINENMAPS.Attr.usual", { names: usualNames().join(", ") }))}</button>
      <button type="button" class="mm-attr-add" data-act="add"><i class="fa-solid fa-plus" inert></i> ${esc(T("Attr.add"))}</button>
      <p class="hint">${esc(T("Attr.hint"))}</p>
    </div>`;
}

export function wireAttrEditor(root) {
  const box = root.querySelector('[data-mm="attrs"]'); if ( !box ) return;
  const ol = box.querySelector("ol");
  const refresh = () => {
    box.querySelector('[data-act="usual"]').hidden = !!ol.children.length;
    paint();
  };
  const paint = () => ol.querySelectorAll(".mm-attr-row").forEach((li, i, all) => {
    li.querySelector('[data-act="up"]').disabled = i === 0;
    li.querySelector('[data-act="down"]').disabled = i === all.length - 1;
    li.querySelector(".mm-attr-name").setAttribute("list", box.dataset.list);
  });
  const add = (after) => {
    const t = document.createElement("template"); t.innerHTML = rowHtml({ name: "", value: null, players: false });
    const li = t.content.firstElementChild;
    after ? after.after(li) : ol.append(li);
    refresh(); li.querySelector(".mm-attr-name").focus();
  };
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if ( !b || !box.contains(b) ) return;
    const li = b.closest(".mm-attr-row"), act = b.dataset.act;
    if ( act === "add" ) return add();
    if ( act === "usual" ) {
      const have = new Set([...ol.querySelectorAll(".mm-attr-name")].map((x) => x.value.trim().toLocaleLowerCase()));
      for ( const n of usualNames() ) if ( !have.has(n.toLocaleLowerCase()) ) { add(ol.lastElementChild); ol.lastElementChild.querySelector(".mm-attr-name").value = n; }
      ol.querySelector(".mm-attr-val")?.focus();
      return;
    }
    if ( act === "vis" ) { const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(on)); b.firstElementChild.className = `fa-solid ${on ? "fa-eye" : "fa-eye-slash"}`; return; }
    if ( act === "del" ) { const next = li.nextElementSibling ?? li.previousElementSibling; li.remove(); refresh(); (next?.querySelector(".mm-attr-name") ?? box.querySelector(".mm-attr-add")).focus(); return; }
    if ( act === "up" && li.previousElementSibling ) li.previousElementSibling.before(li);
    if ( act === "down" && li.nextElementSibling ) li.nextElementSibling.after(li);
    refresh();
    // keep keyboard focus on the arrow that was used, or hand it to its twin when it just became disabled
    (b.disabled ? li.querySelector(`[data-act="${act === "up" ? "down" : "up"}"]`) : b)?.focus();
  });
  // Enter adds a row instead of submitting the dialog
  box.addEventListener("keydown", (e) => {
    if ( e.key !== "Enter" || !e.target.matches(".mm-attr-name, .mm-attr-val") ) return;
    e.preventDefault(); e.stopPropagation(); add(e.target.closest(".mm-attr-row"));
  });
  refresh();
}

/** Read the rows back (empty names are dropped by writeAttrs). */
export function collectAttrs(root) {
  return [...root.querySelectorAll(".mm-attr-row")].map((li) => ({
    id: li.dataset.id, name: li.querySelector(".mm-attr-name").value, value: li.querySelector(".mm-attr-val").value,
    players: li.querySelector('[data-act="vis"]').getAttribute("aria-pressed") === "true"
  }));
}

/* ------------------------------------------------------------------ scene-wide numbers for the panel */

export function totals(districts) {
  const map = new Map();
  for ( const d of districts ) for ( const a of attrsOf(d) ) {
    const k = norm(a.name).toLocaleLowerCase(); if ( !k || a.value === null || a.value === undefined ) continue;
    const t = map.get(k) ?? { name: norm(a.name), sum: 0 };
    t.sum = round(t.sum + a.value); map.set(k, t);
  }
  return [...map.values()];
}

