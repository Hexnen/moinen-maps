// The DIRECTOR's pure parts (scripts/director/core.mjs):   node dev/director.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const D = await import(pathToFileURL(path.join(root, "scripts/director/core.mjs")).href);
const C = await import(pathToFileURL(path.join(root, "scripts/destruction/cinematic-core.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const G = 100;

// ---- settings
{
  const r = D.resolve(null);
  eq(r.takeAt, 0.55, "defaults = standard");
  ok(D.resolve({ preset: "calm" }).takeAt === 0.8 && D.resolve({ preset: "calm" }).look === "subtle", "calm preset");
  ok(D.resolve({ preset: "nope" }).takeAt === 0.55, "unknown preset -> standard");
  ok(D.resolve({ preset: "standard", over: { takeAt: 9, softAt: "x", junk: 1 } }).takeAt === 1, "clamped override, junk dropped");
  ok(D.resolve({ preset: "standard", over: { takeAt: 0.3, softAt: 0.6 } }).softAt === 0.3, "softAt never above takeAt");
  ok(D.cleanValue("look", "u-my-look") === "u-my-look" && D.cleanValue("look", "<x>") === undefined, "look id validated");
  ok(!D.sourceOn({ ...r, src_fire: false }, "fire") && D.sourceOn(r, "fire") && D.sourceOn({ ...r, src_fire: false }, "custom"), "source toggles");
  for ( const id of D.PRESET_IDS ) for ( const [k, v] of Object.entries(D.PRESETS[id]) ) ok(D.cleanValue(k, v) === v, `preset ${id}.${k} valid`);
  for ( const id of D.PRESET_IDS ) { const look = D.resolve({ preset: id }).look; ok(!!C.PRESETS[look], `preset ${id} look ${look} is a shipped cinematic look`); }
}

// ---- events
{
  ok(D.normEvent({ kind: "destruction" }) === null, "no place -> null");
  const e = D.normEvent({ kind: "zzz", x: 10, y: 20, weight: 3, tokens: ["a", 5], caption: { key: "Dir.cap.fire", data: { zone: 1 } } }, 1000);
  ok(e.kind === "custom" && e.weight === 1 && e.tokens.length === 1 && e.box.x0 === 10 && e.t === 1000 && e.who === "all", "normalised");
  const b = D.normEvent({ kind: "fire", box: { x0: 0, y0: 0, x1: 100, y1: 50 }, who: "gm" });
  ok(b.x === 50 && b.y === 25 && b.who === "gm", "focus from the box; who");
  ok(D.sizeWeight(G, G) < 0.3 && D.sizeWeight(G * 6, G) >= 0.95, "size weight: a square light, six heavy");
}

const R = D.resolve(null);
const ev = (o) => D.normEvent({ scene: "s", ...o });

// ---- the queue: merging, forms, cooldown, rest, ping-pong
{
  const q = new D.Queue();
  q.push(ev({ kind: "destruction", x: 100, y: 100, weight: 0.7, t: 0 }), R, G);
  q.push(ev({ kind: "destruction", x: 300, y: 120, weight: 0.4, t: 200 }), R, G);
  q.push(ev({ kind: "fire", x: 5000, y: 5000, weight: 0.3, t: 300 }), R, G);
  ok(q.buckets.length === 2, "near + close in time merge; far apart does not");
  ok(q.due(R) === R.merge, "due after the merge window");
  eq(q.pump(R, { now: 100 }, G), [], "nothing before the window");
  const shots = q.pump(R, { now: R.merge + 10 }, G);
  ok(shots.length === 1 && shots[0].form === "take" && shots[0].n === 2 && shots[0].box.x1 >= 300, "merged take-over first (heaviest), box = union");
  ok(shots[0].len <= R.maxShot && shots[0].lead === R.lead && shots[0].impact > 0 && shots[0].impact < shots[0].lead, "timeline: impact as the camera arrives");
  ok(q.buckets.length === 1, "the soft one waits while the take-over plays");
  const t1 = shots[0].t0 + shots[0].len;
  const s2 = q.pump(R, { now: t1 + 1 }, G);
  ok(s2.length === 1 && s2[0].form === "soft", "then the soft shot");
  // same place again within the cooldown: soft at most
  q.push(ev({ kind: "destruction", x: 120, y: 90, weight: 0.8, t: t1 + R.rest + 100 }), R, G);
  const s3 = q.pump(R, { now: t1 + R.rest + 100 + R.merge + 5 }, G);
  ok(s3.length === 0 || s3[0].form === "soft", "same place within the cooldown: no second take-over");
}
{
  // rest: a take-over right after one ends goes soft unless very heavy
  const q = new D.Queue();
  q.push(ev({ kind: "destruction", x: 0, y: 0, weight: 0.7, t: 0 }), R, G);
  const a = q.pump(R, { now: R.merge }, G)[0];
  const end = a.t0 + a.len;
  q.push(ev({ kind: "destruction", x: 9000, y: 0, weight: 0.7, t: end + 10 }), R, G);
  const b = q.pump(R, { now: end + 10 + R.merge }, G)[0];
  ok(b.form === "soft", "within the rest: soft");
  q.push(ev({ kind: "orbitUp", x: 20000, y: 0, weight: 0.95, t: end + 100 }), R, G);
  const c = q.pump(R, { now: end + 100 + R.merge }, G);
  ok(c.length === 1 && c[0].form === "take", "a very heavy event breaks the rest");
}
{
  // ping-pong A -> B -> A
  const q = new D.Queue(), r = { ...R, rest: 0, cooldown: 60000 };
  let now = 0;
  const go = (x, w = 0.7) => { q.push(ev({ kind: "destruction", x, y: 0, weight: w, t: now }), r, G); now += r.merge; const s = q.pump(r, { now }, G)[0]; if ( s ) now = s.t0 + s.len + 10; return s; };
  ok(go(0).form === "take" && go(5000).form === "take", "A then B");
  const back = go(0);
  ok(!back || back.form === "soft", "back to A at once: not a take-over");
}
{
  // paused, disabled, stale, force
  const q = new D.Queue();
  q.push(ev({ kind: "destruction", x: 0, y: 0, weight: 0.9, t: 0 }), R, G);
  ok(q.pump(R, { now: R.merge, paused: true }, G).length === 0 && !q.buckets.length, "paused: dropped");
  q.push(ev({ kind: "destruction", x: 0, y: 0, weight: 0.9, t: 0 }), R, G);
  ok(q.pump({ ...R, enabled: false }, { now: R.merge }, G).length === 0, "disabled: dropped");
  q.push(ev({ kind: "destruction", x: 0, y: 0, weight: 0.9, t: 0 }), R, G);
  q.busyUntil = 1e9;
  ok(q.pump(R, { now: R.merge }, G).length === 0 && q.buckets.length === 1, "busy: waits");
  ok(q.pump(R, { now: R.stale + 1 }, G).length === 0 && !q.buckets.length, "stale: dropped");
  q.push(ev({ kind: "cut", x: 0, y: 0, weight: 1, force: true, t: 10 }), R, G);
  const f = q.pump(R, { now: 10, paused: true }, G);
  ok(f.length === 1 && f[0].form === "take" && f[0].force, "a forced cut plays at once, paused or busy");
  q.release(20); ok(q.busyUntil === 20, "release frees the camera");
  q.push(ev({ kind: "altitude", x: 0, y: 0, weight: 0.05, t: 30 }), R, G);
  ok(q.pump(R, { now: 30 + R.merge }, G).length === 0, "below softAt: nothing");
}
{
  // GM-only parts never reach the players' box/tokens/caption
  const b = { id: "b", t0: 0, scene: "s", events: [ev({ kind: "destruction", x: 0, y: 0, weight: 0.5, tokens: ["pub"], caption: "public" }), ev({ kind: "orbitUp", x: 900, y: 900, weight: 0.95, tokens: ["secret"], who: "gm", caption: "secret" })] };
  const m = D.merged(b);
  ok(m.who === "all" && !m.tokens.includes("secret") && m.caption === "public" && m.box.x1 < 900 && m.weight < 0.9, "mixed bucket: the public part only");
  const all = D.merged({ ...b, events: [b.events[1]] });
  ok(all.who === "gm" && all.tokens.includes("secret"), "an all-GM bucket stays GM-only");
}

// ---- one client
{
  const shot = D.plan(D.merged({ id: "x", t0: 0, scene: "s", events: [ev({ kind: "destruction", x: 0, y: 0, weight: 0.9 })] }), "take", R, 1000, 1);
  ok(D.validShot(shot), "a valid shot record");
  const base = { killed: false, mode: "full", gm: false, visible: true, busy: false, show: false, k: 1, camera: true };
  ok(D.decide(shot, base) === "take", "a player sees the take-over");
  ok(D.decide(shot, { ...base, busy: true }) === "soft", "busy: soft");
  ok(D.decide(shot, { ...base, mode: "soft" }) === "soft", "chose soft");
  ok(D.decide(shot, { ...base, k: 0.1 }) === "soft", "intensity near 0: soft");
  ok(D.decide(shot, { ...base, visible: false }) === "none", "cannot see the place: nothing");
  ok(D.decide({ ...shot, who: "gm" }, base) === "none" && D.decide({ ...shot, who: "gm" }, { ...base, gm: true }) === "take", "GM-only");
  ok(D.decide(shot, { ...base, show: true }) === "none", "the destruction show owns the screen");
  ok(D.decide(shot, { ...base, mode: "off" }) === "none" && D.decide(shot, { ...base, killed: true }) === "none", "opt out / kill switch");
  ok(D.decide(shot, { ...base, camera: false, softOn: false }) === "none", "GM bar mode: nothing on the canvas");
  eq(D.phaseAt(shot, 999), "wait", "phase wait"); eq(D.phaseAt(shot, 1000 + 10), "lead", "phase lead"); eq(D.phaseAt(shot, 1000 + shot.lead + 5), "hold", "phase hold"); eq(D.phaseAt(shot, 1000 + shot.len), "over", "phase over");
  const v = { x: 0, y: 0, scale: 1, vw: 1600, vh: 900, grid: G };
  const f = D.frameShot({ ...shot, box: { x0: 0, y0: 0, x1: 200, y1: 200 } }, v, R, 1);
  ok(f.scale > 1 && f.scale <= R.zoomIn, "frames closer, at most zoomIn");
  ok(D.frameShot({ ...shot, box: { x0: 0, y0: 0, x1: 200, y1: 200 } }, v, R, 1, [0.1, 3], true).scale === 1, "reduced motion: no zoom");
  ok(D.frameShot({ ...shot, box: { x0: 0, y0: 0, x1: 20000, y1: 20000 } }, v, R, 1).scale >= 0.7, "a huge box: not further out than 0.7x");
  const look = D.lookFor(C.DEFAULTS, 0.5, true);
  ok(look.shIntensity === 0 && !look.shOn && !look.flOn && !look.smOn, "reduced motion: no shake, no flash");
  ok(D.lookFor(C.DEFAULTS, 0.5).shIntensity === C.DEFAULTS.shIntensity * 0.5, "intensity scales the shake");
}
{
  // ---- the safe rect (overlay.measureSafe -> core.safeBox): Foundry's own columns, the insets declared to the zones API (U70)
  const ui = { mid: { left: 110, right: 1050 }, top: 40, bot: 700 };
  eq(D.safeBox(1366, 768), { x: 0, y: 0, w: 1366, h: 768 }, "safe rect: nothing measured, nothing declared: the window");
  eq(D.safeBox(1366, 768, ui), { x: 110, y: 40, w: 940, h: 660 }, "safe rect: Foundry's middle column less the navigation and the hotbar");
  eq(D.safeBox(1366, 768, { mid: null, top: 300, bot: 400 }), { x: 0, y: 0, w: 1366, h: 768 }, "safe rect: a navigation below the upper third / a hotbar above the lower third is not a bar");
  eq(D.safeBox(1366, 768, { mid: { left: 600, right: 800 }, top: 250, bot: 520 }), { x: 0, y: 250, w: 1366, h: 270 }, "safe rect: a middle column narrower than the least stretch is not counted (as before)");
  eq(D.safeBox(1366, 768, ui, { top: 130, bottom: 180, left: 0, right: 0 }), { x: 110, y: 130, w: 940, h: 458 }, "safe rect: declared bars cut it (the same as before U70)");
  eq(D.safeBox(1366, 768, ui, { top: 0, bottom: 30, left: 60, right: 200 }), { x: 110, y: 40, w: 940, h: 660 }, "safe rect: a declared bar inside Foundry's own takes nothing more");
  // U70: the dock with a panel and a question open, 480 of 768 px (62 %): it used to be dropped (the stretch ran down to the hotbar,
  // the chip stood on the dock); now the stretch ends where the dock begins
  const tall = D.safeBox(1366, 768, ui, { top: 0, bottom: 480, left: 0, right: 0 });
  eq(tall, { x: 110, y: 40, w: 940, h: 248 }, "U70: a declared bottom bar of 60 % of the window or more still counts");
  ok(tall.y + tall.h === 768 - 480 && tall.y + tall.h - 40 < 768 - 480, "U70: the My view chip (40 px above the stretch's lower edge) stands above that dock");
  eq(D.safeBox(1366, 768, null, { top: 500, bottom: 0, left: 800, right: 0 }), { x: 800, y: 500, w: 566, h: 268 }, "U70: a large top / left inset counts the same way");
  // the declared bars leave less than the director can work with: given up only by what the least stretch needs, in proportion
  const tight = D.safeBox(1366, 768, ui, { top: 130, bottom: 480, left: 0, right: 0 });
  ok(tight.h === 240 && tight.y >= 40 && tight.y < 130 && tight.y + tight.h > 288 && tight.y + tight.h < 700 && tight.x === 110 && tight.w === 940, `U70: bars leaving under 240 px: a 240 px stretch between them, not the whole window (y ${tight.y})`);
  const over = D.safeBox(1366, 768, null, { top: 0, bottom: 900, left: 0, right: 0 });
  eq(over, { x: 0, y: 0, w: 1366, h: 240 }, "U70: a bar as tall as the window: the least stretch at the far side");
  const both = D.safeBox(1000, 600, null, { top: 0, bottom: 0, left: 700, right: 700 });
  ok(both.w === 300 && both.x === 350 && both.h === 600, "U70: insets that cross: the least stretch in the middle of them");
  eq(D.safeBox(280, 200, null, { top: 150, bottom: 0, left: 0, right: 250 }), { x: 0, y: 0, w: 280, h: 200 }, "safe rect: a window smaller than the least stretch: the window");
  eq(D.safeBox(1366, 768, ui, { top: NaN, bottom: -5, left: "x", right: null }), { x: 110, y: 40, w: 940, h: 660 }, "safe rect: junk insets count as none");
}
{
  eq(D.edgeSpot({ x: 500, y: 400 }, 1000, 800), { on: true, x: 500, y: 400, a: 0 }, "on screen");
  const e = D.edgeSpot({ x: 3000, y: 400 }, 1000, 800, 50);
  ok(!e.on && e.x === 950 && e.y === 400 && Math.abs(e.a) < 1e-9, "off to the right: right edge");
  const d = D.edgeSpot({ x: -500, y: -500 }, 1000, 800, 50);
  ok(!d.on && d.x >= 50 && d.y === 50, "off up-left: on the top inset");
  eq(D.leaderOf([{ id: "b", active: true, isGM: true }, { id: "a", active: true, isGM: false }, { id: "c", active: true, isGM: true }]), "b", "leader: the first active GM");
  eq(D.leaderOf([{ id: "b", active: true, isGM: false }, { id: "a", active: true, isGM: false }, { id: "0", active: false, isGM: true }]), "a", "no GM: the first active user");
  ok(D.intensity(0.5, 0.5) === 0.25 && D.intensity(undefined, undefined) === 1, "intensity");
}

console.log(`director: ${n} checks passed`);
