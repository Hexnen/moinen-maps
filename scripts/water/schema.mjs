/**
 * The water settings window: which setting sits on which tab. Names are the engine's setting keys (lib/wowe/styles.lua);
 * ranges come from the engine at runtime. Labels and hints are the lang keys MOINENMAPS.Water.f.<key> and MOINENMAPS.Water.h.<key>.
 *
 * Field kinds: range (slider), toggle, select (options), colors (the six water colours), palette (six colours from one), looks, opacity.
 */
export const TABS = ["look", "water", "river", "fall", "rods", "output"];

export const LOOK_GROUPS = [
  ["falls", ["forest", "cave", "emerald", "ruins", "lava"]],
  ["lakes", ["pool", "river", "pond", "beach"]],
  ["clean", ["brook", "rocky", "shallow", "clear", "glassy", "lagoon", "stream"]]
];

export const COLOR_NAMES = ["shadow", "deep", "base", "light", "highlight", "foam"];
export const FRAME_CHOICES = [8, 12, 16, 24, 32];

const r = (key) => ({ kind: "range", key });
const t = (key) => ({ kind: "toggle", key });

/** Sections of every tab: [section name or "", fields]. */
export const SECTIONS = {
  look: [
    ["", [{ kind: "looks" }]],
    ["colors", [{ kind: "colors" }]],
    ["palette", [{ kind: "palette" }]],
    ["clean", [t("clean"), r("cleanSize"), r("shallows"), r("stones"), r("dither")]]
  ],
  water: [
    ["", [r("lap"), r("waves"), r("shade"), r("sparkle"), r("net"), r("cell"), r("patches"), r("depth"), r("drift"), r("angle")]],
    ["tide", [t("tide"), r("tideAmp"), r("tideCycles"), r("tideUneven"), r("tideWet")]],
    ["tokens", [t("fxOn"), r("fxStrength"), t("fxRings"), t("fxSplash"), t("fxWake"), { kind: "select", key: "fxWho", options: ["all", "gm"] }]]
  ],
  river: [
    ["", [r("flow"), r("rush"), r("rapids"), r("streaks"), r("rangle"), r("rnet"), r("rcell"), r("banks"), r("rdepth"), r("rpatches")]],
    ["mouth", [r("mouthFoam"), r("mouthFringe"), r("mouthTeeth"), r("mouthWave"), r("mouthRagged")]]
  ],
  fall: [
    ["", [{ kind: "select", key: "fallStyle", options: ["classic", "streaks", "fringe", "scales"] }, r("speed"), r("lines"), r("weave"), r("gaps"), r("top"), r("arcs"),
      r("edges"), r("shading"), { kind: "select", key: "light", options: ["left", "right"] }]],
    ["splash", [r("foam"), r("spread"), r("bubble"), r("spray")]],
    ["rings", [r("ripples"), r("reach"), r("reflect"), r("trail")]],
    ["mist", [r("mist"), r("rise")]]
  ],
  rods: [
    ["", [t("guideOn"), r("guideStrength"), r("guideReach"), r("guideFoam"), { kind: "rods" }]]
  ],
  output: [
    ["scene", [{ kind: "px" }, { kind: "enabled" }]],
    ["loop", [{ kind: "frames" }, r("ms")]],
    ["opacity", [{ kind: "opacity" }]]
  ]
};

/** Ranges the engine does not list (scene-level settings). */
export const EXTRA_RANGE = { fxStrength: [0, 10], px: [1, 64], palHue: [0, 60], palSat: [0, 60], palRange: [20, 180] };
