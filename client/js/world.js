"use strict";
/* ════════════════════════════════════════════════════════════════════
   world.js — builds the 3D scene for a map (instanced floors/walls,
   billboard markers, lights, fog) and renders the cached minimap.
   ════════════════════════════════════════════════════════════════════ */

const MAP_ENV = {
  overworld: { bg: 0x87b8e8, fog: [0x87b8e8, 18, 70], amb: 0.75, dir: 0.6 },
  city:      { bg: 0x2b2114, fog: [0x2b2114, 14, 55], amb: 0.65, dir: 0.45 },
  dungeon:   { bg: 0x070509, fog: [0x070509, 4, 22],  amb: 0.35, dir: 0.12 },
};
const WALL_HEIGHT = 1.3;
const MAX_MAP_LIGHTS = 60; // hard cap so lava fields can't tank the GPU

function tileRand(x, y) { const s = Math.sin(x * 374761.7 + y * 668265.3) * 43758.5453; return s - Math.floor(s); }

function disposeGroup(group) {
  group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach(m => m.dispose()); // shared textures stay cached; materials go
    }
  });
  while (group.children.length) group.remove(group.children[0]);
}

function loadMap(mapId, map, mc, mr) {
  currentMapId = mapId; mapData = map; mapCols = mc; mapRows = mr;
  canvasWrap.className = mapId;
  const ml = $("mapLabel"); ml.className = mapId;
  ml.textContent = mapId === "overworld" ? "🌿 Overworld" : mapId === "dungeon" ? "🕯 Dungeon" : "🏙 City";
  miniBase = null;
  if (webglOK) buildScene3D(mapId);
}

function buildScene3D(mapId) {
  try {
    disposeGroup(mapGroup);
    const env = MAP_ENV[mapId] || MAP_ENV.overworld;
    scene.background = new THREE.Color(env.bg);
    scene.fog = new THREE.Fog(env.fog[0], env.fog[1], env.fog[2]);
    cullDist2 = (env.fog[2] + 4) * (env.fog[2] + 4);
    ambLight.intensity = env.amb; dirLight.intensity = env.dir;

    let nFloor = 0, nWall = 0;
    for (let y = 0; y < mapRows; y++) for (let x = 0; x < mapCols; x++) {
      WALL_TILES.has(mapData[y][x]) ? nWall++ : nFloor++;
    }
    const floorMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, nFloor));
    const wallMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, WALL_HEIGHT, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, nWall));
    const dummy = new THREE.Object3D(); const col = new THREE.Color();
    const shade = (hex, x, y) => { const r = tileRand(x, y) * 0.16 + 0.92; col.setHex(hex).multiplyScalar(r); return col; };

    let fi = 0, wi = 0, lights = 0;
    for (let y = 0; y < mapRows; y++) for (let x = 0; x < mapCols; x++) {
      const t = mapData[y][x]; const hex = TILE_COLOR[t] ?? 0x444444;
      if (WALL_TILES.has(t)) {
        dummy.position.set(x + 0.5, WALL_HEIGHT / 2, y + 0.5); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
        wallMesh.setMatrixAt(wi, dummy.matrix); wallMesh.setColorAt(wi, shade(hex, x, y)); wi++;
      } else {
        const liquid = LIQUID_TILES.has(t);
        dummy.position.set(x + 0.5, liquid ? -0.07 : 0, y + 0.5); dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.updateMatrix();
        floorMesh.setMatrixAt(fi, dummy.matrix); floorMesh.setColorAt(fi, shade(hex, x, y)); fi++;
      }
    }
    floorMesh.instanceMatrix.needsUpdate = true; if (floorMesh.instanceColor) floorMesh.instanceColor.needsUpdate = true;
    wallMesh.instanceMatrix.needsUpdate = true; if (wallMesh.instanceColor) wallMesh.instanceColor.needsUpdate = true;
    mapGroup.add(floorMesh, wallMesh);

    // Special tile markers
    for (let y = 0; y < mapRows; y++) for (let x = 0; x < mapCols; x++) {
      const t = mapData[y][x]; let emoji = null, h = 0.65, sc = 0.8;
      if (Physics.DOOR_TILES.has(t)) { emoji = "🚪"; h = 0.7; sc = 1.0; }
      else if (t === T.TRADE_POST)   { emoji = "🤝"; h = 0.85; sc = 1.0; }
      else if (t === T.NOTICE_BOARD) { emoji = "📋"; h = 0.85; sc = 0.9; }
      else if (t === T.FOUNTAIN)     { emoji = "⛲"; h = 0.8;  sc = 1.0; }
      else if (t === T.LAVA && lights < MAX_MAP_LIGHTS) {
        const glow = new THREE.PointLight(0xff5a1a, 0.7, 3.5);
        glow.position.set(x + 0.5, 0.4, y + 0.5); mapGroup.add(glow); lights++;
        continue;
      }
      if (emoji) {
        const s = makeEmojiSprite(emoji, sc); s.position.set(x + 0.5, h, y + 0.5); mapGroup.add(s);
        if (emoji === "🚪" && lights < MAX_MAP_LIGHTS) {
          const pl = new THREE.PointLight(0xfcd34d, 0.8, 4); pl.position.set(x + 0.5, 0.8, y + 0.5);
          mapGroup.add(pl); lights++;
        }
        if (emoji === "🤝" || emoji === "📋") {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.16), new THREE.MeshLambertMaterial({ color: 0x5d4327 }));
          post.position.set(x + 0.5, 0.35, y + 0.5); mapGroup.add(post);
        }
      }
    }
  } catch (e) {
    console.error("buildScene3D failed:", e);
    addSystemMsg("⚠ Failed to build the 3D scene — try refreshing.");
  }
}

function resizeCanvas() {
  if (!webglOK) return;
  const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener("resize", resizeCanvas);

/* ── Minimap (tile layer cached per map; only dots redraw per frame) ── */
const MINI_COLOR = {}; Object.keys(TILE_COLOR).forEach(k => MINI_COLOR[k] = "#" + TILE_COLOR[k].toString(16).padStart(6, "0"));
let miniBase = null, miniScale = 1;

function buildMinimapBase() {
  const W = minimap.width, H = minimap.height;
  miniScale = Math.min(W / mapCols, H / mapRows);
  miniBase = document.createElement("canvas"); miniBase.width = W; miniBase.height = H;
  const g = miniBase.getContext("2d");
  for (let y = 0; y < mapRows; y++) for (let x = 0; x < mapCols; x++) {
    g.fillStyle = MINI_COLOR[mapData[y][x]] || "#444";
    g.fillRect(x * miniScale, y * miniScale, miniScale + 0.5, miniScale + 0.5);
  }
}

const _miniDir = new THREE.Vector3();
function renderMinimap() {
  if (!mapData) return;
  if (!miniBase) buildMinimapBase();
  const s = miniScale;
  mctx.clearRect(0, 0, minimap.width, minimap.height);
  mctx.drawImage(miniBase, 0, 0);
  mctx.fillStyle = "#fb7185";
  Object.values(monsters).forEach(m => { mctx.beginPath(); mctx.arc(m.dx_ * s, m.dy_ * s, 2, 0, Math.PI * 2); mctx.fill(); });
  Object.values(allPlayers).forEach(p => {
    if (p.id === selfPlayer.id) return;
    mctx.fillStyle = p.color; mctx.beginPath(); mctx.arc(p.dx_ * s, p.dy_ * s, 2.4, 0, Math.PI * 2); mctx.fill();
  });
  const mx = predX * s, my = predY * s;
  camera.getWorldDirection(_miniDir);
  mctx.strokeStyle = "#fff"; mctx.lineWidth = 1.6;
  mctx.beginPath(); mctx.moveTo(mx, my); mctx.lineTo(mx + _miniDir.x * 9, my + _miniDir.z * 9); mctx.stroke();
  mctx.fillStyle = "#fff"; mctx.beginPath(); mctx.arc(mx, my, 3, 0, Math.PI * 2); mctx.fill();
}
