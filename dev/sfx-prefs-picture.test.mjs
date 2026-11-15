// GMALLMAPS, "no picture changes": a table whose lettering values equal today's defaults letters exactly what it lettered before the
// options became the table's. The settings resolution of the runtime (sfx.mjs mode / lang / layerOpts and the seat's share of a moment)
// is taken as SOURCE from both trees - the base before GMALLMAPS (git 6c94f43) and this one - and fed the stored values a seat had:
// before, every seat's own client defaults next to the world's values; now, the world values alone. Two seats (another window, zoom,
// own size, words up, clock, interface language) then plan a destruction moment and a preset firing's page on the real engine in node
// (scripts/letters/testenv.mjs, read only), the same planning code the runtime runs (sfx-table), and log every word they draw (key,
// text, size, place, instant, layer, words). The logs (sha1 per seat and case) must be equal; a probe (one table value changed) must
// change them, so a blind harness cannot pass.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "6c94f43";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; if ( process.env.PREFS_VERBOSE ) console.log("  ok", m); };
const failed = [];
const group = async (id, fn) => { try { await fn(); } catch ( err ) { failed.push(`${id}: ${String(err?.message ?? err).split(/\r?\n/)[0]}`); } };

const C = await import(pathToFileURL(path.join(root, "scripts/sfx/sfx-core.mjs")).href);
const PG = await import(pathToFileURL(path.join(root, "scripts/sfx/sfx-page.mjs")).href);
const SEAT = await import(pathToFileURL(path.join(root, "scripts/sfx/sfx-seat.mjs")).href);
const T = await import(pathToFileURL(path.join(root, "scripts/sfx/sfx-table.mjs")).href);
const SZ = await import(pathToFileURL(path.join(root, "scripts/sfx/sfx-size.mjs")).href);
const PF = await import(pathToFileURL(path.join(root, "scripts/sfx/sfx-prefs.mjs")).href);
const { setup } = await import(pathToFileURL(path.join(root, "scripts/letters/testenv.mjs")).href);
const { sizeFor } = await import(pathToFileURL(path.join(root, "scripts/letters/size.mjs")).href);
const E = await setup({ gm: true });
const L = E.engine; L.lookStyle("invincible");
const G = 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

/* ---- the runtime's resolution, as source, from both trees */
const NOW = fs.readFileSync(path.join(root, "scripts/sfx/sfx.mjs"), "utf8");
const OLD = execFileSync("git", ["show", `${BASE}:scripts/sfx/sfx.mjs`], { cwd: root, maxBuffer: 64 << 20 }).toString("utf8");
const line = (src, re, what) => { const m = src.match(re); if ( !m ) throw new Error(`${what} not found`); return m[0]; };
function resolver(src, tag) {
  const body = [
    line(src, /^export const mode = .*$/m, `${tag} mode`).replace(/^export /, ""),
    line(src, /^const lang = .*$/m, `${tag} lang`),
    line(src, /^const layerOpts = .*$/m, `${tag} layerOpts`)
  ].join("\n");
  // (the share of a moment: the old inline lines, or the new call into sfx-prefs)
  const share = /PF\.shareOf\(/.test(src.slice(src.indexOf("function flushMoment")))
    ? "return PF.shareOf(placed, { big, caps, alive: alive.size, capWords: C.capWords });"
    : `${line(src, /^\s*let mine = big \? .*$/m, "old share 1")}\n${line(src, /^\s*const secs = mine\.filter.*$/m, "old share 2")}\n${line(src, /^\s*mine = C\.capWords\(.*$/m, "old share 3")}\nreturn mine;`;
  // eslint-disable-next-line no-new-func
  return new Function("get", "game", "C", "PF", "LAYER_IDS", `${body}\nreturn { mode, lang, layer: () => layerOpts().layer, share: (placed, big, caps, alive) => { ${share} } };`);
}
const R = { old: resolver(OLD, "old"), now: resolver(NOW, "now") };
ok(/PF\.shareOf\(/.test(NOW) && !/get\("sfxWords",/.test(NOW), "this tree reads the table's values only (no seat override)");

/** a seat's stored values (Foundry: a client key from its own browser, a world key from the world) -> its get() */
function storeGet(regs, clientVals, worldVals) {
  return (k, d) => {
    const scope = regs[k]; if ( !scope ) throw new Error(`not registered ${k}`);
    const v = scope === "world" ? worldVals[k] : clientVals[k];
    return v === undefined ? d : v;
  };
}
// (what each tree registers, scope by key: from SFXSIZE / FXLM before, from GMALLMAPS now)
const sizeRegs = Object.fromEntries(SZ.SIZE_GROUPS.map((g) => [SZ.SIZE_SETTING[g], "world"]));
const REGS = {
  old: { sfxLetters: "client", sfxLettersWorld: "world", sfxLayer: "client", sfxWords: "client", sfxWordsWorld: "world", ...sizeRegs },
  now: { sfxLetters: "world", sfxLayer: "world", sfxWordsWorld: "world", [PF.MIGRATED_KEY]: "world", ...sizeRegs }
};

/* ---- two seats (as dev/sfx-seat.test.mjs) */
function seat({ W, H, zoom, scale = 1, off = 0, up = 0, gui = "en" }) {
  return { W, H, zoom, scale, off, up, gui,
    enter() {
      globalThis.innerWidth = W; globalThis.innerHeight = H; canvas.stage.scale.x = canvas.stage.scale.y = zoom; canvas.grid.size = G;
      L.prefs = { ...(L.prefs ?? {}), scale };
      for ( let i = 0; i < up; i++ ) L.play("KRAK", { space: "world", at: { x: 500 + i * 50, y: 500 }, size: 40, fit: "world" });
    } };
}
const SEATS = { A: seat({ W: 1920, H: 1080, zoom: 0.62, gui: "en" }), B: seat({ W: 1366, H: 768, zoom: 1.35, scale: 1.3, off: 53210.5, up: 5, gui: "pl" }) };
const events = (sh) => [
  { key: "d|a|1", sid: "d|a", voice: "crash", x: 2000, y: 1500, r: 180, t: sh(10000), m: 0.8, tPre: sh(9600) },
  { key: "d|b|1", sid: "d|b", voice: "crash", x: 2300, y: 1550, r: 90, t: sh(10030) },
  { key: "d|c|1", sid: "d|c", voice: "boom", x: 1700, y: 1400, r: 140, t: sh(10040), m: 0.7 },
  { key: "f|x|1", sid: "f|x", voice: "fire", x: 2600, y: 1300, r: 120, t: sh(10060), lv: 2 },
  { key: "d|a|deb", sid: "d|a|deb", voice: "debris", x: 2150, y: 1650, r: 60, t: sh(10600), phase: true }
];
function firing() {
  const strokes = new Map([
    ["b1", { id: "b1", k: "burst", p: [2000, 1500], r: 220, lv: 3, q: 20000, db: [300, -200, 700, -260, 180, 900, 120, 320, 1100], wd: 0, ws: 0 }],
    ["s1", { id: "s1", k: "dust", dk: "shock", r: 600, lv: 3, q: 20000 }],
    ["f1", { id: "f1", k: "fire", p: [2100, 1600, 2300, 1650], r: 80, lv: 2, q: 20300, o: 32000 }]
  ]);
  return { rec: { id: "fir1", t0: 20000, seed: 7, size: 1.2, power: 1, at: [2000, 1500], d: [{ id: "d1" }], f: [...strokes.keys()].map((id) => ({ id })) }, strokes };
}
/** one seat, one tree, one store: the log of every word it draws */
function seatLog(name, tree, clientVals, worldVals) {
  const S = SEATS[name];
  const game = { i18n: { lang: S.gui } };
  const get = storeGet(REGS[tree], clientVals, worldVals);
  const r = R[tree](get, game, C, PF, PF.LAYER_IDS);
  const mode = r.mode(), lang = r.lang(), layer = r.layer();
  if ( mode === "off" ) return [`${name}|off`];
  const step = (g) => SZ.stepOf(get(SZ.SIZE_SETTING[g], SZ.SIZE_DEFAULT));
  S.enter();
  const ledger = SEAT.makeLedger(), off = S.off;
  const d = { L, sizeFor, grid: G, sceneId: "scene1", lang, known: null, ledger, toPerf: (t) => t + off, toShared: (t) => t - off, layer: { layer },
    step, memo: new Map(), tokens: () => [{ x0: 1900, y0: 1300, x1: 2000, y1: 1400 }], pins: () => [{ x0: 2200, y0: 1380, x1: 2260, y1: 1500 }], warn: () => {} };
  const out = [];
  const caps = C.CAPS.high, big = mode === "big", alive = { size: 0 };
  for ( const ch of T.moments(events((t) => t + off)) ) for ( const m of T.planMoment(ch, d, []) ) {
    for ( const w of r.share(m.placed, big, caps, alive) ) {
      if ( step(SZ.groupOfVoice(w.voice)) === 0 ) continue;
      const o = T.optsOf(w, d);
      out.push(["m", w.key ?? w.seed, w.text ?? w.kind, r3(o.size ?? 0), r3(w.x), r3(w.y), r3(w.t - off), o.layer, lang].join("|"));
    }
  }
  const { rec, strokes } = firing();
  const pg = PG.firingPage(rec, { grid: G, strokes, lift: 0.5 });
  const tb = T.planPage({ rec, pg, ground: "stone" }, d);
  for ( const [k, q] of tb.entries() ) {
    if ( big && q.role !== "main" ) continue;
    if ( step(SZ.groupOfPageWord({ role: k.replace(/\d+$/, "") })) === 0 ) continue;
    out.push(["p", k, q.dropped ? `dropped:${q.dropped}` : q.text, r3(q.size ?? 0), r3(q.x ?? 0), r3(q.y ?? 0), r3((q.t ?? 0) - off), layer, lang].join("|"));
  }
  return out;
}
const sha = (lines) => crypto.createHash("sha1").update(lines.join("\n")).digest("hex").slice(0, 12);

/* ---- DEFAULTS: every seat's own values at their defaults, the world's as a table had them */
const OLD_CLIENT_DEFAULTS = {};    // (a seat that never touched its own lettering options: nothing stored, the registered defaults)
const WORLDS = [
  { name: "fresh world", w: {} },
  { name: "words fixed English", w: { sfxWordsWorld: "en" } },
  { name: "words fixed Polish", w: { sfxWordsWorld: "pl" } },
  { name: "switch for everyone on", w: { sfxLettersWorld: true, sfxWordsWorld: "pl" } },
  { name: "sizes at today's step", w: { sfxSizeDestruction: 2, sfxSizeFire: 2, sfxSizeWeather: 2 } }
];
await group("DEFAULTS", async () => {
  let lines = 0, cases = 0, same = 0;
  for ( const W of WORLDS ) for ( const s of Object.keys(SEATS) ) {
    cases++;
    const before = seatLog(s, "old", OLD_CLIENT_DEFAULTS, W.w), now = seatLog(s, "now", {}, W.w);
    lines += before.length;
    if ( sha(before) === sha(now) ) same++;
    else { console.log(`DIFF ${W.name} seat ${s}`); const a = new Set(before); for ( const q of now ) if ( !a.has(q) ) console.log("  +", q); }
    if ( process.env.PREFS_VERBOSE ) console.log(`  ${W.name} seat ${s}: ${sha(before)} / ${sha(now)} (${before.length} words)`);
  }
  ok(lines > 60, `the seats drew words (${lines} log lines)`);
  ok(same === cases, `at the defaults every seat draws what it drew before (${same} of ${cases} seat logs equal)`);
});
/* ---- the GM's own values before = the table's now: what the GM saw, every seat sees */
await group("GMSEAT", async () => {
  const mine = { sfxLetters: "big", sfxLayer: "tokens", sfxWords: "pl" };
  const before = seatLog("A", "old", mine, { sfxWordsWorld: "en" });
  const table = PF.migrationPlan({ world: (k) => ({ sfxWordsWorld: "en" })[k], local: (k) => mine[k], done: 0 }).writes;
  const w = { sfxWordsWorld: "en", ...table };
  ok(sha(seatLog("A", "now", {}, w)) === sha(before) && sha(seatLog("B", "now", {}, w)) === sha(seatLog("B", "old", mine, { sfxWordsWorld: "en" })), "after the migration every seat letters what the GM's own seat lettered before");
});
/* ---- PROBE: the harness sees a change */
await group("PROBE", async () => {
  const base = sha(seatLog("A", "now", {}, {}));
  if ( process.env.PREFS_DUMP ) console.log(seatLog("A", "now", {}, {}).join("\n"));
  for ( const [k, v] of [["sfxLayer", "top"], ["sfxWordsWorld", "pl"], ["sfxLetters", "big"], ["sfxSizeDestruction", 3], ["sfxSizeFire", 0]] )
    ok(sha(seatLog("A", "now", {}, { [k]: v })) !== base, `a table value ${k} = ${v} changes the log`);
});

if ( failed.length ) { console.error(failed.join("\n")); console.error(`sfx-prefs-picture: ${failed.length} group(s) failed, ${n} checks passed`); process.exit(1); }
console.log(`sfx-prefs-picture: ${n} checks passed`);
process.exit(0);
