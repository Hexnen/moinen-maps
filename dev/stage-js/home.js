// player page: close the first-login dialog, put the camera on this player's own view (args via window.__home = [x, y, scale]), start the watcher
for ( const a of [...foundry.applications.instances.values()] ) if ( a.constructor.name === "UserConfig" ) await a.close();
const h = { "Test Gracz 1": [1180, 360, 2.2], "Test Gracz 2": [400, 500, 2.2] }[game.user.name] ?? [768, 512, 1];
canvas.pan({ x: h[0], y: h[1], scale: h[2] });
await new Promise((r) => setTimeout(r, 300));
const W = window.__w = { cam: [], log: [], t0: performance.now(), home: [canvas.stage.pivot.x, canvas.stage.pivot.y, canvas.stage.scale.x] };
const now = () => Math.round(performance.now() - W.t0);
if ( window.__wHook ) Hooks.off("moinenMapsDirector", window.__wHook);
window.__wHook = Hooks.on("moinenMapsDirector", (kind, d) => {
  if ( kind === "shot" ) W.log.push({ t: now(), k: "shot", form: d.form, kind: d.shot.kind, lane: d.shot.lane });
  else if ( kind === "end" ) W.log.push({ t: now(), k: "end", form: d.form, why: d.why, kind: d.shot?.kind, taken: d.taken });
  else if ( kind === "stage" ) W.log.push({ t: now(), k: "stage", ...JSON.parse(JSON.stringify(d ?? {})) });
});
clearInterval(window.__wInt); if ( window.__wStop ) clearTimeout(window.__wStop); window.__wStop = setTimeout(() => clearInterval(window.__wInt), 52000);
window.__wInt = setInterval(() => {
  const st = canvas.stage, cin = document.querySelector(".mm-cin");
  const bars = !!cin && [...cin.children].some((el) => el.style.transform === "translateY(0px)" || el.style.transform === "translateY(0)");
  W.cam.push([now(), Math.round(st.pivot.x), Math.round(st.pivot.y), +st.scale.x.toFixed(3), bars ? 1 : 0]);
}, 100);
return { user: game.user.name, home: W.home };
