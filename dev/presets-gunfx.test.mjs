// The guns' hit spurts (presets/gun-fx.mjs) and the gun pocks' tight clock (destruction/entry-clock.mjs), the pure parts:
//   node dev/presets-gunfx.test.mjs
//   A. the bake: deterministic bytes, inside its box, premultiplied (rgb <= alpha), some body at its peak and nothing at its last frame
//   B. the timing: frameAt -1 before the hit and after L, frames 0..count-1 in between; the hitFx span covers the spurt
//   C. the frame: spurts() pushes SPURT_STRIDE values per live hit, none before a hit lands; a heavy gun mixes in light spurts
//   D. the tone: dustLit keeps a cold ground's dust soil-coloured (never blue), dustNight lifts toward the moon only in the dark
//   E. the tight clock: a gun's pock pixel never comes before the walk reaches it (no pixel ahead of its bullet); off = as before
import * as X from "../scripts/presets/gun-fx.mjs";
import * as A from "../scripts/presets/accents-core.mjs";
globalThis.Hooks ??= { on() {}, once() {}, off() {} };
class Stub { constructor() { return new Proxy(this, { get: (t, k) => (k in t ? t[k] : () => {}) }); } }
globalThis.PIXI ??= new Proxy({}, { get: () => Stub });
const { clockOf } = await import("../scripts/destruction/entry-clock.mjs");

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };

/* A. the bake */
for ( const kind of X.SPURT_KINDS ) for ( const S of [24, 40, 100] ) {
  const cnt = X.frameCount(kind), box = X.spurtBox(kind, S, 0.5);
  const a = X.bakeSpurt(kind, S, 0.5, 1, Math.floor(cnt / 3)), b = X.bakeSpurt(kind, S, 0.5, 1, Math.floor(cnt / 3));
  ok(Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)) === 0, `${kind}/${S}: deterministic`);
  ok(a.w === box.w && a.h === box.h && a.data.length === a.w * a.h * 4, `${kind}/${S}: box`);
  let pm = true, body = 0;
  for ( let i = 0; i < a.data.length; i += 4 ) { if ( a.data[i] > a.data[i + 3] ) pm = false; if ( a.data[i + 3] > 128 ) body++; }
  ok(pm, `${kind}/${S}: premultiplied`);
  ok(body > S * 0.5, `${kind}/${S}: a body at a third of its life (${body} px)`);
  const last = X.bakeSpurt(kind, S, 0.5, 1, cnt - 1);
  let left = 0; for ( let i = 3; i < last.data.length; i += 4 ) if ( last.data[i] > 128 ) left++;
  ok(left < body * 0.1, `${kind}/${S}: gone by its last frame (${left} px)`);
}

/* B. the timing */
for ( const kind of X.SPURT_KINDS ) {
  const L = X.SPURT[kind].L, cnt = X.frameCount(kind);
  ok(X.frameAt(kind, -1) === -1 && X.frameAt(kind, L) === -1 && X.frameAt(kind, 0) === 0 && X.frameAt(kind, L - 1) === cnt - 1, `${kind}: frameAt bounds`);
}
for ( const lv of [1, 3] ) {
  const sp = A.spanOf({ kind: "hitFx", lv, hits: [[0, 0, 100, 0], [10, 0, 300, 0]] });
  ok(sp && sp[1] >= 300 + X.SPURT[X.kindOf(lv)].L, `hitFx lv ${lv}: span covers the spurt`);
}

/* C. the frame */
{
  const hits = Array.from({ length: 30 }, (_, i) => [i * 10, 0, i * 50, i & 1]);
  const F = {}; X.spurts({ kind: "hitFx", lv: 3, hits, tones: hits.map(() => 0x808080) }, 400, F, 7);
  const live = hits.filter((h) => 400 >= h[2]).length;
  ok(F.spurts.length === live * X.SPURT_STRIDE, `spurts: one per landed hit (${F.spurts.length / X.SPURT_STRIDE} of ${live})`);
  const F2 = {}; X.spurts({ kind: "hitFx", lv: 3, hits: hits.map((h) => [h[0], h[1], 0, h[3]]) }, 10, F2, 7);
  const kinds = new Set(); for ( let i = 2; i < F2.spurts.length; i += X.SPURT_STRIDE ) kinds.add(F2.spurts[i]);
  ok(kinds.size === 2, "a heavy gun mixes light and heavy spurts");
  const F3 = {}; X.spurts({ kind: "hitFx", lv: 1, hits }, -5, F3, 7);
  ok(F3.spurts.length === 0, "nothing before the first hit");
}

/* D. the tone */
{
  const water = X.dustLit([0.15, 0.3, 0.6]);
  ok(water[2] <= Math.max(water[0], water[1]) + 0.02, `cold ground: soil dust, not blue (${water.map((c) => c.toFixed(2))})`);
  const lit = X.dustLit([0.45, 0.62, 0.36]);
  ok(X.dustNight(lit, 0, 2).every((c, i) => Math.abs(c - lit[i]) < 1e-9), "by day dustNight is the lit colour");
  ok(X.unpackRgb(X.packRgb([1, 0.5, 0])).every((c, i) => Math.abs(c - [1, 0.5, 0][i]) < 0.01), "pack / unpack");
}

/* E. the tight clock */
{
  const info = { x: 0, y: 0, w: 200, h: 40, ex: 10, ey: 20, R: 4, type: "blast", mat: 0, cause: 5, axis: 0, len: 180, rect: { x0: 0, y0: 0, x1: 200, y1: 40 } };
  const path = Array.from({ length: 10 }, (_, i) => [10 + i * 20, 20, i * 150]);
  const T = clockOf({ info, hash: 4242, path, speed: 1, tight: true }), W = clockOf({ info, hash: 4242, path, speed: 1 });
  let early = 0, earlyW = 0;
  for ( let x = 0; x < 200; x += 3 ) for ( let y = 10; y < 30; y += 3 ) { if ( T.pixelTime(x, y) < T.arrive(x, y) ) early++; if ( W.pixelTime(x, y) < W.arrive(x, y) - 1 ) earlyW++; }
  ok(T.tight && !W.tight, "tight only when asked");
  ok(early === 0, `tight: no pixel before its bullet (${early})`);
  ok(earlyW > 0, "untight: the old centred band (unchanged)");
  ok(T.band < W.band, `tight band narrower (${T.band.toFixed(0)} < ${W.band.toFixed(0)})`);
}

/* F. the rounds (fill: accent-only rounds between a lane's walk hits) and water */
{
  const hits = Array.from({ length: 12 }, (_, i) => [i * 20, (i & 1) * 30, (i >> 1) * 70, i & 1]);
  const R0 = X.roundsOf({ hits }), R2 = X.roundsOf({ hits, fill: 2 });
  ok(R0.length === hits.length && R0.every((r) => r[4] === 1), "no fill: the walk hits only, all major");
  ok(R2.length === hits.length + 2 * (hits.length - 2), `fill 2: two rounds in every gap of each lane (${R2.length})`);
  ok(R2.every((r, i) => !i || R2[i - 1][2] <= r[2]), "rounds in time order");
  ok(JSON.stringify(X.roundsOf({ hits, fill: 2 })) === JSON.stringify(R2), "rounds deterministic");
  ok(R2.filter((r) => !r[4]).every((r) => r[3] === 0 || r[3] === 1), "minor rounds keep their lane");
  ok(X.wetOf(X.packRgb([0.17, 0.24, 0.31])) && !X.wetOf(X.packRgb([0.45, 0.62, 0.36])) && !X.wetOf(X.packRgb([0.9, 0.8, 0.45])), "water is wet, grass and sand dry");
  ok(X.kindOf(3, true) === "splashH" && X.kindOf(1, true) === "splashL", "wet hits splash");
}

console.log(fails ? `${fails}/${n} presets-gunfx check(s) FAILED` : `ok presets-gunfx: ${n}/${n} checks`);
process.exit(fails ? 1 : 0);
