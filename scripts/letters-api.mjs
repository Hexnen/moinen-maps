/* LETR: hands the shared comic lettering engine (scripts/letters/) to macros and other modules:
     await game.modules.get("moinen-maps").api.letters()     -> the engine (see scripts/letters/README.md)
   The same engine instance is reachable as globalThis.MoinenLetters.engine() and from invincible-plus-ultra's api.letters(). */
import { api } from "./attrs.mjs";
import { letters } from "./letters/index.mjs";

api.letters = letters;
