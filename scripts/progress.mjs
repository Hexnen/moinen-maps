import { MODULE_ID } from "./config.mjs";
import { Job, splitTime, lineBottom } from "./progress-core.mjs";

/**
 * The long jobs' progress (progress-core.mjs) for everyone: the panels' status lines read `line(key)` / `bar(...)`, and a small
 * floating PROGRESS LINE (GM and players: a scene opening, a big bake, a Rebake all, the water) shows every job that has run longer
 * than SHOW_AFTER - what it does now, the percent, the time left and the time spent. One timer at 4 per second while a job runs (and
 * none otherwise): nothing per frame. Client setting "progressLine" turns the floating line off (the panels keep theirs).
 */
const SHOW_AFTER = 900, KEEP_DONE = 1400, TICK = 250;
const HOOK = "moinenMapsProgress";
const jobs = new Map();          // key -> Job (ended jobs stay KEEP_DONE ms for their "done" line)
let timer = 0, el = null;

const fmt = (key, data) => game.i18n.format(key, data ?? {});
const loc = (key) => game.i18n.localize(key);

/** The running job of `key`, or a new one (`title`: an i18n key). */
export function job(key, { title = "", data = null } = {}) {
  let j = jobs.get(key);
  if ( !j || j.ended ) { j = new Job(key, { title, data }); jobs.set(key, j); }
  else if ( title ) { j.title = title; j.titleData = data; }
  tickSoon();
  return j;
}
/** The running job of `key` (null: none). */
export const current = (key) => { const j = jobs.get(key); return j && !j.ended ? j : null; };
/** The job of `key` is done (ok) or given up (a scene closed, an error): its line says so for a moment, then goes. */
export function end(key, ok = true) {
  const j = jobs.get(key); if ( !j || j.ended ) return;
  j.finish(ok);
  if ( !ok ) jobs.delete(key);
  tickSoon();
}

/** "6 s" / "1 min 20 s". */
export function timeText(ms) {
  const { m, s } = splitTime(ms);
  return m ? fmt("MOINENMAPS.Prog.min", { m, s }) : fmt("MOINENMAPS.Prog.sec", { s });
}

/** A job's view in words: { pct (null: no measure), stage, time } - the panels and the floating line say the same. */
export function describe(key) {
  const j = jobs.get(key); if ( !j ) return null;
  const v = j.view();
  if ( v.ended ) return { pct: 100, frac: 1, stage: fmt("MOINENMAPS.Prog.done", { t: timeText(v.elapsedMs) }), time: "", title: j.title ? fmt(j.title, j.titleData) : "", ended: true, etaMs: 0, elapsedMs: v.elapsedMs };
  const stage = j.stageKey ? fmt(j.stageKey, j.stageData) : "";
  let time;
  if ( v.etaMs === null ) time = v.elapsedMs >= 1000 ? fmt("MOINENMAPS.Prog.spentOnly", { t: timeText(v.elapsedMs) }) : "";
  else if ( v.etaMs < 1000 ) time = fmt("MOINENMAPS.Prog.almost", { t: timeText(v.elapsedMs) });
  else time = fmt("MOINENMAPS.Prog.left", { left: timeText(v.etaMs), t: timeText(v.elapsedMs) });
  return { pct: v.frac === null ? null : Math.floor(v.frac * 100), frac: v.frac, stage, time, title: j.title ? fmt(j.title, j.titleData) : "", ended: false, etaMs: v.etaMs, elapsedMs: v.elapsedMs };
}

/** One line: "stage · 42% · ~6 s left (4 s so far)". */
export function line(key) {
  const d = describe(key); if ( !d ) return "";
  if ( d.ended ) return d.stage;
  return [d.stage, d.pct === null ? null : `${d.pct}%`, d.time].filter(Boolean).join(" · ");
}

/** A thin bar's markup for a panel (its fill is set by `paintBar`). */
export const barHtml = (key) => `<div class="mm-prog-bar" data-prog="${key}" hidden><span></span></div>`;
/** The panel's bars of `root` follow their jobs. */
export function paintBar(root) {
  for ( const b of root?.querySelectorAll?.(".mm-prog-bar[data-prog]") ?? [] ) {
    const d = describe(b.dataset.prog);
    b.hidden = !d || d.ended;
    if ( !d || d.ended ) continue;
    b.classList.toggle("is-wait", d.frac === null);
    b.firstElementChild.style.transform = `scaleX(${d.frac === null ? 1 : d.frac.toFixed(4)})`;
  }
}

/* ---------------------------------------------------------------- the timer and the floating line */

function tickSoon() { if ( !timer ) timer = setInterval(tick, TICK); }

function tick() {
  const t = performance.now();
  for ( const [k, j] of jobs ) if ( j.ended && t - j.ended > KEEP_DONE ) jobs.delete(k);
  Hooks.callAll(HOOK);
  render(t);
  if ( !jobs.size ) { clearInterval(timer); timer = 0; }
}

const on = () => { try { return game.settings.get(MODULE_ID, "progressLine") !== false; } catch { return true; } };

function render(t) {
  // (a job shows once it has run SHOW_AFTER ms: a quick stroke never blinks a line; a finished job keeps its "done" line a moment)
  const list = on() ? [...jobs.values()].filter((j) => (j.ended ? j.ended : t) - j.t0 >= SHOW_AFTER && (!j.ended || j.ok)) : [];
  if ( !list.length ) { if ( el ) { el.remove(); el = null; } return; }
  if ( !el ) {
    el = document.createElement("div");
    el.id = "mm-progress"; el.setAttribute("aria-label", loc("MOINENMAPS.Prog.label"));
    (document.getElementById("interface") ?? document.body).appendChild(el);
    place();
  }
  place();      // fxs2: what stands across the bottom may come or go while the line shows (a combat dock drawn after a reload)
  const rows = list.map((j) => {
    const d = describe(j.key);
    return { key: j.key, d };
  });
  // the rows are kept (only their text and the fill's transform change): no layout work beyond the text
  const keys = rows.map((r) => r.key).join("|");
  if ( el.dataset.keys !== keys ) {
    el.dataset.keys = keys;
    el.innerHTML = rows.map((r) => `<div class="mm-prog-row" role="progressbar" aria-valuemin="0" aria-valuemax="100" data-k="${r.key}">
      <div class="mm-prog-text"><i class="fa-solid fa-hourglass-half" inert></i><b></b><span class="mm-prog-stage"></span><span class="mm-prog-pct"></span><span class="mm-prog-time"></span></div>
      <div class="mm-prog-bar"><span></span></div></div>`).join("");
  }
  for ( const r of rows ) {
    const row = el.querySelector(`[data-k="${r.key}"]`), d = r.d; if ( !row || !d ) continue;
    row.classList.toggle("is-done", d.ended);
    row.querySelector("b").textContent = d.title;
    // (the stage may be cut short on a narrow screen; the percent and the time never are)
    row.querySelector(".mm-prog-stage").textContent = d.stage;
    row.querySelector(".mm-prog-pct").textContent = d.ended || d.pct === null ? "" : `${d.pct}%`;
    row.querySelector(".mm-prog-time").textContent = d.time;
    const bar = row.querySelector(".mm-prog-bar");
    bar.classList.toggle("is-wait", d.frac === null);
    bar.firstElementChild.style.transform = `scaleX(${d.frac === null ? 1 : d.frac.toFixed(4)})`;
    if ( d.pct === null ) row.removeAttribute("aria-valuenow"); else row.setAttribute("aria-valuenow", String(d.pct));
    row.setAttribute("aria-valuetext", [d.title, d.stage, d.ended || d.pct === null ? null : `${d.pct}%`, d.time].filter(Boolean).join(", "));
  }
}

/** Above the hotbar and above what other modules declared across the bottom (fxs2: a combat dock), in the middle of the map's column. */
function place() {
  if ( !el ) return;
  const hot = document.getElementById("hotbar")?.getBoundingClientRect?.();
  let ins = 0;
  try { ins = game.modules.get(MODULE_ID)?.api?.zones?.uiInsets?.()?.bottom ?? 0; } catch {}
  const bottom = `${lineBottom(hot && hot.height > 0 ? hot.top : null, innerHeight, ins)}px`;
  if ( el.style.bottom !== bottom ) el.style.bottom = bottom;
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "progressLine", { name: "MOINENMAPS.Setting.progressLine", hint: "MOINENMAPS.Setting.progressLineHint", scope: "client", config: true, type: Boolean, default: true });
});
Hooks.on("canvasInit", () => { for ( const k of [...jobs.keys()] ) { const j = jobs.get(k); if ( !j.ended ) jobs.delete(k); } });
globalThis.addEventListener?.("resize", () => place());
