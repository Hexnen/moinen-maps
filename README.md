# Moinen Maps

Foundry VTT v14 module: map notes become hand-inked animated pins (bouncy drop, hop, idle motion), standalone pins without notes from one toolbar tool with a pin palette (Classic, Fantasy and Modern presets, plus your own custom presets), and freehand painted "districts" with inked outlines, hatch/halftone fills, labels, attributes and hover effects. Configured per scene in the Pins tab of Scene Config.

## Water

Paint rivers, lakes, ponds and waterfalls on the map and they become a seamlessly looping, animated pixel-art scene played between the map and the districts. Toolbar (Moinen Maps group): three brushes (still water, river, fall), an eraser, the rod tool and the water settings.

- **Painting:** the brushes edit three masks; `[` and `]` change the brush size, `Ctrl+Z` undoes a stroke. A river that overlaps the top of a fall becomes the fall's mouth; a lake under a fall gets rings, foam and mist.
- **Settings window:** every setting of the engine on six tabs. Look (16 looks, the six colours, six colours from one, clean pixel art), Water (shore foam, waves, shade, sparkle, net, patches, depth, drift, tide), River (speed, rush, rapids, streaks, way, net, banks, depth, patches, the mouth), Fall (style, speed, lines, weave, slits, top, arcs, edges, shading, light, splash, rings, reflection, trail, mist), Rods and Output (art pixel size, frames, frame time, opacity of every part). Changing colours or opacity never bakes again.
- **Rods:** bendable lines drawn on the map. Flow rods steer the water (with branches); lip rods draw the edge a fall goes over. Drag for a new rod, drag a dot to bend, drag the line for a new dot, Shift-drag an end dot to grow it, Alt-drag the line for a branch, right-click to remove.
- **Tokens in the water:** a token that stands in water gets pixel-art rings, one that enters or leaves it makes a splash, and one that moves leaves a foam wake carried by the current (the river's way, a flow rod or the drift). It is a light layer over the baked water, so nothing is baked again; switch it, its strength and who sees it in the Water tab.
- **Reflections of tokens:** an optional mirror image (or a black shadow) under every token, shown only where there is water, on the water's pixel grid. The same effects as Reflecto: offset, opacity, eleven blur shapes, ripple (amplitude, frequency, speed; loops with the water) and scanline shift; plus length, fade with distance and a tint from the water. Off by default; meant for side and oblique views.
- **Tokens under the water:** a token with an elevation below zero that stands in water is veiled by the water (darker the deeper it is, wavering) with bubbles rising from it. Nothing is baked and the token itself is untouched.
- **How it is shared:** the masks and settings are saved in the scene. A few seconds after the GM's last change the GM's client uploads the baked water as one PNG to `worlds/<world>/moinen-maps/` and players download it, with no baking, no worker and no waiting (about 66 KB for 16 frames of a small scene). A client that cannot get it (the GM has no upload right, or edited since) bakes the same seeded loop itself, and keeps the result in the browser for next time. The art pixel size (Output tab) sets how many scene pixels one pixel of the water art covers; smaller is finer and slower to bake.
- The waterfalls and the mouth are drawn for a side or oblique view (falling toward the bottom of the screen); lakes, ponds and rivers work from any angle (set the river's Way and the drift's direction).

## Credits

The water is the engine of **WOWe Generator** by Yavuz (https://arsden.itch.io/wowe-generator-for-aseprite, MIT), an extension for Aseprite. Its Lua code is included unmodified in `lib/wowe` and runs in a WebAssembly Lua VM (`lib/wasmoon`, wasmoon, MIT); Moinen Maps adds the painting, the settings window, the rods editor and the display. See `lib/wowe/NOTICE.md` and `lib/wasmoon/NOTICE.md`.

The set of token reflection effects follows **Reflecto** by Devkidd (https://devkidd.itch.io/reflecto), an Aseprite extension. No code of it is used: its license does not allow redistribution, so the effects are written from scratch.
