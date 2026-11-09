import { strikeData } from "../presets/lightning-core.mjs";

/**
 * The rain's lightning: a close strike's bolt geometry (lightning-core strikeData: 15-30 ms of rasterising and a distance transform)
 * built off the main thread, so a flash never costs a frame. One message per bolt: { id, seed, opts } -> { id, D } (its data
 * transferred, not copied).
 */
self.onmessage = (e) => {
  const { id, seed, opts } = e.data ?? {};
  try {
    const D = strikeData(seed, opts);
    self.postMessage({ id, D }, [D.data.buffer]);
  } catch ( err ) { self.postMessage({ id, error: String(err?.message ?? err) }); }
};
