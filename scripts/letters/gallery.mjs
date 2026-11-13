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
  if ( o.part === "move" || MOVE_PARTS.includes(o.part) ) return moveDemo(L, o);
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
      opts.magnitude = [0.2, 0.4, 0.6, 0.3][i % 4];   // sizes come from the model (README "Size"): viewport, zoom, grid, magnitude
      /* a wall: each word keeps to its cell (maxWidth is in the word's own units: CSS px on screen, scene px in the world) */
      { const W = innerWidth - (document.getElementById("sidebar")?.getBoundingClientRect().width ?? 0); opts.maxWidth = onWorld ? (W * 0.27) / canvas.stage.scale.x : W * 0.27; }
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
      streams.push(L.stream({ text: "RA-TA-TA-TA", space: "world", pixel: true, at: muzzle, to: { x: c.x + vw * 0.3, y: c.y - vh * 0.05 }, every: 95, duration: 2400, span: (canvas.grid?.size ?? 100) * 1.2, magnitude: 0.6, mood: "impact", seed: o.seed != null ? `${o.seed}:gun` : undefined }));
    }
    if ( space !== "world" ) {
      const W = innerWidth - (document.getElementById("sidebar")?.getBoundingClientRect().width ?? 0);
      const muzzle = () => { const u = Math.min(1, (performance.now() - t0) / 2400); return { x: W * (0.08 + 0.3 * u), y: innerHeight * 0.88 }; };
      streams.push(L.stream({ text: "BRATATATAT", space: "screen", at: muzzle, dir: -35, every: 105, duration: 2400, magnitude: 0.3, mood: "impact", seed: o.seed != null ? `${o.seed}:gun2` : undefined }));
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
      handles.push(L.play(layer, { mood: "tick", space: "world", layer: "overlay", at: { x: at.x, y: at.y + canvas.grid.size * 0.95 }, size: 16, fit: "screen", seed: `lbl${i}`, hold: o.hold ?? 3000 }));
    });
  }
  const sb = document.getElementById("sidebar")?.getBoundingClientRect(), hb = document.getElementById("hotbar")?.getBoundingClientRect();
  screen.forEach((layer, i) => {
    const at = i === 0 && hb ? { x: hb.left + hb.width * 0.3, y: hb.top + hb.height * 0.5 } : sb ? { x: sb.left, y: innerHeight * (0.3 + 0.2 * i) } : { x: innerWidth * (0.3 + 0.2 * i), y: innerHeight * 0.5 };
    handles.push(L.play(word, { mood: "impact", space: "screen", layer, at, size: 60, seed: `${o.seed ?? "layers"}:s`, hold: o.hold ?? 3000, in: "pop", out: "pop" }));
    handles.push(L.play(layer, { mood: "tick", space: "screen", layer: "screen", at: { x: at.x, y: at.y + 56 }, size: 20, seed: `lbs${i}`, hold: o.hold ?? 3000 }));
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

/* ---------- motion (README "Motion: travel" .. "glow"): words that fly, one word on several beats, frame rates, escalation, shards,
   push, self-lit words. part "move" plays them all in a row (about 30 s); "orbit" "path" "choreo" "rate" "escalate" "shards" "glow"
   one each. `center`: a function returning the moving thing to circle, e.g. a map tornado:
     const W = await import("/modules/moinen-maps/scripts/weather/weather.mjs"); const id = W.tornadoApi.list()[0]?.id;
     L.gallery({ part: "orbit", center: () => W.tornadoApi.positionAt(id) });
   Without it a stand-in centre crosses the view (drawn as a small swirl). World space when a scene is up, else screen. */
export const MOVE_PARTS = ["orbit", "path", "choreo", "rate", "escalate", "shards", "glow", "sustain", "ambient"];
export function moveDemo(L, o = {}) {
  const world = o.space ? o.space === "world" : !!globalThis.canvas?.ready;
  const space = world ? "world" : "screen";
  const timers = [], handles = [], streams = [], marks = [], sus = [];
  let cancelled = false;
  const wait = (ms) => new Promise((r) => timers.push(setTimeout(r, ms)));
  /* the view in this space: x, y (top left), w, h, and a unit (one grid square or 8 % of the screen height) */
  const view = () => {
    if ( !world ) { const W = innerWidth - (document.getElementById("sidebar")?.getBoundingClientRect().width ?? 0); return { x: 0, y: 0, w: W, h: innerHeight, u: innerHeight * 0.08 }; }
    const s = canvas.stage.scale.x, c = canvas.stage.pivot, w = innerWidth / s, h = innerHeight / s;
    return { x: c.x - w / 2, y: c.y - h / 2, w, h, u: canvas.grid.size };
  };
  const at = (fx, fy) => { const v = view(); return { x: v.x + v.w * fx, y: v.y + v.h * fy }; };
  const seed = (k) => `${o.seed ?? "move"}:${k}`;
  const P = (text, opts) => { if ( cancelled ) return null; const h = L.play(text, { space, ...opts }); handles.push(h); return h; };
  const S = (opts) => { if ( cancelled ) return null; const s = L.stream({ space, ...opts }); streams.push(s); return s; };
  const lab = (text, p) => P(text, { mood: "tick", at: p, fit: world ? "screen" : "legible", size: 14, seed: `lab:${text}`, hold: 2600, in: "pop", out: "pop", pushable: false });
  /* a marker for a stand-in moving centre: a small grey swirl (world: PIXI graphics; screen: a div) */
  function marker(fn) {
    if ( world ) {
      const g = new PIXI.Graphics(); g.eventMode = "none";
      const r = canvas.grid.size * 0.45;
      for ( let k = 0; k < 3; k++ ) { g.lineStyle(Math.max(2, r * 0.12), 0x55606a, 0.8); g.arc(0, 0, r * (0.4 + 0.3 * k), k, k + 4.2); }
      canvas.interface.addChild(g); marks.push(g);
      const tick = () => { if ( g.destroyed ) return; const p = fn(); if ( p ) { g.position.set(p.x, p.y); g.rotation += 0.35; } timers.push(setTimeout(tick, 1000 / 12)); };
      tick();
    } else {
      const d = document.createElement("div");
      Object.assign(d.style, { position: "fixed", width: "70px", height: "70px", margin: "-35px 0 0 -35px", borderRadius: "50%", border: "6px dotted #55606acc", zIndex: 999, pointerEvents: "none" });
      document.body.appendChild(d); marks.push(d);
      const tick = () => { if ( !d.isConnected ) return; const p = fn(); if ( p ) { d.style.left = `${p.x}px`; d.style.top = `${p.y}px`; d.style.transform = `rotate(${(performance.now() / 4) % 360}deg)`; } timers.push(setTimeout(tick, 1000 / 12)); };
      tick();
    }
  }
  const parts = {
    async orbit() {
      const t0 = performance.now(), v0 = view();
      const center = o.center ?? (() => { const u = Math.min(1, (performance.now() - t0) / 6500); return { x: v0.x + v0.w * (0.28 + 0.44 * u), y: v0.y + v0.h * (0.5 + 0.06 * Math.sin(u * 7)) }; });
      if ( !o.center ) marker(center);
      let end; const until = new Promise((r) => (end = r));
      P("WHOOOOOSH", { mood: "whoosh", orbit: { center, radius: v0.u * (world ? 1.7 : 1.6), period: 2300 }, until, seed: seed("orb1"), magnitude: 0.6 });
      S({ text: "WHU-UU-UUM", orbit: { center, radius: v0.u * (world ? 2.9 : 2.7), period: 3400, dir: -1 }, every: 270, until, mood: "whoosh", seed: seed("orb2"), magnitude: 0.4, out: "pop" });
      await wait(o.orbitMs ?? 6500); end(); await wait(900);
    },
    async path() {
      const A = at(0.12, 0.78), B = at(0.62, 0.7);
      P("BONK!", { mood: "impact", path: { from: A, to: B, arc: 0.35, spin: 1, ease: "linear" }, out: "shards", seed: seed("p1"), magnitude: 0.7, hold: 600 });
      S({ text: "BZZ-ZZ-ZZT", mood: "zap", path: { from: at(0.15, 0.25), to: at(0.85, 0.42) }, every: 160, duration: 2600, seed: seed("p2"), magnitude: 0.4, glow: "auto" });
      await wait(1200);
      P("WHOOSH", { mood: "whoosh", path: { points: [at(0.9, 0.9), at(0.7, 0.55), at(0.85, 0.2)], duration: 1500 }, seed: seed("p3"), magnitude: 0.6 });
      await wait(3000);
    },
    async choreo() {
      P("RAKABOOM!", { mood: "boom", parts: "prefix", at: at(0.27, 0.24), seed: seed("c1"), magnitude: 0.7, hold: 1800 }); lab("parts: prefix", at(0.27, 0.38));
      await wait(500);
      P("BLAM BLAM BLAM", { mood: "impact", parts: "syllables", beat: 230, at: at(0.7, 0.24), seed: seed("c2"), magnitude: 0.6, hold: 1600 }); lab("parts: syllables", at(0.7, 0.38));
      await wait(700);
      P("KLIK-KLIK-KLIK", { mood: "tick", typeOn: true, at: at(0.25, 0.58), seed: seed("c3"), magnitude: 0.6, hold: 1400 }); lab("typeOn", at(0.25, 0.68));
      P("12", { mood: "impact", countIn: true, at: at(0.7, 0.58), seed: seed("c4"), magnitude: 0.8, hold: 1400 }); lab("countIn", at(0.7, 0.7));
      await wait(900);
      P("BOOM", { mood: "boom", echo: 3, at: at(0.4, 0.8), seed: seed("c5"), magnitude: 0.5, hold: 700 }); lab("echo: 3", at(0.4, 0.94));
      await wait(3400);
    },
    async rate() {
      [1, 2, 3].forEach((on, i) => { P("THWACK!", { mood: "impact", on, at: at(0.2 + 0.3 * i, 0.42), seed: seed("r"), magnitude: 0.4, scale: 0.55, in: "slam", out: "shatter", holdKind: "shake", hold: 1200 }); lab(`on: ${on}`, at(0.2 + 0.3 * i, 0.58)); });
      [1, 2, 3].forEach((on, i) => P("ZIP", { mood: "whoosh", on, path: { from: at(0.07 + 0.3 * i, 0.85), to: at(0.3 + 0.3 * i, 0.8), arc: 0.4 }, seed: seed("r2"), magnitude: 0.4, hold: 900 }));
      await wait(3000);
    },
    async escalate() {
      const p = at(0.5, 0.45);
      for ( let i = 0; i < 6; i++ ) { P("BAM!", { mood: "impact", at: p, escalate: { key: seed("esc") }, seed: seed(`e${i}`), magnitude: 0.45, hold: 700 }); await wait(420); }
      await wait(1800);
    },
    async shards() {
      P("KRAK!", { mood: "crack", out: "shards", at: at(0.25, 0.3), seed: seed("s1"), magnitude: 0.8, hold: 500 });
      P("CRASH!", { mood: "crash", out: "shards", at: at(0.68, 0.28), seed: seed("s2"), magnitude: 0.7, hold: 700 });
      await wait(1900);
      for ( const [t, x, y, m] of [["POW!", 0.22, 0.6, "impact"], ["ZAP!", 0.42, 0.8, "zap"], ["klik", 0.62, 0.55, "tick"], ["SPLASH!", 0.8, 0.76, "splash"], ["ŁUP!", 0.35, 0.44, "impact"]] ) P(t, { mood: m, at: at(x, y), seed: seed(t), magnitude: 0.45, hold: 2400 });
      await wait(900);
      P("KABOOM!", { mood: "boom", push: true, at: at(0.5, 0.63), seed: seed("s3"), magnitude: 0.9, hold: 1000 });
      await wait(2600);
    },
    async sustain() {
      /* continuous sounds: a fire swelling then dying, an engine riding a moving source */
      let endF, endE; const uF = new Promise((r) => (endF = r)), uE = new Promise((r) => (endE = r));
      const t0 = performance.now(), v0 = view();
      const car = () => { const u = Math.min(1, (performance.now() - t0) / 9000); return { x: v0.x + v0.w * (0.55 + 0.33 * u), y: v0.y + v0.h * (0.45 + 0.1 * Math.sin(u * 9)) }; };
      marker(car);
      if ( !cancelled ) sus.push(L.sustain({ space, kind: "fire", at: at(0.28, 0.62), seed: seed("susF"), until: uF, level: (ms) => Math.min(1, 0.25 + ms / 5000) }));
      if ( !cancelled ) sus.push(L.sustain({ space, kind: "engine", mood: "roar", at: car, seed: seed("susE"), until: uE, level: 0.55, dir: 180 }));
      lab("sustain: fire (level rises)", at(0.28, 0.85)); lab("sustain: moving engine", at(0.72, 0.85));
      await wait(7000); endF(); await wait(1500); endE(); await wait(2200);
    },
    async ambient() {
      /* the steady hiss of pipes all over the view: quiet, hollow, a few at a time */
      const pts = [[0.15, 0.3], [0.4, 0.22], [0.7, 0.3], [0.88, 0.5], [0.2, 0.7], [0.5, 0.6], [0.75, 0.8], [0.35, 0.88]];
      for ( const [i, [x, y]] of pts.entries() ) if ( !cancelled ) sus.push(L.sustain({ space, mode: "ambient", kind: "hiss", mood: "whoosh", at: at(x, y), seed: seed(`pipe${i}`), gap: [2500, 6000] }));
      await wait(13000);
      for ( const s of sus ) s.stop();
    },
    async glow() {
      [false, true].forEach((g, i) => {
        P("FWOOOSH", { mood: "fire", glow: g, at: at(0.27 + 0.45 * i, 0.35), seed: seed("g1"), magnitude: 0.6, hold: 2500 });
        P("BZZZT!", { mood: "zap", glow: g, at: at(0.27 + 0.45 * i, 0.7), seed: seed("g2"), magnitude: 0.6, hold: 2500 });
        lab(g ? "glow: true" : "glow: off", at(0.27 + 0.45 * i, 0.88));
      });
      await wait(3800);
    }
  };
  const list = o.part === "move" || !o.part ? MOVE_PARTS : [o.part];
  const clear = () => { for ( const m of marks ) { try { m.destroy?.(); m.remove?.(); } catch {} } };
  const done = (async () => { for ( const k of list ) { if ( cancelled ) break; await parts[k](); } clear(); })();
  return { handles, streams, done, cancel() { cancelled = true; timers.forEach(clearTimeout); for ( const h of handles ) h?.stop({ quick: true }); for ( const s of streams ) s?.stop({ quick: true }); for ( const s of sus ) s?.stop({ quick: true }); clear(); } };
}
