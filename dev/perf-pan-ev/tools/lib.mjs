export const PORT = 9533;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = `http://127.0.0.1:${PORT}`;
export const list = async () => (await fetch(`${base}/json/list`)).json();
export async function connectT(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  let id = 0; const pend = new Map(), on = new Map();
  ws.addEventListener("message", (m) => { const q = JSON.parse(m.data); if ( q.id && pend.has(q.id) ) { pend.get(q.id)(q); pend.delete(q.id); } else if ( q.method ) for ( const f of on.get(q.method) ?? [] ) f(q.params); });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (js, timeout = 280000) => {
    const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true, timeout });
    if ( r.result?.exceptionDetails ) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    if ( r.error ) throw new Error(JSON.stringify(r.error));
    return r.result?.result?.value;
  };
  return { t, ws, send, ev, on: (m, f) => { if ( !on.has(m) ) on.set(m, []); on.get(m).push(f); }, off: (m) => on.delete(m), close: () => ws.close() };
}
export async function page(prefix) { const t = (await list()).find((x) => x.type === "page" && x.url.startsWith(prefix)); if ( !t ) throw new Error("no page " + prefix); return connectT(t); }
export async function browser() { return connectT({ webSocketDebuggerUrl: (await (await fetch(`${base}/json/version`)).json()).webSocketDebuggerUrl }); }
