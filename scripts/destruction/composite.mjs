import { MODULE_ID } from "../config.mjs";
import { put } from "../flag-diff.mjs";
import * as Net from "../net/stream.mjs";
import * as Trace from "../net/trace.mjs";

/**
 * SETTLED COMPOSITE (PERF: data, memory, load time). The static cache (static-cache.mjs) draws everything that does not move into
 * BANDS of render textures. Once a scene is settled, the active GM's client publishes those bands as they are - their texels read back
 * unchanged (premultiplied RGBA), cut in the cache's own tiles, content-addressed chunks (chunks.mjs kind 3) - with a small INDEX (kind
 * 4: every area's description, every stroke's areas, every band's members). A client opening the scene then shows the bands from
 * those tiles at once and builds every stroke the composite holds as a SHELL: an area with its description and an empty container,
 * no pixels, no atlas, no GPU texture of its own. A stroke's own chunk is only fetched when its pixels are needed:
 *   - an area that must be drawn live or into a band the composite does not have (an entry over it, a dissolve, a drawing without
 *     the cache): the cache asks (display.needPixels) and keeps its previous band meanwhile;
 *   - a flooded hole (its water reads its cover and base), a glowing cause light in a dark scene, the dark scene's rim light;
 *   - a bake over it (its plain look), a publish, an undo or any change that is not a new stroke on top (destruction.mjs);
 *   - Detonate (every area enters again).
 * A NEW stroke on top of the composite needs nothing else: the band that grew is drawn from the composite's texels plus the new
 * stroke (static-cache "delta"), exact. The composite is replaced by the GM when the strokes changed; a tile whose content did not
 * change keeps its id (and file).
 *
 * FORMAT: flag `destructionComposite` { v: 2, tv: TILE_VERSION, dir, t: [ids: GC], base (the bake's base key), idx, bands: [{ key,
 * L, eff, smp, mips, rect, tiles: [[x, y, w, h, id]] }] } - `tv` is the composite's own format version, apart from the bake version
 * (a tile format change never re-bakes anything). Off: client setting "destrComposite", or `CONFIG.moinenMaps.noComposite = true`.
 */
export const TILE_VERSION = 6;          // 5: bands culled under the bands above (2-4 were test versions); 6: strokes' chunk ids in the index
export const KEY = "destructionComposite";

export const enabled = () => {
  if ( globalThis.CONFIG?.moinenMaps?.noComposite ) return false;
  try { return game.settings.get(MODULE_ID, "destrComposite") !== false; } catch { return true; }
};

export function registerSetting() {
  Hooks.once("init", () => game.settings.register(MODULE_ID, "destrComposite", {
    name: "MOINENMAPS.Destr.compositeSetting", hint: "MOINENMAPS.Destr.compositeSettingHint", scope: "client", config: true, type: Boolean, default: true
  }));
}

/** The scene's composite manifest, or null. */
export function manifestOf(scene) {
  const c = scene?.flags?.[MODULE_ID]?.[KEY];
  return c?.v === 2 && c.tv === TILE_VERSION && typeof c.dir === "string" && typeof c.idx === "string" && Array.isArray(c.bands) && Array.isArray(c.t) ? c : null;
}

/* ---------------------------------------------------------------- a client: the composite's textures */

/** A tile's texels as a texture, exactly as they were read (premultiplied: no conversion on upload), sampled like a band. */
function textureOf(t) {
  const bt = new PIXI.BaseTexture(new PIXI.BufferResource(t.data, { width: t.w, height: t.h }), {
    width: t.w, height: t.h, resolution: t.res, scaleMode: PIXI.SCALE_MODES.LINEAR, mipmap: PIXI.MIPMAP_MODES.ON,
    alphaMode: PIXI.ALPHA_MODES.PMA, format: PIXI.FORMATS.RGBA, type: PIXI.TYPES.UNSIGNED_BYTE, wrapMode: PIXI.WRAP_MODES.CLAMP
  });
  return new PIXI.Texture(bt);
}

export class Composite {
  /** `m` the manifest, `index` the decoded index, `tiles` Map(id -> decoded tile). */
  constructor(m, index, tiles) {
    this.m = m; this.index = index; this.bands = new Map(); this.list = []; this.nearest = new Set();
    const members = new Map((index.bands ?? []).map((b) => [b.key, b.hashes]));
    for ( const b of m.bands ) {
      const ent = { key: b.key, L: b.L, eff: b.eff, smp: b.smp, mips: !!b.mips, rect: b.rect, hashes: members.get(b.key) ?? [],
        tiles: b.tiles.map(([x, y, w, h, id]) => ({ x, y, w, h, id, tex: textureOf(tiles.get(id)) })) };
      this.bands.set(b.key, ent); this.list.push(ent);
    }
    this.px = this.list.reduce((a, b) => a + b.tiles.reduce((q, t) => q + t.tex.baseTexture.realWidth * t.tex.baseTexture.realHeight, 0), 0);
  }

  /**
   * The bands of the drawing the cache is about to make ([{ L, key, hashes }]). A composite band is ALIVE while a band of the drawing is it
   * or grew from it; it may be used only while every composite band above it is alive (its texels hidden by theirs were cleared when it
   * was published: CULLING, see publish).
   */
  plan(list) {
    const alive = new Set();
    for ( const b of this.list ) {
      if ( list.some((q) => q.L === b.L && (q.key === b.key || (b.hashes.length && b.hashes.length < q.hashes.length && b.hashes.every((h, i) => q.hashes[i] === h)))) ) alive.add(b.key);
    }
    this.valid = new Set(this.list.filter((b) => this.list.every((u) => u.L <= b.L || alive.has(u.key))).map((b) => b.key));
  }

  /** The tiles of a band the cache is about to draw (`p` its plan: the same box), or null. */
  band(key, p) {
    const b = this.bands.get(key);
    if ( !b || (this.valid && !this.valid.has(key)) || b.rect[0] !== p.x0 || b.rect[1] !== p.y0 || b.rect[2] !== p.x1 || b.rect[3] !== p.y1 ) return null;
    if ( b.tiles.some((t) => t.tex.baseTexture.destroyed) ) return null;
    return b.tiles;
  }

  /**
   * A band that GREW: its first members are the members of a composite band of the same level (and every shell among them), the rest
   * are full areas. -> { n (members drawn by the composite), under(tx, ty, tw, th): its texels as sprites for that tile } or null.
   */
  prefix(L, eff, smp, mips, hashes, shells) {
    let best = null;
    for ( const b of this.list ) {
      if ( b.L !== L || b.eff !== eff || b.smp !== smp || b.mips !== !!mips || (this.valid && !this.valid.has(b.key)) ) continue;
      const n = b.hashes.length;
      if ( !n || n >= hashes.length || (best && best.hashes.length >= n) ) continue;
      let ok = true;
      for ( let i = 0; i < n && ok; i++ ) ok = b.hashes[i] === hashes[i];
      if ( !ok || shells.some((g) => hashes.indexOf(g.hash) >= n) ) continue;
      best = b;
    }
    if ( !best ) return null;
    const c = this._under ??= new PIXI.Container();
    return {
      n: best.hashes.length,
      under: (tx, ty, tw, th) => {
        for ( const s of c.removeChildren() ) s.destroy();
        for ( const t of best.tiles ) {
          if ( t.x >= tx + tw || t.x + t.w <= tx || t.y >= ty + th || t.y + t.h <= ty ) continue;
          // texel for texel (NEAREST at 1:1), restored after the band's drawing (restore)
          if ( t.tex.baseTexture.scaleMode !== PIXI.SCALE_MODES.NEAREST ) { t.tex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST; this.nearest.add(t.tex.baseTexture); }
          const s = new PIXI.Sprite(t.tex); s.position.set(t.x, t.y); c.addChild(s);
        }
        return c;
      }
    };
  }

  /**
   * Areas the composite's bands do NOT hold although it describes them: they were drawn live when it was published (a glowing cause light).
   * A shell of such an area is a live unit here too, or the bands of its level would not match the composite's (its hash would be among
   * their members) and the cache would ask for the pixels of every shell of them. Lazily, a Set of hashes.
   */
  get liveHashes() {
    if ( this._live ) return this._live;
    const inBand = new Set(); for ( const b of this.list ) for ( const h of b.hashes ) inBand.add(h);
    this._live = new Set(Object.keys(this.index.areas ?? {}).map(Number).filter((h) => !inBand.has(h)));
    return this._live;
  }

  restore() { for ( const bt of this.nearest ) bt.scaleMode = PIXI.SCALE_MODES.LINEAR; this.nearest.clear(); }

  /** The base textures of the composite (an upload ahead of the reveal). */
  textures() { return this.list.flatMap((b) => b.tiles.map((t) => t.tex.baseTexture)); }

  destroy() {
    if ( this._under ) { for ( const s of this._under.removeChildren() ) s.destroy(); this._under.destroy(); }
    for ( const b of this.list ) for ( const t of b.tiles ) t.tex.destroy(true);
    this.list = []; this.bands.clear();
  }
}

/** Download and decode a composite (index and tiles, a few requests at the front of the queue). -> Composite, or null. */
export async function load(m) {
  const t0 = performance.now();
  const ids = m.t.filter((id) => id !== m.idx);
  const [ix, ...ts] = await Promise.all([m.idx, ...ids].map((id) => Net.getChunk(m.dir, id, { prio: -1 }).catch(() => null)));
  if ( !ix?.index || ts.some((t) => !t?.tile) ) { Trace.event("composite-unusable", { index: !!ix?.index, tiles: ts.filter((t) => t?.tile).length, of: ts.length }); return null; }
  const tiles = new Map(ids.map((id, k) => [id, ts[k].tile]));
  const c = new Composite(m, ix.index, tiles);
  Trace.markOnce("composite:loaded", { tiles: ids.length, ms: Math.round(performance.now() - t0), mpx: Math.round(c.px / 1e5) / 10 });
  return c;
}

/* ---------------------------------------------------------------- shells */

/** An area shown from the composite only: its description (`a`, from the index), an empty container, no pixels. */
export function buildShell(d, a) {
  const cont = new PIXI.Container(), baseCont = new PIXI.Container(), shardCont = new PIXI.Container();
  cont.eventMode = baseCont.eventMode = shardCont.eventMode = "none";
  cont.addChild(baseCont, shardCont);
  const [x0, y0, x1, y1] = a.rect;
  const info = { hash: a.h, x: a.x, y: a.y, w: a.w, h: a.hh, ex: a.ex, ey: a.ey, R: a.R, type: a.type, mat: a.mat, cause: a.cause, axis: a.axis, len: a.len,
    rect: { x0, y0, x1, y1 }, water: !!a.wt, light: !!a.l };
  // (a tiny texture of its own where the display expects an atlas: sampling switches, a kill)
  const tex = PIXI.Texture.fromBuffer(new Uint8Array(4), 1, 1).baseTexture;
  return { shell: true, hash: a.h, tex, info, cont, baseCont, shardCont, baseSpr: null, baseTex: null, pieces: [], made: 0, frame: null,
    coverFrame: null, patch: null, anim: null, fade: null, next: 0, reused: true, light: null, objIndex: a.index ?? 0, objId: a.obj ?? null };
}

/* ---------------------------------------------------------------- the GM: publishing */

/** Read a band tile's texels back exactly (premultiplied RGBA, the render texture's own rows). */
function readTile(R, rt) {
  const gl = R.gl, bt = rt.baseTexture, w = bt.realWidth, h = bt.realHeight, out = new Uint8Array(w * h * 4);
  R.renderTexture.bind(rt);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
  R.renderTexture.bind(null);
  return { w, h, data: out };
}

/**
 * SETTLED (pure; tests): null when the cache's drawing of the layer is final - drawn scene-wide for what is there now (not dirty, no band
 * waiting for a shell's pixels), nothing moving but the flooded holes' water, nothing fading out, every hole's water in, every band's
 * tiles valid - else why not.
 */
export function unsettled({ mode, dirty, waiting, moving = 0, dying = 0, holes = [], bands = [] }) {
  if ( !String(mode).startsWith("scene") || dirty || waiting ) return `cache-not-settled:${mode}${dirty ? ",dirty" : ""}${waiting ? ",waiting" : ""}`;
  if ( moving || dying ) return `moving:${moving}${dying ? `,dying ${dying}` : ""}`;
  if ( holes.some((s) => s !== "ready" && s !== "none") ) return "water-not-ready";
  if ( !bands.length || bands.some((b) => !b.meta || !b.ok) ) return "bands";
  return null;
}

/**
 * Publish the composite of what is on screen (GM): only when the layer is settled (nothing moving but the flooded holes' water, every
 * hole's water in, no band waiting for pixels) and the scene-wide bands are drawn at a whole texel density. `ctx`: { scene, dir, base,
 * strokes: [{ id, sig }] } in order. -> "published" | "same" | a reason it was not.
 */
export async function publish(d, ctx) {
  const C = d?.cache, R = canvas.app?.renderer;
  if ( !C || !R?.gl || !d.groups.size ) return "no-display";
  // SETTLED, deterministically: the cache drawn for what is on screen now. A tab in the background has no ticker (requestAnimationFrame
  // stops): one frame is driven here (fades and swaps run on the clock, the cache re-draws what changed), then it is checked
  if ( C.dirty || !String(C.mode).startsWith("scene") || document.visibilityState === "hidden" ) { try { d.tick(); } catch { /* torn down */ } }
  const U = C.units(), bands = C.bands.filter((b) => b.ckey && b.tiles.length);
  const why = unsettled({ mode: C.mode, dirty: C.dirty, waiting: C.waiting, moving: U.filter((u) => u.live && !u.water && !u.gl).length,       // (a glowing cause light is live at rest: its area is drawn live over the bands, a client's shell of it is live too, see liveHashes)
     dying: d.dying.length,
    holes: (D.flood?.status?.()?.holes ?? []).map((h) => h.state), bands: bands.map((b) => ({ meta: !!b.meta, ok: b.tiles.every((t) => t.shared || (t.rt.valid && !t.rt.baseTexture.destroyed)) })) });
  if ( why ) return why;
  const tStart = performance.now();
  const old = manifestOf(ctx.scene), oldBands = new Map((old?.dir === ctx.dir && old.base === ctx.base ? old.bands : []).map((b) => [b.key, b]));
  // the index: every area (its description and whether its hole has water), every stroke's areas, every band's members
  const areas = {}, byObj = new Map();
  for ( const g of d.order ) {
    const i = g.info, r = i.rect, wt = g.info.water || g.cont.children.some((c) => c !== g.patch && c !== g.baseCont && c !== g.shardCont);
    areas[g.hash] = { h: g.hash, x: i.x, y: i.y, w: i.w, hh: i.h, ex: i.ex, ey: i.ey, R: i.R, type: i.type, mat: i.mat, cause: i.cause, axis: i.axis, len: i.len,
      rect: [r.x0, r.y0, r.x1, r.y1], wt: wt ? 1 : 0, l: g.light || g.info.light ? 1 : 0 };
    if ( g.objId ) { if ( !byObj.has(g.objId) ) byObj.set(g.objId, []); byObj.get(g.objId).push(g.hash); }
  }
  const strokes = {};
  for ( const s of ctx.strokes ) strokes[s.id] = { sig: s.sig, ...(s.cid ? { cid: s.cid } : {}), hashes: byObj.get(s.id) ?? [] };
  const index = { v: 1, base: ctx.base, areas, strokes, bands: bands.map((b) => ({ key: b.ckey, hashes: b.hashes })) };
  // the tiles: a band drawn from the composite keeps its ids, any other is read back
  const out = [], todo = [], all = [];
  for ( const b of bands ) {
    const ent = { key: b.ckey, ...b.meta, tiles: [] };
    out.push(ent);
    for ( const t of b.tiles ) {
      // (a tile drawn from the composite is the composite's own file)
      if ( t.shared && t.id && !ctx.fresh ) { ent.tiles.push([t.x, t.y, t.w, t.h, t.id]); const bt = t.rt.baseTexture; all.push({ L: b.meta.L, x: t.x, y: t.y, w: bt.realWidth, h: bt.realHeight, data: bt.resource?.data ?? null }); continue; }
      const px = readTile(R, t.rt), row = [t.x, t.y, t.w, t.h, null];
      ent.tiles.push(row);
      const tile = { L: b.meta.L, x: t.x, y: t.y, w: px.w, h: px.h, res: b.meta.eff, data: px.data };
      todo.push({ row, tile }); all.push(tile);
    }
  }
  // (the cull runs in the codec worker with the packing: the page only reads the texels back and hands them over)
  const doCull = bands.every((b) => b.meta.eff === 1) && all.every((q) => q.data);
  const hide = doCull ? all.filter((q) => !todo.some((u) => u.tile === q)) : [];
  const t0 = performance.now();
  const pending = Net.job({ kind: "tiles", tiles: todo.map((q) => q.tile), hide, cull: doCull, index, known: [...Net.known(ctx.dir)] }, todo.map((q) => q.tile.data.buffer));
  const posted = performance.now(), res = await pending;
  if ( ctx.dry ) return { dry: true, pageMs: Math.round((posted - tStart) * 10) / 10, jobMs: Math.round((performance.now() - t0) * 10) / 10, cleared: res.cleared, tiles: todo.length, bands: bands.length };
  todo.forEach((q, k) => { q.row[4] = res.tiles[k].id; });
  const ids = [res.index.id, ...new Set(out.flatMap((b) => b.tiles.map((t) => t[4])))];
  const m = { v: 2, tv: TILE_VERSION, dir: ctx.dir, base: ctx.base, idx: res.index.id, t: ids, bands: out, at: Date.now() };
  if ( old && old.idx === m.idx && old.dir === m.dir && JSON.stringify(old.bands) === JSON.stringify(m.bands) ) return "same";
  const up = [res.index, ...res.tiles].filter((c) => c.bytes);
  await Net.upload(ctx.dir, up.map((c) => ({ id: c.id, bytes: c.bytes })));
  for ( const c of up ) Net.keep(c.id, c.bytes);
  await ctx.scene.update(put({}, `flags.${MODULE_ID}.${KEY}`, ctx.scene.flags?.[MODULE_ID]?.[KEY], m));
  Trace.event("composite-published", { bands: out.length, tiles: ids.length - 1, uploaded: up.length, bytes: up.reduce((a, c) => a + c.bytes.length, 0), ms: Math.round(performance.now() - t0) });
  return "published";
}

// (the culling itself - cull, MARGIN - lives in net/chunks.mjs: it runs in the codec worker, see publish)
export { cull, MARGIN } from "../net/chunks.mjs";

/** The destruction module's API object (flood status), set by destruction.mjs (no import cycle). */
export const D = { flood: null };
