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

// one poll step: the next frame, or 50 ms, whichever comes first - a background tab gets no requestAnimationFrame at all (Chrome),
// so a frame-only poll stalled the whole warm-up (and with it the first fire display) until the tab was fronted
const frame = () => new Promise((res) => {
  let t = 0; const id = requestAnimationFrame(() => { clearTimeout(t); res(); });
  t = setTimeout(() => { cancelAnimationFrame(id); res(); }, 50);
});
const idle = () => new Promise((res) => (globalThis.requestIdleCallback ?? setTimeout)(() => res(), { timeout: 1000 }));

/**
 * Start one program's background compile + link, the way PIXI 7's generateProgram does it (its throwaway twin warms the cache).
 * Returns a stepper: each call checks completion once (never blocks) and moves the job on (the GLSL 1 relink with sorted attribute
 * bindings once the first link is done); true when finished (or failed). `drop()` frees the GL objects.
 */
function linkJob(gl, ext, p) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const vs = sh(gl.VERTEX_SHADER, p.vertexSrc), fs = sh(gl.FRAGMENT_SHADER, p.fragmentSrc), prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  let stage = /^[ 	]*#[ 	]*version[ 	]+300[ 	]+es[ 	]*$/m.test(p.vertexSrc) ? 1 : 0, over = false;
  const step = () => {
    if ( over ) return true;
    if ( !gl.getProgramParameter(prog, ext.COMPLETION_STATUS_KHR) ) return false;
    if ( stage === 0 && gl.getProgramParameter(prog, gl.LINK_STATUS) ) {
      const names = [];
      for ( let i = 0, n = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES); i < n; i++ ) {
        const a = gl.getActiveAttrib(prog, i);
        if ( a && !a.name.startsWith("gl_") ) names.push(a.name);
      }
      names.sort((a, b) => (a > b ? 1 : -1)).forEach((name, i) => gl.bindAttribLocation(prog, i, name));
      gl.linkProgram(prog); stage = 1;
      return false;
    }
    return (over = true);
  };
  const drop = () => { over = true; gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs); };
  return { step, drop };
}

/** One program compiled and linked in the background (linkJob), polled to the end while `live()` holds. */
export async function warmLink(gl, p, live) {
  const ext = gl?.getExtension?.("KHR_parallel_shader_compile");
  if ( !ext ) return idle();
  const j = linkJob(gl, ext, p);
  try { while ( live() && !j.step() ) await frame(); } finally { j.drop(); }
}

/**
 * Pre-warm the PIXI programs `list` on the canvas renderer while `live()` holds. With KHR_parallel_shader_compile ALL their background
 * links are started at once and polled together (the GPU process links them in parallel: on a program-cache miss ten programs one
 * after another took ~14 s, the first fire display waiting the whole time), then PIXI's own compile of each, one per poll step (cache
 * hits). Without the extension: one plain PIXI compile per idle callback. Resolves when done (or no longer live).
 */
export async function warmPrograms(list, live) {
  const r = canvas.app.renderer, gl = r.gl, uid = r.CONTEXT_UID;
  const ext = gl?.getExtension?.("KHR_parallel_shader_compile");
  const cold = list.filter((p) => !p.glPrograms?.[uid]);
  const pixi = (p) => { try { r.shader.bind(new PIXI.Shader(p, {}), true); r.shader.reset(); } catch { /* compiled on first use */ } };
  if ( ext ) {
    const jobs = [];
    try {
      for ( const p of cold ) { try { jobs.push(linkJob(gl, ext, p)); } catch { /* compiled on first use */ } }
      let open = jobs.slice();
      while ( live() && open.length ) {
        open = open.filter((j) => { try { return !j.step(); } catch { return false; } });
        if ( open.length ) await frame();
      }
    } finally { for ( const j of jobs ) j.drop(); }
  }
  for ( const p of cold ) {
    if ( !live() ) return;
    if ( p.glPrograms?.[uid] ) continue;
    await (ext ? frame() : idle());
    if ( !live() || p.glPrograms?.[uid] ) continue;
    pixi(p);
  }
}
