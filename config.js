// config.js - Shared configuration and event names
const CONFIG = {
  GRID_ROWS: 10,
  GRID_COLS: 10,
  TILE_SIZE: 64, // Canvas width = 640px, height = 640px
  STARTING_CASH: 100,
  STARTING_LIVES: 20
};

// Standardized Event Names both A and B must use
const GAME_EVENTS = {
  STATE_UPDATED: 'td:state_updated',   // Sent by A -> Read by B to redraw frame
  TOWER_PLACED: 'td:tower_placed',     // Sent by B -> Processed by A to deduct money & spawn tower
  ENEMY_DAMAGED: 'td:enemy_damaged',   // Sent by A -> Used by B to display damage numbers
  ENEMY_SPAWNED: 'td:enemy_spawned',   // Sent by A -> Used by B to show spawn effects
  WAVE_STARTED: 'td:wave_started'      // Sent by B -> Processed by A to start timer
};
