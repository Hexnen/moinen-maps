/**
 * The cinematic screen effects moved into the DIRECTOR (scripts/director/screen.mjs): it is now the one engine for camera and screen
 * effects of every shot (the destruction show is one of its sources). This file stays so old imports keep working.
 */
export * from "../director/screen.mjs";
