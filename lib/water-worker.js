/**
 * Water worker (classic worker script). Runs the WOWe Generator engine (lib/wowe/*.lua, MIT, by Yavuz) in a WebAssembly Lua VM
 * (lib/wasmoon, MIT) off the main thread.
 *
 * Requests (all carry `id`; each is answered with { id, ok: true, result } or { id, ok: false, error }):
 *   init    { base }                         load the engine; result: { order, looks, range, defaults, codes: Uint8Array(768) }
 *   palette { hex, hue, sat, range }         six colours from one
 *   bake    { W, H, masks, maskKey, params } bake the loop; streams { id, progress }, then { id, begin: { box, frames, ms } } once the box is known,
 *                                            then { id, frame, levels } per frame;
 *                                            result: { box: { x0, y0, w, h }, frames, ms }, or { superseded: true } when a newer bake arrived
 * `masks` are Uint8Arrays of W*H (1 = painted) named water / river / fall (any may be missing).
 */
let lua = null, FS = null, newest = 0, lastMaskKey = null, cachedInfo = null;

const ENGINE = ["codes", "noise", "mask", "flow", "guide", "clean", "mouth", "scape", "styles", "palette"];

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A JS value as Lua source (numbers, strings, booleans, arrays, plain objects), so no table marshalling is involved. */
function luaLit(v) {
  if ( v === null || v === undefined ) return "nil";
  if ( typeof v === "number" ) return Number.isFinite(v) ? String(v) : "0";
  if ( typeof v === "boolean" ) return v ? "true" : "false";
  if ( typeof v === "string" ) return `"${v.replace(/[\\"]/g, "\\$&").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\0/g, "\\0")}"`;
  if ( Array.isArray(v) ) return `{${v.map(luaLit).join(",")}}`;
  return `{${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `[${JSON.stringify(String(k))}]=${luaLit(x)}`).join(",")}}`;
}

async function init({ base }) {
  if ( cachedInfo ) return cachedInfo;
  importScripts(`${base}wasmoon/wasmoon.js`);
  const factory = new self.wasmoon.LuaFactory(`${base}wasmoon/glue.wasm`);
  for ( const f of ENGINE ) {
    const r = await fetch(`${base}wowe/${f}.lua`);
    if ( !r.ok ) throw new Error(`water engine: ${f}.lua ${r.status}`);
    await factory.mountFile(`/wowe/${f}.lua`, new Uint8Array(await r.arrayBuffer()));
  }
  lua = await factory.createEngine();
  FS = lua.cmodule.module.FS;
  await lua.doString(`
    _WOWE = { cache = {} }
    function _WOWE.require(name)
      local hit = _WOWE.cache[name]
      if hit ~= nil then return hit end
      local chunk, err = loadfile("/wowe/" .. name .. ".lua")
      if not chunk then error("water engine: " .. name .. " could not load\\n" .. tostring(err), 0) end
      local v = chunk(_WOWE)
      if v == nil then v = true end
      _WOWE.cache[name] = v
      return v
    end
    Mask = _WOWE.require("mask")
    Scape = _WOWE.require("scape")
    Styles = _WOWE.require("styles")
    Codes = _WOWE.require("codes")
    Palette = _WOWE.require("palette")
    local c = io.open("/codes.bin", "wb")
    for b = 0, 255 do local lv, el, un = Codes.decode(b); c:write(string.char(lv, el + 1, un)) end
    c:close()
  `);
  const codes = FS.readFile("/codes.bin"); FS.unlink("/codes.bin");
  const info = await lua.doString(`
    local looks = {}
    for name, look in pairs(Styles.LOOKS) do looks[name] = look end
    return { order = Styles.ORDER, looks = looks, range = Styles.RANGE, defaults = Styles.defaults(), fallStyles = Styles.FALL_STYLES, alphaKeys = Styles.ALPHA_KEYS, alphaStart = Styles.ALPHA_START }
  `);
  // an empty Lua table comes back as {}: the rods list is an array
  info.defaults.guides = [];
  cachedInfo = { ...info, codes };
  return cachedInfo;
}

async function palette({ hex, hue, sat, range }) {
  return await lua.doString(`return Palette.ramp(${luaLit(hex)}, ${luaLit(hue)}, ${luaLit(sat)}, ${luaLit(range)})`);
}

async function bake(req, post) {
  const { id, W, H, masks, maskKey, params } = req;
  newest = id;
  const stale = () => newest !== id;
  const names = ["water", "river", "fall"];
  if ( maskKey !== lastMaskKey || !(await lua.doString("return BAKE_R ~= nil"))  ) {
    for ( const n of names ) {
      if ( masks[n] ) FS.writeFile(`/m_${n}.bin`, masks[n]);
    }
    await lua.doString(`
      local W, H = ${W}, ${H}
      local function rd(name)
        local f = io.open(name, "rb"); if not f then return nil end
        local s = f:read("a"); f:close(); return s
      end
      local byte = string.byte
      local function mk(s) if not s then return nil end return function(x, y) return byte(s, y * W + x + 1) == 1 end end
      BAKE_R = Mask.fromFunctions(W, H, mk(rd("/m_water.bin")), mk(rd("/m_fall.bin")), mk(rd("/m_river.bin")))
      BAKE_PREV = nil
    `);
    lastMaskKey = maskKey;
    for ( const n of names ) { try { FS.unlink(`/m_${n}.bin`); } catch { /* not written */ } }
  }
  if ( !(await lua.doString("return BAKE_R ~= nil")) ) return { empty: true };
  post({ id, progress: 0.05 });
  await tick(); if ( stale() ) return { superseded: true };
  const info = await lua.doString(`
    local p = Styles.sanitize(${luaLit(params)})
    BAKE_P = p
    local F = Scape.prepare(BAKE_R, p, BAKE_PREV, function() end)
    BAKE_F, BAKE_PREV = F, F
    local b = Scape.box(F)
    return { x0 = b.x0, y0 = b.y0, w = b.w, h = b.h, frames = p.frames, ms = p.ms }
  `);
  const n = info.frames;
  post({ id, begin: { box: { x0: info.x0, y0: info.y0, w: info.w, h: info.h }, frames: n, ms: info.ms } });
  for ( let i = 1; i <= n; i++ ) {
    post({ id, progress: 0.2 + 0.8 * (i - 1) / n });
    await tick(); if ( stale() ) return { superseded: true };
    await lua.doString(`
      local s = Scape.frame(BAKE_F, BAKE_P, ${i}, function() end)
      local f = io.open("/frame.bin", "wb"); f:write(s); f:close()
    `);
    const levels = FS.readFile("/frame.bin"); FS.unlink("/frame.bin");
    post({ id, frame: i, levels }, [levels.buffer]);
  }
  return { box: { x0: info.x0, y0: info.y0, w: info.w, h: info.h }, frames: n, ms: info.ms };
}

self.onmessage = async (ev) => {
  const m = ev.data, id = m.id;
  const post = (msg, transfer) => self.postMessage(msg, transfer ?? []);
  try {
    let result;
    if ( m.type === "init" ) result = await init(m);
    else if ( m.type === "palette" ) result = await palette(m);
    else if ( m.type === "bake" ) result = await bake(m, post);
    else throw new Error(`unknown request ${m.type}`);
    post({ id, ok: true, result });
  } catch ( err ) {
    post({ id, ok: false, error: String(err?.message ?? err) });
  }
};
