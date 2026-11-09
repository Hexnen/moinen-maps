// The fire's art pass as two programs (art.mjs ART_F + ART_S added on top), offline:   node dev/fire-art-split.test.mjs
// Why two: on a program-cache miss D3D11's compiler (FXC) linked the one art program in 10-20 s (2026-11-09, 3070 Ti: 13.3 s) and the
// fire showed that much later after every shader update; its cost grows much faster than the code, the halves link in parallel.
// The sum is the one program's cell only while (1) ART_F never writes B or A's bits 3..6 and ART_S never writes R or G, and (2) the
// look tables (select functions now: ANGLE made each const array a per-pixel indexable temp) and the packed blue-noise ranks hold the
// same values. The live check (link times on a cache miss, pixel A/B against the one program) is dev/fire-art-link-run.mjs.
import assert from "node:assert/strict";

class Stub {}
globalThis.PIXI = new Proxy({ Program: { from: (vertexSrc, fragmentSrc, name) => ({ vertexSrc, fragmentSrc, name }) } }, { get: (o, k) => o[k] ?? Stub });
const art = await import("../scripts/fire/art.mjs");
const { VC16 } = await import("../scripts/fire/look.mjs");
const progs = art.artPrograms();
const F = progs.find((p) => p.name.startsWith("moinen-maps-fire-art-v")), S = progs.find((p) => p.name.startsWith("moinen-maps-fire-art-smoke"));
assert.ok(F && S, "the two art programs are in artPrograms (so the pre-warm links both)");
const mainOf = (src) => src.slice(src.indexOf("void main()")).replace("int R = 0, G = 0, B = 0, A = 0;", "");   // (the declaration is no write)
const fm = mainOf(F.fragmentSrc), sm = mainOf(S.fragmentSrc);

// 1. who writes what (assignments to the cell's channels; == is a test)
const writes = (src, ch) => [...src.matchAll(new RegExp(`(?<![\\w.])${ch}\\s*([-+*/|&^]?=)(?!=)`, "g"))].map((m) => src.slice(m.index, src.indexOf(";", m.index)));
assert.deepEqual(writes(fm, "B"), [], "ART_F writes no B");
assert.deepEqual(writes(sm, "R").concat(writes(sm, "G")), [], "ART_S writes no R or G");
for ( const w of writes(fm, "A") ) assert.match(w, /^A \+= (lv|4|dOut < 0\.4 \* crp \* rag \? 2 : 1)$/, `ART_F's A writes are the ground bits only: ${w}`);
for ( const w of writes(sm, "A") ) assert.match(w, /^A (\+= 32 \*|= \(A & 103\) \+ 8 \*)/, `ART_S's A writes are the night / shadow bits only: ${w}`);
assert.ok(!/\bsmk\b/.test(fm) && /if \( fld\.g == 0\.0 \) discard;/.test(sm), "the smoke lives in ART_S only, gated on the puff mask");
assert.match(sm, /if \( B == 0 && A == 0 \) discard;\s*\n\s*oArt = /, "ART_S adds nothing where it drew nothing");

// 2. the look tables: the select functions give the arrays' values (ANGLE clamps an out-of-range index: so do they)
const T = {
  L_DENS: [0.0, 2.5, 6.0, 9.0], L_R: [0.0, 3.6, 5.0, 7.0], L_RISE: [0.0, 10.0, 22.0, 40.0], L_LIFE: [0.0, 0.9, 0.85, 0.8],
  L_EMB: [0.0, 0.28, 0.45, 0.6], L_COAL: [0.0, 0.3, 0.5, 0.7], SPK_S: [7.0, 10.0, 18.0, 11.0], SPK_V: [34.0, 20.0, 15.0, 10.0],
  SPK_L: [1.0, 1.8, 1.4, 0.45], SPK_H: [0.7, 0.4, 0.3, 0.0],
  SPK_D: [0.0, 0.08, 0.34, 0.7, 0.0, 0.07, 0.28, 0.55, 0.0, 0.04, 0.16, 0.34, 0.0, 0.08, 0.18, 0.3],
  L_TINT: [0.0, 0.2, 0.3, 0.4], S_RATE: [0.0, 6.0, 6.0, 9.0], S_R0: [0.0, 4.0, 6.0, 8.0], S_R1: [0.0, 11.0, 17.0, 21.0],
  S_LIFE: [0.0, 2.4, 3.6, 4.6], S_V0: [0.0, 16.0, 20.0, 24.0]
};
for ( const src of [F.fragmentSrc, S.fragmentSrc] ) for ( const [name, vals] of Object.entries(T) ) {
  const m = src.match(new RegExp(`float ${name}\\(int i\\) \\{ return (.*?); \\}`));
  assert.ok(m, `${name} is a select function`);
  const fn = new Function("i", `return ${m[1]};`);
  for ( let i = -2; i < vals.length + 2; i++ ) assert.equal(fn(i), vals[Math.min(vals.length - 1, Math.max(0, i))], `${name}(${i})`);
  assert.ok(!new RegExp(`${name}\\s*\\[`).test(src), `no ${name}[...] left`);
}
// 3. the blue-noise ranks: uVC packs look.VC16 four bytes an int, read as rank() reads them
const P = art.VC_PACKED;
assert.equal(P.length, 64);
for ( let y = 0; y < 16; y++ ) for ( let x = 0; x < 16; x++ ) assert.equal((P[y * 4 + (x >> 2)] >> ((x & 3) * 8)) & 255, VC16[y * 16 + x]);
assert.match(F.fragmentSrc, /float\(\(uVC\[q\.y \* 4 \+ \(q\.x >> 2\)\] >> \(\(q\.x & 3\) \* 8\)\) & 255\)/);
// 4. no constant arrays left in the art programs (each was an indexable temp FXC filled per pixel: 324 movs a cell)
for ( const p of [F, S] ) assert.ok(!/const (float|int) \w+\s*\[/.test(p.fragmentSrc), `${p.name}: no const arrays`);
// 5. neither half grows back towards the one program (57 kB of GLSL linked in 13 s; the halves are ~42 and ~28 kB)
for ( const p of [F, S] ) assert.ok(p.fragmentSrc.length < 46000, `${p.name}: ${p.fragmentSrc.length} chars - split it again or measure the link (dev/fire-art-link-run.mjs)`);

console.log(`fire-art-split: ok (ART_F ${F.fragmentSrc.length} + ART_S ${S.fragmentSrc.length} chars; channels disjoint, ${Object.keys(T).length} tables, ranks)`);
