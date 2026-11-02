const MODULE = "moinen-maps";   // (no import of config.mjs: node-tested modules use this without Foundry)

/**
 * PERF: a setting read once per frame. game.settings.get builds a setting document each time (garbage on every frame and ~10 us); the
 * value is kept here, read again after a client setting changes and at most once a second anyway (a world setting changed by the GM
 * arrives through the same second).
 */
const cache = new Map();
globalThis.Hooks?.on?.("clientSettingChanged", () => cache.clear());
globalThis.Hooks?.on?.("updateSetting", () => cache.clear());

export function cachedSetting(key, fallback) {
  const c = cache.get(key), t = performance.now();
  if ( c && t - c.at < 1000 ) return c.v;
  let v; try { v = globalThis.game.settings.get(MODULE, key); } catch { v = fallback; }
  if ( c ) { c.v = v; c.at = t; } else cache.set(key, { v, at: t });
  return v;
}
