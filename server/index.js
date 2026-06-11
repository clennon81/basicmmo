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
// ── Shared physics (single source of truth with the client) ──────────────────
const PH = require("../client/js/physics.js");
const PC = PH.C;
const PASSABLE = PH.WALKABLE;

function logErr(where, e) {
  console.error(`[${new Date().toISOString()}] ERROR in ${where}:`, (e && e.stack) || e);
}

// ── Item definitions ──────────────────────────────────────────────────────────
const ITEM_DEFS = {
  // FOOD
  bread:        { id:"bread",        type:"food",   name:"Bread",          emoji:"🍞", rarity:"common",   desc:"Restores 2 HP",           healAmt:2  },
  staleBread:   { id:"staleBread",   type:"food",   name:"Stale Bread",    emoji:"🥖", rarity:"common",   desc:"Restores 1 HP",           healAmt:1  },
  meat:         { id:"meat",         type:"food",   name:"Raw Meat",       emoji:"🥩", rarity:"uncommon", desc:"Restores 4 HP",           healAmt:4  },
  cheese:       { id:"cheese",       type:"food",   name:"Cheese",         emoji:"🧀", rarity:"common",   desc:"Restores 2 HP",           healAmt:2  },
  // WEAPONS
  sword:        { id:"sword",        type:"weapon", name:"Sword Shot",     emoji:"⚔️",  rarity:"uncommon", desc:"Deals 2 damage",          damage:2, range:10 },
  magicOrb:     { id:"magicOrb",     type:"weapon", name:"Magic Orb",      emoji:"🔮", rarity:"rare",     desc:"Deals 3 damage, slow",    damage:3, range:8,  projSpeed:180 },
  longbow:      { id:"longbow",      type:"weapon", name:"Longbow",        emoji:"🏹", rarity:"uncommon", desc:"Deals 2 damage, long range",damage:2,range:16 },
  // ARMOR
  leatherVest:  { id:"leatherVest",  type:"armor",  name:"Leather Vest",   emoji:"🧥", rarity:"uncommon", desc:"20% damage reduction",    reduction:0.20 },
  chainArmor:   { id:"chainArmor",   type:"armor",  name:"Chain Armor",    emoji:"⛓",  rarity:"rare",     desc:"40% damage reduction",    reduction:0.40 },
  towerShield:  { id:"towerShield",  type:"armor",  name:"Tower Shield",   emoji:"🛡",  rarity:"rare",     desc:"60% reduction, -20% speed",reduction:0.60, speedPenalty:0.8 },
  // BUFFS
  slimeGel:     { id:"slimeGel",     type:"buff",   name:"Slime Gel",      emoji:"💚", rarity:"common",   desc:"Regen 1HP/8s for 60s",    buffType:"regen",  duration:60000 },
  energyDrink:  { id:"energyDrink",  type:"buff",   name:"Energy Drink",   emoji:"⚡", rarity:"uncommon", desc:"Speed boost for 30s",     buffType:"speed",  duration:30000, moveDelay:70 },
  boneCharm:    { id:"boneCharm",    type:"buff",   name:"Bone Charm",     emoji:"🦴", rarity:"uncommon", desc:"Block 30% damage for 45s", buffType:"armor",  duration:45000, blockChance:0.30 },
  venomVial:    { id:"venomVial",    type:"buff",   name:"Venom Vial",     emoji:"🧪", rarity:"rare",     desc:"Weapon deals +1 dmg for 30s",buffType:"damage",duration:30000, dmgBonus:1 },
  fireEssence:  { id:"fireEssence",  type:"buff",   name:"Fire Essence",   emoji:"🔥", rarity:"rare",     desc:"Weapon deals +2 dmg for 20s",buffType:"damage",duration:20000, dmgBonus:2 },
  // SELLABLES
  batWing:      { id:"batWing",      type:"sellable",name:"Bat Wing",      emoji:"🦇", rarity:"common",   desc:"Sell for 2 coins",        sellValue:2 },
  spiderSilk:   { id:"spiderSilk",   type:"sellable",name:"Spider Silk",   emoji:"🕸",  rarity:"uncommon", desc:"Sell for 3 coins",        sellValue:3 },
  stoneShard:   { id:"stoneShard",   type:"sellable",name:"Stone Shard",   emoji:"🪨", rarity:"uncommon", desc:"Sell for 4 coins",        sellValue:4 },
  ratTail:      { id:"ratTail",      type:"sellable",name:"Rat Tail",      emoji:"🐭", rarity:"common",   desc:"Sell for 1 coin",         sellValue:1 },
};

// ── Loot tables ───────────────────────────────────────────────────────────────
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
function generateOverworld() {
  const COLS=40, ROWS=30;
  const tiles = [];
  for (let y=0; y<ROWS; y++) {
    const row = [];
    for (let x=0; x<COLS; x++) {
      if (x===0||y===0||x===COLS-1||y===ROWS-1) { row.push(T.WATER); continue; }
      const seed = Math.sin(x*127.1+y*311.7)*43758.5453123;
      const val = seed - Math.floor(seed);
      if (val<0.08) row.push(T.WATER);
      else if (val<0.15) row.push(T.SAND);
      else if (val<0.25) row.push(T.TREE);
      else if (val<0.32) row.push(T.MOUNTAIN);
      else row.push(T.GRASS);
    }
    tiles.push(row);
  }
  // Dungeon door at bottom-centre
  const doorX = Math.floor(COLS/2);
  for (let y=ROWS-4; y<ROWS-1; y++) tiles[y][doorX] = T.GRASS;
  tiles[ROWS-2][doorX] = T.DOOR_DOWN;
  // City road on the right side
  for (let y=12; y<18; y++) tiles[y][COLS-2] = T.ROAD;
  tiles[15][COLS-2] = T.DOOR_CITY;
  return { tiles, cols:COLS, rows:ROWS, id:"overworld" };
}

function generateDungeon() {
  const COLS=40, ROWS=30;
  const tiles = [];
  for (let y=0; y<ROWS; y++) tiles.push(new Array(COLS).fill(T.DUNGEON_WALL));
  const rooms = [
    {x:2,y:2,w:10,h:8},{x:15,y:2,w:12,h:7},{x:28,y:2,w:10,h:8},
    {x:2,y:14,w:8,h:8},{x:13,y:13,w:14,h:9},{x:30,y:14,w:8,h:8},
    {x:6,y:24,w:28,h:4},
  ];
  rooms.forEach(r => {
    for (let y=r.y; y<r.y+r.h&&y<ROWS-1; y++)
      for (let x=r.x; x<r.x+r.w&&x<COLS-1; x++)
        tiles[y][x] = T.DUNGEON_FLOOR;
  });
  const corridors = [
    {x:10,y:5,w:5,h:2},{x:22,y:4,w:6,h:2},
    {x:8,y:9,w:2,h:5},{x:20,y:9,w:2,h:4},{x:33,y:10,w:2,h:4},
    {x:9,y:16,w:4,h:2},{x:26,y:16,w:4,h:2},
    {x:8,y:20,w:2,h:4},{x:20,y:21,w:2,h:2},{x:33,y:20,w:2,h:4},
  ];
  corridors.forEach(c => {
    for (let y=c.y; y<c.y+c.h&&y<ROWS; y++)
      for (let x=c.x; x<c.x+c.w&&x<COLS; x++)
        tiles[y][x] = T.DUNGEON_FLOOR;
  });
  const lavaPits = [{x:16,y:15},{x:17,y:15},{x:16,y:16},{x:23,y:15},{x:24,y:15},{x:23,y:16},{x:5,y:16},{x:34,y:16}];
  lavaPits.forEach(p => { if(tiles[p.y][p.x]===T.DUNGEON_FLOOR) tiles[p.y][p.x]=T.LAVA; });
  const doorX = Math.floor(COLS/2);
  tiles[3][doorX] = T.DOOR_UP;
  for (let dx=-1; dx<=1; dx++) tiles[27][doorX+dx] = T.DUNGEON_FLOOR;
  return { tiles, cols:COLS, rows:ROWS, id:"dungeon" };
}

function generateCity() {
  const COLS=40, ROWS=30;
  const tiles = [];
  // Base: cobblestone
  for (let y=0; y<ROWS; y++) tiles.push(new Array(COLS).fill(T.COBBLE));
  // Border walls (building tiles = impassable)
  for (let x=0; x<COLS; x++) { tiles[0][x]=T.BUILDING; tiles[ROWS-1][x]=T.BUILDING; }
  for (let y=0; y<ROWS; y++) { tiles[y][0]=T.BUILDING; tiles[y][COLS-1]=T.BUILDING; }
  // Roads
  for (let x=1; x<COLS-1; x++) { tiles[15][x]=T.ROAD; tiles[8][x]=T.ROAD; tiles[22][x]=T.ROAD; }
  for (let y=1; y<ROWS-1; y++) { tiles[y][10]=T.ROAD; tiles[y][20]=T.ROAD; tiles[y][30]=T.ROAD; }
  // Buildings (blocks of impassable)
  const buildings = [
    {x:2,y:2,w:7,h:5}, {x:12,y:2,w:7,h:5}, {x:22,y:2,w:7,h:5}, {x:32,y:2,w:6,h:5},
    {x:2,y:10,w:7,h:4}, {x:32,y:10,w:6,h:4},
    {x:2,y:17,w:7,h:4}, {x:32,y:17,w:6,h:4},
    {x:2,y:24,w:7,h:4}, {x:12,y:24,w:7,h:4}, {x:22,y:24,w:7,h:4}, {x:32,y:24,w:6,h:4},
  ];
  buildings.forEach(b => {
    for (let y=b.y; y<b.y+b.h&&y<ROWS-1; y++)
      for (let x=b.x; x<b.x+b.w&&x<COLS-1; x++)
        tiles[y][x] = T.BUILDING;
  });
  // Fountain at centre
  tiles[15][20] = T.FOUNTAIN;
  // Trading post (big building, centre-left)
  for (let y=10; y<14; y++) for (let x=12; x<18; x++) tiles[y][x] = T.BUILDING;
  tiles[13][15] = T.TRADE_POST; // walkable entrance
  // Notice board
  tiles[10][22] = T.NOTICE_BOARD;
  // Entry door from overworld (left side)
  tiles[15][1] = T.DOOR_OVERWORLD;
  // Make sure paths to special tiles are clear
  tiles[15][14] = T.COBBLE; tiles[15][15] = T.COBBLE; tiles[14][15] = T.COBBLE;
  tiles[11][22] = T.COBBLE; tiles[12][22] = T.COBBLE;
  return { tiles, cols:COLS, rows:ROWS, id:"city" };
}

const MAPS = {
  overworld: generateOverworld(),
  dungeon:   generateDungeon(),
  city:      generateCity(),
};

// ── Door routing ──────────────────────────────────────────────────────────────
function getDoorDest(mapId, tile) {
  if (mapId==="overworld" && tile===T.DOOR_DOWN)  return { dest:"dungeon",   x:20, y:27 };
  if (mapId==="dungeon"   && tile===T.DOOR_UP)    return { dest:"overworld", x:20, y:3  };
  if (mapId==="overworld" && tile===T.DOOR_CITY)  return { dest:"city",      x:2,  y:15 };
  if (mapId==="city"      && tile===T.DOOR_OVERWORLD) return { dest:"overworld", x:35, y:15 };
  return null;
}

// ── Shop ──────────────────────────────────────────────────────────────────────
const SHOP_ITEMS = [
  { id:"speed1",    group:"speed",    tier:1, name:"Swift Boots",  emoji:"🥾", desc:"Move faster",         cost:5,  stat:"Move delay 150ms → 100ms" },
  { id:"speed2",    group:"speed",    tier:2, requires:"speed1",   name:"Wind Boots",   emoji:"🏃", desc:"Move even faster",    cost:8,  stat:"Move delay 100ms → 60ms" },
  { id:"rapidfire", group:"rapidfire",tier:1, name:"Quick Quiver", emoji:"🔥", desc:"Shoot faster",        cost:5,  stat:"Fire cooldown: 300ms" },
  { id:"rapidfire2",group:"rapidfire",tier:2, requires:"rapidfire",name:"Storm Quiver", emoji:"⚡", desc:"Shoot even faster",   cost:8,  stat:"Fire cooldown: 150ms" },
  { id:"maxhp1",    group:"maxhp",    tier:1, name:"Iron Heart",   emoji:"💗", desc:"More max HP",         cost:8,  stat:"Max HP 10 → 15" },
  { id:"maxhp2",    group:"maxhp",    tier:2, requires:"maxhp1",   name:"Diamond Heart",emoji:"💎", desc:"Even more max HP",    cost:12, stat:"Max HP 15 → 20" },
  { id:"armour",    group:"armour",   tier:1, name:"Chain Mail",   emoji:"🛡", desc:"50% chance to block", cost:10, stat:"Damage reduction: 50%" },
  { id:"regen",     group:"regen",    tier:1, name:"Life Amulet",  emoji:"❤️‍🔥",desc:"Regen HP over time",  cost:6,  stat:"Regen 1 HP every 8s" },
];

// ── DB ────────────────────────────────────────────────────────────────────────
let db;
const dbPath = path.join(__dirname, "players.db");

async function initDB() {
  const SQL = await initSqlJs();
  db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();
  db.run(`CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL,
    x INTEGER DEFAULT 5, y INTEGER DEFAULT 5, map TEXT DEFAULT 'overworld',
    color TEXT DEFAULT '#4ade80', coins INTEGER DEFAULT 0,
    hp INTEGER DEFAULT 10, upgrades TEXT DEFAULT '[]',
    inventory TEXT DEFAULT '[]', equipped TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  for (const col of [
    "ALTER TABLE players ADD COLUMN hp INTEGER DEFAULT 10",
    "ALTER TABLE players ADD COLUMN upgrades TEXT DEFAULT '[]'",
    "ALTER TABLE players ADD COLUMN map TEXT DEFAULT 'overworld'",
    "ALTER TABLE players ADD COLUMN inventory TEXT DEFAULT '[]'",
    "ALTER TABLE players ADD COLUMN equipped TEXT DEFAULT '{}'",
  ]) { try { db.run(col); } catch(e) {} }

  db.run(`CREATE TABLE IF NOT EXISTS trade_listings (
    id TEXT PRIMARY KEY, seller_id TEXT, seller_name TEXT, seller_color TEXT,
    offer_items TEXT DEFAULT '[]', offer_coins INTEGER DEFAULT 0,
    want_coins INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT 0
  )`);
  saveDB();
}

let saveTimer = null;
function saveDB() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { fs.writeFileSync(dbPath, Buffer.from(db.export())); saveTimer=null; }, 5000);
}

function getPlayer(id)      { const s=db.prepare("SELECT * FROM players WHERE id=?"); s.bind([id]); const r=s.step()?s.getAsObject():null; s.free(); return r; }
function getPlayerByName(n) { const s=db.prepare("SELECT * FROM players WHERE name=?"); s.bind([n]); const r=s.step()?s.getAsObject():null; s.free(); return r; }
function parseJ(str,def)    { try{return JSON.parse(str||JSON.stringify(def));}catch(e){return def;} }

function createPlayer(name) {
  const id=uuidv4();
  const colors=["#4ade80","#60a5fa","#f472b6","#fb923c","#a78bfa","#34d399","#fbbf24","#f87171"];
  const color=colors[Math.floor(Math.random()*colors.length)];
  const map=MAPS.overworld; let sx=5,sy=5;
  outer: for(let y=2;y<map.rows-2;y++) for(let x=2;x<map.cols-2;x++) if(PASSABLE.has(map.tiles[y][x])&&map.tiles[y][x]!==T.DOOR_DOWN){sx=x;sy=y;break outer;}
  db.run("INSERT INTO players (id,name,x,y,map,color,coins,hp,upgrades,inventory,equipped) VALUES (?,?,?,?,'overworld',?,0,10,'[]','[]','{}')",[id,name,sx,sy,color]);
  saveDB(); return getPlayer(id);
}

function saveInventory(id,inv,equipped) {
  db.run("UPDATE players SET inventory=?,equipped=? WHERE id=?",[JSON.stringify(inv),JSON.stringify(equipped),id]); saveDB();
}
function updatePlayerPos(id,x,y,mapId) { db.run("UPDATE players SET x=?,y=?,map=? WHERE id=?",[x,y,mapId,id]); saveDB(); }
function updatePlayerHP(id,hp)         { db.run("UPDATE players SET hp=? WHERE id=?",[hp,id]); saveDB(); }
function setCoins(id,coins)            { db.run("UPDATE players SET coins=? WHERE id=?",[coins,id]); saveDB(); }
function addCoins(id,n)                { db.run("UPDATE players SET coins=coins+? WHERE id=?",[n,id]); saveDB(); }
function saveUpgrades(id,list)         { db.run("UPDATE players SET upgrades=? WHERE id=?",[JSON.stringify(list),id]); saveDB(); }

function statsFromUpgrades(upgrades,equipped,activeBuffs) {
  const has = id => upgrades.includes(id);
  let maxHp     = has("maxhp2")?20:has("maxhp1")?15:10;
  let moveDelay = has("speed2")?60:has("speed1")?100:150;
  let fireDelay = has("rapidfire2")?150:has("rapidfire")?300:0;
  let armour    = has("armour");
  let regen     = has("regen");
  let dmgBonus  = 0;
  let blockChance = armour ? 0.5 : 0;
  let projDamage = 1, projRange = 10, projSpeed = 120;

  // equipped armor
  if (equipped?.armor) {
    blockChance = Math.max(blockChance, equipped.armor.reduction||0);
    if (equipped.armor.speedPenalty) moveDelay = Math.round(moveDelay / equipped.armor.speedPenalty);
  }
  // equipped weapon
  if (equipped?.weapon) {
    projDamage = equipped.weapon.damage || 1;
    projRange  = equipped.weapon.range  || 10;
    projSpeed  = equipped.weapon.projSpeed || 120;
  }
  // active buffs
  if (activeBuffs) {
    activeBuffs.forEach(b => {
      if (b.buffType==="speed")  moveDelay = Math.min(moveDelay, b.moveDelay||70);
      if (b.buffType==="regen")  regen = true;
      if (b.buffType==="armor")  blockChance = Math.max(blockChance, b.blockChance||0);
      if (b.buffType==="damage") dmgBonus += b.dmgBonus||0;
    });
  }
  return { maxHp, moveDelay, fireDelay, armour, regen, blockChance, projDamage:projDamage+dmgBonus, projRange, projSpeed };
}

// ── Online state ──────────────────────────────────────────────────────────────
const onlinePlayers = new Map();

// ── Monsters ──────────────────────────────────────────────────────────────────
const MONSTER_DEFS = {
  overworld: [
    { type:"slime",  emoji:"🟢", damage:1, hp:3, speed:1200 },
    { type:"skull",  emoji:"💀", damage:1, hp:3, speed:1200 },
    { type:"spider", emoji:"🕷",  damage:1, hp:3, speed:1000 },
    { type:"bat",    emoji:"🦇", damage:1, hp:2, speed:900  },
  ],
  dungeon: [
    { type:"eyeball",   emoji:"👁",  damage:1, hp:4, speed:1100 },
    { type:"rat",       emoji:"🐀",  damage:1, hp:2, speed:800  },
    { type:"golem",     emoji:"🗿",  damage:2, hp:6, speed:1600 },
    { type:"flameskull",emoji:"🔥",  damage:2, hp:3, speed:700  },
  ],
};
const MAX_MONSTERS_PER_MAP=10, MONSTER_RESPAWN_MS=8000;
const monstersByMap = { overworld:new Map(), dungeon:new Map() };

function emitToMap(mapId,event,data) {
  onlinePlayers.forEach((p,sid)=>{ if(p.mapId===mapId) io.to(sid).emit(event,data); });
}

function spawnMonster(mapId) {
  if (!MONSTER_DEFS[mapId]) return; // no monsters in city
  const pool=monstersByMap[mapId]; if(!pool||pool.size>=MAX_MONSTERS_PER_MAP) return;
  const map=MAPS[mapId]; const defs=MONSTER_DEFS[mapId];
  const def=defs[Math.floor(Math.random()*defs.length)];
  let pos=null;
  for(let i=0;i<300;i++){
    const x=1+Math.floor(Math.random()*(map.cols-2));
    const y=1+Math.floor(Math.random()*(map.rows-2));
    const tile=map.tiles[y][x];
    if(PASSABLE.has(tile)&&tile!==T.DOOR_DOWN&&tile!==T.DOOR_UP){pos={x,y};break;}
  }
  if(!pos) return;
  const id=uuidv4();
  const m={id,x:pos.x+0.5,y:pos.y+0.5,hp:def.hp,maxHp:def.hp,mapId,...def,vx:0,vy:0,lastAI:0,lastAttack:0};
  pool.set(id,m); emitToMap(mapId,"monsterSpawned",m);
}

function spawnInitialMonsters() {
  for(const mapId of ["overworld","dungeon"])
    for(let i=0;i<Math.min(MAX_MONSTERS_PER_MAP,7);i++) spawnMonster(mapId);
}

const INVINCIBILITY_MS=1200, RESPAWN_DELAY_MS=3000;
const MONSTER_AGGRO_RANGE=6.5, MONSTER_AI_MS=250, MELEE_COOLDOWN_MS=900;

function respawnPlayer(p,socketId,fromMapId){
  setTimeout(()=>{
    if(!onlinePlayers.has(socketId)) return;
    p.hp=p.stats.maxHp; p.mapId="overworld";
    const ow=MAPS.overworld; let sx=5,sy=5;
    outer: for(let y=2;y<ow.rows-2;y++) for(let x=2;x<ow.cols-2;x++) if(PASSABLE.has(ow.tiles[y][x])&&ow.tiles[y][x]!==T.DOOR_DOWN){sx=x;sy=y;break outer;}
    p.x=sx+0.5;p.y=sy+0.5;p.h=0;p.vh=0; p.dead=false; p.invincibleUntil=Date.now()+2000;
    updatePlayerPos(p.id,sx,sy,"overworld"); updatePlayerHP(p.id,p.hp);
    emitToMap(fromMapId,"playerLeft",{id:p.id});
    io.to(socketId).emit("mapChange",{
      mapId:"overworld",map:MAPS.overworld.tiles,mapCols:MAPS.overworld.cols,mapRows:MAPS.overworld.rows,
      x:p.x,y:p.y,hp:p.hp,maxHp:p.stats.maxHp,
      players:Array.from(onlinePlayers.values()).filter(q=>q.mapId==="overworld"&&q.id!==p.id),
      monsters:Array.from(monstersByMap.overworld.values()),
      coins:Array.from(floorCoinsByMap.overworld.values()),
      floorItems:Array.from((floorItemsByMap.overworld||new Map()).values()),
    });
    emitToMap("overworld","playerJoined",p);
  },RESPAWN_DELAY_MS);
}

function monsterMelee(mapId,m,now){
  onlinePlayers.forEach((p,socketId)=>{
    if(p.mapId!==mapId||p.dead) return;
    if(p.invincibleUntil&&now<p.invincibleUntil) return;
    const dx=p.x-m.x,dy=p.y-m.y;
    if(dx*dx+dy*dy>PC.MELEE_RADIUS*PC.MELEE_RADIUS) return;
    if(now-(m.lastAttack||0)<MELEE_COOLDOWN_MS) return;
    m.lastAttack=now;
    const blocked=Math.random()<(p.stats.blockChance||0);
    const dmg=blocked?0:m.damage;
    p.hp=Math.max(0,p.hp-dmg);
    p.invincibleUntil=now+INVINCIBILITY_MS;
    // knockback away from the monster, sliding along walls
    const len=Math.hypot(dx,dy)||1;
    const map=MAPS[mapId];
    const kb=PH.moveCircle(map.tiles,map.cols,map.rows,p.x,p.y,
      (dx/len)*PC.KNOCKBACK,(dy/len)*PC.KNOCKBACK,PC.PLAYER_RADIUS,PH.WALKABLE);
    p.x=kb.x;p.y=kb.y;
    updatePlayerHP(p.id,p.hp);
    emitToMap(mapId,"playerHit",{id:p.id,hp:p.hp,maxHp:p.stats.maxHp,blocked});
    if(p.hp<=0){
      p.dead=true; emitToMap(mapId,"playerDied",{id:p.id});
      respawnPlayer(p,socketId,mapId);
    }
  });
}

/* AI decisions at a slow cadence; actual motion is integrated in the
   physics tick so monsters move smoothly and slide along walls. */
function monsterAITick(now){
  for(const mapId of ["overworld","dungeon"]){
    monstersByMap[mapId].forEach(m=>{
      if(now-(m.lastAI||0)<MONSTER_AI_MS) return;
      m.lastAI=now;
      let target=null,best=MONSTER_AGGRO_RANGE;
      onlinePlayers.forEach(p=>{
        if(p.mapId!==mapId||p.dead) return;
        const d=Math.hypot(p.x-m.x,p.y-m.y);
        if(d<best){best=d;target=p;}
      });
      if(target){
        const len=Math.hypot(target.x-m.x,target.y-m.y)||1;
        m.vx=(target.x-m.x)/len; m.vy=(target.y-m.y)/len;
      }else if(!m.wanderUntil||now>m.wanderUntil){
        m.wanderUntil=now+1200+Math.random()*1500;
        if(Math.random()<0.35){m.vx=0;m.vy=0;}
        else{const a=Math.random()*Math.PI*2;m.vx=Math.cos(a);m.vy=Math.sin(a);}
      }
    });
  }
}

function updateMonsters(dt,now){
  for(const mapId of ["overworld","dungeon"]){
    const map=MAPS[mapId];
    monstersByMap[mapId].forEach(m=>{
      const speed=Math.max(0.6,Math.min(4,1000/(m.speed||700))); // ms-per-tile → tiles/s
      if(m.vx||m.vy){
        const moved=PH.moveCircle(map.tiles,map.cols,map.rows,m.x,m.y,
          m.vx*speed*dt,m.vy*speed*dt,PC.MONSTER_RADIUS,PH.MONSTER_WALKABLE);
        m.x=moved.x;m.y=moved.y;
      }
      monsterMelee(mapId,m,now);
    });
  }
}

// ── Regen / buff tick ─────────────────────────────────────────────────────────
setInterval(()=>{
  const now=Date.now();
  onlinePlayers.forEach(p=>{
    // expire buffs
    if(p.activeBuffs&&p.activeBuffs.length>0){
      const before=p.activeBuffs.length;
      p.activeBuffs=p.activeBuffs.filter(b=>now<b.expiresAt);
      if(p.activeBuffs.length!==before){
        p.stats=statsFromUpgrades(p.upgrades,p.equipped,p.activeBuffs);
        io.to(p.socketId).emit("buffsUpdate",{buffs:p.activeBuffs,stats:p.stats});
      }
    }
    // regen
    if(!p.dead&&p.stats.regen&&p.hp<p.stats.maxHp){
      p.hp=Math.min(p.stats.maxHp,p.hp+1); updatePlayerHP(p.id,p.hp);
      emitToMap(p.mapId,"playerHit",{id:p.id,hp:p.hp,maxHp:p.stats.maxHp});
    }
  });
},8000);

// ── Floor items (drops) ───────────────────────────────────────────────────────
const floorCoinsByMap = { overworld:new Map(), dungeon:new Map(), city:new Map() };
const floorItemsByMap = { overworld:new Map(), dungeon:new Map(), city:new Map() };

function dropCoin(mapId,x,y){
  const id=uuidv4(); floorCoinsByMap[mapId].set(id,{id,x,y}); emitToMap(mapId,"coinDropped",{id,x,y});
}
function dropItem(mapId,x,y,item){
  if(!item) return;
  const fi={...item,uid:item.uid||uuidv4(),x,y};
  floorItemsByMap[mapId].set(fi.uid,fi);
  emitToMap(mapId,"itemDropped",fi);
}

// ── Projectiles (substepped — cannot tunnel through walls) ───────────────────
const projectiles=new Map();

function killMonster(mapId,m){
  dropCoin(mapId,Math.floor(m.x),Math.floor(m.y));
  const loot=rollLoot(m.type);
  if(loot) dropItem(mapId,Math.floor(m.x),Math.floor(m.y),loot);
  monstersByMap[mapId].delete(m.id);
  emitToMap(mapId,"monsterDied",{id:m.id});
  setTimeout(()=>spawnMonster(mapId),MONSTER_RESPAWN_MS);
}

function updateProjectiles(dt){
  projectiles.forEach((proj,pid)=>{
    const map=MAPS[proj.mapId];
    const pool=monstersByMap[proj.mapId];
    let remaining=PC.PROJ_SPEED*dt, dead=false;
    while(remaining>0&&!dead){
      const step=Math.min(PC.PROJ_STEP,remaining); remaining-=step;
      proj.x+=proj.dx*step; proj.y+=proj.dy*step; proj.dist+=step;
      const t=PH.tileAt(map.tiles,map.cols,map.rows,Math.floor(proj.x),Math.floor(proj.y));
      // walls stop shots; water/lava don't (they're ground hazards, not cover)
      if(proj.dist>=proj.range||t===-1||PH.WALL_TILES.has(t)){dead=true;break;}
      if(pool) for(const m of pool.values()){
        const dx=proj.x-(m.x),dy=proj.y-(m.y);
        if(dx*dx+dy*dy<PC.HIT_RADIUS*PC.HIT_RADIUS){
          dead=true;
          const dmg=proj.damage||1;
          m.hp-=dmg;
          emitToMap(proj.mapId,"monsterHit",{id:m.id,hp:m.hp,maxHp:m.maxHp,dmg});
          if(m.hp<=0) killMonster(proj.mapId,m);
          break;
        }
      }
    }
    if(dead){projectiles.delete(pid);emitToMap(proj.mapId,"projDestroyed",{id:pid});}
  });
}

// ── Player physics + world interactions (server-authoritative) ───────────────
function changeMap(p,dest,destX,destY){
  const oldMapId=p.mapId;
  emitToMap(oldMapId,"playerLeft",{id:p.id});
  p.mapId=dest; p.x=destX+0.5; p.y=destY+0.5; p.h=0; p.vh=0;
  p.invincibleUntil=Date.now()+1500; p.lastDoorAt=Date.now();
  p.lastTile=`${dest}:${destX},${destY}`;
  updatePlayerPos(p.id,destX,destY,dest);
  const destMonsters=monstersByMap[dest]?Array.from(monstersByMap[dest].values()):[];
  io.to(p.socketId).emit("mapChange",{
    mapId:dest,map:MAPS[dest].tiles,mapCols:MAPS[dest].cols,mapRows:MAPS[dest].rows,
    x:p.x,y:p.y,hp:p.hp,maxHp:p.stats.maxHp,
    players:Array.from(onlinePlayers.values()).filter(q=>q.mapId===dest&&q.id!==p.id),
    monsters:destMonsters,
    coins:Array.from(floorCoinsByMap[dest]?.values()||[]),
    floorItems:Array.from(floorItemsByMap[dest]?.values()||[]),
  });
  emitToMap(dest,"playerJoined",p);
}

const DOOR_COOLDOWN_MS=800; // prevents re-trigger bouncing on arrival

function worldInteractions(p,now){
  const map=MAPS[p.mapId];
  const tx=Math.floor(p.x),ty=Math.floor(p.y);
  const tile=PH.tileAt(map.tiles,map.cols,map.rows,tx,ty);
  const tileKey=`${p.mapId}:${tx},${ty}`;
  const enteredNewTile=tileKey!==p.lastTile;
  p.lastTile=tileKey;

  // Doors — trigger when the player's centre enters the door tile
  if(PH.DOOR_TILES.has(tile)&&now-p.lastDoorAt>DOOR_COOLDOWN_MS){
    const doorDest=getDoorDest(p.mapId,tile);
    if(doorDest){changeMap(p,doorDest.dest,doorDest.x,doorDest.y);return;}
  }

  // Special tiles — only on tile ENTRY so menus don't reopen every tick
  if(enteredNewTile){
    if(tile===T.TRADE_POST){
      io.to(p.socketId).emit("openTradePost",{listings:getActiveListings()});
    }else if(tile===T.NOTICE_BOARD){
      const s=db.prepare("SELECT name,color,coins FROM players ORDER BY coins DESC LIMIT 5");
      const rows=[]; while(s.step()) rows.push(s.getAsObject()); s.free();
      io.to(p.socketId).emit("noticeBoardData",{leaderboard:rows});
    }
  }

  // Pickups by radius (coins/items are anchored to tile ints; centre +0.5)
  const R2=PC.PICKUP_RADIUS*PC.PICKUP_RADIUS;
  floorCoinsByMap[p.mapId]?.forEach((coin,cid)=>{
    const dx=p.x-(coin.x+0.5),dy=p.y-(coin.y+0.5);
    if(dx*dx+dy*dy<R2){
      floorCoinsByMap[p.mapId].delete(cid);
      addCoins(p.id,1); p.coins=(p.coins||0)+1;
      emitToMap(p.mapId,"coinCollected",{coinId:cid,playerId:p.id,total:p.coins});
    }
  });
  floorItemsByMap[p.mapId]?.forEach((item,iid)=>{
    const dx=p.x-(item.x+0.5),dy=p.y-(item.y+0.5);
    if(dx*dx+dy*dy<R2){
      if((p.inventory||[]).length>=24) return; // inventory cap
      floorItemsByMap[p.mapId].delete(iid);
      p.inventory=[...p.inventory,{...item,x:undefined,y:undefined}];
      saveInventory(p.id,p.inventory,p.equipped);
      emitToMap(p.mapId,"floorItemGone",{uid:iid});
      io.to(p.socketId).emit("inventoryUpdate",{inventory:p.inventory,equipped:p.equipped});
      io.to(p.socketId).emit("notification",{msg:`Picked up ${item.name}!`,color:"#34d399"});
    }
  });
}

const DB_POS_SAVE_MS=2500;

function updatePlayers(dt,now){
  onlinePlayers.forEach(p=>{
    if(p.dead) return;
    const map=MAPS[p.mapId];
    if(!map) return;
    const speed=PH.speedFromMoveDelay(p.stats.moveDelay);
    const next=PH.stepBody(map.tiles,map.cols,map.rows,p,p.input,speed,dt);
    p.x=next.x; p.y=next.y; p.h=next.h; p.vh=next.vh;
    p.input.jump=false; // consume one-shot jump
    worldInteractions(p,now);
    if(now-p.lastDbSave>DB_POS_SAVE_MS){
      p.lastDbSave=now;
      updatePlayerPos(p.id,Math.floor(p.x),Math.floor(p.y),p.mapId);
    }
  });
}

// ── Master loops ──────────────────────────────────────────────────────────────
let _lastTick=Date.now();
setInterval(()=>{
  const now=Date.now();
  const dt=Math.min(0.1,(now-_lastTick)/1000); _lastTick=now;
  try{
    updatePlayers(dt,now);
    monsterAITick(now);
    updateMonsters(dt,now);
    updateProjectiles(dt);
  }catch(e){logErr("physicsTick",e);}
},1000/PC.TICK_HZ);

/* Compact per-map snapshots: players [id,x,y,h,yaw], monsters [id,x,y],
   projectiles [id,x,y]. Rounded to 3 decimals to keep packets small. */
const r3=v=>Math.round(v*1000)/1000;
setInterval(()=>{
  try{
    for(const mapId of Object.keys(MAPS)){
      const players=[],mons=[],projs=[];
      onlinePlayers.forEach(p=>{if(p.mapId===mapId&&!p.dead)players.push([p.id,r3(p.x),r3(p.y),r3(p.h||0),r3(p.input.yaw||0)]);});
      monstersByMap[mapId]?.forEach(m=>mons.push([m.id,r3(m.x),r3(m.y)]));
      projectiles.forEach(pr=>{if(pr.mapId===mapId)projs.push([pr.id,r3(pr.x),r3(pr.y)]);});
      if(players.length) emitToMap(mapId,"tick",{p:players,m:mons,j:projs});
    }
  }catch(e){logErr("snapshot",e);}
},1000/PC.SNAPSHOT_HZ);

// ── Trade listing helpers ─────────────────────────────────────────────────────
function getActiveListings(){
  const cutoff=Date.now()-600000; // 10 min expiry
  const s=db.prepare("SELECT * FROM trade_listings WHERE created_at > ?");
  s.bind([cutoff]);
  const rows=[]; while(s.step()) rows.push(s.getAsObject()); s.free();
  return rows.map(r=>({...r,offer_items:parseJ(r.offer_items,[]) }));
}

// ── REST ──────────────────────────────────────────────────────────────────────
app.get("/api/shop",(req,res)=>res.json({items:SHOP_ITEMS}));
app.get("/api/items",(req,res)=>res.json({items:ITEM_DEFS}));

app.post("/api/login",(req,res)=>{
  const {name}=req.body;
  if(!name||name.trim().length<2||name.trim().length>20) return res.status(400).json({error:"Name must be 2–20 characters."});
  let player=getPlayerByName(name.trim());
  if(!player) player=createPlayer(name.trim());
  if(!player.hp||player.hp<=0){db.run("UPDATE players SET hp=10 WHERE id=?",[player.id]);player.hp=10;}
  res.json({player});
});

// ── Sockets ───────────────────────────────────────────────────────────────────
io.on("connection",socket=>{
  // Crash guard: a bad payload in any handler logs instead of killing the server.
  const rawOn=socket.on.bind(socket);
  socket.on=(ev,fn)=>rawOn(ev,(...args)=>{try{fn(...args);}catch(e){logErr("socket:"+ev,e);}});

  socket.on("join",({playerId}={})=>{
    if(typeof playerId!=="string") return;
    const player=getPlayer(playerId);
    if(!player) return socket.emit("error","Player not found");
    const upgrades=parseJ(player.upgrades,[]);
    const equipped=parseJ(player.equipped,{});
    const inventory=parseJ(player.inventory,[]);
    const activeBuffs=[];
    const stats=statsFromUpgrades(upgrades,equipped,activeBuffs);
    const mapId=player.map||"overworld";
    const monsterPool=monstersByMap[mapId];
    onlinePlayers.set(socket.id,{
      ...player,upgrades,equipped,inventory,activeBuffs,stats,mapId,
      hp:Math.min(player.hp||stats.maxHp,stats.maxHp),
      socketId:socket.id,dead:false,invincibleUntil:0,
      // continuous physics state (tile centre)
      x:Math.floor(Number(player.x)||2)+0.5, y:Math.floor(Number(player.y)||2)+0.5,
      h:0, vh:0,
      input:{f:false,b:false,l:false,r:false,yaw:0,jump:false},
      lastShot:0, lastTile:"", lastDbSave:0, lastDoorAt:0,
    });
    const p=onlinePlayers.get(socket.id);
    socket.emit("init",{
      mapId,map:MAPS[mapId].tiles,mapCols:MAPS[mapId].cols,mapRows:MAPS[mapId].rows,
      self:p,players:Array.from(onlinePlayers.values()).filter(q=>q.mapId===mapId),
      monsters:monsterPool?Array.from(monsterPool.values()):[],
      coins:Array.from(floorCoinsByMap[mapId]?.values()||[]),
      floorItems:Array.from(floorItemsByMap[mapId]?.values()||[]),
      inventory:p.inventory,equipped:p.equipped,activeBuffs:p.activeBuffs,
    });
    emitToMap(mapId,"playerJoined",p);
  });

  /* Client sends input STATE only — the server integrates movement.
     Speed hacks are impossible: velocity comes from server-side stats. */
  socket.on("input",(d)=>{
    const p=onlinePlayers.get(socket.id);
    if(!p||!d||typeof d!=="object") return;
    p.input.f=!!d.f; p.input.b=!!d.b; p.input.l=!!d.l; p.input.r=!!d.r;
    if(typeof d.yaw==="number"&&isFinite(d.yaw)) p.input.yaw=d.yaw%(Math.PI*2);
    if(d.jump===true) p.input.jump=true; // one-shot, consumed by the tick
  });

  /* Fully server-authoritative: the client sends no direction. The shot
     fires along the yaw the server already holds, origin is the server's
     own position for this player, and fire rate is enforced here. */
  socket.on("shoot",()=>{
    const p=onlinePlayers.get(socket.id);
    if(!p||p.dead) return;
    const now=Date.now();
    const minDelay=Math.max(120,p.stats.fireDelay||150);
    if(now-p.lastShot<minDelay) return;
    p.lastShot=now;
    const fwd=PH.yawForward(p.input.yaw);
    const id=uuidv4();
    const range=p.stats.projRange||10;
    const damage=p.stats.projDamage||1;
    projectiles.set(id,{id,x:p.x,y:p.y,dx:fwd.x,dy:fwd.y,dist:0,range,ownerId:p.id,mapId:p.mapId,damage});
    emitToMap(p.mapId,"projSpawned",{id,x:p.x,y:p.y,dx:fwd.x,dy:fwd.y,ownerId:p.id,damage});
  });

  // ── Inventory actions ─────────────────────────────────────────────────────
  socket.on("equipItem",({uid})=>{
    const p=onlinePlayers.get(socket.id);
    if(!p) return;
    const idx=p.inventory.findIndex(i=>i.uid===uid);
    if(idx<0) return;
    const item=p.inventory[idx];
    if(item.type!=="weapon"&&item.type!=="armor") return socket.emit("notification",{msg:"Can't equip that!",color:"#fb7185"});
    const slot=item.type; // "weapon" or "armor"
    const old=p.equipped[slot];
    // swap old equipped back to inventory
    if(old) p.inventory.push(old);
    p.inventory.splice(idx,1);
    p.equipped={...p.equipped,[slot]:item};
    p.stats=statsFromUpgrades(p.upgrades,p.equipped,p.activeBuffs);
    saveInventory(p.id,p.inventory,p.equipped);
    socket.emit("inventoryUpdate",{inventory:p.inventory,equipped:p.equipped});
    socket.emit("statsUpdate",{stats:p.stats,maxHp:p.stats.maxHp});
    socket.emit("notification",{msg:`Equipped ${item.name}!`,color:"#60a5fa"});
  });

  socket.on("unequipItem",({slot})=>{
    const p=onlinePlayers.get(socket.id);
    if(!p) return;
    const item=p.equipped[slot];
    if(!item) return;
    if((p.inventory||[]).length>=24) return socket.emit("notification",{msg:"Inventory full!",color:"#fb7185"});
    p.inventory.push(item);
    p.equipped={...p.equipped,[slot]:null};
    p.stats=statsFromUpgrades(p.upgrades,p.equipped,p.activeBuffs);
    saveInventory(p.id,p.inventory,p.equipped);
    socket.emit("inventoryUpdate",{inventory:p.inventory,equipped:p.equipped});
    socket.emit("statsUpdate",{stats:p.stats,maxHp:p.stats.maxHp});
    socket.emit("notification",{msg:`Unequipped ${item.name}`,color:"#94a3b8"});
  });

  socket.on("useItem",({uid})=>{
    const p=onlinePlayers.get(socket.id);
    if(!p) return;
    const idx=p.inventory.findIndex(i=>i.uid===uid);
    if(idx<0) return;
    const item=p.inventory[idx];
    if(item.type==="food"){
      const heal=item.healAmt||2;
      p.hp=Math.min(p.stats.maxHp,p.hp+heal);
      updatePlayerHP(p.id,p.hp);
      emitToMap(p.mapId,"playerHit",{id:p.id,hp:p.hp,maxHp:p.stats.maxHp});
      p.inventory.splice(idx,1);
      saveInventory(p.id,p.inventory,p.equipped);
      socket.emit("inventoryUpdate",{inventory:p.inventory,equipped:p.equipped});
      socket.emit("notification",{msg:`+${heal} HP from ${item.name}!`,color:"#34d399"});
    } else if(item.type==="buff"){
      p.activeBuffs=[...p.activeBuffs,{...item,expiresAt:Date.now()+item.duration}];
      p.stats=statsFromUpgrades(p.upgrades,p.equipped,p.activeBuffs);
      p.inventory.splice(idx,1);
      saveInventory(p.id,p.inventory,p.equipped);
      socket.emit("inventoryUpdate",{inventory:p.inventory,equipped:p.equipped});
      socket.emit("buffsUpdate",{buffs:p.activeBuffs,stats:p.stats});
      socket.emit("notification",{msg:`${item.name} activated!`,color:"#a78bfa"});
    } else {
      socket.emit("notification",{msg:"Can't use that — try equipping or selling it.",color:"#fb7185"});
    }
  });

  socket.on("dropItem",({uid})=>{
    const p=onlinePlayers.get(socket.id);
    if(!p) return;
    const idx=p.inventory.findIndex(i=>i.uid===uid);
    if(idx<0) return;
    const item=p.inventory.splice(idx,1)[0];
    dropItem(p.mapId,p.x,p.y,item);
    saveInventory(p.id,p.inventory,p.equipped);
    socket.emit("inventoryUpdate",{inventory:p.inventory,equipped:p.equipped});
    socket.emit("notification",{msg:`Dropped ${item.name}`,color:"#94a3b8"});
  });

  socket.on("sellItem",({uid})=>{
    const p=onlinePlayers.get(socket.id);
    if(!p) return;
    if(p.mapId!=="city") return socket.emit("notification",{msg:"You can only sell items in the city!",color:"#fb7185"});
    const idx=p.inventory.findIndex(i=>i.uid===uid);
    if(idx<0) return;
    const item=p.inventory[idx];
    const value=item.sellValue||1;
    p.inventory.splice(idx,1);
    addCoins(p.id,value); p.coins=(p.coins||0)+value;
    saveInventory(p.id,p.inventory,p.equipped);
    socket.emit("inventoryUpdate",{inventory:p.inventory,equipped:p.equipped});
    socket.emit("coinUpdate",{coins:p.coins});
    socket.emit("notification",{msg:`Sold ${item.name} for ${value} 🪙`,color:"#fcd34d"});
    emitToMap(p.mapId,"playerStatUpdate",{id:p.id,hp:p.hp,maxHp:p.stats.maxHp,coins:p.coins});
  });

  // ── Trading ───────────────────────────────────────────────────────────────
  socket.on("postTrade",({offerItemUids,offerCoins,wantCoins})=>{
    const p=onlinePlayers.get(socket.id);
    if(!p) return;
    if(p.mapId!=="city") return socket.emit("notification",{msg:"You can only trade in the city!",color:"#fb7185"});
    if((offerCoins||0)>(p.coins||0)) return socket.emit("notification",{msg:"Not enough coins to offer.",color:"#fb7185"});
    const offerItems=[];
    const uids=offerItemUids||[];
    for(const uid of uids){
      const idx=p.inventory.findIndex(i=>i.uid===uid);
      if(idx<0) return socket.emit("notification",{msg:"Item not found in inventory.",color:"#fb7185"});
      offerItems.push(p.inventory[idx]);
    }
    // Remove items + coins from player
    for(const uid of uids) { const idx=p.inventory.findIndex(i=>i.uid===uid); if(idx>=0) p.inventory.splice(idx,1); }
    if(offerCoins>0){p.coins-=offerCoins; setCoins(p.id,p.coins);}
    saveInventory(p.id,p.inventory,p.equipped);
    const id=uuidv4();
    db.run("INSERT INTO trade_listings (id,seller_id,seller_name,seller_color,offer_items,offer_coins,want_coins,created_at) VALUES (?,?,?,?,?,?,?,?)",
      [id,p.id,p.name,p.color,JSON.stringify(offerItems),offerCoins||0,wantCoins||0,Date.now()]);
    saveDB();
    socket.emit("inventoryUpdate",{inventory:p.inventory,equipped:p.equipped});
    socket.emit("coinUpdate",{coins:p.coins});
    socket.emit("notification",{msg:"Trade listing posted!",color:"#34d399"});
    emitToMap("city","tradeListingAdded",{id,seller_name:p.name,seller_color:p.color,offer_items:offerItems,offer_coins:offerCoins||0,want_coins:wantCoins||0});
  });

  socket.on("acceptTrade",({listingId})=>{
    const p=onlinePlayers.get(socket.id);
    if(!p) return;
    if(p.mapId!=="city") return socket.emit("notification",{msg:"You can only trade in the city!",color:"#fb7185"});
    const s=db.prepare("SELECT * FROM trade_listings WHERE id=?");
    s.bind([listingId]); const row=s.step()?s.getAsObject():null; s.free();
    if(!row) return socket.emit("notification",{msg:"Listing no longer available.",color:"#fb7185"});
    const wantCoins=row.want_coins||0;
    if(p.coins<wantCoins) return socket.emit("notification",{msg:`Need ${wantCoins} 🪙 to accept this trade.`,color:"#fb7185"});
    if((p.inventory||[]).length+JSON.parse(row.offer_items||"[]").length>24)
      return socket.emit("notification",{msg:"Not enough inventory space.",color:"#fb7185"});
    // Complete trade
    const offerItems=parseJ(row.offer_items,[]);
    p.inventory=[...p.inventory,...offerItems.map(i=>({...i,uid:uuidv4()}))];
    p.coins-=wantCoins; addCoins(p.id,-wantCoins);
    // Give coins to seller
    const seller=getPlayer(row.seller_id);
    if(seller) addCoins(row.seller_id,wantCoins);
    // Give want_coins back if seller is online, notify them
    const sellerSocket=[...onlinePlayers.entries()].find(([,q])=>q.id===row.seller_id);
    if(sellerSocket){
      const [sid,sp]=sellerSocket;
      sp.coins=(sp.coins||0)+wantCoins;
      io.to(sid).emit("coinUpdate",{coins:sp.coins});
      io.to(sid).emit("notification",{msg:`${p.name} accepted your trade! +${wantCoins}🪙`,color:"#fcd34d"});
    }
    db.run("DELETE FROM trade_listings WHERE id=?",[listingId]); saveDB();
    saveInventory(p.id,p.inventory,p.equipped); setCoins(p.id,p.coins);
    socket.emit("inventoryUpdate",{inventory:p.inventory,equipped:p.equipped});
    socket.emit("coinUpdate",{coins:p.coins});
    socket.emit("notification",{msg:"Trade accepted!",color:"#34d399"});
    emitToMap("city","tradeListingRemoved",{id:listingId});
  });

  socket.on("cancelTrade",({listingId})=>{
    const p=onlinePlayers.get(socket.id);
    if(!p) return;
    const s=db.prepare("SELECT * FROM trade_listings WHERE id=? AND seller_id=?");
    s.bind([listingId,p.id]); const row=s.step()?s.getAsObject():null; s.free();
    if(!row) return;
    // Return items + coins
    const offerItems=parseJ(row.offer_items,[]);
    p.inventory=[...p.inventory,...offerItems];
    const refundCoins=row.offer_coins||0;
    p.coins=(p.coins||0)+refundCoins;
    if(refundCoins>0) addCoins(p.id,refundCoins);
    db.run("DELETE FROM trade_listings WHERE id=?",[listingId]); saveDB();
    saveInventory(p.id,p.inventory,p.equipped);
    socket.emit("inventoryUpdate",{inventory:p.inventory,equipped:p.equipped});
    socket.emit("coinUpdate",{coins:p.coins});
    socket.emit("notification",{msg:"Trade listing cancelled.",color:"#94a3b8"});
    emitToMap("city","tradeListingRemoved",{id:listingId});
  });

  socket.on("refreshTrades",()=>{
    socket.emit("openTradePost",{listings:getActiveListings()});
  });

  socket.on("buyUpgrade",({itemId})=>{
    const p=onlinePlayers.get(socket.id);
    if(!p) return;
    const item=SHOP_ITEMS.find(i=>i.id===itemId);
    if(!item) return socket.emit("shopError","Unknown item.");
    if(p.upgrades.includes(itemId)) return socket.emit("shopError","Already owned.");
    if(item.requires&&!p.upgrades.includes(item.requires)) return socket.emit("shopError","Requires previous tier first.");
    if((p.coins||0)<item.cost) return socket.emit("shopError","Not enough coins.");
    p.coins-=item.cost; p.upgrades=[...p.upgrades,itemId];
    const oldMax=p.stats.maxHp;
    p.stats=statsFromUpgrades(p.upgrades,p.equipped,p.activeBuffs);
    if(p.stats.maxHp>oldMax) p.hp=Math.min(p.hp+(p.stats.maxHp-oldMax),p.stats.maxHp);
    setCoins(p.id,p.coins); saveUpgrades(p.id,p.upgrades); updatePlayerHP(p.id,p.hp);
    socket.emit("shopPurchased",{itemId,coins:p.coins,upgrades:p.upgrades,stats:p.stats,hp:p.hp});
    emitToMap(p.mapId,"playerStatUpdate",{id:p.id,hp:p.hp,maxHp:p.stats.maxHp,coins:p.coins});
  });

  socket.on("chat",({message})=>{
    const p=onlinePlayers.get(socket.id);
    if(!p||!message?.trim()) return;
    io.emit("chat",{name:p.name,color:p.color,message:message.trim().slice(0,120)});
  });

  socket.on("disconnect",()=>{
    const p=onlinePlayers.get(socket.id);
    if(p){
      updatePlayerPos(p.id,Math.floor(p.x),Math.floor(p.y),p.mapId); // persist final position
      emitToMap(p.mapId,"playerLeft",{id:p.id});
      onlinePlayers.delete(socket.id);
    }
  });
});

const PORT=process.env.PORT||3000;
initDB().then(()=>{
  spawnInitialMonsters();
  server.listen(PORT,()=>console.log(`MMO running → http://localhost:${PORT}`));
});
