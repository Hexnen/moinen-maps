const D = game.modules.get("moinen-maps").api.director;
await D.setOn(true); await D.setPaused(false); await D.setGmIntensity(1);
return D.status();
