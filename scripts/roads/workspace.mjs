import { registerSection } from "../workspace/registry.mjs";
import { roadsSection } from "./section.mjs";

/** Roads take over their placeholder in the Moinen Maps Tools workspace (imported by workspace/sections.mjs after soon.mjs). */
registerSection(roadsSection());
