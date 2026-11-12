// Room for the map's floating things (scripts/zones/room.mjs; dev/zones-api.md section 41): labels at tokens laid out together, a
// menu kept inside the declared bars and clear of the boxes asked for, the "My view" chip clear of them, and how a token moved
// (a hand or a script).   node dev/zones-room.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const R = await import(pathToFileURL(path.join(root, "scripts/zones/room.mjs")).href);
const BC = await import(pathToFileURL(path.join(root, "scripts/zones/board-core.mjs")).href);

let failed = 0, n = 0;
const check = (ok, msg) => { n++; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };
const J = JSON.stringify;
const boxOf = (it, s) => ({ x0: it.x + s.dx - it.w / 2, y0: it.y + s.dy - it.h / 2, x1: it.x + s.dx + it.w / 2, y1: it.y + s.dy + it.h / 2 });
const noOverlap = (items, res, fixed = []) => {
  const bs = items.map((it) => boxOf(it, res.get(it.key)));
  for ( let i = 0; i < bs.length; i++ ) {
    for ( let j = i + 1; j < bs.length; j++ ) if ( R.overlap(bs[i], bs[j]) > 0 ) return false;
    for ( const f of fixed ) if ( R.overlap(bs[i], f) > 0 ) return false;
  }
  return true;
};

/* ---- spreadLabels */
{
  // one label alone, two far apart: nothing moves
  const a = { key: "a", x: 100, y: 50, w: 80, h: 22 }, b = { key: "b", x: 400, y: 50, w: 80, h: 22 };
  const r = R.spreadLabels([a, b]);
  check(J(r.get("a")) === J({ dx: 0, dy: 0 }) && J(r.get("b")) === J({ dx: 0, dy: 0 }), "labels apart stay where they stand alone");
  // two tokens side by side (U116 'Spor' under 'Spora szansa'): the second steps aside or up, never on the first
  const c = { key: "c", x: 100, y: 50, w: 120, h: 22 }, d = { key: "d", x: 160, y: 50, w: 150, h: 22 };
  const r2 = R.spreadLabels([c, d], [], { gap: 3 });
  check(noOverlap([c, d], r2), "two pills side by side: no overlap after the layout");
  check(J(r2.get("c")) === J({ dx: 0, dy: 0 }), "the first (left, same row) keeps its own spot");
  const s = r2.get("d");
  check(Math.abs(s.dx) + Math.abs(s.dy) <= 150 * 0.8 + 30, "the second moves as little as it can");
  // five targets in a cluster: every label readable
  const many = [0, 1, 2, 3, 4].map((i) => ({ key: `t${i}`, x: 100 + i * 40, y: 50 + (i % 2) * 8, w: 110, h: 22 }));
  const r3 = R.spreadLabels(many, [], { gap: 3 });
  check(noOverlap(many, r3), "five labels of a cluster of targets: none lies on another");
  // the same layout every time
  check(J([...R.spreadLabels(many, [], { gap: 3 })]) === J([...r3]), "deterministic");
  // a line's pill (fixed) is kept clear of
  const fixed = [{ x0: 70, y0: 40, x1: 130, y1: 60 }];
  const r4 = R.spreadLabels([a], fixed, { gap: 3 });
  check(noOverlap([a], r4, fixed), "a token's label steps off a line's pill");
  // the chosen one keeps its spot (prio), the other moves
  const e = { key: "e", x: 100, y: 50, w: 100, h: 22 }, f = { key: "f", x: 110, y: 50, w: 100, h: 22, prio: 1 };
  const r5 = R.spreadLabels([e, f], [], { gap: 3 });
  check(J(r5.get("f")) === J({ dx: 0, dy: 0 }) && noOverlap([e, f], r5), "a higher prio (the one chosen) keeps its spot");
  // was: a shift that is still free is kept rather than hopping to the other side; once the way is clear, home again
  const g = { key: "g", x: 100, y: 50, w: 100, h: 22 }, h0 = { key: "h", x: 120, y: 50, w: 100, h: 22 };
  const first = R.spreadLabels([g, h0], [], { gap: 3 }).get("h");
  const again = R.spreadLabels([g, { ...h0, x: 121, was: first }], [], { gap: 3 }).get("h");
  check(Math.sign(first.dx) === Math.sign(again.dx) && Math.sign(first.dy) === Math.sign(again.dy), "a label keeps the side it took while its token walks a little");
  const home = R.spreadLabels([{ ...g, x: 600 }, { ...h0, was: first }], [], { gap: 3 }).get("h");
  check(J(home) === J({ dx: 0, dy: 0 }), "with nothing in the way a moved label goes home");
  // soft: another token's picture is avoided by a label that has to move; its own token never counts; the spot of its own is never charged
  const k1 = { key: "k1", x: 100, y: 50, w: 100, h: 22 }, k2 = { key: "k2", x: 110, y: 50, w: 100, h: 22 };
  const soft = [{ key: "k1", x0: 50, y0: 61, x1: 150, y1: 161 }, { key: "k2", x0: 60, y0: 61, x1: 160, y1: 161 }, { key: "x", x0: 40, y0: -40, x1: 180, y1: 37 }];
  const r6 = R.spreadLabels([k1, k2], [], { gap: 3, soft });
  check(noOverlap([k1, k2], r6), "with token pictures around, still no two labels on each other");
  const r7 = R.spreadLabels([k1], [], { gap: 3, soft });
  check(J(r7.get("k1")) === J({ dx: 0, dy: 0 }), "a label alone is never moved for a picture under it");
  // over: a picture drawn ABOVE the label (a later token's) is hard - the label leaves it, here to the spot under its own token (alt)
  // (the label at the top edge of its token 0..100, a token above covering y -100..0 and x 50..150 - the rows up are all under it)
  const p1 = { key: "p", x: 100, y: 0, w: 90, h: 22, over: [{ x0: 20, y0: -150, x1: 180, y1: 5 }], alt: [{ dy: 114 }] };
  const r8 = R.spreadLabels([p1], [], { gap: 3 }).get("p");
  const b8 = { x0: 100 + r8.dx - 45, y0: r8.dy - 11, x1: 100 + r8.dx + 45, y1: r8.dy + 11 };
  check(!(Math.min(b8.x1, 180) - Math.max(b8.x0, 20) > 0 && Math.min(b8.y1, 5) - Math.max(b8.y0, -150) > 0), `a label leaves a picture drawn above it (${J(r8)})`);
  const r9 = R.spreadLabels([{ ...p1, over: [] }], [], { gap: 3 }).get("p");
  check(J(r9) === J({ dx: 0, dy: 0 }), "nothing drawn above: the label stays (alt only tried when needed)");
  check(J(R.spreadLabels([{ ...p1, over: [null, { x0: 1 }], alt: [{ dy: NaN }, null] }]).get("p")) === J({ dx: 0, dy: 0 }), "junk over/alt: ignored");
  // U125 (a): walls (panels over the map): a label under one goes round it, however far; one not under a panel is left alone
  {
    const q = { key: "q", x: 500, y: 300, w: 100, h: 22 }, wall = { x0: 380, y0: 200, x1: 700, y1: 420 };
    const rq = R.spreadLabels([q], [], { gap: 3, walls: [wall] }).get("q");
    const bq = boxOf(q, rq);
    check(R.overlap(bq, wall) === 0, `a token under a panel: its label leaves the panel (${J(rq)})`);
    check(Math.abs(rq.dx) + Math.abs(rq.dy) <= 160, "by the nearest side");
    check(J(R.spreadLabels([{ ...q, x: 900 }], [], { gap: 3, walls: [wall] }).get("q")) === J({ dx: 0, dy: 0 }), "a label clear of the panels stays");
    const two = [q, { key: "q2", x: 520, y: 300, w: 100, h: 22 }], r2w = R.spreadLabels(two, [], { gap: 3, walls: [wall] });
    check(noOverlap(two, r2w, [wall]), "two labels under one panel: both out, not on each other");
  }
  // junk in, nothing thrown
  check(R.spreadLabels(null).size === 0 && R.spreadLabels([{ key: "z", x: NaN, y: 0, w: 1, h: 1 }]).size === 0, "junk items: empty layout");
}

/* ---- menuSpot */
{
  const old = (a, w, h, vw, vh) => BC.menuSpot(a, w, h, vw, vh);
  const anchors = [{ x0: 700, y0: 400, x1: 760, y1: 460 }, { x0: 1500, y0: 850, x1: 1560, y1: 890 }, { x0: 10, y0: 10, x1: 40, y1: 40 }, { x0: 700, y0: 820, x1: 760, y1: 880 }];
  const xy = (s) => J({ x: s.x, y: s.y });
  check(anchors.every((a) => xy(R.menuSpot(a, 300, 220, 1600, 900)) === xy(old(a, 300, 220, 1600, 900)) && R.menuSpot(a, 300, 220, 1600, 900).far === false), "no insets, nothing to avoid: the spot of old (board-core.menuSpot), not tied");
  // U125 (a): 1366 x 768, the token under the bottom right, a desk above it, the dock declared at the bottom: the menu takes the free
  // spot NEAREST the token (not the first free one across the screen), and says when it stands away from it (the tie)
  {
    const tok = { x0: 1120, y0: 620, x1: 1250, y1: 750 }, desk = { x0: 820, y0: 290, x1: 1306, y1: 550 }, chat = { x0: 1310, y0: 0, x1: 1366, y1: 768 };
    const dockB = { x0: 497, y0: 608, x1: 1102, y1: 688 };
    const s5 = R.menuSpot(tok, 185, 165, 1366, 768, { insets: { bottom: 160 }, avoid: [desk, chat, dockB] });
    const box5 = { x0: s5.x, y0: s5.y, x1: s5.x + 185, y1: s5.y + 165 };
    check([desk, chat, dockB].every((b) => R.overlap(box5, b) === 0), `1366: clear of the desk, the chat and the dock (${J(s5)})`);
    const gap5 = Math.hypot(Math.max(0, tok.x0 - box5.x1, box5.x0 - tok.x1), Math.max(0, tok.y0 - box5.y1, box5.y0 - tok.y1));
    check(gap5 < 340 && s5.x > 497 - 185, `1366: the nearest free spot, not left of the dock (${Math.round(gap5)} px from the token)`);
    check(s5.far === true && !!R.menuTie(tok, box5), "1366: away from its token: tied to it");
    const t6 = R.menuTie({ x0: 100, y0: 100, x1: 160, y1: 160 }, { x0: 400, y0: 90, x1: 600, y1: 300 });
    check(t6 && t6.x0 === 400 && t6.x1 === 160 && t6.y0 === 130 && t6.y1 === 130, `the tie runs from the menu's near edge to the thing's (${J(t6)})`);
    check(R.menuTie({ x0: 100, y0: 100, x1: 160, y1: 160 }, { x0: 162, y0: 100, x1: 300, y1: 200 }) === null, "beside its thing: no tie");
    const tl = { x0: 117, y0: 34, x1: 265, y1: 182 }, s7 = R.menuSpot(tl, 184, 168, 1366, 768, { insets: { top: 70 }, avoid: [desk] });
    check(s7.x === 275 && s7.far === false, `a free spot of old (right of the thing) is kept with boxes declared elsewhere (${J(s7)})`);
  }
  // U106: a menu near the bottom edge with a dock declared at the bottom stands above the dock
  const a = { x0: 840, y0: 610, x1: 900, y1: 670 }, dock = 110;
  const s = R.menuSpot(a, 300, 220, 1600, 900, { insets: { bottom: dock } });
  check(s.y + 220 <= 900 - dock - 8 + 0.5, `above the declared dock (menu bottom ${s.y + 220} <= ${900 - dock - 8})`);
  check(s.x === a.x1 + 10, "still right of its thing");
  // a desk on the right (uiAvoid): the menu goes left of the thing instead of onto the desk
  const desk = { x0: 1195, y0: 290, x1: 1545, y1: 820 };
  const a2 = { x0: 1000, y0: 640, x1: 1060, y1: 700 };
  const s2 = R.menuSpot(a2, 280, 200, 1600, 900, { insets: { bottom: 110 }, avoid: [desk] });
  check(R.overlap({ x0: s2.x, y0: s2.y, x1: s2.x + 280, y1: s2.y + 200 }, desk) === 0, "clear of a box asked for (a desk at the side)");
  check(s2.y + 200 <= 900 - 110, "and still above the dock");
  // too little room between the bars: the window is used on that axis (the menu is never pushed off the screen)
  const s3 = R.menuSpot(a, 300, 600, 1600, 700, { insets: { top: 100, bottom: 300 } });
  check(s3.y >= 8 && s3.y + 600 <= 700, "bars that leave less than the menu: kept inside the window");
  // nothing free anywhere: the least covered spot, still inside the room
  const all = [{ x0: 0, y0: 0, x1: 1600, y1: 900 }];
  const s4 = R.menuSpot(a, 300, 220, 1600, 900, { avoid: all });
  check(s4.x >= 8 && s4.y >= 8 && s4.x + 300 <= 1592 && s4.y + 220 <= 892, "no free spot: stays inside the window");
}

/* ---- chipSpot */
{
  const rect = { x: 300, y: 80, w: 900, h: 700 };
  const s = R.chipSpot(rect, 140, 24);
  check(s.x === Math.round(300 + 450 - 70) && s.y === 80 + 700 - 40, "nothing to avoid: bottom centre, 40 px up (where it always stood)");
  // the session-review banner at the bottom centre: the chip goes beside it
  const banner = { x0: 520, y0: 720, x1: 980, y1: 770 };
  const s2 = R.chipSpot(rect, 140, 24, [banner]);
  check(R.overlap({ x0: s2.x, y0: s2.y, x1: s2.x + 140, y1: s2.y + 24 }, banner) === 0, "clear of a banner at the bottom centre");
  check(s2.y >= 80 + 700 - 40 - 2 * 34, "still near the bottom");
  // a pill on the map where the chip would stand (U116 'My view' over a label)
  const pill = { x0: 640, y0: 735, x1: 860, y1: 765 };
  const s3 = R.chipSpot(rect, 140, 24, [pill]);
  check(R.overlap({ x0: s3.x, y0: s3.y, x1: s3.x + 140, y1: s3.y + 24 }, pill) === 0, "clear of a label on the map");
  check(s3.x >= 308 && s3.x + 140 <= 1192, "inside the stage");
}

/* ---- how a token moved */
{
  check(R.methodOf({ _movement: { T1: { method: "dragging" } } }, "T1") === "dragging", "Foundry's recorded movement method is read");
  check(R.methodOf({ movement: { T1: { method: "keyboard" } } }, "T1") === "keyboard", "the movement option per token");
  check(R.methodOf({ method: "dragging" }, "T1") === "dragging", "the operation's method");
  check(R.methodOf({}, "T1") === null && R.methodOf(null, "T1") === null, "a plain update says nothing");
  check(["dragging", "keyboard", "hud", "config"].every(R.byHandOf) && !["api", "paste", "undo", null].some(R.byHandOf), "by hand: drag, keys, HUD, sheet; not a script, paste, undo");
}

/* ---- cleanBox */
check(J(R.cleanBox({ x: 1, y: 2, width: 3, height: 4 })) === J({ x0: 1, y0: 2, x1: 4, y1: 6 }) && R.cleanBox({ x0: 1, y0: 1, x1: 1, y1: 5 }) === null && R.cleanBox("x") === null, "boxes: x/y/width/height read, empty and junk dropped");

console.log(failed ? `${failed} of ${n} FAILED` : `all ${n} passed`);
process.exit(failed ? 1 : 0);
