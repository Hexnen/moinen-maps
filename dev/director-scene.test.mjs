// The DIRECTOR's scene transitions, pure parts (scripts/director/scene-core.mjs):   node dev/director-scene.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const S = await import(pathToFileURL(path.join(root, "scripts/director/scene-core.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ---- settings and the scene flag
{
  const d = S.cleanSettings(null);
  ok(d.on && d.dip && d.card && d.shot && d.login && d.names === "nav" && d.cardMs === 2800, "defaults");
  const c = S.cleanSettings({ cardMs: 99999, glideMs: "x", names: "<b>", on: "yes", dip: false, junk: 1 });
  ok(c.cardMs === 8000 && c.glideMs === 3000 && c.names === "nav" && c.on === true && c.dip === false && !("junk" in c), "clamped, junk dropped");
  ok(S.cleanSettings({ holdMs: null }).holdMs === 900 && S.cleanSettings({ holdMs: true }).holdMs === 900, "null / bool numbers ignored");
  const f = S.cleanSceneFlag({ title: "  The   Old   Mill  ", sub: 5, off: "true" });
  ok(f.title === "The Old Mill" && f.sub === "" && f.off === false, "flag cleaned (only a real true switches off)");
  ok(S.cleanSceneFlag({ title: "x".repeat(500) }).title.length === 120, "flag title capped");
}

// ---- the title: never more than the navigation shows the player
{
  const sc = { name: "Lich Lair (secret)", navName: "Old Ruins" };
  ok(S.titleOf(sc, {}).title === "Old Ruins", "navigation name before the real name");
  ok(S.titleOf({ name: "Market", navName: "" }, {}).title === "Market", "no navigation name: the name (the nav bar shows it)");
  ok(S.titleOf({ name: "Market", navName: "" }, {}, "navOnly").title === "", "navOnly: no navigation name, no title");
  ok(S.titleOf({ name: "Orbit", navName: "", orbit: true }, {}, "navOnly").title === "Orbit", "the Orbit scene's name is public");
  ok(S.titleOf(sc, { title: "Chapter II", sub: "Dawn" }).title === "Chapter II" && S.titleOf(sc, { title: "Chapter II", sub: "Dawn" }).sub === "Dawn", "the GM's own card");
  ok(S.titleOf(sc, { title: "   " }).title === "Old Ruins", "a blank card title falls back");
}

// ---- whether and how
{
  const base = { killed: false, settings: S.DEFAULTS, sceneOff: false, mode: "full", fresh: true, first: false, busy: false, screen: false, k: 1 };
  ok(S.decideArrival(base) === "full", "a new scene: full");
  ok(S.decideArrival({ ...base, fresh: false }) === "none", "the same scene again (reload / redraw): nothing");
  ok(S.decideArrival({ ...base, killed: true }) === "none", "kill switch");
  ok(S.decideArrival({ ...base, sceneOff: true }) === "none", "scene switched off");
  ok(S.decideArrival({ ...base, settings: { ...S.DEFAULTS, on: false } }) === "none", "world switch off");
  ok(S.decideArrival({ ...base, first: true }) === "full" && S.decideArrival({ ...base, first: true, settings: { ...S.DEFAULTS, login: false } }) === "none", "login toggle");
  ok(S.decideArrival({ ...base, mode: "off" }) === "none" && S.decideArrival({ ...base, mode: "bar" }) === "none", "player off / GM bar: nothing");
  ok(S.decideArrival({ ...base, mode: "soft" }) === "soft" && S.decideArrival({ ...base, busy: true }) === "soft" && S.decideArrival({ ...base, screen: true }) === "soft", "soft: chosen / busy / screen owned");
  ok(S.decideArrival({ ...base, k: 0.1 }) === "soft", "intensity near zero: soft");
  ok(S.decideArrival({ ...base, mode: "bar", fresh: false, forced: true }) === "full", "the GM's test plays");
  const t = { killed: false, settings: S.DEFAULTS, mode: "full", from: "a", to: "b", nextOff: false, native: false };
  ok(S.dipOnTearDown(t), "dip on a change of scene");
  ok(!S.dipOnTearDown({ ...t, to: "a" }), "no dip on a redraw of the same scene");
  ok(!S.dipOnTearDown({ ...t, native: true }), "Foundry's own transition keeps its look");
  ok(!S.dipOnTearDown({ ...t, mode: "bar" }) && !S.dipOnTearDown({ ...t, mode: "off" }) && S.dipOnTearDown({ ...t, mode: "soft" }), "dip by mode");
  ok(!S.dipOnTearDown({ ...t, nextOff: true }) && !S.dipOnTearDown({ ...t, settings: { ...S.DEFAULTS, dip: false } }) && !S.dipOnTearDown({ ...t, to: null }), "dip switches");
}

// ---- the establishing shot
{
  const home = { x: 1000, y: 800, scale: 1 }, vw = 1600, vh = 900;
  const big = { x0: 0, y0: 0, x1: 6000, y1: 4000 };
  const s = S.startView({ home, vw, vh, box: big });
  ok(s.move === "establish" && near(s.scale, 0.4) && s.scale < home.scale, "a big map: wide, at most 2.5x out");
  ok(s.x > 1000 && s.x < 3000, "starts between the map's middle and the player's view");
  const small = { x0: 900, y0: 700, x1: 1100, y1: 900 };
  const s2 = S.startView({ home, vw, vh, box: small });
  ok(s2.move === "establish" && near(s2.scale, 0.78) && Math.hypot(s2.x - 1000, s2.y - 800) < 1, "a small seen area: a gentle pull-in");
  ok(S.startView({ home, vw, vh, box: null }).move === "none", "nothing seen (token vision, no vision): no shot");
  ok(S.startView({ home, vw, vh, box: big, reduced: true }).move === "none", "reduced motion: no camera");
  ok(S.startView({ home, vw, vh, box: big, k: 0.1 }).move === "none", "intensity near zero: no camera");
  const half = S.startView({ home, vw, vh, box: big, k: 0.5 });
  ok(near(half.scale, 0.7), "intensity scales the zoom-out");
  const up = S.startView({ home, vw, vh, move: "rise" }), down = S.startView({ home, vw, vh, move: "descend" });
  ok(up.scale > home.scale && up.x === 1000 && down.scale < home.scale && down.y === 800, "orbit: close then out; landing: high then down");
  ok(S.startView({ home: { ...home, scale: 2.9 }, vw, vh, move: "rise", limits: [0.1, 3] }).scale === 3, "zoom limits");
  ok(S.glideMs({ move: "none" }, home) === 0, "no shot: no glide");
  const g1 = S.glideMs(s, home, 3000, vw), g2 = S.glideMs(s2, home, 3000, vw);
  ok(g1 > g2 && g1 <= 4200 && g2 >= 2400, "a bigger move glides longer, inside sane bounds");
}

// ---- the timeline
{
  const tl = S.timeline({ form: "full", settings: S.DEFAULTS, glide: 3000, wait: 0, veil: true, card: true });
  ok(tl.veilAt === 380 && tl.cardAt === 120 && tl.cardOut === 120 + 2800 && tl.glideAt === tl.veilAt && tl.glideEnd === 3380, "full timeline");
  ok(S.timeline({ form: "full", settings: S.DEFAULTS, glide: 3000, wait: 5000, veil: true }).veilAt === 900, "the reveal wait is capped by holdMs");
  ok(S.timeline({ form: "full", settings: S.DEFAULTS, glide: 3000, wait: 600, veil: true }).veilAt === 600, "the reveal is waited for");
  const soft = S.timeline({ form: "soft", settings: S.DEFAULTS, glide: 3000, veil: true, card: true });
  ok(soft.veilAt === 120 && soft.glideEnd === soft.glideAt && soft.cardOut - soft.cardAt <= 2600 && soft.veilMs === 450, "soft: short, no glide");
  ok(S.timeline({ form: "full", settings: S.DEFAULTS, glide: 0, veil: false, card: false }).veilAt === 0, "no veil: nothing held");
  ok(S.clipBox({ x0: -50, y0: 10, x1: 500, y1: 600 }, { x0: 0, y0: 0, x1: 400, y1: 400 }, 20).x0 === 0 && S.clipBox({ x0: 500, y0: 500, x1: 600, y1: 600 }, { x0: 0, y0: 0, x1: 400, y1: 400 }) === null, "clipBox");
}

console.log(`director scene transitions: ${n} checks ok`);
