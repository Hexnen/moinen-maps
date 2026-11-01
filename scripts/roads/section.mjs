import * as Editor from "./editor.mjs";
import { mountRoadControls } from "./panel.mjs";

/**
 * Roads as a workspace section (scripts/workspace/registry.mjs: WorkspaceSection). Registered by scripts/roads/workspace.mjs, which
 * takes over the "roads" placeholder (same id).
 *
 * Tools (left of the bar): the hand (no road tool: the map behaves as usual), the road pen and the eraser. Options (the rest of the
 * bar): the brush (kind, width, lanes, one-way) or the eraser size, with undo and redo. Dock: the traffic, then the road look.
 */

export const ROAD_TOOLS = { "mm-r-pick": null, "mm-r-draw": "draw", "mm-r-erase": "erase" };

let watching = false;
/** Whatever tool the workspace hands over next (another section's, or none): the pen goes down unless it is a road tool. */
function watchTools() {
  if ( watching ) return;
  watching = true;
  Hooks.on("moinenMapsTool", (tool) => { const want = ROAD_TOOLS[tool] ?? null; if ( Editor.mode() !== want ) Editor.setMode(want); });
}

export function roadsSection() {
  watchTools();
  return {
    id: "roads", order: 5, title: "MOINENMAPS.Roads.title", icon: "fa-solid fa-road", color: "#e0b04a",
    activeTool: "mm-r-pick",
    tools: () => [
      { name: "mm-r-pick", order: 1, title: "MOINENMAPS.Roads.tool.pick", icon: "fa-solid fa-arrow-pointer" },
      { name: "mm-r-draw", order: 2, title: "MOINENMAPS.Roads.tool.draw", icon: "fa-solid fa-road", color: "#e0b04a" },
      { name: "mm-r-erase", order: 3, title: "MOINENMAPS.Roads.tool.erase", icon: "fa-solid fa-eraser", color: "#ffffff" }
    ],
    onToolChange: (tool, active) => { if ( tool in ROAD_TOOLS ) Editor.setMode(active ? ROAD_TOOLS[tool] : null); },
    bar: (host, ctx) => {
      if ( !ROAD_TOOLS[ctx?.tool] ) { host.innerHTML = `<span class="mm-ws-hint">${foundry.utils.escapeHTML(game.i18n.localize("MOINENMAPS.Roads.pickHint"))}</span>`; return; }
      const m = mountRoadControls(host, ["bar"], { status: false });
      return () => m.destroy();
    },
    panels: [
      { id: "traffic", title: "MOINENMAPS.Roads.sec.traffic", icon: "fa-solid fa-car-side", mount: (host) => { const m = mountRoadControls(host, ["traffic"], { headings: false }); return () => m.destroy(); } },
      { id: "look", title: "MOINENMAPS.Roads.sec.look", icon: "fa-solid fa-paint-roller", open: false, mount: (host) => { const m = mountRoadControls(host, ["look"], { status: false, headings: false }); return () => m.destroy(); } }
    ]
  };
}
