// game_logic.js - Computer A: Logic & State Systems Developer
// Manages game state, grid data, pathfinding, enemy spawning, tower targeting,
// damage calculations, cash, and wave timers. Never touches the DOM or canvas.

(function () {
  'use strict';

  // ---------- Tower type definitions ----------
  // range is expressed in tiles (renderer converts to px when <= 20).
  // splash towers deal area damage: splashRadius in tiles, splashDamage per hit.
  const TOWERS = {
    basic:  { cost: 50, damage: 10, range: 2.5, fireRate: 1.0,  color: '#38bdf8', splash: false, attack: true },
    sniper: { cost: 80, damage: 25, range: 5.0, fireRate: 0.5,  color: '#a78bfa', splash: false, attack: true },
    cannon: { cost: 60, damage: 20, range: 3.0, fireRate: 0.75, color: '#f87171', splash: false, attack: true },
    splash: { cost: 90, damage: 6,  range: 2.5, fireRate: 0.6,  color: '#22c55e', splash: true, splashRadius: 1.5, splashDamage: 6, attack: true },
    frost:  { cost: 70, damage: 5,  range: 3.0, fireRate: 0.8,  color: '#22d3ee', splash: false, slow: true, slowFactor: 0.4, slowDuration: 2.0, attack: true },
    // Utility towers don't attack; each has a passive field effect.
    // Bounty: pays bonus cash for every creep killed inside its range.
    bounty:  { cost: 100, damage: 0, range: 2.5, fireRate: 0, color: '#f97316', splash: false, attack: false, bounty: true, bountyBonus: 6 },
    // Buff: a radius aura that boosts the damage of nearby towers.
    buff:    { cost: 110, damage: 0, range: 2.0, fireRate: 0, color: '#facc15', splash: false, attack: false, buff: true, buffDamageMult: 1.4 },
    // Magnet: gently pulls creeps inside its radius toward it, dragging them
    // off the lane so other towers get an easier shot.
    magnet:  { cost: 120, damage: 0, range: 2.5, fireRate: 0, color: '#e879f9', splash: false, attack: false, magnet: true, pullSpeed: 26 },
    // Redirect: teleports creeps that enter its inner zone a few waypoints
    // BACKWARD, making them re-walk that stretch so nearby towers get more shots.
    redirect:{ cost: 130, damage: 0, range: 1.2, fireRate: 0, color: '#34d399', splash: false, attack: false, redirect: true, redirectSkip: CONFIG.BALANCE.REDIRECT_SKIP, redirectCooldown: CONFIG.BALANCE.REDIRECT_COOLDOWN, redirectMax: CONFIG.BALANCE.REDIRECT_MAX }
  };

  // ---------- Enemy / wave constants ----------
  // All balance tunables live in CONFIG.BALANCE (single source of truth);
  // these aliases just make the rest of this module read naturally.
  const ENEMY_COLOR = '#fbbf24';
  const ENEMY_RADIUS = CONFIG.BALANCE.ENEMY_RADIUS;
  const ENEMY_SPEED = CONFIG.BALANCE.ENEMY_SPEED;   // pixels per second
  const ENEMY_HP = CONFIG.BALANCE.ENEMY_HP;
  const KILL_REWARD = CONFIG.BALANCE.KILL_REWARD;   // base cash earned per kill
  const SPAWN_INTERVAL = CONFIG.BALANCE.SPAWN_INTERVAL; // seconds between spawns
  const WAVE_ENEMY_COUNT = CONFIG.BALANCE.WAVE_ENEMY_COUNT; // base enemies per wave
  const HP_PER_WAVE = CONFIG.BALANCE.HP_PER_WAVE;   // +15% enemy HP per wave
  const COUNT_PER_WAVE = CONFIG.BALANCE.COUNT_PER_WAVE; // +2 enemies per wave
  const MAX_DT = CONFIG.BALANCE.MAX_DT;             // clamp dt on tab switch

  // Redirect tower tuning (single source of truth, see CONFIG.BALANCE).
  const REDIRECT_COOLDOWN = CONFIG.BALANCE.REDIRECT_COOLDOWN; // per-creep min gap
  const REDIRECT_MAX = CONFIG.BALANCE.REDIRECT_MAX;           // max redirects per creep
  const REDIRECT_SKIP = CONFIG.BALANCE.REDIRECT_SKIP;         // waypoints set back

  // Clearing this wave wins the game (a concrete goal instead of endless waves).
  const VICTORY_WAVE = CONFIG.BALANCE.VICTORY_WAVE;

  // Economy depth: earn interest on unspent cash each time a wave completes.
  const INTEREST_RATE = CONFIG.BALANCE.INTEREST_RATE; // +5% of unspent cash per wave
  const INTEREST_CAP = CONFIG.BALANCE.INTEREST_CAP;   // cap so hoarding can't snowball

  // Enemy type definitions.
  // normal: standard creep | scout: half HP, double speed | tank: high HP, slow | boss: very high HP.
  // shielded: armored creep — resists single-target shots unless splash/pierce | regener: heals over time.
  const ENEMY_TYPES = {
    normal:   { hp: ENEMY_HP, speed: ENEMY_SPEED, radius: ENEMY_RADIUS, color: ENEMY_COLOR },
    scout:    { hp: ENEMY_HP * 0.5, speed: ENEMY_SPEED * 2, radius: ENEMY_RADIUS, color: '#22d3ee' },
    tank:     { hp: ENEMY_HP * 4,  speed: ENEMY_SPEED * 0.6, radius: 18, color: '#a16207' },
    boss:     { hp: ENEMY_HP * CONFIG.BALANCE.BOSS_HP_MULT, speed: ENEMY_SPEED * 0.5, radius: 26, color: '#dc2626' },
    shielded: { hp: ENEMY_HP * 1.6, speed: ENEMY_SPEED * 0.85, radius: ENEMY_RADIUS, color: '#94a3b8', shield: true, shieldResist: 0.4 },
    regener:  { hp: ENEMY_HP * 1.3, speed: ENEMY_SPEED, radius: ENEMY_RADIUS, color: '#4ade80', regen: true, regenRate: 3 }
  };

  // Kill rewards per enemy type (base KILL_REWARD is for normal creeps).
  const KILL_REWARD_BY_TYPE = {
    normal: 8,
    scout:  8,
    tank:   20,
    boss:   100,
    shielded: 16,
    regener:  14
  };

  // Slow effect constants: applied by frost towers to creeps in range.
  const SLOW_FACTOR = 0.4;   // creeps move at 40% speed while slowed
  const SLOW_DURATION = 2.0; // seconds the slow lasts per application

  // Frost/splash combo: a splash tower deals bonus damage to creeps that are
  // currently frosted (slowed), rewarding players who pair the two towers.
  const FROST_SPLASH_BONUS = 1.5; // multiplier applied to splash hits on frosted creeps

  const ROWS = CONFIG.GRID_ROWS;
  const COLS = CONFIG.GRID_COLS;
  const TILE = CONFIG.TILE_SIZE;

  // ---------- Path system ----------
  // The player can design their own maze path before the first wave: clicking
  // empty tiles chains them into a connected path from the top entry edge to
  // the bottom exit edge. This is the game's unique "NG" hook — you shape the
  // battlefield yourself. A default S-curve layout exists as a fallback so the
  // map is always playable, but the designed path replaces it when committed.
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

  // Default S-curve layout (fallback when the player hasn't drawn a path).
  const LAYOUT_B = buildPath(0, 4, [
    [1, 0], [1, 0],
    [0, 1], [0, 1], [0, 1],
    [1, 0], [1, 0],
    [0, -1], [0, -1], [0, -1], [0, -1], [0, -1],
    [1, 0], [1, 0],
    [0, 1], [0, 1], [0, 1], [0, 1], [0, 1],
    [1, 0], [1, 0], [1, 0]
  ]);

  // Path-design state. A drawn path is a simple chain of cardinally-adjacent
  // cells. It must start on the top edge (row 0) and end on the bottom edge
  // (row ROWS-1). Until one is committed, the default layout is used.
  const DEFAULT_PATH_CELLS = LAYOUT_B;

  // Currently committed path cells + pixel waypoints (rebuilt on commit).
  let PATH_CELLS = DEFAULT_PATH_CELLS.slice();
  let WAYPOINTS = PATH_CELLS.map(function (c) {
    return { x: (c.col + 0.5) * TILE, y: (c.row + 0.5) * TILE };
  });

  // Player-drawn path: ordered list of cells as clicked/dragged in the design
  // overlay. null means the player hasn't drawn anything yet.
  let drawnPath = null;
  // True once the player's drawn path has been validated and committed.
  let pathCommitted = false;

  // Rebuild the grid + waypoints from the current PATH_CELLS.
  function rebuildPath() {
    const g = state.grid;
    // Clear old path marks (1) so a redesigned path can reuse the cells.
    for (let i = 0; i < g.length; i++) {
      if (g[i] === 1) g[i] = 0;
    }
    PATH_CELLS.forEach(function (c) {
      g[c.row * COLS + c.col] = 1;
    });
    WAYPOINTS = PATH_CELLS.map(function (c) {
      return { x: (c.col + 0.5) * TILE, y: (c.row + 0.5) * TILE };
    });
  }

  // Validate a drawn path: must be non-empty, a simple chain of cardinal
  // steps, start on row 0 and end on row ROWS-1. Returns true if valid.
  function validateDrawnPath(cells) {
    if (!cells || cells.length < 2) return false;
    const first = cells[0];
    const last = cells[cells.length - 1];
    if (first.row !== 0) return false;          // must enter at the top edge
    if (last.row !== ROWS - 1) return false;    // must exit at the bottom edge
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1];
      const b = cells[i];
      const dr = Math.abs(b.row - a.row);
      const dc = Math.abs(b.col - a.col);
      // Only a single cardinal step between consecutive cells.
      if (dr + dc !== 1) return false;
    }
    // No repeats allowed (a loop would let creeps double back).
    const seen = new Set();
    for (const c of cells) {
      const key = c.row * COLS + c.col;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  }

  // Commit a drawn path: validate it and rebuild the grid + waypoints.
  // Falls back to the default layout if the drawn path is invalid.
  function commitDrawnPath(cells) {
    if (!validateDrawnPath(cells)) {
      drawnPath = null;
      pathCommitted = false;
      PATH_CELLS = DEFAULT_PATH_CELLS.slice();
      rebuildPath();
      emit('td:path_status', { ok: false, reason: 'invalid' });
      return false;
    }
    PATH_CELLS = cells.slice();
    rebuildPath();
    drawnPath = cells.slice();
    pathCommitted = true;
    emit('td:path_status', { ok: true });
    return true;
  }

  // ---------- State ----------
  let enemySeq = 0; // stable per-creep id (renderer uses it to detect deaths)
  const state = {
    cash: CONFIG.STARTING_CASH,
    lives: CONFIG.STARTING_LIVES,
    wave: 0,
    kills: 0,      // total creeps defeated
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
    4: ['normal', 'normal', 'scout', 'shielded', 'normal', 'tank', 'scout', 'shielded', 'normal', 'normal', 'scout', 'normal'],
    5: ['boss', 'tank', 'normal', 'scout', 'normal', 'tank', 'scout', 'normal', 'normal', 'tank', 'scout', 'normal', 'normal', 'scout'],
    6: ['normal', 'shielded', 'scout', 'normal', 'regener', 'scout', 'normal', 'shielded', 'tank', 'scout', 'normal', 'normal', 'scout', 'regener', 'tank', 'scout'],
    7: ['normal', 'tank', 'scout', 'normal', 'normal', 'scout', 'tank', 'normal', 'scout', 'normal', 'normal', 'tank', 'scout', 'normal', 'scout', 'normal', 'tank', 'scout'],
    8: ['shielded', 'scout', 'tank', 'shielded', 'normal', 'regener', 'tank', 'scout', 'normal', 'scout', 'regener', 'tank', 'scout', 'shielded', 'normal', 'tank', 'scout', 'scout', 'regener', 'tank'],
    9: ['normal', 'tank', 'scout', 'tank', 'normal', 'scout', 'normal', 'tank', 'scout', 'normal', 'scout', 'tank', 'normal', 'tank', 'scout', 'normal', 'scout', 'tank', 'normal', 'scout', 'tank', 'scout'],
    10: ['boss', 'tank', 'tank', 'scout', 'normal', 'scout', 'tank', 'normal', 'scout', 'tank', 'scout', 'normal', 'tank', 'scout', 'normal', 'scout', 'tank', 'normal', 'scout', 'tank', 'scout', 'normal', 'tank', 'scout']
  };

  // Flavor names for each wave, so each "pack" has a distinct identity that is
  // telegraphed in the Next-wave HUD before the wave begins. Waves past the
  // table fall back to a generated "Wave N" style label.
  const WAVE_NAMES = {
    1: 'First Contact',
    2: 'Scout Rush',
    3: 'Tank Thud',
    4: 'Mixed Company',
    5: 'The Boss Arrives',
    6: 'Iron March',
    7: 'Vanguard Swarm',
    8: 'Heavy Hitters',
    9: 'Rampage',
    10: 'Titan Siege'
  };
  function waveNameFor(wave) {
    return WAVE_NAMES[wave] || 'Wave ' + wave;
  }

  // Wave / spawn state: spawnQueue is now an array of enemy types still to spawn.
  let spawnQueue = [];   // enemy types still to spawn this wave
  let spawnTimer = 0;    // seconds until the next spawn
  let waveActive = false;
  let spawnedThisWave = 0; // how many enemies have spawned this wave
  // Boss-choice modifier: id of the chosen modifier for the next boss wave,
  // or null when none has been picked yet.
  let bossModifier = null;

  // Boss-choice modifiers offered before a boss wave. Each option tweaks the
  // upcoming boss encounter in a distinct way.
  const BOSS_MODIFIERS = [
    { id: 'cash',   label: 'Extra Cash',   desc: '+$60 now to spend on defenses.', cashBonus: 60 },
    { id: 'frail',  label: 'Frail Boss',   desc: 'The boss has 60% HP this wave.', hpMult: 0.6, rewardMult: 1 },
    { id: 'bounty', label: 'Risky Bounty', desc: 'The boss has 200% HP but pays double.', hpMult: 2.0, rewardMult: 2 }
  ];


  // ---------- Timing ----------
  let lastTime = 0;

  // ---------- Helpers ----------
  function dist(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  const MAX_LEVEL = CONFIG.BALANCE.MAX_LEVEL;
  // Upgrading a tower from level L costs 60%^L of its base cost, so each
  // level is cheaper than the last (L1 = 60%, L2 = 36% of base). This is
  // the same formula the renderer's HUD shows, so the two never drift.
  const UPGRADE_COST_MULT = CONFIG.BALANCE.UPGRADE_COST_MULT;
  const UPGRADE_DAMAGE_MULT = CONFIG.BALANCE.UPGRADE_DAMAGE_MULT; // +25% damage per level
  const UPGRADE_RANGE_MULT = CONFIG.BALANCE.UPGRADE_RANGE_MULT;   // +10% range per level
  const SELL_REFUND = CONFIG.BALANCE.SELL_REFUND;   // refund 70% of total invested

  // Effective stats at a given tower level (level 1 = base stats).
  function towerDamage(def, level) {
    return def.damage * Math.pow(UPGRADE_DAMAGE_MULT, level - 1);
  }
  function towerRange(def, level) {
    return def.range * Math.pow(UPGRADE_RANGE_MULT, level - 1);
  }
  // Cost to upgrade a tower currently at `level` to the next level.
  // Higher levels are cheaper per upgrade (60%^level of base cost).
  function upgradeCost(def, level) {
    return Math.floor(def.cost * Math.pow(UPGRADE_COST_MULT, level));
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
    emit(GAME_EVENTS.GAME_OVER, { lives: state.lives, wave: state.wave, kills: state.kills });
  }

  // ---------- Enemy spawning ----------
  function spawnEnemy(type, opts) {
    const def = ENEMY_TYPES[type] || ENEMY_TYPES.normal;
    const start = WAYPOINTS[0];
    // Enemies get tougher each wave: +HP_PER_WAVE per wave (wave 1 = base).
    const mult = 1 + (state.wave - 1) * HP_PER_WAVE;
    // Boss modifiers may scale this enemy's HP (hpMult) and reward (rewardMult).
    const hpMult = opts && opts.hpMult != null ? opts.hpMult : 1;
    const rewardMult = opts && opts.rewardMult != null ? opts.rewardMult : 1;
    const hp = def.hp * mult * hpMult;
    state.enemies.push({
      id: ++enemySeq,           // stable id (renderer detects disappearances)
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
      slowTimer: 0,             // seconds remaining of a slow effect
      shield: !!def.shield,     // armored — resists single-target shots
      shieldResist: def.shieldResist != null ? def.shieldResist : 0.4,
      regen: !!def.regen,       // heals over time unless recently damaged
      regenRate: def.regenRate != null ? def.regenRate : 3,
      regenTimer: 0,            // seconds a hit suppresses regen (0 = healing)
      rewardMult: rewardMult    // extra cash multiplier on kill
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

        // Victory: clearing the final wave ends the game on a high note.
        if (state.wave === VICTORY_WAVE) {
          emit(GAME_EVENTS.VICTORY, { wave: state.wave, kills: state.kills });
          return;
        }
        // Economy depth: interest on unspent cash when a wave is cleared.
        // Skip the very first completion (wave 1) so the opening cash isn't
        // taxed; interest starts applying from the wave-2 clear onward.
        let interest = 0;
        if (state.wave > 1) {
          interest = Math.floor(Math.min(state.cash * INTEREST_RATE, INTEREST_CAP));
          if (interest > 0) {
            state.cash += interest;
            dirty = true;
          }
        }
        // Tell the renderer how much the wave clear earned (income toast).
        emit(GAME_EVENTS.WAVE_CLEARED, { wave: state.wave, interest: interest });
      }
      return;
    }
    spawnTimer -= dt;
    if (spawnTimer <= 0 && spawnQueue.length > 0) {
      const entry = spawnQueue.shift();
      // Queue entries may be a type string or a {type, hpMult, rewardMult} object.
      const type = typeof entry === 'string' ? entry : entry.type;
      const opts = typeof entry === 'object' ? entry : null;
      spawnEnemy(type, opts);
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
      // Regenerating creeps heal over time unless recently damaged. Healing
      // only matters if they are hurt, so skip at full HP.
      if (e.regen && e.hp < e.maxHp) {
        if (e.regenTimer > 0) {
          e.regenTimer = Math.max(0, e.regenTimer - dt);
        } else {
          const healed = e.regenRate * dt;
          e.hp = Math.min(e.maxHp, e.hp + healed);
          dirty = true;
        }
      }
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
      // Redirect cooldown ticks down regardless of whether any redirect tower
      // is in range, so a creep can eventually pass the zone.
      if (e.redirectTimer > 0) {
        e.redirectTimer = Math.max(0, e.redirectTimer - dt);
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
  // Compute a tower's effective damage: base damage at its level, multiplied
  // by any buff auras from nearby buff towers.
  function effectiveDamage(t) {
    const def = TOWERS[t.type];
    let dmg = towerDamage(def, t.level);
    const tx = (t.col + 0.5) * TILE;
    const ty = (t.row + 0.5) * TILE;
    for (const b of state.towers) {
      const bdef = TOWERS[b.type];
      if (!bdef || !bdef.buff) continue;
      const brng = towerRange(bdef, b.level) * TILE;
      if (dist(tx, ty, (b.col + 0.5) * TILE, (b.row + 0.5) * TILE) <= brng) {
        dmg *= bdef.buffDamageMult;
      }
    }
    return dmg;
  }

  // Grant a bounty tower its bonus cash when a creep dies inside its range.
  // Armor resistance: a shielded creep shrugs off part of any single-target
  // hit (unless the tower is splash/pierce, which bypasses the shield).
  // `isSplash` marks an AOE/piercing attack that ignores shield resistance.
  function damageToEnemy(e, baseDmg, isSplash) {
    if (e.shield && !isSplash) {
      const def = ENEMY_TYPES[e.type];
      const resist = def && def.shieldResist != null ? def.shieldResist : 0.4;
      return baseDmg * resist;
    }
    return baseDmg;
  }

  // A regenerating creep stops healing for a short window after taking damage.
  // Called after any hit so both single-target and splash share the same rule.
  const REGEN_STUN = 2.0; // seconds a hit suppresses regeneration
  function noteDamageTaken(e) {
    if (e.regen) e.regenTimer = REGEN_STUN;
  }

  // Called after any kill so utility towers share the same kill pipeline.
  function bountyOnKill(deadX, deadY) {
    for (const b of state.towers) {
      const bdef = TOWERS[b.type];
      if (!bdef || !bdef.bounty) continue;
      const brng = towerRange(bdef, b.level) * TILE;
      if (dist((b.col + 0.5) * TILE, (b.row + 0.5) * TILE, deadX, deadY) <= brng) {
        state.cash += bdef.bountyBonus;
      }
    }
  }

  function updateTowers(dt) {
    for (const t of state.towers) {
      const def = TOWERS[t.type];
      const rng = towerRange(def, t.level);
      const tx = (t.col + 0.5) * TILE;
      const ty = (t.row + 0.5) * TILE;
      const rangePx = rng * TILE;

      // ----- Utility towers (no attack) -----
      if (def.magnet) {
        // Pull every creep inside the magnet's radius toward its center.
        for (const e of state.enemies) {
          const d = dist(tx, ty, e.x, e.y);
          if (d > rangePx || d === 0) continue;
          const pull = def.pullSpeed * dt;
          const step = Math.min(pull, d);
          e.x += ((tx - e.x) / d) * step;
          e.y += ((ty - e.y) / d) * step;
        }
        dirty = true;
        continue;
      }
      if (def.redirect) {
        // Teleport creeps inside the redirect zone a few waypoints BACKWARD,
        // so they must re-walk that stretch of the lane — giving your towers
        // extra shots instead of letting the creeps shortcut toward the exit.
        // Each creep is redirected at most redirectMax times, and only if
        // redirectCooldown seconds have passed since its last redirect, so
        // the zone delays creeps a finite, re-walkable amount — never a wall.
        for (let i = state.enemies.length - 1; i >= 0; i--) {
          const e = state.enemies[i];
          if (dist(tx, ty, e.x, e.y) > rangePx) continue;
          const rmax = def.redirectMax || 0;
          if ((e.redirects || 0) >= rmax) continue; // already stalled enough
          if (e.redirectTimer > 0) continue;         // not yet allowed again
          e.pathIndex = Math.max(1, e.pathIndex - def.redirectSkip);
          e.x = WAYPOINTS[e.pathIndex].x;
          e.y = WAYPOINTS[e.pathIndex].y;
          e.redirectTimer = def.redirectCooldown || 0;
          e.redirects = (e.redirects || 0) + 1;
        }
        dirty = true;
        continue;
      }
      // Bounty towers are purely economic: they never attack or trigger.
      if (def.bounty) {
        dirty = true;
        continue;
      }
      if (def.buff) {
        dirty = true;
        continue;
      }

      // ----- Attack towers -----
      const dmg = effectiveDamage(t);
      t.cooldown -= dt;
      if (t.cooldown > 0) continue;
      // A tower that is recharging has a visible cooldown -> state changed.
      dirty = true;

      // Pick a target within range using this tower's targeting mode.
      const best = pickTarget(tx, ty, rangePx, t.targetMode);
      if (!best) continue;

      t.cooldown = 1 / def.fireRate;
      // Remember the primary target's position so the renderer can draw a
      // visible projectile from this tower to the creep it shot.
      t.lastTarget = { x: best.x, y: best.y };

      if (def.splash) {
        // AOE tower: damage every creep within the splash radius of the target.
        const splashPx = def.splashRadius * TILE;
        for (let i = state.enemies.length - 1; i >= 0; i--) {
          const e = state.enemies[i];
          if (dist(tx, ty, e.x, e.y) > rangePx) continue; // must be in main range
          const d = dist(best.x, best.y, e.x, e.y);
          // Frost/splash combo: frosted creeps take bonus splash damage.
          const frosted = e.slowTimer > 0 || e.slow === true;
          const amount = d <= splashPx ? (frosted ? dmg * FROST_SPLASH_BONUS : dmg) : 0;
          if (amount <= 0) continue;

          // Splash/pierce bypasses shields (armor needs splash/pierce).
          const applied = damageToEnemy(e, amount, true);
          e.hp -= applied;
          noteDamageTaken(e);
          emit(GAME_EVENTS.ENEMY_DAMAGED, { x: e.x, y: e.y, amount: applied, type: t.type });

          if (e.hp <= 0) {
            state.enemies.splice(i, 1);
            const reward = killReward(e.type, e.rewardMult);
            state.cash += reward;
            state.kills++;
            bountyOnKill(e.x, e.y);
          }
        }
      } else {
        // Single-target tower: damage only the primary target.
        // Shields resist single-target shots; splash/pierce bypasses them.
        const applied = damageToEnemy(best, dmg, false);
        best.hp -= applied;
        noteDamageTaken(best);
        emit(GAME_EVENTS.ENEMY_DAMAGED, { x: best.x, y: best.y, amount: applied, type: t.type });

        // Frost towers also apply a slow effect to the target.
        if (def.slow) {
          best.slowTimer = SLOW_DURATION;
          best.slow = true; // hint for the renderer to tint the creep
        }

        if (best.hp <= 0) {
          const idx = state.enemies.indexOf(best);
          if (idx >= 0) state.enemies.splice(idx, 1);
          const reward = killReward(best.type, best.rewardMult);
          state.cash += reward;
          state.kills++;
          bountyOnKill(best.x, best.y);
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
        score = -e.hp; // higher current hp = preferred
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
  // Per-type bonuses make tanky/boss creeps worth more to kill. An optional
  // rewardMult (from a boss modifier) scales the payout further.
  function killReward(type, rewardMult) {
    const base = KILL_REWARD_BY_TYPE[type] || KILL_REWARD;
    const mult = rewardMult != null ? rewardMult : 1;
    return Math.floor((base + Math.floor(state.wave * 0.5)) * mult);
  }

  // ---------- Snapshot for the renderer ----------
  // nextWave is expensive to build (preset copy / formula loop) and only
  // changes when the wave number changes. Cache it per wave so we don't
  // recompute it on every dirty STATE_UPDATED frame during active play.
  let cachedNextWave = null;
  let cachedNextWaveFor = -1;
  function nextWaveFor(wave) {
    if (cachedNextWaveFor !== wave) {
      cachedNextWave = buildWaveQueue(wave);
      cachedNextWaveFor = wave;
    }
    return cachedNextWave;
  }

  function snapshot() {
    return {
      cash: state.cash,
      lives: state.lives,
      wave: state.wave,
      kills: state.kills,
      gameOver: state.gameOver,
      nextWave: nextWaveFor(state.wave + 1),
      waveName: waveNameFor(state.wave + 1),
      towerTypes: {
        basic:    TOWERS.basic,
        sniper:   TOWERS.sniper,
        cannon:   TOWERS.cannon,
        splash:   TOWERS.splash,
        frost:    TOWERS.frost,
        bounty:   TOWERS.bounty,
        buff:     TOWERS.buff,
        magnet:   TOWERS.magnet,
        redirect: TOWERS.redirect
      },
      grid: state.grid,
      path: PATH_CELLS,
      // Path-design info: whether the player may still design the path (any
      // time before the first wave starts), the cells drawn so far, and whether
      // a path has been committed. Design is OPT-IN from the renderer's
      // Edit/Create Path button — this only reports permission, not mode.
      pathDesign: {
        active: state.wave === 0,
        drawn: drawnPath || [],
        committed: pathCommitted
      },
      towers: state.towers.map(function (t) {
        const def = TOWERS[t.type];
        return {
          row: t.row,
          col: t.col,
          type: t.type,
          // Effective stats at the tower's current level, computed by the
          // shared formulas here in Computer A so the HUD never drifts.
          damage: towerDamage(def, t.level),
          range: t.range,
          level: t.level,
          upgradeCost: upgradeCost(def, t.level),
          targetMode: t.targetMode,
          cooldownFrac: Math.max(0, Math.min(1, t.cooldown * def.fireRate)),
          // Position of the creep this tower last fired at (projectile target).
          targetX: t.lastTarget ? t.lastTarget.x : null,
          targetY: t.lastTarget ? t.lastTarget.y : null
        };
      }),
      enemies: state.enemies.map(function (e) {
        return {
          id: e.id,
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
          slow: e.slowTimer > 0,
          shield: !!e.shield,
          regen: !!e.regen
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
      cooldown: 0,
      lastTarget: null // {x,y} of the creep last fired at (for renderer projectiles)
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

    const queue = buildWaveQueue(state.wave + 1);
    // Boss-choice gate: if the upcoming wave has a boss and no modifier has
    // been picked yet, ask the player first instead of starting the wave.
    const hasBoss = queue.some(function (t) { return t === 'boss'; });
    if (hasBoss && bossModifier === null) {
      emit(GAME_EVENTS.BOSS_MODIFIER_REQUEST, {
        wave: state.wave + 1,
        options: BOSS_MODIFIERS.map(function (m) { return { id: m.id, label: m.label, desc: m.desc }; })
      });
      return;
    }

    beginWave();
  }

  // Renderer dispatches BOSS_MODIFIER with { choice } after the player picks.
  // A choice of 'skip' (or an unrecognized one) means "no modifier — send the wave".
  function onBossModifier(evt) {
    const d = evt.detail;
    if (!d || !d.choice) return;
    if (state.gameOver) return;
    const mod = BOSS_MODIFIERS.find(function (m) { return m.id === d.choice; });
    if (mod) {
      bossModifier = mod.id;
      // Cash-boost modifier pays out immediately so the player can build.
      if (mod.cashBonus) {
        state.cash += mod.cashBonus;
        dirty = true;
      }
    }
    // If no matching modifier was picked (skip/cancel), bossModifier stays null
    // so the wave starts with the default boss.
    beginWave();
  }

  function beginWave() {
    if (waveActive) return;
    state.wave++;
    spawnQueue = buildWaveQueue(state.wave);
    // Apply the chosen boss modifier to any boss in this wave.
    const mod = BOSS_MODIFIERS.find(function (m) { return m.id === bossModifier; });
    if (mod) {
      spawnQueue = spawnQueue.map(function (t) {
        if (t === 'boss') {
          if (mod.hpMult != null) return { type: 'boss', hpMult: mod.hpMult, rewardMult: mod.rewardMult || 1 };
        }
        return t;
      });
      // A modifier is consumed once applied.
      bossModifier = null;
    }
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
    state.kills = 0;
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
    bossModifier = null;

    // Reset speed & pause so a "Play Again" never resumes mid-pause or at
    // a boosted speed (matches the renderer's button labels reset).
    paused = false;
    gameSpeed = 1;

    // Path design resets each game: clear any drawn path back to the default.
    drawnPath = null;
    pathCommitted = false;
    PATH_CELLS = DEFAULT_PATH_CELLS.slice();
    rebuildPath();

    dirty = true;
  }

  // ---------- Path design handlers ----------
  // Renderer dispatches PATH_DRAW with { cells } during path design: an
  // ordered list of cardinally-adjacent cells the player has clicked/dragged.
  // We store it so the renderer can show the live preview and validate on commit.
  function onPathDraw(evt) {
    const d = evt.detail;
    if (!d || !Array.isArray(d.cells)) return;
    // Only allowed before the first wave starts. Re-drawing (editing) an
    // already-committed path is fine as long as the wave hasn't begun.
    if (state.wave !== 0) return;
    drawnPath = d.cells.map(function (c) {
      return { row: c.row, col: c.col };
    });
  }

  // Renderer dispatches COMMIT_PATH with {} to finalize the drawn path.
  function onCommitPath() {
    if (state.wave !== 0) return;
    commitDrawnPath(drawnPath);
    dirty = true;
  }

  // Renderer dispatches RESET_PATH with {} to clear the design back to default.
  function onResetPath() {
    if (state.wave !== 0) return;
    drawnPath = null;
    pathCommitted = false;
    PATH_CELLS = DEFAULT_PATH_CELLS.slice();
    rebuildPath();
    emit('td:path_status', { ok: false, reason: 'reset' });
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
  window.addEventListener(GAME_EVENTS.BOSS_MODIFIER, onBossModifier);
  window.addEventListener(GAME_EVENTS.RESTART, onRestart);
  window.addEventListener(GAME_EVENTS.PATH_DRAW, onPathDraw);
  window.addEventListener(GAME_EVENTS.COMMIT_PATH, onCommitPath);
  window.addEventListener(GAME_EVENTS.RESET_PATH, onResetPath);

  // TEMP DEBUG HOOK (remove before commit)
  window.__tdDebug = {
    spawn: function (type) { spawnEnemy(type); dirty = true; },
    state: function () {
      return {
        cash: state.cash, kills: state.kills, lives: state.lives, wave: state.wave,
        enemies: state.enemies.map(function (e) {
          return { type: e.type, hp: e.hp, maxHp: e.maxHp, shield: e.shield, regen: e.regen, regenTimer: e.regenTimer, pathIndex: e.pathIndex, x: e.x, y: e.y };
        })
      };
    },
    towers: function () {
      return state.towers.map(function (t) {
        return { row: t.row, col: t.col, type: t.type, cooldown: t.cooldown };
      });
    }
  };

  // ---------- Start the logic loop ----------
  requestAnimationFrame(loop);
})();
