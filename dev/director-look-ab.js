// LOOK A/B probe (paste-free: node dev/tools/cdp-rec.mjs eval <port> <playerPrefix> @dev/director-look-ab.js). Run it on the same player
// page, same window size and view, once per build: every Director overlay is made the way the Director makes it and its geometry is
// read once it has settled - the caption of a take-over (3 texts, with and without the letterbox), the soft markers (ping and edge
// arrow, with the label), the turn banner, the arrival title card (settled after its 2.6 s transitions). Everything over a black
// backdrop (pointer-events none: the hit tests pass through it, as they pass through the map) so a screenshot of each is comparable
// pixel for pixel: with window.__abPause set, the probe stops at each settled overlay (window.__shot = its name) until a driver calls
// window.__abNext(). Two builds that draw the same thing give the same JSON (and the same pixels).
const Ov = await import("/modules/moinen-maps/scripts/director/overlay.mjs");
const API = game.modules.get("moinen-maps").api;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 100) / 100); };
const parts = (el) => [R(el), ...[...el.querySelectorAll("*")].map(R)];
for ( const a of [...foundry.applications.instances.values()] ) if ( a.hasFrame && a.rendered ) await a.close();
await canvas.animatePan({ x: 1500, y: 5300, scale: 0.6, duration: 0 });
await sleep(500);
const pause = async (name) => { if ( !window.__abPause ) return; window.__shot = name; await new Promise((r) => { window.__abNext = r; }); window.__shot = null; };
const back = document.createElement("div"); back.style.cssText = "position:fixed;inset:0;z-index:1;background:#050505;pointer-events:none";
{ const ui = document.getElementById("interface"); ui.parentNode.insertBefore(back, ui); }
const out = { view: [innerWidth, innerHeight], captions: [], markers: [], banner: null, card: null };
for ( const [title, lb] of [["Zone 1 collapses", 12], ["Atom Eve hits Battle Beast for 3 damage - the wall gives way", 12], ["The street floods", 0]] ) {
  const c = Ov.caption({ kick: "Destruction", title, icon: "fa-solid fa-burst", lb, hint: "Esc / click: back" });
  for ( let i = 0; i < 200 && !c.shown; i++ ) await sleep(20);
  await sleep(1800);                                      // (slid in; the live re-check of kept answers has run)
  out.captions.push({ title, lb, cls: c.el.className, left: c.el.style.left, bottom: c.el.style.bottom, parts: parts(c.el) });
  await pause(`caption-${out.captions.length}`);
  c.out(100); await sleep(250);
}
for ( const dx of [0, 9000] ) {
  const m = Ov.marker({ x: canvas.stage.pivot.x + dx, y: canvas.stage.pivot.y + 120, text: "Destruction · Zone 1 collapses", icon: "fa-solid fa-burst" });
  await sleep(900);
  await pause(`marker-${m.kind}`);
  out.markers.push({ kind: m.kind, transform: m.el.style.transform, a: m.el.style.getPropertyValue("--mm-dir-a"), label: m.el.querySelector(".mm-dir-label")?.style.transform ?? null, parts: parts(m.el).slice(0, 3).concat([R(m.el.querySelector(".mm-dir-label"))]) });
  m.remove(); await sleep(100);
}
const b = API.directorMove.showBanner({ kick: "Round 2", name: "Atom Eve", sub: "Your turn", round: true, ms: 2600 });
for ( let i = 0; i < 200 && !b.classList.contains("is-in"); i++ ) await sleep(20);
await sleep(1300);
out.banner = { top: b.style.getPropertyValue("--mm-dmv-top"), left: b.style.left, parts: parts(b) };
await pause("banner");
await sleep(2000);
// the arrival card, as source-scene makeCard builds it (its stylesheet is in the page once an arrival played here)
if ( document.querySelector("style[data-mm-dir-arr]") ) {
  const ui = document.getElementById("interface");
  const el = document.createElement("div"); el.className = "mm-dir-arr";
  el.innerHTML = `<div class="mm-dir-arr-card"><div class="mm-dir-arr-kick">Orbit</div><div class="mm-dir-arr-title">ZZ-dir-rolls street</div><div class="mm-dir-arr-rule"></div><div class="mm-dir-arr-sub">Night falls</div></div>`;
  ui.parentNode.insertBefore(el, ui); void getComputedStyle(el).opacity; el.classList.add("is-in");
  const mid = []; for ( const t of [300, 900, 1600] ) { await sleep(t - (mid.length ? [300, 900, 1600][mid.length - 1] : 0)); mid.push(R(el.querySelector(".mm-dir-arr-title"))); }
  await sleep(2400);
  out.card = { contain: getComputedStyle(el).contain, settled: parts(el), titleMid: mid };
  await pause("card");
  el.remove();
} else out.card = "no arrival stylesheet in this page (play an arrival first)";
back.remove();
return out;
