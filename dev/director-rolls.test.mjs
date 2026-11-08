// The director's ROLLS source, pure parts (scripts/director/rolls-core.mjs) and the cue fields of core.mjs:   node dev/director-rolls.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const R = await import(pathToFileURL(path.join(root, "scripts/director/rolls-core.mjs")).href);
const D = await import(pathToFileURL(path.join(root, "scripts/director/core.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const G = 100;
const box = (x, y) => ({ x0: x, y0: y, x1: x + G, y1: y + G });

// ---- who may watch
eq(R.audience({ whisper: [], blind: false, gmIds: ["g"] }), "all", "public");
eq(R.audience({ whisper: ["g"], gmIds: ["g"] }), "gm", "gm roll");
eq(R.audience({ whisper: ["g"], blind: true, gmIds: ["g"] }), "gm", "blind");
eq(R.audience({ whisper: ["p1"], gmIds: ["g"] }), null, "self roll / players only -> nothing");
eq(R.audience({ whisper: [], blind: true, gmIds: [] }), "gm", "blind without whisper list");

// ---- roll facts
ok(R.rollFacts(null) === null && R.rollFacts({ total: 3 }) === null, "not a YZ roll");
eq(R.rollFacts({ successCount: 3, options: { damage: 4, attackType: "slugfest" }, attackDamage: 4, pushCount: 0 }), { n: 3, attack: true, dmg: 4, stunts: 2, pushed: false, pushable: false }, "attack");
eq(R.rollFacts({ successCount: 0, options: { attackType: "shooting" } }).attack, true, "attack type without damage");
eq(R.rollFacts({ successCount: 2, options: {}, pushCount: 1, pushable: false }), { n: 2, attack: false, dmg: 0, stunts: 0, pushed: true, pushable: false }, "pushed plain roll");
eq(R.shortText("<b>Energy</b>   Blast &amp; more"), "Energy Blast more", "flavor stripped");
ok(R.shortText("x".repeat(80)).length === 40, "flavor cut");

// ---- the attack event
const A = { id: "a", name: "Omni", box: box(0, 0) }, T = { id: "t", name: "", box: box(600, 0) }, T2 = { id: "t2", name: "B", box: box(600, 300) };
const hit = R.rollFacts({ successCount: 2, options: { damage: 3, attackType: "slugfest" } });
{
  const e = R.rollEvent(hit, { id: "r-m", who: "all", attacker: A, targets: [T], what: "Punch", grid: G });
  ok(e.kind === "attack" && e.weight >= 0.55, "attack with a target takes the camera");
  eq(e.tokens, ["t", "a"], "focus = the target first");
  ok(e.x === 650 && e.y === 50, "focus point = the target");
  ok(e.box.x0 === 0 && e.box.x1 >= 700, "box frames both");
  ok(e.cue === "dice" && e.strict, "cued and strict");
  eq(e.caption.key, "Dir.cap.atk", "setup caption: names");
  eq(e.after.key, "Dir.cap.hitStunts", "result: hit with a stunt");
  eq(e.after.kick, "Dir.cap.atk", "result kick: the names");
  ok(e.caption.data.tname === "" && e.caption.data.name === "Omni", "only public names travel");
  const ev = D.normEvent({ ...e, scene: "s" }, 0);
  ok(ev.cue === "dice" && ev.after.key === "Dir.cap.hitStunts" && ev.after.kick === "Dir.cap.atk" && ev.strict && ev.caption.kick === undefined, "normEvent keeps cue/after/strict");
  const q = new D.Queue(), r = D.resolve(null);
  q.push(ev, r, G);
  const [shot] = q.pump(r, { now: 1000, paused: false }, G);
  ok(shot && shot.form === "take" && shot.cue === "dice" && shot.after?.key === "Dir.cap.hitStunts" && shot.strict && shot.impact >= 0, "the planned shot carries the cue");
  ok(D.validShot(shot), "valid shot");
  ok(shot.len <= r.maxShot, "never longer than maxShot");
}
{
  const miss = R.rollFacts({ successCount: 0, options: { damage: 3, attackType: "shooting" } });
  eq(R.rollEvent(miss, { id: "x", who: "all", attacker: A, targets: [T] }).after.key, "Dir.cap.miss", "miss");
  const e = R.rollEvent(hit, { id: "x", who: "all", attacker: null, targets: [T, T2] });
  ok(e.caption.data.token === null && e.caption.key === "Dir.cap.atkMore" && e.caption.data.more === 1, "hidden attacker: someone; two targets");
  eq(e.tokens, ["t", "t2"], "hidden attacker not listed");
  const solo = R.rollEvent(hit, { id: "x", who: "all", attacker: A, targets: [] });
  ok(solo.caption.key === "Dir.cap.atkSolo" && solo.weight < D.resolve(null).takeAt && solo.x === 50, "no target: soft at the attacker");
  ok(R.rollEvent(hit, { id: "x", who: "all", attacker: null, targets: [] }) === null, "no visible token -> nothing");
  ok(R.rollEvent(hit, { id: "x", who: null, attacker: A, targets: [T] }) === null, "no audience -> nothing");
  const p = R.rollEvent({ ...hit, pushed: true }, { id: "x", who: "all", attacker: A, targets: [T] });
  eq(p.caption.kick, "Dir.cap.kPushed", "push kick");
}
{
  const f = R.rollFacts({ successCount: 1, options: {} });
  const e = R.rollEvent(f, { id: "x", who: "all", attacker: A, what: "Agility" });
  ok(e.kind === "roll" && e.weight < D.resolve(null).takeAt && e.weight >= D.resolve(null).softAt, "plain roll: soft");
  ok(e.weight < D.resolve({ preset: "calm" }).softAt, "calm preset: plain rolls stay quiet");
  ok(e.after.key === "Dir.cap.rollOk" && e.caption.data.what === "Agility", "plain roll caption");
  ok(D.sourceOn({ ...D.resolve(null), src_rolls: false }, "roll") === false && D.sourceOn({ ...D.resolve(null), src_rolls: false }, "attack"), "rolls toggle");
  ok(D.sourceOn({ ...D.resolve(null), src_attacks: false }, "damage") === false, "attacks toggle covers damage");
}

// ---- damage cards
{
  const c1 = "<p><strong>Robot</strong> took <strong>3</strong> damage.</p>";
  eq(R.damageFacts(c1), { dmg: 3, from: null, to: null, max: null, crit: false, broken: false }, "system card");
  const c2 = c1 + "<p>They also took <strong>Broken Arm</strong> critical injury.</p>";
  ok(R.damageFacts(c2).crit && R.damageFacts(c2).broken, "critical injury");
  const f = R.damageFacts(c1, { from: 5, to: 0, max: 8 });
  ok(f.broken && f.max === 8, "plus ultra flags: broken at 0");
  ok(R.damageFacts("<p><strong>7</strong> took <strong>2</strong> damage.</p>").dmg === 2, "a numeric name does not fool it");
  const e = R.damageEvent(f, { id: "g", who: "all", t: T });
  ok(e.kind === "damage" && e.caption.key === "Dir.cap.dmgBroken" && e.weight >= D.resolve(null).takeAt && e.strict, "damage event");
  ok(R.damageEvent(R.damageFacts("<p>?</p>"), { id: "g", who: "all", t: T }).caption.key === "Dir.cap.dmgAny", "unknown damage");
  ok(R.damageEvent(f, { id: "g", who: null, t: T }) === null, "no audience");
}

// ---- merge keeps the public part's cue (a GM-only event never leaks into the players' shot)
{
  const r = D.resolve(null), q = new D.Queue();
  const pubE = D.normEvent({ ...R.rollEvent(hit, { id: "p", who: "all", attacker: A, targets: [T] }), scene: "s" }, 0);
  const gmE = D.normEvent({ kind: "attack", weight: 0.95, x: 60, y: 60, who: "gm", tokens: ["h"], cue: "dice", after: { key: "Dir.cap.miss" }, scene: "s" }, 10);
  q.push(pubE, r, G); q.push(gmE, r, G);
  const [s] = q.pump(r, { now: 2000, paused: false }, G);
  ok(s.who === "all" && !s.tokens.includes("h") && s.after.key === "Dir.cap.hitStunts", "public shot without the GM-only part");
}

// ---- framing: an attacker and its target both stay in the frame when they fit at the allowed zoom
{
  const r = D.resolve(null), view = { x: 0, y: 0, scale: 0.35, vw: 1584, vh: 805, grid: 350 };
  const shot = { box: { x0: 1400, y0: 2707, x1: 2198, y1: 5600 }, x: 1575, y: 5425 };
  const f = D.frameShot(shot, view, r, 1, [0.1, 3]);
  const hh = view.vh / (2 * f.scale);
  ok(f.y - hh * 0.68 <= 2707 && f.y + hh * 0.68 >= 5600 && f.scale >= 0.175, "both ends inside the frame (clear of the bars), at most half the zoom");
  const far = { box: { x0: 0, y0: 0, x1: 100, y1: 20000 }, x: 50, y: 19900 };
  const g = D.frameShot(far, view, r, 1, [0.1, 3]);
  ok(g.y > 10000, "too far apart: the frame leans to the focus");
}

// ---- damage right after the attack shot at the same place: soft, not dropped
{
  const r = D.resolve(null), q = new D.Queue();
  const atk = D.normEvent({ ...R.rollEvent(hit, { id: "a1", who: "all", attacker: A, targets: [T] }), scene: "s" }, 0);
  q.push(atk, r, G);
  const [s1] = q.pump(r, { now: 1000, paused: false }, G);
  const dm = D.normEvent({ ...R.damageEvent(R.damageFacts("<p><strong>X</strong> took <strong>3</strong> damage.</p>", { from: 9, to: 6, max: 9 }), { id: "g1", who: "all", t: T }), scene: "s", t: s1.t0 + s1.len + 1500 }, s1.t0 + s1.len + 1500);
  q.push(dm, r, G);
  const out = q.pump(r, { now: s1.t0 + s1.len + 2500, paused: false }, G);
  ok(out.length === 1 && out[0].form === "soft" && out[0].kind === "damage", "damage after the attack: soft");
  const e2 = D.normEvent({ kind: "fire", weight: 0.3, x: 650, y: 50, scene: "s" }, s1.t0 + s1.len + 1600);
  q.push(e2, r, G);
  ok(q.pump(r, { now: s1.t0 + s1.len + 2700, paused: false }, G).length === 0, "other kinds there are still dropped as just shown");
}
console.log(`director rolls: all ${n} checks passed`);
