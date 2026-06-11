"use strict";
/* ════════════════════════════════════════════════════════════════════
   net.js — login and all socket traffic.
   Continuous positions arrive in compact "tick" snapshots:
     p: [id, x, y, h, yaw][]   m: [id, x, y][]   j: [id, x, y][]
   Remote entities ease toward snapshot targets; our own entry feeds
   the prediction-reconciliation in render.js.
   ════════════════════════════════════════════════════════════════════ */

async function doLogin(){
  const name=$("nameInput").value.trim();
  if(name.length<2){$("loginError").textContent="Name must be at least 2 characters.";return;}
  if(!webglOK){$("loginError").textContent="WebGL unavailable — cannot start the 3D client.";return;}
  $("loginBtn").disabled=true; $("loginError").textContent=""; Sound.unlock();
  try{
    const res=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});
    const data=await res.json();
    if(!res.ok){$("loginError").textContent=data.error;$("loginBtn").disabled=false;return;}
    const sr=await fetch("/api/shop"); shopItems=(await sr.json()).items;
    localStorage.setItem("playerId",data.player.id);
    startGame(data.player);
  }catch(e){$("loginError").textContent="Could not connect.";$("loginBtn").disabled=false;}
}
$("loginBtn").addEventListener("click",doLogin);
$("nameInput").addEventListener("keydown",e=>{if(e.key==="Enter")doLogin();});

function resetPrediction(x,y){
  predX=x; predY=y; predH=0; predVH=0; serverX=x; serverY=y;
}

function startGame(player){
  $("loginScreen").style.display="none"; $("gameScreen").style.display="flex";
  selfPlayer=player; selfCoins=player.coins||0; selfHp=player.hp||10;
  updateCoinDisplay(); socket=io();
  socket.on("connect",()=>socket.emit("join",{playerId:player.id}));
  socket.on("connect_error",()=>addSystemMsg("⚠ Connection problem — retrying…"));
  socket.on("disconnect",()=>addSystemMsg("⚠ Disconnected from server."));

  socket.on("init",({mapId,map,mapCols:mc,mapRows:mr,self,players,monsters:ms,coins:cs,floorItems:fi,inventory,equipped,activeBuffs})=>{
    loadMap(mapId,map,mc,mr);
    selfPlayer=self; selfCoins=self.coins||0; selfHp=self.hp||10;
    selfUpgrades=self.upgrades||[]; selfStats=self.stats||selfStats; selfMaxHp=selfStats.maxHp;
    selfInventory=inventory||[]; selfEquipped=equipped||{}; selfActiveBuffs=activeBuffs||[];
    resetPrediction(self.x,self.y);
    allPlayers={}; players.forEach(p=>{initED(p);allPlayers[p.id]=p;});
    const me={...selfPlayer,hp:selfHp,maxHp:selfMaxHp}; initED(me); allPlayers[selfPlayer.id]=me;
    monsters={}; ms.forEach(m=>{initED(m);monsters[m.id]=m;});
    floorCoins={}; cs.forEach(c=>floorCoins[c.id]=c);
    floorItems={}; (fi||[]).forEach(i=>floorItems[i.uid]=i);
    clearAllEnts();
    updateHpBar(selfHp,selfMaxHp); updateCoinDisplay();
    resizeCanvas(); updatePlayerList();
    addSystemMsg(`Welcome to ${mapId==="overworld"?"the Overworld 🌿":mapId==="dungeon"?"the Dungeon 🕯":"the City 🏙"}!`);
    Sound.join();
  });

  socket.on("mapChange",({mapId,map,mapCols:mc,mapRows:mr,x,y,hp,maxHp,players,monsters:ms,coins:cs,floorItems:fi})=>{
    Sound.door();
    triggerZoneFlash(()=>{
      loadMap(mapId,map,mc,mr);
      selfPlayer.x=x; selfPlayer.y=y; selfHp=hp; selfMaxHp=maxHp;
      resetPrediction(x,y);
      allPlayers={}; players.forEach(p=>{initED(p);allPlayers[p.id]=p;});
      const me={...selfPlayer,hp:selfHp,maxHp:selfMaxHp}; initED(me); allPlayers[selfPlayer.id]=me;
      monsters={}; ms.forEach(m=>{initED(m);monsters[m.id]=m;});
      floorCoins={}; cs.forEach(c=>floorCoins[c.id]=c);
      floorItems={}; (fi||[]).forEach(i=>floorItems[i.uid]=i);
      projectiles={};
      clearAllEnts();
      updateHpBar(selfHp,selfMaxHp); resizeCanvas(); updatePlayerList();
      if(isDead){isDead=false;hideDeathScreen();Sound.respawn();addSystemMsg("Respawned!");}
      const msgs={overworld:"🌿 Overworld",dungeon:"⚠ Dungeon — tougher monsters!",city:"🏙 Welcome to the City — safe zone!"};
      addSystemMsg(msgs[mapId]||mapId);
    });
  });

  /* Compact authoritative snapshot (15Hz). */
  socket.on("tick",({p:pl,m:ms,j:pj})=>{
    if(!selfPlayer) return;
    if(Array.isArray(pl)) for(const [id,x,y,h] of pl){
      if(id===selfPlayer.id){serverX=x;serverY=y;continue;}
      const p=allPlayers[id]; if(p)setET(p,x,y,h);
    }
    if(Array.isArray(ms)) for(const [id,x,y] of ms){const m=monsters[id];if(m)setET(m,x,y);}
    if(Array.isArray(pj)) for(const [id,x,y] of pj){const pr=projectiles[id];if(pr){pr.x=x;pr.y=y;}}
  });

  socket.on("playerJoined",p=>{initED(p);allPlayers[p.id]=p;addSystemMsg(`${p.name} joined.`);updatePlayerList();Sound.join();});
  socket.on("playerLeft",({id})=>{if(allPlayers[id])addSystemMsg(`${allPlayers[id].name} left.`);delete allPlayers[id];updatePlayerList();});
  socket.on("playerHit",({id,hp,maxHp,blocked})=>{
    const p=allPlayers[id]; if(p){p.hp=hp;p.maxHp=maxHp;if(!blocked&&hp<(p.lastHp??hp+1))burst(p.dx_??p.x,p.dy_??p.y,"#fb7185",8,2.5);p.lastHp=hp;}
    if(id===selfPlayer.id){const wasHurt=hp<selfHp;selfHp=hp;selfMaxHp=maxHp||selfMaxHp;updateHpBar(selfHp,selfMaxHp);if(blocked){showFloatNum(predX,predY,"🛡 blocked","#60a5fa");Sound.blocked();}else if(wasHurt){triggerDamageFlash();shake.mag=7;showFloatNum(predX,predY,"-❤","#fb7185");Sound.hurt();}}
  });
  socket.on("playerDied",({id})=>{const p=allPlayers[id];if(p){p.dead=true;burst(p.dx_??p.x,p.dy_??p.y,"#94a3b8",16,3.5);}if(id===selfPlayer.id){isDead=true;selfHp=0;updateHpBar(0,selfMaxHp);showDeathScreen();Sound.die();}});
  socket.on("playerRespawned",({id,x,y,hp,maxHp})=>{const p=allPlayers[id];if(p){setET(p,x,y);p.dx_=x;p.dy_=y;p.hp=hp;p.dead=false;}if(id===selfPlayer.id){resetPrediction(x,y);selfHp=hp;selfMaxHp=maxHp||selfMaxHp;isDead=false;updateHpBar(selfHp,selfMaxHp);hideDeathScreen();Sound.respawn();}updatePlayerList();});
  socket.on("playerStatUpdate",({id,hp,maxHp,coins})=>{const p=allPlayers[id];if(p){p.hp=hp;p.maxHp=maxHp;p.coins=coins;}if(id===selfPlayer.id){selfHp=hp;selfMaxHp=maxHp;selfCoins=coins;updateHpBar(selfHp,selfMaxHp);updateCoinDisplay();}updatePlayerList();});

  socket.on("monsterSpawned",m=>{initED(m);monsters[m.id]=m;});
  socket.on("monsterHit",({id,hp,maxHp})=>{const m=monsters[id];if(m){m.hp=hp;m.maxHp=maxHp;m.flash=0.18;burst(m.dx_??m.x,m.dy_??m.y,"#fcd34d",6,2);Sound.hitMonster();}});
  socket.on("monsterDied",({id})=>{const m=monsters[id];if(m){burst(m.dx_??m.x,m.dy_??m.y,"#a78bfa",14,3);showFloatNum(m.dx_??m.x,m.dy_??m.y,"💀","#cbd5e1");Sound.monsterDie();}delete monsters[id];});

  socket.on("coinDropped",c=>{floorCoins[c.id]=c;});
  socket.on("coinCollected",({coinId,playerId,total})=>{const c=floorCoins[coinId];if(c)sparkle(c.x+0.5,c.y+0.5,"#fcd34d");delete floorCoins[coinId];if(playerId===selfPlayer.id){selfCoins=total;updateCoinDisplay();updatePlayerList();showFloatNum(predX,predY,"+1🪙","#fcd34d");Sound.coin();}});
  socket.on("coinUpdate",({coins})=>{selfCoins=coins;updateCoinDisplay();});

  socket.on("itemDropped",item=>{floorItems[item.uid]=item;});
  socket.on("floorItemGone",({uid})=>{delete floorItems[uid];});
  socket.on("inventoryUpdate",({inventory,equipped})=>{selfInventory=inventory;selfEquipped=equipped;if(invOpen)renderInv();if(charOpen)renderChar();});
  socket.on("statsUpdate",({stats,maxHp})=>{selfStats=stats;selfMaxHp=maxHp;updateHpBar(selfHp,selfMaxHp);});
  socket.on("buffsUpdate",({buffs,stats})=>{selfActiveBuffs=buffs;selfStats=stats;if(charOpen)renderChar();});
  socket.on("notification",({msg,color})=>showNotif(msg,color));

  socket.on("projSpawned",p=>{projectiles[p.id]={...p,dx_:p.x,dy_:p.y};if(p.ownerId===selfPlayer.id)Sound.shoot();});
  socket.on("projDestroyed",({id})=>{delete projectiles[id];});

  socket.on("shopPurchased",({itemId,coins,upgrades,stats,hp})=>{selfCoins=coins;selfUpgrades=upgrades;selfStats=stats;selfHp=hp;selfMaxHp=stats.maxHp;updateCoinDisplay();updateHpBar(selfHp,selfMaxHp);renderShop();const item=shopItems.find(i=>i.id===itemId);if(item){showFloatNum(predX,predY,`${item.emoji} bought!`,"#34d399");addSystemMsg(`Purchased: ${item.name}!`);}$("shopError").textContent="";Sound.buy();});
  socket.on("shopError",msg=>{$("shopError").textContent=msg;Sound.error();});
  socket.on("chat",({name,color,message})=>addChatMsg(name,color,message));

  socket.on("openTradePost",({listings})=>{openTradePost(listings);});
  socket.on("noticeBoardData",({leaderboard})=>{openNoticeBoard(leaderboard);});
  socket.on("tradeListingAdded",l=>{if(tradeOpen)refreshTradeListings([l]);});
  socket.on("tradeListingRemoved",({id})=>{if(tradeOpen){const el=document.querySelector(`[data-lid="${id}"]`);if(el)el.remove();}});

  startInputLoop(); // begin streaming input state to the server
}
