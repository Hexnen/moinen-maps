/* DROPS: the window of the lens's table look ("Water drops on the lens"). The GM picks how the weather on the glass is drawn for the
   whole table (pixel art, the default, or smooth): one click writes the world setting and every seat redraws at once. A player opens the
   same window and reads the GM's choice (locked). Under it, what only this screen decides: its own lens cap (Configure Settings).
   Opened from the module's settings (menu "weatherLensTable") and the weather API (`openLook`). Same visual family as the lettering's
   table window (mm-sfxt tokens), with the rain's blue as its accent. */
import { MODULE_ID } from "../config.mjs";
import { LOOK_KEY, LOOKS, DEFAULT_LOOK, cleanLook, mayWrite } from "./lens-look.mjs";

const I = (k) => game.i18n.localize(`MOINENMAPS.${k}`), LT = (k) => I(`Weather.look.${k}`);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const look = () => { try { return cleanLook(game.settings.get(MODULE_ID, LOOK_KEY)); } catch { return DEFAULT_LOOK; } };
const cap = () => { try { return String(game.settings.get(MODULE_ID, "weatherLens") ?? "3"); } catch { return "3"; } };

// the two looks drawn as what they are: a drop on 3-px blocks, and the same drop with a smooth edge (geometry, 28 x 28)
const PIXEL_DROP = (() => {
  const rows = ["....#....", "...###...", "..#####..", "..#####..", ".#######.", "#########", "#########", ".#######.", "..#####.."];
  let r = "";
  rows.forEach((row, y) => [...row].forEach((c, x) => { if ( c === "#" ) r += `<rect x="${x * 3}" y="${y * 3}" width="3" height="3"/>`; }));
  return `<svg viewBox="0 0 27 27" width="27" height="27" aria-hidden="true" shape-rendering="crispEdges"><g fill="currentColor">${r}</g><rect x="6" y="12" width="3" height="6" fill="var(--mm-ll-glint)"/></svg>`;
})();
const SMOOTH_DROP = `<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M14 1.5C10 7 4.5 11.5 4.5 17.5a9.5 9.5 0 0 0 19 0C23.5 11.5 18 7 14 1.5z" fill="currentColor"/>`
  + `<ellipse cx="10" cy="15" rx="2" ry="2.6" fill="var(--mm-ll-glint)" transform="rotate(-30 10 15)"/></svg>`;
const ICON = { pixel: PIXEL_DROP, smooth: SMOOTH_DROP };

// (made on first use: foundry.applications exists from init on; node checks import this file without it)
let LookWindow = null, Menu = null;
function windowClass() {
  if ( LookWindow ) return LookWindow;
  const { ApplicationV2 } = foundry.applications.api;
  LookWindow = class LookWindow extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "moinen-maps-lens-look", tag: "div", classes: ["mm-sfxt", "mm-lenslook"],
      window: { title: "MOINENMAPS.Weather.look.title", icon: "fa-solid fa-droplet" },
      position: { width: 460, height: "auto" },
      actions: { pick: LookWindow.#pick, settings: LookWindow.#settings }
    };
    async _renderHTML() {
      const gm = mayWrite(game.user), cur = look(), c = cap();
      const opt = (k) => `<button type="button" class="mm-ll-opt" data-action="pick" data-look="${k}" role="radio" aria-checked="${k === cur}"${gm ? "" : " disabled"}>
          <span class="mm-ll-icon mm-ll-${k}">${ICON[k]}</span><span class="mm-ll-text"><b>${esc(LT(k))}</b><span>${esc(LT(`${k}Hint`))}</span></span></button>`;
      const root = document.createElement("div");
      root.className = `mm-sfxt-body mm-ll-body${gm ? " is-gm" : " is-player"}`;
      root.innerHTML = `
        <p class="mm-sfxt-banner"><i class="fa-solid ${gm ? "fa-users" : "fa-lock"}" aria-hidden="true"></i><span>${esc(LT(gm ? "bannerGm" : "bannerPlayer"))}</span></p>
        <fieldset><legend>${esc(LT("short"))}</legend>
          <div class="mm-ll-opts" role="radiogroup" aria-label="${esc(LT("name"))}">${LOOKS.map(opt).join("")}</div>
          <p class="hint mm-sfxt-foot">${esc(LT("hint"))}</p></fieldset>
        <section class="mm-sfxt-seat" aria-label="${esc(LT("seat"))}"><h4>${esc(LT("seat"))}</h4><ul>
          <li class="${c === "off" ? "" : "is-on"}"><i class="fa-solid ${c === "off" ? "fa-circle" : "fa-circle-check"}" aria-hidden="true"></i><span><b>${esc(I("Weather.set.lens"))}</b> ${esc(I(`Weather.cap.${c}`))}</span></li></ul>
          <button type="button" class="mm-ll-seatbtn" data-action="settings"><i class="fa-solid fa-gear" aria-hidden="true"></i> ${esc(LT("seatOpen"))}</button></section>`;
      return root;
    }
    _replaceHTML(result, content) { content.replaceChildren(result); }
    _onRender() { win = this; }
    _onClose() { if ( win === this ) win = null; }
    static async #pick(ev, btn) {
      const k = cleanLook(btn?.dataset?.look);
      if ( !mayWrite(game.user) || k === look() ) return;
      // (shown at once on this seat; the setting's onChange re-renders every open window, this one too)
      for ( const b of this.element.querySelectorAll(".mm-ll-opt") ) b.setAttribute("aria-checked", String(b.dataset.look === k));
      await game.settings.set(MODULE_ID, LOOK_KEY, k);
    }
    static #settings() { try { game.settings.sheet?.render?.({ force: true }); } catch {} }
  };
  return LookWindow;
}

let win = null;
/** open (or bring forward) the window */
export function open() {
  if ( win?.rendered ) { win.bringToFront(); return win; }
  win = new (windowClass())(); win.render({ force: true });
  return win;
}
/** the table's look changed on this seat (onChange): an open window shows it */
export function follow() { try { if ( win?.rendered ) win.render(); } catch {} }
/** the settings menu entry: its button opens the window (players too: they read the table's look) */
export function menuClass() {
  if ( Menu ) return Menu;
  const { ApplicationV2 } = foundry.applications.api;
  return Menu = class LookMenu extends ApplicationV2 { render() { open(); return this; } };
}
