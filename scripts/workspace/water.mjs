import { registerSection } from "./registry.mjs";
import { esc, T, setting, optRange, optSelect, optCheck, optHint, bindSettings } from "./ui.mjs";
import { WATER_TOOLS } from "../water/editor.mjs";
import { RODS_TOOL, reverseSelected, undoRod } from "../water/rods.mjs";
import { mountWaterSettings, showWaterTab } from "../water/panel.mjs";

/**
 * Water: three brushes (still water, river, fall), an eraser and the rod tool (tools of the bar), the brush size or the rod options of
 * the active tool (its options), and every setting of the engine on its six tabs (dock). The settings used to be a window of their own;
 * the docked panel turns to the tab of the tool in hand (the River tab for the river brush, Rods for the rod tool...).
 */

const PICK = "mm-w-pick";
const TAB_OF = { "mm-w-water": "water", "mm-w-river": "river", "mm-w-fall": "fall", [RODS_TOOL]: "rods" };

function waterBar(host, ctx) {
  if ( ctx.tool === RODS_TOOL ) {
    host.innerHTML = `${optSelect({ name: "rodKind", label: T("Water.rod.kind"), value: setting("waterRodKind"), hint: T("Water.rod.kindHint"),
        options: [["flow", T("Water.rod.flow")], ["lip", T("Water.rod.lip")]] })}
      ${optCheck({ name: "rodBranch", label: T("Water.rod.branch"), checked: setting("waterRodBranch"), hint: T("Water.rod.branchHint") })}
      <button type="button" class="mm-ws-btn" data-act="rod-reverse" data-tooltip="${esc(T("Water.rod.reverseHint"))}"><i class="fa-solid fa-arrows-left-right" inert></i> ${esc(T("Water.rod.reverse"))}</button>
      <button type="button" class="mm-ws-btn" data-act="rod-undo"><i class="fa-solid fa-rotate-left" inert></i> ${esc(T("Water.rod.undo"))}</button>
      ${optHint(T("WS.rodHint"))}`;
    const onClick = (ev) => {
      const b = ev.target.closest("[data-act]"); if ( !b ) return;
      if ( b.dataset.act === "rod-reverse" ) reverseSelected(); else if ( b.dataset.act === "rod-undo" ) undoRod();
    };
    host.addEventListener("click", onClick);
    const off = bindSettings(host, { rodKind: "waterRodKind", rodBranch: "waterRodBranch" });
    return () => { off(); host.removeEventListener("click", onClick); };
  }
  if ( !(ctx.tool in WATER_TOOLS) ) { host.innerHTML = optHint(T("WS.waterPickHint")); return; }
  host.innerHTML = `${optRange({ name: "size", label: T("WS.waterSize"), value: setting("waterBrush"), min: 0.25, max: 8, step: 0.25, hint: T("District.sizeHint") })}
    ${optHint(T("WS.waterBrushHint"))}`;
  return bindSettings(host, { size: { key: "waterBrush", read: (c) => Math.min(8, Math.max(0.25, Number(c.value) || 1.5)) } });
}

registerSection({
  id: "water", order: 3, title: "MOINENMAPS.WS.water", icon: "fa-solid fa-water", color: "#2f86d6",
  activeTool: PICK,
  // each brush wears the colour of its overlay on the map
  tools: () => [
    { name: PICK, order: 1, title: "MOINENMAPS.WS.waterPick", icon: "fa-solid fa-arrow-pointer" },
    { name: "mm-w-water", order: 2, title: "MOINENMAPS.Tool.waterWater", icon: "fa-solid fa-droplet", color: "#2f86d6" },
    { name: "mm-w-river", order: 3, title: "MOINENMAPS.Tool.waterRiver", icon: "fa-solid fa-water", color: "#46d0d0" },
    { name: "mm-w-fall", order: 4, title: "MOINENMAPS.Tool.waterFall", icon: "fa-solid fa-arrows-down-to-line", color: "#e8f4ff" },
    { name: "mm-w-erase", order: 5, title: "MOINENMAPS.Tool.waterErase", icon: "fa-solid fa-droplet-slash", color: "#ffffff" },
    { name: RODS_TOOL, order: 6, title: "MOINENMAPS.Tool.waterRods", icon: "fa-solid fa-bezier-curve", color: "#ffa63d" }
  ],
  onToolChange: (tool, active) => { if ( active && TAB_OF[tool] ) showWaterTab(TAB_OF[tool]); },
  bar: waterBar,
  panels: [
    { id: "settings", title: "MOINENMAPS.WS.pWater", icon: "fa-solid fa-faucet-drip", mount: (host, ctx) => mountWaterSettings(host, { tab: TAB_OF[ctx.tool] }) }
  ]
});
