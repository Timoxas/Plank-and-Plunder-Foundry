Hooks.once("ready", () => {
  const MODULE = "plank-and-plunder";
  const user = game.user;

  async function joinLobby() {
    await user.setFlag(MODULE, "joined", true);
    ui.notifications.info("Du bist der Lobby beigetreten.");
    renderLobby();
  }
  async function leaveLobby() {
    await user.unsetFlag(MODULE, "joined");
    ui.notifications.info("Du hast die Lobby verlassen.");
    renderLobby();
  }
  function getLobbyUsers() {
    return game.users.players.filter(u => u.getFlag(MODULE, "joined"));
  }
  function getHost() {
    const lobby = getLobbyUsers();
    return lobby.find(u => u.isGM) || lobby[0];
  }
  function isHost() {
    return getHost()?.id === user.id;
  }

  async function startGame() {
    const lobby = getLobbyUsers();
    if (lobby.length < 2 || lobby.length > 4) {
      ui.notifications.warn("Das Spiel benötigt 2–4 Spieler.");
      return;
    }
    ChatMessage.create({ content: `<strong>Spiel startet mit ${lobby.length} Spielern…</strong>` });
    let rolls = [];
    for (let p of lobby) {
      const r = await new Roll("1d6").roll({ async: true });
      await r.toMessage({ flavor: `${p.name} würfelt Startspieler`, speaker: { alias: p.name } });
      rolls.push({ id: p.id, name: p.name, value: r.total });
      await new Promise(res => setTimeout(res, 400));
    }
    rolls.sort((a, b) => b.value - a.value);
    const startId = rolls[0].id;
    const ordered = reorderByStart(lobby, startId);
    ChatMessage.create({ content: `<strong>Startspieler ist: ${game.users.get(startId)?.name}</strong>` });
    let roundData = [];
    for (let p of ordered) {
      const r2 = await new Roll("5d6").roll({ async: true });
      const vals = r2.terms[0].results.map(r => r.result);
      await r2.toMessage({ flavor: `Deine verdeckten 5W6`, speaker: { alias: p.name }, whisper: [p.id] });
      roundData.push({ name: p.name, results: vals });
      await new Promise(res => setTimeout(res, 400));
    }
    let sum = `<strong>Runde 1 – Ergebnisse:</strong><ul>`;
    for (let r of roundData) sum += `<li>${r.name}: ${r.results.join(", ")}</li>`;
    sum += "</ul>";
    ChatMessage.create({ content: sum });
  }

  function reorderByStart(arr, startId) {
    const i = arr.findIndex(u => u.id === startId);
    return arr.slice(i).concat(arr.slice(0, i));
  }

  async function renderLobby() {
    const lobby = getLobbyUsers();
    const host = getHost();
    const html = await renderTemplate("modules/plank-and-plunder/templates/lobby.html", {
      users: lobby.map(u => u.name),
      host: host?.name,
      isHost: isHost()
    });
    new Dialog({
      title: "Plank and Plunder Lobby",
      content: html,
      buttons: {
        join: { label: "Lobby beitreten", callback: joinLobby },
        leave: { label: "Lobby verlassen", callback: leaveLobby },
        start: { label: "Spiel starten", callback: startGame }
      },
      default: "join"
    }).render(true);
  }

  renderLobby();
});
