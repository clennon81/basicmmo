"use strict";
/* ══════════════════ DEATH / DAMAGE ══════════════════ */
function showDeathScreen(){$("deathOverlay").classList.add("show");let s=3;$("respawnTimer").textContent=s;if(respawnInterval)clearInterval(respawnInterval);respawnInterval=setInterval(()=>{s--;$("respawnTimer").textContent=Math.max(0,s);if(s<=0){clearInterval(respawnInterval);respawnInterval=null;}},1000);}
function hideDeathScreen(){$("deathOverlay").classList.remove("show");if(respawnInterval){clearInterval(respawnInterval);respawnInterval=null;}}
let flashTimeout=null;
function triggerDamageFlash(){$("damageFlash").classList.add("flash");if(flashTimeout)clearTimeout(flashTimeout);flashTimeout=setTimeout(()=>$("damageFlash").classList.remove("flash"),220);}
function triggerZoneFlash(cb){$("zoneFlash").classList.add("flash");setTimeout(()=>{cb();$("zoneFlash").classList.remove("flash");},300);}

/* ══════════════════ NOTIFICATIONS ══════════════════ */
function showNotif(msg,color="#e6edf7"){
  const el=document.createElement("div");el.className="notif";el.textContent=msg;el.style.color=color;el.style.borderColor=(color==="var(--gold)"||color==="#fcd34d")?"rgba(252,211,77,0.4)":"var(--border)";
  $("notifArea").appendChild(el);setTimeout(()=>{el.style.opacity="0";el.style.transition="opacity .4s";setTimeout(()=>el.remove(),400);},2200);
}

/* ══════════════════ SHOP ══════════════════ */
const SHOP_GROUPS=[{label:"⚡ Speed",ids:["speed1","speed2"]},{label:"🔥 Firepower",ids:["rapidfire","rapidfire2"]},{label:"❤️ Health",ids:["maxhp1","maxhp2"]},{label:"🛡 Defence",ids:["armour","regen"]}];
function openShop(){shopOpen=true;$("shopError").textContent="";$("shopCoins").textContent=selfCoins;renderShop();$("shopOverlay").classList.add("show");}
function closeShop(){shopOpen=false;$("shopOverlay").classList.remove("show");}
$("shopClose").addEventListener("click",closeShop);
$("btnShop").addEventListener("click",()=>{if(!isDead)shopOpen?closeShop():openShop();});
$("coinDisplay").addEventListener("click",()=>{if(!isDead)shopOpen?closeShop():openShop();});
function renderShop(){
  $("shopCoins").textContent=selfCoins;
  let html="";
  SHOP_GROUPS.forEach(g=>{
    html+=`<div class="shopSection"><h3>${g.label}</h3><div class="shopGrid">`;
    g.ids.forEach(id=>{const item=shopItems.find(i=>i.id===id);if(!item)return;const owned=selfUpgrades.includes(id),locked=item.requires&&!selfUpgrades.includes(item.requires)&&!owned;html+=`<div class="shopItem${owned?" owned":""}${locked?" locked":""}" data-id="${id}"><div class="itemTop"><span class="emoji">${item.emoji}</span><span class="itemName">${item.name}</span></div><div class="itemDesc">${item.desc}</div><div class="itemStat">${item.stat}</div><div class="itemCost">🪙 ${item.cost}</div><div class="ownedBadge">✓ Owned</div></div>`;});
    html+="</div></div>";
  });
  $("shopItems").innerHTML=html;
  $("shopItems").querySelectorAll(".shopItem:not(.owned):not(.locked)").forEach(el=>el.addEventListener("click",()=>{if(socket)socket.emit("buyUpgrade",{itemId:el.dataset.id});}));
}

/* ══════════════════ INVENTORY ══════════════════ */
function openInv(){invOpen=true;selectedInvUid=null;renderInv();$("invOverlay").classList.add("show");}
function closeInv(){invOpen=false;selectedInvUid=null;$("invOverlay").classList.remove("show");}
$("invClose").addEventListener("click",closeInv);
$("btnInv").addEventListener("click",()=>invOpen?closeInv():openInv());

function renderInv(){
  $("invCapacity").textContent=`${selfInventory.length} / 24`;
  const grid=$("invGrid");
  if(selfInventory.length===0){grid.innerHTML=`<div class="invEmpty" style="grid-column:span 6">Your inventory is empty.<br>Kill monsters to get drops!</div>`;} 
  else {
    grid.innerHTML=selfInventory.map((item,i)=>`<div class="invSlot${item.uid===selectedInvUid?" selected":""}" data-uid="${item.uid}"><span class="slotEmoji">${item.emoji}</span><span class="slotName">${item.name}</span><div class="rarityDot ${`rarity-${item.rarity||"common"}`}"></div></div>`).join("");
    grid.querySelectorAll(".invSlot").forEach(el=>el.addEventListener("click",()=>{selectedInvUid=el.dataset.uid;renderInv();}));
  }
  // detail & buttons
  const item=selfInventory.find(i=>i.uid===selectedInvUid);
  if(item){
    $("invDetail").innerHTML=`<strong>${item.emoji} ${item.name}</strong> <span style="color:${RARITY_COLORS[item.rarity||"common"]};font-size:0.75rem">${item.rarity||"common"}</span><br><span style="color:var(--muted)">${item.desc||""}</span>${item.sellValue?`<br><span style="color:var(--gold)">Sell value: ${item.sellValue}🪙</span>`:""}`;
    const canEquip=item.type==="weapon"||item.type==="armor";
    const canUse=item.type==="food"||item.type==="buff";
    const canSell=!!item.sellValue&&currentMapId==="city";
    $("btnEquip").disabled=!canEquip; $("btnUse").disabled=!canUse; $("btnDrop").disabled=false;
    $("btnSell").disabled=!canSell; $("btnPickTrade").disabled=false;
  } else {
    $("invDetail").textContent="Select an item to see details.";
    ["btnEquip","btnUse","btnDrop","btnSell","btnPickTrade"].forEach(id=>$(id).disabled=true);
  }
}
$("btnEquip").addEventListener("click",()=>{if(selectedInvUid&&socket)socket.emit("equipItem",{uid:selectedInvUid});});
$("btnUse").addEventListener("click",()=>{if(selectedInvUid&&socket){socket.emit("useItem",{uid:selectedInvUid});}});
$("btnDrop").addEventListener("click",()=>{if(selectedInvUid&&socket){socket.emit("dropItem",{uid:selectedInvUid});selectedInvUid=null;}});
$("btnSell").addEventListener("click",()=>{if(selectedInvUid&&socket)socket.emit("sellItem",{uid:selectedInvUid});});
$("btnPickTrade").addEventListener("click",()=>{
  if(!selectedInvUid)return;
  if(tradePickedUids.has(selectedInvUid))tradePickedUids.delete(selectedInvUid);
  else if(tradePickedUids.size<4)tradePickedUids.add(selectedInvUid);
  if(tradeOpen)renderTradePicker();
  showNotif(tradePickedUids.has(selectedInvUid)?"Added to trade offer":"Removed from trade offer","#60a5fa");
});

/* ══════════════════ CHARACTER SCREEN ══════════════════ */
function openChar(){charOpen=true;renderChar();$("charOverlay").classList.add("show");}
function closeChar(){charOpen=false;$("charOverlay").classList.remove("show");}
$("charClose").addEventListener("click",closeChar);
$("btnChar").addEventListener("click",()=>charOpen?closeChar():openChar());

function renderChar(){
  // Equipped slots
  const slots=["weapon","armor"];
  $("equippedSlots").innerHTML=slots.map(slot=>{
    const item=selfEquipped[slot];
    return `<div class="equippedSlot">
      <div class="slotLabel">${slot==="weapon"?"⚔️ Weapon":"🛡 Armor"}</div>
      ${item?`<div class="equippedItem"><span class="bigEmoji">${item.emoji}</span><div class="itemInfo"><div class="name">${item.name}</div><div class="desc">${item.desc}</div></div></div>
      <button class="invActBtn" style="font-size:0.72rem;padding:4px 10px" onclick="if(socket)socket.emit('unequipItem',{slot:'${slot}'})">Unequip</button>`
      :`<div class="emptySlot">Nothing equipped</div>`}
    </div>`;
  }).join("");
  // Stats
  const stats=selfStats;
  const statRows=[
    ["Max HP", selfMaxHp],
    ["Move delay", `${stats.moveDelay||150}ms`],
    ["Fire delay", stats.fireDelay>0?`${stats.fireDelay}ms`:"None"],
    ["Proj. damage", stats.projDamage||1],
    ["Proj. range", stats.projRange||10],
    ["Block chance", `${Math.round((stats.blockChance||0)*100)}%`],
    ["Regen", stats.regen?"✓ Active":"—"],
  ];
  $("statsList").innerHTML=statRows.map(([l,v])=>`<div class="statRow"><span class="statLabel">${l}</span><span class="statVal">${v}</span></div>`).join("");
  // Buffs
  const now=Date.now();
  if(selfActiveBuffs.length===0){$("buffsList").innerHTML=`<div style="font-size:0.78rem;color:var(--muted);font-style:italic;">No active buffs.</div>`;}
  else{$("buffsList").innerHTML=selfActiveBuffs.map(b=>`<div class="buffItem"><span style="font-size:1.2rem">${b.emoji}</span><span>${b.name}</span><span class="buffTime">${Math.max(0,Math.ceil((b.expiresAt-now)/1000))}s</span></div>`).join("");}
}

/* ══════════════════ TRADE POST ══════════════════ */
function openTradePost(listings){
  currentListings=listings||[];tradeOpen=true;
  renderTradeListings(currentListings);renderTradePicker();
  $("tradeOverlay").classList.add("show");
}
function closeTradePost(){tradeOpen=false;$("tradeOverlay").classList.remove("show");}
$("tradeClose").addEventListener("click",closeTradePost);

function renderTradeListings(listings){
  const el=$("tradeListings");
  if(!listings||listings.length===0){el.innerHTML=`<div class="noListings">No active listings. Be the first to post!</div>`;return;}
  el.innerHTML=listings.map(l=>{
    const isMine=l.seller_id===selfPlayer.id;
    const itemTags=(l.offer_items||[]).map(i=>`<span class="tradeTag">${i.emoji} ${i.name}</span>`).join("");
    const offerCoinsTag=l.offer_coins>0?`<span class="tradeTag">🪙 ${l.offer_coins}</span>`:"";
    return `<div class="tradeListing" data-lid="${l.id}">
      <span class="seller" style="color:${l.seller_color||"#e6edf7"}">${escHtml(l.seller_name)}</span>
      <div class="tradeItems">${itemTags}${offerCoinsTag}<span style="color:var(--muted);font-size:0.72rem">offers →</span></div>
      <span class="tradeCoins">wants ${l.want_coins||0}🪙</span>
      ${isMine?`<button class="tradeCancel" onclick="if(socket)socket.emit('cancelTrade',{listingId:'${l.id}'})">Cancel</button>`
              :`<button class="tradeAccept" onclick="if(socket)socket.emit('acceptTrade',{listingId:'${l.id}'})">Accept</button>`}
    </div>`;
  }).join("");
}
function refreshTradeListings(newOnes){newOnes.forEach(l=>currentListings.push(l));renderTradeListings(currentListings);}

function renderTradePicker(){
  const el=$("tradeInvPick");
  if(selfInventory.length===0){el.innerHTML=`<div style="font-size:0.72rem;color:var(--muted);grid-column:span 6">Inventory empty</div>`;return;}
  el.innerHTML=selfInventory.map(item=>`<div class="pickSlot${tradePickedUids.has(item.uid)?" picked":""}" data-uid="${item.uid}"><span class="pEmoji">${item.emoji}</span><span class="pName">${item.name}</span></div>`).join("");
  el.querySelectorAll(".pickSlot").forEach(s=>s.addEventListener("click",()=>{
    const uid=s.dataset.uid;
    if(tradePickedUids.has(uid))tradePickedUids.delete(uid);
    else if(tradePickedUids.size<4)tradePickedUids.add(uid);
    renderTradePicker();
  }));
}
$("btnPostTrade").addEventListener("click",()=>{
  if(!socket)return;
  if(currentMapId!=="city"){showNotif("You must be in the city to trade!","#fb7185");return;}
  const offerCoins=parseInt($("tradeOfferCoins").value)||0;
  const wantCoins=parseInt($("tradeWantCoins").value)||0;
  socket.emit("postTrade",{offerItemUids:[...tradePickedUids],offerCoins,wantCoins});
  tradePickedUids.clear();
  setTimeout(()=>socket.emit("refreshTrades"),300);
});

/* ══════════════════ NOTICE BOARD ══════════════════ */
function openNoticeBoard(leaderboard){
  const ranks=["🥇","🥈","🥉","4️⃣","5️⃣"];
  $("boardList").innerHTML=leaderboard.map((r,i)=>`<div class="lbRow"><span class="lbRank">${ranks[i]||i+1}</span><span class="lbName" style="color:${r.color||"#e6edf7"}">${escHtml(r.name)}</span><span class="lbCoins">🪙 ${r.coins}</span></div>`).join("");
  boardOpen=true; $("boardOverlay").classList.add("show");
}
$("boardClose").addEventListener("click",()=>{boardOpen=false;$("boardOverlay").classList.remove("show");});

/* ══════════════════ UI HELPERS ══════════════════ */
function updateHpBar(hp,mhp){const p=Math.max(0,(hp/mhp)*100);$("hpBarInner").style.width=p+"%";$("hpBarInner").style.background=p>50?"linear-gradient(180deg,#4ade80,#22c55e)":p>25?"linear-gradient(180deg,#fbbf24,#f59e0b)":"linear-gradient(180deg,#fb7185,#e11d48)";$("hpText").textContent=`${hp}/${mhp}`;}
function updateCoinDisplay(){$("coinDisplay").textContent=`🪙 ${selfCoins}`;if(shopOpen)$("shopCoins").textContent=selfCoins;}
function updatePlayerList(){
  const players=Object.values(allPlayers);
  $("onlineCount").textContent=`${players.length} online`;
  let html="<h3>Online Players</h3>";
  players.forEach(p=>{const isSelf=p.id===selfPlayer.id;const hp=isSelf?selfHp:(p.hp??selfMaxHp);const coins=isSelf?selfCoins:(p.coins||0);html+=`<div class="playerEntry"><div class="playerDot" style="background:${p.color}"></div><span class="playerName">${escHtml(p.name)}${isSelf?" ★":""}</span><span class="playerStats">❤${hp} 🪙${coins}</span></div>`;});
  $("playerList").innerHTML=html;
}
function addChatMsg(name,color,message){const el=document.createElement("div");el.className="chatMsg";el.innerHTML=`<span class="sender" style="color:${color}">${escHtml(name)}:</span> ${escHtml(message)}`;$("chatMessages").appendChild(el);$("chatMessages").scrollTop=$("chatMessages").scrollHeight;}
function addSystemMsg(msg){const el=document.createElement("div");el.className="chatMsg system";el.textContent=msg;$("chatMessages").appendChild(el);$("chatMessages").scrollTop=$("chatMessages").scrollHeight;}
function sendChat(){const msg=$("chatInput").value.trim();if(msg&&socket){socket.emit("chat",{message:msg});$("chatInput").value="";}}
$("chatSend").addEventListener("click",sendChat);
$("chatInput").addEventListener("keydown",e=>{if(e.key==="Enter")sendChat();});
function escHtml(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}