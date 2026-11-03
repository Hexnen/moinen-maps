import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const dir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, "")), "shots");
http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.end(); return; }
  const name = decodeURIComponent(req.url.slice(1)).replace(/[^\w.-]/g, "_"); let b = "";
  req.on("data", (d) => b += d); req.on("end", () => { fs.writeFileSync(path.join(dir, name), Buffer.from(b.replace(/^data:[^,]*,/, ""), "base64")); res.end("ok"); });
}).listen(39777, "127.0.0.1");
