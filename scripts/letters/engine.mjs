/* LETR engine shell. PROVISIONAL STUB (interface only): the real renderer replaces this file; the API below is the contract. */
export const VERSION = "0.0.1";
export const MOODS = ["auto", "impact", "crack", "crash", "boom", "roar", "fire", "whoosh", "zap", "tick", "pain", "powerup", "heal", "splash", "fail"];
export function createEngine(base) {
  let n = 0;
  const live = new Set();
  const handle = (text, o = {}) => {
    let done; const finished = new Promise((r) => (done = r));
    const h = { id: `letr${++n}`, text, hand: "stub", space: o.space === "world" ? "world" : "screen", ready: Promise.resolve(),
      finished, alive: true, stop: (opt = {}) => { if ( !h.alive ) return; h.alive = false; live.delete(h); done("stopped"); }, moveTo() {} };
    live.add(h);
    setTimeout(() => { if ( h.alive ) { h.alive = false; live.delete(h); done("done"); } }, (o.hold ?? 1200) + 600);
    return h;
  };
  return {
    version: VERSION, base, moods: MOODS,
    ready: async () => true,
    play: handle,
    burst: (items, common = {}) => items.map((it) => handle(it.text, { ...common, ...it })),
    still: async () => null,
    design: (text, o = {}) => ({ text, mood: o.mood ?? "auto", stub: true }),
    stopAll: () => { for ( const h of [...live] ) h.stop({ quick: true }); },
    count: () => live.size,
    gallery: async () => null,
    limits: { screen: 16, world: 48 }
  };
}
