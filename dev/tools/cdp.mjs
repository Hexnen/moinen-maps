// usage: node cdp.mjs <port> <targetUrlPrefix|new:URL> <file-with-js-expression>   -> prints the JSON result
import fs from "node:fs";
const [port, which, file] = process.argv.slice(2);
let list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
let t;
if ( which.startsWith("new:") ) t = await (await fetch(`http://127.0.0.1:${port}/json/new?${which.slice(4)}`, { method: "PUT" })).json();
else t = list.find((x) => x.type === "page" && x.url.startsWith(which));
if ( !t ) { console.log("no target", list.map((x) => x.url)); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if ( d.id && pend.has(d.id) ) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
if ( file === "-" ) { console.log(t.id, t.url); process.exit(0); }
await send("Page.bringToFront"); await send("Emulation.setFocusEmulationEnabled", { enabled: true });
const expr = fs.readFileSync(file, "utf8");
const r = await send("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true, timeout: 280000 });
console.log(JSON.stringify(r.result?.exceptionDetails ? { exception: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text } : r.result?.result?.value, null, 1));
process.exit(0);
