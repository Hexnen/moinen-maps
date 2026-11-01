// Token effects (pure part):   node dev/tokens-fx.test.mjs
//   1. resolution order: per-token override > per-scene > built-in; invalid styles / numbers ignored on their level
//   2. death detection: defeated flag, dead status, HP path (per system, custom), the transitions (first sight never animates)
//   3. style tables: every style has a duration and a pose; enter ends at the identity, leave ends invisible, death ends at deathEnd
//      with full grey; corpse looks; revive ends at the identity; idle stays subtle and is periodic
//   4. determinism: seeds / phases / tilts are stable and spread; the burst stagger and cap; nearest edge
//   5. the scene defaults in config.mjs carry every new key, and the legacy keys still exist
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call() {} };
const S = await import(pathToFileURL(path.join(root, "scripts/tokens/styles.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

/* 1. resolution */
const B = S.FX_DEFAULTS;
let r = S.resolveFx({}, {});
ok(r.enterStyle === B.enterStyle && r.idleStyle === "none" && r.deathStyle === "fall", "built-in when nothing is set");
r = S.resolveFx({ enterStyle: "warp", idleStyle: "bob", speed: 1.5 }, {});
ok(r.enterStyle === "warp" && r.idleStyle === "bob" && r.speed === 1.5, "scene over built-in");
r = S.resolveFx({ enterStyle: "warp", idleStyle: "bob" }, { enter: "portal", idle: "none", death: "melt" });
ok(r.enterStyle === "portal" && r.idleStyle === "none" && r.deathStyle === "melt", "token over scene");
r = S.resolveFx({ enterStyle: "nope", speed: "fast", idleAmp: 99 }, { enter: "bogus", leave: 3, corpse: "fade" });
ok(r.enterStyle === B.enterStyle && r.speed === B.speed && r.idleAmp === 3 && r.leaveStyle === B.leaveStyle && r.corpse === "fade", "invalid values ignored, numbers clamped");
r = S.resolveFx({ who: "gm", hide: false, intensity: 1.3 }, {});
ok(r.who === "gm" && r.hide === false && r.intensity === 1.3, "older keys pass through");
ok(JSON.stringify(S.overridesOf({ enter: "warp", idle: "x", junk: 1, death: "melt" })) === JSON.stringify({ enter: "warp", death: "melt" }), "overridesOf keeps valid ones");
ok(S.resolveFx({ idleWhen: "never", revive: "fly" }).idleWhen === "still" && S.resolveFx({ revive: "instant" }).revive === "instant", "enums checked");
for ( const k of S.OVERRIDE_KEYS ) ok(S.OVERRIDES[k].key in B, `override ${k} maps to a scene key`);
ok(S.resolveFx({}, { enter: "constructor", idle: "toString" }).enterStyle === B.enterStyle && S.resolveFx({ idleStyle: "__proto__" }).idleStyle === "none", "no prototype keys as styles");

/* 2. death */
const rule = { deathDefeated: true, deathStatus: true, deathHp: false };
ok(S.deadFrom({ defeated: true }, rule) && S.deadFrom({ status: true }, rule) && !S.deadFrom({ hp: 0 }, rule), "defeated / status count, hp off");
ok(!S.deadFrom({ defeated: true }, { ...rule, deathDefeated: false }) && !S.deadFrom({ status: true }, { ...rule, deathStatus: false }), "each rule can be off");
ok(S.deadFrom({ hp: 0 }, { ...rule, deathHp: true }) && S.deadFrom({ hp: -3 }, { ...rule, deathHp: true }) && S.deadFrom({ hp: "0" }, { ...rule, deathHp: true }), "hp <= 0 with hp on");
ok(!S.deadFrom({ hp: 2 }, { ...rule, deathHp: true }) && !S.deadFrom({ hp: undefined }, { ...rule, deathHp: true }) && !S.deadFrom({ hp: "" }, { ...rule, deathHp: true }) && !S.deadFrom({ hp: null }, { ...rule, deathHp: true }), "missing / positive hp never dead");
ok(!S.deadFrom({ hp: 0, hpPath: "system.wounds.value" }, { ...rule, deathHp: true }), "wounds count up: skipped");
ok(S.hpPathFor("invincible") === "system.derived.health.value" && S.hpPathFor("dnd5e") === "system.attributes.hp.value", "known system paths");
ok(S.hpPathFor("invincible", " system.hp ") === "system.hp" && S.hpPathFor("unknown") === "", "custom path wins; unknown system none");
ok(S.deathTransition(undefined, true) === null && S.deathTransition(undefined, false) === null, "first sight never animates");
ok(S.deathTransition(false, true) === "die" && S.deathTransition(true, false) === "revive" && S.deathTransition(true, true) === null, "transitions");

/* 3. tables and poses */
const tables = [["enter", S.ENTER_STYLES, S.enterPose], ["leave", S.LEAVE_STYLES, S.leavePose], ["death", S.DEATH_STYLES, S.deathPose]];
for ( const [name, tab, fn] of tables ) {
  ok(tab.none && tab.none.dur === 0, `${name}: has none`);
  for ( const [id, d] of Object.entries(tab) ) {
    if ( id !== "none" ) ok(d.dur > 0.2 && d.dur <= 1.5, `${name}.${id}: duration ${d.dur}`);
    for ( let u = 0; u <= 1.0001; u += 0.05 ) {
      const p = fn(id, u, { tilt: 1, dir: { dx: 1, dy: 0 }, k: 1 });
      ok(Object.values(p).every(Number.isFinite), `${name}.${id} finite at ${u.toFixed(2)}`);
      ok(p.alpha >= -1e-9 && p.alpha <= 1 + 1e-9 && p.sx >= 0 && p.sy >= 0, `${name}.${id} sane at ${u.toFixed(2)}`);
    }
  }
}
for ( const id of Object.keys(S.ENTER_STYLES) ) {
  ok(S.isIdentity(S.enterPose(id, 1, { tilt: -1, dir: { dx: 0, dy: 1 } })), `enter.${id} ends at the token as drawn`);
  if ( !S.ENTER_STYLES[id].legacy && id !== "none" ) ok(S.enterPose(id, 0, { dir: { dx: 1, dy: 0 } }).alpha === 0, `enter.${id} starts invisible`);
}
for ( const id of Object.keys(S.LEAVE_STYLES) ) {
  const p = S.leavePose(id, 1, { dir: { dx: -1, dy: 0 } });
  ok(p.alpha === 0, `leave.${id} ends invisible`);
  if ( id !== "none" ) ok(S.leavePose(id, 0).alpha > 0.7, `leave.${id} starts visible`);
}
for ( const id of Object.keys(S.DEATH_STYLES) ) {
  const end = S.deathPose(id, 1, { tilt: -1 }), want = S.deathEnd(id, -1);
  ok(["x", "y", "sx", "sy", "rot", "alpha"].every((k) => near(end[k], want[k])), `death.${id} ends at deathEnd`);
  ok(id === "none" ? end.grey === 0 : end.grey === 1, `death.${id} grey at the end`);
  ok(S.isIdentity(S.deathPose(id, 0, { tilt: 1 })) || id === "fall" || id === "petrify", `death.${id} starts at rest`);
}
ok(near(S.deathEnd("fall", 1).rot, -S.deathEnd("fall", -1).rot) && Math.abs(S.deathEnd("fall", 1).rot) > 1.3, "fall lies down on the tilt side");
// the fall bounces: after landing the rotation dips below the end and comes back
{ let dip = false; const end = S.deathEnd("fall", 1).rot; for ( let u = 0.65; u < 1; u += 0.01 ) if ( S.deathPose("fall", u, { tilt: 1 }).rot < end - 0.02 ) dip = true; ok(dip, "fall bounces on landing"); }
for ( const c of S.CORPSE_STYLES ) for ( const id of Object.keys(S.DEATH_STYLES) ) {
  const look = S.corpseLook(id, c, 1, false);
  ok(Object.values(look.pose).every(Number.isFinite), `corpse ${c}/${id} finite`);
  if ( c === "none" ) ok(S.isIdentity(look.pose) && !look.skull, `corpse none/${id} is the token`);
  if ( c === "fade" ) ok(look.pose.alpha === 0 && S.corpseLook(id, c, 1, true).pose.alpha > 0, `corpse fade/${id}: gone for players, faint for the GM`);
  if ( c === "body" ) ok(look.skull && look.pose.grey === 1 && (S.DEATH_STYLES[id].gone ? look.pose.alpha === 0.35 : look.pose.alpha === 0.85), `corpse body/${id}`);
}
ok(S.corpseLook("petrify", "body").cracks && !S.corpseLook("fall", "body").cracks, "petrify keeps its cracks");
const from = S.corpseLook("fall", "body", 1).pose;
ok(S.isIdentity(S.revivePose(from, 1)), "revive ends at the token as drawn");
ok(near(S.revivePose(from, 0).rot, from.rot), "revive starts at the corpse");
for ( const id of Object.keys(S.IDLE_STYLES) ) {
  let maxD = 0;
  for ( let t = 0; t < 12; t += 0.05 ) {
    const p = S.idlePose(id, t, 1.3, 1, 1, S.pose(), true);
    ok(Object.values(p).every(Number.isFinite), `idle.${id} finite`);
    maxD = Math.max(maxD, Math.abs(p.sx - 1), Math.abs(p.sy - 1), Math.abs(p.y), Math.abs(p.rot), 1 - p.alpha, p.glow);
  }
  ok(id === "none" ? maxD === 0 : maxD > 0.005 && maxD <= 0.5, `idle.${id} subtle (max ${maxD.toFixed(3)})`);
}
ok(S.isIdentity(S.idlePose("wiggle", 3, 0, 1, 1, S.pose(), false)), "wiggle is still until hovered");
{ const a = S.idlePose("breathe", 2, 0.4, 1, 1), b = S.idlePose("breathe", 2 + 1 / 0.28, 0.4, 1, 1); ok(near(a.sy, b.sy, 1e-9), "breathe is periodic"); }
ok(near(S.idlePose("bob", 1, 0, 2, 1).y, 2 * S.idlePose("bob", 1, 0, 1, 1).y), "amplitude scales the motion");
ok(near(S.durationOf(S.ENTER_STYLES, "warp", 2), S.ENTER_STYLES.warp.dur / 2) && S.durationOf(S.ENTER_STYLES, "nope") === 0, "speed scales durations");

/* 4. determinism */
ok(S.seedOf("abc123") === S.seedOf("abc123") && S.seedOf("abc123") !== S.seedOf("abc124"), "seeds stable and distinct");
ok(S.seedOf("XyZ0aBcDeF123456") === 18468161, "seed value is fixed (every client and version agree)");
const ids = Array.from({ length: 400 }, (_, i) => `tok${i.toString(36)}Ab${i * 7}`);
const ph = ids.map(S.phaseOf);
ok(ph.every((p) => p >= 0 && p < S.TAU), "phases in range");
ok(new Set(ph.map((p) => Math.floor(p / S.TAU * 8))).size === 8, "phases spread over the cycle");
const tilts = ids.map(S.tiltOf), left = tilts.filter((t) => t === -1).length;
ok(left > 120 && left < 280, `tilts both ways (${left} of 400 left)`);
ok(ids.every((id) => S.phaseOf(id) === S.phaseOf(id) && S.tiltOf(id) === S.tiltOf(id)), "per token stable");
ok(S.burstDelay(0) === 0 && near(S.burstDelay(4), 0.3) && S.burstDelay(20) === 0.75 && S.burstDelay(24) === 0.75 && S.burstDelay(25) === null, "burst stagger and cap 25");
const rect = { x: 0, y: 0, width: 1000, height: 600 };
ok(JSON.stringify(S.nearestEdge(50, 300, rect)) === JSON.stringify({ dx: -1, dy: 0, dist: 50 }) && S.nearestEdge(500, 580, rect).dy === 1 && S.nearestEdge(990, 300, rect).dx === 1, "nearest edge");
const cr = S.crackLines(1234); ok(JSON.stringify(cr) === JSON.stringify(S.crackLines(1234)) && cr.every((l) => l.every(([x, y]) => x > 0 && x < 1 && y > 0 && y < 1)), "cracks deterministic, inside the token");
ok(S.SKULL.length === 7 && S.SKULL.every((row) => row.length === 7 && /^[012]+$/.test(row)), "skull bitmap");

/* 5. scene defaults */
globalThis.foundry ??= { utils: { deepClone: (o) => structuredClone(o), mergeObject: (a, b) => ({ ...a, ...b }) } };
const C = await import(pathToFileURL(path.join(root, "scripts/config.mjs")).href);
for ( const k of Object.keys(B) ) ok(k in C.DEFAULTS.tokens, `config DEFAULTS.tokens has ${k}`);
for ( const k of ["enabled", "who", "filter", "intensity", "hide", "target", "combat"] ) ok(k in C.DEFAULTS.tokens, `legacy key ${k} kept`);
console.log(`tokens-fx: ${n} checks ok`);
