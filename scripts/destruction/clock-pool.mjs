/**
 * A few clock workers (clock-worker.mjs) for the display's entries. `run(spec, jobs)` -> Promise of the jobs' sorted keys; a job goes
 * to the worker with the fewest jobs waiting. Off without module workers, or with `CONFIG.moinenMaps.noClockWorker = true` (the
 * display then builds the clocks itself a slice per frame).
 */
export class ClockPool {
  static available() { return typeof Worker !== "undefined" && !globalThis.CONFIG?.moinenMaps?.noClockWorker; }

  constructor(n = Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 4) - 2))) {
    this.n = n; this.ws = []; this.wait = new Map(); this.id = 0; this.broken = false;
  }

  worker() {
    if ( this.ws.length < this.n ) {
      const w = new Worker(new URL("./clock-worker.mjs", import.meta.url), { type: "module" });
      w.pending = 0;
      w.onmessage = (ev) => { const q = this.wait.get(ev.data.id); if ( !q ) return; this.wait.delete(ev.data.id); w.pending--; if ( ev.data.error ) q.reject(new Error(ev.data.error)); else q.resolve(ev.data.keys); };
      w.onerror = (e) => { this.broken = true; for ( const [id, q] of this.wait ) if ( q.w === w ) { this.wait.delete(id); q.reject(e); } };
      this.ws.push(w);
      if ( this.ws.length === 1 || this.ws.every((x) => x.pending) ) return w;
    }
    return this.ws.reduce((a, b) => (b.pending < a.pending ? b : a));
  }

  run(spec, jobs) {
    const w = this.worker(), id = ++this.id;
    w.pending++;
    return new Promise((resolve, reject) => {
      this.wait.set(id, { resolve, reject, w });
      w.postMessage({ id, spec, jobs }, jobs.map((j) => j.mask?.buffer).filter(Boolean));
    });
  }

  destroy() { for ( const w of this.ws ) w.terminate(); this.ws = []; for ( const q of this.wait.values() ) q.reject(new Error("closed")); this.wait.clear(); }
}
