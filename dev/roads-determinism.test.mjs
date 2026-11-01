// Roads: determinism checks of the traffic simulation, outside Foundry.   node dev/roads-determinism.test.mjs
//  1. every traffic setting traffic.mjs reads is in Model.SIM_KEYS (a setting missing there would keep running clients on the old
//     simulation while clients that load later use the new one: different cars on different screens);
//  2. each SIM_KEYS setting changes the simulation (fingerprint differs), each display-only one does not;
//  3. the same inputs give the same fingerprint twice, also after the flag's JSON round trip.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.Hooks = { on() {}, once() {}, callAll() {} };
globalThis.foundry = { utils: { deepClone: (o) => structuredClone(o) } };
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const G = await imp("scripts/roads/graph.mjs");
const M = await imp("scripts/roads/model.mjs");
const T = await imp("scripts/roads/traffic.mjs");

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };

// 1. static: the settings the simulation reads
const src = fs.readFileSync(path.join(root, "scripts/roads/traffic.mjs"), "utf8");
const read = new Set([...src.matchAll(/\b(?:this\.)?T\.([a-z]+)\b/g)].map((m) => m[1]));
const DISPLAY = new Set(["on", "lights", "who", "style"]);
for ( const k of read ) check(M.SIM_KEYS.includes(k) || DISPLAY.has(k), `traffic.mjs reads T.${k}: ${M.SIM_KEYS.includes(k) ? "in SIM_KEYS" : "display only"}`);
for ( const k of Object.keys(M.TRAFFIC_DEFAULTS) ) check(M.SIM_KEYS.includes(k) || DISPLAY.has(k), `setting ${k} is classified`);

// a small network: a cross with a junction, a curved road and an edge exit
const g = 100, rect = { x: 0, y: 0, width: 4000, height: 3000 };
const R0 = M.blank();
const st = { k: "asphalt", w: 0.9, l: 2, o: 0 };
G.addStroke(R0.G, [0, 1500, 1500, 1480, 2800, 1500, 3990, 1520], st, g, 45);
G.addStroke(R0.G, [2000, 300, 2010, 1500, 1990, 2700], st, g, 45);
G.addStroke(R0.G, [600, 600, 1400, 1200, 2300, 2400], { ...st, k: "dirt", w: 0.7 }, g, 45);
const canon = (r) => M.load({ flags: { "moinen-maps": { roads: JSON.parse(JSON.stringify(M.encode(r))) } } });
const base = canon({ ...R0, traffic: M.cleanTraffic({ density: 1, vary: 0.2 }) });

const fp = (R, steps = 1500) => {
  const sim = new T.TrafficSim(T.buildNetwork(R, g, rect), R.traffic, "scene", 7);
  T.catchUp(sim, steps, 1e9);
  return T.fingerprint(sim);
};
const f0 = fp(base);
check(f0 === fp(canon(base)), "same inputs, same fingerprint (after the JSON round trip too)");

// 2. one change at a time
const CHANGES = { density: 0.6, speed: 1.4, size: 0.3, vary: 0.4, max: 5, kinds: ["bus"], side: "left", seed: 42, on: false, lights: "on", who: "gm", style: "pixel" };
for ( const [k, v] of Object.entries(CHANGES) ) {
  const R = canon({ ...base, traffic: M.cleanTraffic({ ...base.traffic, [k]: v }) });
  const changed = fp(R) !== f0;
  if ( M.SIM_KEYS.includes(k) ) check(changed, `${k} changes the simulation (and is in SIM_KEYS)`);
  else check(!changed, `${k} does not change the simulation (display only)`);
}

console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
