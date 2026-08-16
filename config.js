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
  frost: 'Slows enemies. Low damage, keeps the lane safe.',
  bounty: 'Pays bonus cash for every creep killed inside its range.',
  buff: 'Aura that boosts the damage of nearby towers.',
  magnet: 'Gently pulls creeps inside its radius toward it, dragging them off the lane.',
  redirect: 'Teleports creeps that enter its zone a few steps ahead along the path.'
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
  ENEMY_SPAWNED: 'td:enemy_spawned',       // Sent by A -> Used by B for spawn feedback
  BOSS_SPAWNED: 'td:boss_spawned',         // Sent by A -> Used by B to show the boss banner
  BOSS_MODIFIER_REQUEST: 'td:boss_modifier_request', // Sent by A -> B shows boss-choice modal
  BOSS_MODIFIER: 'td:boss_modifier',       // Sent by B -> A applies the chosen boss modifier
  WAVE_CLEARED: 'td:wave_cleared',         // Sent by A -> B shows the income toast
  VICTORY: 'td:victory',                 // Sent by A -> B shows the victory overlay
  GAME_OVER: 'td:game_over',             // Sent by A -> Used by B to show the game-over overlay
  PATH_DRAW: 'td:path_draw',             // Sent by B -> A stores the drawn path cells during design
  COMMIT_PATH: 'td:commit_path',         // Sent by B -> A validates & commits the drawn path
  RESET_PATH: 'td:reset_path',           // Sent by B -> A resets the path back to the default
  PATH_STATUS: 'td:path_status'          // Sent by A -> B reports path validation result
};
