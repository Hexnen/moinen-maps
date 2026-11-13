/* LETR gallery: a wall of words in every mood, over the interface and/or on the canvas.
     const L = await game.modules.get("moinen-maps").api.letters(); L.gallery({ space: "both" });
   Options: space "screen" | "world" | "both" (default both when a canvas is up), waves (default 3), gap ms between words (220),
   seed (same wall on every run), words (your own list of [text, mood]). Returns { handles, done } (done: Promise). */
export const WORDS = [
  ["POW!", "impact"], ["KRAK!", "crack"], ["KABOOM!", "boom"], ["GRRROAAAR!", "roar"], ["FWOOSH", "fire"], ["WHOOSH", "whoosh"],
  ["BZZZT!", "zap"], ["klik", "tick"], ["ARGH!", "pain"], ["VRRRMMM", "powerup"], ["+3", "heal"], ["SPLASH!", "splash"], ["PFFT…", "fail"],
  ["ŁUBUDU!", "crash"], ["TRZASK!", "crack"], ["ŁUP!", "impact"], ["BUUUM!", "boom"], ["WRRRAAA!", "roar"], ["FRRRR", "fire"],
  ["ŚWIST!", "whoosh"], ["ZAP!", "zap"], ["pyk", "tick"], ["AŁA!", "pain"], ["WZZUM!", "powerup"], ["AAH…", "heal"], ["CHLUP!", "splash"],
  ["UPS…", "fail"], ["CRASH!", "crash"], ["THWACK!", "impact"], ["SNAP!", "crack"], ["BOOM!", "boom"], ["-3", "pain"], ["12", "impact"],
  ["ŻŻŻZT", "zap"], ["SZSZSZ", "fire"], ["HAAA!", "powerup"]
];

export function gallery(L, o = {}) {
  const hasCanvas = !!globalThis.canvas?.ready;
  const space = o.space ?? (hasCanvas ? "both" : "screen");
  const waves = o.waves ?? 3, gap = o.gap ?? 220, perWave = o.perWave ?? 12;
  const words = o.words ?? WORDS;
  const handles = [], timers = [];
  const done = [];
  let k = 0;
  const cells = (cols, rows) => { const c = []; for ( let r = 0; r < rows; r++ ) for ( let q = 0; q < cols; q++ ) c.push([q, r]); return c; };
  for ( let w = 0; w < waves; w++ ) {
    const grid = cells(4, 3);
    for ( let i = 0; i < perWave; i++, k++ ) {
      const [text, mood] = words[k % words.length];
      const [q, r] = grid[i];
      const onWorld = space === "world" || (space === "both" && i % 2 === 1);
      const at = (() => {
        if ( !onWorld ) {
          const W = innerWidth - (document.getElementById("sidebar")?.getBoundingClientRect().width ?? 0);
          return { x: W * (0.14 + 0.24 * q) + ((r % 2) ? W * 0.05 : 0), y: innerHeight * (0.2 + 0.28 * r) };
        }
        const s = canvas.stage.scale.x, c = canvas.stage.pivot, vw = innerWidth / s, vh = innerHeight / s;
        return { x: c.x - vw * 0.38 + vw * 0.24 * q + ((r % 2) ? vw * 0.06 : 0), y: c.y - vh * 0.3 + vh * 0.28 * r };
      })();
      const opts = { mood, at, space: onWorld ? "world" : "screen", hold: 1500 + 300 * (i % 3), seed: o.seed != null ? `${o.seed}:${k}` : undefined };
      if ( onWorld ) opts.size = (canvas.grid?.size ?? 100) * 0.55; else opts.size = Math.round(Math.min(innerWidth, 1600) / 1366 * 58);
      timers.push(setTimeout(() => { const h = L.play(text, opts); handles.push(h); done.push(h.finished); }, w * 3600 + i * gap));
    }
  }
  const all = new Promise((res) => timers.push(setTimeout(() => Promise.all(done).then(res), waves * 3600 + perWave * gap + 50)));
  return { handles, done: all, cancel() { timers.forEach(clearTimeout); for ( const h of handles ) h.stop({ quick: true }); } };
}
