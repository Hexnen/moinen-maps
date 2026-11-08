import * as Zones from "./zones.mjs";
import { BORDER_KINDS, ARMOR, FEATURES, TERRAINS, WRECK, FIRE_MAX } from "./marks.mjs";

/**
 * The right-click menu of the Zones section (GM): near a border it marks the border (open, door, locked door, wall, exterior wall,
 * reinforced wall, with the Armor a breach needs); inside a zone it sets the zone's features (building, tall features, water, what
 * wrecking it takes) and states (wrecked, fire with its Intensity, darkness, ice, flooded, low gravity). A plain HTML popover at the
 * cursor; it closes on Escape, a click elsewhere, a pan or zoom.
 */

let el = null, offs = [];
const Z = (k, d) => (d ? game.i18n.format(`MOINENMAPS.Zones.${k}`, d) : game.i18n.localize(`MOINENMAPS.Zones.${k}`));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function close() {
  for ( const f of offs ) f();
  offs = [];
  el?.remove(); el = null;
}

/** Open at a screen point for a scene point: the border menu when a border is within ~12 screen px, else the zone menu. */
export function open(client, at) {
  close();
  const zoom = canvas.stage.scale.x, tol = Math.max(12 / zoom, Zones.gridSize() * 0.08);
  const border = Zones.borderAt(at.x, at.y, tol);
  const zone = Zones.zones() ? Zones.zonesApi.zoneAt(at.x, at.y) : -1;
  if ( !border && zone < 0 ) return false;
  el = document.createElement("div");
  el.className = "mm-z-menu";
  document.body.append(el);
  const draw = (which) => { el.innerHTML = which === "border" ? borderHtml(Zones.borderAt(at.x, at.y, tol), zone >= 0) : zoneHtml(zone, !!border); place(client); };
  draw(border ? "border" : "zone");

  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-act]"); if ( !b ) return;
    const a = b.dataset.act;
    if ( a === "kind" ) { Zones.setBorder(at.x, at.y, b.dataset.kind); close(); }
    else if ( a === "toZone" ) draw("zone");
    else if ( a === "toBorder" ) draw("border");
    else if ( a === "fire+" || a === "fire-" ) {
      // a new fire starts at Intensity 6 (the book: 6-9 for most fires), then one step at a time
      const cur = Zones.marks()?.zones.get(zone)?.fire ?? 0;
      const f = a === "fire+" ? (cur ? Math.min(FIRE_MAX, cur + 1) : 6) : Math.max(0, cur - 1);
      Zones.setZone(zone, { fire: f }, at);
      draw("zone");
    }
    else if ( a === "clearZone" ) { Zones.clearStates(zone); draw("zone"); }
    else if ( a === "fireRound" ) { Zones.fireRound(); close(); }
    else if ( a === "endScene" ) { Zones.clearStates(); close(); }
  });
  el.addEventListener("change", (ev) => {
    const c = ev.target, name = c.getAttribute("name");
    if ( !name ) return;
    Zones.setZone(zone, { [name]: c.type === "checkbox" ? c.checked : c.value }, at);
    draw("zone");
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

const num = (id) => Zones.zoneName(id);
const sceneActs = () => {
  const zs = Zones.marks()?.zones ?? new Map();
  const fire = [...zs.values()].some((p) => p.fire), states = [...zs.values()].some((p) => p.wrecked || p.fire || p.dark || p.ice || p.flooded || p.lowgrav);
  return `${fire ? `<button type="button" data-act="fireRound"><i class="fa-solid fa-dice-six" inert></i> ${esc(Z("act.fireRound"))}</button>` : ""}
    ${states ? `<button type="button" data-act="endScene"><i class="fa-solid fa-broom" inert></i> ${esc(Z("act.endScene"))}</button>` : ""}`;
};

function borderHtml(b, hasZone) {
  if ( !b ) return "";
  const items = BORDER_KINDS.map((k) => `<button type="button" data-act="kind" data-kind="${k}" class="${b.kind === k ? "on" : ""}">
      <span class="mm-z-sw mm-z-sw-${k}" inert></span>${esc(Z(`border.${k}`))}${ARMOR[k] ? `<em>${esc(Z("armor", { n: ARMOR[k] + (k === "reinforced" ? "+" : "") }))}</em>` : ""}</button>`).join("");
  return `<header>${esc(Z("border.title", { a: num(b.b), b: num(b.a) }))}</header>
    <div class="mm-z-menu-list">${items}</div>
    <p class="mm-z-menu-hint">${esc(Z("border.hint"))}</p>
    ${hasZone ? `<footer><button type="button" data-act="toZone"><i class="fa-solid fa-draw-polygon" inert></i> ${esc(Z("act.toZone"))}</button></footer>` : ""}`;
}

function zoneHtml(id, hasBorder) {
  // the checkboxes are the GM's own marks; what the map's layers say shows as a tag (it comes and goes with the painting)
  const own = Zones.ownMarks()?.zones.get(id) ?? {}, map = Zones.mapStates()?.get(id) ?? {}, p = Zones.marks()?.zones.get(id) ?? {};
  const tag = (k) => (map[k] ? ` <em class="mm-z-map" data-tooltip="${esc(Z("fromMapHint"))}">${esc(Z("fromMap"))}</em>` : "");
  const check = (k, label) => `<label class="mm-z-menu-check"><input type="checkbox" name="${k}"${own[k] ? " checked" : ""}> ${esc(label)}${tag(k)}</label>`;
  const terr = TERRAINS.map((t) => `<option value="${t}"${(p.terrain ?? "") === t ? " selected" : ""}>${esc(Z(`terrain.${t || "unset"}`))}${WRECK[t] ? ` (${WRECK[t][0]}/+${WRECK[t][1]})` : ""}</option>`).join("");
  return `<header>${esc(Z("zone.title", { n: num(id) }))}</header>
    <div class="mm-z-menu-grp">${esc(Z("grp.features"))}</div>
    ${FEATURES.map((k) => check(k, Z(`feat.${k}`))).join("")}
    <label class="mm-z-menu-row">${esc(Z("terrain.label"))} <select name="terrain">${terr}</select></label>
    <div class="mm-z-menu-grp">${esc(Z("grp.states"))}</div>
    ${check("wrecked", Z("state.wrecked"))}
    <div class="mm-z-menu-row mm-z-fire-row"><span><i class="fa-solid fa-fire" inert></i> ${esc(Z("state.fire"))}${tag("fire")}</span>
      <span class="mm-z-step"><button type="button" data-act="fire-" aria-label="−">−</button><b>${p.fire ?? 0}</b><button type="button" data-act="fire+" aria-label="+">+</button></span></div>
    ${["dark", "ice", "flooded", "lowgrav"].map((k) => check(k, Z(`state.${k}`))).join("")}
    <footer>
      <button type="button" data-act="clearZone"${own.wrecked || p.fire || own.dark || own.ice || own.flooded || own.lowgrav ? "" : " disabled"}><i class="fa-solid fa-eraser" inert></i> ${esc(Z("act.clearZone"))}</button>
      ${hasBorder ? `<button type="button" data-act="toBorder"><i class="fa-solid fa-grip-lines-vertical" inert></i> ${esc(Z("act.toBorder"))}</button>` : ""}
      ${sceneActs()}
    </footer>`;
}
