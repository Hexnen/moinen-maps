// player page: summary of the watcher: camera moves (segments), time away from the player's own view, letterbox time, returns home
const W = window.__w; if ( !W ) return null;
const [hx, hy, hs] = W.home, cam = W.cam;
const away = (c) => Math.hypot(c[1] - hx, c[2] - hy) * c[3] > 24 || Math.abs(c[3] / hs - 1) > 0.03;   // (24 screen px or 3 % zoom)
const moves = []; let mv = null;
for ( let i = 1; i < cam.length; i++ ) {
  const a = cam[i - 1], c = cam[i];
  const d = Math.hypot(c[1] - a[1], c[2] - a[2]) * c[3] + Math.abs(c[3] / a[3] - 1) * 800;
  if ( d > 2 ) { if ( !mv ) mv = { from: a[0], start: a.slice(1, 4) }; mv.to = c[0]; mv.end = c.slice(1, 4); }
  else if ( mv && c[0] - mv.to > 400 ) { moves.push(mv); mv = null; }
}
if ( mv ) moves.push(mv);
let awayMs = 0, barsMs = 0, returns = 0, outs = 0, prevAway = false;
for ( let i = 1; i < cam.length; i++ ) {
  const dt = cam[i][0] - cam[i - 1][0], a = away(cam[i]);
  if ( a ) awayMs += dt; if ( cam[i][4] ) barsMs += dt;
  if ( a && !prevAway ) outs++; if ( !a && prevAway ) returns++;
  prevAway = a;
}
const span = cam.at(-1)[0] - cam[0][0];
return { user: game.user.name, spanS: +(span / 1000).toFixed(1), moves: moves.length, awayS: +(awayMs / 1000).toFixed(1), barsS: +(barsMs / 1000).toFixed(1), outs, returns,
  endAway: away(cam.at(-1)), last: cam.at(-1), home: W.home, moveList: moves.map((m) => [m.from, m.to, m.end]), log: W.log };
