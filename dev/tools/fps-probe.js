// Paste into a lane tab console for a quick fps number over 3 s (a hidden/unfronted tab reports ~0: the pane must be fronted).
let n=0; const f=()=>{n++; requestAnimationFrame(f)}; requestAnimationFrame(f); await new Promise(r=>setTimeout(r,3000));
const fx=game.modules.get("moinen-maps").api.cinematic;
return {fps:n/3, fx: typeof fx.begin, scene: canvas.scene?.name, hidden: document.hidden, scale: canvas.stage.scale.x, sr: canvas.dimensions.sceneRect, sets: Object.keys(game.settings.settings).filter(k=>k.includes("moinen-maps.cin"))}
