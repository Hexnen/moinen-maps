/** The destruction bake in a worker (module worker): one message in, progress and one result out. */
import { bake } from "./core.mjs";

self.onmessage = (ev) => {
  const m = ev.data;
  try {
    const res = bake({ ...m.input, onProgress: (p) => self.postMessage({ id: m.id, progress: p }) });
    self.postMessage({ id: m.id, ok: true, result: res }, [res.sheet.data.buffer, res.meta.buffer]);
  } catch ( err ) {
    self.postMessage({ id: m.id, ok: false, error: String(err?.stack ?? err) });
  }
};
