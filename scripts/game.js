/* ------------------------------------------------------------------
   Plank & Plunder – umfangreiches Mini-Dice-Game           2025-08-03
   ------------------------------------------------------------------
   Features
   ▸ Lobby (2–4 Spieler)                       ▸ Socket-Synchronisation
   ▸ Startspieler-Wurf (1W6)                   ▸ Verdeckte 5W6 + 2 Rerolls
   ▸ Plündern-Phase (jeder mit ≥1 ⚓ 6)         ▸ Rundenwertung + Chat-Summary
   ▸ Mehrere Runden, Button „Neue Runde“
   ------------------------------------------------------------------ */

const MODULE_ID = "plank-and-plunder";
const SOCKET_NS = `module.${MODULE_ID}`;

/* ---------- Initialer gemeinsamer Zustand --------------------------- */
const defaultState = {
  phase      : "lobby",   // lobby | rolling | plunder | summary
  round      : 0,
  users      : [],        // [ userId … ]
  order      : [],        // Spielreihenfolge (userIds)
  dice       : {},        // { userId : [d1-d5] }
  rerolls    : {},        // { userId : 0-2 }
  sums       : {},        // { userId : sum }
  host       : null
};

let state = foundry.utils.duplicate(defaultState);

/* ==================================================================== */
/* 1 | Foundry-Bootstrap                                                */
/* ==================================================================== */
Hooks.once("ready", () => {

  /* API – Makro aufrufbar mit game.modules.get(...).api.open() */
  game.modules.get(MODULE_ID).api = { open: openLobby };

  /* Socket Empfang */
  game.socket.on(SOCKET_NS, data => {
    if (data.type === "sync") {
      state = data.state;
      rerenderAll();
      return;
    }
    if (data.type === "action" && game.user.isGM) handleHostAction(data.action, data.payload);
  });
});

/* ==================================================================== */
/* 2 | State-Handling                                                   */
/* ==================================================================== */

function setState(patch, sync = true) {
  state = mergeObject(state, patch);
  if (sync) game.socket.emit(SOCKET_NS, { type: "sync", state });
  rerenderAll();
}
function rerenderAll() {
  ui.windows["plunder-lobby"]?.render(true);
  ui.windows["plunder-turn"] ?.render(true);
}

function lobbyUsers() { return state.users.map(id => game.users.get(id)).filter(Boolean); }
function ensureHost() { if (!state.host) setState({ host: lobbyUsers().find(u=>u.isGM)?.id ?? state.users[0] }, false); }
function isHost()     { return game.user.id === state.host; }

/* ==================================================================== */
/* 3 | Lobby-Fenster                                                    */
/* ==================================================================== */
class LobbyApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id       : "plunder-lobby",
    window   : { title: "Plank & Plunder", resizable: false },
    position : { width: 360 },
    actions  : { join: this.join, leave: this.leave, start: this.start }
  };

  /* -- Aktionen -- */
  static join()  {
    if (state.users.includes(game.user.id)) return;
    if (game.user.isGM) addUser(game.user.id);
    else emitAction("join", { id: game.user.id });
  }
  static leave() {
    if (game.user.isGM) removeUser(game.user.id);
    else emitAction("leave", { id: game.user.id });
  }
  static start() {
    if (!isHost()) return ui.notifications.warn("Nur Host kann starten.");
    handleHostAction("start");
  }

  /* -- Template-Daten -- */
  async _prepareContext() {
    const data  = await super._prepareContext();
    data.users  = lobbyUsers().map(u => u.name);
    data.host   = game.users.get(state.host ?? "")?.name ?? "-";
    data.joined = state.users.includes(game.user.id);
    data.myTurn = isHost();
    data.round  = state.round;
    return data;
  }
}

/* ==================================================================== */
/* 4 | Gameplay-Fenster (pro Spieler)                                   */
/* ==================================================================== */
class TurnApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id       : "plunder-turn",
    window   : { title: "Plank & Plunder – Dein Zug", resizable: false },
    position : { width: 340 },
    actions  : { reroll: this.reroll, keep: this.keep, plunder: this.plunder, skipPlunder: this.skipPlunder, next: this.next }
  };

  /* ---------------- Hilfsfunktionen ---------------- */
  static myDice()    { return state.dice[game.user.id] ?? []; }
  static myRerolls() { return state.rerolls[game.user.id] ?? 0; }

  /* ---------------- Buttons ------------------------ */

  /** Wähle Würfel durch Checkbox (class=keep); rerolle alle anderen */
  static async reroll(ev, html) {
    if (state.phase !== "rolling") return;
    if (!isMyTurn()) return;
    if (this.myRerolls() >= 2) return;

    const keepIdx = [...html.closest(".app").querySelectorAll("input.keep:checked")].map(cb => parseInt(cb.dataset.idx));
    const newDice = this.myDice().map((v,i)=> keepIdx.includes(i) ? v : randomDie());
    const rerolls = this.myRerolls()+1;
    const patch = {
      dice    : { ...state.dice,    [game.user.id]: newDice },
      rerolls : { ...state.rerolls, [game.user.id]: rerolls }
    };
    setState(patch);
  }

  /** Markiert/Entmarkiert Würfel */
  static keep(ev, html) {
    if (state.phase !== "rolling") return;
    const cb = html.closest("input.keep");
    cb.checked = !cb.checked;
  }

  /** Öffnet Plünder-Dialog */
  static plunder() {
    if (state.phase !== "plunder") return;
    if (!this.myDice().includes(6)) return;

    const targets = lobbyUsers().filter(u => u.id!==game.user.id).map(u=>({id:u.id,name:u.name}));
    const tplPath = `modules/${MODULE_ID}/templates/plunder-dialog.hbs`;
    renderTemplate(tplPath, { targets }).then(html => {
      new Dialog({
        title: "Plündern",
        content: html,
        buttons: {},
        default: null,
        close: dlg => {
          const form = dlg.querySelector("form");
          if (!form) return;
          const data = {
            sourceId   : game.user.id,
            targetId   : form.target.value,
            ownIndex   : parseInt(form.ownIndex.value)-1,
            targetIndex: parseInt(form.targetIndex.value)-1
          };
          emitAction("plunder", data);
        }
      },{submitOnClose:false}).render(true);
    });
  }
  static skipPlunder() { emitAction("plunderSkip"); }

  /** Host beendet Runde nach letztem Spieler */
  static next() { if (isHost()) handleHostAction("next"); }

  /* ---------------- Template ----------------------- */
  async _prepareContext() {
    const data = await super._prepareContext();

    data.phase    = state.phase;
    data.dice     = this.myDice();
    data.rerolls  = this.myRerolls();
    data.canReroll  = state.phase==="rolling" && isMyTurn() && data.rerolls<2;
    data.canPlunder = state.phase==="plunder" && this.myDice().includes(6);
    data.isHost   = isHost();
    data.round    = state.round;
    data.sum      = data.dice.reduce((a,b)=>a+b,0);
    return data;
  }
}

/* Helper */
function isMyTurn() { return state.order?.[0] === game.user.id; }
function randomDie() { return Math.floor(Math.random()*6)+1; }

/* ==================================================================== */
/* 5 | Host-Seitige Aktionen                                            */
/* ==================================================================== */

function handleHostAction(action, payload={}) {
  ensureHost();

  switch(action) {

    /* ---------- join/leave ------------------------------------------- */
    case "join":  addUser(payload.id); return;
    case "leave": removeUser(payload.id); return;

    /* ---------- start (neue Runde) ----------------------------------- */
    case "start": {
      if (lobbyUsers().length < 2 || lobbyUsers().length > 4)
        return ui.notifications.warn("Benötigt 2–4 Spieler.");
      startNewRound();
      return;
    }

    /* ---------- rerundenwechsel -------------------------------------- */
    case "next": {
      setState({ phase:"lobby" });
      ui.notifications.info("Runde beendet – Lobby aktiv.");
      return;
    }

    /* ---------- Plünder-Tausch --------------------------------------- */
    case "plunder": {
      const { sourceId,targetId,ownIndex,targetIndex } = payload;
      const src = state.dice[sourceId]; const tgt = state.dice[targetId];
      if (!src || !tgt) return;
      const tmp = src[ownIndex]; src[ownIndex] = tgt[targetIndex]; tgt[targetIndex] = tmp;
      setState({ dice: {...state.dice, [sourceId]:src, [targetId]:tgt} });
      return;
    }

    case "plunderSkip": {
      /* Nichts – Client hat geskippt */
      return;
    }
  }
}

/* ==================================================================== */
/* 6 | Runden-Ablauf                                                    */
/* ==================================================================== */

async function startNewRound() {
  /* Basics */
  const players = lobbyUsers();
  let order = [];

  /* 1) Startspielerwurf */
  for (const p of players) {
    const r = await (new Roll("1d6")).roll({async:true});
    await r.toMessage({flavor:`${p.name} wirft Startspieler`, speaker:{alias:p.name}});
    order.push({id:p.id, total:r.total});
  }
  order.sort((a,b)=>b.total-a.total);

  /* 2) Erste verdeckte 5 W6 */
  const dice = {};
  const rer  = {};
  for (const o of order) {
    const r = await (new Roll("5d6")).roll({async:true});
    await r.toMessage({flavor:"Deine verdeckten 5W6", whisper:[o.id], speaker:{alias:game.users.get(o.id).name}});
    dice[o.id] = r.terms[0].results.map(x=>x.result);
    rer [o.id] = 0;
  }

  setState({
    phase : "rolling",
    round : state.round+1,
    order : order.map(o=>o.id),
    dice,
    rerolls: rer,
    sums : {}
  });

  openTurnApps();
}

/* ---------------- Alle Spieler erhalten Turn-Fenster ---------------- */
function openTurnApps() {
  lobbyUsers().forEach(u => new TurnApp({userid:u.id}).render(true));
}

/* ---------------- Utility Socket ----------------------------------- */
function emitAction(action, payload={}) {
  game.socket.emit(SOCKET_NS,{type:"action", action, payload});
}

/* ==================================================================== */
/* 7 | User Management helpers                                          */
/* ==================================================================== */
function addUser(uid){ setState({users:Array.from(new Set([...state.users,uid]))}); }
function removeUser(uid){
  const users = state.users.filter(id=>id!==uid);
  setState({users});
  if (!users.includes(state.host)) setState({host:users[0]??null});
}

/* ==================================================================== */
/* 8 | Lobby öffnen                                                     */
/* ==================================================================== */
function openLobby() {
  if (!ui.windows["plunder-lobby"]) new LobbyApp().render(true);
}
