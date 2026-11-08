window.__rs = [];
if ( !window.__rsOn ) { window.__rsOn = true; game.socket.on("module.moinen-maps", (m) => { if ( m?.t === "dir" ) window.__rs.push({ t: Math.round(performance.now()), op: m.op, id: m.shot?.id ?? m.ev?.id, who: m.shot?.who, tokens: m.shot?.tokens, form: m.shot?.form, cap: m.shot?.caption, after: m.shot?.after }); }); }
return true;
