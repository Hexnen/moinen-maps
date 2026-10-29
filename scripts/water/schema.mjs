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
    ["tokens", [t("fxOn"), r("fxStrength"), t("fxRings"), t("fxSplash"), t("fxWake"), { kind: "select", key: "fxWho", options: ["all", "gm"] }]],
    ["submerge", [t("submergeOn"), r("submergeStrength"), r("submergeDepth"), t("submergeBubbles"), { kind: "select", key: "submergeWho", options: ["all", "gm"] }]],
    ["reflect", [t("reflectOn"), { kind: "select", key: "reflectType", options: ["reflection", "shadow"] }, r("reflectOpacity"), r("reflectOffset"),
      { kind: "select", key: "reflectBlurType", options: ["none", "3x3", "3x3hard", "5x5", "7x7", "9x9", "17x17", "5x3left", "17x3left", "3x17top", "5x5diagback", "5x5diagfwd"] },
      t("reflectRipple"), r("reflectAmp"), r("reflectFreq"), r("reflectSpeed"), t("reflectScan"), r("reflectScanValue"), r("reflectLength"), r("reflectFade"), r("reflectTint"),
      { kind: "select", key: "reflectWho", options: ["all", "gm"] }]]
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
export const EXTRA_RANGE = { submergeStrength: [0, 10], submergeDepth: [1, 100], reflectAmp: [0, 100], reflectFreq: [0, 100], reflectSpeed: [1, 20], reflectScanValue: [0, 12], reflectOpacity: [0, 100], reflectOffset: [-8, 16], reflectLength: [20, 150], reflectFade: [0, 10], reflectTint: [0, 10], fxStrength: [0, 10], px: [1, 64], palHue: [0, 60], palSat: [0, 60], palRange: [20, 180] };
