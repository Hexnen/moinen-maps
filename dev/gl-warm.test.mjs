// gl-warm.mjs: the shared shader pre-warm (fire first display). Offline, a mock WebGL2 context:   node dev/gl-warm.test.mjs
// Regression for the player-side "no fire for seconds" bug (2026-11-09): the background links were polled ONLY by requestAnimationFrame
// (a background tab never gets one: the warm-up, and the fire's first display waiting for it, stalled) and ran one after another (on a
// program-cache miss ten programs took ~14 s, one slow link holding all the rest).
import assert from "node:assert/strict";

const C = { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, LINK_STATUS: 3, ACTIVE_ATTRIBUTES: 4, COMPLETION_STATUS_KHR: 5 };
let polls = 0;
function mockGl({ ext = true, linkPolls = () => 3 } = {}) {
  const live = new Set(), log = [];
  const gl = {
    ...C, log, live,
    getExtension: (n) => (ext && n === "KHR_parallel_shader_compile" ? { COMPLETION_STATUS_KHR: C.COMPLETION_STATUS_KHR } : null),
    createShader: () => { const s = { sh: 1 }; live.add(s); return s; },
    shaderSource: (s, src) => { s.src = src; }, compileShader() {},
    createProgram: () => { const p = { left: 0, links: 0, attribs: ["b", "a"] }; live.add(p); return p; },
    attachShader: (p, s) => { (p.sh ??= []).push(s); },
    linkProgram: (p) => { p.links++; p.left = linkPolls(p.sh[1].src, p.links); log.push(["link", p.sh[1].src, polls]); },
    getProgramParameter: (p, k) => {
      if ( k === C.COMPLETION_STATUS_KHR ) { if ( p.left > 0 ) { p.left--; return false; } return true; }
      if ( k === C.LINK_STATUS ) return true;
      if ( k === C.ACTIVE_ATTRIBUTES ) return p.attribs.length;
    },
    getActiveAttrib: (p, i) => ({ name: p.attribs[i] }),
    bindAttribLocation() {},
    deleteProgram: (p) => live.delete(p), deleteShader: (s) => live.delete(s)
  };
  return gl;
}

// the browser: requestAnimationFrame NEVER fires (a background tab); timers do
let rafCalls = 0;
globalThis.requestAnimationFrame = () => { rafCalls++; return rafCalls; };
globalThis.cancelAnimationFrame = () => {};
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (f, ms, ...a) => realTimeout(() => { polls++; f(...a); }, Math.min(ms ?? 0, 1), ...a);
const compiled = [];
globalThis.PIXI = { Shader: class { constructor(p) { this.p = p; } } };
const setRenderer = (gl) => {
  globalThis.canvas = { app: { renderer: { gl, CONTEXT_UID: 7, shader: {
    bind: (s) => { compiled.push(s.p.name); (s.p.glPrograms ??= {})[7] = {}; }, reset() {} } } } };
};
const { warmPrograms, warmLink } = await import("../scripts/gl-warm.mjs");
const prog = (name, v300 = true) => ({ name, vertexSrc: `${v300 ? "#version 300 es\n" : ""}void main(){}`, fragmentSrc: name });
const within = (p, ms, what) => Promise.race([p, new Promise((_, no) => realTimeout(() => no(new Error(`${what}: stalled (> ${ms} ms)`)), ms))]);

// 1. no requestAnimationFrame at all: the warm-up still finishes (timer poll), every program compiled by PIXI once, GL objects freed
{
  const gl = mockGl(); setRenderer(gl); compiled.length = 0;
  const list = ["art", "emb", "tile", "fuel", "show"].map((n) => prog(n));
  await within(warmPrograms(list, () => true), 3000, "background tab");
  assert.deepEqual(compiled, ["art", "emb", "tile", "fuel", "show"]);
  assert.equal(gl.live.size, 0, "throwaway programs and shaders deleted");
  assert.ok(rafCalls > 0, "a frame is still asked for (a fronted tab polls once a frame)");
}

// 2. parallel: every background link starts before any of them is done; a slow one does not hold the others' start
{
  polls = 0;
  const gl = mockGl({ linkPolls: (src) => (src === "art" ? 40 : 2) }); setRenderer(gl); compiled.length = 0;
  const list = ["art", "emb", "tile", "fuel", "show", "front", "smoke", "ground", "emit", "occ"].map((n) => prog(n));
  await within(warmPrograms(list, () => true), 5000, "parallel");
  const first = gl.log.filter(([k]) => k === "link");
  assert.equal(first.length, 10);
  assert.ok(first.every(([, , at]) => at === 0), "all ten links issued at once, before the first poll");
  assert.equal(compiled.length, 10);
  assert.equal(gl.live.size, 0);
}

// 3. GLSL 1: the relink with sorted attribute bindings (as PIXI 7 does it) still happens, once, after the first link completes
{
  const gl = mockGl(); setRenderer(gl); compiled.length = 0;
  await within(warmPrograms([prog("g1", false), prog("g3", true)], () => true), 3000, "glsl1");
  const links = gl.log.filter(([k]) => k === "link").map(([, s]) => s);
  assert.deepEqual(links.sort(), ["g1", "g1", "g3"]);
}

// 4. already compiled programs are skipped; no longer live: it stops, frees everything, compiles nothing
{
  const gl = mockGl({ linkPolls: () => 1e9 }); setRenderer(gl); compiled.length = 0;
  const done = prog("done"); done.glPrograms = { 7: {} };
  let alive = true; realTimeout(() => { alive = false; }, 30);
  await within(warmPrograms([done, prog("slow")], () => alive), 3000, "cancel");
  assert.deepEqual(compiled, []);
  assert.equal(gl.live.size, 0);
  assert.ok(!gl.log.some(([, s]) => s === "done"), "a compiled program is not linked again");
}

// 5. warmLink alone (exported) also completes without requestAnimationFrame
{
  const gl = mockGl(); setRenderer(gl);
  await within(warmLink(gl, prog("one"), () => true), 3000, "warmLink");
  assert.equal(gl.live.size, 0);
}

// 6. no KHR_parallel_shader_compile: plain PIXI compiles (one per idle callback), all of them
{
  const gl = mockGl({ ext: false }); setRenderer(gl); compiled.length = 0;
  globalThis.requestIdleCallback = (f) => realTimeout(f, 1);
  await within(warmPrograms([prog("a"), prog("b")], () => true), 3000, "no ext");
  assert.deepEqual(compiled, ["a", "b"]);
  assert.equal(gl.log.length, 0, "no background links without the extension");
}

console.log("gl-warm: 6 checks ok (no-rAF background tab, parallel links, GLSL 1 relink, skip/cancel, warmLink, no-KHR)");
