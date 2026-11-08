/**
 * The cinematic screen effects are the DIRECTOR's screen now (scripts/director/stage.mjs: one engine for the destruction show and the
 * director's shots). This file stays so old imports (cinematic.mjs loads it lazily) keep working.
 */
export { CinematicFx, Screen, clientOpts, OPT_KEYS } from "../director/stage.mjs";
export { CinematicFx as default } from "../director/stage.mjs";
