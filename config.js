// config.js - Shared configuration and event names
const CONFIG = {
  GRID_ROWS: 10,
  GRID_COLS: 10,
  TILE_SIZE: 64, // Canvas width = 640px, height = 640px
  STARTING_CASH: 200,
  STARTING_LIVES: 20
};

// One-phrase role for each tower, used in onboarding tooltips and the HUD.
const TOWER_ROLES = {
  basic: 'Cheap all-rounder. Reliable single-target damage.',
  sniper: 'Long range. Picks off one target at a time, high damage.',
  cannon: 'Big hits. Slow, heavy single-target damage.',
  splash: 'Area damage. Hits every creep near its target.',
  frost: 'Slows enemies. Low damage, keeps the lane safe.'
};

// Standardized Event Names both A and B must use
const GAME_EVENTS = {
  STATE_UPDATED: 'td:state_updated',   // Sent by A -> Read by B to redraw frame
  TOWER_PLACED: 'td:tower_placed',     // Sent by B -> Processed by A to deduct money & spawn tower
  ENEMY_DAMAGED: 'td:enemy_damaged',   // Sent by A -> Used by B to display damage numbers
  ENEMY_SPAWNED: 'td:enemy_spawned',   // Sent by A -> Used by B to show spawn effects
  WAVE_STARTED: 'td:wave_started',     // Sent by B -> Processed by A to start timer
  GAME_OVER: 'td:game_over',           // Sent by A -> Used by B to show game-over overlay
  UPGRADE_TOWER: 'td:upgrade_tower',      // Sent by B -> Processed by A to level up a tower
  SELL_TOWER: 'td:sell_tower',            // Sent by B -> Processed by A to refund & remove a tower
  CHANGE_TARGET_MODE: 'td:change_target_mode', // Sent by B -> Processed by A to cycle targeting mode
  TOGGLE_PAUSE: 'td:toggle_pause',            // Sent by B -> Processed by A to pause/resume
  SET_SPEED: 'td:set_speed',                  // Sent by B -> Processed by A to change game speed
  BOSS_SPAWNED: 'td:boss_spawned',            // Sent by A -> Used by B to show a boss banner
  RESTART: 'td:restart'                       // Sent by B -> Processed by A to reset the game
};
