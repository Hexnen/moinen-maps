// zones/themes.mjs washes: a bounded path size per draw call on any zone size. Offline, a mock 2D canvas:   node dev/zones-wash-bound.test.mjs
// Regression for the sengoku (brush) wash freezing a big map (2026-11-09): its gold lobes and dust were filled as ONE path of arcs per
// zone, and Skia rasterises one path superlinearly in its size (Electron 146: 8k arcs 47 ms, 16k arcs 980 ms; a zone with an ~800k px
// border baked for 304 s at grid 40 and 706 s at grid 25). fillArcs() now caps a path at ARC_CHUNK arcs; this checks every theme's
// wash on a huge zone keeps every fill/stroke within the bound, that the number of draw calls only grows linearly, and that a
// translucent split fill is unioned at full alpha on a scratch layer (overlaps blend once, as in one path).
import assert from "node:assert/strict";

const calls = [];
class Path2D {
  constructor() { this.arcs = 0; this.segs = 0; }
  moveTo() {} lineTo() { this.segs++; } closePath() {} arc() { this.arcs++; } rect() { this.segs += 4; } ellipse() { this.arcs++; }
  quadraticCurveTo() { this.segs++; } bezierCurveTo() { this.segs++; } addPath() {}
}
function mockCtx(canvas) {
  const st = { arcs: 0, segs: 0 };
  const grad = () => ({ addColorStop() {} });
  const rec = (op, p) => calls.push({ op, ctx: canvas.id, arcs: p ? p.arcs : st.arcs, segs: p ? p.segs : st.segs, alpha: ctx.globalAlpha });
  const ctx = {
    canvas, globalAlpha: 1, globalCompositeOperation: "source-over",
    beginPath() { st.arcs = 0; st.segs = 0; },
    moveTo() {}, closePath() {},
    lineTo() { st.segs++; }, quadraticCurveTo() { st.segs++; }, bezierCurveTo() { st.segs++; }, rect() { st.segs += 4; },
    arc() { st.arcs++; }, ellipse() { st.arcs++; }, arcTo() { st.segs++; },
    fill(p) { rec("fill", p instanceof Path2D ? p : null); },
    stroke(p) { rec("stroke", p instanceof Path2D ? p : null); },
    drawImage(src) { calls.push({ op: "drawImage", ctx: canvas.id, src: src.id, alpha: ctx.globalAlpha }); },
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    measureText: () => ({ width: 10 }),
    createLinearGradient: grad, createRadialGradient: grad, createConicGradient: grad, createPattern: () => ({})
  };
  return new Proxy(ctx, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
}
let ids = 0;
globalThis.Path2D = Path2D;
globalThis.document = { createElement: () => { const cv = { id: ++ids, width: 300, height: 150 }; cv.getContext = () => (cv.ctx ??= mockCtx(cv)); return cv; } };
globalThis.PIXI = { LINE_CAP: {}, LINE_JOIN: {} };

const { THEMES, bakeWash, fillArcs, ARC_CHUNK } = await import("../scripts/zones/themes.mjs");

// one huge zone: a wavy ring of radius R (amplitude amp, f waves round it)
function bigZone(R, amp, f, n) {
  const r = [];
  for ( let i = 0; i < n; i++ ) { const a = (i / n) * Math.PI * 2, rr = R + amp * Math.sin(a * f); r.push(8000 + Math.cos(a) * rr, 8000 + Math.sin(a) * rr); }
  return { zones: [{ id: "z1", parts: [[r]] }], core: [r.concat(r.slice(0, 2))] };
}
const border = (Z) => { const r = Z.zones[0].parts[0][0]; let L = 0; for ( let i = 0; i < r.length; i += 2 ) { const j = (i + 2) % r.length; L += Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1]); } return L; };

const LINE_MAX = 16000;   // lines per path: superlinear in Skia beyond ~16k (32k: 255 ms); the washes stay well under it
function bake(Z, theme, look, g) {
  calls.length = 0;
  for ( const W of [THEMES[theme].wash].flat() ) bakeWash(Z, W, () => 0x808080, { fill: 0.3, ink: 1, ...look }, g);
  return calls.slice();
}

// 1. every theme's wash, a big zone (the measured pathological one: ~800k px border) at grid 40 and 25, ink 1 and 0.6
const Zbig = bigZone(7000, 400, 500, 10668);
assert.ok(border(Zbig) > 500000, `the test zone has a huge border (${Math.round(border(Zbig))} px)`);
const themes = Object.keys(THEMES).filter((t) => THEMES[t].wash);
assert.ok(themes.includes("brush"), "the sengoku theme has a wash");
for ( const theme of themes ) for ( const g of [40, 25] ) for ( const ink of [1, 0.6] ) {
  const C = bake(Zbig, theme, { ink }, g);
  for ( const c of C ) if ( c.op !== "drawImage" ) {
    assert.ok(c.arcs <= ARC_CHUNK, `${theme} g${g} ink${ink}: ${c.arcs} arcs in one ${c.op} (max ${ARC_CHUNK})`);
    assert.ok(c.segs <= LINE_MAX, `${theme} g${g} ink${ink}: ${c.segs} segments in one ${c.op} (max ${LINE_MAX})`);
  }
}

// 2. the brush wash really has tens of thousands of arcs on this zone (so the bound above is exercised), split into linear chunks
const C40 = bake(Zbig, "brush", { ink: 1 }, 40), C25 = bake(Zbig, "brush", { ink: 1 }, 25);
const arcs = (C) => C.reduce((s, c) => s + (c.arcs ?? 0), 0), fills = (C) => C.filter((c) => c.op === "fill" && c.arcs > 0).length;
assert.ok(arcs(C40) > 4 * ARC_CHUNK, `brush g40 draws ${arcs(C40)} arcs`);
assert.ok(fills(C40) <= Math.ceil(arcs(C40) / ARC_CHUNK) + 6, `brush g40: ${fills(C40)} fills for ${arcs(C40)} arcs (linear)`);
assert.ok(fills(C25) <= Math.ceil(arcs(C25) / ARC_CHUNK) + 6, `brush g25: ${fills(C25)} fills for ${arcs(C25)} arcs (linear)`);

// 3. translucent and split: chunks unioned at alpha 1 on a scratch canvas, laid on once with the alpha
{
  const cv = document.createElement("canvas"); cv.width = 400; cv.height = 300;
  const c = cv.getContext("2d"), A = Array.from({ length: 3 * ARC_CHUNK + 7 }, (_, i) => [i % 400, i % 300, 3]);
  calls.length = 0; fillArcs(c, A, 1, "#fff", 0.6);
  const onTarget = calls.filter((x) => x.ctx === cv.id), onScratch = calls.filter((x) => x.ctx !== cv.id);
  assert.deepEqual(onTarget.map((x) => [x.op, x.alpha]), [["drawImage", 0.6]], "the target gets ONE composite at the fill's alpha");
  assert.equal(onScratch.length, 4, "4 chunk fills on the scratch layer");
  assert.ok(onScratch.every((x) => x.op === "fill" && x.alpha === 1 && x.arcs <= ARC_CHUNK), "scratch chunks at alpha 1");
  // opaque: straight onto the target, chunked
  calls.length = 0; fillArcs(c, A, 0, "#fff", 1);
  assert.ok(calls.length === 4 && calls.every((x) => x.ctx === cv.id && x.op === "fill"), "opaque split fill goes straight to the target");
  // fits one chunk: one path, exactly as before (no scratch), whatever the alpha
  calls.length = 0; fillArcs(c, A.slice(0, ARC_CHUNK), 0, "#fff", 0.6);
  assert.deepEqual(calls.map((x) => [x.op, x.ctx, x.arcs, x.alpha]), [["fill", cv.id, ARC_CHUNK, 0.6]], "a small fill is one path on the target");
}

// 4. a normal map (zones whose lobes fit one chunk) draws the brush exactly as one path per blob, like before
{
  const Z = bigZone(600, 30, 8, 400);
  const C = bake(Z, "brush", { ink: 0.8 }, 50);
  assert.ok(!C.some((x) => x.op === "drawImage" && x.alpha === 0.8), "no scratch composite on a normal zone");
  assert.equal(C.filter((x) => x.op === "fill" && x.arcs > 0).length, 3, "outline, leaf and dust: one fill each");
}
console.log(`zones-wash-bound: ${themes.length} themes' washes bounded (<= ${ARC_CHUNK} arcs, <= ${LINE_MAX} segments per draw call) on a ${Math.round(border(Zbig))} px border`);
