import { registerSection } from "./registry.mjs";
import { esc, T, optHint } from "./ui.mjs";

/**
 * The three sections that are still to come. Each is a real entry of the second column with a workspace that says what it is for, so
 * the menu already has its final shape. A feature takes over its placeholder by calling registerSection() with the same id (see registry.mjs).
 */

function soon({ id, order, icon, text }) {
  registerSection({
    id, order, title: `MOINENMAPS.WS.${id}`, icon, soon: true,
    bar: (host) => { host.innerHTML = optHint(T("WS.soonBar")); },
    panels: [{
      id: "soon", title: "MOINENMAPS.WS.pSoon", icon: "fa-solid fa-hourglass-half",
      mount: (host) => { host.innerHTML = `<div class="mm-ws-soon"><i class="${esc(icon)}" inert></i><p>${esc(T(text))}</p><p class="hint">${esc(T("WS.soonHow"))}</p></div>`; }
    }]
  });
}

soon({ id: "destruction", order: 4, icon: "fa-solid fa-house-crack", text: "WS.soonDestruction" });
soon({ id: "roads", order: 5, icon: "fa-solid fa-road", text: "WS.soonRoads" });
soon({ id: "zones", order: 6, icon: "fa-solid fa-vector-square", text: "WS.soonZones" });
