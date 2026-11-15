// LETR KEEPBOX: do two seats given the SAME impact calls draw the same pictures? (ADVX 6: a rapid series of hits, identical calls on GM and
// player, drew a star on one seat where the other showed nothing, halftone and white frames on one where the other showed debris.)
// Each seat runs in its own process on the engine's fake browser (testenv.mjs) with its own frame timing (60 fps, 30 fps with stalls,
// 20 fps), its own clock origin and its own network delay, and the GM seat also letters private words (enemy damage numbers with their
// own flash accent) the player never gets. Every seat records, per call, how it ended and the drawings it showed in order (type, and
// whether the guard quieted it). The seats with the same safety settings must agree exactly; a reduced-motion seat must agree with
// another reduced-motion seat. Run by check-impact.mjs (`run`), or alone: node check-seats.mjs  -> "impact seats: N checks, F failed".
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

/* the calls, on the SHARED clock (ms): sent at `t`, the blow at `blow`. The rapid series is take C 16-19 of the review (log-C.json): five
   one-point hits 0.48 s apart, same kinds, strengths, series places; then a series so fast that the blows' windows overlap (a stronger
   blow cuts the one before), then a knock-down, then a slash and a blast one tick apart (the second refused or taking over). */
const LEAD = 222;
export const CALLS = (() => {
  const out = [];
  const add = (t, spec, gmWord = true) => out.push({ t, blow: t + LEAD, spec, gmWord });
  [["hit", 0.25, 0], ["hit", 0.6, 1], ["heavy", 0.54, 2], ["heavy", 0.89, 3], ["crit", 0.74, 4]].forEach(([kind, magnitude, series], i) =>
    add(1000 + i * 483, { kind, magnitude, series, seed: `B85H|${i}|impact` }));
  [["hit", 0.5, 0], ["hit", 0.7, 1], ["heavy", 0.8, 2], ["heavy", 1.0, 3], ["ko", 1.4, 4], ["hit", 0.4, 0]].forEach(([kind, magnitude, series], i) =>
    add(5000 + i * 150, { kind, magnitude, series, seed: `fast|${i}` }));
  add(8000, { kind: "ko", magnitude: 1.55, series: 3, seed: "ko|1" });
  add(8600, { kind: "slash", magnitude: 1.2, seed: "sl|1" });
  add(8640, { kind: "blast", magnitude: 1.5, seed: "bl|1" }, false);
  add(10200, { kind: "crit", magnitude: 1.7, seed: "cr|2" });
  add(10500, { kind: "hit", magnitude: 1.0, seed: "h|9" });
  return out;
})();

/* one seat: { step (ms per display frame), stall: [every n-th frame, ms], origin (page clock at shared 0), delay (network, ms),
   gm (letters the private number words), motion } -> per call { why, shown: ["type" | "type~" (quieted)] } */
async function seat(cfg) {
  const { setup } = await import("../testenv.mjs");
  const E = await setup();
  const L = E.engine;
  const T = await import("../tools.mjs");
  try { T.install(L); } catch {}
  T.state.prefs = { ...T.state.prefs, enabled: true, motion: cfg.motion ?? "full", flashes: true, photosafe: true };
  const board = document.createElement("div");
  document.getElementById = (id) => (id === "board" ? board : null);
  document.createElementNS = (ns, t) => { const el = document.createElement(t); el.querySelectorAll = () => [{ setAttribute() {} }, { setAttribute() {} }]; return el; };
  globalThis.canvas ??= {};
  let started = true;
  canvas.app = { ...(canvas.app ?? {}), ticker: { get started() { return started; }, stop() { started = false; }, start() { started = true; } }, view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } };
  const { createImpact } = await import("./index.mjs");
  const I = createImpact({ get prefs() { return T.state.prefs; } }, T);
  /* this page's clock at shared time 0 */
  await E.tick(cfg.origin, 50);
  const page0 = E.now(), toPage = (s) => page0 + s;
  const pending = CALLS.map((c, i) => ({ ...c, i, arrive: c.t + cfg.delay + (cfg.jitter ? ((i * 37) % 11) : 0) })).sort((a, b) => a.arrive - b.arrive);
  const rec = CALLS.map(() => ({ why: null, shown: [] }));
  const live = [];
  let frame = 0;
  const end = Math.max(...CALLS.map((c) => c.blow)) + 1200;
  while ( E.now() - page0 < end ) {
    while ( pending.length && pending[0].arrive <= E.now() - page0 ) {
      const c = pending.shift();
      /* the event's words: the sound word on every seat (flash: false, the caller's pairing), the damage number on the GM only */
      try { L.play("POW!", { mood: "impact", magnitude: 0.3, seed: `${c.spec.seed}|w`, startAt: toPage(c.blow), flash: false, space: "screen", at: { x: 400, y: 300 } }); } catch {}
      if ( cfg.gm && c.gmWord ) try { L.play("-1", { mood: "impact", magnitude: 0.3, seed: `${c.spec.seed}|n`, startAt: toPage(c.blow + 167), space: "screen", at: { x: 460, y: 300 } }); } catch {}
      const h = I.play({ ...c.spec, blowAt: toPage(c.blow), subject: { x: 400, y: 300 } });
      if ( !h.alive ) { rec[c.i].why = await h.finished; continue; }
      live.push({ h, i: c.i, last: -1 });
      h.finished.then((w) => (rec[c.i].why = w));
    }
    frame++;
    const st = cfg.stall && frame % cfg.stall[0] === 0 ? cfg.stall[1] : cfg.step;
    await E.tick(st, st);
    for ( const x of live ) {
      if ( x.h.idx !== x.last && x.h.idx >= 0 ) {
        const f = x.h.plan.frames[x.h.idx];
        rec[x.i].shown.push(f.type + (f.fig ? ":" + f.fig : "") + (f.quieted ? "~" : ""));   // IMPACT3: with the figures' part
        x.last = x.h.idx;
      }
    }
  }
  await E.tick(200, 50);
  return { rec, log: T.state.flashLog.length };
}

const SEATS = {
  gm60: { step: 1000 / 60, origin: 3000, delay: 0, gm: true },
  pl30: { step: 1000 / 30, stall: [9, 120], origin: 7777, delay: 31, gm: false, jitter: true },
  pl20: { step: 50, origin: 12345, delay: 12, gm: false },
  gm144: { step: 1000 / 144, origin: 500, delay: 4, gm: true },
  red60: { step: 1000 / 60, origin: 3000, delay: 0, gm: true, motion: "reduced" },
  red30: { step: 1000 / 30, stall: [7, 100], origin: 9000, delay: 25, gm: false, motion: "reduced" }
};

/* the seats run side by side (one process each: the fake browser replaces globals) */
function runSeat(name) {
  return new Promise((res) => {
    const ch = spawn(process.execPath, [fileURLToPath(import.meta.url), "--seat", name], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const kill = setTimeout(() => ch.kill(), 240000);
    ch.stdout.on("data", (d) => (out += d)); ch.stderr.on("data", (d) => (err += d));
    ch.on("close", (code) => {
      clearTimeout(kill);
      const line = out.split(/\r?\n/).find((l) => l.startsWith("SEAT "));
      res(line ? JSON.parse(line.slice(5)) : { err: `${code} ${err.slice(0, 600)}` });
    });
  });
}

export async function run(ok) {
  const names = Object.keys(SEATS), out = await Promise.all(names.map(runSeat));
  const res = Object.fromEntries(names.map((n, i) => [n, out[i]]));
  for ( const [n, r] of Object.entries(res) ) ok(!r.err, `impact seats: seat ${n} ran (${r.err ?? ""})`);
  if ( Object.values(res).some((r) => r.err) ) return res;
  const fmt = (r, i) => `${r.rec[i].why}:${r.rec[i].shown.join(",")}`;
  const same = (a, b, tag) => {
    const diff = CALLS.map((c, i) => (fmt(res[a], i) === fmt(res[b], i) ? null : `#${i} ${c.spec.kind} ${c.spec.magnitude}: ${a}=${fmt(res[a], i)} | ${b}=${fmt(res[b], i)}`)).filter(Boolean);
    ok(!diff.length, `impact seats: ${tag}: ${a} and ${b} draw the same pictures${diff.length ? "\n   " + diff.join("\n   ") : ""}`);
  };
  same("gm60", "pl30", "GM at 60 fps (with its private numbers) vs player at 30 fps with stalls and 31 ms later");
  same("gm60", "pl20", "GM at 60 fps vs player at 20 fps");
  same("gm60", "gm144", "60 vs 144 fps");
  same("red60", "red30", "two reduced-motion seats");
  /* every played drawing of the full seats was shown (no drawing skipped at 20 fps or in a stall) */
  const full = CALLS.map((c, i) => res.gm60.rec[i]).filter((r) => r.why === "done");
  ok(full.length >= 8, `impact seats: the calls mostly play (${full.length} of ${CALLS.length} done)`);
  ok(CALLS.some((c, i) => res.gm60.rec[i].why === "replaced") && CALLS.some((c, i) => res.gm60.rec[i].why === "busy"), "impact seats: the series exercises both a take-over and a refusal");
  ok(CALLS.some((c, i) => res.gm60.rec[i].shown.some((s) => s.endsWith("~"))), "impact seats: the guard thins the rapid series (the case that differed)");
  return res;
}

if ( process.argv.includes("--seat") ) {
  const name = process.argv[process.argv.indexOf("--seat") + 1];
  const r = await seat(SEATS[name]);
  console.log("SEAT " + JSON.stringify(r));
  process.exit(0);
} else if ( process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href ) {
  let n = 0, failed = 0;
  const ok = (c, msg) => { n++; if ( !c ) { failed++; console.log("FAIL", msg); } };
  const res = await run(ok);
  if ( process.argv.includes("--show") ) for ( const [k, r] of Object.entries(res) ) { console.log(k); r.rec?.forEach((x, i) => console.log("  ", i, CALLS[i].spec.kind, CALLS[i].spec.magnitude, x.why, x.shown.join(","))); }
  console.log(`impact seats: ${n} checks, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
