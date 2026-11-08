window.__A = { atk: "xvGY6hI8aVlS1L5H", tgt: ["g6EcTYucya8eklEZ"], dice: 3, dmg: 3, type: "slugfest", mode: "publicroll", flavor: "Viltrumite Punch" };
await new Function(`return (async()=>{${window.__atkSrc}})()`)();
setTimeout(() => { const id = game.messages.contents.at(-1).id; document.querySelector(`[data-message-id="${id}"] button[data-action="pushRoll"]`)?.click(); }, 6800);
return 1;
