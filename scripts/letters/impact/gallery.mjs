/* LETR impact frames: the gallery. Every frame type held long enough to look at, then every kind of impact at its strengths.
     const L = await MoinenLetters.engine(); L.impact.gallery({ subject: canvas.tokens.controlled[0], dir: 20 });
   Options: part "frames" | "kinds" | "both" (default), subject (default: the controlled token, else the first token, else the middle
   of the view), dir (degrees), kinds (ids), tiers (magnitudes, default [0.2, 0.6, 1.1, 1.7]), hold (ticks a single frame is held,
   default 14), gap (ms between items, default 1100: the photosensitivity guard rations full-field frames per second), over, label
   (false = no caption), seed. Returns { done: Promise, stop() }. */
export function gallery(I, o = {}) {
  const part = o.part ?? "both";
  const subject = o.subject ?? globalThis.canvas?.tokens?.controlled?.[0] ?? globalThis.canvas?.tokens?.placeables?.[0] ?? undefined;
  const tiers = o.tiers ?? [0.2, 0.6, 1.1, 1.7], gap = Math.max(200, o.gap ?? 1100);
  const base = { subject, dir: o.dir, over: o.over, space: o.space, from: o.from, colors: o.colors, tone: o.tone, vision: "none" };
  const pl = globalThis.game?.i18n?.lang === "pl";
  let chip = null, stopped = false, live = null;
  const say = (text) => {
    if ( o.label === false ) return;
    if ( !chip ) {
      chip = document.createElement("div");
      Object.assign(chip.style, { position: "fixed", left: "16px", bottom: "16px", zIndex: "9995", padding: "6px 12px", background: "#0b0b10", color: "#fffdf2",
        font: "700 15px/1.2 system-ui, sans-serif", letterSpacing: "0.02em", border: "2px solid #ffd400", pointerEvents: "none" });
      document.body.appendChild(chip);
    }
    chip.textContent = text;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const items = [];
  if ( part !== "kinds" ) for ( const f of I.frames ) items.push({ label: `${f.id}: ${pl ? f.pl : f.en}`, run: () => I.show(f.id, { ...base, ticks: o.hold ?? 14, magnitude: o.magnitude ?? 1.2, seed: `${o.seed ?? "g"}:${f.id}` }) });
  if ( part !== "frames" ) for ( const k of I.kinds.filter((x) => !o.kinds || o.kinds.includes(x.id)) ) for ( const m of tiers )
    items.push({ label: `${k.id} ${m}: ${pl ? k.pl : k.en}`, run: () => I.play({ ...base, kind: k.id, magnitude: m, seed: `${o.seed ?? "g"}:${k.id}:${m}` }) });
  const done = (async () => {
    for ( const it of items ) {
      if ( stopped ) break;
      say(it.label);
      live = it.run();
      await live.finished;
      await wait(gap);
    }
    chip?.remove(); chip = null;
    return stopped ? "stopped" : "done";
  })();
  return { done, items: items.map((i) => i.label), stop() { stopped = true; live?.stop?.(); } };
}
