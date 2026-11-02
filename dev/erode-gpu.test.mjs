// node dev/erode-gpu.test.mjs: the pure parts of the GPU erode (erode-gpu.mjs, entry-clock.timeBytes) against the CPU erode's own rules
//   1. timeBytes: a texel is `moment + 1` in two bytes (low, high), 0 where no pixel comes, rows padded to an even width, held at 65534;
//   2. the "reached" test: the CPU's sort key (moment * 2^20 + pixel) below (max(0, el - dt) + 1) * 2^20 equals the shader's split test
//      (whole moment + pixel's overflow, fraction in key units) with single-precision limits, over random moments, pixels and times;
//   3. the shader's hash2 (unsigned 32-bit maths) and its integer limit equal entry-clock hash2(i, salt, 5) < thr, for the two FRONT picks;
//   4. the shader source declares what display.gpuStages / pass fill (uniform names, stage count).
globalThis.Hooks ??= { on() {}, once() {}, off() {} };
class Stub {}
globalThis.PIXI ??= new Proxy({}, { get: () => Stub });
const E = await import("../scripts/destruction/entry-clock.mjs");
const G = await import("../scripts/destruction/erode-gpu.mjs");
const fs = await import("node:fs");
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) fails++; };

// 1. timeBytes
{
  const w = 5, h = 3, tw = 6, ix = new Uint32Array([0, 4, 7, 14]), tm = new Int32Array([0, 300, 65534, 99999]);
  const u8 = G && E.timeBytes(ix, tm, w, h);
  let bad = u8.length === tw * h * 2 ? 0 : 1;
  const at = (i) => { const y = Math.floor(i / w), q = (y * tw + i - y * w) * 2; return u8[q] + u8[q + 1] * 256; };
  bad += at(0) === 1 ? 0 : 1; bad += at(4) === 301 ? 0 : 1; bad += at(7) === 65535 ? 0 : 1; bad += at(14) === 65535 ? 0 : 1;   // (held at 65534 + 1)
  for ( const i of [1, 2, 3, 5, 6, 8, 9, 10, 11, 12, 13] ) if ( at(i) !== 0 ) bad++;
  ok(bad === 0, `timeBytes layout (${bad} wrong)`);
}

// 2. the reached test
{
  let bad = 0, n = 0;
  for ( let run = 0; run < 200000; run++ ) {
    const tm = Math.floor(E.hash2(run, 1, 7) * 3000), ix = Math.floor(E.hash2(run, 2, 7) * (run % 5 ? 1048576 : 4000000));
    const el = E.hash2(run, 3, 7) * 3600 - 200, dt = Math.floor(E.hash2(run, 4, 7) * 300);
    // the CPU's: key below (max(0, el - dt) + 1) * 2^20 (keys are tm * 2^20 + ix as clockUpper reads them)
    const cpu = tm * 1048576 + ix < (Math.max(0, el - dt) + 1) * 1048576;
    // the shader's: whole part and fraction of the limit (Float32 uniforms), the pixel's key split into moment + overflow and low part
    const Y = Math.max(0, el - dt) + 1, T = Math.floor(Y), F = Math.fround((Y - T) * 1048576);
    const hi = Math.floor(ix / 1048576), kHi = Math.fround(tm + hi), kLo = Math.fround(ix - hi * 1048576);
    const gpu = kHi < Math.fround(T) || (kHi === Math.fround(T) && kLo < F);
    n++; if ( cpu !== gpu ) bad++;
  }
  // (a pixel exactly on the float32 rounding of the fraction can differ: one in ~10^6)
  ok(bad <= 2, `reached test: ${bad} of ${n} differ (float32 limit rounding only)`);
}

// 3. hash2 as the shader makes it
{
  const imul = Math.imul;
  const sh = (x, y, s) => {   // GLSL uint maths
    let h = (imul(x, 374761393) + imul(y, 668265263) + imul(s, 1274126177)) >>> 0;
    h = imul((h ^ (h >>> 13)) >>> 0, 1103515245) >>> 0; h = (h ^ (h >>> 16)) >>> 0; return h;
  };
  let bad = 0, n = 0;
  for ( const [salt, thr] of [[2, 0.6], [3, 0.5]] ) {
    const lim = Math.ceil(thr * 4294967296) | 0, ulim = lim >>> 0;
    for ( let i = 0; i < 300000; i++, n++ ) {
      const want = E.hash2(i, salt, 5) < thr, got = sh(i, salt, 5) < ulim;
      if ( want !== got ) bad++;
    }
  }
  ok(bad === 0, `hash2 pick: ${bad} of ${n} differ`);
}

// 4. the shader and display agree on names and sizes
{
  const src = fs.readFileSync(new URL("../scripts/destruction/erode-gpu.mjs", import.meta.url), "utf8");
  const names = ["uAtlas", "uTime", "uLut", "uFrame", "uN", "uLim", "uH", "uA", "uB"];
  const missing = names.filter((n) => !src.includes(`uniform`) || !new RegExp(`uniform [A-Za-z0-9]+ ${n}\\b`).test(src));
  ok(!missing.length && G.MAX_STAGES >= 5, `shader uniforms declared (${missing.join(",") || "all"}), MAX_STAGES ${G.MAX_STAGES}`);
}

console.log(fails ? `${fails} FAILED` : "erode-gpu: all checks ok");
process.exit(fails ? 1 : 0);
