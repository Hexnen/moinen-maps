// The presets polish (WOW pass on bomb, grenade, uzi, heliHmg), the pure parts:   node dev/presets-polish.test.mjs
//   A. the impact order: a blast preset's crater (and the grenade's shrapnel) opens AFTER the fireball's white core (>= 150 ms after
//      the burst), so no ruin, charred ring or pale front shows round the impact before the fireball covers it
//   B. the guns: the first round of the first gun is a tracer (the run reads from its first hit); both heli guns still fire tracers
//   C. the timed strokes' pieces: a strict entry never starts a piece before its stroke and gives it no anticipation shiver (the
//      shiver showed the crater's ring before the blast reached it); the GPU piece shader's divisor stays > 0
//   D. the night rim (cause-fx addRim): the inside lift is mottled (never one even level), the lips' band is lit by the side facing
//      the light (no even pale ring round a round decal at night)
import * as C from "../scripts/presets/core.mjs";
import { BUILTIN } from "../scripts/presets/defs.mjs";
import { readFileSync } from "node:fs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const RECT = { x: 0, y: 0, width: 3000, height: 2000 };
const ENV = { grid: 100, rect: RECT, now: 1_800_000_000_000, wind: { dir: 45, speed: 0.4 } };
const get = (id) => BUILTIN.find((d) => d.id === id);
const layer = (id, lid) => get(id).layers.find((l) => l.id === lid);

/* A */
for ( const id of ["bomb", "grenade"] ) {
  const burst = get(id).layers.filter((l) => l.l === "burst").map((l) => l.at ?? 0), b0 = Math.min(...burst);
  for ( const L of get(id).layers.filter((l) => l.l === "destruction" && ["crater", "shrapnel"].includes(l.id)) )
    ok((L.at ?? 0) - b0 >= 150, `${id}/${L.id}: opens >= 150 ms after the burst (at ${L.at}, burst ${b0})`);
}
ok(layer("grenade", "crater").cause === "fire", "grenade crater is charred (cause fire)");

/* B */
{
  const G = { line: { a: [1000, 900], b: [1800, 1100] }, run: { a: [600, 1000], b: [2400, 1000] } };
  for ( const [id, g] of [["uzi", G.line], ["heliHmg", G.run]] ) for ( const seed of [1, 7, 99] ) {
    const P = C.expand(get(id), g, { seed }, ENV), tr = P.pending.accent.find((a) => a.kind === "tracer");
    if ( !tr ) continue;
    const hx = P.pending.accent.find((a) => a.kind === "hitFx");
    const all = (hx?.hits ?? tr.hits).filter((h) => h[3] === 0), t0 = Math.min(...all.map((h) => h[2]));
    ok(tr.hits.some((h) => h[3] === 0 && h[2] === t0), `${id}/${seed}: the first round of the first gun is a tracer`);
    if ( id === "heliHmg" ) ok(new Set(tr.hits.map((h) => h[3])).size === 2, `heli/${seed}: tracers on both guns`);
  }
}

/* C */
{
  const src = readFileSync(new URL("../scripts/destruction/display.mjs", import.meta.url), "utf8");
  ok(/const t0 = strict \? Math\.max\(start, t1\) : t1;/.test(src), "strict entry: no piece starts before its stroke");
  const m = src.match(/const pre = strict \? ([0-9.]+) :/);
  ok(m && Number(m[1]) > 0 && Number(m[1]) <= 0.05, "strict entry: no shiver, and a divisor > 0 for the GPU piece shader");
}

/* D */
{
  const src = readFileSync(new URL("../scripts/destruction/cause-fx.mjs", import.meta.url), "utf8");
  ok(/const inner = lift \* \(0\.2 \+ 0\.45 \* vn\(/.test(src), "rim: the inside lift is mottled and low");
  ok(/const lit = 0\.15 \+ 0\.85 \* Math\.pow\(Math\.max\(0, \(face \+ 1\) \/ 2\)/.test(src), "rim: the lips' band follows the light's side");
}

console.log(fails ? `presets-polish: ${fails}/${n} FAILED` : `presets-polish: ${n} checks ok`);
if ( fails ) process.exit(1);
