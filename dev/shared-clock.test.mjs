// Shared clock:   node dev/shared-clock.test.mjs
//   1. ageOf: a fresh moment has its plain age; a moment up to FUTURE_SLACK ahead waits; a moment further ahead (a clock gone wrong),
//      a LEGACY uptime value (game.time.serverTime before the fix, e.g. 6,957,084 saved before a server restart), 0, null or NaN is
//      Infinity = settled (never waited for, never replayed);
//   2. the entry / Detonate decisions destruction.mjs makes with it after a server restart: every legacy entry settles at once;
//   3. refine: the skew is the largest recent sample (the least delayed stamp), bounded history, junk stamps ignored.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call() {} };
const C = await import(pathToFileURL(path.join(root, "scripts/shared-clock.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
ok(C.ageOf(NOW - 1234, NOW) === 1234, "past moment: its age");
ok(C.ageOf(NOW + 700, NOW) === -700, "a moment just ahead waits");
ok(C.ageOf(NOW + C.FUTURE_SLACK, NOW) === -C.FUTURE_SLACK, "slack edge waits");
ok(C.ageOf(NOW + C.FUTURE_SLACK + 1, NOW) === Infinity, "far future = settled");
ok(C.ageOf(NOW + 3 * 3600e3, NOW) === Infinity, "hours ahead = settled");
for ( const v of [6957084, 0, null, undefined, NaN, -5, 999999999999] ) ok(C.ageOf(v, NOW) === Infinity, `legacy/junk ${v} = settled`);

// destruction.mjs: an entry from the flag waits min(0, -age) and is shown settled when age > ENTRY_WINDOW (8000)
const ENTRY_WINDOW = 8000;
const decide = (t, now) => { const age = C.ageOf(t, now); return age > ENTRY_WINDOW ? "settled" : { wait: Math.max(0, -age) }; };
const legacy = [6957084, 6957784, 7012000];
ok(legacy.every((t) => decide(t, NOW) === "settled"), "every legacy entry settles after a restart");
// the old bug: uptime after a restart (small) against stored uptime (large) -> waited hours; the same stored values never wait now
ok(legacy.every((t) => decide(t, 120000) === "settled"), "legacy entries settle even against a small 'now'");
ok(decide(NOW + 700, NOW).wait === 700, "fresh entry plays 700 ms later");
ok(decide(NOW - 3000, NOW).wait === 0, "late arrival plays at once");
ok(decide(NOW - 9000, NOW) === "settled", "old entry settled");
// Detonate: late < 4000 (first) plays, Infinity never
const blastPlays = (t, now, first) => { const late = C.ageOf(t, now); return late < (first ? 4000 : 15000); };
ok(!blastPlays(6957084 + 350, NOW, true) && !blastPlays(6957084 + 350, NOW, false), "legacy blast never replays");
ok(blastPlays(NOW + 350, NOW, false) && blastPlays(NOW - 2000, NOW, true), "fresh blast plays");
ok(!blastPlays(NOW + 60000, NOW, false), "far-future blast skipped");

// refine
const s = [];
ok(C.refine(s, NOW, NOW + 40) === -40, "first sample");
ok(C.refine(s, NOW + 1000, NOW + 1010) === -10, "less delayed sample wins");
ok(C.refine(s, NOW + 2000, NOW + 2200) === -10, "more delayed sample does not lower it");
ok(C.refine(s, 6957084, NOW) === -10 && s.length === 3, "legacy stamp ignored");
for ( let i = 0; i < 20; i++ ) C.refine(s, NOW + i, NOW + i + 50);
ok(s.length === 8 && C.refine(s, NOW, NOW + 50) === -50, "history bounded, old best forgotten");
console.log(`shared-clock: ${n} checks ok`);
