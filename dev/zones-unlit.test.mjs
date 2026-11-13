// Zones C1 + C13: the highlights, their labels and the passages' marks lie above the scene's light, under the tokens and the fog
// (scripts/zones/unlit.mjs) - a stand-in PIXI and canvas.   node dev/zones-unlit.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };

/* ---- a stand-in PIXI: containers, sprites, an affine matrix */
class Matrix {
  constructor(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0) { Object.assign(this, { a, b, c, d, tx, ty }); }
  clone() { return new Matrix(this.a, this.b, this.c, this.d, this.tx, this.ty); }
  invert() { const { a, b, c, d, tx, ty } = this, n = a * d - b * c; Object.assign(this, { a: d / n, b: -b / n, c: -c / n, d: a / n, tx: (c * ty - d * tx) / n, ty: -(a * ty - b * tx) / n }); return this; }
  append(m) { const { a, b, c, d } = this; Object.assign(this, { a: m.a * a + m.b * c, b: m.a * b + m.b * d, c: m.c * a + m.d * c, d: m.c * b + m.d * d, tx: m.tx * a + m.ty * c + this.tx, ty: m.tx * b + m.ty * d + this.ty }); return this; }
}
const drawn = [];
class Container {
  constructor() { this.children = []; this.visible = true; this.renderable = true; this.alpha = 1; this.destroyed = false; this.parent = null; this.worldTransform = new Matrix(); this.zIndex = 0; }
  addChild(...c) { for ( const x of c ) { x.parent?.removeChild(x); x.parent = this; this.children.push(x); } return c[0]; }
  removeChild(c) { const i = this.children.indexOf(c); if ( i >= 0 ) { this.children.splice(i, 1); c.parent = null; } return c; }
  removeChildren() { const c = this.children; this.children = []; for ( const x of c ) x.parent = null; return c; }
  destroy(o) { this.destroyed = true; this.parent?.removeChild(this); if ( o?.children ) for ( const c of [...this.children] ) c.destroy(o); }
  updateTransform() {}
  render(r) { if ( !this.visible ) return; drawn.push(this); for ( const c of this.children ) c.render(r); }
}
class Sprite extends Container {
  constructor(tex) { super(); this.texture = tex; this.anchor = { x: 0, y: 0, copyFrom(p) { this.x = p.x; this.y = p.y; } }; this.blendMode = 0; this.transform = { setFromMatrix: (m) => { this.local = m; } }; }
}
class AlphaFilter { constructor(a) { this.alpha = a; this.resolution = 1; } }
globalThis.PIXI = { Container, Sprite, AlphaFilter, Texture: { EMPTY: { valid: false } }, BLEND_MODES: { NORMAL: 0, ERASE: 26 }, MSAA_QUALITY: { NONE: 0 } };
const hooks = new Map();
globalThis.Hooks = { on: (n, f) => { (hooks.get(n) ?? hooks.set(n, []).get(n)).push(f); return f; }, callAll: (n, ...a) => { for ( const f of hooks.get(n) ?? [] ) f(...a); } };

const U = await imp("scripts/zones/unlit.mjs");

/* ---- no effects group (an older core, the other tests): a part goes where it was */
globalThis.canvas = { app: { renderer: { screen: { w: 1 }, multisample: 4 } }, tokens: { placeables: [] } };
let fellBack = null;
const part0 = new Container();
check(U.attach(part0, U.Z.highlights, (o) => { fellBack = o; }) === false && fellBack === part0 && U.hostOf() === null, "no effects group: the part goes to its old place, nothing is made");

/* ---- with one: at the end of the effects group, after the light */
const effects = new Container(), light = effects.addChild(new Container());
canvas.effects = effects;
const hl = new Container(), lab = new Container(), pass = new Container();
check(U.attach(hl, U.Z.highlights, () => { throw new Error("no"); }) && U.attach(lab, U.Z.labels) && U.attach(pass, U.Z.passages), "with an effects group every part goes above the light");
const host = U.hostOf();
check(effects.children.at(-1) === host && effects.children[0] === light && host.content.sortableChildren === true && hl.zIndex < lab.zIndex && pass.zIndex < hl.zIndex && U.isUnlit(hl) && U.isUnlit(pass),
  "one container after the light (so it is not lit, and the fog drawn later covers it); passages under highlights under labels");
check(host.filters.length === 1 && host.filters[0].resolution === null && host.filters[0].multisample === 4 && host.filterArea === canvas.app.renderer.screen, "drawn apart in one pass at the renderer's resolution and anti-aliasing");

/* ---- the tokens are cut out of it */
const mesh = (tx, ty, o = {}) => ({ visible: true, renderable: true, destroyed: false, worldAlpha: 1, texture: { valid: true, id: tx }, anchor: { x: 0.5, y: 0.5 }, worldTransform: new Matrix(2, 0, 0, 2, tx, ty), ...o });
const tok = (m, vis = true) => ({ visible: vis, mesh: m });
canvas.tokens.placeables = [tok(mesh(100, 50)), tok(mesh(300, 50), false), tok(mesh(500, 50, { worldAlpha: 0.5 })), tok(mesh(700, 50, { visible: false })), tok(null)];
host.worldTransform = new Matrix(2, 0, 0, 2, 10, 20);                     // the stage's pan and zoom
for ( const p of [hl, lab, pass] ) p.visible = false;
drawn.length = 0;
host.render({});
check(drawn.length === 0 && host.pool.length === 0, "nothing of ours shows: no pass, no cut (it costs nothing)");
hl.visible = true;
host.render({});
const cut = host.pool.filter((s) => s.visible);
check(cut.length === 2 && cut.every((s) => s.blendMode === PIXI.BLEND_MODES.ERASE) && cut[0].texture.id === 100 && cut[1].texture.id === 500 && cut[1].alpha === 0.5 && cut[0].anchor.x === 0.5,
  "every token this user sees is erased from it with its own picture and opacity (a hidden or unseen one is not)");
// the eraser's place on the host is the mesh's place on the screen taken back through the host's own transform
const L = cut[0].local;
check(Math.abs(L.a - 1) < 1e-9 && Math.abs(L.d - 1) < 1e-9 && Math.abs(L.tx - 45) < 1e-9 && Math.abs(L.ty - 15) < 1e-9, "the cut lies exactly on the token (its screen place through the host's transform)");
check(drawn.includes(host.content) && drawn.includes(host.cut) && drawn.indexOf(host.cut) > drawn.indexOf(host.content), "the parts are drawn, then the tokens cut out of them");
canvas.tokens.placeables = [tok(mesh(100, 50))];
host.render({});
check(host.pool.filter((s) => s.visible).length === 1 && host.pool.length === 2, "a token gone: its eraser hides (kept for reuse)");

/* ---- a new scene: the container goes, the parts stay their owners' */
Hooks.callAll("canvasTearDown");
check(U.hostOf() === null && host.destroyed && !hl.destroyed && !lab.destroyed && hl.parent === null && !effects.children.includes(host), "torn down with the canvas; the parts are left to their owners");
const again = new Container();
check(U.attach(again, U.Z.labels) && U.hostOf() !== host && effects.children.at(-1) === U.hostOf(), "the next scene makes a new one");

console.log(failed ? `\n${failed} FAILED` : "\nall ok");
process.exit(failed ? 1 : 0);
