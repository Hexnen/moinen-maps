import * as Zones from "./zones.mjs";
import { pick } from "./interact.mjs";
import { BORDER_KINDS, ARMOR, FEATURES, TERRAINS, TAGS, FIRE_MAX, FLOORS_MAX } from "./marks.mjs";
import { WALL_STATES, DOOR_STATES, DOOR_BUILT, ARMOR_MAX, built } from "./borders.mjs";
import { STATE_KINDS, EDGE_KINDS, NAME_RE } from "./states.mjs";

/**
 * The right-click menu of the Zones section (GM). A plain HTML popover at the cursor; it closes on Escape, a click elsewhere, a
 * pan or zoom.
 *
 * Near a BORDER: what it is built as (open, door, locked door, wall, exterior wall, reinforced wall - the quick kinds), then the
 * wall and the optional door each with their own Armor (borders.mjs), and what happened to them in play (the wall breached or
 * removed, the door opened, locked, sealed, breached).
 *
 * Inside a ZONE, three pages: "Zone" (features, the attributes the rules read - an empty zone, what wrecking takes, the resources
 * in it), "States" (the GM's quick marks and the tracked states of the registry: kind, level, the level of the zone they hold on)
 * and "Passages" (temporary edges: a portal or a tunnel to another zone, its other end picked on the map).
 *
 * Who may do what: building (kinds, Armor, doors, features, attributes) is the map maker's - any GM, one step of the editor's undo.
 * Play state (wall and door states, tracked states, passages) is written by the active GM's client only (zones.mjs apply): another
 * GM sees those controls switched off with a line saying whose they are, and a refused write is told in a notice.
 */

let el = null, offs = [], page = "features";
const Z = (k, d) => (d ? game.i18n.format(`MOINENMAPS.Zones.${k}`, d) : game.i18n.localize(`MOINENMAPS.Zones.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const api = () => Zones.zonesApi;

export function close() {
  for ( const f of offs ) f();
  offs = [];
  el?.remove(); el = null;
}

/** Tell the GM why a write of play state did not happen (a result of apply()); true when it did. */
export function told(r) {
  if ( r?.ok !== false ) return true;
  ui.notifications.warn(Zones.refusalText(r));
  return false;
}

/** Open at a screen point for a scene point: the border menu when a border is within ~12 screen px, else the zone menu. */
export function open(client, at) {
  close();
  const zoom = canvas.stage.scale.x, tol = Math.max(12 / zoom, Zones.gridSize() * 0.08);
  const border = Zones.borderAt(at.x, at.y, tol);
  const zone = Zones.zones() ? api().zoneAt(at.x, at.y) : -1;
  if ( !border && zone < 0 ) return false;
  el = document.createElement("div");
  el.className = "mm-z-menu";
  document.body.append(el);
  let which = border ? "border" : "zone";
  const here = () => Zones.borderAt(at.x, at.y, tol);
  const bkey = () => { const q = here(); return q ? [q.a, q.b] : null; };
  const draw = (w = which) => {
    if ( !el ) return;
    which = w;
    // (the control in hand keeps the focus through a redraw)
    const f = document.activeElement, sel = f && el.contains(f) ? f.dataset.focus ?? null : null;
    el.innerHTML = which === "border" ? borderHtml(here(), zone >= 0) : zoneHtml(zone, !!border);
    place(client);
    if ( sel ) el.querySelector(`[data-focus="${CSS.escape(sel)}"]`)?.focus();
  };
  draw();
  // a write of play state resolves later: say why it was refused, then show what is true now
  const play = (promise) => Promise.resolve(promise).then((r) => { told(r); draw(); });

  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-act]"); if ( !b || b.disabled ) return;
    const a = b.dataset.act;
    if ( a === "kind" ) { Zones.setBorder(at.x, at.y, b.dataset.kind); close(); }
    else if ( a === "toZone" ) draw("zone");
    else if ( a === "toBorder" ) draw("border");
    else if ( a === "tab" ) { page = b.dataset.tab; draw(); }
    else if ( a === "fire+" || a === "fire-" ) {
      // a new fire starts at Intensity 6 (the book: 6-9 for most fires), then one step at a time
      const cur = Zones.marks()?.zones.get(zone)?.fire ?? 0;
      const f = a === "fire+" ? (cur ? Math.min(FIRE_MAX, cur + 1) : 6) : Math.max(0, cur - 1);
      Zones.setZone(zone, { fire: f }, at);
      draw();
    }
    else if ( a === "floors+" || a === "floors-" ) {
      const cur = Zones.ownMarks()?.zones.get(zone)?.floors ?? 0;
      Zones.setZone(zone, { floors: Math.max(0, Math.min(FLOORS_MAX, cur + (a === "floors+" ? 1 : -1) * (ev.shiftKey ? 5 : 1))) }, at);
      draw();
    }
    else if ( a === "tag" ) {
      const cur = Zones.ownMarks()?.zones.get(zone)?.tags ?? [], t = b.dataset.tag;
      Zones.setZone(zone, { tags: cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t] }, at);
      draw();
    }
    else if ( a === "clearZone" ) { Zones.clearStates(zone); draw(); }
    else if ( a === "fireRound" ) { Zones.fireRound(); close(); }
    else if ( a === "endScene" ) { Zones.clearStates(); close(); }
    // borders go back as built only when the GM says so (never on their own)
    else if ( a === "restoreBorder" ) { const k = bkey(); if ( k ) play(Zones.restoreBorders(k)); }
    else if ( a === "restoreBorders" ) { Zones.restoreBorders().then(told); close(); }
    // the wall and the door as built: Armor one step at a time (Shift: five)
    else if ( a === "wallArmor+" || a === "wallArmor-" || a === "doorArmor+" || a === "doorArmor-" ) {
      const q = here(), part = a.startsWith("wall") ? q?.wall : q?.door;
      if ( !part ) return;
      const n = Math.max(0, Math.min(ARMOR_MAX, part.armor + (a.endsWith("+") ? 1 : -1) * (ev.shiftKey ? 5 : 1)));
      Zones.editBorder([q.a, q.b], a.startsWith("wall") ? { wall: { armor: n } } : { door: { armor: n } });
      draw();
    }
    // the tracked states of the registry
    else if ( a === "recAdd" ) {
      const sel = el.querySelector("select[name=recKind]")?.value, name = sel === "other" ? el.querySelector("input[name=recName]")?.value.trim() : sel;
      if ( !name || !NAME_RE.test(name) ) { ui.notifications.warn(Z("reg.badName")); return; }
      play(Zones.addZoneState(api().keyOf(zone), { kind: name }));
    }
    else if ( a === "recDel" ) play(Zones.removeZoneState(b.closest("[data-rec]").dataset.rec));
    else if ( a === "recLevel+" || a === "recLevel-" ) {
      const id = b.closest("[data-rec]").dataset.rec, cur = Zones.zoneState(id)?.level;
      const n = a === "recLevel+" ? (cur == null ? 1 : cur + (ev.shiftKey ? 5 : 1)) : cur == null || cur <= 1 ? null : cur - (ev.shiftKey ? 5 : 1);
      play(Zones.updateZoneState(id, { level: n == null ? null : Math.max(1, n) }));
    }
    // passages: the other end is picked on the map
    else if ( a === "edgeDel" ) play(Zones.removeEdge(b.closest("[data-edge]").dataset.edge));
    else if ( a === "edgePick" ) {
      const kind = el.querySelector("select[name=edgeKind]")?.value ?? "portal", from = api().keyOf(zone), n = Zones.zoneName(zone);
      close();
      const others = (Zones.zones()?.zones ?? []).filter((z) => z.id !== zone).map((z) => api().keyOf(z.id));
      pick({ zones: others, title: Z("edge.pickTitle", { kind: Z(`edge.kind.${kind}`), n }), color: "range" }).then((r) => {
        if ( r.ok ) Zones.addEdge({ kind, a: from, b: r.spot }).then(told);
      });
    }
  });
  el.addEventListener("change", (ev) => {
    const c = ev.target, name = c.getAttribute("name");
    if ( !name ) return;
    const q = here(), pair = q ? [q.a, q.b] : null, v = c.type === "checkbox" ? c.checked : c.value;
    // the border as built
    if ( name === "wallOuter" ) { if ( pair ) Zones.editBorder(pair, { wall: { outer: !!v } }); draw(); }
    else if ( name === "hasDoor" ) { if ( pair ) Zones.editBorder(pair, { door: v ? {} : null }); draw(); }
    else if ( name === "doorBuilt" ) { if ( pair ) Zones.editBorder(pair, { door: { state: v } }); draw(); }
    // the border in play
    else if ( name === "wallNow" ) { if ( pair ) play(Zones.setBorderState(pair, { wall: { state: v } })); }
    else if ( name === "wallTemp" ) { if ( pair ) play(Zones.setBorderState(pair, { wall: { temp: !!v } })); }
    else if ( name === "doorNow" ) { if ( pair ) play(Zones.setBorderState(pair, { door: { state: v } })); }
    // a tracked state
    else if ( name === "recAt" ) play(Zones.updateZoneState(c.closest("[data-rec]").dataset.rec, { at: v || null }));
    else if ( name === "recMode" ) {
      const id = c.closest("[data-rec]").dataset.rec, data = { ...(Zones.zoneState(id)?.data ?? {}) };
      if ( v ) data.mode = v; else delete data.mode;
      play(Zones.updateZoneState(id, { data: Object.keys(data).length ? data : null }));
    }
    else if ( name === "recKind" ) { const i = el.querySelector(".mm-z-recname"); if ( i ) { i.hidden = v !== "other"; if ( !i.hidden ) i.querySelector("input")?.focus(); } }
    else if ( name === "recName" || name === "edgeKind" ) { /* read when the button is pressed */ }
    // the zone's own marks
    else { Zones.setZone(zone, { [name]: v }, at); draw(); }
  });
  const outside = (ev) => { if ( el && !el.contains(ev.target) ) close(); };
  const key = (ev) => { if ( ev.key === "Escape" ) { ev.stopPropagation(); close(); } };
  setTimeout(() => { if ( !el ) return; document.addEventListener("pointerdown", outside, true); }, 0);
  window.addEventListener("keydown", key, true);
  const pan = Hooks.on("canvasPan", close), tear = Hooks.on("canvasTearDown", close);
  offs.push(() => document.removeEventListener("pointerdown", outside, true), () => window.removeEventListener("keydown", key, true),
    () => Hooks.off("canvasPan", pan), () => Hooks.off("canvasTearDown", tear));
  return true;
}

function place(client) {
  const r = el.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
  el.style.left = `${Math.max(6, Math.min(client.x + 4, W - r.width - 6))}px`;
  el.style.top = `${Math.max(6, Math.min(client.y + 4, H - r.height - 6))}px`;
}

/** The menu's content as HTML (what open() shows): of the border near a scene point, or of a zone's page. For tests and tools. */
export function html(which, { at = null, zone = -1, tab = "features", tol = undefined } = {}) {
  if ( which === "border" ) return borderHtml(at ? Zones.borderAt(at.x, at.y, tol) : null, zone >= 0);
  page = tab;
  return zoneHtml(zone, false);
}

const num = (id) => Zones.zoneName(id);
const opt = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
const stepper = (act, value, label, off = false) => `<span class="mm-z-step"><button type="button" data-act="${act}-" data-focus="${act}-" aria-label="${esc(label)} −"${off ? " disabled" : ""}>−</button><b>${esc(value)}</b><button type="button" data-act="${act}+" data-focus="${act}+" aria-label="${esc(label)} +"${off ? " disabled" : ""}>+</button></span>`;
/** The line that says whose the play state is, for a GM who is not the active one ("" for the active GM). */
const notMine = () => (Zones.canWrite() ? "" : `<p class="mm-z-menu-lock"><i class="fa-solid fa-user-lock" inert></i> ${esc(Z("activeOnly", { gm: Zones.activeGmName() || "?" }))}</p>`);

const sceneActs = () => {
  const zs = Zones.marks()?.zones ?? new Map(), by = Zones.drivenBy();
  const fire = [...zs.values()].some((p) => p.fire) && Zones.fireRoundOn(), states = [...zs.values()].some((p) => p.wrecked || p.fire || p.dark || p.ice || p.flooded || p.lowgrav) || Zones.zoneStates().length > 0;
  return `${fire ? `<button type="button" data-act="fireRound"><i class="fa-solid ${by ? "fa-fire" : "fa-dice-six"}" inert></i> ${esc(by ? Z("act.fireRoundBy", { by: by.title }) : Z("act.fireRound"))}</button>` : ""}
    ${states ? `<button type="button" data-act="endScene"><i class="fa-solid fa-broom" inert></i> ${esc(Z("act.endScene"))}</button>` : ""}
    ${Zones.bordersChanged() ? `<button type="button" data-act="restoreBorders"><i class="fa-solid fa-trowel-bricks" inert></i> ${esc(Z("act.restoreBorders"))}</button>` : ""}`;
};

/* ---------------------------------------------------------------- a border */

function borderHtml(b, hasZone) {
  if ( !b ) return "";
  const w = b.wall, d = b.door, off = Zones.canWrite() ? "" : " disabled";
  // the six quick kinds: the one this border is built as is marked while nothing about it was changed by hand
  const plain = (k) => {
    if ( b.kind !== k ) return false;
    const B = built(k);
    return !B || (w.armor === B.wall.armor && w.outer === B.wall.outer && !!d === !!B.door && (!d || (d.armor === B.door.armor && d.built === B.door.state)));
  };
  const items = BORDER_KINDS.map((k) => `<button type="button" data-act="kind" data-kind="${k}" class="${plain(k) ? "on" : ""}">
      <span class="mm-z-sw mm-z-sw-${k}" inert></span>${esc(Z(`border.${k}`))}${ARMOR[k] ? `<em>${esc(Z("armor", { n: ARMOR[k] + (k === "reinforced" ? "+" : "") }))}</em>` : ""}</button>`).join("");
  const changed = !!w && (w.state !== "intact" || (d && d.state !== d.built));
  const parts = !w ? "" : `<div class="mm-z-menu-grp">${esc(Z("bord.wall"))}</div>
    <div class="mm-z-menu-row"><span>${esc(Z("bord.armor"))}</span>${stepper("wallArmor", w.armor, Z("bord.armor"))}</div>
    <label class="mm-z-menu-check"><input type="checkbox" name="wallOuter" data-focus="wallOuter"${w.outer ? " checked" : ""}> ${esc(Z("bord.outer"))}</label>
    <div class="mm-z-menu-grp">${esc(Z("bord.door"))}</div>
    <label class="mm-z-menu-check"><input type="checkbox" name="hasDoor" data-focus="hasDoor"${d ? " checked" : ""}> ${esc(Z("bord.hasDoor"))}</label>
    ${d ? `<div class="mm-z-menu-row"><span>${esc(Z("bord.armor"))}</span>${stepper("doorArmor", d.armor, Z("bord.armor"))}</div>
      <label class="mm-z-menu-row">${esc(Z("bord.doorBuilt"))} <select name="doorBuilt" data-focus="doorBuilt">${DOOR_BUILT.map((s) => opt(s, Z(`doorSt.${s}`), d.built)).join("")}</select></label>` : ""}`;
  const now = !w ? "" : `<div class="mm-z-menu-grp mm-z-menu-play">${esc(Z("bord.now"))}</div>
    ${notMine()}
    <label class="mm-z-menu-row">${esc(Z("bord.wall"))} <select name="wallNow" data-focus="wallNow"${off}>${WALL_STATES.map((s) => opt(s, Z(`wallSt.${s}`), w.state)).join("")}</select></label>
    ${w.state === "removed" ? `<label class="mm-z-menu-check"><input type="checkbox" name="wallTemp" data-focus="wallTemp"${w.temp ? " checked" : ""}${off}> ${esc(Z("bord.temp"))}</label>` : ""}
    ${d ? `<label class="mm-z-menu-row">${esc(Z("bord.door"))} <select name="doorNow" data-focus="doorNow"${off}>${DOOR_STATES.map((s) => opt(s, Z(`doorSt.${s}`), d.state)).join("")}</select></label>` : ""}`;
  return `<header>${esc(Z("border.title", { a: num(b.b), b: num(b.a) }))}</header>
    <div class="mm-z-menu-grp">${esc(Z("bord.built"))}</div>
    <div class="mm-z-menu-list">${items}</div>
    ${parts}${now}
    <p class="mm-z-menu-hint">${esc(Z("border.hint"))}</p>
    <footer>
      ${changed ? `<button type="button" data-act="restoreBorder"${off}><i class="fa-solid fa-trowel-bricks" inert></i> ${esc(Z("act.restoreBorder"))}</button>` : ""}
      ${hasZone ? `<button type="button" data-act="toZone"><i class="fa-solid fa-draw-polygon" inert></i> ${esc(Z("act.toZone"))}</button>` : ""}
    </footer>`;
}

/* ---------------------------------------------------------------- a zone */

const TAG_ICON = { power: "fa-bolt", metal: "fa-magnet", plants: "fa-seedling", throwables: "fa-cubes", flammable: "fa-gas-pump", vacuum: "fa-user-astronaut", bystanders: "fa-people-group" };
export const KIND_ICON = { wrecked: "fa-house-chimney-crack", fire: "fa-fire", dark: "fa-moon", smoke: "fa-smog", gravity: "fa-feather", weather: "fa-cloud-bolt", flooded: "fa-water", toxic: "fa-biohazard", ice: "fa-snowflake" };
export const kindName = (k) => (STATE_KINDS.includes(k) ? Z(`reg.kind.${k}`) : k);
/** Who made a state or when it ends, as far as it can be shown: text as it is, an object by its name or label, anything else as "set". */
export function brief(v) {
  if ( v == null ) return "";
  if ( typeof v === "string" || typeof v === "number" ) return String(v).slice(0, 40);
  const s = typeof v === "object" ? v.name ?? v.label ?? v.title ?? v.id : null;
  return typeof s === "string" ? s.slice(0, 40) : Z("reg.set");
}
export const atName = (at) => (!at ? Z("reg.at.any") : /^f\d+$/.test(at) ? Z("floorN", { n: at.slice(1) }) : Z(`reg.at.${at}`));

function zoneHtml(id, hasBorder) {
  const tabs = ["features", "states", "passages"];
  if ( !tabs.includes(page) ) page = "features";
  const key = api().keyOf(id), nStates = Zones.zoneStates().filter((s) => s.zone === key).length, nEdges = Zones.edgeList().filter((e) => endsAt(e, key)).length;
  const count = { states: nStates, passages: nEdges };
  const nav = `<nav class="mm-z-tabs" role="tablist">${tabs.map((t) => `<button type="button" role="tab" data-act="tab" data-tab="${t}" data-focus="tab-${t}" aria-selected="${t === page}">${esc(Z(`tab.${t}`))}${count[t] ? `<em>${count[t]}</em>` : ""}</button>`).join("")}</nav>`;
  const body = page === "states" ? statesHtml(id, key) : page === "passages" ? passagesHtml(id, key) : featuresHtml(id);
  return `<header>${esc(Z("zone.title", { n: num(id) }))}</header>${nav}${body}
    <footer>
      ${page === "states" ? clearBtn(id) : ""}
      ${hasBorder ? `<button type="button" data-act="toBorder"><i class="fa-solid fa-grip-lines-vertical" inert></i> ${esc(Z("act.toBorder"))}</button>` : ""}
      ${sceneActs()}
    </footer>`;
}

// the checkboxes are the GM's own marks; what the map's layers say shows as a tag (it comes and goes with the painting)
const marksOf = (id) => ({ own: Zones.ownMarks()?.zones.get(id) ?? {}, map: Zones.mapStates()?.get(id) ?? {}, p: Zones.marks()?.zones.get(id) ?? {} });
const mapTag = (map, k) => (map[k] ? ` <em class="mm-z-map" data-tooltip="${esc(Z("fromMapHint"))}">${esc(Z("fromMap"))}</em>` : "");
const check = (own, map, k, label) => `<label class="mm-z-menu-check"><input type="checkbox" name="${k}" data-focus="${k}"${own[k] ? " checked" : ""}> ${esc(label)}${mapTag(map, k)}</label>`;

function featuresHtml(id) {
  const { own, map, p } = marksOf(id), by = Zones.drivenBy();
  const terr = TERRAINS.map((t) => { const n = Zones.wreckText(t); return `<option value="${t}"${(p.terrain ?? "") === t ? " selected" : ""}>${esc(Z(`terrain.${t || "unset"}`))}${n && t !== "none" ? ` (${esc(n)})` : ""}</option>`; }).join("");
  const tags = own.tags ?? [];
  return `<div class="mm-z-menu-grp">${esc(Z("grp.features"))}</div>
    ${FEATURES.map((k) => check(own, map, k, Z(`feat.${k}`))).join("")}
    ${own.building ? `<div class="mm-z-menu-row mm-z-floors-row" data-tooltip="${esc(Z("floorsHint"))}"><span><i class="fa-solid fa-stairs" inert></i> ${esc(Z("floors"))}</span>
      ${stepper("floors", own.floors ?? 0, Z("floors"))}</div>` : ""}
    <div class="mm-z-menu-grp">${esc(Z("grp.rules"))}</div>
    <label class="mm-z-menu-row">${esc(Z("terrain.label"))} <select name="terrain" data-focus="terrain">${terr}</select></label>
    ${by ? `<p class="mm-z-menu-hint">${esc(Z("driven.note", { by: by.title }))}</p>` : ""}
    <label class="mm-z-menu-check" data-tooltip="${esc(Z("attr.emptyHint"))}"><input type="checkbox" name="empty" data-focus="empty"${own.empty ? " checked" : ""}> ${esc(Z("attr.empty"))}</label>
    <div class="mm-z-menu-grp">${esc(Z("grp.tags"))}</div>
    <div class="mm-z-chips">${TAGS.map((t) => `<button type="button" class="mm-z-chip" data-act="tag" data-tag="${t}" data-focus="tag-${t}" aria-pressed="${tags.includes(t)}"><i class="fa-solid ${TAG_ICON[t]}" inert></i>${esc(Z(`tag.${t}`))}</button>`).join("")}</div>`;
}

const clearBtn = (id) => {
  const { own, p } = marksOf(id), key = api().keyOf(id);
  const any = own.wrecked || p.fire || own.dark || own.ice || own.flooded || own.lowgrav || Zones.zoneStates().some((s) => s.zone === key);
  return `<button type="button" data-act="clearZone"${any ? "" : " disabled"}><i class="fa-solid fa-eraser" inert></i> ${esc(Z("act.clearZone"))}</button>`;
};

function statesHtml(id, key) {
  const { own, map, p } = marksOf(id), off = Zones.canWrite() ? "" : " disabled";
  const floors = Zones.marks() ? (p.building && !p.wrecked ? p.floors ?? 0 : 0) : 0;
  const ats = ["", "ground", "elevated", "underground", ...Array.from({ length: floors }, (_, i) => `f${i + 1}`)];
  const recs = Zones.zoneStates().filter((s) => s.zone === key);
  const rows = recs.map((r) => {
    const meta = [r.owner != null ? Z("reg.owner", { who: brief(r.owner) }) : "", r.ends != null ? Z("reg.ends", { when: brief(r.ends) }) : "", r.except?.length ? Z("reg.except", { n: r.except.length }) : ""].filter(Boolean).join(" · ");
    const at = ats.includes(r.at ?? "") ? ats : [...ats, r.at];
    // only a fire is told by a number of its own (its Intensity); every other state (smoke, darkness, gravity by its mode...) shows
    // a level stepper only when somebody gave it a level (a power's level value) - no empty stepper (C15 / Z38)
    const stepped = r.kind === "fire" || r.level != null;
    return `<div class="mm-z-rec" data-rec="${esc(r.id)}">
      <span class="mm-z-rec-name"><i class="fa-solid ${KIND_ICON[r.kind] ?? "fa-circle-dot"}" inert></i> ${esc(kindName(r.kind))}</span>
      ${!stepped ? "" : `<span class="mm-z-step" data-tooltip="${esc(Z(r.kind === "fire" ? "reg.intensity" : "reg.level"))}"><button type="button" data-act="recLevel-" data-focus="l-${esc(r.id)}" aria-label="${esc(Z("reg.level"))} −"${off || (r.level == null ? " disabled" : "")}>−</button><b>${r.level ?? "·"}</b><button type="button" data-act="recLevel+" data-focus="L-${esc(r.id)}" aria-label="${esc(Z("reg.level"))} +"${off}>+</button></span>`}
      <button type="button" class="mm-z-x" data-act="recDel" aria-label="${esc(Z("reg.remove"))}" data-tooltip="${esc(Z("reg.remove"))}"${off}><i class="fa-solid fa-xmark" inert></i></button>
      <span class="mm-z-rec-more">
        <select name="recAt" data-focus="at-${esc(r.id)}" aria-label="${esc(Z("reg.atLabel"))}"${off}>${at.map((a) => opt(a, atName(a), r.at ?? "")).join("")}</select>
        ${r.kind === "gravity" ? `<select name="recMode" data-focus="mode-${esc(r.id)}" aria-label="${esc(Z("reg.kind.gravity"))}"${off}>${["", "low", "high"].map((m) => opt(m, Z(`reg.mode.${m || "unset"}`), r.data?.mode ?? "")).join("")}</select>` : ""}
        ${meta ? `<small>${esc(meta)}</small>` : ""}
      </span></div>`;
  }).join("");
  return `<div class="mm-z-menu-grp">${esc(Z("grp.states"))}</div>
    ${check(own, map, "wrecked", Z("state.wrecked"))}
    <div class="mm-z-menu-row mm-z-fire-row"><span><i class="fa-solid fa-fire" inert></i> ${esc(Z("state.fire"))}${mapTag(map, "fire")}</span>
      ${stepper("fire", p.fire ?? 0, Z("state.fire"))}</div>
    ${["dark", "ice", "flooded", "lowgrav"].map((k) => check(own, map, k, Z(`state.${k}`))).join("")}
    <div class="mm-z-menu-grp mm-z-menu-play" data-tooltip="${esc(Z("reg.hint"))}">${esc(Z("grp.registry"))}</div>
    ${notMine()}
    ${rows || `<p class="mm-z-menu-hint">${esc(Z("reg.none"))}</p>`}
    <div class="mm-z-add"><select name="recKind" data-focus="recKind" aria-label="${esc(Z("reg.kindLabel"))}"${off}>${STATE_KINDS.map((k) => opt(k, Z(`reg.kind.${k}`), "smoke")).join("")}${opt("other", Z("reg.kind.other"), "smoke")}</select>
      <button type="button" data-act="recAdd" data-focus="recAdd"${off}><i class="fa-solid fa-plus" inert></i> ${esc(Z("reg.add"))}</button></div>
    <label class="mm-z-menu-row mm-z-recname" hidden>${esc(Z("reg.name"))} <input type="text" name="recName" maxlength="32" spellcheck="false" placeholder="${esc(Z("reg.namePh"))}"></label>`;
}

const endsAt = (e, key) => e.a.split(":")[0] === key || e.b.split(":")[0] === key;
/** A passage's far end in words: "zone 5", "zone 5, elevated", or the off-map area. */
export function spotName(spot) {
  const [k, lvl] = spot.split(":");
  if ( k[0] === "@" ) return Z(`area.${k.slice(1)}`);
  const id = api().idOf(k);
  const where = id >= 0 ? Z("zone.title", { n: num(id) }) : Z("edge.gone");
  return lvl ? `${where}, ${atName(lvl)}` : where;
}
export const edgeKindName = (k) => (EDGE_KINDS.includes(k) ? Z(`edge.kind.${k}`) : k);

function passagesHtml(id, key) {
  const off = Zones.canWrite() ? "" : " disabled";
  const rows = Zones.edgeList().filter((e) => endsAt(e, key)).map((e) => {
    const far = e.a.split(":")[0] === key ? e.b : e.a;
    return `<div class="mm-z-rec" data-edge="${esc(e.id)}">
      <span class="mm-z-rec-name"><i class="fa-solid ${e.kind === "tunnel" ? "fa-dungeon" : "fa-circle-nodes"}" inert></i> ${esc(edgeKindName(e.kind))} <i class="fa-solid fa-arrows-left-right mm-z-rec-to" inert></i> ${esc(spotName(far))}</span>
      <button type="button" class="mm-z-x" data-act="edgeDel" aria-label="${esc(Z("reg.remove"))}" data-tooltip="${esc(Z("reg.remove"))}"${off}><i class="fa-solid fa-xmark" inert></i></button>
      ${!e.live || e.owner != null || e.ends != null ? `<span class="mm-z-rec-more"><small>${esc([!e.live ? Z("edge.asleep") : "", e.owner != null ? Z("reg.owner", { who: brief(e.owner) }) : "", e.ends != null ? Z("reg.ends", { when: brief(e.ends) }) : ""].filter(Boolean).join(" · "))}</small></span>` : ""}</div>`;
  }).join("");
  return `<div class="mm-z-menu-grp mm-z-menu-play">${esc(Z("grp.passages"))}</div>
    ${notMine()}
    ${rows || `<p class="mm-z-menu-hint">${esc(Z("edge.none"))}</p>`}
    <div class="mm-z-add"><select name="edgeKind" data-focus="edgeKind" aria-label="${esc(Z("edge.kindLabel"))}"${off}>${EDGE_KINDS.map((k) => opt(k, Z(`edge.kind.${k}`), "portal")).join("")}</select>
      <button type="button" data-act="edgePick" data-focus="edgePick"${off}><i class="fa-solid fa-location-crosshairs" inert></i> ${esc(Z("edge.pick"))}</button></div>
    <p class="mm-z-menu-hint">${esc(Z("edge.hint"))}</p>`;
}
