/**
 * The chunk codec in a module worker: the GM encodes changed chunks here (in parallel with the next bake, which runs in the bake
 * worker), players decode the chunks they download here (never on the page). See `work` in chunks.mjs for the messages.
 */
import { work } from "./chunks.mjs";

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    const { result, transfer } = await work(m);
    self.postMessage({ id: m.id, ok: true, result }, transfer);
  } catch ( err ) {
    self.postMessage({ id: m.id, ok: false, error: String(err?.message ?? err) });
  }
};
