# Blind judge brief: destruction presets (round 2)

You are an independent visual judge. You have NOT seen and must NOT read any source code (do not open anything under C:/mmwt-*/scripts,
C:/Users/santa/AppData/Local/FoundryVTT, or any .mjs/.js file). Judge only the recordings.

## What you are judging
Four "destruction presets" of a Foundry VTT map module: one click/drag on a map puts down a whole event at once. Pixel-art style on
an art grid (crisp pixels are intended, not a defect). Camera is an oblique top-down view: things that rise go UP the screen, a
thing's ground point is below it on screen.
- **bomb** (click at a point): an aerial bomb falls (its shadow tightens, the bomb drops), impact flash, a rolling fireball that turns
  into a dark mushroom/smoke column, a shock ring of ground dust, burning debris, a charred torn crater, small fires that keep
  burning, and a dust haze that stays for minutes.
- **grenade** (drag thrower -> landing spot): a grenade arcs in, bounces, rolls; a sharp dirty grey-brown blast with a short orange
  heart, shrapnel pocks, a small crater, a low dust ring, light smoke.
- **uzi** (drag a line): a ragged stitch of small hits walking along the line with a random spread: each a pock, a puff of the
  ground's colour, sparks.
- **heliHmg** (classic twin heavy machine gun from a helicopter, drag a run): two parallel lanes of heavy hits racing along the run,
  slightly out of step, tall dust geysers, sparks, tracers streaking in from above; a chewed double line of pocks and small craters.

## The bar (from the user)
WOW, natural and organic; no squares, rectangles or visible area edges; smooth in and out (nothing pops in or out); reads correctly
in the oblique top-down view; readable at play zooms (about 0.6-3), by day and at night.

## Recordings
Folder: C:/mmwt-polish/dev/out/pol/  files `after-<preset>-z<zoom>-<day|night>.webm` (preset bomb, grenade, uzi, heliHmg; zoom 1 and
3; 1600x813 px, 30 fps, captured at device pixel ratio 2). Each starts ~0.6 s before the click. The impact (T0) is at about click +
pre-roll: bomb +1.2 s (T0 ~1.8 s into the file), grenade +1.5 s (~2.1 s), uzi +0.6 s (~1.2 s), heliHmg +1.5 s (~2.1 s). Bomb
files run 15 s, grenade/heli 9 s, uzi 7 s. The effect is centred in the frame.

To look at them, extract frames with ffmpeg (on PATH), e.g. a contact sheet:
`bash C:/Users/santa/AppData/Local/Temp/claude/48dc353776a1781e/19e279de-e9ef-46b4-8e62-50619d0ac6fc/scratchpad/sheet.sh <in.webm> <out.png> "1.7 1.8 1.9 2.0 2.2 2.5 3 4 6 9" "crop=W:H:X:Y" 4`
(times in seconds; the crop filter is optional, any ffmpeg -vf filter chain works, e.g. "crop=600:400:500:200,scale=1200:800").
Write your PNGs only under C:/Users/santa/AppData/Local/Temp/claude/48dc353776a1781e/19e279de-e9ef-46b4-8e62-50619d0ac6fc/scratchpad/judge2/.
Judge MOTION, not single stills: use dense time steps (every 1/30-1/15 s) around the impact and the first second, and crops/zooms
of the effect. Look at every file (all 16), both zooms, day and night.

## What to return (plain text, your final message)
1. A score table: for each preset, scores 1-10 for: wow, natural/organic, no-hard-edges, smooth in/out, oblique-view read, zoom-1
   read, zoom-3 read, night read; and one overall (1-10). 10 = AAA-game quality pixel-art effect; 8 = clearly good, shippable; 5 =
   mediocre; 3 = poor.
2. For each preset, the weaknesses you see, MOST important first, each with the file(s) and time(s) where it shows and what it looks
   like (precise: shape, colour, size, timing). Include anything that pops, looks like a disc/square/ring/outline/edge, looks
   mechanical/repetitive, reads wrong in the oblique view, is invisible/unreadable at a zoom or at night, or happens at the wrong
   moment (before the impact, after it should have ended).
3. What already works well (briefly).
Do not suggest code. Be blunt and specific.
