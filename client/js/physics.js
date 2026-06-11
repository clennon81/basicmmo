/* ════════════════════════════════════════════════════════════════════
   Shared physics — loaded by BOTH the server (require) and the client
   (script tag). Single source of truth for tiles, collision, movement
   constants, and raycasting. Positions are continuous floats where
   (x=2.5, y=3.5) is the centre of tile (2,3).
   ════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.Physics = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const T = {
    GRASS: 0, WATER: 1, TREE: 2, SAND: 3, MOUNTAIN: 4, STONE: 5, LAVA: 6,
    DUNGEON_WALL: 7, DUNGEON_FLOOR: 8, DOOR_DOWN: 9, DOOR_UP: 10, COBBLE: 11,
    BUILDING: 12, DOOR_CITY: 13, DOOR_OVERWORLD: 14, FOUNTAIN: 15,
    TRADE_POST: 16, NOTICE_BOARD: 17, ROAD: 18,
  };

  // Tall solid geometry: blocks walking, projectiles, and line of sight.
  const WALL_TILES = new Set([T.TREE, T.MOUNTAIN, T.BUILDING, T.DUNGEON_WALL, T.STONE]);
  // Ground hazards: block walking but projectiles fly over them.
  const HAZARD_TILES = new Set([T.WATER, T.LAVA]);
  // Tiles players may stand on.
  const WALKABLE = new Set([
    T.GRASS, T.SAND, T.DUNGEON_FLOOR, T.DOOR_DOWN, T.DOOR_UP, T.COBBLE,
    T.ROAD, T.DOOR_CITY, T.DOOR_OVERWORLD, T.TRADE_POST, T.NOTICE_BOARD,
  ]);
  // Monsters avoid doors so they don't zone-hop.
  const MONSTER_WALKABLE = new Set([...WALKABLE].filter(
    t => t !== T.DOOR_DOWN && t !== T.DOOR_UP && t !== T.DOOR_CITY && t !== T.DOOR_OVERWORLD));
  const DOOR_TILES = new Set([T.DOOR_DOWN, T.DOOR_UP, T.DOOR_CITY, T.DOOR_OVERWORLD]);

  const C = {
    TICK_HZ: 30,            // server physics rate
    SNAPSHOT_HZ: 15,        // server → client state rate
    INPUT_HZ: 12,           // client → server input heartbeat
    BASE_SPEED: 4.2,        // tiles/sec at the baseline 150ms moveDelay stat
    MAX_SPEED: 9,
    MIN_SPEED: 1.2,
    PLAYER_RADIUS: 0.28,
    MONSTER_RADIUS: 0.32,
    HIT_RADIUS: 0.5,        // projectile-vs-entity hit distance
    MELEE_RADIUS: 0.85,     // monster touch-attack distance
    PICKUP_RADIUS: 0.55,
    PROJ_SPEED: 9,          // tiles/sec
    PROJ_STEP: 0.15,        // raymarch substep, tiles (< 2*HIT_RADIUS, no tunnelling)
    GRAVITY: 20,            // jump physics, tiles/s^2
    JUMP_VELOCITY: 6.2,
    EYE_HEIGHT: 0.55,
    KNOCKBACK: 1.1,         // tiles
  };

  function speedFromMoveDelay(moveDelay) {
    const s = C.BASE_SPEED * (150 / (moveDelay || 150));
    return Math.max(C.MIN_SPEED, Math.min(C.MAX_SPEED, s));
  }

  function tileAt(tiles, cols, rows, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return -1;
    return tiles[ty][tx];
  }

  /* Is the circle of radius r centred at (x,y) free of blocked tiles?
     `walkable` is a Set of allowed tile ids. */
  function circleFree(tiles, cols, rows, x, y, r, walkable) {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
    const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const t = tileAt(tiles, cols, rows, tx, ty);
      if (t === -1 || !walkable.has(t)) {
        // precise circle-vs-tile-AABB test (corners shouldn't snag)
        const cx = Math.max(tx, Math.min(x, tx + 1));
        const cy = Math.max(ty, Math.min(y, ty + 1));
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy < r * r) return false;
      }
    }
    return true;
  }

  /* Move a circle with axis-separated sliding. Returns the new {x, y}. */
  function moveCircle(tiles, cols, rows, x, y, dx, dy, r, walkable) {
    let nx = x + dx;
    if (!circleFree(tiles, cols, rows, nx, y, r, walkable)) nx = x;
    let ny = y + dy;
    if (!circleFree(tiles, cols, rows, nx, ny, r, walkable)) ny = y;
    return { x: nx, y: ny };
  }

  /* DDA raycast against WALL_TILES. Returns distance to the first wall,
     or Infinity if none within maxDist. */
  function raycastWall(tiles, cols, rows, x, y, dx, dy, maxDist) {
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return Infinity;
    dx /= len; dy /= len;
    let tx = Math.floor(x), ty = Math.floor(y);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    const tdx = Math.abs(1 / (dx || 1e-9)), tdy = Math.abs(1 / (dy || 1e-9));
    let maxX = (dx > 0 ? (tx + 1 - x) : (x - tx)) * tdx;
    let maxY = (dy > 0 ? (ty + 1 - y) : (y - ty)) * tdy;
    let dist = 0;
    for (let i = 0; i < 4 * (cols + rows); i++) {
      if (maxX < maxY) { dist = maxX; maxX += tdx; tx += stepX; }
      else { dist = maxY; maxY += tdy; ty += stepY; }
      if (dist > maxDist) return Infinity;
      const t = tileAt(tiles, cols, rows, tx, ty);
      if (t === -1 || WALL_TILES.has(t)) return dist;
    }
    return Infinity;
  }

  /* Camera yaw (three.js YXZ order) → ground-plane unit vectors. */
  function yawForward(yaw) { return { x: -Math.sin(yaw), y: -Math.cos(yaw) }; }
  function yawRight(yaw)   { const f = yawForward(yaw); return { x: -f.y, y: f.x }; }

  /* Build a wish-direction from input flags relative to yaw (unit or zero). */
  function wishDir(input) {
    const f = yawForward(input.yaw || 0), r = yawRight(input.yaw || 0);
    let dx = f.x * ((input.f ? 1 : 0) - (input.b ? 1 : 0)) + r.x * ((input.r ? 1 : 0) - (input.l ? 1 : 0));
    let dy = f.y * ((input.f ? 1 : 0) - (input.b ? 1 : 0)) + r.y * ((input.r ? 1 : 0) - (input.l ? 1 : 0));
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) { dx /= len; dy /= len; }
    return { x: dx, y: dy };
  }

  /* One physics step for a player-like body. Mutates nothing; returns
     {x, y, h, vh}. `input` = {f,b,l,r,yaw,jump}. */
  function stepBody(tiles, cols, rows, body, input, speed, dt) {
    const w = wishDir(input);
    const moved = moveCircle(tiles, cols, rows, body.x, body.y,
      w.x * speed * dt, w.y * speed * dt, C.PLAYER_RADIUS, WALKABLE);
    let h = body.h || 0, vh = body.vh || 0;
    if (input.jump && h <= 0) vh = C.JUMP_VELOCITY;
    if (h > 0 || vh > 0) { h += vh * dt; vh -= C.GRAVITY * dt; if (h <= 0) { h = 0; vh = 0; } }
    return { x: moved.x, y: moved.y, h, vh };
  }

  return {
    T, WALL_TILES, HAZARD_TILES, WALKABLE, MONSTER_WALKABLE, DOOR_TILES, C,
    speedFromMoveDelay, tileAt, circleFree, moveCircle, raycastWall,
    yawForward, yawRight, wishDir, stepBody,
  };
});
