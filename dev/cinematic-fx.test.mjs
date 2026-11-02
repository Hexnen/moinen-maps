// Cinematic screen effects (cinematic-fx-logic.mjs) against a FAKE environment:   node dev/cinematic-fx.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const L = await import(pathToFileURL(path.join(root, "scripts/destruction/cinematic-fx-logic.mjs")).href);
const C = await import(pathToFileURL(path.join(root, "scripts/destruction/cinematic-core.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// ---- fakes
class El {
  constructor(tag) { this.tag = tag; this.style = {}; this.children = []; this.parent = null; this.attrs = {}; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = v; }
  remove() { if ( this.parent ) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  get offsetWidth() { return 1; }
}
function fakeEnv(optsIn = {}) {
  const page = new El("body"), ticks = new Set(), timers = []; let clock = 0, id = 0;
  const f = { pans: [], stops: 0 };
  const stage = { position: { x: 500, y: 300, set(x, y) { this.x = x; this.y = y; } } };
  const display = { look: { speed: 1 } };
  const canvasEl = new EventTarget(), win = new EventTarget();
  const env = {
    doc: { createElement: (t) => new El(t) }, insert: (el) => page.appendChild(el),
    timer: (fn, ms) => { const t = { at: clock + ms, fn, id: ++id, off: false }; timers.push(t); return () => { t.off = true; }; },
    now: () => clock, stage, ticker: { add: (fn) => ticks.add(fn), remove: (fn) => ticks.delete(fn) },
    pan: (v) => { f.pans.push(v); return Promise.resolve(true); }, stopPan: () => { f.stops++; },
    view: () => ({ x: 1000, y: 800, scale: 1, vw: 1600, vh: 900 }), centre: () => ({ x: 1000, y: 800 }),
    canvasEl, win, display: () => display, opts: () => optsIn
  };
  // advance the fake clock by ms, firing timers and ticks every 16 ms
  const run = (ms) => {
    const end = clock + ms;
    while ( clock < end ) {
      clock = Math.min(end, clock + 16);
      for ( const t of timers.filter((q) => !q.off && q.at <= clock).sort((a, b) => a.at - b.at || a.id - b.id) ) { t.off = true; t.fn(); }
      for ( const fn of [...ticks] ) fn();
    }
  };
  return Object.assign(f, { env, page, stage, display, ticks, timers, run, canvasEl, win });
}
const R = (o = {}) => ({ ...C.DEFAULTS, camHold: 200, camReturn: 300, lbOut: 200, lbIn: 100, ...o });
const strokes = [{ id: "s1", p: [100, 100, 0, 600, 100, 800, 1100, 120, 1500] }, { id: "s2", p: [1200, 500, 0, 1300, 700, 400] }];
const live = (f) => f.timers.filter((t) => !t.off).length;

// 1. StageShaker: restore exactly, pan rewrite, never accumulates
{
  const st = { position: { x: 640, y: 360, set(x, y) { this.x = x; this.y = y; } } }, sh = new L.StageShaker(st);
  for ( let i = 0; i < 500; i++ ) sh.apply((i * 7) % 9 - 4, (i * 5) % 7 - 3);
  sh.apply(3, -2); sh.restore();
  eq([st.position.x, st.position.y], [640, 360], "restore after many applies is exact");
  sh.apply(5, 5); st.position.set(700, 400);                      // a pan rewrites the position
  sh.apply(2, 2); ok(st.position.x === 702 && st.position.y === 402, "pan value is the new base");
  sh.restore(); eq([st.position.x, st.position.y], [700, 400], "restore after a pan rewrite");
  sh.restore(); eq([st.position.x, st.position.y], [700, 400], "restore twice is harmless");
}

// 2. overlays: bars with the configured height, colour, alpha; transitions; destroy removes all
{
  const f = fakeEnv(); const r = R({ lbHeight: 14, lbColor: "#112233", lbAlpha: 0.9, vgTint: "#102030", flColor: "#ff0000" });
  ok(L.hexRgb("#102030").join() === "16,32,48", "hexRgb");
  const o = L.createOverlays(f.env.doc, r, C.effective(r, {}), { insert: f.env.insert, timer: f.env.timer });
  eq(f.page.children.length, 1, "one root");
  ok(o.bars.length === 2 && o.bars[0].style.height === "14%" && o.bars[1].style.height === "14%", "bars height");
  ok(o.bars[0].style.background === "#112233" && o.bars[0].style.opacity === "0.9", "bars colour and alpha");
  ok(o.bars[0].style.transform.includes("-100%") && o.bars[1].style.transform.includes("100%"), "bars start hidden");
  ok(o.root.style.pointerEvents === "none", "pointer-events none");
  o.show(); ok(o.bars.every((b) => b.style.transform === "translateY(0)"), "bars in");
  o.flash(1); ok(o.flashEl.style.opacity === "0" && o.flashEl.style.transition.includes(`${r.flDur}ms`), "flash fades");
  o.hide(); ok(o.bars[0].style.transform.includes("-100%"), "bars out");
  o.destroy(); eq(f.page.children.length, 0, "destroyed");
  const none = L.createOverlays(f.env.doc, r, C.effective(r, { noLetterbox: true }), { insert: f.env.insert, timer: f.env.timer });
  ok(none.bars === null, "opted out: no bars"); none.destroy();
}

// 3. the show: begin/impact/end leaves nothing behind
{
  const f = fakeEnv(), fx = L.createFx(() => f.env);
  ok(!fx.active && f.ticks.size === 0 && f.page.children.length === 0, "idle: nothing");
  ok(fx.begin({ r: R() }, { strokes }), "begin");
  ok(fx.active && f.ticks.size === 1 && f.page.children.length === 1, "active: one overlay root, one ticker listener");
  f.run(100);
  fx.impact({ x: 100, y: 100, size: 80, t: 0 });
  f.run(48);
  ok(f.stage.position.x !== 500 || f.stage.position.y !== 300, "shake moves the stage");
  ok(f.pans.length >= 1 && f.pans[0].scale >= 1 && f.pans[0].scale <= 4, "camera leg through pan");
  f.run(2600);
  eq([f.stage.position.x, f.stage.position.y], [500, 300], "shake decayed to the exact start");
  const p = fx.end(); let ended = false; p.then(() => { ended = true; });
  f.run(900); await new Promise((r) => setTimeout(r, 0));
  ok(ended && !fx.active, "end resolves");
  ok(f.ticks.size === 0 && f.page.children.length === 0 && live(f) === 0, "nothing left: no ticker, no overlay, no timers");
  eq([f.stage.position.x, f.stage.position.y], [500, 300], "stage exact after end");
  const last = f.pans.at(-1); ok(last.x === 1000 && last.y === 800 && last.scale === 1, "camera returned to the previous view");
  ok(f.display.look.speed === 1, "entry speed restored");
}

// 4. immediate abort in the middle of a shake restores the stage; double end is safe
{
  const f = fakeEnv(), fx = L.createFx(() => f.env);
  fx.begin({ r: R({ shIntensity: 1, shMax: 40 }) }, { strokes });
  fx.impact({ x: 1, y: 1, size: 300 }); f.run(80);
  ok(f.stage.position.x !== 500 || f.stage.position.y !== 300, "shaking");
  fx.abort(); fx.abort();
  eq([f.stage.position.x, f.stage.position.y], [500, 300], "abort restores");
  ok(!fx.active && f.ticks.size === 0 && f.page.children.length === 0 && live(f) === 0, "abort cleans");
  await fx.end();
}

// 5. a pan rewriting the stage during a shake: the end leaves the PAN's position, not a drifted one
{
  const f = fakeEnv(), fx = L.createFx(() => f.env);
  fx.begin({ r: R({ camOn: false }) }, {});
  fx.impact({ x: 1, y: 1, size: 300 }); f.run(60);
  f.stage.position.set(900, 450);
  f.run(16); fx.abort();
  ok(f.stage.position.x === 900 || Math.abs(f.stage.position.x - 900) < 1, `pan base kept (${f.stage.position.x})`);
}

// 6. camera abort: wheel / pointerdown / key stop it, no return; a lone modifier does not
{
  for ( const [kind, ev] of [["wheel", new Event("wheel")], ["pointerdown", new Event("pointerdown")], ["keydown", Object.assign(new Event("keydown"), { key: "a" })]] ) {
    const f = fakeEnv(), fx = L.createFx(() => f.env), target = kind === "keydown" ? f.win : f.canvasEl;
    fx.begin({ r: R() }, { strokes });
    f.win.dispatchEvent(Object.assign(new Event("keydown"), { key: "Shift" }));
    ok(fx.debug().cameraOn, "modifier alone does not abort");
    target.dispatchEvent(ev);
    ok(!fx.debug().cameraOn && fx.debug().cameraAborted && f.stops === 1, `${kind} aborts the camera at once`);
    const before = f.pans.length;
    fx.impact({ x: 100, y: 100, size: 50 }); f.run(1500);
    ok(f.pans.length === before, "no more camera moves after the abort");
    await fx.end({ immediate: true });
    ok(f.page.children.length === 0 && f.ticks.size === 0, "clean");
  }
}

// 7. client opt-outs and the master switch
{
  const f = fakeEnv({ noLetterbox: true, noShake: true, noCamera: true }), fx = L.createFx(() => f.env);
  fx.begin({ r: R() }, { strokes });
  const d = fx.debug(); ok(!d.bars && !d.cameraOn && d.vignette && d.flash, "opt-outs honoured, the rest plays");
  fx.impact({ x: 1, y: 1, size: 200 }); f.run(100);
  ok(f.stage.position.x === 500 && f.pans.length === 0, "no shake, no pan");
  fx.abort();
  const g = fakeEnv(), fy = L.createFx(() => g.env);
  fy.begin({ r: R({ fx: false }) }, {});
  ok(!fy.debug().bars && !fy.debug().vignette && !fy.debug().flash && !fy.debug().cameraOn, "master switch off: no screen effects");
  fy.abort();
  const h = fakeEnv({ reduced: true }), fz = L.createFx(() => h.env);
  fz.begin({ r: R() }, {}); ok(fz.debug().bars && !fz.debug().cameraOn && !fz.debug().eff.shake && !fz.debug().eff.flash, "reduced motion: bars stay, motion off"); fz.abort();
}

// 8. slow motion: ramps the entry speed for big hits only, restores; a foreign change survives
{
  const f = fakeEnv(), fx = L.createFx(() => f.env);
  fx.begin({ r: R({ camOn: false, smThreshold: 100, smFactor: 0.4, smIn: 100, smOut: 200 }) }, {});
  fx.impact({ x: 1, y: 1, size: 30 }); f.run(300);
  ok(f.display.look.speed === 1, "small hit: no slow motion");
  fx.impact({ x: 1, y: 1, size: 150 }); f.run(300);
  ok(f.display.look.speed < 0.5 && fx.rate < 0.5, `big hit: slowed (${f.display.look.speed})`);
  f.run(1200);
  ok(f.display.look.speed === 1 && fx.rate === 1, "restored after the window");
  fx.impact({ x: 1, y: 1, size: 150 }); f.run(300);
  f.display.look.speed = 1.7;                       // the GM changed it meanwhile
  f.run(1200); ok(f.display.look.speed === 1.7, "foreign change kept");
  fx.abort();
}

// 9. frame-time safety shortens camera legs; frame mode makes one framing move
{
  eq(C.moveDuration(600, 50), 300, "sanity: core shortens");
  const f = fakeEnv(), fx = L.createFx(() => f.env);
  fx.begin({ r: R({ camMode: "frame", camZoomMax: 2 }) }, { strokes });
  ok(f.pans.length === 1 && f.pans[0].scale >= 1 && f.pans[0].scale <= 2, "frame: one move into the band");
  fx.impact({ x: 1, y: 1, size: 100 }); f.run(2000);
  eq(f.pans.length, 1, "frame mode: impacts do not pan");
  fx.abort();
}

// 10. preview: runs the full effects without strokes, then nothing remains; a second preview while active refuses
{
  const f = fakeEnv(), fx = L.createFx(() => f.env);
  const pr = fx.preview({ r: R({ shIntensity: 1 }) });
  ok(fx.active && fx.debug().preview, "preview active");
  ok((await fx.preview({ r: R() })) === false, "no second show over a running one");
  for ( let i = 0; i < 80; i++ ) { f.run(50); await Promise.resolve(); }
  await pr;
  ok(!fx.active && f.page.children.length === 0 && f.ticks.size === 0 && live(f) === 0, "preview left nothing");
  eq([f.stage.position.x, f.stage.position.y], [500, 300], "stage exact after preview");
}

// 11. errors: a throwing pan cannot leave a mess; begin on junk refuses; begin during begin replaces
{
  const f = fakeEnv(); f.env.pan = () => { throw new Error("x"); };
  const fx = L.createFx(() => f.env), log = console.error; console.error = () => {};
  fx.begin({ r: R() }, { strokes }); fx.impact({ x: 1, y: 1, size: 100 }); f.run(100);
  console.error = log;
  fx.abort(); ok(f.page.children.length === 0 && f.ticks.size === 0, "clean after a throwing pan");
  ok(!fx.begin(null), "junk snapshot refused");
  fx.begin({ r: R() }); fx.begin({ r: R() });
  ok(f.page.children.length === 1 && f.ticks.size === 1, "second begin replaced the first");
  fx.abort();
}

// 12. plans: legs stay in the zoom band, frame stays in range
{
  const r = R({ camZoomMin: 1, camZoomMax: 3 });
  const legs = L.planLegs(strokes[0], { x: 0, y: 0, size: 300 }, r, { scale: 0.5, vw: 1600, vh: 900 });
  ok(legs.length >= 1 && legs.every((l) => l.scale >= 0.25 && l.scale <= 2), "legs inside the band");
  const fr = L.planFrame({ x0: 0, y0: 0, x1: 100, y1: 100 }, { scale: 1, vw: 1600, vh: 900 }, r);
  ok(fr.scale <= 3 && fr.scale >= 1, "frame clamped to camZoomMax");
  eq(L.boxOf(strokes, null), { x0: 100, y0: 100, x1: 1300, y1: 700 }, "box of strokes");
}

// 13. a slow return move (animatePan runs on the ticker's clock, slower than the wall clock on a slow machine) is waited for, not cut off
{
  const f = fakeEnv(), fx = L.createFx(() => f.env); let release, returnCalls = 0;
  f.env.pan = (v) => { f.pans.push(v); if ( v.x === 1000 && v.y === 800 ) { returnCalls++; return new Promise((res) => { release = res; }); } return Promise.resolve(true); };
  fx.begin({ r: R() }, { strokes }); fx.impact({ x: 100, y: 100, size: 80 }); f.run(1800);
  const p = fx.end(); let ended = false; p.then(() => { ended = true; });
  f.run(2500); await new Promise((r) => setTimeout(r, 0));
  ok(returnCalls === 1 && !ended && fx.active && f.stops === 0, "return move still running: the show waits, nothing is terminated");
  release(true); await new Promise((r) => setTimeout(r, 0)); f.run(400); await new Promise((r) => setTimeout(r, 0));
  ok(ended && !fx.active && f.page.children.length === 0 && f.ticks.size === 0 && f.stops === 0, "ends cleanly after the move finished");
  // ...but never forever: the cap releases a move that never finishes
  const g = fakeEnv(), fy = L.createFx(() => g.env); g.env.pan = () => new Promise(() => {});
  fy.begin({ r: R() }, { strokes }); const q = fy.end(); let e2 = false; q.then(() => { e2 = true; });
  for ( let i = 0; i < 40; i++ ) { g.run(250); await new Promise((r) => setTimeout(r, 0)); }
  ok(e2 && g.page.children.length === 0, "a move that never finishes is capped");
}
console.log(`cinematic-fx: ${n} checks passed`);
