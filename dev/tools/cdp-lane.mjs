// Small CDP client for the lane benches (node 22: global WebSocket / fetch). Used by dev/stack-bench-run.mjs; also a CLI:
//   node dev/tools/cdp-lane.mjs eval <port> <urlPrefix> <file.js>     evaluates the file's body as an async function in that tab
//   node dev/tools/cdp-lane.mjs join <port> <origin> <userId>         opens <origin>/join in a new tab and logs that user in (no password)
//   node dev/tools/cdp-lane.mjs list <port>
import fs from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function targets(port) { return (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); }

/** A connection to one page target: `ev(src)` evaluates `src` as the body of an async function and returns its value (JSON). */
export async function connect(port, prefixOrId) {
  const list = await targets(port);
  const t = list.find((x) => x.type === "page" && (x.id === prefixOrId || x.url.startsWith(prefixOrId)));
  if ( !t ) throw new Error(`no page ${prefixOrId}: ${list.filter((x) => x.type === "page").map((x) => x.url).join(", ")}`);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  let id = 0; const pend = new Map();
  ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if ( d.id && pend.has(d.id) ) { pend.get(d.id)(d); pend.delete(d.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (src, timeout = 600000) => {
    const r = await send("Runtime.evaluate", { expression: `(async()=>{${src}})()`, awaitPromise: true, returnByValue: true, timeout });
    if ( r.result?.exceptionDetails ) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    if ( r.error ) throw new Error(JSON.stringify(r.error));
    return r.result?.result?.value;
  };
  const front = async () => { await send("Page.bringToFront"); await send("Emulation.setFocusEmulationEnabled", { enabled: true }); };
  return { id: t.id, url: t.url, send, ev, front, close: () => ws.close() };
}

/** Open `<origin>/join` in a new tab and log `uid` in; resolves when the game page has a ready canvas. Returns the target id. */
export async function join(port, origin, uid, { wait = 90000 } = {}) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${origin}/join`, { method: "PUT" })).json();
  await sleep(3000);
  let c = await connect(port, t.id);
  for ( let i = 0; i < 20; i++ ) {
    try { if ( await c.ev("return !!document.querySelector('select[name=userid]')") ) break; } catch {}
    await sleep(500);
  }
  await c.ev(`const s = document.querySelector('select[name=userid]'); s.value = ${JSON.stringify(uid)}; s.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('button[name=join]').click(); return 1;`);
  c.close();
  const end = Date.now() + wait;
  while ( Date.now() < end ) {
    await sleep(1500);
    try { c = await connect(port, t.id); const ok = await c.ev("return !!(globalThis.game?.ready && canvas?.ready)", 5000); c.close(); if ( ok ) return t.id; } catch {}
  }
  throw new Error(`join ${origin} ${uid}: no ready canvas`);
}

if ( import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/").replace(/^\//, "")}` || process.argv[1]?.endsWith("cdp-lane.mjs") ) {
  const [cmd, port, a, b] = process.argv.slice(2);
  if ( cmd === "eval" ) { const c = await connect(port, a); console.log(JSON.stringify(await c.ev(fs.readFileSync(b, "utf8")))); c.close(); }
  else if ( cmd === "join" ) console.log(await join(port, a, b));
  else if ( cmd === "list" ) console.log((await targets(port)).filter((x) => x.type === "page").map((x) => `${x.id} ${x.url}`).join("\n"));
  process.exit(0);
}
