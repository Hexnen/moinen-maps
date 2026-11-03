// Paste into a lane tab console: window.__probe records long frames (gaps >= 60 ms) and which wrapped zones overlap them; __probe.report(), __probe.stop().
(async () => {
const A = game.modules.get("moinen-maps").api.destruction, D = A.display ? A.display() : null;
const P = window.__probe = { zones: [], gaps: [], heap: [], on: true };
const now = () => performance.now();
const rec = (name, t0, t1 = now()) => { if (t1 - t0 >= 3) P.zones.push([name, t0, t1]); };
const wrap = (o, k, name) => { const f = o[k]; if (!f || f.__w) return; const w = function (...a) { const t = now(); try { return f.apply(this, a); } finally { rec(name, t); } }; w.__w = 1; o[k] = w; };
// WebGL uploads
const gl = canvas.app.renderer.gl;
for (const k of ["texImage2D", "texSubImage2D", "bufferSubData", "bufferData", "readPixels", "generateMipmap", "finish", "flush"]) wrap(gl, k, "gl." + k);
wrap(Worker.prototype, "postMessage", "postMessage");
const od = Object.getOwnPropertyDescriptor(Worker.prototype.__proto__ || Worker.prototype, "onmessage");
// message handlers (bake.mjs sets worker.onmessage)
const proto = Worker.prototype;
const d2 = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(proto), "onmessage") ?? Object.getOwnPropertyDescriptor(proto, "onmessage");
if (d2 && !d2.__w) { Object.defineProperty(proto, "onmessage", { configurable: true, get() { return d2.get.call(this); }, set(f) { d2.set.call(this, f && ((ev) => { const t = now(); try { return f.call(this, ev); } finally { rec("worker.onmessage", t); } })); } }); }
const T = canvas.app.ticker;
for (const k of ["update"]) wrap(T, k, "ticker.update");
if (D) for (const k of ["sync", "tick"]) wrap(D, k, "display." + k);
const sm = window.setTimeout;
// a gap detector with the heap
let last = now(), lastHeap = performance.memory.usedJSHeapSize;
P.gi = setInterval(() => { const n = now(), g = n - last, h = performance.memory.usedJSHeapSize; if (g > 30) P.gaps.push({ t0: last, t1: n, g: Math.round(g), dh: Math.round((h - lastHeap) / 1048576) }); last = n; lastHeap = h; }, 4);
P.hi = setInterval(() => { P.heap.push([now(), Math.round(performance.memory.usedJSHeapSize / 1048576)]); }, 100);
P.stop = () => { clearInterval(P.gi); clearInterval(P.hi); };
P.report = () => P.gaps.filter(g => g.g >= 60).map(g => { const ov = {}; for (const [n, a, b] of P.zones) { const o = Math.min(b, g.t1) - Math.max(a, g.t0); if (o > 0) ov[n] = Math.round((ov[n] ?? 0) + o); } return `${g.g}ms dHeap${g.dh}: ` + JSON.stringify(ov); });
return "ok";
})()
