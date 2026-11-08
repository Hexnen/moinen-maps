/**
 * SHADER PRE-WARM, shared (fire; the weather keeps its own copy in weather.mjs for now): PIXI programs compiled and linked in the
 * background after a scene opens, so the frame that first draws with them does not block on the GPU process (on a program-cache miss
 * one link is 0.3 s to several seconds of frozen main thread).
 *
 * With KHR_parallel_shader_compile each program is first compiled and linked off the main thread EXACTLY as PIXI 7's generateProgram
 * will (the program's own processed sources, the same link; for GLSL 1 the sorted attribute bindings and the relink), polled once a
 * frame and thrown away: the browser's program cache then holds it, and PIXI's own compile of it (one per frame, next) is a cache hit
 * of a few ms. Without the extension: one plain PIXI compile per idle callback. Programs PIXI has already compiled are skipped.
 */

const frame = () => new Promise((res) => requestAnimationFrame(() => res()));
const idle = () => new Promise((res) => (globalThis.requestIdleCallback ?? setTimeout)(() => res(), { timeout: 1000 }));

/** One program compiled and linked in the background, the way PIXI 7's generateProgram does it (its throwaway twin warms the cache). */
export async function warmLink(gl, p, live) {
  const ext = gl?.getExtension?.("KHR_parallel_shader_compile");
  if ( !ext ) return idle();
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const vs = sh(gl.VERTEX_SHADER, p.vertexSrc), fs = sh(gl.FRAGMENT_SHADER, p.fragmentSrc), prog = gl.createProgram();
  const done = async () => { while ( live() && !gl.getProgramParameter(prog, ext.COMPLETION_STATUS_KHR) ) await frame(); return live(); };
  try {
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if ( !(await done()) || !gl.getProgramParameter(prog, gl.LINK_STATUS) ) return;
    if ( /^[ \t]*#[ \t]*version[ \t]+300[ \t]+es[ \t]*$/m.test(p.vertexSrc) ) return;
    const names = [];
    for ( let i = 0, n = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES); i < n; i++ ) {
      const a = gl.getActiveAttrib(prog, i);
      if ( a && !a.name.startsWith("gl_") ) names.push(a.name);
    }
    names.sort((a, b) => (a > b ? 1 : -1)).forEach((name, i) => gl.bindAttribLocation(prog, i, name));
    gl.linkProgram(prog);
    await done();
  } finally { gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs); }
}

/**
 * Pre-warm the PIXI programs `list` on the canvas renderer while `live()` holds: each linked in the background (warmLink), then PIXI's
 * own compile of it on the next frame (a cache hit). Resolves when done (or no longer live).
 */
export async function warmPrograms(list, live) {
  for ( const p of list ) {
    if ( !live() ) return;
    const r = canvas.app.renderer;
    if ( p.glPrograms?.[r.CONTEXT_UID] ) continue;
    try { await warmLink(r.gl, p, live); } catch { /* compiled on first use */ }
    if ( !live() || p.glPrograms?.[r.CONTEXT_UID] ) continue;
    await frame();
    if ( !live() ) return;
    try { r.shader.bind(new PIXI.Shader(p, {}), true); r.shader.reset(); } catch { /* compiled on first use */ }
  }
}
