// node dev/look-pack.test.mjs: a plain look packed into three buffers (bake.mjs prime) comes back as the same sprites in the lane (look-pack.mjs).
const { packLook, unpackLook } = await import("../scripts/destruction/look-pack.mjs");
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) fails++; };
const sp = (w, h, seed) => ({ m: Int32Array.from({ length: 18 }, (_, i) => seed + i * 3), w, h, img: Uint8Array.from({ length: w * h * 4 }, (_, i) => (i * seed) % 251) });
const look = [sp(3, 2, 5), sp(1, 1, 9), sp(4, 4, 2)];
const p = packLook(look), back = unpackLook(p);
ok(p.n === 3 && p.px.length === (6 + 1 + 16) * 4 && p.metas.length === 54, "three buffers: metas, sizes, pixels");
ok(back.every((s, i) => s.w === look[i].w && s.h === look[i].h && s.m.every((v, k) => v === look[i].m[k]) && s.img.every((v, k) => v === look[i].img[k])), "the sprites come back as they went in");
ok(back[0].img.buffer !== back[1].img.buffer && back[0].m.buffer !== back[1].m.buffer, "each sprite owns its buffers (a result may transfer them)");
ok(packLook([]) === null && packLook([{ m: [1], w: 1, h: 1, img: new Uint8Array(4) }]) === null && packLook([{ ...look[0], extra: 1 }]) === null, "a look of another shape is not packed (sent as before)");
if ( fails ) { console.log(`${fails} FAILED`); process.exit(1); }
console.log("PASS");
