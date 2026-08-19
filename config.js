// config.js - Shared configuration and event names
const CONFIG = {
  GRID_ROWS: 10,
  GRID_COLS: 10,
  TILE_SIZE: 64, // Canvas width = 640px, height = 640px
  STARTING_CASH: 200,
  STARTING_LIVES: 20,

  // ---------- Balance tunables (single source of truth) ----------
  // Every gameplay constant lives here so Computer A (game_logic.js) and any
  // future consumers reference the same numbers. Previously these were scattered
  // as magic numbers in game_logic.js and the design notes, which let them drift
  // (e.g. the boss HP being ×15 here vs ×20 in notes). Keep tuning here only.
  BALANCE: {
    // Enemy / wave pacing
    ENEMY_HP: 75,          // base normal-creep HP
    ENEMY_SPEED: 60,       // pixels per second
    ENEMY_RADIUS: 12,
    BOSS_HP_MULT: 15,      // boss HP as a multiple of base enemy HP (×15)
    HP_PER_WAVE: 0.15,     // +15% enemy HP per wave
    COUNT_PER_WAVE: 2,     // +2 enemies per wave
    WAVE_COUNT_CAP: 50,   // hard cap so past-preset (formula) waves do not explode
    WAVE_ENEMY_COUNT: 6,   // base enemies per wave
    SPAWN_INTERVAL: 0.9,   // seconds between spawns
    KILL_REWARD: 8,        // base cash earned per kill
    MAX_DT: 0.05,          // clamp dt to avoid huge jumps on tab switch

    // Economy
    INTEREST_RATE: 0.05,   // +5% of unspent cash per wave cleared
    INTEREST_CAP: 25,      // cap so hoarding can't snowball infinitely
    SELL_REFUND: 0.7,      // refund 70% of total invested on sell

    // Upgrades (shared with the HUD via the snapshot — never drift)
    MAX_LEVEL: 3,
    UPGRADE_COST_MULT: 0.6,    // upgrade cost = base cost × 0.6^level
    UPGRADE_DAMAGE_MULT: 1.25, // +25% damage per level
    UPGRADE_RANGE_MULT: 1.1,   // +10% range per level

    // Redirect tower tuning: it must delay creeps a finite, re-walkable
    // amount, NOT stall them forever. Each creep is redirected at most
    // REDIRECT_MAX times, and only if REDIRECT_COOLDOWN seconds have passed
    // since its last redirect, so it can never be made impassable.
    REDIRECT_COOLDOWN: 2.5, // min seconds between redirects of the same creep
    REDIRECT_MAX: 2,        // max redirects a single creep can receive
    REDIRECT_SKIP: 2,       // waypoints a redirect pushes a creep back

    // Win condition
    VICTORY_WAVE: 20,      // clearing this wave wins the game
    LETHAL_LIVES: 1         // lethal difficulty starts with a single life (any leak = game over)
  }
};

// One-phrase role for each tower, used in onboarding tooltips and the HUD.
const TOWER_ROLES = {
  basic: 'Cheap all-rounder. Reliable single-target damage.',
  sniper: 'Long range. Picks off one target at a time, high damage.',
  cannon: 'Big hits. Slow, heavy single-target damage.',
  splash: 'Area damage. Hits every creep near its target.',
  frost: 'Slows enemies. Low damage, keeps the lane safe.',
  bounty: 'Pays bonus cash for every creep killed inside its range.',
  buff: 'Aura that boosts the damage of nearby towers.',
  redirect: 'Teleports creeps that enter its zone a few steps back along the path, so they must re-walk that stretch.'
};

// Standardized Event Names both A and B must use
const GAME_EVENTS = {
  STATE_UPDATED: 'td:state_updated',       // Sent by A -> Read by B to redraw frame
  TOWER_PLACED: 'td:tower_placed',         // Sent by B -> Processed by A to deduct money & spawn tower
  ENEMY_DAMAGED: 'td:enemy_damaged',       // Sent by A -> Used by B to display damage numbers
  WAVE_STARTED: 'td:wave_started',         // Sent by B -> Processed by A to start timer
  UPGRADE_TOWER: 'td:upgrade_tower',       // Sent by B -> Processed by A to level a tower
  SELL_TOWER: 'td:sell_tower',             // Sent by B -> Processed by A to refund & remove a tower
  CHANGE_TARGET_MODE: 'td:change_target_mode', // Sent by B -> Processed by A to cycle targeting mode
  TOGGLE_PAUSE: 'td:toggle_pause',         // Sent by B -> Processed by A to flip pause
  SET_SPEED: 'td:set_speed',               // Sent by B -> Processed by A to change game speed
  RESTART: 'td:restart',                   // Sent by B -> Processed by A to reset the game
  SETTINGS: 'td:settings',                 // Sent by B -> Processed by A: difficulty/mode choice
  ENEMY_SPAWNED: 'td:enemy_spawned',       // Sent by A -> Used by B for spawn feedback
  BOSS_SPAWNED: 'td:boss_spawned',         // Sent by A -> Used by B to show the boss banner
  WAVE_MODIFIER_REQUEST: 'td:wave_modifier_request', // Sent by A -> B shows the wave-choice modal
  WAVE_MODIFIER: 'td:wave_modifier',       // Sent by B -> A applies the chosen wave modifier
  WAVE_CLEARED: 'td:wave_cleared',         // Sent by A -> B shows the income toast
  VICTORY: 'td:victory',                 // Sent by A -> B shows the victory overlay
  GAME_OVER: 'td:game_over',             // Sent by A -> Used by B to show the game-over overlay
  PATH_DRAW: 'td:path_draw',             // Sent by B -> A stores the drawn path cells during design
  COMMIT_PATH: 'td:commit_path',         // Sent by B -> A validates & commits the drawn path
  RESET_PATH: 'td:reset_path',           // Sent by B -> A resets the path back to the default
  PATH_STATUS: 'td:path_status',         // Sent by A -> B reports path validation result
  BUILD_FAILED: 'td:build_failed'         // Sent by A -> B shows why a build was rejected
};
