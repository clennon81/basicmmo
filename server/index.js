const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const initSqlJs = require("sql.js");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(express.json());
app.use(express.static(path.join(__dirname, "../client")));

// ── Tile types ────────────────────────────────────────────────────────────────
const T = {
  GRASS:0, WATER:1, TREE:2, SAND:3, MOUNTAIN:4, STONE:5, LAVA:6,
  DUNGEON_WALL:7, DUNGEON_FLOOR:8, DOOR_DOWN:9, DOOR_UP:10,
  COBBLE:11, BUILDING:12, DOOR_CITY:13, DOOR_OVERWORLD:14,
  FOUNTAIN:15, TRADE_POST:16, NOTICE_BOARD:17, ROAD:18,
};

// ── Shared physics ────────────────────────────────────────────────────────────
const PH = require("../client/js/physics.js");
const PC = PH.C;
const PASSABLE = PH.WALKABLE;

function logErr(where, e) {
  console.error(`[${new Date().toISOString()}] ERROR in ${where}:`, (e && e.stack) || e);
}

// ── Item definitions ──────────────────────────────────────────────────────────
const ITEM_DEFS = {
  bread:        { id:"bread",        type:"food",   name:"Bread",          emoji:"🍞", rarity:"common",   desc:"Restores 2 HP",           healAmt:2  },
  staleBread:   { id:"staleBread",   type:"food",   name:"Stale Bread",    emoji:"🥖", rarity:"common",   desc:"Restores 1 HP",           healAmt:1  },
  meat:         { id:"meat",         type:"food",   name:"Raw Meat",       emoji:"🥩", rarity:"uncommon", desc:"Restores 4 HP",           healAmt:4  },
  cheese:       { id:"cheese",       type:"food",   name:"Cheese",         emoji:"🧀", rarity:"common",   desc:"Restores 2 HP",           healAmt:2  },
  sword:        { id:"sword",        type:"weapon", name:"Sword Shot",     emoji:"⚔️",  rarity:"uncommon", desc:"Deals 2 damage",          damage:2, range:10 },
  magicOrb:     { id:"magicOrb",     type:"weapon", name:"Magic Orb",      emoji:"🔮", rarity:"rare",     desc:"Deals 3 damage, slow",    damage:3, range:8,  projSpeed:180 },
  longbow:      { id:"longbow",      type:"weapon", name:"Longbow",        emoji:"🏹", rarity:"uncommon", desc:"Deals 2 damage, long range",damage:2,range:16 },
  leatherVest:  { id:"leatherVest",  type:"armor",  name:"Leather Vest",   emoji:"🧥", rarity:"uncommon", desc:"20% damage reduction",    reduction:0.20 },
  chainArmor:   { id:"chainArmor",   type:"armor",  name:"Chain Armor",    emoji:"⛓",  rarity:"rare",     desc:"40% damage reduction",    reduction:0.40 },
  towerShield:  { id:"towerShield",  type:"armor",  name:"Tower Shield",   emoji:"🛡",  rarity:"rare",     desc:"60% reduction, -20% speed",reduction:0.60, speedPenalty:0.8 },
  slimeGel:     { id:"slimeGel",     type:"buff",   name:"Slime Gel",      emoji:"💚", rarity:"common",   desc:"Regen 1HP/8s for 60s",    buffType:"regen",  duration:60000 },
  energyDrink:  { id:"energyDrink",  type:"buff",   name:"Energy Drink",   emoji:"⚡", rarity:"uncommon", desc:"Speed boost for 30s",     buffType:"speed",  duration:30000, moveDelay:70 },
  boneCharm:    { id:"boneCharm",    type:"buff",   name:"Bone Charm",     emoji:"🦴", rarity:"uncommon", desc:"Block 30% damage for 45s", buffType:"armor",  duration:45000, blockChance:0.30 },
  venomVial:    { id:"venomVial",    type:"buff",   name:"Venom Vial",     emoji:"🧪", rarity:"rare",     desc:"Weapon deals +1 dmg for 30s",buffType:"damage",duration:30000, dmgBonus:1 },
  fireEssence:  { id:"fireEssence",  type:"buff",   name:"Fire Essence",   emoji:"🔥", rarity:"rare",     desc:"Weapon deals +2 dmg for 20s",buffType:"damage",duration:20000, dmgBonus:2 },
  batWing:      { id:"batWing",      type:"sellable",name:"Bat Wing",      emoji:"🦇", rarity:"common",   desc:"Sell for 2 coins",        sellValue:2 },
  spiderSilk:   { id:"spiderSilk",   type:"sellable",name:"Spider Silk",   emoji:"🕸",  rarity:"uncommon", desc:"Sell for 3 coins",        sellValue:3 },
  stoneShard:   { id:"stoneShard",   type:"sellable",name:"Stone Shard",   emoji:"🪨", rarity:"uncommon", desc:"Sell for 4 coins",        sellValue:4 },
  ratTail:      { id:"ratTail",      type:"sellable",name:"Rat Tail",      emoji:"🐭", rarity:"common",   desc:"Sell for 1 coin",         sellValue:1 },
};

const LOOT_TABLES = {
  slime:      [ {item:"bread",w:30}, {item:"slimeGel",w:20}, {item:null,w:50} ],
  bat:        [ {item:"batWing",w:35}, {item:"energyDrink",w:15}, {item:null,w:50} ],
  skull:      [ {item:"staleBread",w:25}, {item:"boneCharm",w:15}, {item:null,w:60} ],
  spider:     [ {item:"spiderSilk",w:30}, {item:"venomVial",w:10}, {item:null,w:60} ],
  eyeball:    [ {item:"meat",w:25}, {item:"longbow",w:8}, {item:null,w:67} ],
  rat:        [ {item:"cheese",w:40}, {item:"ratTail",w:30}, {item:null,w:30} ],
  golem:      [ {item:"stoneShard",w:35}, {item:"chainArmor",w:8}, {item:"towerShield",w:4}, {item:null,w:53} ],
  flameskull: [ {item:"meat",w:20}, {item:"fireEssence",w:12}, {item:"magicOrb",w:6}, {item:null,w:62} ],
};

function rollLoot(monsterType) {
  const table = LOOT_TABLES[monsterType];
  if (!table) return null;
  const total = table.reduce((s,e)=>s+e.w, 0);
  let r = Math.random() * total;
  for (const entry of table) { r -= entry.w; if (r <= 0) return entry.item ? { ...ITEM_DEFS[entry.item], uid: uuidv4(), qty: 1 } : null; }
  return null;
}

// ── Maps ──────────────────────────────────────────────────────────────────────
function generateOverworld() { /* ... same as your current file ... */ }
function generateDungeon()   { /* ... same as your current file ... */ }
function generateCity()      { /* ... same as your current file ... */ }

const MAPS = {
  overworld: generateOverworld(),
  dungeon:   generateDungeon(),
  city:      generateCity(),
};

// ── Door routing (with your latest fixes) ─────────────────────────────────────
function getDoorDest(mapId, tile) {
  if (mapId==="overworld" && tile===T.DOOR_DOWN)  return { dest:"dungeon",   x:20, y:27 };
  if (mapId==="dungeon"   && tile===T.DOOR_UP)    return { dest:"overworld", x:20, y:26 };
  if (mapId==="overworld" && tile===T.DOOR_CITY)  return { dest:"city",      x:2,  y:15 };
  if (mapId==="city"      && tile===T.DOOR_OVERWORLD) return { dest:"overworld", x:36, y:15 };
  return null;
}

// ── Shop, DB, Stats functions (keeping your current code) ─────────────────────
// ... (your ITEM_DEFS, SHOP_ITEMS, DB functions, statsFromUpgrades, etc. remain the same)

// ── Online state ──────────────────────────────────────────────────────────────
const onlinePlayers = new Map();

// ── Monsters ──────────────────────────────────────────────────────────────────
// ... (your MONSTER_DEFS, spawn functions, etc. remain the same)

function emitToMap(mapId,event,data) {
  onlinePlayers.forEach((p,sid)=>{ if(p.mapId===mapId) io.to(sid).emit(event,data); });
}

// ── All your other functions (monster AI, physics, projectiles, etc.) ─────────
// ... keep everything else exactly as you have it now ...

// ── Sockets ───────────────────────────────────────────────────────────────────
io.on("connection",socket=>{
  const rawOn=socket.on.bind(socket);
  socket.on=(ev,fn)=>rawOn(ev,(...args)=>{try{fn(...args);}catch(e){logErr("socket:"+ev,e);}});

  socket.on("join",({playerId}={})=>{
    // ... your current join logic stays the same until the end ...
    const p=onlinePlayers.get(socket.id);
    socket.emit("init",{ /* ... */ });

    // ✅ Changed to global
    io.emit("playerJoined",p);
  });

  // ... all your other handlers (input, shoot, inventory, trade, etc.) stay the same ...

  socket.on("disconnect",()=>{
    const p=onlinePlayers.get(socket.id);
    if(p){
      updatePlayerPos(p.id,Math.floor(p.x),Math.floor(p.y),p.mapId);
      
      // ✅ Changed to global
      io.emit("playerLeft",{id:p.id});
      onlinePlayers.delete(socket.id);
    }
  });
});

// ── changeMap function (updated) ──────────────────────────────────────────────
function changeMap(p,dest,destX,destY){
  const oldMapId = p.mapId;

  // ✅ Changed to global
  io.emit("playerLeft",{id:p.id});

  p.mapId = dest;
  p.x = destX + 0.5;
  p.y = destY + 0.5;
  p.h = 0;
  p.vh = 0;
  p.invincibleUntil = Date.now() + 1500;
  updatePlayerPos(p.id, destX, destY, dest);

  const destMonsters = monstersByMap[dest] ? Array.from(monstersByMap[dest].values()) : [];
  io.to(p.socketId).emit("mapChange",{
    mapId: dest,
    map: MAPS[dest].tiles,
    mapCols: MAPS[dest].cols,
    mapRows: MAPS[dest].rows,
    x: p.x,
    y: p.y,
    hp: p.hp,
    maxHp: p.stats.maxHp,
    players: Array.from(onlinePlayers.values()).filter(q => q.mapId === dest && q.id !== p.id),
    monsters: destMonsters,
    coins: Array.from(floorCoinsByMap[dest]?.values() || []),
    floorItems: Array.from(floorItemsByMap[dest]?.values() || []),
  });

  // ✅ Changed to global
  io.emit("playerJoined",p);
}

// ── respawnPlayer function (updated) ──────────────────────────────────────────
function respawnPlayer(p, socketId, fromMapId){
  setTimeout(() => {
    if (!onlinePlayers.has(socketId)) return;
    // ... your current respawn logic ...

    // ✅ Changed to global
    io.emit("playerLeft", { id: p.id });

    io.to(socketId).emit("mapChange", { /* ... */ });

    // ✅ Changed to global
    io.emit("playerJoined", p);
  }, RESPAWN_DELAY_MS);
}

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  spawnInitialMonsters();
  server.listen(PORT, () => console.log(`MMO running → http://localhost:${PORT}`));
});