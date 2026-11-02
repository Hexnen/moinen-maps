// node dev/direction.test.mjs: "follows the stroke" (directional) - the entry clock of a stroke that does NOT follow its path (simul)
//   goes off AT ONCE (a few ms of radial stagger, no sweep across the area); one that follows it runs a front along the painted
//   direction, monotonic along the path, and the reverse path gives the reverse order. (A tear is directional by nature: untouched.)
globalThis.Hooks ??= { on() {}, once() {}, off() {} };
class Stub {}
globalThis.PIXI ??= new Proxy({}, { get: () => Stub });
const E = await import("../scripts/destruction/entry-clock.mjs");
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) fails++; };

const rect = { x0: 0, y0: 0, x1: 300, y1: 60 };
const mk = (type, cause = 0) => ({ x: 0, y: 0, w: 300, h: 60, ex: 150, ey: 30, R: 20, type, mat: 0, cause, axis: 0, len: 0, rect: { ...rect } });
const pts = []; for ( let x = 0; x <= 300; x += 5 ) pts.push([x, 30]);
const along = (rev) => { const n = pts.length, T = 900; const P = (rev ? pts.slice().reverse() : pts); return P.map(([x, y], i) => [x, y, Math.round(i / (n - 1) * T)]); };
const sample = []; for ( let x = 2; x < 300; x += 7 ) for ( let y = 2; y < 60; y += 9 ) sample.push([x, y]);
const spread = (arrive) => { const v = sample.map(([x, y]) => arrive(x, y)); return Math.max(...v) - Math.min(...v); };

for ( const type of ["blast", "scorch", "flood", "cracks"] ) for ( const cause of [0, 1, 2, 3, 4] ) {
  const info = mk(type, cause), hash = 4242 + cause;
  const off = E.clockOf({ info, hash, simul: true });
  const on = E.clockOf({ info, hash, simul: false, path: along(false) });
  const rv = E.clockOf({ info, hash, simul: false, path: along(true) });
  const oldRadial = E.clockOf({ info, hash });   // (before: what "off" gave)
  const sOff = spread(off.arrive), sOn = spread(on.arrive), sOld = spread(oldRadial.arrive);
  ok(off.atOnce && sOff <= E.ATONCE_MS * off.k + 1e-6, `${type}/${cause}: OFF all pieces start within ${sOff.toFixed(1)} ms (was ${sOld.toFixed(0)}, bound ${(E.ATONCE_MS * off.k).toFixed(0)})`);
  ok(!on.atOnce && sOn > 300, `${type}/${cause}: ON spreads ${sOn.toFixed(0)} ms along the stroke`);
  // monotonic along the path (points on the path line, left to right)
  let mono = true, monoR = true, prev = -1, prevR = Infinity;
  for ( let x = 5; x <= 295; x += 5 ) { const a = on.arrive(x, 30), b = rv.arrive(x, 30); if ( a < prev - 1e-6 ) mono = false; if ( b > prevR + 1e-6 ) monoR = false; prev = a; prevR = b; }
  ok(mono && on.arrive(290, 30) - on.arrive(10, 30) > 300, `${type}/${cause}: ON left->right arrives in increasing x`);
  ok(monoR && rv.arrive(10, 30) - rv.arrive(290, 30) > 300, `${type}/${cause}: reversed path arrives in decreasing x`);
}
// a tear keeps its own (directional) clock; a tap that "follows" with no path stays the radial entry
{
  const g = E.clockOf({ info: mk("gash"), hash: 7, simul: true, spine: along(false) });
  ok(!g.atOnce && g.tear, "gash: not at once (directional by nature)");
  const tap = E.clockOf({ info: mk("blast"), hash: 7, simul: false, path: [[10, 10, 0], [11, 10, 20]] });
  ok(!tap.atOnce && spread(tap.arrive) > 100, "a tap with the toggle ON stays the plain radial entry");
}
// the speed scales it, never reorders
{
  const a = E.clockOf({ info: mk("blast"), hash: 1, simul: true, speed: 0.5 }), b = E.clockOf({ info: mk("blast"), hash: 1, simul: true, speed: 2 });
  ok(spread(a.arrive) > spread(b.arrive) && spread(a.arrive) <= 2 * E.ATONCE_MS + 1e-6, "OFF at speed 0.5 / 2 scales the stagger");
}
console.log(fails ? `${fails} FAILED` : "direction clock: all ok");
process.exit(fails ? 1 : 0);
