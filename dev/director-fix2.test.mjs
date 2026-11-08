// Director fix round 2 (pure parts): a stand-in (player) leader's shots (standin-core.mjs), the stage zoom band, the attack camera and
// the own-turn home (stage-core.mjs):   node dev/director-fix2.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SI = await import(pathToFileURL(path.join(root, "scripts/director/standin-core.mjs")).href);
const SC = await import(pathToFileURL(path.join(root, "scripts/director/stage-core.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };

/* N4: a stand-in leader's shots */
const r = { rest: 1800, maxShot: 6500, softMs: 3600 };
const base = { v: 1, id: "e1-t", form: "take", kind: "destruction", weight: 1, x: 0, y: 0, box: { x0: 0, y0: 0, x1: 1, y1: 1 }, tokens: [], who: "all", t0: 1000, lead: 850, hold: 2000, back: 900, len: 3750, impact: 782, force: true,
  caption: { key: "Dir.cap.collapse", data: {} } };
const ctx = (o = {}) => ({ now: 1000, paused: false, r, lanes: new Set(["cbt-c1"]), log: [], ...o });
let s = SI.standInShot(base, ctx());
ok(s && s.form === "take" && s.force === false && s.weight <= 0.85, "an ordinary source shot plays as a take, never forced");
ok(SI.standInShot(base, ctx({ paused: true })) === null, "the GM's pause: nothing");
ok(SI.standInShot({ ...base, who: "gm" }, ctx()) === null, "GM-only: nothing");
ok(SI.standInShot({ ...base, t0: 60000 }, ctx()) === null, "planned far ahead: nothing");
s = SI.standInShot({ ...base, caption: "Free text from a macro, very long ".repeat(10) }, ctx());
ok(s.form === "soft" && s.caption.length <= 80 && s.impact === -1, "a free caption: soft at most, short");
s = SI.standInShot({ ...base, caption: { key: "Some.other.key", data: {} } }, ctx());
ok(s.form === "soft" && s.caption === null, "a foreign key: soft, no caption");
s = SI.standInShot({ ...base, caption: { key: "Dir.cap.cutToken", data: { name: "x".repeat(500), obj: { a: 1 } } } }, ctx());
ok(s.form === "take" && s.caption.data.name.length === 60 && !("obj" in s.caption.data), "a director key: data plain and short");
s = SI.standInShot({ ...base, len: 60000, hold: 59000 }, ctx());
ok(s.len === 6500 && s.hold === 6500 - 850 - 900, "length capped at maxShot");
s = SI.standInShot({ ...base, lead: 99999, back: -5 }, ctx());
ok(s.lead === 3000 && s.back === 200, "lead / back clamped");
s = SI.standInShot({ ...base, lane: "cbt-forged", free: true }, ctx());
ok(s.lane === null && s.free === false, "a lane of no combat here: dropped");
ok(SI.standInShot({ ...base, lane: "cbt-c1" }, ctx()).lane === "cbt-c1", "the combat's lane kept");
// pace: take-overs outside a lane rest apart and at most 3 in 10 s; at most 10 shots in 10 s
let log = [], forms = [];
for ( let i = 0; i < 12; i++ ) { const x = SI.standInShot({ ...base, id: `e${i}-t` }, ctx({ now: 1000 + i * 100, log })); forms.push(x?.form ?? "none"); }
ok(forms[0] === "take" && forms[1] === "soft" && forms.filter((f) => f === "take").length === 1, "take-overs rest apart");
ok(forms.slice(10).every((f) => f === "none"), "at most 10 shots in 10 s");
log = []; forms = [];
for ( let i = 0; i < 5; i++ ) { const x = SI.standInShot({ ...base, id: `e${i}-t` }, ctx({ now: 1000 + i * 2000, log })); forms.push(x.form); }
ok(forms.filter((f) => f === "take").length === 3, "at most 3 free take-overs in 10 s");
log = []; forms = [];
for ( let i = 0; i < 6; i++ ) { const x = SI.standInShot({ ...base, id: `e${i}-t`, lane: "cbt-c1" }, ctx({ now: 1000 + i * 300, log })); forms.push(x.form); }
ok(forms.every((f) => f === "take"), "combat lane beats keep their pace (the GM's clicks pace them)");
ok(SI.standInShot({ ...base, after: "free" }, ctx()).form === "soft", "a free result caption: soft");

/* N5: the stage zoom */
ok(SC.stageZoom(1.9, 2.2) === 1.9 && SC.stageZoom(1.33, 2.2) === 2.2 && SC.stageZoom(2.6, 2.2) === 2.2, "stage zoom: kept within the band, else the player's");
const rect = { x: 0, y: 0, w: 1300, h: 900 }, view = { x: 1000, y: 1000, scale: 1, vw: 1600, vh: 900 };
const box = (cx, cy, rr = 40) => ({ x0: cx - rr, y0: cy - rr, x1: cx + rr, y1: cy + rr });
const u = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
ok(SC.attackCamera(u(box(700, 1000), box(900, 1000)), box(900, 1000), view, rect, 1) === null, "both on screen: in place");
let c = SC.attackCamera(u(box(3000, 1000), box(3300, 1000)), box(3300, 1000), view, rect, 1);
ok(c && c.scale >= 0.85 && c.scale <= 1.12, "off screen: framed within the zoom band");
const sx = (x) => (x - c.x) * c.scale + 800;
ok(sx(2960) > 0 && sx(3340) < 1300, "the pair fits: both in the free rect");
c = SC.attackCamera(u(box(-2000, 1000), box(3300, 1000)), box(3300, 1000), view, rect, 1);
ok(Math.abs(c.scale - 0.85) < 1e-9, "a long-range pair: the band's widest, not half the zoom");
const sx2 = (x) => (x - c.x) * c.scale + 800;
ok(sx2(3260) >= 0 && sx2(3340) <= 1300 && sx2(3340) > 1300 * 0.6, "the target whole, leaning toward the attacker");

/* N6: own home - the own token comfortably inside, not on the edge above the hotbar */
const home = { x: 1000, y: 1000, scale: 1 };
const edge = box(850, 1000 + 420);                                        // (screen y ~ 870-ish of 900: at the bottom edge)
ok(!SC.comfortable(edge, { ...view, ...home }, rect, 0.2), "token at the bottom edge is not comfortable");
const oh = SC.ownHome(home, edge, rect, view);
ok(SC.comfortable(edge, { ...view, ...oh }, rect, 0.19) && oh.x === 1000 && oh.scale === 1, "home shifted up just enough, same x and zoom");

console.log(`director-fix2: ${n} checks ok`);
