// node dev/progress.test.mjs: the progress of long jobs (scripts/progress-core.mjs, core.mjs's bake reports) is truthful and smooth.
//   1. a job of one long opaque step (the water's preparation, a big area): the bar creeps on, never back, never past the step, and
//      the end takes it to 100%; no tick jumps more than a few percent while it runs;
//   2. a job reported finely (the bake now): the time left settles within ~30% of the truth after 25% of the work and counts down
//      steadily (never jumps up by more than a second between ticks);
//   3. the rates are learned: a job twice as slow as its prior makes the next estimate slower;
//   4. a real bake (fixture stroke) reports all along (no silence over 400 ms), monotonically, and its bytes are the same with or
//      without the reports.
import fs from "node:fs";
globalThis.Hooks ??= { on() {}, once() {}, off() {} };
const P = await import("../scripts/progress-core.mjs");
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) fails++; };

let T = 0;
P.setClock(() => T);
const TICK = 250;

/* 1. one opaque step, its prior 1.5 s, really 4 s */
{
  P.resetRates();
  const j = new P.Job("w");
  const r = j.run("waterPrep", 1);
  let prev = 0, maxStep = 0, back = false, over = false, stall = 0, still = 0;
  for ( T = 0; T < 4000; T += TICK ) {
    const f = j.view().frac;
    still = f - prev < 0.002 ? still + TICK : 0; stall = Math.max(stall, still);
    if ( f < prev - 1e-9 ) back = true;
    if ( f > 0.995 ) over = true;
    maxStep = Math.max(maxStep, f - prev); prev = f;
  }
  r.end();
  let last = prev;
  for ( let k = 0; k < 8; k++, T += TICK ) last = j.view().frac;
  ok(!back, "opaque step: the bar never goes back");
  ok(!over && prev > 0.5, `opaque step: it creeps on (${(prev * 100).toFixed(0)}% at the end of the step) but stays under its step's share`);
  ok(stall < 1000, `opaque step: it never stands still for a second while the step runs past its expected time (longest ${stall} ms)`);
  ok(maxStep < 0.25, `opaque step: no tick jumps more than 25% (max ${(maxStep * 100).toFixed(1)}%)`);
  ok(last > 0.99, `opaque step: the end takes it to 100% within 2 s (${(last * 100).toFixed(1)}%)`);
}

/* 2. finely reported work: 12 s at a pace 2.5x the prior, with uneven reports */
{
  P.resetRates();
  const total = 12000, units = 1e6, j = new P.Job("b");
  T = 0;
  const r = j.run("bakeOne", units, { grain: units * 0.1 });
  let worst = 0, jumpUp = 0, prevEta = null, prevF = 0, back = false;
  for ( T = 0; T < total; T += TICK ) {
    // reports every ~120 ms, the pace wobbling +-30% around linear
    const real = Math.min(1, (T / total) * (1 + 0.3 * Math.sin(T / 900)) );
    r.set(real * units);
    const v = j.view();
    if ( v.frac < prevF - 1e-9 ) back = true;
    prevF = v.frac;
    if ( v.etaMs !== null ) {
      if ( T / total >= 0.25 ) worst = Math.max(worst, Math.abs(v.etaMs - (total - T)) / total);
      if ( prevEta !== null ) jumpUp = Math.max(jumpUp, v.etaMs - prevEta);
      prevEta = v.etaMs;
    }
  }
  r.end(); j.finish();
  ok(!back, "fine reports: monotonic");
  ok(worst < 0.3, `fine reports: time left within 30% of the job after a quarter of it (worst ${(worst * 100).toFixed(0)}%)`);
  ok(jumpUp < 1000, `fine reports: the countdown never jumps up a second (max +${Math.round(jumpUp)} ms per tick)`);
}

/* 3. learning */
{
  P.resetRates();
  const before = P.rateOf("chunk"), j = new P.Job("c");
  T = 0;
  const r = j.run("chunk", 100);
  for ( let k = 1; k <= 100; k++ ) { T += before * 2; r.set(k); }
  j.finish();
  ok(P.rateOf("chunk") > before * 1.2, `learning: a job twice as slow as its prior raises the rate (${before} -> ${P.rateOf("chunk").toFixed(1)} ms/chunk)`);
}
P.setClock(null);

/* 4. a real bake's reports */
{
  const core = await import("../scripts/destruction/core.mjs");
  const j = JSON.parse(fs.readFileSync(new URL("./fixtures/destruction-flags/main-map-156.json", import.meta.url), "utf8"));
  const rle = (str, n) => { const a = new Uint8Array(n), bin = Buffer.from(str ?? "", "base64").toString("latin1"); let pos = 0, i = 0; while ( pos < bin.length && i < n ) { const v = bin.charCodeAt(pos++); let run = 0, mul = 1, b; do { b = bin.charCodeAt(pos++); run += (b & 127) * mul; mul *= 128; } while ( b & 128 && pos < bin.length ); if ( v ) a.fill(v, i, Math.min(n, i + run)); i += run; } return a; };
  const objs = Object.values(j.destructionObjects).sort((a, b) => a.s - b.s).map((o) => ({ id: o.id, k: o.k, t: o.t, c: o.c | 0, x0: o.x0, y0: o.y0, w: o.w, h: o.h, bytes: rle(o.m, o.w * o.h) }));
  const K = 2, AW = 1536, AH = 1024, map = new Uint8ClampedArray(AW * AH * 4);
  for ( let i = 0; i < map.length; i += 4 ) { const n = (i >> 2) % 37; map[i] = 90 + n; map[i + 1] = 110 + n; map[i + 2] = 70; map[i + 3] = 255; }
  // a mid-sized stroke near the start (few older strokes to read): a bake of about a second
  const pick = objs.map((o, i) => [i, o.w * o.h]).filter(([i, a]) => !objs[i].k && i < 60 && a > 30000 && a < 120000)[0][0];
  const input = (onProgress) => ({ objects: objs.map((o, i) => i === pick || o.k ? o : { ...o, skip: 1 }), K, aw: AW, ah: AH, seed: j.destruction.seed | 0, params: j.destruction.params, map: { w: AW, h: AH, data: map }, mapKey: "t", onProgress });
  const tl = [], t0 = Date.now();
  const a = core.bake(input((p) => tl.push([Date.now() - t0, p])), new Map());
  const ms = Date.now() - t0;
  const b = core.bake(input(null), new Map());
  const same = a.count === b.count && a.sheet.data.length === b.sheet.data.length && a.sheet.data.every((v, i) => v === b.sheet.data[i]);
  ok(same, `bake ${objs[pick].w}x${objs[pick].h}: the same bytes with and without progress reports`);
  const mono = tl.every(([, p], k) => !k || p >= tl[k - 1][1]);
  const gap = Math.max(...tl.map(([, p], k) => p - (k ? tl[k - 1][1] : 0)));
  ok(mono && tl.at(-1)[1] === 1, `bake: monotonic, ends at 1 (${tl.length} reports in ${ms} ms)`);
  const quiet = Math.max(...tl.map(([t], k) => t - (k ? tl[k - 1][0] : 0)));
  ok(tl.length >= Math.min(6, ms / 200), `bake: reports all along (${tl.length} in ${ms} ms, largest step ${(gap * 100).toFixed(0)}% of the work)`);
  ok(quiet <= Math.max(400, ms * 0.2), `bake: no silence over 400 ms (max ${quiet} ms; before: one report at 20% and nothing until the end)`);
}

console.log(fails ? `${fails} FAILED` : "progress: all ok");
process.exit(fails ? 1 : 0);
