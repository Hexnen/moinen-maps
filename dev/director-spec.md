# Director: spec (2026-11-08)

A new submodule of moinen-maps. Its job: a cinematic feel for the PLAYERS. Everything that happens on the map is shown to them in a good-looking way.

## User decisions (binding)
1. **Autonomy: auto + GM override.** The director reacts to events by itself, by priority. The GM has a small bar during play: pause the director, "cut to" (a token / a spot / the last event), skip the current shot, intensity.
2. **Camera: hybrid by weight.** Big events take over the player's camera fully (pan/zoom, letterbox and the other screen effects) and then RETURN the camera to where the player had it. Small events do not move the camera: a picture-in-picture inset and/or an indicator on the screen edge plus a caption.
3. **Events in the first version, all four groups:**
   - module events: destruction (incl. carry / Superhero plough), zone fire / quake / zone states, orbit (going up / landing), flood, token altitude and floors;
   - token movement and combat turns: follow a moving token when it matters; a "turn: X" banner and a move to the active combatant;
   - rolls and damage from the Invincible system: an attacker -> target shot, captions with the result;
   - scene transitions: a title card with the scene name, a fade, an opening establishing shot.
4. **The existing cinematic mode of destruction is absorbed.** The director becomes the shared engine for camera and screen effects (letterbox, vignette, flash, shake, slow-mo, camera moves, presets, per-player opt-outs). Destruction's staged strokes / Action! become one source of events. The current behaviour and presets must keep working (no regression: `dev/cinematic-check.mjs`, `dev/cinematic-fx-check.mjs`, the cinematic tests in run-all).

## Hard requirements
- **Players never see what they should not.** No shot, inset, caption or indicator may reveal hidden tokens, GM-only things, or areas outside the player's vision / under fog. Test it with a real player login.
- **The player keeps control.** A take-over never starts while the player is dragging, measuring or panning; it waits or downgrades to the soft form. The player can always cut a shot short (Esc / a click) and the camera returns.
- **Per-player options:** opt out, intensity, a reduced-motion mode (no shake, no fast zooms).
- **All clients see the same shot at the same time** (same idea as the cinematic show: a shared clock). It must keep working when the GM leaves mid-shot.
- **Queue sense:** priorities, merging of events that come close together, cooldowns, no ping-pong between two spots, a shot never longer than it needs.
- **Idle cost ~0** (no ticker listeners while nothing plays; check with `dev/idle-bench.mjs`). Must work for every user (DPR, GPU), not only on the GM's machine.
- **Settings UI** in the workspace shell (a "Director" section), en + pl strings (`dev/lang-audit.mjs` clean). Presets like the cinematic ones.
- An API for other modules: emit an event (kind, weight, place/box/tokens, caption) and a hook (`moinenMapsDirector`) - e.g. moinen-pixel-vfx can feed it later.
- Kill switch like `CONFIG.moinenMaps.noCinematic`.

## Phases
- **A (one agent):** the engine (event model, queue, shot planner, sync, camera take-over and return, soft forms, overlays, GM bar, settings, per-player options, API), absorbing the cinematic mode, and the module-events source as the first real source.
- **B (after A is merged, in parallel):** movement + combat turns; rolls + damage (Invincible); scene transitions.
- **C (after B is merged, user order 2026-11-08):** two independent adversaries on the finished realization (GM + real player on a lane, watching it in motion). Each one: what breaks or feels wrong, what could work better, what to add, what to streamline - a brainstorm, not only a bug list. Their findings go to the user before anything is changed.

Every agent appends what it did, what is verified and what is not to `dev/director-handoff.md`.
