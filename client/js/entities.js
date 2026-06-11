"use strict";
/* ════════════════════════════════════════════════════════════════════
   entities.js — particles and entity rendering.

   Performance contract:
   • A player's name card is rendered to a texture ONCE per (name, color)
     — never re-uploaded when HP changes.
   • HP bars are tinted, scaled quads sharing one 2×2 white texture.
   • Monster bodies share one cached texture per emoji; damage flash is a
     scale pulse, not a texture redraw.
   • Entities beyond the fog distance are hidden and skip all updates.
   • Sprites keep depthTest ON (depthWrite off), so walls occlude them.
   ════════════════════════════════════════════════════════════════════ */

/* ── Particles: one Points cloud, fixed buffer, zero allocations/frame ── */
const MAX_PARTICLES = 256;
const partGeo = new THREE.BufferGeometry();
partGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
partGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
const partPoints = new THREE.Points(partGeo,
  new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
partPoints.frustumCulled = false;
if (webglOK) scene.add(partPoints);
const _pc = new THREE.Color();

/* burst/sparkle take CENTRE coordinates (floats), matching entity space. */
function burst(cx, cy, color, count = 10, speed = 3) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, v = (0.4 + Math.random() * 0.6) * speed * 0.18;
    particles.push({ x: cx, z: cy, h: 0.5, vx: Math.cos(a) * v, vz: Math.sin(a) * v, vh: 0.8 + Math.random() * 1.2, life: 1, decay: 1.8 + Math.random() * 1.2, color });
    if (particles.length > MAX_PARTICLES) particles.shift();
  }
}
function sparkle(cx, cy, color) {
  for (let i = 0; i < 6; i++) {
    particles.push({ x: cx + (Math.random() - 0.5) * 0.4, z: cy + (Math.random() - 0.5) * 0.4, h: 0.3, vx: (Math.random() - 0.5) * 0.3, vz: (Math.random() - 0.5) * 0.3, vh: 1.2 + Math.random(), life: 1, decay: 1.4, color });
    if (particles.length > MAX_PARTICLES) particles.shift();
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.z += p.vz * dt; p.h += p.vh * dt; p.vh -= 2.4 * dt;
    p.life -= p.decay * dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  const pos = partGeo.attributes.position.array, colA = partGeo.attributes.color.array;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (i < particles.length) {
      const p = particles[i];
      pos[i * 3] = p.x; pos[i * 3 + 1] = Math.max(0.02, p.h); pos[i * 3 + 2] = p.z;
      _pc.set(p.color).multiplyScalar(Math.max(0, p.life));
      colA[i * 3] = _pc.r; colA[i * 3 + 1] = _pc.g; colA[i * 3 + 2] = _pc.b;
    } else { pos[i * 3 + 1] = -99; }
  }
  partGeo.attributes.position.needsUpdate = true;
  partGeo.attributes.color.needsUpdate = true;
  partGeo.setDrawRange(0, Math.max(1, particles.length));
}

/* ── Player billboard: static card + dynamic cheap HP bar ── */
function drawNameCard(c, name, color, isSelf) {
  const g = c.getContext("2d"); g.clearRect(0, 0, c.width, c.height);
  g.font = "bold 19px 'Segoe UI',system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
  const label = isSelf ? `★ ${name}` : name;
  const tw = g.measureText(label).width;
  g.fillStyle = "rgba(8,12,24,0.75)";
  g.beginPath(); g.roundRect(70 - tw / 2 - 7, 4, tw + 14, 24, 7); g.fill();
  g.fillStyle = isSelf ? "#fff" : color; g.fillText(label, 70, 17);
  // body
  g.fillStyle = color; g.beginPath(); g.arc(70, 96, 46, 0, Math.PI * 2); g.fill();
  g.lineWidth = 4; g.strokeStyle = "rgba(0,0,0,0.35)"; g.stroke();
  g.fillStyle = "#fff"; g.beginPath(); g.arc(57, 88, 9, 0, Math.PI * 2); g.arc(83, 88, 9, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#1a2233"; g.beginPath(); g.arc(58, 89, 4.5, 0, Math.PI * 2); g.arc(84, 89, 4.5, 0, Math.PI * 2); g.fill();
}

function makePlayerGroup(p) {
  const group = new THREE.Group();
  const c = document.createElement("canvas"); c.width = 140; c.height = 150;
  drawNameCard(c, p.name, p.color, false);
  const tex = new THREE.CanvasTexture(c);
  const body = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  body.scale.set(0.85, 0.91, 1); body.position.y = 0.06;
  const hpBar = makeBarSprite(); hpBar.position.y = 0.62;
  group.add(body, hpBar);
  return { obj: group, body, hpBar, tex, cardKey: `${p.name}|${p.color}`, hpKey: "" };
}

function updatePlayerVisual(rec, p, hp, mhp, dead) {
  const cardKey = `${p.name}|${p.color}`;
  if (cardKey !== rec.cardKey) { // rare: rename/recolor only
    rec.cardKey = cardKey;
    drawNameCard(rec.tex.image, p.name, p.color, false);
    rec.tex.needsUpdate = true;
  }
  const ratio = Math.max(0, hp / mhp);
  const hpKey = `${ratio.toFixed(2)}|${dead ? 1 : 0}`;
  if (hpKey !== rec.hpKey) { // cheap: scale + color, no texture work
    rec.hpKey = hpKey;
    rec.hpBar.visible = !dead;
    rec.hpBar.scale.x = Math.max(0.04, 0.55 * ratio);
    rec.hpBar.material.color.setHex(hpColor(ratio));
    rec.body.material.opacity = dead ? 0.3 : 1;
  }
}

/* ── Monster billboard: shared emoji texture + HP bar + flash pulse ── */
function makeMonsterGroup(m) {
  const group = new THREE.Group();
  const body = makeEmojiSprite(m.emoji, 0.8); body.position.y = 0;
  const hpBar = makeBarSprite(0.6, 0.07); hpBar.position.y = 0.55;
  group.add(body, hpBar);
  return { obj: group, body, hpBar, hpKey: "" };
}

function updateMonsterVisual(rec, m) {
  const ratio = Math.max(0, m.hp / m.maxHp);
  const hpKey = ratio.toFixed(2);
  if (hpKey !== rec.hpKey) {
    rec.hpKey = hpKey;
    rec.hpBar.scale.x = Math.max(0.04, 0.6 * ratio);
    rec.hpBar.material.color.setHex(hpColor(ratio));
  }
  const pulse = m.flash > 0 ? 1 + m.flash * 1.6 : 1; // damage flash = scale pulse
  rec.body.scale.set(0.8 * pulse, 0.8 * pulse, 1);
}

/* ── Entity registry ── */
function getEnt(key, createFn) {
  let rec = entObjs.get(key);
  if (!rec) { rec = createFn(); entGroup.add(rec.obj); entObjs.set(key, rec); }
  rec.seen = true; return rec;
}
function reapEnts() {
  entObjs.forEach((rec, key) => {
    if (!rec.seen) {
      entGroup.remove(rec.obj);
      rec.obj.traverse(o => {
        if (o.geometry && o.geometry !== projGeoShared) o.geometry.dispose();
        if (o.material) o.material.dispose(); // textures: per-player tex below
      });
      if (rec.tex) rec.tex.dispose();
      entObjs.delete(key);
    } else rec.seen = false;
  });
}
function clearAllEnts() { entObjs.forEach(r => { r.seen = false; }); reapEnts(); }

const projGeoShared = new THREE.SphereGeometry(0.09, 8, 8);
function dist2ToCam(x, y) { const dx = x - predX, dy = y - predY; return dx * dx + dy * dy; }

function syncEntities(t) {
  // Players (self is the camera — never rendered)
  Object.values(allPlayers).forEach(p => {
    if (p.id === selfPlayer.id) return;
    const rec = getEnt("pl_" + p.id, () => makePlayerGroup(p));
    const far = dist2ToCam(p.dx_, p.dy_) > cullDist2;
    rec.obj.visible = !far;
    if (far) return;
    updatePlayerVisual(rec, p, p.hp ?? selfMaxHp, p.maxHp ?? selfMaxHp, p.dead);
    const bob = Math.sin(t * 2.2 + (p.bounce || 0)) * 0.02;
    rec.obj.position.set(p.dx_, 0.5 + (p.dh_ || 0) + bob, p.dy_);
  });
  // Monsters
  Object.values(monsters).forEach(m => {
    const rec = getEnt("mo_" + m.id, () => makeMonsterGroup(m));
    const far = dist2ToCam(m.dx_, m.dy_) > cullDist2;
    rec.obj.visible = !far;
    if (far) return;
    updateMonsterVisual(rec, m);
    const bob = Math.sin(t * 3 + (m.bounce || 0)) * 0.04;
    rec.obj.position.set(m.dx_, 0.5 + bob, m.dy_);
  });
  // Coins / items: tile-anchored ints, rendered at tile centres
  Object.values(floorCoins).forEach(c => {
    const rec = getEnt("co_" + c.id, () => ({ obj: makeEmojiSprite("🪙", 0.4) }));
    rec.obj.position.set(c.x + 0.5, 0.3 + Math.sin(t * 4 + c.x + c.y) * 0.06, c.y + 0.5);
  });
  Object.values(floorItems).forEach(item => {
    const rec = getEnt("it_" + item.uid, () => ({ obj: makeEmojiSprite(item.emoji, 0.5) }));
    rec.obj.position.set(item.x + 0.5, 0.3 + Math.sin(t * 3 + item.x * 1.3 + item.y) * 0.05, item.y + 0.5);
  });
  // Projectiles
  const projColor = currentMapId === "dungeon" ? 0xc4b5fd : 0xfde68a;
  Object.values(projectiles).forEach(p => {
    const rec = getEnt("pr_" + p.id, () => {
      const mesh = new THREE.Mesh(projGeoShared, new THREE.MeshBasicMaterial({ color: projColor }));
      mesh.add(new THREE.PointLight(projColor, 0.7, 2.5));
      return { obj: mesh };
    });
    rec.obj.position.set(p.dx_, 0.5, p.dy_);
  });
  reapEnts();
}
