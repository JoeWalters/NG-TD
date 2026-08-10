// renderer_ui.js - Computer B: Graphics, Canvas & UI
// Renders state received from Computer A; dispatches build/wave requests.

(function () {
  'use strict';

  // ---------- Canvas & HUD element references ----------
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  const cashEl = document.getElementById('cash');
  const livesEl = document.getElementById('lives');
  const waveEl = document.getElementById('wave');

  // ---------- Local display-only state (never touches game state) ----------
  // These are purely cosmetic and owned by the renderer.
  const display = {
    cash: 0,
    lives: 0,
    wave: 0,
    grid: [],       // tile types, row-major: [row][col] or flat [row*COLS+col]
    path: [],       // list of {row, col} tiles that form the creep path
    towers: [],     // list of {row, col, type, range}
    enemies: [],    // list of {x, y, radius, color, hp, maxHp, hpPercent}
    damageNumbers: [], // list of {x, y, text, ttl}
    flashes: [],    // list of {x, y, ttl} red hit flashes
    hoverTile: null // {row, col} under the mouse cursor
  };

  // Tower type currently selected in the HUD (renderer UI concern only).
  let selectedType = 'basic';

  // ---------- Grid helpers ----------
  const ROWS = CONFIG.GRID_ROWS;
  const COLS = CONFIG.GRID_COLS;
  const TILE = CONFIG.TILE_SIZE;
  const TILE_PX = canvas.width / COLS; // px per column
  const TILE_PY = canvas.height / ROWS; // px per row

  function gridIndex(row, col) {
    return row * COLS + col;
  }

  // Convert a canvas pixel coordinate into a grid tile (col, row).
  function tileAt(mx, my) {
    const col = Math.floor(mx / TILE_PX);
    const row = Math.floor(my / TILE_PY);
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
    return { row, col };
  }

  // ---------- Damage numbers & flashes (visual only) ----------
  const DAMAGE_TTL = 40; // frames
  const FLASH_TTL = 8; // frames

  function spawnDamage(x, y, text) {
    display.damageNumbers.push({ x, y, text, ttl: DAMAGE_TTL });
  }

  function spawnFlash(x, y) {
    display.flashes.push({ x, y, ttl: FLASH_TTL });
  }

  // ---------- Drawing helpers ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- Grid & path rendering ----------
  function drawGrid() {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const x = col * TILE_PX;
        const y = row * TILE_PY;
        const cell = display.grid ? display.grid[gridIndex(row, col)] : undefined;
        const isPath = display.path.some(
          (p) => p.row === row && p.col === col
        );

        let fill = '#0f172a';          // empty
        if (isPath) fill = '#3b2f1f';  // path tile (sand/stone)

        if (cell === 2) fill = '#334155'; // blocked/building tile
        else if (cell === 1) fill = '#3b2f1f'; // path

        ctx.fillStyle = fill;
        ctx.fillRect(x, y, TILE_PX, TILE_PY);

        // subtle grid lines
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, TILE_PX - 1, TILE_PY - 1);
      }
    }
  }

  // ---------- Tower rendering ----------
  const TOWER_COLORS = {
    basic: '#38bdf8',
    sniper: '#a78bfa',
    cannon: '#f87171'
  };

  function drawTowers() {
    for (const t of display.towers) {
      const x = t.col * TILE_PX;
      const y = t.row * TILE_PY;
      const color = TOWER_COLORS[t.type] || '#38bdf8';

      // Range indicator: draw a translucent circle when this tower is hovered.
      if (
        display.hoverTile &&
        display.hoverTile.row === t.row &&
        display.hoverTile.col === t.col &&
        typeof t.range === 'number'
      ) {
        const cx = x + TILE_PX * 0.5;
        const cy = y + TILE_PY * 0.5;
        // Accept range in tiles (<= 20) or pixels; convert tiles to px.
        const radius = t.range <= 20 ? t.range * TILE_PX : t.range;
        ctx.fillStyle = 'rgba(56,189,248,0.15)';
        ctx.strokeStyle = 'rgba(56,189,248,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      ctx.fillStyle = color;
      roundRect(x + 6, y + 6, TILE_PX - 12, TILE_PY - 12, 8);
      ctx.fill();

      // barrel / detail line
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + TILE_PX * 0.5, y + TILE_PY * 0.5);
      ctx.lineTo(x + TILE_PX * 0.9, y + TILE_PY * 0.5);
      ctx.stroke();
    }
  }

  // ---------- Enemy rendering ----------
  function drawEnemies() {
    for (const e of display.enemies) {
      const x = e.x;
      const y = e.y;
      const r = e.radius || 12;

      ctx.fillStyle = e.color || '#fbbf24';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      // Health bar above the creep, based on the current health percentage
      // provided in STATE_UPDATED (hpPercent), falling back to hp/maxHp.
      let frac = null;
      if (typeof e.hpPercent === 'number') {
        frac = Math.max(0, Math.min(1, e.hpPercent / 100));
      } else if (typeof e.hp === 'number' && typeof e.maxHp === 'number' && e.maxHp > 0) {
        frac = Math.max(0, Math.min(1, e.hp / e.maxHp));
      }

      if (frac !== null) {
        const barW = r * 2;
        const barH = 4;
        const bx = x - barW / 2;
        const by = y - r - 8;
        ctx.fillStyle = 'rgba(15,23,42,0.7)';
        ctx.fillRect(bx, by, barW, barH);
        ctx.fillStyle = '#4ade80';
        ctx.fillRect(bx, by, barW * frac, barH);
      }
    }
  }

  // ---------- Hit flashes ----------
  function drawFlashes() {
    for (const f of display.flashes) {
      const frac = f.ttl / FLASH_TTL; // 1 -> 0 as it fades
      const radius = 16 * (1 - frac) + 4;
      ctx.globalAlpha = Math.min(1, frac * 1.2);
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(f.x, f.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Damage numbers ----------
  function drawDamageNumbers() {
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const d of display.damageNumbers) {
      const alpha = Math.min(1, d.ttl / 12);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#fca5a5';
      ctx.fillText(d.text, d.x, d.y);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- HUD update ----------
  function updateHUD() {
    if (cashEl) cashEl.textContent = String(display.cash);
    if (livesEl) livesEl.textContent = String(display.lives);
    if (waveEl) waveEl.textContent = String(display.wave);
  }

  // ---------- Main render loop ----------
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    drawTowers();
    drawEnemies();
    drawFlashes();
    drawDamageNumbers();
    updateHUD();

    // tick damage number lifetimes (renderer-local)
    for (let i = display.damageNumbers.length - 1; i >= 0; i--) {
      display.damageNumbers[i].ttl -= 1;
      display.damageNumbers[i].y -= 0.5;
      if (display.damageNumbers[i].ttl <= 0) {
        display.damageNumbers.splice(i, 1);
      }
    }

    // tick flash lifetimes (renderer-local)
    for (let i = display.flashes.length - 1; i >= 0; i--) {
      display.flashes[i].ttl -= 1;
      if (display.flashes[i].ttl <= 0) {
        display.flashes.splice(i, 1);
      }
    }

    requestAnimationFrame(render);
  }

  // ---------- Event listeners ----------
  function onStateUpdated(evt) {
    const s = evt.detail;
    if (!s) return;

    // Copy only render-relevant fields into the display object.
    if (typeof s.cash === 'number') display.cash = s.cash;
    if (typeof s.lives === 'number') display.lives = s.lives;
    if (typeof s.wave === 'number') display.wave = s.wave;

    if (s.grid) display.grid = s.grid;
    if (s.path) display.path = s.path;
    if (s.towers) display.towers = s.towers;
    if (s.enemies) display.enemies = s.enemies;
  }

  // Computer A reports damage -> brief red flash + floating damage text.
  function onEnemyDamaged(evt) {
    const d = evt.detail;
    if (!d) return;
    if (typeof d.x === 'number' && typeof d.y === 'number') {
      spawnFlash(d.x, d.y);
    }
    spawnDamage(d.x, d.y, String(d.amount != null ? d.amount : '-0'));
  }

  // ---------- Mouse tracking (for hover range indicator) ----------
  canvas.addEventListener('mousemove', function (evt) {
    const rect = canvas.getBoundingClientRect();
    const mx = evt.clientX - rect.left;
    const my = evt.clientY - rect.top;
    display.hoverTile = tileAt(mx, my) || null;
  });

  canvas.addEventListener('mouseleave', function () {
    display.hoverTile = null;
  });

  // ---------- Click -> grid coords -> dispatch build request ----------
  canvas.addEventListener('click', function (evt) {
    const rect = canvas.getBoundingClientRect();
    const mx = evt.clientX - rect.left;
    const my = evt.clientY - rect.top;
    const tile = tileAt(mx, my);
    if (!tile) return;

    window.dispatchEvent(
      new CustomEvent(GAME_EVENTS.TOWER_PLACED, {
        detail: { row: tile.row, col: tile.col, type: selectedType }
      })
    );
  });

  // ---------- Start Wave button ----------
  const startBtn = document.getElementById('start-wave');
  if (startBtn) {
    startBtn.addEventListener('click', function () {
      window.dispatchEvent(new CustomEvent(GAME_EVENTS.WAVE_STARTED, { detail: {} }));
    });
  }

  // ---------- Tower type selector (renderer UI concern) ----------
  document.querySelectorAll('#tower-types .type-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      selectedType = btn.getAttribute('data-type') || 'basic';
      document.querySelectorAll('#tower-types .type-btn').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
    });
  });

  // ---------- Wire up events ----------
  window.addEventListener(GAME_EVENTS.STATE_UPDATED, onStateUpdated);
  window.addEventListener(GAME_EVENTS.ENEMY_DAMAGED, onEnemyDamaged);

  // ---------- Start the render loop ----------
  requestAnimationFrame(render);
})();
