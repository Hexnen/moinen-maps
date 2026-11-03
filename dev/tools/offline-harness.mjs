// node dev/tools/offline-harness.mjs <outDir> [kind=grass] [type=0]: procedural map + painted masks -> core.bake -> composite PNGs (no Foundry) for looking at.
import { bake, readMeta, META_FIELDS } from "../../scripts/destruction/core.mjs";
import zlib from "node:zlib";
import fs from "node:fs";
import crypto from "node:crypto";

const OUT = process.argv[2] ?? ".";
function png(w, h, rgba) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const h2 = (x, y, s) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

function makeMap(kind, W, H) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, n = h2(x, y, 3) - 0.5, n2 = h2(x >> 2, y >> 2, 9) - 0.5;
    let c;
    if (kind === "grass") c = [78 + n * 30 + n2 * 20, 128 + n * 36 + n2 * 30, 58 + n * 20];
    else if (kind === "stone") {
      const bx = (x + ((y / 10 | 0) % 2) * 6) % 12, by = y % 10;
      const mortar = bx === 0 || by === 0;
      const t = h2((x + ((y / 10 | 0) % 2) * 6) / 12 | 0, y / 10 | 0, 5) * 30;
      c = mortar ? [70, 68, 66] : [128 + t + n * 18, 124 + t + n * 18, 118 + t + n * 18];
    } else if (kind === "wood") {
      const plank = (x / 7) | 0, edge = x % 7 === 0, t = h2(plank, 1, 4) * 26, grain = Math.sin(y * 0.4 + plank * 3) * 6;
      c = edge ? [60, 38, 22] : [150 + t + grain + n * 10, 100 + t * 0.7 + grain + n * 8, 58 + t * 0.4 + n * 6];
      if (((y + plank * 17) % 40) === 0) c = [70, 45, 26];
    } else if (kind === "sand") c = [214 + n * 16, 190 + n * 16, 138 + n * 14];
    else if (kind === "snow") c = [232 + n * 12, 238 + n * 10, 245 + n * 6];
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  return d;
}

// a mask on the mask grid (K = 2): discs with levels and types
function makeMask(mw, mh, shapes) {
  const m = new Uint8Array(mw * mh);
  for (const s of shapes) {
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      for (const [cx, cy, r] of s.discs) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r) {
          const lvl = s.graded ? (d < r * 0.45 ? 3 : d < r * 0.78 ? 2 : 1) : s.level;
          const i = y * mw + x; if ((m[i] & 3) <= lvl) m[i] = lvl | (s.type << 2);
        }
      }
    }
  }
  return m;
}

const kind = process.argv[3] ?? "grass";
const type = Number(process.argv[4] ?? 0);
const W = 200, H = 150, K = 2, mw = W / K, mh = H / K;
const map = makeMap(kind, W, H);
const line = []; for (let t = 0; t <= 1; t += 0.05) line.push([62 + t * 26, 22 + t * 40, 3.2]);
const shapes = [
  { discs: [[28, 32, 15]], graded: true, type },
  { discs: line, level: 2, type: type === 0 ? 5 : type },
  { discs: [[22, 62, 6], [28, 64, 5]], level: 1, type: 4 },
];
const mask = makeMask(mw, mh, shapes);
const params = { debris: 0.7, scatter: 1, lift: 1, rubble: 0.6, halo: 0.6, edge: 0.7, material: "auto" };
const res = bake({ mask, mw, mh, K, aw: W, ah: H, seed: 1234, params, map: { x0: 0, y0: 0, w: W, h: H, data: map } });
console.log(JSON.stringify(res.stats));
const meta = readMeta(res.sheet.data, res.sheet.w, res.sheet.h, res.metaRows);
// composite
const comp = new Uint8ClampedArray(map);
const blit = (sx, sy, w, h, dx, dy) => {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = dx + x, Y = dy + y; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    const s = ((sy + y) * res.sheet.w + sx + x) * 4, a = res.sheet.data[s + 3] / 255; if (!a) continue;
    const o = (Y * W + X) * 4;
    for (let k = 0; k < 3; k++) comp[o + k] = comp[o + k] * (1 - a) + res.sheet.data[s + k] * a;
  }
};
for (let k = 0; k < meta.length / META_FIELDS; k++) { const o = k * META_FIELDS; if (meta[o] === 0) blit(meta[o + 1], meta[o + 2], meta[o + 3], meta[o + 4], meta[o + 5], meta[o + 6]); }
for (let k = 0; k < meta.length / META_FIELDS; k++) { const o = k * META_FIELDS; if (meta[o] === 1) blit(meta[o + 1], meta[o + 2], meta[o + 3], meta[o + 4], meta[o + 5], meta[o + 6]); }
const S = 4, big = new Uint8ClampedArray(W * S * H * S * 4);
for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) { const s = (((y / S) | 0) * W + ((x / S) | 0)) * 4, o = (y * W * S + x) * 4; big[o] = comp[s]; big[o + 1] = comp[s + 1]; big[o + 2] = comp[s + 2]; big[o + 3] = 255; }
fs.writeFileSync(`${OUT}/comp-${kind}-${type}.png`, png(W * S, H * S, big));
fs.writeFileSync(`${OUT}/sheet-${kind}-${type}.png`, png(res.sheet.w, res.sheet.h, res.sheet.data));
console.log("sheet", res.sheet.w, res.sheet.h, "md5", crypto.createHash("md5").update(res.sheet.data).digest("hex"));
