"use strict";
/* ════════════════════════════════════════════════════════════════════
   core.js — configuration, shared state, and the Three.js bootstrap.
   Loaded after physics.js + sound.js; everything else builds on this.
   All positions are continuous floats (tile centre = x.5) matching the
   server's convention in shared physics.
   ════════════════════════════════════════════════════════════════════ */

/* ── Config (single sources of truth live in Physics) ── */
const T = Physics.T;
const PC = Physics.C;
const WALL_TILES = Physics.WALL_TILES;
const LIQUID_TILES = Physics.HAZARD_TILES;
const RARITY_COLORS = { common: "#6b7280", uncommon: "#3b82f6", rare: "#a855f7" };
const MOUSE_SENSITIVITY = 0.0022;
const PITCH_LIMIT = 1.45;
const ENTITY_LERP_RATE = 12;       // how fast remote entities ease to snapshots
const RECONCILE_RATE = 6;          // how fast our prediction eases to the server
const RECONCILE_SNAP_DIST = 2.5;   // beyond this, snap instead of easing

/* ── Game state ── */
let socket = null, selfPlayer = null, selfMaxHp = 10;
let allPlayers = {}, mapData = null, mapCols = 0, mapRows = 0, currentMapId = "overworld";
let monsters = {}, floorCoins = {}, floorItems = {}, projectiles = {};
let selfCoins = 0, selfHp = 10, selfUpgrades = [], selfStats = { maxHp: 10, moveDelay: 150, fireDelay: 0, blockChance: 0, projDamage: 1 };
let selfInventory = [], selfEquipped = {}, selfActiveBuffs = [];
let isDead = false, shopOpen = false, invOpen = false, charOpen = false, tradeOpen = false, boardOpen = false;
let shopItems = [], selectedInvUid = null, tradePickedUids = new Set();
let lastFireTime = 0, respawnInterval = null, nearDoor = false;
let particles = [], shake = { mag: 0, decay: 0.88 }, gameTime = 0;
let currentListings = [];

/* Prediction state: where WE think we are vs the server's last word. */
let predX = 0, predY = 0, predH = 0, predVH = 0;
let serverX = 0, serverY = 0;
let inputState = { f: false, b: false, l: false, r: false, yaw: 0, jump: false };

/* ── DOM ── */
const $ = id => document.getElementById(id);
const canvas = $("gameCanvas");
const canvasWrap = $("canvasWrap");
const minimap = $("minimap"), mctx = minimap.getContext("2d");

/* ── Three.js bootstrap (with a graceful WebGL failure path) ── */
let renderer = null, scene = null, camera = null;
let ambLight = null, dirLight = null, mapGroup = null, entGroup = null;
let webglOK = false;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, 1, 0.05, 120);
  camera.rotation.order = "YXZ";
  ambLight = new THREE.AmbientLight(0xffffff, 0.7);
  dirLight = new THREE.DirectionalLight(0xffffff, 0.55);
  dirLight.position.set(1, 2, 0.6);
  scene.add(ambLight, dirLight);
  mapGroup = new THREE.Group(); scene.add(mapGroup);   // rebuilt per map
  entGroup = new THREE.Group(); scene.add(entGroup);   // dynamic entities
  webglOK = true;
} catch (e) {
  console.error("WebGL init failed:", e);
  document.addEventListener("DOMContentLoaded", () => {
    const err = $("loginError");
    if (err) err.textContent = "Your browser/GPU doesn't support WebGL — the 3D client can't run.";
    const btn = $("loginBtn"); if (btn) btn.disabled = true;
  });
}

let yaw = Math.PI, pitch = 0, pointerLocked = false;

const entObjs = new Map();   // key -> { obj, ...per-entity render cache }
let cullDist2 = 70 * 70;     // squared draw distance, set per map from fog

/* ── Tile palette ── */
const TILE_COLOR = {
  [T.GRASS]: 0x467e3e, [T.WATER]: 0x2563ab, [T.TREE]: 0x2c5523, [T.SAND]: 0xcfab60,
  [T.MOUNTAIN]: 0x6e7a8a, [T.STONE]: 0x56606e, [T.LAVA]: 0xd2451a, [T.DUNGEON_WALL]: 0x241f2b,
  [T.DUNGEON_FLOOR]: 0x322e36, [T.DOOR_DOWN]: 0x467e3e, [T.DOOR_UP]: 0x322e36,
  [T.COBBLE]: 0x5a5550, [T.BUILDING]: 0x3d2f1a, [T.DOOR_CITY]: 0x467e3e, [T.DOOR_OVERWORLD]: 0x5a5550,
  [T.FOUNTAIN]: 0x4a5568, [T.TRADE_POST]: 0x6b4f1d, [T.NOTICE_BOARD]: 0x3d2f1a, [T.ROAD]: 0x6b6258,
};

/* ── Shared texture caches (never re-uploaded per entity) ── */
const emojiTexCache = new Map();
function emojiTexture(emoji, px = 96) {
  if (emojiTexCache.has(emoji)) return emojiTexCache.get(emoji);
  const c = document.createElement("canvas"); c.width = c.height = px;
  const g = c.getContext("2d"); g.font = `${px - 14}px serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.shadowColor = "rgba(0,0,0,0.5)"; g.shadowBlur = 6; g.fillText(emoji, px / 2, px / 2 + 4);
  const tex = new THREE.CanvasTexture(c); emojiTexCache.set(emoji, tex); return tex;
}
function makeEmojiSprite(emoji, scale = 0.7) {
  const m = new THREE.SpriteMaterial({ map: emojiTexture(emoji), transparent: true, depthWrite: false });
  const s = new THREE.Sprite(m); s.scale.set(scale, scale, 1); return s;
}
/* 1×1 white texture: HP bars are just tinted, scaled sprites — changing
   an HP bar costs a scale + color write, never a texture upload. */
const whiteTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 2;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 2, 2);
  return new THREE.CanvasTexture(c);
})();
function makeBarSprite(w = 0.55, h = 0.07) {
  const m = new THREE.SpriteMaterial({ map: whiteTex, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(m); s.scale.set(w, h, 1); return s;
}
function hpColor(ratio) { return ratio > 0.5 ? 0x34d399 : ratio > 0.25 ? 0xfbbf24 : 0xfb7185; }

/* ── Interpolation helpers (remote entities ease toward snapshots) ── */
function initED(e) { e.dx_ = e.x; e.dy_ = e.y; e.dh_ = e.h || 0; e.bounce = Math.random() * Math.PI * 2; }
function setET(e, x, y, h) { if (e.dx_ === undefined) initED(e); e.x = x; e.y = y; if (h !== undefined) e.h = h; }
function lerpE(e, dt) {
  if (e.dx_ === undefined) initED(e);
  const k = Math.min(1, ENTITY_LERP_RATE * dt);
  e.dx_ += (e.x - e.dx_) * k; e.dy_ += (e.y - e.dy_) * k;
  e.dh_ = (e.dh_ || 0) + ((e.h || 0) - (e.dh_ || 0)) * k;
  if (Math.abs(e.x - e.dx_) < 0.005) e.dx_ = e.x;
  if (Math.abs(e.y - e.dy_) < 0.005) e.dy_ = e.y;
}
