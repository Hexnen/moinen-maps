import { MODULE_ID, reducedMotion } from "../config.mjs";
import * as D from "./destruction.mjs";
import * as Model from "./model.mjs";
import * as FC from "./flood-core.mjs";
import { mapPixels } from "./source.mjs";
import * as Water from "../water/water.mjs";
import * as WaterModel from "../water/model.mjs";
import { buildLut, overall } from "../water/paint.mjs";
import { CODES } from "../water/codes-table.mjs";
import { publishBake, fetchBake } from "../water/publish.mjs";
import { addWet, wetChanged } from "../water/wet.mjs";
import * as Reveal from "../net/reveal.mjs";
import { addDeletion } from "../flag-diff.mjs";
import { markOnce } from "../net/trace.mjs";
import { LoopMix, loopMix } from "../water/display.mjs";

/**
 * FLOODED HOLES: the water of the module's water engine in every flooded area of the destruction (damage kind "flood").
 *
 * Design: every flooded area (one stroke's connected part, as the destruction bake made it) gets ITS OWN small water loop, baked by the
 * WOWe engine in a worker of its own (lib/water-worker.js, request "bakeFlood"), from a mask made from that area alone (its torn
 * outline, its open pixels, its levels: flood-core.mjs). It is NOT merged into the scene's painted-water bake: painting or erasing a
 * flood stroke bakes only that stroke's water, the painted water never bakes again for it, and the painted water's edits never bake a
 * hole again unless its look changed. The loop is keyed by the area's hash and the look's settings, kept in IndexedDB, and published by
 * the GM as a PNG of level bytes (like the painted water), so players only download it.
 *
 * Shown inside the area's own container of the destruction display, over its ruin and its plates (a later stroke covers it like it
 * covers the rest of the area), clipped to the hole at art-pixel resolution, painted with the scene water's colours and opacities
 * (`alpha.all` included; a colour edit repaints, no bake), on the same clock as the painted water (frame = time / ms mod frames, the
 * scene's frames and ms), so a hole beside painted water is one water body. Without painted water the colours come from the map (a
 * muddy blue made from its average colour, by the engine's palette maker, stored in the scene flag by the GM).
 *
 * Entry: the water wells up from the deepest points (and the cracks) once the ruin has opened, the level rising to the rim with a
 * line of foam on it and rings spreading from the springs; reduced motion: a fade. Tokens: the holes are water for the ripples, the
 * splash, the submerge veil and the reflections (scripts/water/wet.mjs).
 *
 * Scene flag `flood`: { baked: { <area hash base36>: { path, key, box, ms, frames, cols } }, colors: [six hex] | null }.
 * API: game.modules.get("moinen-maps").api.destruction.flood.
 */

const FLAG = "flood";
const ENTRY_WINDOW = 8000;          // a fill that would start later than this after its moment is skipped (shown full)
const AWAIT_PUBLISH = 12000;        // how long a player waits for the GM's upload before baking himself
const MAX_PIXELS = 262144;          // engine pixels of one hole (512 x 512): above that the hole keeps the bake's own water
const STEP_MS = 90;                 // the entry repaints in pixel-art steps
const REDUCED_OS = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
const FALLBACK = ["1c3558", "2b5480", "3f6c9a", "5291bd", "7cc4d4", "d6f3f2"];   // WOWe "forest"

const OFF = (() => { try { return ["mm-destruction", "mm-flood"].some((k) => globalThis.localStorage?.getItem(k) === "off"); } catch { return false; } })();

let entries = new Map();            // area hash -> entry
let tickFn = null, syncTimer = 0, publishTimer = 0, publishBackoff = 0, life = 0, repaintTimer = 0;
const stats = { bakes: 0, bakeMs: 0, fetched: 0, cached: 0, frameMs: 0, entries: 0 };

const flagOf = () => canvas.scene?.flags?.[MODULE_ID]?.[FLAG] ?? {};
const hkey = (h) => (h >>> 0).toString(36);
const now = () => performance.now();
const smoothWater = () => { try { return game.settings.get(MODULE_ID, "smoothWater") !== false; } catch { return true; } };
const SYNC_MS = 3;               // per frame for making new holes' entries (sync)

/* ================================================================ the worker (a water engine of its own) */

let worker = null, ready = null, winfo = null, nextId = 1, idleTimer = 0;
const pend = new Map();
const route = (p) => foundry.utils.getRoute(`modules/${MODULE_ID}/lib/${p}`);

function post(msg) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pend.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id });
  });
}
function engine() {
  clearTimeout(idleTimer);
  if ( ready ) return ready;
  ready = (async () => {
    worker = new Worker(route("water-worker.js"));
    worker.onmessage = (ev) => {
      const m = ev.data, p = pend.get(m.id); if ( !p || m.ok === undefined ) return;
      pend.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
    };
    worker.onerror = (e) => { console.error(`${MODULE_ID} | flood worker`, e); disposeEngine(); };
    const base = new URL(".", new URL(route("water-worker.js"), location.href)).href;
    winfo = await post({ type: "init", base });
    return winfo;
  })().catch((err) => { disposeEngine(); throw err; });
  return ready;
}
function releaseEngine() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if ( !pend.size ) disposeEngine(); }, game.user.isGM ? 60000 : 2000);
}
function disposeEngine() {
  worker?.terminate(); worker = null; ready = null; winfo = null; clearTimeout(idleTimer);
  for ( const p of pend.values() ) p.reject(new Error("flood worker stopped"));
  pend.clear();
}

/* ================================================================ browser cache */

const DB = "moinen-maps-flood", KEEP = 64;
let dbp = null;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("bakes", { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => null);
  return dbp;
}
const idb = async (mode, fn) => {
  const d = await Promise.race([db(), new Promise((r) => setTimeout(() => r(null), 1200))]);
  if ( !d ) return null;
  return new Promise((resolve) => {
    try { const tx = d.transaction("bakes", mode), r = fn(tx.objectStore("bakes")); tx.oncomplete = () => resolve(r?.result ?? null); tx.onerror = tx.onabort = () => resolve(null); }
    catch { resolve(null); }
  });
};
const cacheGet = (key) => idb("readonly", (s) => s.get(key));
async function cachePut(key, res) {
  await idb("readwrite", (s) => s.put({ key, box: res.box, ms: res.ms, frames: res.frames.map((f) => f.slice()), at: Date.now() }));
  const all = await idb("readonly", (s) => s.getAllKeys());
  if ( all && all.length > KEEP * 1.25 ) {
    const recs = await idb("readonly", (s) => s.getAll());
    const old = (recs ?? []).sort((a, b) => a.at - b.at).slice(0, recs.length - KEEP);
    await idb("readwrite", (s) => { for ( const o of old ) s.delete(o.key); return null; });
  }
}

/**
 * READ AHEAD (canvasInit, while Foundry still loads the scene's textures): every loop the scene's `flood` flag names, by its key - all
 * from IndexedDB in ONE transaction, and the ones not there downloaded at once (their chunks go through the codec pool together with the
 * damage chunks, which net/preload.mjs reads ahead at the same moment). A hole then finds its loop waiting when the damage is in.
 * Only ever a cache: load() still checks the key the hole computes itself, so nothing here decides what is shown.
 */
let ahead = new Map();               // key -> Promise<{ box, ms, frames } | null>
function readAhead(scene) {
  ahead = new Map();
  const recs = Object.values(scene?.flags?.[MODULE_ID]?.[FLAG]?.baked ?? {}).filter((r) => r?.key);
  if ( OFF || !recs.length ) return;
  markOnce("flood:ahead", { n: recs.length });
  const got = idb("readonly", (s) => { const reqs = recs.map((r) => [r.key, s.get(r.key)]); return { get result() { return reqs; } }; });
  for ( const rec of recs ) {
    ahead.set(rec.key, got.then(async (reqs) => {
      const hit = reqs?.find(([k]) => k === rec.key)?.[1]?.result;
      if ( hit?.frames?.length ) { stats.cached++; return hit; }
      const res = await fetchBake(rec);
      if ( res ) { stats.fetched++; cachePut(rec.key, res); }
      return res;
    }).catch(() => null));
  }
  Promise.all(ahead.values()).then(() => markOnce("flood:aheadDone"));
}

/* ================================================================ the look */

/** The scene water's settings as stored (the same on every client: the key must be). Null without painted water. */
const sceneWaterParams = () => { const f = canvas.scene?.flags?.[MODULE_ID]?.water; return f?.px && f.enabled !== false ? f.params ?? {} : null; };

/** Colours and opacities to paint with: the painted water's (live, while the GM edits), else the scene's flood colours, else forest. */
function paintLook() {
  const S = Water.state(), wp = S?.enabled ? S.params : null;
  const colors = wp?.colors?.length === 6 ? wp.colors : flagOf().colors?.length === 6 ? flagOf().colors : mapColors ?? FALLBACK;
  const alpha = wp?.alpha ?? {};
  lookSig = lookSigOf(colors, alpha);
  return { colors, alpha, kit: FC.paintKit(buildLut(winfo?.codes ?? CODES, colors, alpha), colors, overall(alpha)) };
}
let look = null, lookSig = "";
/** What the painted look is made from (colours, opacities, code table): tells a water change that repaints the holes from one that does not. */
const lookSigOf = (colors, alpha) => JSON.stringify([colors, alpha, winfo?.codes?.length ?? 0]);
const wantedLookSig = () => {
  const S = Water.state(), wp = S?.enabled ? S.params : null;
  return lookSigOf(wp?.colors?.length === 6 ? wp.colors : flagOf().colors?.length === 6 ? flagOf().colors : mapColors ?? FALLBACK, wp?.alpha ?? {});
};
const kit = () => (look ??= paintLook()).kit;

/* ================================================================ one area */

/** The pixels of an atlas frame of a destruction group (its BufferResource keeps them). */
function framePixels(g, frame) {
  const data = g.tex?.resource?.data, W = g.tex?.width;
  if ( !data || !frame || !W ) return null;
  const out = new Uint8Array(frame.width * frame.height * 4);
  for ( let y = 0; y < frame.height; y++ ) out.set(data.subarray(((frame.y + y) * W + frame.x) * 4, ((frame.y + y) * W + frame.x + frame.width) * 4), y * frame.width * 4);
  return out;
}

/** An area's cover (torn outline), open pixels and levels, cover-local: everything the water reads, from this area alone. */
function readArea(g) {
  const cf = g.coverFrame; if ( !cf?.tex?.frame ) return null;
  const fr = cf.tex.frame, cw = fr.width, ch = fr.height, cx = cf.x, cy = cf.y, N = cw * ch;
  const cov = framePixels(g, fr), baseFr = (g.anim?.rev?.frame ?? g.baseTex ?? g.baseSpr?.texture)?.frame;
  const base = g.anim?.rev?.data ?? framePixels(g, baseFr);
  if ( !cov || !base ) return null;
  const info = g.info, bw = info.w, bh = info.h;
  const cover = new Uint8Array(N), open = new Uint8Array(N), level = new Uint8Array(N);
  const S = D.state(), ob = S?.objects?.[g.objIndex]?.id === g.objId ? S.objects[g.objIndex] : S?.objects?.find((o) => o.id === g.objId);
  const bytes = ob ? Model.objBytes(ob) : null, K = Model.K;
  const lvAt = (ax, ay) => {
    if ( !bytes ) return 2;
    const mx = Math.floor(ax / K) - ob.x0, my = Math.floor(ay / K) - ob.y0;
    let best = 0;
    for ( let r = 0; r <= 2 && !best; r++ ) for ( let dy = -r; dy <= r; dy++ ) for ( let dx = -r; dx <= r; dx++ ) {
      const X = mx + dx, Y = my + dy; if ( X < 0 || Y < 0 || X >= ob.w || Y >= ob.h ) continue;
      best = Math.max(best, bytes[Y * ob.w + X] & 3);
    }
    return best || 2;
  };
  for ( let y = 0; y < ch; y++ ) for ( let x = 0; x < cw; x++ ) {
    const i = y * cw + x; if ( !cov[i * 4 + 3] ) continue;
    cover[i] = 1;
    const bx = cx + x - info.x, by = cy + y - info.y;
    if ( bx >= 0 && by >= 0 && bx < bw && by < bh && base[(by * bw + bx) * 4 + 3] ) open[i] = 1;
    // over a deeper hole painted before it (a pit, a crater) the water is deeper there: the bake carries that level in the cover's
    // green (substrate.mjs finishOverSubstrate: 255 - 40 x level; the cover's mask reads red and alpha only)
    const g = cov[i * 4 + 1], deeper = g < 255 ? Math.min(3, Math.round((255 - g) / 40)) : 0;
    level[i] = Math.max(lvAt(cx + x, cy + y), deeper);
  }
  return { cx, cy, cw, ch, cover, open, level, seed: g.hash % 99991, ratio: gridRatio() };
}

/**
 * Art pixels per water pixel. With painted water on the scene: the painted water's own grid (its px), so beside it a hole's water has
 * the same pixel size on the same grid and the two read as one body; without: FC.SCALE (16 water pixels per grid square).
 */
function gridRatio() {
  const S = Water.state(), ap = D.state()?.ap ?? D.destructionApi.display?.()?.ap ?? 1;
  return S?.px && S.enabled && WaterModel.hasPaint(S) ? Math.max(1, S.px / ap) : FC.SCALE;
}

function makeEntry(g) {
  const e = { g, hash: g.hash, prep: null, key: "", bakeParams: null, res: null, tex: [], fillTex: null, fillBuf: null, sprite: null,
    anim: null, fillAt: null, fillDur: 0, readyAt: 0, step: -1, state: "new", my: life };
  const t0 = performance.now();
  stats.made = (stats.made ?? 0) + 1;
  const A = readArea(g);
  const t1 = performance.now();
  e.prep = A ? FC.prepareFlood(A) : null;
  stats.readMs = (stats.readMs ?? 0) + t1 - t0; stats.prepMs = (stats.prepMs ?? 0) + performance.now() - t1;
  if ( !e.prep ) {
    // the area's pixels are not there yet (a cold player: atlas freed, shell not hydrated): ask for them and read again later
    // (sync / the timer), instead of leaving the hole dry for the whole session
    e.state = "dry"; e.tries = 0; stats.dry = (stats.dry ?? 0) + 1;
    askPixels(g); armDry(e);
    return e;
  }
  attachPrep(e, g);
  return e;
}

/** Asks the display for an area's pixels (its shell hydrated / atlas rebuilt: display.pixelsSlice). */
function askPixels(g) {
  const disp = D.destructionApi.display?.();
  if ( !disp?.pixelSource || g.dead || !(g.shell || g.atlasFree) ) return;
  (disp.pixelAsks ??= new Set()).add(g);
}

/** The next read of a dry hole: after the backoff, or earlier from sync (a hook of the destruction). */
function armDry(e) {
  clearTimeout(e.dryTimer);
  const d = FC.dryDelay(e.tries);
  if ( d === null ) { e.state = "none"; stats.dryGaveUp = (stats.dryGaveUp ?? 0) + 1; return; }
  if ( e.tries === FC.DRY_TRIES ) stats.drySlow = (stats.drySlow ?? 0) + 1;     // (past the quick tries: one every DRY_SLOW ms, never given up)
  e.dryTimer = setTimeout(() => { if ( e.state === "dry" && !e.dead && entries.get(e.hash) === e ) retryDry(e); }, d);
}

function retryDry(e, soft = false) {
  if ( e.state !== "dry" || e.dead ) return;
  const g = e.g; clearTimeout(e.dryTimer);
  // (the shell was swapped for its area - a new group of the same hash: sync lets this entry go and makes the hole again; nothing else may
  // call sync once a fill has put the area in, so ask for it here, or the hole stays dry for ever)
  if ( g.dead || g.cont?.destroyed ) { scheduleSync(); return; }
  e.lastTry = performance.now();
  const A = readArea(g);
  if ( !A ) { if ( soft ) armDry(e); else { e.tries++; askPixels(g); armDry(e); } return; }
  e.prep = FC.prepareFlood(A);
  stats.dryRecovered = (stats.dryRecovered ?? 0) + 1;
  e.state = "new";
  attachPrep(e, g);
  load(e);
  wetChanged();
}

function attachPrep(e, g) {
  const sp = new PIXI.Sprite(PIXI.Texture.EMPTY);
  sp.eventMode = "none";
  const ap = D.destructionApi.display()?.ap ?? 1, o = D.destructionApi.display()?.origin ?? { x: 0, y: 0 };
  sp.position.set(o.x + e.prep.cx * ap, o.y + e.prep.cy * ap); sp.scale.set(ap);
  g.cont.addChild(sp);     // over the ruin and its plates, in the area's own place among the strokes
  e.sprite = sp;
  // the loop cross-faded like the painted water ('Smooth water animation'): a mixing quad in the sprite's place, shown instead of it
  const mx = new LoopMix(); mx.visible = false; mx.position.copyFrom(sp.position); mx.scale.set(ap);
  g.cont.addChild(mx); e.mix = mx;
  e.ap = ap;
  keyOf(e);
  // the area is entering now: the water follows the break
  if ( g.anim ) noteAnim(e, g.anim);
}

/** A hole's entry moved into a new group of the same area (true), or false when it must be made again. */
function rebind(e, g) {
  if ( e.dead || e.state === "none" || !e.prep || g.hash !== e.hash || !g.cont || g.cont.destroyed ) return false;
  if ( e.tex.some((q) => q.t.baseTexture?.destroyed) ) return false;
  const ap = D.destructionApi.display()?.ap ?? 1;
  if ( ap !== e.ap ) return false;
  for ( const k of ["sprite", "mix"] ) {
    const o = e[k];
    if ( o && !o.destroyed ) { o.parent?.removeChild(o); g.cont.addChild(o); continue; }
    if ( k === "sprite" ) {
      const sp = new PIXI.Sprite(PIXI.Texture.EMPTY), at = D.destructionApi.display()?.origin ?? { x: 0, y: 0 };
      sp.eventMode = "none"; sp.position.set(at.x + e.prep.cx * ap, at.y + e.prep.cy * ap); sp.scale.set(ap);
      g.cont.addChild(sp); e.sprite = sp;
    } else {
      const mx = new LoopMix(); mx.visible = false; mx.position.copyFrom(e.sprite.position); mx.scale.set(ap);
      g.cont.addChild(mx); e.mix = mx;
    }
  }
  e.g = g;
  stats.rebound = (stats.rebound ?? 0) + 1;
  return true;
}

function keyOf(e) {
  const wp = sceneWaterParams();
  e.keyParams = FC.floodParams(wp ?? { style: "defaults" }, e.prep, e.hash);
  e.key = FC.floodKey(e.hash, e.keyParams);
  return e.key;
}

function noteAnim(e, a) {
  e.anim = a;
  e.fillAt = a.start + (a.delay ?? 0) + (a.reveal ?? 600) * 0.45;
  e.fillDur = Math.min(2600, 1000 + (e.prep?.R ?? 0) * 18) * (a.k ?? 1);
  e.step = -1; e.job = null;
}

/* ================================================================ loading, baking */

async function load(e) {
  if ( e.state !== "new" && e.state !== "stale" ) return;
  e.state = "loading";
  const my = life, key = e.key;
  try {
    // read ahead at canvasInit (one transaction, downloads started then), else this hole's own look in the cache
    let res = ahead.has(key) ? await ahead.get(key) : null;
    if ( !res ) { res = await cacheGet(key); if ( res ) stats.cached++; }
    if ( !res ) {
      const rec = flagOf().baked?.[hkey(e.hash)];
      if ( rec?.key === key ) { res = await fetchBake(rec); if ( res ) { stats.fetched++; cachePut(key, res); } }
    }
    if ( my !== life || e.key !== key || e.dead ) return;
    if ( !res && !game.user.isGM && game.users.activeGM && !e.waited ) {
      // the GM's client bakes and uploads it: wait for that (an update of the flag looks again sooner)
      e.state = "stale"; e.waited = true;
      e.waitTimer = setTimeout(() => { if ( e.state === "stale" && !e.dead ) load(e); }, AWAIT_PUBLISH);
      return;
    }
    if ( !res ) res = await bake(e);
    if ( my !== life || e.key !== key || e.dead ) return;
    if ( !res ) { e.state = "none"; return; }
    await show(e, res, my);
  } catch ( err ) {
    if ( my !== life ) return;
    console.warn(`${MODULE_ID} | flooded hole`, err);
    e.state = "none";
  }
}

async function bake(e) {
  const P = e.prep, n = P.eng.w * P.eng.h;
  if ( n > MAX_PIXELS ) { console.warn(`${MODULE_ID} | flooded hole too big for its own water (${P.eng.w} x ${P.eng.h})`); return null; }
  const t = now();
  const info = await engine();
  const wp = sceneWaterParams();
  // the look as the key names it, with the engine's defaults filled in (a scene without painted water: the defaults)
  const params = { ...info.defaults, ...e.keyParams };
  if ( !wp ) delete params.style;
  const res = await post({ type: "bakeFlood", W: P.eng.w, H: P.eng.h, mask: P.eng.mask, params });
  releaseEngine();
  if ( !res?.frames?.length ) return null;
  stats.bakes++; stats.bakeMs = Math.round(now() - t);
  cachePut(e.key, res);
  if ( game.user.isGM ) schedulePublish();
  return res;
}

/** The frames on the GPU: one texture per frame, painted at art resolution and clipped to the hole. */
async function show(e, res, my = life) {
  freeTextures(e);
  e.res = res;
  paintAll(e);
  // a scene being opened (its one reveal still held back): the frames go to the GPU now, a slice at a time, so the reveal never pays
  // for them in one frame; "ready" only then (the damage waits for its holes, destruction.mjs prepareReveal)
  if ( Reveal.holding() ) { await Reveal.upload(e.tex.map((q) => q.t.baseTexture), 8); if ( my !== life || e.dead ) return; }
  e.state = "ready"; e.readyAt = now();
  if ( [...entries.values()].every((q) => q.state === "ready" || q.state === "none" || q.state === "dry") ) markOnce("flood:ready", { holes: entries.size });
  // the water comes later than the break (a bake, a download): it still wells up if that is not long after
  if ( e.fillAt !== null ) {
    if ( e.readyAt - e.fillAt > ENTRY_WINDOW ) e.fillAt = null;
    else e.fillAt = Math.max(e.fillAt, e.readyAt);
  }
  wetChanged();
}

function texture(buf, w, h) {
  const bt = new PIXI.BaseTexture(new PIXI.BufferResource(buf, { width: w, height: h }), {
    width: w, height: h, scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.ON, alphaMode: PIXI.ALPHA_MODES.UNPACK,
    format: PIXI.FORMATS.RGBA, type: PIXI.TYPES.UNSIGNED_BYTE, wrapMode: PIXI.WRAP_MODES.CLAMP });
  return new PIXI.Texture(bt);
}

function paintAll(e) {
  if ( !e.res ) return;
  const P = e.prep, k = kit();
  if ( !e.tex.length ) e.tex = e.res.frames.map(() => { const b = new Uint8Array(P.cw * P.ch * 4); return { buf: b, t: texture(b, P.cw, P.ch) }; });
  e.res.frames.forEach((f, i) => {
    const q = e.tex[i];
    FC.paintFlood(P, f, e.res.box, k, 2, new Uint8ClampedArray(q.buf.buffer));
    q.t.baseTexture.update();
  });
  e.step = -1; e.job = null;
}

/**
 * PERF: a new look (colours, opacities) repaints every hole; all at once that was ~250-480 ms in one frame, again every 120 ms while a
 * slider is dragged. Queued instead: the holes repaint a few ms a frame (FILL_MS), a hole restarts when it is asked again.
 */
const repaintQ = new Map();
let repaintFn = null;
function repaintLater(e) {
  if ( !e.res ) return;
  repaintQ.set(e, 0);
  if ( !repaintFn && canvas.app?.ticker ) { repaintFn = () => repaintStep(); canvas.app.ticker.add(repaintFn); }
}
function repaintStep() {
  const t0 = performance.now(), k = kit();
  for ( const [e, i0] of repaintQ ) {
    if ( e.dead || !e.res || !e.prep ) { repaintQ.delete(e); continue; }
    const P = e.prep, n = e.res.frames.length;
    if ( !e.tex.length ) e.tex = e.res.frames.map(() => { const b = new Uint8Array(P.cw * P.ch * 4); return { buf: b, t: texture(b, P.cw, P.ch) }; });
    let i = i0;
    for ( ; i < n; ) {
      const q = e.tex[i];
      FC.paintFlood(P, e.res.frames[i], e.res.box, k, 2, new Uint8ClampedArray(q.buf.buffer));
      q.t.baseTexture.update();
      i++;
      if ( performance.now() - t0 >= FILL_MS ) break;
    }
    if ( i >= n ) { e.step = -1; repaintQ.delete(e); } else repaintQ.set(e, i);
    if ( performance.now() - t0 >= FILL_MS ) break;
  }
  if ( !repaintQ.size && repaintFn ) { canvas.app?.ticker?.remove(repaintFn); repaintFn = null; }
}

function freeTextures(e) {
  for ( const q of e.tex ) q.t.destroy(true);
  e.tex = [];
  e.fillTex?.destroy(true); e.fillTex = null; e.fillBuf = null; e.stage = null; e.job = null;
}

function freeEntry(e) {
  e.dead = true;
  clearTimeout(e.waitTimer); clearTimeout(e.dryTimer);
  freeTextures(e);
  if ( e.sprite && !e.sprite.destroyed ) e.sprite.destroy();
  if ( e.mix && !e.mix.destroyed ) e.mix.destroy();
  e.sprite = null; e.mix = null;
}

/* ================================================================ following the destruction display */

function scheduleSync() {
  if ( syncTimer ) return;
  syncTimer = setTimeout(() => { syncTimer = 0; sync(); }, 0);
}

function sync() {
  const disp = D.destructionApi.display?.();
  if ( !canvas.ready || !disp ) { if ( entries.size ) clearAll(); return; }
  let changed = false, more = false;
  const t0 = performance.now();
  const live = new Set(), dying = new Set(disp.dying);     // the hashes of the flood groups the display lists now; the groups fading out
  for ( const g of disp.order ) {
    if ( g.info?.type !== "flood" || g.dead ) continue;
    live.add(g.hash);
    let e = entries.get(g.hash);
    // the same area (same hash) in a new group - a load swapping the composite's shells for their areas: the hole keeps what it
    // made (its prepared area, its loop and textures) and only moves into the new group; made again it cost ~240 ms per load
    if ( e && e.g !== g && !rebind(e, g) ) { freeEntry(e); entries.delete(g.hash); e = null; }
    else if ( e?.state === "dry" && performance.now() - (e.lastTry ?? 0) >= 100 ) retryDry(e, true);     // (a destruction hook: the pixels may be in now)
    if ( !e ) {
      // a few holes per frame (reading the area and preparing it is ~2-10 ms a hole, 16-21 ms for a scene's holes at once and
      // over 100 ms under load): past SYNC_MS the rest are made at the next frames
      if ( performance.now() - t0 > SYNC_MS ) { more = true; continue; }
      e = makeEntry(g); entries.set(g.hash, e); changed = true;
      if ( e.state === "new" ) load(e);
    }
  }
  if ( more ) canvas.app.ticker.addOnce(() => sync());
  for ( const [h, e] of entries ) {
    // (also a hole whose group left the display's order and has finished fading out: it is stashed in the display's spare list, neither
    // dead nor listed - a warm swap that replaced an area left one such entry, 27 holes for 26 groups, its sprite and textures kept until the
    // stash was emptied, i.e. for ever. A fading group (dying) keeps its water until it is gone: the water fades with it)
    if ( e.g.dead || e.g.cont?.destroyed || (!live.has(h) && !dying.has(e.g)) ) { freeEntry(e); entries.delete(h); changed = true; }
    // (its sprite went with something else while its area stays: made again at the next sync)
    else if ( e.state !== "none" && e.state !== "dry" && (!e.sprite || e.sprite.destroyed) ) { freeEntry(e); entries.delete(h); changed = true; scheduleSync(); }
  }
  stats.entries = entries.size;
  if ( entries.size ) markOnce("flood:listed", { holes: entries.size, ms: Math.round(performance.now() - t0) });
  if ( entries.size && !tickFn ) { tickFn = () => tick(); canvas.app.ticker.add(tickFn); }
  if ( changed ) wetChanged();
}

const SLICE_PX = 16000;          // a hole of at least this many art pixels is painted in bands of rows (tick)
const FILL_MS = 4;                // per frame for repainting the filling holes (tick)
/** Is the hole in the view (a hole out of it does not repaint its fill step)? */
function fillSeen(e, v) {
  const r = e.g.info?.rect;
  return !v || !r || !(r.x0 > v.x1 || r.y0 > v.y1 || r.x1 < v.x0 || r.y1 < v.y0);
}

function tick() {
  const t0 = now();
  let gone = false;
  const smooth = smoothWater();             // (a settings read builds a setting document: once a frame, not once a hole)
  const fill = { n: 0, ms: 0, on: !globalThis.CONFIG?.moinenMaps?.noFloodBudget, vw: null };
  if ( fill.on ) fill.vw = D.destructionApi.display?.()?.view?.() ?? null;
  for ( const [h, e] of entries ) {
    const g = e.g;
    // (its group gone: the next sync moves the hole into the area's new group - rebind - or lets it go)
    if ( (e.state === "none" || e.state === "dry") && !g.dead ) continue;    // (an area without water: nothing to draw)
    if ( g.dead || g.cont?.destroyed || !e.sprite || e.sprite.destroyed ) { gone = true; continue; }
    // (its group finished fading out and was stashed, off the scene: the next sync lets the hole go - nothing else would, the group is not dead)
    if ( !g.cont.parent && D.destructionApi.display?.()?.groups.get(e.hash) !== g ) { gone = true; continue; }
    if ( g.anim && g.anim !== e.anim && e.prep ) noteAnim(e, g.anim);      // a detonation replays the break: the water too
    if ( e.mix?.visible ) { e.mix.visible = false; e.sprite.visible = true; }    // (shown again below only at rest)
    if ( !e.tex.length || !g.cont.parent ) { if ( e.sprite ) e.sprite.texture = PIXI.Texture.EMPTY; continue; }
    const n = e.tex.length, ms = Math.max(20, e.res.ms ?? 90);
    // the loop stands still exactly when the painted water's does (the OS setting), so the two never part
    const idx = n < 2 || REDUCED_OS?.matches ? 0 : Math.floor(t0 / ms) % n;
    if ( e.fillAt !== null ) {
      const el = t0 - e.fillAt;
      if ( el < 0 ) { e.sprite.texture = PIXI.Texture.EMPTY; continue; }
      if ( reducedMotion() ) {
        e.sprite.alpha = Math.min(1, el / 300);
        e.sprite.texture = e.tex[idx].t;
        if ( el >= 300 ) { e.fillAt = null; e.sprite.alpha = 1; }
        continue;
      }
      const u = el / e.fillDur;
      if ( u >= 1 + FC.BAND ) { e.fillAt = null; }
      else {
        const step = Math.floor(el / STEP_MS);
        // PERF: every hole of a Detonate repaints on the same step boundary (a whole-scene fill: ~25-40 ms in one frame, every STEP_MS).
        // A frame repaints holes only up to FILL_MS (at least one); the rest keep the picture of their last step and repaint in the
        // next frames (a step shown a frame or two late); a hole out of the view waits until it is seen again.
        const P = e.prep, big = fill.on && P.cw * P.ch >= SLICE_PX && !globalThis.CONFIG?.moinenMaps?.noFloodSlice;
        if ( big && (e.job || step !== e.step) && !((fill.n && fill.ms >= FILL_MS) || (!e.job && !fillSeen(e, fill.vw))) ) {
          // PERF: a big hole (28k-82k px: 10-14 ms in one frame) is painted a band of rows at a time into a staging buffer, within what is
          // left of the frame's FILL_MS, and shown whole when the last band is in (the picture of one step, a few frames late; the same pixels)
          if ( !e.fillTex ) { e.fillBuf = new Uint8Array(P.cw * P.ch * 4); e.fillTex = texture(e.fillBuf, P.cw, P.ch); }
          const tp = now();
          const J = e.job ??= { step, idx, u: Math.floor(el / STEP_MS) * STEP_MS / e.fillDur, y: 0, buf: (e.stage ??= new Uint8Array(P.cw * P.ch * 4)) };
          const out = new Uint8ClampedArray(J.buf.buffer), rows = Math.max(4, Math.round(SLICE_PX / P.cw / 8));
          do { const y1 = Math.min(P.ch, J.y + rows); FC.paintFlood(P, e.res.frames[J.idx], e.res.box, kit(), J.u, out, J.y, y1); J.y = y1; }
          while ( J.y < P.ch && fill.ms + now() - tp < FILL_MS );
          if ( J.y >= P.ch ) { e.fillBuf.set(J.buf); e.fillTex.baseTexture.update(); e.step = J.step; e.job = null; }
          fill.n++; fill.ms += now() - tp;
        } else if ( !big && step !== e.step && !(fill.on && ((fill.n && fill.ms >= FILL_MS) || !fillSeen(e, fill.vw))) ) {
          if ( !e.fillTex ) { e.fillBuf = new Uint8Array(P.cw * P.ch * 4); e.fillTex = texture(e.fillBuf, P.cw, P.ch); }
          const tp = now();
          FC.paintFlood(P, e.res.frames[idx], e.res.box, kit(), Math.floor(el / STEP_MS) * STEP_MS / e.fillDur, new Uint8ClampedArray(e.fillBuf.buffer));
          e.fillTex.baseTexture.update();
          e.step = step; fill.n++; fill.ms += now() - tp;
        }
        e.sprite.texture = e.fillTex ?? PIXI.Texture.EMPTY;
        continue;
      }
    }
    e.sprite.alpha = 1;
    e.sprite.texture = e.tex[idx].t;
    // at rest: the loop cross-faded (the same frame time, frame index and mix as the painted water, so the two stay in step)
    const tk = canvas.app.ticker, [i0, j0, m] = n < 2 || REDUCED_OS?.matches ? [idx, idx, 0] : loopMix(tk.lastTime ? tk.lastTime + (tk.elapsedMS || 0) : t0, ms, n, smooth);
    const blend = m > 0.002 && e.mix;
    if ( blend ) { const a = e.tex[i0].t, b = e.tex[j0].t; e.sprite.texture = a; e.mix.set(a, b, m, a.width, a.height); }
    else if ( i0 !== idx ) e.sprite.texture = e.tex[i0].t;
    if ( e.mix ) e.mix.visible = !!blend;
    e.sprite.visible = !blend;
  }
  // a hole's area replaced under it (a load swaps the groups, e.g. a settled composite hydrating): look for the new ones; before,
  // the holes stayed dry until the next destruction change
  if ( gone ) { wetChanged(); scheduleSync(); }
  stats.frameMs = Math.round((now() - t0) * 1000) / 1000;
  stats.fillN = fill.n; stats.fillMs = Math.round(fill.ms * 100) / 100;
}

function clearAll() {
  for ( const e of entries.values() ) freeEntry(e);
  entries.clear(); repaintQ.clear();
  if ( repaintFn ) { canvas.app?.ticker?.remove(repaintFn); repaintFn = null; }
  if ( tickFn ) canvas.app?.ticker?.remove(tickFn);
  tickFn = null;
  wetChanged();
}

/** The scene water's look or colours changed: repaint every hole; bake again those whose look (key) changed. */
function onWater(kind) {
  if ( kind !== "params" && kind !== "loaded" ) return;
  clearTimeout(repaintTimer);
  repaintTimer = setTimeout(() => {
    // PERF: every water save and upload (a flag update) lands here; the holes are repainted (~250 ms, a freeze after every stroke of
    // the GM's water) only when the colours or opacities really changed
    const lookSame = look !== null && wantedLookSig() === lookSig;
    if ( !lookSame ) look = null;
    const ratio = gridRatio();
    let regrid = false;
    for ( const [h, e] of entries ) {
      // the painted water came, went or changed its pixel size: the hole is made again on the new grid
      const want = e.prep?.level >= 2 ? ratio : FC.SCALE;
      if ( e.prep && Math.abs(e.prep.ratio - want) > 1e-6 ) { freeEntry(e); entries.delete(h); regrid = true; }
    }
    if ( regrid ) scheduleSync();
    for ( const e of entries.values() ) {
      if ( !e.prep || e.dead ) continue;
      const before = e.key;
      if ( keyOf(e) !== before ) { e.state = "stale"; e.waited = false; load(e); }
      else if ( !lookSame ) repaintLater(e);
    }
  }, 120);
}

function onUpdateScene(scene, changed) {
  if ( scene.id !== canvas.scene?.id ) return;
  const f = changed.flags?.[MODULE_ID];
  if ( !f ) return;
  if ( FLAG in f || `-=${FLAG}` in f ) {
    if ( f[FLAG]?.colors ) { look = null; for ( const e of entries.values() ) paintAll(e); }
    // a player waiting for the GM's upload: it is there now
    for ( const e of entries.values() ) if ( e.state === "stale" && e.waited && flagOf().baked?.[hkey(e.hash)]?.key === e.key ) { clearTimeout(e.waitTimer); load(e); }
  }
  if ( "water" in f || "-=water" in f ) onWater("loaded");
}

/* ================================================================ publishing (GM) */

function schedulePublish(ms = 1500) {
  clearTimeout(publishTimer);
  publishTimer = setTimeout(publish, Math.max(ms, publishBackoff));
}

async function publish() {
  publishTimer = 0;
  const scene = canvas.scene, my = life;
  if ( !game.user.isGM || !scene || !(game.users.activeGM?.isSelf ?? true) ) return;
  const baked = flagOf().baked ?? {}, upd = {};
  try {
    await ensureMapColors(upd);
    for ( const e of entries.values() ) {
      if ( e.state !== "ready" || !e.res || baked[hkey(e.hash)]?.key === e.key ) continue;
      const rec = await publishBake(scene.id, e.key, e.res, `flood-${scene.id}-${hkey(e.hash)}`);
      if ( my !== life ) return;
      upd[`flags.${MODULE_ID}.${FLAG}.baked.${hkey(e.hash)}`] = rec;
    }
    // records of holes that are gone (the display knows every area of the scene)
    const shown = new Set([...entries.keys()].map(hkey));
    for ( const h of Object.keys(baked) ) if ( !shown.has(h) ) addDeletion(upd, `flags.${MODULE_ID}.${FLAG}.baked.${h}`);
    if ( Object.keys(upd).length ) await scene.update(upd);
    publishBackoff = 0;
  } catch ( err ) {
    publishBackoff = Math.min(8 * 60000, publishBackoff ? publishBackoff * 2 : 15000);
    console.warn(`${MODULE_ID} | could not publish the flooded holes' water (next try in ${publishBackoff / 1000} s)`, err);
    if ( publishBackoff === 15000 ) ui.notifications.warn(game.i18n.localize("MOINENMAPS.Flood.publishFailed"));
    if ( my === life ) schedulePublish(publishBackoff);
  }
}

/**
 * No painted water on the scene: the holes' colours from the map, once (GM): its average colour pulled into a muddy blue, made into
 * six colours by the engine's palette maker, stored in the flag for everyone.
 */
async function ensureMapColors(upd) {
  if ( sceneWaterParams() || flagOf().colors?.length === 6 ) return;
  const S = D.state(); if ( !S ) return;
  const f = Math.max(1, Math.ceil(Math.max(S.aw, S.ah) / 64)), w = Math.ceil(S.aw / f), h = Math.ceil(S.ah / f);
  let px; try { px = mapPixels(S.ap * f, { x0: 0, y0: 0, w, h }); } catch { return; }
  let r = 0, g = 0, b = 0, n = 0;
  for ( let i = 0; i < px.length; i += 4 ) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
  if ( !n ) return;
  // a clear blue-green, a touch of the map's own colour (a muddy blue read as dirty paint)
  const water = [44, 112, 126], k = 0.16, mix = [r / n, g / n, b / n].map((v, i) => Math.round(water[i] * (1 - k) + v * k));
  const hex = mix.map((v) => v.toString(16).padStart(2, "0")).join("");
  await engine();
  const cols = await post({ type: "palette", hex, hue: 12, sat: 18, range: 100 });
  releaseEngine();
  if ( Array.isArray(cols) && cols.length === 6 ) {
    upd[`flags.${MODULE_ID}.${FLAG}.colors`] = cols;
    // shown here at once (the flag follows with the upload)
    mapColors = cols; look = null;
    for ( const e of entries.values() ) paintAll(e);
  }
}
let mapColors = null;

/* ================================================================ water for the tokens (scripts/water/wet.mjs) */

const coverCache = new WeakMap();
/** Is the art pixel covered by a stroke made after `idx` (a later area's outline, or a later erase stroke)? */
function coveredLater(disp, idx, ax, ay) {
  for ( const g of disp.order ) {
    if ( !(g.objIndex > idx) ) continue;
    const r = g.info.rect; if ( ax < r.x0 || ay < r.y0 || ax >= r.x1 || ay >= r.y1 ) continue;
    const cf = g.coverFrame; if ( !cf?.tex?.frame ) continue;
    let c = coverCache.get(g);
    if ( !c ) { c = framePixels(g, cf.tex.frame); if ( !c ) continue; coverCache.set(g, c); }
    const x = ax - cf.x, y = ay - cf.y, fw = cf.tex.frame.width;
    if ( x >= 0 && y >= 0 && x < fw && y < cf.tex.frame.height && c[(y * fw + x) * 4 + 3] ) return true;
  }
  const S = D.state();
  for ( const er of disp.erasers?.values?.() ?? [] ) {
    if ( !(er.objIndex > idx) ) continue;
    const ob = S?.objects?.find((o) => o.id === er.id); if ( !ob ) continue;
    const mx = Math.floor(ax / Model.K) - ob.x0, my = Math.floor(ay / Model.K) - ob.y0;
    if ( mx >= 0 && my >= 0 && mx < ob.w && my < ob.h && Model.objBytes(ob)[my * ob.w + mx] ) return true;
  }
  return false;
}

const provider = {
  active: () => { for ( const e of entries.values() ) if ( e.state === "ready" ) return true; return false; },
  at(x, y) {
    const disp = D.destructionApi.display?.(); if ( !disp ) return null;
    const r = Model.sceneRect(), ap = disp.ap, ax = Math.floor((x - r.x) / ap), ay = Math.floor((y - r.y) / ap);
    let best = null;
    for ( const e of entries.values() ) {
      if ( e.state !== "ready" || !e.g.cont?.parent ) continue;
      // still coming in (the break, then the rising water): no water for the tokens before it has half filled the hole
      if ( e.fillAt !== null && now() < e.fillAt + e.fillDur * 0.5 ) continue;
      const d = FC.waterAt(e.prep, ax - e.prep.cx, ay - e.prep.cy);
      if ( d < 0 || (best && best.idx > e.g.objIndex) ) continue;
      if ( coveredLater(disp, e.g.objIndex, ax, ay) ) continue;
      // the token effects draw on the hole's water grid (its pixels), like on painted water
      best = { idx: e.g.objIndex, px: ap * e.prep.ratio, colors: look?.colors ?? paintLook().colors, depth: d, level: e.prep.level };
    }
    return best;
  },
  regions() {
    const out = [], disp = D.destructionApi.display?.(), r = Model.sceneRect(), ap = disp?.ap ?? 1;
    for ( const e of entries.values() ) if ( e.state === "ready" && e.g.cont?.parent ) out.push({ x: r.x + e.prep.cx * ap, y: r.y + e.prep.cy * ap, px: ap, w: e.prep.cw, h: e.prep.ch, a: e.prep.water });
    return out;
  }
};

/* ================================================================ lifecycle, API */

function teardown() {
  life++;
  clearTimeout(syncTimer); clearTimeout(publishTimer); clearTimeout(repaintTimer); syncTimer = publishTimer = repaintTimer = 0;
  publishBackoff = 0; look = null; mapColors = null;
  clearAll();
  disposeEngine();
}

export const floodApi = {
  /** Every flooded hole: its state, level, size, key; plus bake and frame timings. */
  status: () => ({ ...stats, holes: [...entries.values()].map((e) => ({ hash: hkey(e.hash), state: e.state, level: e.prep?.level ?? 0, w: e.prep?.cw ?? 0, h: e.prep?.ch ?? 0,
    eng: e.prep ? `${e.prep.eng.w}x${e.prep.eng.h}` : "", key: e.key, frames: e.tex.length, filling: e.fillAt !== null })) }),
  /** The water at a scene point ({ depth, level, px, colors } or null). */
  at: (x, y) => provider.at(x, y),
  /** Bake every hole here again (ignores the browser cache and the published files). */
  rebake: async () => { for ( const e of entries.values() ) if ( e.prep ) { e.state = "baking"; const res = await bake(e); if ( res ) show(e, res); } },
  /** Let the water well up again in every hole. */
  replay: () => { for ( const e of entries.values() ) if ( e.prep ) { e.fillAt = now(); e.fillDur = Math.min(2600, 1000 + e.prep.R * 18); e.step = -1; e.job = null; } },
  /** The pixels of one frame of a hole (debugging, filmstrips). */
  frame: (hash, i = 0, u = 2) => { const e = [...entries.values()].find((q) => hkey(q.hash) === hash) ?? [...entries.values()][0]; if ( !e?.res ) return null;
    return { w: e.prep.cw, h: e.prep.ch, x: e.prep.cx, y: e.prep.cy, rgba: FC.paintFlood(e.prep, e.res.frames[i % e.res.frames.length], e.res.box, kit(), u) }; },
  entries: () => entries
};

export function registerFlood() {
  if ( OFF ) return;
  addWet(provider);
  Hooks.on("moinenMapsDestruction", scheduleSync);
  Hooks.on("moinenMapsWater", onWater);
  Hooks.on("updateScene", onUpdateScene);
  Hooks.on("canvasTearDown", teardown);
  Hooks.on("canvasInit", () => readAhead(canvas.scene));
  // while a scene's reveal is held back, look for new flooded areas every 25 ms: the damage goes on screen (hidden) without a hook of
  // its own, and the reveal waits for the holes (without this they were listed only at the next "status", after the reveal)
  Hooks.on("canvasReady", () => {
    const my = life, until = performance.now() + 4000;
    const poll = () => { if ( my !== life || !Reveal.holding() || performance.now() > until ) return; sync(); setTimeout(poll, 25); };
    setTimeout(poll, 0);
  });
  D.destructionApi.flood = floodApi;
  window.addEventListener("beforeunload", disposeEngine);
}
