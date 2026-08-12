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
    splash: { cost: 90, damage: 6,  range: 2.5, fireRate: 0.6,  color: '#22c55e', splash: true, splashRadius: 1.5, splashDamage: 6 },
    frost:  { cost: 70, damage: 5,  range: 3.0, fireRate: 0.8,  color: '#22d3ee', splash: false, slow: true, slowFactor: 0.4, slowDuration: 2.0 }
  };

  // ---------- Enemy / wave constants ----------
  const ENEMY_COLOR = '#fbbf24';
  const ENEMY_RADIUS = 12;
  const ENEMY_SPEED = 60;       // pixels per second
  const ENEMY_HP = 75;
  const KILL_REWARD = 8;        // base cash earned per kill
  const SPAWN_INTERVAL = 0.9;   // seconds between spawns
  const WAVE_ENEMY_COUNT = 6;   // base enemies per wave
  const HP_PER_WAVE = 0.15;     // +15% enemy HP per wave
  const COUNT_PER_WAVE = 2;     // +2 enemies per wave
  const MAX_DT = 0.05;          // clamp dt to avoid huge jumps on tab switch

  // Economy depth: earn interest on unspent cash each time a wave completes.
  const INTEREST_RATE = 0.05;   // +5% of unspent cash per wave cleared
  const INTEREST_CAP = 25;      // cap so hoarding can't snowball infinitely

  // Enemy type definitions.
  // normal: standard creep | scout: half HP, double speed | tank: high HP, slow | boss: very high HP.
  const ENEMY_TYPES = {
    normal: { hp: ENEMY_HP, speed: ENEMY_SPEED, radius: ENEMY_RADIUS, color: ENEMY_COLOR },
    scout:  { hp: ENEMY_HP * 0.5, speed: ENEMY_SPEED * 2, radius: ENEMY_RADIUS, color: '#22d3ee' },
    tank:   { hp: ENEMY_HP * 4,  speed: ENEMY_SPEED * 0.6, radius: 18, color: '#a16207' },
    boss:   { hp: ENEMY_HP * 15, speed: ENEMY_SPEED * 0.5, radius: 26, color: '#dc2626' }
  };

  // Kill rewards per enemy type (base KILL_REWARD is for normal creeps).
  const KILL_REWARD_BY_TYPE = {
    normal: 8,
    scout:  8,
    tank:   20,
    boss:   100
  };

  // Slow effect constants: applied by frost towers to creeps in range.
  const SLOW_FACTOR = 0.4;   // creeps move at 40% speed while slowed
  const SLOW_DURATION = 2.0; // seconds the slow lasts per application

  const ROWS = CONFIG.GRID_ROWS;
  const COLS = CONFIG.GRID_COLS;
  const TILE = CONFIG.TILE_SIZE;

  // ---------- Path layouts (path variety) ----------
  // Build a path cell list by walking cardinal steps from a start cell.
  // Each step is [dr, dc]; consecutive cells become path tiles.
  function buildPath(startRow, startCol, steps) {
    const cells = [{ row: startRow, col: startCol }];
    let r = startRow;
    let c = startCol;
    for (const [dr, dc] of steps) {
      r += dr;
      c += dc;
      cells.push({ row: r, col: c });
    }
    return cells;
  }

  // Layout A: straight vertical path down column 4 (the original map).
  const LAYOUT_A = buildPath(0, 4, [
    [1, 0], [1, 0], [1, 0], [1, 0], [1, 0],
    [1, 0], [1, 0], [1, 0], [1, 0]
  ]);

  // Layout B: an S-curve through the middle of the map for more interest.
  const LAYOUT_B = buildPath(0, 4, [
    // down col 4 to row 2
    [1, 0], [1, 0],
    // curve right to col 7
    [0, 1], [0, 1], [0, 1],
    // down col 7 to row 4
    [1, 0], [1, 0],
    // curve left to col 2
    [0, -1], [0, -1], [0, -1], [0, -1], [0, -1],
    // down col 2 to row 6
    [1, 0], [1, 0],
    // curve right to col 7
    [0, 1], [0, 1], [0, 1], [0, 1], [0, 1],
    // down col 7 to row 9
    [1, 0], [1, 0], [1, 0]
  ]);

  // Pick a layout: '?path=b' forces the S-curve, '?path=a' forces the
  // straight; otherwise choose one at random each load for variety.
  const forcedPath = new URLSearchParams(location.search).get('path');
  const chosenLayout = forcedPath === 'a' || forcedPath === 'b'
    ? forcedPath
    : (Math.random() < 0.5 ? 'a' : 'b');
  const PATH_CELLS = chosenLayout === 'b' ? LAYOUT_B : LAYOUT_A;

  // Pixel waypoints: center of each path tile, used for enemy movement.
  const WAYPOINTS = PATH_CELLS.map(function (c) {
    return { x: (c.col + 0.5) * TILE, y: (c.row + 0.5) * TILE };
  });

  // ---------- State ----------
  const state = {
    cash: CONFIG.STARTING_CASH,
    lives: CONFIG.STARTING_LIVES,
    wave: 0,
    gameOver: false,
    enemies: [],   // active creeps
    towers: [],    // active towers
    grid: new Array(ROWS * COLS).fill(0) // 0=empty, 1=path
  };

  // Mark path tiles (1 = path, cannot be built on).
  PATH_CELLS.forEach(function (c) {
    state.grid[c.row * COLS + c.col] = 1;
  });

  // Decorative blocked tiles (2 = blocked scenery, cannot be built on).
  // These are off the path and add a little map variety.
  const BLOCKED_CELLS = [
    { row: 0, col: 0 }, { row: 0, col: 2 }, { row: 1, col: 6 },
    { row: 2, col: 1 }, { row: 3, col: 7 }, { row: 5, col: 1 },
    { row: 6, col: 7 }, { row: 7, col: 2 }, { row: 8, col: 6 },
    { row: 9, col: 1 }
  ];
  BLOCKED_CELLS.forEach(function (c) {
    if (c.row < 0 || c.row >= ROWS || c.col < 0 || c.col >= COLS) return;
    if (state.grid[c.row * COLS + c.col] !== 0) return; // never overwrite path
    state.grid[c.row * COLS + c.col] = 2;
  });

  // Scripted wave presets. Each wave is an ordered list of enemy types that
  // spawn one at a time. Waves past the last preset fall back to a formula
  // (a growing mix of normals, scouts and tanks).
  const WAVE_PRESETS = {
    1: ['normal', 'normal', 'normal', 'normal', 'normal', 'normal'],
    2: ['normal', 'normal', 'scout', 'normal', 'normal', 'scout', 'normal', 'normal'],
    3: ['normal', 'normal', 'normal', 'normal', 'tank', 'normal', 'normal', 'scout', 'normal', 'normal'],
    4: ['normal', 'normal', 'scout', 'normal', 'normal', 'tank', 'scout', 'normal', 'normal', 'normal', 'scout', 'normal'],
    5: ['boss', 'tank', 'normal', 'scout', 'normal', 'tank', 'scout', 'normal', 'normal', 'tank', 'scout', 'normal', 'normal', 'scout'],
    6: ['normal', 'normal', 'scout', 'normal', 'tank', 'scout', 'normal', 'normal', 'tank', 'scout', 'normal', 'normal', 'scout', 'normal', 'tank', 'scout'],
    7: ['normal', 'tank', 'scout', 'normal', 'normal', 'scout', 'tank', 'normal', 'scout', 'normal', 'normal', 'tank', 'scout', 'normal', 'scout', 'normal', 'tank', 'scout'],
    8: ['normal', 'scout', 'tank', 'scout', 'normal', 'normal', 'tank', 'scout', 'normal', 'scout', 'tank', 'normal', 'scout', 'normal', 'normal', 'tank', 'scout', 'scout', 'normal', 'tank'],
    9: ['normal', 'tank', 'scout', 'tank', 'normal', 'scout', 'normal', 'tank', 'scout', 'normal', 'scout', 'tank', 'normal', 'tank', 'scout', 'normal', 'scout', 'tank', 'normal', 'scout', 'tank', 'scout'],
    10: ['boss', 'tank', 'tank', 'scout', 'normal', 'scout', 'tank', 'normal', 'scout', 'tank', 'scout', 'normal', 'tank', 'scout', 'normal', 'scout', 'tank', 'normal', 'scout', 'tank', 'scout', 'normal', 'tank', 'scout']
  };

  // Wave / spawn state: spawnQueue is now an array of enemy types still to spawn.
  let spawnQueue = [];   // enemy types still to spawn this wave
  let spawnTimer = 0;    // seconds until the next spawn
  let waveActive = false;
  let spawnedThisWave = 0; // how many enemies have spawned this wave

  // ---------- Timing ----------
  let lastTime = 0;

  // ---------- Helpers ----------
  function dist(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  const MAX_LEVEL = 3;
  const UPGRADE_COST_MULT = 0.6;   // each level costs 60% of the base cost
  const UPGRADE_DAMAGE_MULT = 1.25; // +25% damage per level
  const UPGRADE_RANGE_MULT = 1.1;  // +10% range per level
  const SELL_REFUND = 0.7;         // refund 70% of total invested on sell

  // Effective stats at a given tower level (level 1 = base stats).
  function towerDamage(def, level) {
    return def.damage * Math.pow(UPGRADE_DAMAGE_MULT, level - 1);
  }
  function towerRange(def, level) {
    return def.range * Math.pow(UPGRADE_RANGE_MULT, level - 1);
  }
  function upgradeCost(def, level) {
    return Math.floor(def.cost * UPGRADE_COST_MULT);
  }

  function emit(eventName, detail) {
    window.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
  }

  // Stop the game once lives reach 0: stop spawning and report. We do NOT
  // clear enemies here — the leak handler already removed the leaked creep,
  // and remaining enemies simply stop moving because tick() skips updates.
  function triggerGameOver() {
    if (state.gameOver) return;
    state.gameOver = true;
    waveActive = false;
    emit(GAME_EVENTS.GAME_OVER, { lives: state.lives, wave: state.wave });
  }

  // ---------- Enemy spawning ----------
  function spawnEnemy(type) {
    const def = ENEMY_TYPES[type] || ENEMY_TYPES.normal;
    const start = WAYPOINTS[0];
    // Enemies get tougher each wave: +HP_PER_WAVE per wave (wave 1 = base).
    const mult = 1 + (state.wave - 1) * HP_PER_WAVE;
    const hp = def.hp * mult;
    state.enemies.push({
      type: type,
      x: start.x,
      y: start.y,
      pathIndex: 1,             // heading to the next waypoint
      hp: hp,
      maxHp: hp,
      hpPercent: 100,
      speed: def.speed,
      radius: def.radius,
      color: def.color,
      slowTimer: 0              // seconds remaining of a slow effect
    });

    emit(GAME_EVENTS.ENEMY_SPAWNED, {
      type: type,
      x: start.x,
      y: start.y
    });

    if (type === 'boss') {
      emit(GAME_EVENTS.BOSS_SPAWNED, { wave: state.wave });
    }
  }

  function updateSpawns(dt) {
    if (!waveActive) return;
    if (spawnQueue.length === 0) {
      // Wave is complete when nothing is queued and no creeps remain.
      if (state.enemies.length === 0) {
        waveActive = false;
        // Economy depth: interest on unspent cash when a wave is cleared.
        // Skip the very first completion so the opening cash isn't taxed.
        if (state.wave > 0) {
          const interest = Math.floor(Math.min(state.cash * INTEREST_RATE, INTEREST_CAP));
          if (interest > 0) {
            state.cash += interest;
            dirty = true;
          }
        }
      }
      return;
    }
    spawnTimer -= dt;
    if (spawnTimer <= 0 && spawnQueue.length > 0) {
      const type = spawnQueue.shift();
      spawnEnemy(type);
      spawnedThisWave++;
      spawnTimer = SPAWN_INTERVAL;
      dirty = true;
    }
  }

  // ---------- Enemy movement ----------
  function updateEnemies(dt) {
    if (state.enemies.length > 0) dirty = true; // creeps move -> state changed
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      const target = WAYPOINTS[e.pathIndex];
      const dx = target.x - e.x;
      const dy = target.y - e.y;
      const d = Math.hypot(dx, dy);
      // A slowed creep moves at a fraction of its base speed.
      const effSpeed = e.slowTimer > 0 ? e.speed * SLOW_FACTOR : e.speed;
      const step = effSpeed * dt;
      if (e.slowTimer > 0) {
        e.slowTimer = Math.max(0, e.slowTimer - dt);
      }

      if (d <= step) {
        // Reached this waypoint — advance along the path.
        e.x = target.x;
        e.y = target.y;
        e.pathIndex++;
        if (e.pathIndex >= WAYPOINTS.length) {
          // Reached the end: leak a life and remove the creep.
          state.lives = Math.max(0, state.lives - 1);
          state.enemies.splice(i, 1);
          if (state.lives === 0) triggerGameOver();
          continue;
        }
      } else {
        e.x += (dx / d) * step;
        e.y += (dy / d) * step;
      }

      // Normalized heading for the renderer's facing indicator.
      e.vx = dx / d;
      e.vy = dy / d;

      e.hpPercent = (e.hp / e.maxHp) * 100;
    }
  }

  // ---------- Tower targeting & damage ----------
  function updateTowers(dt) {
    for (const t of state.towers) {
      const def = TOWERS[t.type];
      const dmg = towerDamage(def, t.level);
      const rng = towerRange(def, t.level);
      t.cooldown -= dt;
      if (t.cooldown > 0) continue;
      // A tower that is recharging has a visible cooldown -> state changed.
      dirty = true;

      const tx = (t.col + 0.5) * TILE;
      const ty = (t.row + 0.5) * TILE;
      const rangePx = rng * TILE;

      // Pick a target within range using this tower's targeting mode.
      const best = pickTarget(tx, ty, rangePx, t.targetMode);
      if (!best) continue;

      t.cooldown = 1 / def.fireRate;

      if (def.splash) {
        // AOE tower: damage every creep within the splash radius of the target.
        const splashPx = def.splashRadius * TILE;
        for (let i = state.enemies.length - 1; i >= 0; i--) {
          const e = state.enemies[i];
          if (dist(tx, ty, e.x, e.y) > rangePx) continue; // must be in main range
          const d = dist(best.x, best.y, e.x, e.y);
          const amount = d <= splashPx ? dmg : 0;
          if (amount <= 0) continue;

          e.hp -= amount;
          emit(GAME_EVENTS.ENEMY_DAMAGED, { x: e.x, y: e.y, amount: amount });

          if (e.hp <= 0) {
            state.enemies.splice(i, 1);
            state.cash += killReward(e.type);
          }
        }
      } else {
        // Single-target tower: damage only the primary target.
        best.hp -= dmg;
        emit(GAME_EVENTS.ENEMY_DAMAGED, { x: best.x, y: best.y, amount: dmg });

        // Frost towers also apply a slow effect to the target.
        if (def.slow) {
          best.slowTimer = SLOW_DURATION;
          best.slow = true; // hint for the renderer to tint the creep
        }

        if (best.hp <= 0) {
          const idx = state.enemies.indexOf(best);
          if (idx >= 0) state.enemies.splice(idx, 1);
          state.cash += killReward(best.type);
        }
      }
    }
  }

  // Select the primary target for a tower.
  // Modes: 'nearest' (closest), 'first' (furthest along path), 'strong' (highest hp).
  // Scouts are prioritized as a tiebreaker since they are fast & dangerous.
  function pickTarget(tx, ty, rangePx, mode) {
    let best = null;
    let bestScore = Infinity;
    let bestIsScout = false;

    for (const e of state.enemies) {
      const d = dist(tx, ty, e.x, e.y);
      if (d > rangePx) continue;

      const isScout = e.type === 'scout';
      let score;
      if (mode === 'first') {
        score = -e.pathIndex; // higher pathIndex = further along = preferred
      } else if (mode === 'strong') {
        score = -e.maxHp; // higher hp = preferred
      } else {
        score = d; // nearest
      }

      // Scout priority tiebreaker: a scout beats a non-scout with equal score.
      const better =
        best === null ||
        score < bestScore ||
        (score === bestScore && isScout && !bestIsScout);

      if (better) {
        best = e;
        bestScore = score;
        bestIsScout = isScout;
      }
    }

    return best;
  }

  // Cash reward scales slightly with wave so late waves stay rewarding.
  // Per-type bonuses make tanky/boss creeps worth more to kill.
  function killReward(type) {
    const base = KILL_REWARD_BY_TYPE[type] || KILL_REWARD;
    return base + Math.floor(state.wave * 0.5);
  }

  // ---------- Snapshot for the renderer ----------
  function snapshot() {
    return {
      cash: state.cash,
      lives: state.lives,
      wave: state.wave,
      gameOver: state.gameOver,
      nextWave: buildWaveQueue(state.wave + 1),
      towerTypes: {
        basic:  TOWERS.basic,
        sniper: TOWERS.sniper,
        cannon: TOWERS.cannon,
        splash: TOWERS.splash,
        frost:  TOWERS.frost
      },
      grid: state.grid,
      path: PATH_CELLS,
      towers: state.towers.map(function (t) {
        const def = TOWERS[t.type];
        return {
          row: t.row,
          col: t.col,
          type: t.type,
          range: t.range,
          level: t.level,
          targetMode: t.targetMode,
          cooldownFrac: Math.max(0, Math.min(1, t.cooldown * def.fireRate))
        };
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
          hpPercent: e.hpPercent,
          vx: e.vx || 0,
          vy: e.vy || 0,
          slow: e.slowTimer > 0
        };
      })
    };
  }

  // ---------- Game loop ----------
  let paused = false;
  let gameSpeed = 1;

  // Dirty flag: STATE_UPDATED is only emitted when something actually changed.
  // Handlers and the simulation set it; tick() clears it after emitting.
  let dirty = true;

  function tick(dt) {
    // Once the game is over, keep emitting state (frozen) so the renderer
    // can still paint, but no longer run simulation updates.
    if (state.gameOver) {
      dirty = true;
      emit(GAME_EVENTS.STATE_UPDATED, snapshot());
      dirty = false;
      return;
    }

    // Paused: emit state but don't advance the simulation.
    if (paused) {
      dirty = true;
      emit(GAME_EVENTS.STATE_UPDATED, snapshot());
      dirty = false;
      return;
    }

    const sdt = dt * gameSpeed;
    updateSpawns(sdt);
    updateEnemies(sdt);
    updateTowers(sdt);
    if (dirty) {
      emit(GAME_EVENTS.STATE_UPDATED, snapshot());
      dirty = false;
    }
  }

  function loop(ts) {
    let dt = 0;
    if (lastTime !== 0) dt = (ts - lastTime) / 1000;
    lastTime = ts;
    dt = Math.min(dt, MAX_DT);
    tick(dt);
    requestAnimationFrame(loop);
  }

  // Renderer dispatches TOGGLE_PAUSE with {} to flip pause.
  function onTogglePause() {
    paused = !paused;
    dirty = true;
  }

  // Renderer dispatches SET_SPEED with { speed } (e.g. 1, 2, 3).
  function onSetSpeed(evt) {
    const d = evt.detail;
    if (!d || typeof d.speed !== 'number') return;
    gameSpeed = Math.max(0.5, Math.min(4, d.speed));
    dirty = true;
  }

  // ---------- User intent handlers ----------
  // Renderer dispatches TOWER_PLACED with { row, col, type }.
  function onTowerPlaced(evt) {
    const d = evt.detail;
    if (!d) return;
    if (state.gameOver) return; // no building after game over
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
      level: 1,
      targetMode: 'nearest', // 'nearest' | 'first' | 'strong'
      cooldown: 0
    });
    dirty = true;
  }

  // Renderer dispatches UPGRADE_TOWER with { row, col }.
  function onUpgradeTower(evt) {
    const d = evt.detail;
    if (!d) return;
    if (state.gameOver) return;
    const t = state.towers.find(function (x) {
      return x.row === d.row && x.col === d.col;
    });
    if (!t) return;
    if (t.level >= MAX_LEVEL) return;

    const def = TOWERS[t.type];
    const cost = upgradeCost(def, t.level);
    if (state.cash < cost) return;

    state.cash -= cost;
    t.level++;
    t.range = towerRange(def, t.level);
    dirty = true;
  }

  // Renderer dispatches CHANGE_TARGET_MODE with { row, col }.
  function onChangeTargetMode(evt) {
    const d = evt.detail;
    if (!d) return;
    if (state.gameOver) return;
    const t = state.towers.find(function (x) {
      return x.row === d.row && x.col === d.col;
    });
    if (!t) return;

    const modes = ['nearest', 'first', 'strong'];
    const next = modes.indexOf(t.targetMode) + 1;
    t.targetMode = modes[next % modes.length];
    dirty = true;
  }

  // Renderer dispatches SELL_TOWER with { row, col }.
  function onSellTower(evt) {
    const d = evt.detail;
    if (!d) return;
    if (state.gameOver) return;
    const idx = state.towers.findIndex(function (x) {
      return x.row === d.row && x.col === d.col;
    });
    if (idx < 0) return;

    const t = state.towers[idx];
    const def = TOWERS[t.type];
    // Refund 70% of base cost plus 60% per upgrade level invested.
    let invested = def.cost;
    for (let lv = 1; lv < t.level; lv++) invested += upgradeCost(def, lv);
    state.cash += Math.floor(invested * SELL_REFUND);
    state.towers.splice(idx, 1);
    dirty = true;
  }

  // Renderer dispatches WAVE_STARTED with {} to begin a new wave.
  function onWaveStarted() {
    if (state.gameOver) return; // no waves after game over
    if (waveActive) return; // only one wave at a time
    state.wave++;
    spawnQueue = buildWaveQueue(state.wave);
    spawnTimer = 0;
    waveActive = true;
    spawnedThisWave = 0;
    dirty = true;
  }

  // Build the ordered list of enemy types for a wave. Uses the preset table
  // when defined; otherwise generates a growing formula-based mix.
  function buildWaveQueue(wave) {
    if (WAVE_PRESETS[wave]) return WAVE_PRESETS[wave].slice();
    // Fallback formula for waves past the last preset.
    const q = [];
    const count = WAVE_ENEMY_COUNT + (wave - 1) * COUNT_PER_WAVE;
    for (let i = 0; i < count; i++) {
      let type = 'normal';
      if (i === 0 && wave % 5 === 0) type = 'boss';
      else if (wave >= 3 && i === 1) type = 'tank';
      else if (wave >= 5 ? (i % 2 === 0) : (wave % 2 === 0 && i % 3 === 0)) type = 'scout';
      q.push(type);
    }
    return q;
  }

  // ---------- Restart: reset the whole game back to the opening state ----------
  function onRestart() {
    state.cash = CONFIG.STARTING_CASH;
    state.lives = CONFIG.STARTING_LIVES;
    state.wave = 0;
    state.gameOver = false;
    state.enemies = [];
    state.towers = [];

    // Rebuild the grid with fresh path + blocked tiles.
    state.grid = new Array(ROWS * COLS).fill(0);
    PATH_CELLS.forEach(function (c) {
      state.grid[c.row * COLS + c.col] = 1;
    });
    BLOCKED_CELLS.forEach(function (c) {
      if (c.row < 0 || c.row >= ROWS || c.col < 0 || c.col >= COLS) return;
      if (state.grid[c.row * COLS + c.col] !== 0) return;
      state.grid[c.row * COLS + c.col] = 2;
    });

    spawnQueue = [];
    spawnTimer = 0;
    waveActive = false;
    spawnedThisWave = 0;

    dirty = true;
  }

  // ---------- Wire up events ----------
  window.addEventListener(GAME_EVENTS.TOWER_PLACED, onTowerPlaced);
  window.addEventListener(GAME_EVENTS.WAVE_STARTED, onWaveStarted);
  window.addEventListener(GAME_EVENTS.UPGRADE_TOWER, onUpgradeTower);
  window.addEventListener(GAME_EVENTS.SELL_TOWER, onSellTower);
  window.addEventListener(GAME_EVENTS.CHANGE_TARGET_MODE, onChangeTargetMode);
  window.addEventListener(GAME_EVENTS.TOGGLE_PAUSE, onTogglePause);
  window.addEventListener(GAME_EVENTS.SET_SPEED, onSetSpeed);
  window.addEventListener(GAME_EVENTS.RESTART, onRestart);

  // ---------- Start the logic loop ----------
  requestAnimationFrame(loop);
})();
