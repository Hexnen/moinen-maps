// A shadow of the ORIGINAL strip.place() (59084ed: live offsetHeight, writes every call), run at the same moments the strip places:
// right after its canvasPan hook (registered later = called later) and right after its ticker listener (same priority, added later),
// with the same key rule. After each, the strip's real style must equal the shadow's (normalised through a scratch element).
const el0 = () => document.getElementById("mm-orbit-strip");
const scratch = document.createElement("div");
const norm = (l, t, tf, o) => { scratch.style.left = l; scratch.style.top = t; scratch.style.transform = tf; scratch.style.transformOrigin = o; return [scratch.style.left, scratch.style.top, scratch.style.transform, scratch.style.transformOrigin].join("|"); };
const S = window.__eq = { calls: 0, pans: 0, ticks: 0, bad: 0, badRows: [], kSet: new Set(), clampN: 0, edgeN: 0, moved: 0, last: "", exp: null, key: "", hSet: new Set() };
const shadowPlace = (src) => {
  const el = el0(); if ( !el || !canvas?.ready ) return;
  const r = canvas.dimensions.sceneRect, p = canvas.clientCoordinatesFromCanvas({ x: r.x + r.width / 2, y: r.y });
  const k = Math.max(0.55, Math.min(1.5, (canvas.stage.scale.x * canvas.grid.size) / 100));
  const hh = el.offsetHeight, top = Math.max(p.y, hh * k + 10);
  S.exp = norm(`${p.x}px`, `${top}px`, `translate(-50%, calc(-100% - 6px)) scale(${k})`, "50% 100%");
  S.kSet.add(k); S.hSet.add(hh); if ( p.y >= hh * k + 10 ) S.edgeN++; else S.clampN++;
  compare(src);
};
const compare = (src) => {
  const el = el0(); if ( !el || S.exp === null ) return;
  S.calls++;
  const got = [el.style.left, el.style.top, el.style.transform, el.style.transformOrigin].join("|");
  if ( got !== S.last ) { S.moved++; S.last = got; }
  if ( got !== S.exp ) { S.bad++; if ( S.badRows.length < 8 ) S.badRows.push({ src, exp: S.exp, got }); }
};
S.hook = Hooks.on("canvasPan", () => { S.pans++; shadowPlace("pan"); });
S.tick = () => {
  const st = canvas?.stage; if ( !st || !el0() ) return; S.ticks++;
  const k = `${st.position.x.toFixed(1)},${st.position.y.toFixed(1)},${st.scale.x.toFixed(4)},${innerWidth},${innerHeight}`;
  if ( k !== S.key ) { S.key = k; shadowPlace("tick"); } else compare("tick-same");
};
canvas.app.ticker.add(S.tick);
{ const st = canvas.stage; S.key = `${st.position.x.toFixed(1)},${st.position.y.toFixed(1)},${st.scale.x.toFixed(4)},${innerWidth},${innerHeight}`; const el = el0(); if ( el ) S.exp = [el.style.left, el.style.top, el.style.transform, el.style.transformOrigin].join("|"); }   // start from what is on screen (the strip may sit where an earlier move left it)
return 1;
