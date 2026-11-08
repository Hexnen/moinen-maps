/**
 * Live checks of the director's SCENE TRANSITIONS (scripts/director/source-scene.mjs), in a lane tab:
 *   const X = await import("/modules/moinen-maps/dev/director-scene-check.mjs")
 *   X.sample(ms)            sample this page every 40 ms: camera, veil opacity, card, bars, screen owner, canvas ready/visible
 *   X.watchArrival(fn, ms)  start sampling, run fn (e.g. view a scene), return the samples + a summary (dip, reveal, glide, end, home)
 *   X.leaks()               what the arrival leaves behind: DOM, holds, screen session, ticker listeners, hook counts
 *   X.switchLoop(ids, n)    view the scenes `ids` in turn n times on THIS client (a player may view scenes in the navigation): errors,
 *                           leaks before/after, the time from each view() to canvasReady with the arrival on vs off (load not slowed)
 *   X.errors()              the errors and unhandled rejections seen since import
 */
const api = () => game.modules.get("moinen-maps").api;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errs = [];
window.addEventListener("error", (e) => errs.push(String(e.error?.stack ?? e.message)));
window.addEventListener("unhandledrejection", (e) => errs.push(String(e.reason?.stack ?? e.reason)));
const origErr = console.error;
if ( !console.__mmScene ) { console.__mmScene = true; console.error = (...a) => { errs.push(a.map((x) => String(x?.stack ?? x)).join(" ")); origErr.apply(console, a); }; }
export const errors = () => errs.slice();

function one(t0) {
  const st = canvas?.stage, veil = document.querySelector(".mm-dir-veil"), card = document.querySelector(".mm-dir-arr"), title = card?.querySelector(".mm-dir-arr-title");
  const bars = document.querySelector(".mm-cin");
  return {
    t: Math.round(performance.now() - t0), ready: !!canvas?.ready, shown: !!canvas?.root?.visible, scene: canvas?.scene?.id ?? null,
    x: st ? Math.round(st.pivot.x) : null, y: st ? Math.round(st.pivot.y) : null, s: st ? +st.scale.x.toFixed(3) : null,
    veil: veil ? +(+getComputedStyle(veil).opacity).toFixed(2) : null, card: card ? +(+getComputedStyle(card.querySelector(".mm-dir-arr-card")).opacity).toFixed(2) : null,
    cardTitle: title?.textContent ?? null, titleOp: title ? +(+getComputedStyle(title).opacity).toFixed(2) : null, bars: !!bars, owner: api().cinematic?.owner ?? null,
    arr: api().director?.arrival?.status?.() ?? null
  };
}
export async function sample(ms = 6000, every = 40) {
  const t0 = performance.now(), out = [];
  while ( performance.now() - t0 < ms ) { try { out.push(one(t0)); } catch ( e ) { out.push({ t: Math.round(performance.now() - t0), err: String(e) }); } await sleep(every); }
  return out;
}
export async function watchArrival(fn, ms = 7000) {
  const t0 = performance.now(), marks = {};
  const hk = Hooks.on("moinenMapsDirector", (k, d) => { if ( k === "arrival" || k === "arrivalEnd" ) marks[k] = { t: Math.round(performance.now() - t0), ...d }; });
  const hr = Hooks.on("canvasReady", () => { marks.ready = Math.round(performance.now() - t0); });
  const ht = Hooks.on("canvasTearDown", () => { marks.tearDown = Math.round(performance.now() - t0); });
  const p = sample(ms);
  await sleep(150);
  try { await fn?.(); } catch ( e ) { marks.fnErr = String(e); }
  const s = await p;
  Hooks.off("moinenMapsDirector", hk); Hooks.off("canvasReady", hr); Hooks.off("canvasTearDown", ht);
  const after = s.filter((q) => marks.ready !== undefined && q.t >= marks.ready);
  const last = s.at(-1);
  const firstShown = after.find((q) => q.shown);
  return {
    marks, home: marks.arrival ? api().director?.arrival?._debug?.()?.home : null,
    summary: {
      veilMax: Math.max(0, ...s.map((q) => q.veil ?? 0)), veilAtReady: s.find((q) => q.t >= (marks.ready ?? 1e9))?.veil ?? null,
      firstShownVeil: firstShown?.veil ?? null, veilGoneAt: s.find((q) => q.t > (marks.ready ?? 1e9) && (q.veil === null || q.veil === 0))?.t ?? null,
      cardTitle: s.find((q) => q.cardTitle)?.cardTitle ?? null, cardMaxOp: Math.max(0, ...s.map((q) => q.titleOp ?? 0)),
      scaleAtShown: firstShown?.s ?? null, scaleEnd: last?.s, posEnd: last ? [last.x, last.y] : null, barsSeen: s.some((q) => q.bars), barsEnd: last?.bars, ownerEnd: last?.owner, arrEnd: last?.arr
    },
    samples: s
  };
}

export function leaks() {
  const tk = canvas?.app?.ticker;
  let n = 0; for ( let l = tk?._head?.next; l; l = l.next ) n++;
  const hooks = (name) => Hooks.events?.[name]?.length ?? null;
  const d = api().director;
  return {
    dom: { veil: document.querySelectorAll(".mm-dir-veil").length, card: document.querySelectorAll(".mm-dir-arr").length, cin: document.querySelectorAll(".mm-cin").length, dir: document.querySelectorAll(".mm-dir").length,
      style: document.querySelectorAll("style[data-mm-dir-arr]").length },
    holds: d?.arrival?._debug?.()?.holds ?? null, arrival: d?.arrival?.status?.() ?? null, screen: api().cinematic?.owner ?? null, screenActive: !!api().cinematic?.active,
    ticker: n, hooks: { canvasReady: hooks("canvasReady"), canvasTearDown: hooks("canvasTearDown"), canvasInit: hooks("canvasInit"), dir: hooks("moinenMapsDirector"), pan: hooks("canvasPan"), createToken: hooks("createToken") },
    status: d?.status?.() ? { take: d.status().take, soft: d.status().soft.length, waiting: d.status().waiting.length } : null
  };
}

/** View scenes in turn on this client; each waits for canvasReady and `settle` ms. Returns per switch the view->ready time and the leak state. */
export async function switchLoop(ids, n = 6, { settle = 1200, cutAt = null } = {}) {
  const e0 = errs.length, before = leaks(), rows = [];
  for ( let i = 0; i < n; i++ ) {
    const sc = game.scenes.get(ids[i % ids.length]); if ( !sc ) continue;
    const t0 = performance.now();
    const ready = new Promise((r) => Hooks.once("canvasReady", r));
    await sc.view();
    await ready;
    const loadMs = Math.round(performance.now() - t0);
    if ( cutAt !== null ) { await sleep(cutAt); api().director?.arrival?.cut?.(); }
    await sleep(settle);
    rows.push({ i, scene: sc.name, loadMs, arr: api().director?.arrival?.status?.()?.form ?? null });
  }
  await sleep(4500);
  return { rows, before, after: leaks(), errors: errs.slice(e0) };
}
