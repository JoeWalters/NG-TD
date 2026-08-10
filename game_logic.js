// game_logic.js - Computer A: Logic & State Systems Developer
// Manages game state, grid data, pathfinding, enemy spawning, tower targeting,
// damage calculations, cash, and wave timers. Never touches the DOM or canvas.

(function () {
  'use strict';

  // ---------- Tower type definitions ----------
  // range is expressed in tiles (renderer converts to px when <= 20).
  // splash towers deal area damage: splashRadius in tiles, splashDamage per hit.
  const TOWERS = {
    basic:  { cost: 50, damage: 10, range: 2.5, fireRate: 1.0,  color: '#38bdf8', splash: false },
    sniper: { cost: 80, damage: 25, range: 5.0, fireRate: 0.5,  color: '#a78bfa', splash: false },
    cannon: { cost: 60, damage: 20, range: 3.0, fireRate: 0.75, color: '#f87171', splash: false },
    splash: { cost: 90, damage: 6,  range: 2.5, fireRate: 0.6,  color: '#22c55e', splash: true, splashRadius: 1.5, splashDamage: 6 }
  };

  // ---------- Enemy / wave constants ----------
  const ENEMY_COLOR = '#fbbf24';
  const ENEMY_RADIUS = 12;
  const ENEMY_SPEED = 60;       // pixels per second
  const ENEMY_HP = 100;
  const KILL_REWARD = 5;        // cash earned per kill
  const SPAWN_INTERVAL = 0.9;   // seconds between spawns
  const WAVE_ENEMY_COUNT = 6;   // enemies per wave
  const MAX_DT = 0.05;          // clamp dt to avoid huge jumps on tab switch

  // Enemy type definitions. scout: half health, double speed, distinct color.
  const ENEMY_TYPES = {
    normal: { hp: ENEMY_HP, speed: ENEMY_SPEED, radius: ENEMY_RADIUS, color: ENEMY_COLOR },
    scout:  { hp: ENEMY_HP * 0.5, speed: ENEMY_SPEED * 2, radius: ENEMY_RADIUS, color: '#22d3ee' }
  };

  const ROWS = CONFIG.GRID_ROWS;
  const COLS = CONFIG.GRID_COLS;
  const TILE = CONFIG.TILE_SIZE;

  // ---------- Hardcoded path: start (0,4) -> end (9,4) ----------
  const PATH_CELLS = [];
  for (let r = 0; r < ROWS; r++) PATH_CELLS.push({ row: r, col: 4 });

  // Pixel waypoints: center of each path tile, used for enemy movement.
  const WAYPOINTS = PATH_CELLS.map(function (c) {
    return { x: (c.col + 0.5) * TILE, y: (c.row + 0.5) * TILE };
  });

  // ---------- State ----------
  const state = {
    cash: CONFIG.STARTING_CASH,
    lives: CONFIG.STARTING_LIVES,
    wave: 0,
    enemies: [],   // active creeps
    towers: [],    // active towers
    grid: new Array(ROWS * COLS).fill(0) // 0=empty, 1=path
  };

  // Mark path tiles (1 = path, cannot be built on).
  PATH_CELLS.forEach(function (c) {
    state.grid[c.row * COLS + c.col] = 1;
  });

  // ---------- Wave / spawn state ----------
  let spawnQueue = 0;    // enemies still to spawn this wave
  let spawnTimer = 0;    // seconds until the next spawn
  let waveActive = false;

  // ---------- Timing ----------
  let lastTime = 0;

  // ---------- Helpers ----------
  function dist(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function emit(eventName, detail) {
    window.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
  }

  // ---------- Enemy spawning ----------
  function spawnEnemy(type) {
    const def = ENEMY_TYPES[type] || ENEMY_TYPES.normal;
    const start = WAYPOINTS[0];
    state.enemies.push({
      type: type,
      x: start.x,
      y: start.y,
      pathIndex: 1,             // heading to the next waypoint
      hp: def.hp,
      maxHp: def.hp,
      hpPercent: 100,
      speed: def.speed,
      radius: def.radius,
      color: def.color
    });

    emit(GAME_EVENTS.ENEMY_SPAWNED, {
      type: type,
      x: start.x,
      y: start.y
    });
  }

  function updateSpawns(dt) {
    if (!waveActive) return;
    if (spawnQueue <= 0) {
      // Wave is complete when nothing is queued and no creeps remain.
      if (state.enemies.length === 0) waveActive = false;
      return;
    }
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      // Alternate scout creeps into the mix every few spawns.
      const type = (state.wave % 2 === 0 && spawnQueue % 3 === 0) ? 'scout' : 'normal';
      spawnEnemy(type);
      spawnQueue--;
      spawnTimer = SPAWN_INTERVAL;
    }
  }

  // ---------- Enemy movement ----------
  function updateEnemies(dt) {
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      const target = WAYPOINTS[e.pathIndex];
      const dx = target.x - e.x;
      const dy = target.y - e.y;
      const d = Math.hypot(dx, dy);
      const step = e.speed * dt;

      if (d <= step) {
        // Reached this waypoint — advance along the path.
        e.x = target.x;
        e.y = target.y;
        e.pathIndex++;
        if (e.pathIndex >= WAYPOINTS.length) {
          // Reached the end: leak a life and remove the creep.
          state.lives = Math.max(0, state.lives - 1);
          state.enemies.splice(i, 1);
          continue;
        }
      } else {
        e.x += (dx / d) * step;
        e.y += (dy / d) * step;
      }

      e.hpPercent = (e.hp / e.maxHp) * 100;
    }
  }

  // ---------- Tower targeting & damage ----------
  function updateTowers(dt) {
    for (const t of state.towers) {
      const def = TOWERS[t.type];
      t.cooldown -= dt;
      if (t.cooldown > 0) continue;

      const tx = (t.col + 0.5) * TILE;
      const ty = (t.row + 0.5) * TILE;
      const rangePx = def.range * TILE;

      // Find the nearest enemy within range (primary target).
      let best = null;
      let bestD = Infinity;
      for (const e of state.enemies) {
        const d = dist(tx, ty, e.x, e.y);
        if (d <= rangePx && d < bestD) {
          bestD = d;
          best = e;
        }
      }
      if (!best) continue;

      t.cooldown = 1 / def.fireRate;

      if (def.splash) {
        // AOE tower: damage every creep within the splash radius of the target.
        const splashPx = def.splashRadius * TILE;
        for (let i = state.enemies.length - 1; i >= 0; i--) {
          const e = state.enemies[i];
          if (dist(tx, ty, e.x, e.y) > rangePx) continue; // must be in main range
          const d = dist(best.x, best.y, e.x, e.y);
          const amount = d <= splashPx ? def.splashDamage : 0;
          if (amount <= 0) continue;

          e.hp -= amount;
          emit(GAME_EVENTS.ENEMY_DAMAGED, { x: e.x, y: e.y, amount: amount });

          if (e.hp <= 0) {
            state.enemies.splice(i, 1);
            state.cash += KILL_REWARD;
          }
        }
      } else {
        // Single-target tower: damage only the primary target.
        best.hp -= def.damage;
        emit(GAME_EVENTS.ENEMY_DAMAGED, { x: best.x, y: best.y, amount: def.damage });

        if (best.hp <= 0) {
          const idx = state.enemies.indexOf(best);
          if (idx >= 0) state.enemies.splice(idx, 1);
          state.cash += KILL_REWARD;
        }
      }
    }
  }

  // ---------- Snapshot for the renderer ----------
  function snapshot() {
    return {
      cash: state.cash,
      lives: state.lives,
      wave: state.wave,
      grid: state.grid,
      path: PATH_CELLS,
      towers: state.towers.map(function (t) {
        return { row: t.row, col: t.col, type: t.type, range: t.range };
      }),
      enemies: state.enemies.map(function (e) {
        return {
          type: e.type,
          x: e.x,
          y: e.y,
          radius: e.radius,
          color: e.color,
          hp: e.hp,
          maxHp: e.maxHp,
          hpPercent: e.hpPercent
        };
      })
    };
  }

  // ---------- Game loop ----------
  function tick(dt) {
    updateSpawns(dt);
    updateEnemies(dt);
    updateTowers(dt);
    emit(GAME_EVENTS.STATE_UPDATED, snapshot());
  }

  function loop(ts) {
    let dt = 0;
    if (lastTime !== 0) dt = (ts - lastTime) / 1000;
    lastTime = ts;
    dt = Math.min(dt, MAX_DT);
    tick(dt);
    requestAnimationFrame(loop);
  }

  // ---------- User intent handlers ----------
  // Renderer dispatches TOWER_PLACED with { row, col, type }.
  function onTowerPlaced(evt) {
    const d = evt.detail;
    if (!d) return;
    const { row, col, type } = d;
    const def = TOWERS[type];
    if (!def) return;

    // Validate the tile: in bounds, not a path tile, not already occupied.
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return;
    if (state.grid[row * COLS + col] !== 0) return;
    if (state.towers.some(function (t) { return t.row === row && t.col === col; })) return;
    if (state.cash < def.cost) return;

    // Deduct cash and spawn the tower.
    state.cash -= def.cost;
    state.towers.push({
      row: row,
      col: col,
      type: type,
      range: def.range,
      cooldown: 0
    });
  }

  // Renderer dispatches WAVE_STARTED with {} to begin a new wave.
  function onWaveStarted() {
    if (waveActive) return; // only one wave at a time
    state.wave++;
    spawnQueue = WAVE_ENEMY_COUNT;
    spawnTimer = 0;
    waveActive = true;
  }

  // ---------- Wire up events ----------
  window.addEventListener(GAME_EVENTS.TOWER_PLACED, onTowerPlaced);
  window.addEventListener(GAME_EVENTS.WAVE_STARTED, onWaveStarted);

  // ---------- Start the logic loop ----------
  requestAnimationFrame(loop);
})();
