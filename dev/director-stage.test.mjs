// The COMBAT STAGE, pure parts (scripts/director/stage-core.mjs): settings, the comfort zone, the calm turn camera, the own-turn home and
// the per-client state (home / parked / out / own moves):   node dev/director-stage.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SC = await import(pathToFileURL(path.join(root, "scripts/director/stage-core.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };

/* settings */
ok(JSON.stringify(SC.sanitizeStage(null)) === JSON.stringify(SC.STAGE_DEFAULTS), "defaults");
ok(SC.STAGE_DEFAULTS.on === true && SC.STAGE_DEFAULTS.bars === "hits", "on by default, bars for hits");
ok(SC.sanitizeStage({ on: false }).on === false && SC.sanitizeStage({ on: "no" }).on === true, "on: booleans only");
ok(SC.sanitizeStage({ bars: "never" }).bars === "never" && SC.sanitizeStage({ bars: "x" }).bars === "hits", "bars enum");
ok(SC.sanitizeStage({ back: 99 }).back === 30 && SC.sanitizeStage({ back: 0 }).back === 1 && SC.sanitizeStage({ back: "" }).back === 5 && SC.sanitizeStage({ back: 7.4 }).back === 7, "back clamped");

/* geometry: a 1600x900 window, the safe rect less a 300 px sidebar; camera at (1000, 1000) scale 1 */
const rect = { x: 0, y: 0, w: 1300, h: 900 }, view = { x: 1000, y: 1000, scale: 1, vw: 1600, vh: 900 };
const box = (cx, cy, r = 40) => ({ x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r });
// scene x 1000 -> screen 800; the rect centre is screen 650 -> scene 850
ok(SC.comfortable(box(850, 1000), view, rect), "rect centre is comfortable");
ok(!SC.comfortable(box(1400, 1000), view, rect), "under the sidebar is not");
ok(!SC.comfortable(box(250, 1000), view, rect), "near the left edge (screen 50) is not comfortable");
ok(SC.comfortable(box(400, 1000), view, rect, 0.1) && !SC.comfortable(box(400, 1000), view, rect, 0.2), "the comfort margin scales");
const c = SC.centreFor({ x: 500, y: 600 }, rect, view, 2);
ok(Math.abs(((500 - c.x) * 2 + 800) - 650) < 1e-6 && Math.abs(((600 - c.y) * 2 + 450) - 450) < 1e-6 && c.scale === 2, "centreFor puts the point at the rect's middle");
ok(SC.sameView({ x: 0, y: 0, scale: 1 }, { x: 3, y: 0, scale: 1.01 }) && !SC.sameView({ x: 0, y: 0, scale: 1 }, { x: 30, y: 0, scale: 1 }), "sameView");

/* the turn camera */
ok(SC.turnCamera(box(850, 1000), view, rect, 1) === null, "comfortable at the stage zoom: no move");
ok(SC.turnCamera(box(850, 1000), view, rect, 2) !== null, "comfortable but far off the stage zoom: a move (back to the player's zoom)");
const tc = SC.turnCamera(box(2400, 1000), view, rect, 1, 850);
ok(tc && tc.scale === 1 && Math.abs(tc.x - (2400 + 150)) < 1e-6 && Math.abs(tc.y - 1000) < 1e-6, "off screen: centred in the safe rect at the stage zoom");
ok(tc.ms >= 850 * 0.8 && tc.ms <= 850 * 1.6, "glide within 0.8..1.6 x lead");
const far = SC.turnCamera(box(9000, 1000), view, rect, 1, 850), near = SC.turnCamera(box(1700, 1000), view, rect, 1, 850);
ok(far.ms > near.ms && far.ms <= 850 * 1.6, "a longer way glides longer (capped)");

/* own home */
const home = { x: 1000, y: 1000, scale: 1 };
ok(JSON.stringify(SC.ownHome(home, box(850, 1000), rect, view)) === JSON.stringify(home), "own token in the home view: exactly home");
const oh = SC.ownHome(home, box(3000, 1000), rect, view);
ok(oh.scale === 1 && Math.abs(oh.x - 3150) < 1e-6, "own token off the home view: home moved to it, same zoom");
ok(JSON.stringify(SC.ownHome(home, null, rect, view)) === JSON.stringify(home), "no token: home");

/* the state of one client */
let st = SC.newStage();
st.turn = "1:a";
ok(SC.beatForm(st, 0, 5000) === "take", "a fresh stage takes");
SC.beatStart(st, { x: 10, y: 20, scale: 1.5 });
ok(st.home.x === 10 && st.home.scale === 1.5 && st.parked === null, "the first beat takes the player's view as home");
SC.beatEnd(st, "done", false, { x: 500, y: 500, scale: 1.4 }, 100);
ok(st.parked && st.parked.x === 500 && st.home.x === 10, "natural end: parked there, home kept");
SC.beatStart(st, { x: 500, y: 500, scale: 1.4 });
ok(st.home.x === 10, "the next beat from the parked camera keeps the home");
SC.beatEnd(st, "replaced", false, { x: 600, y: 500, scale: 1.4 }, 200);
ok(st.parked.x === 500, "replaced (a relay): nothing changes");
SC.beatEnd(st, "cut", false, { x: 10, y: 20, scale: 1.5 }, 300);
ok(st.parked === null && st.out === "1:a" && st.home.x === 10, "Esc: home, out for this turn");
ok(SC.beatForm(st, 400, 5000) === "soft", "out: soft for the rest of the turn");
ok(SC.turnChange(st, "1:b", false) === null && st.out === null && SC.beatForm(st, 400, 5000) === "take", "the next turn: back on stage");

// the player takes the camera during a beat
SC.beatStart(st, { x: 10, y: 20, scale: 1.5 });
SC.beatEnd(st, "done", true, { x: 900, y: 900, scale: 1 }, 1000);
ok(st.parked === null && st.home === null && st.out === "1:b" && st.ownAt === 1000, "taken: the camera is the player's, out for this turn");
SC.turnChange(st, "1:c", false);
ok(SC.beatForm(st, 3000, 5000) === "soft", "a later turn within `back` of the player's own move: soft");
ok(SC.beatForm(st, 6500, 5000) === "take", "after `back`: on stage again");
SC.beatStart(st, { x: 900, y: 900, scale: 1 });
ok(st.home.x === 900, "the new home is where the player put the camera");

// own pans while parked
SC.beatEnd(st, "done", false, { x: 50, y: 50, scale: 1 }, 7000);
SC.ownMove(st, 8000);
ok(st.parked === null && st.home === null && st.out === "1:c" && st.ownAt === 8000, "the player pans while parked: their view, out for the turn");
// own pans while at home: ownAt only matters
st = SC.newStage(); st.turn = "2:a";
SC.ownMove(st, 50);
ok(st.out === null && st.ownAt === 50, "a pan with nothing parked: no 'out'");

// own turn
st = SC.newStage(); st.turn = "1:a";
SC.beatStart(st, { x: 10, y: 20, scale: 1.5 }); SC.beatEnd(st, "done", false, { x: 500, y: 500, scale: 1.5 }, 10);
ok(SC.turnChange(st, "1:me", true)?.home === true, "own turn while parked: home");
st.parked = null;
ok(SC.turnChange(st, "1:me2", true) === null, "own turn with the camera at home: nothing");

// combat end
st = SC.newStage(); st.turn = "1:a"; st.combat = "c";
SC.beatStart(st, { x: 10, y: 20, scale: 1.5 }); SC.beatEnd(st, "done", false, { x: 500, y: 500, scale: 1.5 }, 10);
const go = SC.stageEnd(st);
ok(go?.home && go.to.x === 10 && st.combat === null && st.home === null && st.parked === null, "combat end while parked: home, state reset");
ok(SC.stageEnd(st) === null, "combat end at home: nothing");
// skip / scene: the camera returned home already
st = SC.newStage(); st.turn = "1:a";
SC.beatStart(st, { x: 10, y: 20, scale: 1.5 }); SC.beatEnd(st, "skip", false, { x: 10, y: 20, scale: 1.5 }, 10);
ok(st.parked === null && st.out === null && st.home.x === 10, "skip: home, not out");

console.log(`director-stage: ${n} checks ok`);
