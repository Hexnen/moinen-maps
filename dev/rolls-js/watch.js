// player: record director hooks, captions, camera, dice
window.__rw = { log: [], t0: performance.now() };
const L = (k, d) => window.__rw.log.push({ t: Math.round(performance.now() - window.__rw.t0), k, ...d });
if ( window.__rwHook ) Hooks.off("moinenMapsDirector", window.__rwHook);
window.__rwHook = Hooks.on("moinenMapsDirector", (kind, d) => { if ( kind === "shot" ) L("shot", { id: d.shot.id, form: d.form, kind: d.shot.kind, cue: d.shot.cue, tokens: d.shot.tokens, who: d.shot.who }); if ( kind === "end" ) L("end", { why: d.why, form: d.form }); });
if ( window.__rwDice ) Hooks.off("diceSoNiceRollComplete", window.__rwDice);
window.__rwDice = Hooks.on("diceSoNiceRollComplete", (id) => L("dice", { id }));
clearInterval(window.__rwInt);
let lastCap = "";
window.__rwInt = setInterval(() => {
  const caps = [...document.querySelectorAll(".mm-dir-cap:not(.is-out)")].map((c) => c.innerText.replace(/\s+/g, " ").trim()).join(" | ");
  const lab = [...document.querySelectorAll(".mm-dir-label")].map((c) => c.innerText.trim()).join(" | ");
  const s = caps + " // " + lab;
  if ( s !== lastCap ) { lastCap = s; L("cap", { s }); }
}, 50);
canvas.animatePan({ x: 3500, y: 600, scale: 0.35, duration: 0 });
return { ok: true, view: { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y, s: canvas.stage.scale.x } };
