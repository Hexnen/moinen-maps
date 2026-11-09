// model.mjs compositeOver(S, o): one object on top of a composite mask equals the full composite of all objects (the cheap path of a
// stroke's end).   node dev/composite-over.test.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call() {} };
const M = await import(pathToFileURL(path.join(root, "scripts/destruction/model.mjs")).href);
let failed = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) failed++; };
const mw = 200, mh = 150;
let seed = 7; const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
const S = { mw, mh, mask: new Uint8Array(mw * mh), objects: [] }, ref = { mw, mh, objects: [] };
let same = true, worst = 0;
for ( let n = 0; n < 120; n++ ) {
  const cx = rnd() * mw, cy = rnd() * mh, r = 3 + rnd() * 25, erase = rnd() < 0.2, lv = 1 + Math.floor(rnd() * 3), type = Math.floor(rnd() * 6);
  const box = { x0: Math.max(-5, Math.floor(cx - r)), y0: Math.max(0, Math.floor(cy - r)), x1: Math.min(mw + 4, Math.ceil(cx + r)), y1: Math.min(mh - 1, Math.ceil(cy + r)) };
  const buf = new Uint8Array(mw * mh);
  for ( let y = Math.max(0, box.y0); y <= box.y1; y++ ) for ( let x = Math.max(0, box.x0); x <= Math.min(mw - 1, box.x1); x++ ) if ( Math.hypot(x - cx, y - cy) <= r ) buf[y * mw + x] = lv;
  box.x0 = Math.max(0, box.x0); box.x1 = Math.min(mw - 1, box.x1);
  const o = M.makeObject(buf, mw, box, { id: `o${n}`, erase, type });
  S.objects.push(o); M.compositeOver(S, o);
  ref.objects.push(o); const full = M.composite(ref);
  if ( S.mask.some((v, i) => v !== full[i]) ) { same = false; worst = n; break; }
}
ok(same, `120 random strokes (paint and erase, all types): the incremental mask equals the full composite${same ? "" : ` (differs at stroke ${worst})`}`);
const E = { mw, mh, objects: [] }, o1 = M.makeObject(new Uint8Array(mw * mh).fill(1), mw, { x0: 0, y0: 0, x1: 9, y1: 9 }, { id: "a" });
E.objects.push(o1); M.compositeOver(E, o1); ok(E.mask && E.mask[0] === M.byteOf(1, 0), "a state without a mask falls back to the full composite");
// undo: drop the last object and recomposite only its box
let undoOk = true;
for ( let n = 0; n < 60 && undoOk; n++ ) {
  const g = S.objects.pop(); M.compositeBox(S, { x0: g.x0, y0: g.y0, x1: g.x0 + g.w - 1, y1: g.y0 + g.h - 1 });
  ref.objects.pop(); const full = M.composite(ref);
  if ( S.mask.some((v, i) => v !== full[i]) ) undoOk = false;
}
ok(undoOk, "60 undos: the box-only recomposite equals the full composite");
// hasPaint (a Uint32 scan since perf-arrival): the same answer as "any byte with a level" - level bits only (a type alone is no paint), every
// position (the tail bytes of a length that is no multiple of 4, an unaligned view)
{
  const ref = (m) => m.some((v) => v & 3);
  let same = true;
  for ( const n of [0, 1, 3, 4, 5, 63, 64, 1001] ) for ( let i = -1; i < n && same; i++ ) for ( const b of [1, 2, 3, 4, 8, 28, 0x1c | 1] ) {
    const m = new Uint8Array(n); if ( i >= 0 ) m[i] = b;
    if ( M.hasPaint({ mask: m }) !== ref(m) ) same = false;
    const buf = new Uint8Array(n + 3); if ( i >= 0 ) buf[i + 1] = b; const v = buf.subarray(1, n + 1);
    if ( M.hasPaint({ mask: v }) !== ref(v) ) same = false;
  }
  ok(same && M.hasPaint(null) === false, "hasPaint: the same as a byte-by-byte test (levels only, tails, unaligned views)");
}
process.exit(failed ? 1 : 0);
