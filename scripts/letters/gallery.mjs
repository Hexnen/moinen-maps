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
  if ( o.part === "layers" ) return layersDemo(L, o);
  if ( o.part === "sizes" ) return sizesDemo(L, o);
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
  /* a power's sound bound to its effect: a burst of gunfire travelling from a moving muzzle toward a target (stream) */
  const streams = [];
  if ( o.streams !== false ) timers.push(setTimeout(() => {
    const t0 = performance.now();
    if ( space !== "screen" && hasCanvas ) {
      const s = canvas.stage.scale.x, c = canvas.stage.pivot, vw = innerWidth / s, vh = innerHeight / s;
      const muzzle = () => { const u = Math.min(1, (performance.now() - t0) / 2400); return { x: c.x - vw * 0.42 + vw * 0.3 * u, y: c.y + vh * 0.36 }; };
      streams.push(L.stream({ text: "RA-TA-TA-TA", space: "world", pixel: true, at: muzzle, to: { x: c.x + vw * 0.3, y: c.y - vh * 0.05 }, every: 95, duration: 2400, size: (canvas.grid?.size ?? 100) * 0.42, mood: "impact", seed: o.seed != null ? `${o.seed}:gun` : undefined }));
    }
    if ( space !== "world" ) {
      const W = innerWidth - (document.getElementById("sidebar")?.getBoundingClientRect().width ?? 0);
      const muzzle = () => { const u = Math.min(1, (performance.now() - t0) / 2400); return { x: W * (0.08 + 0.3 * u), y: innerHeight * 0.88 }; };
      streams.push(L.stream({ text: "BRATATATAT", space: "screen", at: muzzle, dir: -35, every: 105, duration: 2400, size: 30, mood: "impact", seed: o.seed != null ? `${o.seed}:gun2` : undefined }));
    }
  }, (o.streamAt ?? 3600)));
  const all = new Promise((res) => timers.push(setTimeout(() => Promise.all(done).then(res), waves * 3600 + perWave * gap + 50)));
  return { handles, streams, done: all, cancel() { timers.forEach(clearTimeout); for ( const h of handles ) h.stop({ quick: true }); for ( const s of streams ) s.stop({ quick: true }); } };
}

/* the same word on every display layer: world copies sit on tokens (and the map's smoke and weather, if any), screen copies straddle
   the sidebar and the hotbar so the stacking shows. Each copy carries a small label with its layer id. */
export function layersDemo(L, o = {}) {
  const handles = [];
  const word = o.word ?? "ŁUP!";
  const world = Object.entries(L.layers).filter(([, v]) => v.space === "world").map(([k]) => k);
  const screen = Object.entries(L.layers).filter(([, v]) => v.space === "screen").map(([k]) => k);
  if ( globalThis.canvas?.ready ) {
    const toks = canvas.tokens.placeables.filter((t) => t.visible).slice(0, world.length);
    world.forEach((layer, i) => {
      const t = toks[i];
      const at = t ? { x: t.center.x, y: t.center.y } : { x: canvas.stage.pivot.x + (i - 2) * canvas.grid.size * 2, y: canvas.stage.pivot.y };
      handles.push(L.play(word, { mood: "impact", space: "world", layer, at, size: canvas.grid.size * 1.0, seed: `${o.seed ?? "layers"}:w`, hold: o.hold ?? 3000, in: "pop", out: "pop" }));
      handles.push(L.play(layer, { mood: "tick", space: "world", layer: "overlay", at: { x: at.x, y: at.y + canvas.grid.size * 0.95 }, size: canvas.grid.size * 0.34, seed: `lbl${i}`, hold: o.hold ?? 3000 }));
    });
  }
  const sb = document.getElementById("sidebar")?.getBoundingClientRect(), hb = document.getElementById("hotbar")?.getBoundingClientRect();
  screen.forEach((layer, i) => {
    const at = i === 0 && hb ? { x: hb.left + hb.width * 0.3, y: hb.top + hb.height * 0.5 } : sb ? { x: sb.left, y: innerHeight * (0.3 + 0.2 * i) } : { x: innerWidth * (0.3 + 0.2 * i), y: innerHeight * 0.5 };
    handles.push(L.play(word, { mood: "impact", space: "screen", layer, at, size: 60, seed: `${o.seed ?? "layers"}:s`, hold: o.hold ?? 3000, in: "pop", out: "pop" }));
    handles.push(L.play(layer, { mood: "tick", space: "screen", layer: "screen", at: { x: at.x, y: at.y + 52 }, size: 22, seed: `lbs${i}`, hold: o.hold ?? 3000 }));
  });
  return { handles, done: Promise.all(handles.map((h) => h.finished)), cancel() { for ( const h of handles ) h.stop({ quick: true }); } };
}

/* the size model in action (README "Size"): one word from sources of growing size (span), growing footprints (area) and growing
   magnitude, all held while the view zooms out far, in close and back; plus a screen row at magnitudes 0 .. 1.5. Labels name the input.
   The view is put back where it was at the end. */
export async function sizesDemo(L, o = {}) {
  const handles = [];
  const hold = o.hold ?? 9000;
  const lab = (text, at, space = "world") => handles.push(L.play(text, { mood: "tick", space, at, fit: space === "world" ? "screen" : "legible", size: 15, seed: `sz-l-${text}`, hold, in: "pop", out: "pop" }));
  let view = null;
  if ( globalThis.canvas?.ready ) {
    const g = canvas.grid.size, c = { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y };
    view = { x: c.x, y: c.y, scale: canvas.stage.scale.x };
    const rows = [
      ["span", [0.5, 1, 2, 4].map((k) => ({ span: g * k, label: `span ${k}` }))],
      ["area", [0.5, 2, 5, 10].map((k) => ({ area: g * k, label: `area ${k}` }))],
      ["magnitude", [0, 0.5, 1, 1.5].map((k) => ({ magnitude: k, label: `mag ${k}` }))]
    ];
    rows.forEach(([, items], r) => items.forEach((it, i) => {
      const at = { x: c.x + (i - 1.5) * g * 3.2, y: c.y + (r - 1) * g * 2.6 };
      const { label, ...size } = it;
      handles.push(L.play(o.word ?? "ŁUBUDU!", { mood: "crash", space: "world", at, ...size, seed: `sz-${r}`, hold, in: "pop", out: "pop", holdKind: "boil" }));
      lab(label, { x: at.x, y: at.y + g * 0.9 });
    }));
    /* zoom out far, in close, back (the words follow: world size inside the legible range, held at the floor / ceiling outside it) */
    const pan = (scale, ms) => canvas.animatePan({ x: c.x, y: c.y, scale, duration: ms });
    (async () => {
      await new Promise((r) => setTimeout(r, 1200));
      await pan(Math.max(canvas.dimensions?.scale?.min ?? 0.1, 0.15), 2200);
      await new Promise((r) => setTimeout(r, 700));
      await pan(Math.min(canvas.dimensions?.scale?.max ?? 3, 2.2), 2600);
      await new Promise((r) => setTimeout(r, 700));
      await pan(view.scale, 1200);
    })();
  }
  const W = innerWidth - (document.getElementById("sidebar")?.getBoundingClientRect().width ?? 0);
  [0, 0.5, 1, 1.5].forEach((m, i) => {
    const at = { x: W * (0.14 + 0.24 * i), y: innerHeight * 0.86 };
    handles.push(L.play("POW!", { mood: "impact", space: "screen", layer: "ui", at, magnitude: m, seed: "sz-s", hold, in: "pop", out: "pop" }));
  });
  const done = Promise.all(handles.map((h) => h.finished)).then(async () => { if ( view ) await canvas.animatePan({ ...view, duration: 300 }); });
  return { handles, done, cancel() { for ( const h of handles ) h.stop({ quick: true }); } };
}
