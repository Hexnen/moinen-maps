const N = 5000, t = (f) => { const a = performance.now(); for ( let i = 0; i < N; i++ ) f(); return +((performance.now() - a) / N * 1000).toFixed(2); };
const W = await import("/modules/moinen-maps/scripts/weather/weather.mjs");
const PM = await import("/modules/moinen-maps/scripts/perf-mode.mjs");
return { us: {
  weatherDetail: t(() => game.settings.get("moinen-maps", "weatherDetail")),
  detailCap: t(() => W.detailCap()), lensCap: t(() => W.lensCap()), perfMode: t(() => PM.perfMode()),
  lvUserSettings: t(() => game.settings.get("LockView", "userSettings")),
  lvGetUser: t(() => lockView.Helpers.getUserSetting("viewbox")),
  lvEmit: t(() => lockView.viewbox.emit()),
  pan0: t(() => canvas.pan({})),
}, calls: { detail: 0 } };
