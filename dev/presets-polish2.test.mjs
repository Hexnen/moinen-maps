// The presets polish ROUND 2 (bomb, grenade), the pure parts:   node dev/presets-polish2.test.mjs
//   A. the fireball GROWS over several 12 fps art frames from a compact white ball (no pin that snaps to full size)
//   B. the burst light SWELLS to its peak (BURST_UP) instead of snapping on
//   C. the burst art: one heat field over the cloud (blended billow heats - no ring per billow, no grey billows on a hot ball), the
//      erosion shrinks and opens coarse blobby holes (no fine 1-2 px octave: it read as square specks), chunks hidden in the fire,
//      blobby ground-shadow edges; the fireball drawn over the dust (the display sorts its areas by zIndex, the burst at 1)
//   D. the fall / throw shadows are SOFT (F.soft: a feathered sprite, no dithered 2 x 2 grid); the grenade is one shaded egg (no
//      iron band splitting it into two pebbles)
//   E. the definitions: a smaller shock ring (bomb 2.7, grenade 0.85 squares; the L3 puffs 0.31), the bomb's crater torn by 2-3 lobes,
//      the grenade's crater jagged
import * as B from "../scripts/fire/burst-model.mjs";
import * as A from "../scripts/presets/accents-core.mjs";
import * as C from "../scripts/presets/core.mjs";
import { KIND } from "../scripts/fire/dust-model.mjs";
import { BUILTIN } from "../scripts/presets/defs.mjs";
import { readFileSync } from "node:fs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const get = (id) => BUILTIN.find((d) => d.id === id);
const layer = (id, lid) => get(id).layers.find((l) => l.id === lid);

/* A: the fireball's extent (max lobe reach from the centre, cells) per art frame */
{
  const f = { lv: 3, R: 20, c: [100, 100], seed: 7, wind: [0, 0], out: 1e9, dbN: 0, db: new Float32Array(64) };
  const ext = (a) => {
    const o = B.burstAt(f, a, { lift: 0.5, squash: 0.8 });
    let m = 0;
    for ( let i = 0; i < o.n[0]; i++ ) if ( o.lob[i * 8 + 5] === 0 ) m = Math.max(m, Math.hypot(o.lob[i * 8] - 100, o.lob[i * 8 + 1] - 100) + o.lob[i * 8 + 2]);
    return m;
  };
  const e = [0.04, 0.125, 0.21, 0.29, 0.375, 0.6].map(ext);
  ok(e[0] > 0.2 * f.R && e[0] < 0.6 * e[4], `a compact first frame (${e[0].toFixed(1)} vs ${e[4].toFixed(1)} at 375 ms)`);
  ok(e[0] < e[1] && e[1] < e[2] && e[2] < e[3], `it grows frame by frame (${e.slice(0, 4).map((v) => v.toFixed(1)).join(" < ")})`);
  ok(e[1] < 0.85 * e[4], "not full size on the second frame");
}

/* B */
{
  const L = { q: 0, lv: 3, o: null }, g = (t) => B.burstGain(L, t);
  ok(B.BURST_UP >= 0.1 && g(42) < 0.5 * g(B.BURST_UP * 1000) && g(125) > g(42), "the light swells over ~2 art frames");
}

/* C */
{
  const art = readFileSync(new URL("../scripts/fire/burst-art.mjs", import.meta.url), "utf8");
  ok(/hs \+= w \* A\.w; ws \+= w;/.test(art) && /float H = hs \/ max\(ws, 1e-4\)/.test(art), "one heat field: the billows' heats blended by cover");
  ok(!/vn\(p \/ \(1\.6 \* uq\), uSeed \+ 22\)/.test(art) && /vn\(p \/ \(6\.0 \* uq\), uSeed \+ 21 \+ i\)/.test(art), "erosion: coarse blobby holes only");
  ok(/rr \*= 1\.0 - 0\.3 \* smoothstep\(0\.2, 1\.0, er\)/.test(art), "erosion: the billow shrinks as it dissolves");
  ok(/bool inFire = G >= 1 && G <= 10;/.test(art), "chunks hidden inside the fire");
  ok(/float gz = vn\(p \/ \(3\.0 \* uq\)/.test(art) && !/h3\(c\.x >> 1, c\.y >> 1, 66\) - 0\.5\) \* 0\.1;/.test(art), "the ground shadow's steps: blobby edges");
  ok(/this\.zIndex = 1; this\.front\.zIndex = 0\.5;/.test(art), "the burst sorts over the dust");
  const disp = readFileSync(new URL("../scripts/fire/display.mjs", import.meta.url), "utf8");
  ok(/this\.meshes\.sortableChildren = true;/.test(disp), "the display sorts its areas");
}

/* D */
{
  const RECT = { x: 0, y: 0, width: 3000, height: 2000 }, ENV = { grid: 100, rect: RECT, now: 1_800_000_000_000, wind: { dir: 45, speed: 0.4 } };
  const env = { ap: 3, ox: 0, oy: 0, grid: 100, lift: 0.5, squash: 0.8, q: 1, seed: 7 };
  const bomb = C.expand(get("bomb"), { a: [1500, 1000] }, { seed: 7 }, ENV), fall = A.itemsOf({ ...bomb, f: [] }).find((a) => a.kind === "fallShadow");
  for ( const t of [-1100, -600, -100] ) {
    const F = A.draw([fall], 0, t, env, A.newFrame());
    ok(F.soft.length === 5 && !F.shade[0].length && !F.shade[1].length && F.soft[4] > 0 && F.soft[4] <= A.SOFT_A, `bomb fall ${t}: one soft shadow, no dithered cells`);
  }
  const gr = C.expand(get("grenade"), { a: [1200, 1000], b: [1500, 1000] }, { seed: 7 }, ENV), bo = A.itemsOf({ ...gr, f: [] }).find((a) => a.kind === "bounce");
  const F = A.draw([bo], 0, -5, env, A.newFrame());
  ok(F.soft.length === 5, "the grenade's shadow is soft");
  ok(!F.px[6].length && F.px[8].length && F.px[10].length && F.px[11].length, "the grenade: one egg in three olives (no iron band)");
  ok(A.PAL.length === A.GLOW.length && A.GLOW[10] === 0 && A.GLOW[11] === 0, "the olives do not glow");
}

/* E */
{
  ok(layer("bomb", "shock").r === 2.7 && layer("grenade", "shock").r === 0.85, "smaller shock rings");
  ok(KIND.shock.pr[3] === 0.31 && KIND.shock.pr[2] === 0.27 && KIND.shock.pr[1] === 0.17, "the L3 shock puffs smaller, L1 / L2 unchanged (lightning, landing)");
  const lo = layer("bomb", "lobes");
  ok(lo && lo.type === "blast" && lo.place.m === "scatter" && lo.at > layer("bomb", "crater").at, "the bomb's crater torn by lobes after it");
  ok(layer("grenade", "crater").pr?.jagged === true, "the grenade's crater jagged");
}

console.log(fails ? `${fails}/${n} presets-polish2 checks FAILED` : `presets-polish2: ${n} checks ok`);
if ( fails ) process.exitCode = 1;
