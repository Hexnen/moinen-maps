/* MAPSWITCH (owner, 2026-11-16: «przełącznik napisów on off w zniszczeniach, pogodzie i żetonach (zakładki moinen maps) i suwaki
   wielkości»): the comic lettering's switch and size slider of each area, in that area's own tab of the Moinen Maps workspace - a dock
   panel "Comic lettering" added to the Destruction, Weather and Tokens sections (extendSection: their files are unchanged):
     Destruction   destruction lettering (damage, blasts, guns, debris) and, because fire is painted in this tab, fire lettering
     Weather       weather lettering (the storm's thunder)
     Tokens        token lettering (a carried token ploughing through others; with invincible-plus-ultra also its token reactions' words)
   The values are the TABLE's (world settings, sfx-size ON_SETTING / SIZE_SETTING): the workspace is the GM's, a change is written at
   once like every other control of these tabs, and every seat letters by it from its next word (a group switched off: the words up
   leave). The same values stand in the table window ("Comic sound effects on the map"), which a player can read. */
import { extendSection, sectionById } from "../workspace/registry.mjs";
import { esc, T, optCheck, optRange, isEcho, writeControl, onWorldSetting } from "../workspace/ui.mjs";
import { SIZE_GROUPS, SIZE_SETTING, ON_SETTING, GROUP_TAB } from "./sfx-size.mjs";
import { groupShown, setGroup, reactLinked, mode } from "./sfx.mjs";
import { open as openTable } from "./sfx-table-ui.mjs";

/** the panel's place in each tab's dock: after this panel (the thing it letters), or last */
const AFTER = { destruction: null, weather: "lightning", tokens: "combat" };
const groupsOf = (tab) => SIZE_GROUPS.filter((g) => GROUP_TAB[g] === tab);

function html(tab) {
  const rows = groupsOf(tab).map((g) => {
    const p = groupShown(g), linked = g === "tokens" && reactLinked();
    return `<div class="mm-sfx-tab-group${p.on ? "" : " is-off"}" data-group="${g}">
      ${optCheck({ name: `on.${g}`, label: T(`Sfx.on.${g}`), checked: p.on, hint: T(`Sfx.on.${g}Hint`) + (linked ? ` ${T("Sfx.tab.linkedHint")}` : "") })}
      ${optRange({ name: `size.${g}`, label: T("Sfx.tab.size"), value: p.size, min: 1, max: 3, step: 1, hint: T("Sfx.tab.sizeHint") })}
      ${linked ? `<p class="mm-ws-hint">${esc(T("Sfx.tab.linked"))}</p>` : ""}
    </div>`;
  }).join("");
  // (the table's "which sounds" set to Off silences every group: say so here, with the way to that choice)
  const off = `<p class="mm-ws-hint mm-sfx-tab-off" role="status"${mode() === "off" ? "" : " hidden"}><i class="fa-solid fa-triangle-exclamation" inert></i> <span>${esc(T("Sfx.tab.allOff"))}</span>
    <button type="button" class="mm-ws-btn" data-act="sfx-table"><i class="fa-solid fa-burst" inert></i> ${esc(T("Sfx.table.open"))}</button></p>`;
  return `<div class="mm-ws-form mm-sfx-tab">${rows}${off}</div>`;
}

/** what the world holds, written into the controls (never looking like an edit: ui.mjs writeControl) */
function sync(host) {
  for ( const el of host.querySelectorAll(".mm-sfx-tab-group") ) {
    const g = el.dataset.group, p = groupShown(g);
    el.classList.toggle("is-off", !p.on);
    const c = el.querySelector(`[name="on.${g}"]`), r = el.querySelector(`[name="size.${g}"]`);
    if ( c ) writeControl(c, p.on);
    if ( r ) { if ( !r.contains(document.activeElement) ) writeControl(r, p.size); r.disabled = !p.on; }
  }
  const off = host.querySelector(".mm-sfx-tab-off"); if ( off ) off.hidden = mode() !== "off";
}

function mount(host, tab) {
  host.innerHTML = html(tab);
  sync(host);
  const onChange = (ev) => {
    if ( isEcho() ) return;
    const c = ev.target.closest?.("[name]"); if ( !c || !host.contains(c) ) return;
    const [what, g] = String(c.name).split(".");
    if ( !SIZE_GROUPS.includes(g) ) return;
    if ( what === "on" ) setGroup(g, { on: c.checked });
    else if ( what === "size" ) setGroup(g, { size: Number(c.value) });
  };
  const onClick = (ev) => { if ( ev.target.closest?.('[data-act="sfx-table"]') ) openTable(); };
  host.addEventListener("change", onChange);
  host.addEventListener("click", onClick);
  const off = onWorldSetting([...SIZE_GROUPS.flatMap((g) => [SIZE_SETTING[g], ON_SETTING[g]]), "sfxLetters"], () => sync(host));
  return () => { host.removeEventListener("change", onChange); host.removeEventListener("click", onClick); off(); };
}

for ( const tab of ["destruction", "weather", "tokens"] ) {
  const s = sectionById(tab); if ( !s ) continue;                       // (a section left out - localStorage "mm-destruction" = "off")
  extendSection(tab, { panels: [{ id: "lettering", title: "MOINENMAPS.Sfx.tab.title", icon: "fa-solid fa-burst", open: true, mount: (host) => mount(host, tab) }] });
  // (beside the panel of what it letters, not under a long list: the thunder's under Lightning, the tokens' over the token list)
  const at = AFTER[tab] ? s.panels.findIndex((p) => p.id === AFTER[tab]) : -1;
  if ( at >= 0 ) { const mine = s.panels.pop(); s.panels.splice(at + 1, 0, mine); }
}
