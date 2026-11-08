// The DIRECTOR's movement + combat turns source, pure parts (scripts/director/move-core.mjs) and the queue rules it relies on
// (core.mjs: lane / free / quick / play):   node dev/director-move.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const M = await import(pathToFileURL(path.join(root, "scripts/director/move-core.mjs")).href);
const D = await import(pathToFileURL(path.join(root, "scripts/director/core.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };
const near = (a, b, e, m) => ok(Math.abs(a - b) <= e, `${m}: ${a} vs ${b}`);
const G = 100;

// ---- settings
{
  const s = M.sanitizeSet(null);
  ok(s.move && s.turns && s.banner && s.ownStay && s.party === "soft" && s.moveSq === 8, "defaults");
  const t = M.sanitizeSet({ move: false, party: "nope", moveSq: 999, banner: "yes", junk: 1 });
  ok(!t.move && t.party === "soft" && t.moveSq === 40 && t.banner === true && !("junk" in t), "sanitised");
  ok(M.sanitizeSet({ moveSq: "" }).moveSq === 8 && M.sanitizeSet({ moveSq: true }).moveSq === 8 && M.sanitizeSet({ moveSq: 3.4 }).moveSq === 3, "moveSq parse");
}

// ---- move weights
{
  const base = { moveSq: 8, takeAt: 0.55, party: "soft" };
  const w = (o) => M.moveWeight({ ...base, ...o });
  ok(w({ d: 0.5 }).w === 0 && w({ d: 1.5 }).w === 0, "a nudge is nothing");
  ok(w({ d: 8 }).w >= 0.55 && w({ d: 4 }).w < 0.55 && w({ d: 4 }).w >= 0.12, "GM-moved NPC: long = take, medium = soft");
  ok(w({ d: 40 }).w <= 0.85, "capped");
  ok(w({ d: 1, combat: true, active: true }).w === 0.75 && w({ d: 1, combat: true, active: true }).free, "active combatant: take, free");
  ok(w({ d: 0.4, combat: true, active: true }).w === 0, "active combatant turning in place: nothing");
  ok(w({ d: 3, forced: true }).w > w({ d: 3 }).w && w({ d: 3, teleport: true }).w > w({ d: 3 }).w, "push / teleport weigh more");
  ok(w({ d: 1, teleport: true }).w > 0, "a one-square teleport counts");
  // the party exploring
  ok(w({ d: 6, player: true, byOwner: true }).w === 0, "party soft: short move nothing");
  const long = w({ d: 20, player: true, byOwner: true }).w;
  ok(long > 0.12 && long < 0.55, `party soft: long move a marker, never the camera (${long})`);
  ok(w({ d: 20, player: true, byOwner: true, takeAt: 0.4 }).w < 0.4, "party soft follows the director's takeAt");
  ok(w({ d: 20, player: true, byOwner: true, party: "off" }).w === 0, "party off");
  ok(w({ d: 20, player: true, byOwner: true, party: "full" }).w >= 0.55, "party full");
  ok(w({ d: 20, player: true, byOwner: true, forced: true }).w >= 0.55, "a pushed PC counts in full");
  ok(w({ d: 8, player: true, byOwner: true, combat: true }).w < w({ d: 8, combat: true }).w, "a PC moving out of turn: a little less");
}

// ---- geometry
{
  const { p, len } = M.pathOf({ x: 0, y: 0 }, [{ x: 300, y: 0 }, { x: 300, y: 400 }], 100, 100);
  ok(p.join() === "50,50,350,50,350,450" && len === 700, "path of centres + length");
  ok(M.pathOf({ x: 0, y: 0 }, [{ x: 0, y: 0 }], 100, 100).p.length === 2, "a repeated point is dropped");
  const b = M.pathBox(p, 100);
  ok(b.x0 === -50 && b.y0 === -50 && b.x1 === 450 && b.y1 === 550, "path box padded");
  const long = Array.from({ length: 200 }, (_, i) => i);
  const th = M.thinPath(long, 24);
  ok(th.length === 48 && th[0] === 0 && th[1] === 1 && th[46] === 198 && th[47] === 199, "thin keeps the ends");
  const view = { x: 1000, y: 1000, scale: 1, vw: 1600, vh: 900 }, rect = { x: 100, y: 50, w: 1200, h: 800 };
  ok(M.inView({ x0: 900, y0: 900, x1: 1100, y1: 1100 }, view, rect, 10), "box in view");
  ok(!M.inView({ x0: 150, y0: 900, x1: 1100, y1: 1100 }, view, rect, 10), "box under the left UI: not in view");
  ok(!M.inView({ x0: 900, y0: 900, x1: 1100, y1: 1100 }, { ...view, x: 3000 }, rect, 10), "camera elsewhere: not in view");
  ok(M.inView({ x0: 900, y0: 900, x1: 1100, y1: 1100 }, { ...view, scale: 2 }, rect, 10) && !M.inView({ x0: 600, y0: 900, x1: 1100, y1: 1100 }, { ...view, scale: 2 }, rect, 10), "zoom counts");
  // follow zoom
  ok(M.followScale(1, 1600, 900, 100, 1.6, 1, true) === 1, "reduced motion: the player's zoom");
  const z = M.followScale(1, 1600, 900, 100, 1.6, 1);
  ok(z >= 0.8 && z <= 1.36, `follow zoom near the player's (${z})`);
  near(M.followScale(3, 1600, 900, 100, 1.6, 1), 2.4, 1e-9, "zoomed far in: out by 20 % at most");
  ok(M.followScale(0.2, 1600, 900, 100, 1.6, 0) === 0.2, "intensity 0: no zoom in");
}

// ---- the follow camera: it catches up with a walking token, aims ahead, blends from the start view, stops where it last saw it
{
  const from = { x: 0, y: 0, scale: 1 };
  const st = M.followInit({ x: 1000, y: 0 }, from);
  let v = M.followStep(st, { x: 1000, y: 0 }, 0, { from, lead: 800, scale0: 1, scale1: 1.2 });
  ok(v.x === 0 && v.scale === 1, "frame 0 = the start view");
  let x = 1000, maxJump = 0, prev = v.x;
  for ( let t = 16; t <= 4000; t += 16 ) {
    if ( t < 2000 ) x += 600 * 0.016;                                    // 6 squares / s, then it stops
    v = M.followStep(st, { x, y: 0 }, 16, { from, lead: 800, scale0: 1, scale1: 1.2, ahead: 150 });
    maxJump = Math.max(maxJump, Math.abs(v.x - prev)); prev = v.x;
    if ( t === 1600 ) ok(v.x > x - 60, `walking: the camera keeps up and aims ahead (${v.x.toFixed(0)} vs token ${x.toFixed(0)})`);
  }
  near(v.x, x, 3, "stopped: the camera settles on the token");
  ok(v.scale === 1.2, "zoom reached");
  ok(maxJump < 60, `smooth (a 1.5k px lead pan peaks ~45 px/frame) (largest step ${maxJump.toFixed(1)} px per frame)`);
  const last = v.x;
  for ( let t = 0; t < 1000; t += 16 ) v = M.followStep(st, null, 16, { from, lead: 800, scale0: 1, scale1: 1.2 });
  near(v.x, last, 3, "token out of sight: the camera stays where it was last seen");
  // corners: a path turning 90 degrees does not overshoot wildly
  const s2 = M.followInit({ x: 0, y: 0 }, { x: 0, y: 0 }); let px = 0, py = 0, over = 0;
  for ( let t = 0; t < 3000; t += 16 ) {
    if ( t < 1000 ) px += 9.6; else if ( t < 2000 ) py += 9.6;
    const q = M.followStep(s2, { x: px, y: py }, 16, { from: { x: 0, y: 0 }, lead: 0, scale0: 1, scale1: 1, ahead: 150 });
    over = Math.max(over, q.x - px);
  }
  ok(over < 160, `corner overshoot bounded (${over.toFixed(0)} px)`);
  const [a, va] = M.damp(0, 100, 0, 0.3, 10);
  near(a, 100, 1, "damp converges"); ok(Math.abs(va) < 5, "damp at rest");
}

// ---- the banner text
{
  ok(M.bannerFor(null, { round: 0, turn: 0 }) === null, "no banner before round 1");
  ok(M.bannerFor({ round: 0 }, { round: 1, turn: 0 }, { name: "A", visible: true }).kick === "start", "combat start");
  ok(M.bannerFor({ round: 1, turn: 0 }, { round: 1, turn: 1 }, { name: "A", visible: true }).kick === "turn", "a turn");
  ok(M.bannerFor({ round: 1, turn: 3 }, { round: 2, turn: 0 }, { name: "A", visible: true }).kick === "round", "a new round");
  const h = M.bannerFor({ round: 1, turn: 0 }, { round: 1, turn: 1 }, { name: "Secret", visible: false, mine: true });
  ok(h.title === null && !h.mine, "a hidden combatant: no name");
  ok(M.bannerFor({ round: 1, turn: 0 }, { round: 1, turn: 1 }, { name: "Me", visible: true, mine: true }).mine, "my turn");
}

// ---- the queue: lane / free / quick / play
{
  const r = D.resolve(null);
  const ev = (o, t) => D.normEvent({ kind: "move", weight: 0.75, x: 0, y: 0, box: { x0: -50, y0: -50, x1: 50, y1: 50 }, scene: "s", ...o }, t);
  const e = ev({ lane: "cbt-1", free: true, quick: true, play: { by: "move", follow: "tok", not: ["u1", 5, {}], deep: { x: 1 }, fn: () => 1 } }, 0);
  ok(e.lane === "cbt-1" && e.free && e.quick, "lane/free/quick kept");
  ok(e.play.by === "move" && e.play.follow === "tok" && e.play.not.length === 2 && !("deep" in e.play) && !("fn" in e.play), "play cleaned (plain values only)");
  ok(D.normEvent({ x: 0, y: 0, play: { follow: "x" } }).play === null, "play without a handler id: dropped");
  // quick: decided after QUICK ms, not after merge
  let q = new D.Queue();
  q.push(ev({ quick: true }, 1000), r, G);
  ok(q.due(r) === 1000 + D.QUICK, "quick bucket due early");
  ok(q.pump(r, { now: 1000 + D.QUICK - 1 }, G).length === 0 && q.pump(r, { now: 1000 + D.QUICK }, G).length === 1, "quick bucket decided at QUICK");
  // lane: a newer event supersedes the lane's pending one
  q = new D.Queue();
  q.push(ev({ id: "t1", lane: "cbt-1", x: 0 }, 0), r, G);
  q.push(ev({ id: "t2", lane: "cbt-1", x: 5000 }, 100), r, G);
  ok(q.buckets.length === 1 && q.buckets[0].events[0].id === "t2", "lane supersedes the waiting event");
  // lane relay: the lane's take-over plays -> the next lane event replaces it; another lane waits
  q = new D.Queue();
  q.push(ev({ id: "a", lane: "cbt-1", x: 0 }, 0), r, G);
  let s = q.pump(r, { now: r.merge }, G);
  ok(s.length === 1 && s[0].form === "take" && s[0].lane === "cbt-1", "first lane take");
  q.push(ev({ id: "b", lane: "mv-x", x: 4000 }, r.merge + 100), r, G);
  q.push(ev({ id: "c", lane: "cbt-1", x: 8000 }, r.merge + 100), r, G);
  s = q.pump(r, { now: r.merge * 2 + 200 }, G);
  ok(s.length === 1 && s[0].id.startsWith("c") && s[0].form === "take", "same lane relays while its take plays; other lane waits");
  ok(q.buckets.length === 1, "the other lane still waits");
  // free: no "same place again" / ping-pong downgrade
  q = new D.Queue();
  q.push(ev({ id: "p1", x: 0 }, 0), r, G); q.pump(r, { now: r.merge }, G);
  const after = r.merge + 7000;
  q.push(ev({ id: "p2", x: 0 }, after), r, G);
  ok(q.pump(r, { now: after + r.merge }, G)[0]?.form === "soft", "(control) same place again -> soft");
  q = new D.Queue();
  q.push(ev({ id: "f1", x: 0 }, 0), r, G); q.pump(r, { now: r.merge }, G);
  q.push(ev({ id: "f2", x: 0, free: true }, after), r, G);
  ok(q.pump(r, { now: after + r.merge }, G)[0]?.form === "take", "free -> still a take-over");
  // play travels into the shot record
  q = new D.Queue();
  q.push(ev({ id: "pl", play: { by: "move", turn: "tk" }, lane: "cbt-9" }, 0), r, G);
  s = q.pump(r, { now: r.merge }, G);
  ok(s[0].play?.turn === "tk" && s[0].lane === "cbt-9" && D.validShot(s[0]), "play + lane on the shot");
  // merged: the GM-only part never brings its play/lane to the players' record
  const b = { id: "m", events: [ev({ id: "g", who: "gm", weight: 0.9, play: { by: "move", follow: "hidden" } }, 0), ev({ id: "pub", weight: 0.6, play: { by: "move", follow: "pub" } }, 0)], scene: "s" };
  ok(D.merged(b).play.follow === "pub", "merged: play from the public event");
}

console.log(`director-move: ${n} checks passed`);
