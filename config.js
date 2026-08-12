// config.js - Shared configuration and event names
const CONFIG = {
  GRID_ROWS: 10,
  GRID_COLS: 10,
  TILE_SIZE: 64, // Canvas width = 640px, height = 640px
  STARTING_CASH: 200,
  STARTING_LIVES: 20
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
  GAME_OVER: 'td:game_over'                // Sent by A -> Used by B to show the game-over overlay
};
