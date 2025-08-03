/* ────────────────────────────────────────────────
   Plank and Plunder – Spiel­logik  (v1.1 Regeln)
   ──────────────────────────────────────────────── */

Hooks.once("ready", () => {
  const MODULE = "plank-and-plunder";
  const user   = game.user;

  /* ------------- Lobby-Hilfen ------------- */
  async function joinLobby()  { await user.setFlag(MODULE,"joined",true);  renderLobby();}
  async function leaveLobby() { await user.unsetFlag(MODULE,"joined");      renderLobby();}
  const lobbyUsers   = () => game.users.players.filter(u=>u.getFlag(MODULE,"joined"));
  const host         = () => lobbyUsers().find(u=>u.isGM) || lobbyUsers()[0];
  const isHost       = () => host()?.id===user.id;

  /* ------------- Spielspezifisch ------------- */
  const RANKS = [                              // 1 = beste
    {name:"Fünfling",   test: r=>freq(r).includes(5),                rank:1},
    {name:"Große Straße",test: r=>isStraight(r,5),                   rank:2},
    {name:"Vierling",    test: r=>freq(r).includes(4),               rank:3},
    {name:"Full House",  test: r=>freq(r).includes(3)&&freq(r).includes(2),rank:4},
    {name:"Kleine Straße",test:r=>isStraight(r,4),                  rank:5},
    {name:"Drilling",    test: r=>freq(r).includes(3),               rank:6},
    {name:"Zwei Paare",  test: r=>freq(r).filter(n=>n===2).length===2,rank:7},
    {name:"Ein Paar",    test: r=>freq(r).includes(2),               rank:8},
    {name:"Höchste Zahl",test: r=>true,                              rank:9}
  ];
  const freq = arr => [1,2,3,4,5,6].map(v=>arr.filter(x=>x===v).length);
  const isStraight=(arr,len)=>{
    const uniq=[...new Set(arr)].sort(); if(uniq.length<len) return false;
    return uniq.some((v,i)=>uniq.slice(i,i+len).every((n,j)=>n===v+j));
  };
  const rankOf = arr => RANKS.find(r=>r.test(arr)).rank;

  /* ------------- Spielstart ------------- */
  async function startGame(){
    const players=lobbyUsers(); if(players.length<2||players.length>4){ui.notifications.warn("2–4 Spieler nötig");return;}

    // Startspieler
    const starters=[]; for(const p of players){
      const r=await new Roll("1d6").roll({async:true});
      await r.toMessage({flavor:`${p.name} würfelt Startspieler`,speaker:{alias:p.name}});
      starters.push({p,val:r.total}); await delay(300);
    }
    starters.sort((a,b)=>b.val-a.val);
    const order=[...players.slice(players.indexOf(starters[0].p)),...players.slice(0,players.indexOf(starters[0].p))];
    ChatMessage.create({content:`<strong>Startspieler:</strong> ${order[0].name}`});

    // Geheime Erstwürfe
    let hands={}; for(const p of order){
      const r=await new Roll("5d6").roll({async:true});
      hands[p.id]=r.terms[0].results.map(x=>x.result);
      await r.toMessage({flavor:"Deine verdeckten 5 W6",whisper:[p.id],speaker:{alias:p.name}});
    }

    // Aktionsphase
    for(const p of order){ await actionDialog(p,hands,order);}
    // Aufdecken
    let summary=`<h2>Aufdecken & Wertung</h2><table>`;
    const results=order.map(pl=>{
      return {p:pl, hand:hands[pl.id], rank:rankOf(hands[pl.id])};
    });
    results.forEach(r=>{
      summary+=`<tr><td>${r.p.name}</td><td>${r.hand.join(" ")}</td><td>Rang ${r.rank}</td></tr>`;
    });
    summary+="</table>";
    const best=Math.min(...results.map(r=>r.rank));
    const winner=results.filter(r=>r.rank===best);
    summary+=winner.length>1?`<p><strong>Unentschieden!</strong></p>`:`<p><strong>Sieger:</strong> ${winner[0].p.name}</p>`;
    ChatMessage.create({content:summary});
  }

  /* ── Aktions-Dialog je Spieler ── */
  async function actionDialog(player,hands,order){
    return new Promise(resolve=>{
      const myHand=[...hands[player.id]];     // Kopie
      const others=order.filter(o=>o.id!==player.id);
      const tmpl=`
        <p>Deine Würfel: ${myHand.join(" ")}</p>
        <hr>
        <button data-act="reroll">Reroll (max 2)</button>
        <button data-act="plunder">Plündern</button>`;
      new Dialog({
        title:`Aktion – ${player.name}`,
        content:tmpl,
        buttons:{cancel:{label:"Weiter",callback:()=>resolve()}},
        default:"cancel",
        render:html=>{
          html[0].querySelector("[data-act='reroll']").addEventListener("click",async()=>{
            const idx=await chooseDice(player,myHand,2,"Wähle bis zu 2 Würfel zum Neuwurf");
            if(idx.length){
              const r=await new Roll(`${idx.length}d6`).roll({async:true});
              idx.forEach((i,n)=>myHand[i]=r.terms[0].results[n].result);
              ChatMessage.create({content:`${player.name} hat neu gewürfelt (${idx.length}).`,whisper:[player.id]});
            }
            hands[player.id]=myHand; resolve();
          });
          html[0].querySelector("[data-act='plunder']").addEventListener("click",async()=>{
            if(!others.length){ui.notifications.warn("Niemand zum Plündern.");return;}
            const target=await chooseTarget(player,others);
            if(!target){return;}
            const number=await chooseNumber(player);
            if(!number)return;
            const tgtHand=hands[target.id];
            const idx=tgtHand.findIndex(v=>v===number);
            if(idx===-1){ChatMessage.create({content:`Plündern fehlgeschlagen: ${target.name} hat keine ${number}.`});resolve();return;}
            // fairer Tausch
            const stolen=tgtHand.splice(idx,1)[0];
            const giveIdx=Math.floor(Math.random()*myHand.length);
            const given=myHand.splice(giveIdx,1)[0];
            tgtHand.push(given); myHand.push(stolen);
            hands[player.id]=myHand; hands[target.id]=tgtHand;
            ChatMessage.create({content:`${player.name} tauscht eine ${stolen} gegen eine ${given} mit ${target.name}.`});
            resolve();
          });
        }
      }).render(true);
    });
  }

  /* ------------- kleine Hilfsdialogs ------------- */
  function chooseDice(player,hand,max,msg){
    return new Promise(res=>{
      const boxes=hand.map((v,i)=>`<label><input type='checkbox' value='${i}'>${v}</label>`).join(" ");
      new Dialog({
        title:"Reroll auswählen",
        content:`<p>${msg}</p>${boxes}`,
        buttons:{
          ok:{label:"Neu würfeln",callback:html=>{
            const ids=[...html.find("input:checked")].map(b=>Number(b.value));
            if(ids.length>max){ui.notifications.warn(`Max ${max}.`);res([]);}else res(ids);
          }},
          cancel:{label:"Abbruch",callback:()=>res([])}
        }
      }).render(true);
    });
  }
  function chooseTarget(player,others){
    return new Promise(res=>{
      const opts=others.map(o=>`<option value='${o.id}'>${o.name}</option>`).join("");
      new Dialog({
        title:"Plündern – Ziel wählen",
        content:`<p>Wähle Zielspieler:</p><select id='tgt'>${opts}</select>`,
        buttons:{
          ok:{label:"Weiter",callback:html=>{
            const id=html.find("#tgt").val(); res(game.users.get(id));
          }},
          cancel:{label:"Abbruch",callback:()=>res(null)}
        }
      }).render(true);
    });
  }
  function chooseNumber(player){
    return new Promise(res=>{
      const opts=[1,2,3,4,5,6].map(n=>`<option>${n}</option>`).join("");
      new Dialog({
        title:"Plündern – Zahl wählen",
        content:`<p>Welche Zahl plündern?</p><select id='num'>${opts}</select>`,
        buttons:{
          ok:{label:"Plündern",callback:html=>res(Number(html.find(\"#num\").val()))},
          cancel:{label:"Abbruch",callback:()=>res(null)}
        }
      }).render(true);
    });
  }

  const delay=ms=>new Promise(r=>setTimeout(r,ms));

  /* ------------- Lobbydialog ------------- */
  async function renderLobby(){
    const lobby=lobbyUsers(), h=host();
    const html=await renderTemplate(\"modules/plank-and-plunder/templates/lobby.html\",{
      users:lobby.map(u=>u.name), host:h?.name, isHost:isHost()
    });
    new Dialog({
      title:\"Plank and Plunder Lobby\",
      content:html,
      buttons:{
        join:{label:\"Lobby beitreten\",callback:joinLobby},
        leave:{label:\"Lobby verlassen\",callback:leaveLobby},
        start:{label:\"Spiel starten\",callback:()=>{ if(isHost()) startGame(); else ui.notifications.warn(\"Nur Host.\");}}
      },
      default:\"join\"
    }).render(true);
  }

  /* ---- Erstaufruf ---- */
  renderLobby();
});
