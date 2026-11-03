// Filmstrip harness for the Tokens effects (lane 30014). Paste into the page; then await __strip(...)
window.__fx = await import("/modules/moinen-maps/scripts/tokens/fx.mjs");
window.__td = await import("/modules/moinen-maps/scripts/token-drop.mjs");
window.__stepTo = (tk, from, to) => { let now = from; while ( now < to - 0.01 ) { now = Math.min(to, now + 1000 / 60); tk.update(now); } return now; };
/**
 * opts: { id (token id) | x,y (world centre), size (world px of the square region), trigger: async () => void, times: [ms], name, cols }
 * Copies what reached the screen around the token at each time into one labelled strip and uploads it to worlds/invincible/mmfx/<name>.png.
 */
window.__strip = async (o) => {
  const tk = canvas.app.ticker, view = canvas.app.renderer.view;
  const t0 = o.id ? canvas.tokens.get(o.id) : null;
  const cx = o.x ?? t0.center.x, cy = o.y ?? t0.center.y, size = o.size ?? 300;
  const wt = canvas.stage.worldTransform, rs = view.width / view.clientWidth;
  const a = wt.apply({ x: cx - size / 2, y: cy - size / 2 }), b = wt.apply({ x: cx + size / 2, y: cy + size / 2 });
  const sx = a.x * rs, sy = a.y * rs, sw = (b.x - a.x) * rs, sh = (b.y - a.y) * rs;
  const cell = 200, times = o.times, cols = o.cols ?? times.length, rows = Math.ceil(times.length / cols);
  const strip = document.createElement("canvas"); strip.width = cols * cell; strip.height = rows * (cell + 22);
  const ctx = strip.getContext("2d"); ctx.fillStyle = "#1b1a1f"; ctx.fillRect(0, 0, strip.width, strip.height);
  tk.stop();
  let now = performance.now(); tk.update(now);
  try {
    const start = now;
    await o.trigger();
    // the trigger's hooks ran (a document change waits for the server): time 0 is now
    now = Math.max(now, performance.now()); tk.update(now);
    const base = now;
    for ( let i = 0; i < times.length; i++ ) {
      now = __stepTo(tk, now, base + times[i]);
      const x = (i % cols) * cell, y = Math.floor(i / cols) * (cell + 22);
      ctx.drawImage(view, sx, sy, sw, sh, x, y + 22, cell, cell);
      ctx.fillStyle = "#efe6d8"; ctx.font = "bold 14px sans-serif"; ctx.fillText(`${times[i]} ms`, x + 6, y + 16);
    }
    void start;
  } finally { tk.start(); }
  const blob = await new Promise((r) => strip.toBlob(r, "image/png"));
  try { await FilePicker.implementation.createDirectory("data", "worlds/invincible/mmfx"); } catch {}
  const file = new File([blob], `${o.name}.png`, { type: "image/png" });
  await FilePicker.implementation.upload("data", "worlds/invincible/mmfx", file, {}, { notify: false });
  return `${o.name}.png ${strip.width}x${strip.height}`;
};
"harness ready";
