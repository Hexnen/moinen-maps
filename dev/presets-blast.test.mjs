// The presets ROUND 3 (bomb, grenade), the pure parts:   node dev/presets-blast.test.mjs
//   A. the blast (presets/blast-core.mjs): deterministic from its seed; the flash is gone before the fireball's colour run is over;
//      the shock ring grows monotonically and ends; streaks / clods land; every body stays inside boxOf; the bomb throws no jets
//   B. the burst look 3 (burst-model BURST_V3, surgeAt): the cloud climbs and widens late, has no separate surge billows; the
//      ground surge front grows monotonically, settles and ends; look 2 is untouched (no surge, its own life)
//   C. the wiring: definitions (blast accent, look 3, np shock), cleanStroke keeps bv / np, shockOf adds no puff emitters for np
//   D. the burst art rect holds a look-3 billow's whole kernel (a clipped cloud read as a box)
import * as K from "../scripts/presets/blast-core.mjs";
import * as B from "../scripts/fire/burst-model.mjs";
import * as C from "../scripts/presets/core.mjs";
import { cleanStroke } from "../scripts/fire/model.mjs";
import { BUILTIN } from "../scripts/presets/defs.mjs";
import { readFileSync } from "node:fs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const get = (id) => BUILTIN.find((d) => d.id === id);
const layer = (id, lid) => get(id).layers.find((l) => l.id === lid);
const geo = { grid: 40, ap: 1, ox: 0, oy: 0 };

/* A: the blast */
for ( const lv of [1, 3] ) {
  const item = { kind: "blast", at: 0, lv, x: 400, y: 400, r: 40 * (lv === 3 ? 1.6 : 0.8) };
  const P1 = K.prepare(item, 77, geo), P2 = K.prepare(item, 77, geo);
  ok(JSON.stringify(P1) === JSON.stringify(P2), `L${lv}: prepare is deterministic`);
  if ( lv === 3 ) ok(P1.jets.length === 0, "the bomb throws no jets (they read as a sea urchin over its fireball)");
  const box = K.boxOf(P1), [x0, y0, x1, y1] = box, env = { lift: 0.5, squash: 0.8, q: 1 };
  let lastR = -1, monotone = true, inBox = true, flashEnd = null;
  const [, end] = K.spanOf(item);
  for ( let t = 0; t <= end; t += 1000 / 60 ) {
    const F = K.frameAt(P1, t, env, x0, y0);
    if ( F.ring[2] > 0 ) { if ( F.ring[2] + 1e-6 < lastR ) monotone = false; lastR = F.ring[2]; }
    if ( flashEnd === null && t > 30 && !(F.fl[2] > 0) ) flashEnd = t;
    for ( let i = 0; i < F.nCl; i++ ) { const x = F.cl[i * 4], y = F.cl[i * 4 + 1]; if ( x < 0 || y < 0 || x > x1 - x0 || y > y1 - y0 ) inBox = false; }
    for ( let i = 0; i < F.nSt; i++ ) { const x = F.st[i * 4], y = F.st[i * 4 + 1]; if ( x < -1 || y < -1 || x > x1 - x0 + 1 || y > y1 - y0 + 1 ) inBox = false; }
  }
  ok(monotone, `L${lv}: the shock ring only grows`);
  ok(inBox, `L${lv}: clods and streaks stay inside boxOf`);
  ok(flashEnd !== null && flashEnd < 400, `L${lv}: the flash is short (${flashEnd} ms)`);
  const late = K.frameAt(P1, end + 50, env, x0, y0);
  ok(!late.any, `L${lv}: nothing drawn after its span`);
}

/* B: the burst look 3 */
{
  const f3 = { lv: 3, R: 20, c: [100, 100], seed: 7, wind: [0, 0], out: 1e9, dbN: 0, db: new Float32Array(64), v3: true };
  const f2 = { ...f3, v3: false };
  const top = (f, a) => {
    const o = B.burstAt(f, a, { lift: 0.5, squash: 0.8 });
    let m = 1e9, w = 0, sur = 0;
    for ( let i = 0; i < o.n[0]; i++ ) {
      if ( o.lob[i * 8 + 5] > 1.5 ) { sur++; continue; }
      m = Math.min(m, o.lob[i * 8 + 1] - o.lob[i * 8 + 2]); w = Math.max(w, Math.abs(o.lob[i * 8] - 100) + o.lob[i * 8 + 2]);
    }
    return { top: m, w, sur };
  };
  const a3 = top(f3, 3), b3 = top(f3, 12);
  ok(b3.top < a3.top, "look 3: the cloud climbs late (mushroom)");
  ok(b3.w > a3.w, "look 3: the cloud widens late");
  ok(top(f3, 0.6).sur === 0, "look 3: no separate surge billows (the analytic surge ring draws it)");
  ok(top(f2, 0.6).sur > 0, "look 2: its surge billows unchanged");
  ok(B.lifeOf({ bv: 3, lv: 3 }) === B.BURST_V3.life[3] && B.lifeOf({ lv: 3 }) === B.BURST_LV.life[3], "lifeOf by look");
  let last = 0, mono = true;
  for ( let a = 0; a < B.BURST_V3.surge[3]; a += 0.05 ) { const s = B.surgeAt(f3, a); if ( s[0] + 1e-9 < last ) mono = false; last = s[0]; }
  ok(mono, "surge: its front only grows");
  ok(B.surgeAt(f3, B.BURST_V3.surge[3] + 0.1)[3] === 0, "surge: it ends");
  ok(B.surgeAt(f3, 0.8 * B.BURST_V3.surge[3])[2] > 0.99, "surge: settled by 80 % of its life");
  ok(B.surgeAt(f2, 1)[3] === 0, "surge: none for look 2");
}

/* C: the wiring */
{
  for ( const id of ["bomb", "grenade"] ) {
    ok(layer(id, "blast")?.kind === "blast", `${id}: a blast accent`);
    ok(layer(id, "burst")?.look === 3, `${id}: burst look 3`);
    ok(layer(id, "shock")?.np === true, `${id}: shock dust without puffs (np)`);
  }
  for ( const id of ["rocket", "meteor"] ) {
    const b = get(id).layers.find((l) => l.l === "burst");
    ok(!b || b.look !== 3, `${id}: keeps the look-2 burst (shared layers unchanged)`);
  }
  ok(C.ACCENTS.includes("blast"), "ACCENTS lists blast");
  const st = cleanStroke({ id: "b1", k: "burst", p: [10, 10], r: 40, lv: 3, q: 1, bv: 3 });
  ok(st?.bv === 3, "cleanStroke keeps bv 3");
  const st2 = cleanStroke({ id: "b2", k: "burst", p: [10, 10], r: 40, lv: 3, q: 1, bv: 2 });
  ok(st2 && st2.bv === undefined, "cleanStroke drops other bv");
  const src = readFileSync(new URL("../scripts/fire/dust-model.mjs", import.meta.url), "utf8");
  ok(/if \( st\.np \) return;/.test(src), "shockOf: np strokes get no puff emitters");
}

/* D: the art rect */
{
  const st = { id: "r1", k: "burst", p: [400, 400], r: 64, lv: 3, q: 1, bv: 3 };
  const r3 = B.burstRect(st, geo), r2 = B.burstRect({ ...st, id: "r2", bv: undefined }, geo);
  ok(r3.y0 < r2.y0 && r3.x0 < r2.x0, "look 3's rect is larger (its kernels reach 1.22 x a billow's radius, its cloud climbs)");
}

console.log(fails ? `${fails}/${n} FAILED` : `all ${n} ok`);
process.exit(fails ? 1 : 0);
