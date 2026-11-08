// The combat stage: the player keeps control. Real CDP input on PLAYER 2's page (key / click / wheel), the GM drives the combat.
//   node dev/stage-js/control.mjs <cdpPort> <gmUrlPrefix> <p2UrlPrefix>      (run dev/stage-js/setup.js on the GM page first)
// Prints one line per check (OK / FAIL) and a JSON trace at the end.
const [port, GM, P2] = process.argv.slice(2);
const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
async function page(prefix) {
  const t = (await list()).find((x) => x.type === "page" && x.url.startsWith(prefix));
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pend = new Map(); ws.addEventListener("message", (m) => { const q = JSON.parse(m.data); if ( q.id ) pend.get(q.id)?.(q); });
  const send = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (js) => { const q = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }); return q.result?.exceptionDetails ? { error: q.result.exceptionDetails.exception?.description } : q.result?.result?.value; };
  return { send, ev };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gm = await page(GM), p2 = await page(P2);
const key = async (pg, k) => { const c = k === "Escape" ? 27 : 0; await pg.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: c }); await pg.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: c }); };
const click = async (pg, x, y) => { await pg.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await pg.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await sleep(60); await pg.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); };
const wheel = async (pg, x, y, dy) => { await pg.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await pg.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy }); };

const S = 'const A = game.modules.get("moinen-maps").api; ';
const state = () => p2.ev(`${S} const s = A.directorStage.status(); return { ...s, cam: [Math.round(canvas.stage.pivot.x), Math.round(canvas.stage.pivot.y), +canvas.stage.scale.x.toFixed(3)], trace: A.directorStage._debug().trace.slice(-3), take: A.director.status().take, soft: A.director.status().soft.length };`);
const atHome = (s, home) => Math.hypot(s.cam[0] - home[0], s.cam[1] - home[1]) * s.cam[2] < 8 && Math.abs(s.cam[2] / home[2] - 1) < 0.02;
const out = []; let fails = 0;
const check = (c, m, d) => { out.push(`${c ? "OK  " : "FAIL"} ${m}${d ? `   ${JSON.stringify(d)}` : ""}`); if ( !c ) fails++; console.log(out.at(-1)); };
const next = () => gm.ev("await game.combat.nextTurn(); return game.combat.combatant?.name;");
const moveActive = (dx) => gm.ev(`const d = game.combat.combatant.token; await d.update({ x: d.x + ${dx} * canvas.grid.size }); return d.name;`);
/** Polls the player's stage until `fn(state)` or `ms` passed; the last state. */
async function waitFor(fn, ms = 5000) {
  const t0 = Date.now(); let s = await state();
  while ( !fn(s) && Date.now() - t0 < ms ) { await sleep(150); s = await state(); }
  return s;
}
/** Next turns until this player's camera is parked by a glide (a combatant not comfortable on its screen) and the chip is up. */
async function parkOnNext(label) {
  for ( let i = 0; i < 8; i++ ) {
    const who = await next();
    const s = await waitFor((q) => q.parked && q.chip, 5500);
    if ( s.parked && s.chip ) return { who, s };
  }
  check(false, `${label}: no turn parked the camera`); return null;
}

const home0 = (await p2.ev(`canvas.pan({ x: 400, y: 500, scale: 2.2 }); await new Promise((r) => setTimeout(r, 200)); return [canvas.stage.pivot.x, canvas.stage.pivot.y, canvas.stage.scale.x];`));
await gm.ev("await game.combat.startCombat(); return 1;");
let s0 = await waitFor((q) => q.parked && q.chip, 5500);

// 1. Esc while parked: home, the rest of the turn soft, the next turn on stage again
let p = s0.parked && s0.chip ? { s: s0 } : await parkOnNext("esc");
if ( p ) {
  check(p.s.chip === true, "parked: the 'My view' chip shows", p.s.cam);
  await key(p2, "Escape"); await sleep(1600);
  let s = await state();
  check(atHome(s, home0) && !s.parked && !s.chip, "Esc while parked: camera home, chip gone", s.cam);
  check(s.out && s.out === s.turn, "Esc: out for the rest of this turn", { out: s.out, turn: s.turn });
  await moveActive(5); await sleep(2600);
  s = await state();
  const lastMove = s.trace.filter((t) => t[1] === "move").at(-1);
  check(!lastMove || lastMove[2] !== "take", "a move later in the same turn does not take the camera", lastMove ?? "no move shot reached the check");
  check(atHome(s, home0), "camera still home", s.cam);
}

// 2. the chip (real click)
p = await parkOnNext("chip");
if ( p ) {
  const r = await p2.ev("const b = document.querySelector('.mm-dst-chip')?.getBoundingClientRect(); return b && [b.x + b.width / 2, b.y + b.height / 2];");
  await click(p2, r[0], r[1]); await sleep(1600);
  const s = await state();
  check(atHome(s, home0) && !s.parked && !s.chip, "click on the chip: camera home", s.cam);
}

// 3. Esc while parked with a window open: the window gets it, the camera stays parked; a second Esc goes home
p = await parkOnNext("window");
if ( p ) {
  // (the settings window focuses its search field; out of it, Esc is Foundry's "dismiss": it closes the window)
  await p2.ev("await game.settings.sheet.render({ force: true }); await new Promise((r) => setTimeout(r, 500)); document.activeElement?.blur?.(); return 1;");
  await key(p2, "Escape"); await sleep(900);
  let s = await state();
  const win = await p2.ev("return [...foundry.applications.instances.values()].some((a) => a.hasFrame && a.rendered);");
  check(s.parked && !win, "Esc with a window open: the window closes, the camera stays", { cam: s.cam, win });
  if ( win ) await p2.ev("for ( const a of [...foundry.applications.instances.values()] ) if ( a.hasFrame && a.rendered ) await a.close(); return 1;");
  await key(p2, "Escape"); await sleep(1600);
  s = await state();
  check(atHome(s, home0) && !s.parked, "second Esc: home", s.cam);
}

// 4. the wheel DURING a beat: the camera is the player's; the rest of the turn and `back` s soft; later turns on stage again
await gm.ev("return 1;");
let taken = null;
for ( let i = 0; i < 6 && !taken; i++ ) {
  await next(); await sleep(900);
  const s = await state();
  if ( s.take && !s.take.taken ) {
    await wheel(p2, 700, 400, -240); await sleep(2600);
    taken = await state();
  } else await sleep(2800);
}
if ( taken ) {
  check(!taken.parked && taken.home === null, "wheel during a beat: nothing parked, the player's camera", { cam: taken.cam, home: taken.home });
  const where = taken.cam;
  await moveActive(-5); await sleep(2600);
  let s = await state();
  check(Math.hypot(s.cam[0] - where[0], s.cam[1] - where[1]) < 4 && s.cam[2] === where[2], "the same turn's move does not move the camera", { before: where, now: s.cam, trace: s.trace });
  await sleep(4000); await next(); await sleep(3600);
  s = await state();
  const t = s.trace.at(-1);
  check(t && t[1] === "turn" && t[2] !== "soft", "a later turn (after `back`) is on stage again", t);
} else check(false, "wheel: no beat caught on screen");

// 5. the player zooms while parked: theirs, no return
p = await parkOnNext("own pan");
if ( p ) {
  await wheel(p2, 700, 400, 240); await sleep(900);
  const s = await state();
  check(!s.parked && !s.chip && s.home === null, "wheel while parked: the camera is the player's (no chip, nothing to return to)", s.cam);
}

// 6. GM skip during a beat: back home
await sleep(5200);
let skipped = null;
for ( let i = 0; i < 6 && !skipped; i++ ) {
  const before = await state();
  await next(); await sleep(900);
  const s = await state();
  if ( s.take ) { await gm.ev(`${S} await A.director.skip(); return 1;`); await sleep(1500); skipped = { s: await state(), home: before.parked ? null : before.cam }; }
  else await sleep(2800);
}
if ( skipped ) check(!skipped.s.parked && !skipped.s.take, "GM skip during a beat: the beat ends, nothing parked (the camera went to the player's home)", skipped.s.cam);
else check(false, "skip: no beat caught on screen");

// 7. the director switched off while parked: home
p = await parkOnNext("off");
if ( p ) {
  const h = p.s.home;
  await gm.ev(`${S} await A.director.setOn(false); return 1;`); await sleep(2000);
  const s = await state();
  check(!s.parked && Math.hypot(s.cam[0] - h.x, s.cam[1] - h.y) * s.cam[2] < 8, "director off while parked: home", { cam: s.cam, home: h });
  await gm.ev(`${S} await A.director.setOn(true); return 1;`);
}

// 8. combat end while parked: home
await sleep(1000);
p = await parkOnNext("end");
if ( p ) {
  const h = p.s.home;
  await gm.ev("await game.combat.delete(); return 1;"); await sleep(2200);
  const s = await state();
  check(!s.parked && !s.combat && Math.hypot(s.cam[0] - h.x, s.cam[1] - h.y) * s.cam[2] < 8, "combat end while parked: home, stage over", { cam: s.cam, home: h });
}
const leftovers = await p2.ev(`${S} return { chip: !!document.querySelector('.mm-dst-chip'), root: !!document.querySelector('.mm-cin'), screen: A.director.status().screen, ticker: canvas.app.ticker.count };`);
check(!leftovers.chip && !leftovers.root && !leftovers.screen, "nothing left on screen after the combat", leftovers);
console.log(JSON.stringify({ fails, n: out.length }));
process.exit(fails ? 1 : 0);
