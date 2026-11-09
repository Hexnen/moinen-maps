// No program writes two targets (MRT), offline:   node dev/gl-one-output.test.mjs
// Why (2026-11-09, scene entry "warehouse" froze for 2.4-2.8 s in the desktop app): on D3D11 (ANGLE, Chrome / Electron on Windows) a
// program's link builds its pixel shader for ONE colour target. A program that writes two (the weather lens pass: shade + refraction)
// gets its real pixel shader compiled at its FIRST DRAW, synchronously on the GPU process's main thread - every frame of the app waits
// (D3DCompile 2.43-2.66 s for the lens, traced). The background pre-warm (gl-warm.mjs, KHR_parallel_shader_compile) cannot reach that
// compile. So: one output per program; a pass that needs two textures draws twice with two one-output programs (lens.mjs lensFrag).
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../scripts/", import.meta.url);
const files = [];
(function walk(dir) { for ( const n of readdirSync(dir) ) { const p = join(dir, n); if ( statSync(p).isDirectory() ) walk(p); else if ( n.endsWith(".mjs") ) files.push(p); } })(root.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
assert.ok(files.length > 50, "found the module's scripts");

// 1. no render target with a second colour attachment, no drawBuffers, no GLSL second output anywhere in the module
for ( const f of files ) {
  const s = readFileSync(f, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (c) => (c.startsWith("/*") && /`/.test(c) ? c : ""));   // (comments out; shader text stays)
  assert.ok(!/addColorTexture\s*\(\s*[1-9]/.test(s), `${f}: a render texture with a second colour attachment (MRT)`);
  assert.ok(!/\bdrawBuffers\s*\(/.test(s), `${f}: drawBuffers (MRT)`);
  assert.ok(!/layout\s*\(\s*location\s*=\s*[1-9]\s*\)\s*out\b/.test(s), `${f}: a GLSL output at location >= 1 (MRT)`);
  assert.ok(!/gl_FragData\s*\[\s*[1-9]/.test(s), `${f}: gl_FragData[>=1] (MRT)`);
}

// 2. the lens: every program (the pass's shade and refraction halves, the pre-passes, the show) has exactly ONE active output
class Stub { toArray() { return []; } }
globalThis.PIXI = new Proxy({ Program: { from: (vertexSrc, fragmentSrc, name) => ({ vertexSrc, fragmentSrc, name }) } }, { get: (o, k) => o[k] ?? Stub });
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
const progs = (await import("../scripts/weather/lens.mjs")).lensPrograms();

/** The global `out` declarations a GLSL source keeps after its #if / #elif / #else (#define NAME VALUE, defined(), ==, !=, &&, ||, !). */
function activeOuts(src) {
  const defs = {}, stack = [], outs = [];
  const on = () => stack.every((f) => f.on);
  const evalIf = (e) => {
    const x = e.replace(/defined\s*\(\s*(\w+)\s*\)/g, (_, n) => (n in defs ? "1" : "0")).replace(/\b[A-Za-z_]\w*\b/g, (n) => (n in defs ? String(Number(defs[n]) || 0) : "0"));
    assert.ok(/^[\d\s=!<>&|()+-]*$/.test(x), `unsupported #if expression: ${e}`);
    return !!Function(`return (${x});`)();
  };
  for ( const line of src.split("\n") ) {
    const t = line.trim(); let m;
    if ( (m = t.match(/^#\s*if\s+(.*)$/)) ) { const v = on() && evalIf(m[1]); stack.push({ on: v, done: v }); continue; }
    if ( (m = t.match(/^#\s*ifdef\s+(\w+)/)) ) { const v = on() && m[1] in defs; stack.push({ on: v, done: v }); continue; }
    if ( (m = t.match(/^#\s*ifndef\s+(\w+)/)) ) { const v = on() && !(m[1] in defs); stack.push({ on: v, done: v }); continue; }
    if ( (m = t.match(/^#\s*elif\s+(.*)$/)) ) { const f = stack.at(-1); const up = stack.slice(0, -1).every((g) => g.on); f.on = !f.done && up && evalIf(m[1]); f.done ||= f.on; continue; }
    if ( /^#\s*else\b/.test(t) ) { const f = stack.at(-1); const up = stack.slice(0, -1).every((g) => g.on); f.on = !f.done && up; f.done = true; continue; }
    if ( /^#\s*endif\b/.test(t) ) { stack.pop(); continue; }
    if ( !on() ) continue;
    if ( (m = t.match(/^#\s*define\s+(\w+)(?:\s+(.*))?$/)) ) { defs[m[1]] = (m[2] ?? "1").trim(); continue; }
    if ( (m = t.match(/^(?:layout\s*\([^)]*\)\s*)?out\s+\w+\s+(\w+)\s*;/)) ) outs.push(m[1]);
  }
  assert.equal(stack.length, 0, "balanced #if / #endif");
  return outs;
}
// (the evaluator itself)
assert.deepEqual(activeOuts("#define A 2\n#if A == 2\nout vec4 x;\n#else\nout vec4 y;\n#endif\nout vec4 z;"), ["x", "z"]);
assert.deepEqual(activeOuts("#if defined(B)\nout vec4 x;\n#elif 1\nout vec4 y;\n#endif"), ["y"]);

const byName = Object.fromEntries(progs.map((p) => [p.name, p]));
for ( const p of progs ) {
  if ( !/^#version 300 es/.test(p.fragmentSrc) ) continue;   // (GLSL 1: gl_FragColor only)
  const outs = activeOuts(p.fragmentSrc);
  assert.equal(outs.length, 1, `${p.name}: exactly one output (has ${outs.join(", ") || "none"})`);
}
// the pass's two halves: the shade writes fragColor, the refraction dispColor; the same source otherwise (the same pixels)
const shade = byName["moinen-maps-weather-lens"], disp = byName["moinen-maps-weather-lens-disp"];
assert.ok(shade && disp, "both halves of the lens pass are in lensPrograms (so the pre-warm links them)");
assert.deepEqual(activeOuts(shade.fragmentSrc), ["fragColor"]);
assert.deepEqual(activeOuts(disp.fragmentSrc), ["dispColor"]);
assert.equal(shade.fragmentSrc.replace("#define LENS_OUT 1", "#define LENS_OUT 2"), disp.fragmentSrc, "the halves differ only in LENS_OUT");
assert.equal(shade.vertexSrc, disp.vertexSrc);

console.log(`gl-one-output: ok (${files.length} scripts without MRT, ${progs.length} lens programs with one output each)`);
