# WOWe Generator engine

The Lua files in this folder are the water engine of **WOWe Generator** (v2.0) by Yavuz, an extension for Aseprite
(https://arsden.itch.io/wowe-generator-for-aseprite), used unmodified under the MIT license (see `LICENSE`).
Moinen Maps runs them in a WebAssembly Lua VM (`../wasmoon`, MIT) and supplies its own mask painting, settings window and display.
The Aseprite-only parts of the extension (its window, layer access and sprite output) are not included.
