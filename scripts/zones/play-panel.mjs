import { esc } from "../workspace/ui.mjs";
import * as Zones from "./zones.mjs";
import { playOf } from "./borders.mjs";
import { told, KIND_ICON, kindName, brief, atName, spotName, edgeKindName } from "./menu.mjs";

/**
 * The "In play" panel of the Zones dock (GM): everything that happened on this map during play and stays until somebody takes it
 * back, in one place - the walls and doors that are not as they were built, the tracked states of the registry, the passages
 * (portals, tunnels). Each row shows where it is (pointing at a row outlines its zone or border on the map) and can be taken
 * back; the details are edited in the right-click menus of the zone or the border. A GM who is not the active one reads the list
 * and is told whose the changes are.
 */

const Z = (k, d) => (d ? game.i18n.format(`MOINENMAPS.Zones.${k}`, d) : game.i18n.localize(`MOINENMAPS.Zones.${k}`));
const HOVER = "mm-ui.play";

export function playPanel(host) {
  const api = Zones.zonesApi;
  const render = () => {
    if ( !Zones.state() || !Zones.zones() ) { host.innerHTML = `<p class="mm-ws-hint">${esc(Z("play.noZones"))}</p>`; return; }
    const off = Zones.canWrite() ? "" : " disabled", by = Zones.drivenBy();
    const x = (act, label) => `<button type="button" class="mm-z-x" data-act="${act}" aria-label="${esc(label)}" data-tooltip="${esc(label)}"${off}><i class="fa-solid ${act === "restore" ? "fa-trowel-bricks" : "fa-xmark"}" inert></i></button>`;
    const borders = [...(Zones.ownMarks()?.borders.values() ?? [])].filter((m) => playOf(m)).map((m) => {
      const what = [m.wall.state !== "intact" ? Z(`border.wallState.${m.wall.state}`) + (m.wall.temp ? ` (${Z("bord.temp")})` : "") : "", m.door && m.door.state !== m.door.built ? Z(`border.doorState.${m.door.state}`) : ""].filter(Boolean).join(", ");
      return `<li data-border="${esc(`${api.keyOf(m.a)}|${api.keyOf(m.b)}`)}"><i class="fa-solid fa-grip-lines-vertical" inert></i><span><b>${esc(`${Zones.zoneName(m.b)} | ${Zones.zoneName(m.a)}`)}</b><small>${esc(what)}</small></span>${x("restore", Z("act.restoreBorder"))}</li>`;
    });
    const states = Zones.zoneStates().map((s) => {
      const id = s.zone ? api.idOf(s.zone) : -1;
      const meta = [id >= 0 ? Z("zone.title", { n: Zones.zoneName(id) }) : Z("edge.gone"), s.at ? atName(s.at) : "", s.owner != null ? Z("reg.owner", { who: brief(s.owner) }) : "", s.ends != null ? Z("reg.ends", { when: brief(s.ends) }) : ""].filter(Boolean).join(" · ");
      return `<li data-state="${esc(s.id)}"${s.zone ? ` data-zone="${esc(s.zone)}"` : ""}><i class="fa-solid ${KIND_ICON[s.kind] ?? "fa-circle-dot"}" inert></i><span><b>${esc(kindName(s.kind))}${s.level != null ? ` ${esc(s.level)}` : ""}${s.kind === "gravity" && s.data?.mode ? ` (${esc(Z(`reg.mode.${s.data.mode === "high" ? "high" : "low"}`))})` : ""}</b><small>${esc(meta)}</small></span>${x("recDel", Z("reg.remove"))}</li>`;
    });
    const edges = Zones.edgeList().map((e) => `<li data-edge="${esc(e.id)}" data-zones="${esc([e.a, e.b].map((s) => s.split(":")[0]).filter((k) => k[0] !== "@").join(","))}"><i class="fa-solid ${e.kind === "tunnel" ? "fa-dungeon" : "fa-circle-nodes"}" inert></i><span><b>${esc(edgeKindName(e.kind))}</b><small>${esc(`${spotName(e.a)} ↔ ${spotName(e.b)}${e.live ? "" : ` · ${Z("edge.asleep")}`}`)}</small></span>${x("edgeDel", Z("reg.remove"))}</li>`);
    const sec = (title, rows, none, foot = "") => `<section class="mm-wp-sec mm-z-panel mm-z-play"><h4>${esc(title)}${rows.length ? ` <em>${rows.length}</em>` : ""}</h4>
      ${rows.length ? `<ul class="mm-z-plist">${rows.join("")}</ul>${foot}` : `<p class="mm-ws-hint">${esc(none)}</p>`}</section>`;
    host.innerHTML = `${Zones.canWrite() ? "" : `<p class="mm-z-lock"><i class="fa-solid fa-user-lock" inert></i> ${esc(Z("activeOnly", { gm: Zones.activeGmName() || "?" }))}</p>`}
      ${by ? `<p class="mm-z-lock mm-z-driven"><i class="fa-solid fa-gears" inert></i> ${esc(Z("driven.by", { by: by.title }))}</p>` : ""}
      ${sec(Z("play.borders"), borders, Z("play.noBorders"), borders.length > 1 ? `<button type="button" class="mm-ws-btn" data-act="restoreAll"${off}><i class="fa-solid fa-trowel-bricks" inert></i> ${esc(Z("act.restoreBorders"))}</button>` : "")}
      ${sec(Z("grp.registry"), states, Z("play.noStates"))}
      ${sec(Z("grp.passages"), edges, Z("play.noEdges"))}
      <p class="mm-ws-hint">${esc(Z("play.hint"))}</p>`;
  };
  render();
  const again = (p) => Promise.resolve(p).then((r) => { told(r); render(); });
  const onClick = (ev) => {
    const b = ev.target.closest("[data-act]"); if ( !b || b.disabled ) return;
    const li = b.closest("li"), a = b.dataset.act;
    api.clearHighlights(HOVER);
    if ( a === "restore" ) again(Zones.restoreBorders(li.dataset.border));
    else if ( a === "restoreAll" ) again(Zones.restoreBorders());
    else if ( a === "recDel" ) again(Zones.removeZoneState(li.dataset.state));
    else if ( a === "edgeDel" ) again(Zones.removeEdge(li.dataset.edge));
  };
  // pointing at a row shows where it is on the map (this client only)
  let shown = null;
  const point = (li) => {
    if ( li === shown ) return;
    shown = li;
    if ( !li ) { api.clearHighlights(HOVER); return; }
    const zones = li.dataset.zone ? [li.dataset.zone] : li.dataset.zones ? li.dataset.zones.split(",").filter(Boolean) : [];
    const borders = li.dataset.border ? [li.dataset.border] : [];
    if ( zones.length || borders.length ) api.highlight({ id: HOVER, zones, borders, color: "info", style: "outline", order: 1000 }); else api.clearHighlights(HOVER);
  };
  const onOver = (ev) => point(ev.target.closest?.(".mm-z-plist li") ?? null);
  const onLeave = () => point(null);
  host.addEventListener("click", onClick);
  host.addEventListener("pointerover", onOver);
  host.addEventListener("pointerleave", onLeave);
  host.addEventListener("focusin", onOver);
  host.addEventListener("focusout", onLeave);
  const hook = Hooks.on("moinenMapsZones", (kind) => { if ( kind !== "section" ) { shown = null; render(); } });
  // (who the active GM is changes when a GM connects or leaves)
  const users = Hooks.on("userConnected", () => render());
  return () => {
    host.removeEventListener("click", onClick); host.removeEventListener("pointerover", onOver); host.removeEventListener("pointerleave", onLeave);
    host.removeEventListener("focusin", onOver); host.removeEventListener("focusout", onLeave);
    Hooks.off("moinenMapsZones", hook); Hooks.off("userConnected", users);
    api.clearHighlights(HOVER);
  };
}
