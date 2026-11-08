// The DIRECTOR's phase-B sources together (core.mjs queue rules): a combat turn -> the active combatant's move -> its attack (lane
// cbt-*, free, cued) -> damage; the next turn waits for the attack's dice:   node dev/director-int.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const D = await import(pathToFileURL(path.join(root, "scripts/director/core.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };
const G = 100, S = "sc";
const r = D.resolve({ v: 1, preset: "standard", over: {} });
const L = "cbt-c1";
const ev = (o, t) => D.normEvent({ scene: S, ...o }, t);
const turn = (id, x, t) => ev({ id, kind: "turn", weight: 0.75, x, y: 500, lane: L, free: true, quick: true, tokens: ["a"] }, t);
const move = (id, x, t) => ev({ id, kind: "move", weight: 0.75, x, y: 500, lane: L, free: true, quick: true, tokens: ["a"], play: { by: "move", follow: "a" } }, t);
const attack = (id, x, t, lane = true) => ev({ id, kind: "attack", weight: 0.68, x, y: 500, cue: "dice", strict: true, tokens: ["t", "a"], after: { key: "Dir.cap.hit" }, ...(lane ? { lane: L, free: true } : {}) }, t);
const damage = (id, x, t) => ev({ id, kind: "damage", weight: 0.6, x, y: 500, strict: true, tokens: ["t"] }, t);
const pump = (q, now) => q.pump(r, { now, paused: false }, G);
const push = (q, e, t) => { e.t = t; q.push(e, r, G); };

// turn -> move (relay) -> attack after the follow ended: a take (not "soft" from the rest / the same place again)
{
  const q = new D.Queue();
  push(q, turn("t1", 1000, 0), 0); let s = pump(q, 200);
  ok(s.length === 1 && s[0].form === "take" && s[0].kind === "turn", "turn takes");
  push(q, move("m1", 1100, 600), 600); s = pump(q, 800);
  ok(s.length === 1 && s[0].form === "take" && s[0].kind === "move", "move relays the turn shot");
  const endMove = q.busyUntil;
  push(q, attack("a1", 1300, endMove + 300), endMove + 300); s = pump(q, endMove + 300 + r.merge + 10);
  ok(s.length === 1 && s[0].form === "take" && s[0].cue === "dice" && s[0].lane === L, "attack right after the move: a take-over in the lane");
  // without the lane (an attack by someone else than the active combatant) the old rules hold: the rest makes it soft
  const q2 = new D.Queue();
  push(q2, move("m2", 1100, 0), 0); pump(q2, 200);
  const e2 = q2.busyUntil;
  push(q2, attack("a2", 1300, e2 + 300, false), e2 + 300); s = pump(q2, e2 + 300 + r.merge + 10);
  ok(s.length === 1 && s[0].form === "soft", "a non-lane attack right after a take is soft (unchanged)");
}
// attack while the move still plays: relays it (the camera goes on to attacker + target)
{
  const q = new D.Queue();
  push(q, move("m1", 1100, 0), 0); pump(q, 200);
  ok(q.busyUntil > 1500, "move busy");
  push(q, attack("a1", 1300, 1000), 1000); const s = pump(q, 1000 + r.merge + 10);
  ok(s.length === 1 && s[0].form === "take" && s[0].kind === "attack", "attack relays the move");
}
// the next turn during the attack's dice: waits for it (no relay of a cued shot), not stale, then takes
{
  const q = new D.Queue();
  push(q, attack("a1", 1300, 0), 0); let s = pump(q, r.merge + 10);
  ok(s.length === 1 && s[0].form === "take", "attack takes");
  const end = q.busyUntil;
  push(q, turn("t2", 3000, 700), 700); s = pump(q, 900);
  ok(s.length === 0 && q.buckets.length === 1, "next turn waits for the dice");
  s = pump(q, end - 50);
  ok(s.length === 0 && q.buckets.length === 1, "still waiting (not stale)");
  s = pump(q, end + 10);
  ok(s.length === 1 && s[0].form === "take" && s[0].kind === "turn", "then the turn takes");
  // a move of the active combatant during the dice waits too
  const q2 = new D.Queue();
  push(q2, attack("a1", 1300, 0), 0); pump(q2, r.merge + 10);
  push(q2, move("m9", 1400, 900), 900); s = pump(q2, 1100);
  ok(s.length === 0, "a move during the dice waits");
}
// damage after the attack: soft (fresh: not dropped as "just shown"), as rolls designed
{
  const q = new D.Queue();
  push(q, attack("a1", 1300, 0), 0); pump(q, r.merge + 10);
  const end = q.busyUntil;
  push(q, damage("d1", 1300, end + 500), end + 500); const s = pump(q, end + 500 + r.merge + 10);
  ok(s.length === 1 && s[0].form === "soft" && s[0].kind === "damage", "damage after its attack: soft, not dropped");
}
// the lane's plain merge rules: a turn supersedes a waiting move of the lane
{
  const q = new D.Queue();
  push(q, ev({ id: "x", kind: "collapse", weight: 0.95, x: 5000, y: 5000 }, 0), 0); pump(q, r.merge + 10);
  push(q, move("m1", 1100, 600), 600); pump(q, 800);
  push(q, turn("t2", 3000, 900), 900);
  ok(q.buckets.length === 1 && q.buckets[0].events[0].kind === "turn", "a newer turn supersedes the lane's waiting move");
}
console.log(`director-int: ${n} checks ok`);
