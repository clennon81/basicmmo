"use strict";
/* ════════════════════════════════════════════════════════════════════
   render.js — the frame loop.

   Movement model: the client predicts its own motion every frame with
   the SAME Physics.stepBody the server runs, then eases toward the
   server's authoritative position from the latest snapshot. Small
   errors blend invisibly; large divergence (teleports, knockback,
   lag spikes) snaps.
   ════════════════════════════════════════════════════════════════════ */

const _dirV = new THREE.Vector3();

function predictSelf(dt) {
  if (!mapData || isDead) return;
  // Local prediction with the shared physics — identical to the server.
  const next = Physics.stepBody(mapData, mapCols, mapRows,
    { x: predX, y: predY, h: predH, vh: predVH },
    { ...inputState, yaw }, Physics.speedFromMoveDelay(selfStats.moveDelay), dt);
  predX = next.x; predY = next.y; predH = next.h; predVH = next.vh;
  inputState.jump = false; // one-shot locally too

  // Reconcile toward the server's last word.
  const ex = serverX - predX, ey = serverY - predY;
  const err = Math.hypot(ex, ey);
  if (err > RECONCILE_SNAP_DIST) { predX = serverX; predY = serverY; }
  else if (err > 0.01) {
    const k = Math.min(1, RECONCILE_RATE * dt);
    predX += ex * k; predY += ey * k;
  }
  selfPlayer.x = predX; selfPlayer.y = predY;
}

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now; gameTime += dt;
  if (webglOK && mapData && selfPlayer) {
    try {
      predictSelf(dt);
      Object.values(allPlayers).forEach(p => { if (p.id !== selfPlayer.id) lerpE(p, dt); });
      Object.values(monsters).forEach(m => { lerpE(m, dt); if (m.flash > 0) m.flash -= dt; });
      Object.values(projectiles).forEach(p => { p.dx_ += (p.x - p.dx_) * Math.min(1, 20 * dt); p.dy_ += (p.y - p.dy_) * Math.min(1, 20 * dt); });
      updateParticles(dt); shake.mag *= Math.pow(shake.decay, dt * 60);
      syncEntities(gameTime);

      camera.position.set(predX, PC.EYE_HEIGHT + predH, predY);
      if (shake.mag > 0.3) {
        camera.position.x += (Math.random() - 0.5) * shake.mag * 0.01;
        camera.position.y += (Math.random() - 0.5) * shake.mag * 0.01;
      }
      camera.rotation.set(pitch, yaw, 0);
      renderer.render(scene, camera);
      renderMinimap();
      checkNearDoor();
    } catch (e) {
      console.error("frame error:", e); // never let one bad frame kill the loop
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* Centre-coordinate world → screen projection (for floating text). */
function worldToScreen(cx, cy, h = 0.9) {
  _dirV.set(cx, h, cy).project(camera);
  if (_dirV.z > 1) return null;
  return { x: (_dirV.x * 0.5 + 0.5) * canvasWrap.clientWidth, y: (-_dirV.y * 0.5 + 0.5) * canvasWrap.clientHeight };
}

function showFloatNum(cx, cy, text, color) {
  if (!mapData) return;
  const pt = worldToScreen(cx, cy, 0.95); if (!pt) return;
  const el = document.createElement("div"); el.className = "floatNum"; el.textContent = text; el.style.color = color || "#fff";
  el.style.left = pt.x + "px"; el.style.top = pt.y + "px";
  canvasWrap.appendChild(el); setTimeout(() => el.remove(), 1000);
}

/* ── Door proximity hint ── */
function checkNearDoor() {
  if (!mapData) return;
  let near = false, msg = "";
  const px = Math.floor(predX), py = Math.floor(predY);
  for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
    const tt = Physics.tileAt(mapData, mapCols, mapRows, px + dx, py + dy);
    if (Physics.DOOR_TILES.has(tt)) {
      near = true;
      msg = tt === T.DOOR_DOWN ? "🚪 Enter Dungeon" : tt === T.DOOR_UP ? "🚪 Return to Overworld"
          : tt === T.DOOR_CITY ? "🏙 Enter City" : "🌿 Leave City";
      break;
    }
  }
  if (near !== nearDoor) { nearDoor = near; const dh = $("doorHint"); dh.textContent = msg; dh.classList.toggle("show", near); }
}
