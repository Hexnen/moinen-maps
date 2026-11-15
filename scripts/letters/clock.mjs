/* LETR (ENGREG 1.9.11): the table's clock, the same instant on every seat to about a millisecond, without any other module.
   Why: stepped motion and shared beats (L.gridClock, L.contactAt, L.net) fall on instants of ONE clock. Foundry's game.time.serverTime
   is Cristian's algorithm on Date.now(): the server's time of the last "time" ping (every 30 s) plus the AVERAGE one-way trip of the
   last four pings. One answer that came back late (a busy frame on this page, a page still loading) moves it by tens of ms until the
   next ping, every seat has its own error, a seat that joined late or a tab that slept re-syncs on its own schedule, and Date.now()
   drifts against performance.now() (the clock the engine animates on).
   Here: the same "time" ping, timed on performance.now(), and the offset of the FASTEST answer among the recent ones is kept (the NTP
   minimum filter: the true offset lies within half the round trip of every answer, so the shortest trip bounds the error best).
   A new answer that cannot agree with the kept one (outside both half round trips: the server restarted, this tab slept, the system
   clock jumped) starts the estimate again from the new answers. Pings: a burst at start, one every EVERY ms, a burst again when the
   tab becomes visible.
     makeClock({ now, ping }) -> { start(), ping(), offset(), error(), ready(), serverNow(), toPage(s), toServer(p), state() }
   PURE except the timers start() sets; `ping(cb)` sends one "time" request and calls cb(serverMs) (cb(null) on failure). */
export const BURST = 6;            // pings at start, BURST_GAP apart, so the first word already has a good clock
export const BURST_GAP = 60;
export const EVERY = 10000;        // then one ping this often
export const KEEP_MS = 120000;     // answers older than this are dropped (the two clocks drift)
export const PING_TIMEOUT = 3000;
export const SLACK = 2;            // ms of tolerance when two answers are compared (the server's ms tick, timer granularity)
export const JUMP = 50;            // ms: this page's clock moved this far against the wall clock (a tab or a computer that slept)

/** one answer: sent at t0, back at t1 (this page's clock), the server's ms inside it */
export function sample(t0, t1, server) {
  if ( !Number.isFinite(t0) || !Number.isFinite(t1) || !Number.isFinite(server) || t1 < t0 ) return null;
  return { off: server + 0.5 - (t0 + t1) / 2, rtt: t1 - t0, at: t1 };   // +0.5: the server's Date.now() is floored to the ms
}
/** the kept estimate from answers: the shortest round trip among the recent ones (null when none) */
export function estimate(samples, now = Infinity, keep = KEEP_MS) {
  let best = null;
  for ( const s of samples ?? [] ) {
    if ( !s || !Number.isFinite(s.off) || !Number.isFinite(s.rtt) || s.rtt < 0 ) continue;
    if ( Number.isFinite(now) && Number.isFinite(s.at) && now - s.at > keep ) continue;
    if ( !best || s.rtt < best.rtt ) best = s;
  }
  return best ? { off: best.off, rtt: best.rtt, at: best.at } : null;
}
/** do two answers fit one clock? (each holds the true offset within half its round trip) */
export const agree = (a, b) => Math.abs(a.off - b.off) <= (a.rtt + b.rtt) / 2 + SLACK;

/** Foundry's own estimate (helpers/time.mjs, v14) of the same answers, for the checks: server + (now - (t1 - mean(rtt)/2)) */
export function foundryEstimate(samples) {
  const last = samples.slice(-4);
  if ( !last.length ) return null;
  const dt = Math.round(last.reduce((a, s) => a + s.rtt, 0) / (last.length * 2));
  const s = last.at(-1);   // the server's ms S = off + (t0 + t1) / 2 - 0.5; Foundry: serverTime = S + (now - (t1 - dt))
  return { off: s.off - s.rtt / 2 - 0.5 + dt, rtt: s.rtt, dt };
}

export function makeClock({ now = () => globalThis.performance?.now?.() ?? Date.now(), wall = () => Date.now(), ping: send = null, fallback = null } = {}) {
  let samples = [], est = null, started = false, timer = 0, resets = 0, rebursting = false;
  /* wall minus page at the kept answer: when the page's clock stood still (a sleeping tab or computer) or jumped, the wall clock tells
     by how much until the next answers come (a burst is asked for at once) */
  const wp = () => { try { return wall() - now(); } catch { return 0; } };
  const fb = () => { try { const v = fallback?.(); return Number.isFinite(v) ? v : null; } catch { return null; } };
  function add(s) {
    if ( !s ) return;
    /* a clock that jumped: the kept answer and the new one cannot both be right; the newer one wins, the old ones go */
    if ( est && !agree(est, s) ) { samples = []; resets++; }
    s.wp ??= wp();
    samples.push(s);
    samples = samples.filter((x) => s.at - x.at <= KEEP_MS).slice(-40);
    est = estimate(samples, s.at);
    if ( est ) est.wp = samples.find((x) => x.at === est.at && x.off === est.off)?.wp ?? s.wp;
  }
  /* the page's clock against the wall since the kept answer: 0 unless it moved more than JUMP (then that shift, and a new burst) */
  function drift() {
    if ( !est || !Number.isFinite(est.wp) ) return 0;
    const d = wp() - est.wp;
    if ( Math.abs(d) <= JUMP ) return 0;
    if ( started && !rebursting ) { rebursting = true; burst().finally(() => { rebursting = false; }); }
    return d;
  }
  function ping() {
    return new Promise((resolve) => {
      let done = false;
      const end = (v) => { if ( !done ) { done = true; resolve(v); } };
      try {
        if ( typeof send !== "function" ) return end(null);
        const t0 = now();
        send((server) => { const s = sample(t0, now(), Number(server)); add(s); end(s); });
        setTimeout(() => end(null), PING_TIMEOUT);
      } catch { end(null); }
    });
  }
  async function burst() { for ( let i = 0; i < BURST; i++ ) { await ping(); await new Promise((r) => setTimeout(r, BURST_GAP)); } }
  function start() {
    if ( started || typeof send !== "function" ) return false;
    started = true;
    burst().then(() => { timer = setInterval(() => { ping(); }, EVERY); timer?.unref?.(); });
    try { globalThis.document?.addEventListener?.("visibilitychange", () => { if ( globalThis.document.visibilityState === "visible" ) burst(); }); } catch {}
    return true;
  }
  const offset = () => (est ? est.off + drift() : null);
  return {
    start, ping, add, offset,
    ready: () => !!est,
    error: () => (est ? est.rtt / 2 + 0.5 : null),
    /** the table's clock now, server ms (Foundry's estimate until the first answer) */
    serverNow: () => (est ? now() + offset() : fb() ?? Date.now()),
    toPage: (server) => (est ? server - offset() : now() + (server - (fb() ?? Date.now()))),
    toServer: (page) => (est ? page + offset() : (fb() ?? Date.now()) + (page - now())),
    state: () => ({ samples: samples.length, off: est?.off ?? null, rtt: est?.rtt ?? null, error: est ? est.rtt / 2 + 0.5 : null, resets, at: est?.at ?? null }),
    _reset() { samples = []; est = null; started = false; clearInterval(timer); resets = 0; }
  };
}
