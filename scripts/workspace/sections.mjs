/**
 * The seven sections of Moinen Maps (the second column of its scene-controls button), in order. Importing a section file registers it (workspace/registry.mjs).
 * A new feature adds its file here, or replaces a placeholder of soon.mjs by registering the same id.
 */
import "./pins.mjs";
import "./districts.mjs";
import "./water.mjs";
import "../weather/section.mjs";   // Weather: rain (+ more), wind, the lens (scripts/weather)
import "./soon.mjs";
import "../destruction/section.mjs";   // Destruction takes over its placeholder (localStorage "mm-destruction" = "off" leaves it out)
import "../fire/section.mjs";          // Fire and smoke: tools and a dock panel of the Destruction section (scripts/fire)
import "../roads/workspace.mjs";   // Roads take over their placeholder
import "./tokens.mjs";             // Tokens: enter / leave / idle / death of tokens (scripts/tokens)
