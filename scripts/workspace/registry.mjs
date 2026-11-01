/**
 * The workspace registry. Moinen Maps has ONE button in the first column of Foundry's scene controls ("Moinen Maps Tools"); its second
 * column lists the "sections" (Pins, Districts, Water, Destruction, Roads, Zones). Picking a section opens its workspace: the bar across
 * the top of the canvas holds the section's tools, the active tool's options and the section's actions; the dock on the right holds
 * its panels (choices, lists, settings). A section with `soon: true` is a visible placeholder whose workspace explains that it is not
 * there yet; a feature replaces the placeholder by registering the same id with real tools, bar and panels.
 *
 * This file imports nothing, so the engines (districts, water) may ask "which tool is active" without import cycles.
 *
 * @typedef WorkspaceTool
 * @property {string} name                            Unique across all sections; the engines key off it (e.g. "mm-district")
 * @property {string} title                           i18n key
 * @property {string} icon                            Font Awesome classes
 * @property {number} [order]
 * @property {boolean} [button]                       An action (e.g. "clear all"), not a mode: it runs `onClick` and is not selected
 * @property {() => void} [onClick]                   The action of a button
 * @property {boolean} [control]                      The notes layer keeps its pins selectable while this tool is active
 * @property {string} [color]                         Ink colour of the tool's icon
 *
 * @typedef WorkspacePanel
 * @property {string} id                              Unique within its section; the open/closed state is remembered per user
 * @property {string} title                           i18n key
 * @property {string} icon                            Font Awesome classes
 * @property {boolean} [open=true]                    Open the first time the section is shown
 * @property {(host: HTMLElement, ctx: object) => (Function|void)} mount
 *   Build the panel's content into `host` (called when the panel opens); return a cleanup, called when it closes or the section goes.
 *   `ctx` = { section, tool, revealPanel(id) }.
 *
 * @typedef WorkspaceSection
 * @property {string} id                              Short id, also `data-section` on the workspace for CSS
 * @property {number} order                           Position in the second column
 * @property {string} title                           i18n key
 * @property {string} icon                            Font Awesome classes of its entry in the second column
 * @property {string} [color]                         Ink colour of that entry and of the section's accents
 * @property {boolean} [soon]                         A placeholder for a feature that does not exist yet
 * @property {() => WorkspaceTool[]} [tools]          The section's tools, shown at the left of the bar (GM)
 * @property {string} [activeTool]                    The tool picked when the section opens the first time
 * @property {(host: HTMLElement, ctx: object) => (Function|void)} [bar]
 *   The options of the active tool (`ctx.tool`), shown after the tools; rebuilt whenever the tool changes. Returns a cleanup.
 * @property {WorkspacePanel[]} [panels]              The dock, top to bottom
 * @property {(tool: string, active: boolean) => void} [onToolChange]   Run when a tool of this section (de)activates
 */

/** The one scene-controls group of the module (its first-column button). */
export const GROUP = "moinenmaps";

const SECTIONS = new Map();

/**
 * Add or replace a section. Registering an id that exists replaces it (a feature taking over its placeholder).
 * Call before the scene controls are built (at import time or in "init"); later calls need `ui.controls.render({ reset: true })`.
 * @param {WorkspaceSection} def
 */
export function registerSection(def) {
  SECTIONS.set(def.id, { panels: [], ...def });
}

/**
 * Add tools and dock panels to a section that exists (a feature that belongs to it, e.g. the districts' night lights as a panel of
 * the Districts dock). Panels with an id the section already has replace it. Call before the section is shown.
 * @param {string} id
 * @param {{tools?: () => WorkspaceTool[], panels?: WorkspacePanel[]}} more
 */
export function extendSection(id, { tools, panels = [] } = {}) {
  const s = SECTIONS.get(id); if ( !s ) return;
  if ( tools ) { const own = s.tools; s.tools = () => [...(own?.() ?? []), ...tools()]; }
  const ids = new Set(panels.map((p) => p.id));
  s.panels = [...s.panels.filter((p) => !ids.has(p.id)), ...panels];
}

/** All sections in toolbar order. */
export const sections = () => [...SECTIONS.values()].sort((a, b) => a.order - b.order);
export const sectionById = (id) => SECTIONS.get(id) ?? null;
/** The scene-controls tool (second column) that stands for a section. */
export const sectionTool = (s) => `mm-sec-${s.id}`;
export const sectionOfTool = (name) => name ? sections().find((s) => sectionTool(s) === name) ?? null : null;

/** The section open right now (null while another scene-controls group is active). */
export function activeSection() {
  const c = globalThis.ui?.controls;
  return c?.control?.name === GROUP ? sectionOfTool(c.tool?.name) : null;
}
