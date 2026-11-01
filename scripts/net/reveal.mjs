import { MODULE_ID } from "../config.mjs";
import { markOnce } from "./trace.mjs";

/**
 * ONE soft reveal of the baked layers when a scene opens. Before: the water came first, then the damage popped in stroke by stroke as
 * chunks landed, the shards of a big area appeared a few hundred per frame, the flooded holes stood empty until their water came, and
 * every new area's texture went to the GPU in the frame it was first drawn. Now each layer that has something to show registers
 * (`expect`) at canvasReady, keeps its containers hidden while it gets ready (`attach`: alpha 0), uploads its textures a little at a
 * time (`upload`), and says `ready`; when all are ready - or BUDGET ms after canvasReady at the latest - everything fades in together
 * (FADE ms). What arrives after the reveal is shown as before (per stroke). localStorage "mm-reveal" = "off": no holding at all.
 */
const BUDGET = 500, FADE = 260, LATE = 2500;
let phase = "done", readyAt = 0, budgetTimer = 0;
const parts = new Map();          // name -> { ready, objs: Set }
const onGo = [];

const off = () => { try { return localStorage.getItem("mm-reveal") === "off"; } catch { return false; } };


/** A layer has something to show on this load: the reveal waits for it (until the budget runs out). */
export function expect(name) {
  if ( phase !== "holding" ) return;
  if ( !parts.has(name) ) parts.set(name, { ready: false, shown: false, objs: new Set() });
}

/** Containers to keep hidden until the reveal (alpha 0 now, faded to 1 then). After the reveal: nothing happens. */
export function attach(name, ...objs) {
  const p = parts.get(name);
  if ( phase !== "holding" && !(p && !p.shown) ) return;
  expect(name);
  for ( const o of objs ) if ( o && !o.destroyed && !parts.get(name).objs.has(o) ) { o.alpha = 0; parts.get(name).objs.add(o); }
}

/**
 * Still held back: the whole reveal (no name), or one layer (it has not faded in yet; a layer that was not ready when the others
 * faded in stays hidden until it is, then fades in by itself - it never pops).
 */
export function holding(name = null) {
  if ( !name ) return phase === "holding";
  const p = parts.get(name);
  return !!p && !p.shown && phase !== "done";
}

/** The layer is ready (or has nothing to show after all). */
export function ready(name) {
  const p = parts.get(name);
  if ( !p || p.ready ) return;
  p.ready = true;
  markOnce(`ready:${name}`);
  if ( phase === "holding" ) check();
  else if ( !p.shown ) fadeIn([p], "late");
}

/** Called once when the reveal happens (budget or all ready). */
export function whenRevealed(fn) { if ( phase === "holding" ) onGo.push(fn); else fn(); }

function check() {
  if ( phase !== "holding" || !readyAt ) return;
  if ( [...parts.values()].every((p) => p.ready) ) go("ready");
}

function fadeIn(list, why) {
  for ( const p of list ) p.shown = true;
  const objs = list.flatMap((p) => [...p.objs]).filter((o) => !o.destroyed);
  markOnce(`fade:${why}:${[...parts].filter(([, p]) => list.includes(p)).map(([n]) => n).join("+")}`);
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / FADE), a = k * k * (3 - 2 * k);
    for ( const o of objs ) if ( !o.destroyed ) o.alpha = a;
    if ( k >= 1 ) canvas.app?.ticker?.remove(step);
  };
  canvas.app?.ticker?.add(step);
  // a ticker that does not run (a hidden tab) never leaves the layers hidden
  setTimeout(() => { canvas.app?.ticker?.remove(step); for ( const o of objs ) if ( !o.destroyed ) o.alpha = 1; }, FADE + 400);
  if ( [...parts.values()].every((p) => p.shown) ) phase = "done";
}

function go(why) {
  if ( phase !== "holding" ) return;
  phase = "revealing"; clearTimeout(budgetTimer);
  const late = [...parts].filter(([, p]) => !p.ready).map(([n]) => n);
  markOnce("reveal", { why, late });
  fadeIn([...parts.values()].filter((p) => p.ready), "reveal");
  // a late layer comes in by itself when ready, and after LATE ms at the latest (what it has by then; the rest as it lands)
  if ( late.length ) setTimeout(() => { const rest = [...parts.values()].filter((p) => !p.shown); if ( rest.length ) fadeIn(rest, "cap"); }, LATE);
  if ( !late.length ) phase = "done";
  for ( const fn of onGo.splice(0) ) { try { fn(); } catch ( err ) { console.error(`${MODULE_ID} | reveal`, err); } }
}

/**
 * Upload base textures to the GPU a few at a time (about `slice` ms each, between other work), so neither the reveal nor the first
 * frames of a loop pay for them all in one frame. Mipmaps are made with the upload, once.
 */
export const stats = { n: 0, ms: 0, max: 0, mpx: 0 };
export async function upload(baseTextures, slice = 16) {
  const r = canvas.app?.renderer;
  if ( !r?.texture ) return;
  const list = [...baseTextures].filter((t) => t && !t.destroyed && t.valid && !t._glTextures?.[r.CONTEXT_UID]);
  let i = 0, busy = 0, max = 0, px = 0;
  while ( i < list.length ) {
    const t0 = performance.now();
    while ( i < list.length && performance.now() - t0 < slice ) {
      const t1 = performance.now();
      try { r.texture.bind(list[i], 0); } catch { /* a lost context: the render uploads it */ }
      const ms = performance.now() - t1; busy += ms; max = Math.max(max, ms); px += (list[i].realWidth ?? 0) * (list[i].realHeight ?? 0);
      i++;
    }
    if ( i < list.length ) await new Promise((res) => setTimeout(res, 0));
  }
  stats.n += list.length; stats.ms += busy; stats.max = Math.max(stats.max, max); stats.mpx += px / 1e6;
  try { r.texture.unbind?.(list.at(-1)); } catch { /* fine */ }
}

Hooks.on("canvasInit", () => {
  clearTimeout(budgetTimer); parts.clear(); onGo.length = 0; readyAt = 0;
  phase = off() ? "done" : "holding";
});
Hooks.on("canvasReady", () => {
  if ( phase !== "holding" ) return;
  readyAt = performance.now();
  // the budget counts from the first frame drawn after canvasReady: Foundry's own first frame (the map's texture going to the GPU)
  // can hold the page for a few hundred ms, and no layer could use that time anyway
  let started = false;
  const start = () => { if ( started ) return; started = true; clearTimeout(budgetTimer); budgetTimer = setTimeout(() => go("budget"), BUDGET); };
  canvas.app?.ticker?.addOnce(start);
  budgetTimer = setTimeout(start, 300);         // (a ticker that does not run)
  // every layer registers in its own canvasReady handler: look once they all ran
  setTimeout(check, 0);
});
Hooks.on("canvasTearDown", () => { clearTimeout(budgetTimer); if ( phase === "holding" ) go("teardown"); });
