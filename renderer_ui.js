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
  const nextWaveEl = document.getElementById('next-wave');

  // ---------- Local display-only state (never touches game state) ----------
  // These are purely cosmetic and owned by the renderer.
  const display = {
    cash: 0,
    lives: 0,
    wave: 0,
    nextWave: [],   // enemy-type composition of the upcoming wave
    towerTypes: {}, // { type: {range, cost, ...} } for placement previews
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

  // Convert an event's client coordinates into internal canvas pixels.
  // The canvas keeps a 640x640 internal resolution but may be CSS-scaled to
  // fit small screens, so we map through getBoundingClientRect.
  function canvasPoint(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY
    };
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

        // Draw the base tile fill with a slight vertical gradient for depth.
        const grad = ctx.createLinearGradient(0, y, 0, y + TILE_PY);
        grad.addColorStop(0, fill);
        grad.addColorStop(1, shade(fill, -14));
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, TILE_PX, TILE_PY);

        // Onboarding highlight: every empty, unoccupied tile shows a faint
        // glow so new players can see exactly where towers may be built.
        const occupied = display.towers.some(function (t) {
          return t.row === row && t.col === col;
        });
        if (cell === 0 && !occupied) {
          ctx.fillStyle = 'rgba(56,189,248,0.07)';
          ctx.fillRect(x, y, TILE_PX, TILE_PY);
          ctx.strokeStyle = 'rgba(56,189,248,0.22)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, TILE_PX - 1, TILE_PY - 1);
        }

        // Path tiles get a subtle inner highlight + darker edges so the lane
        // reads clearly against the empty ground.
        if (isPath) {
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          ctx.fillRect(x, y, TILE_PX, 3);
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, TILE_PX - 1, TILE_PY - 1);
        } else {
          // subtle grid lines
          ctx.strokeStyle = '#1e293b';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, TILE_PX - 1, TILE_PY - 1);
        }
      }
    }
  }

  // Darken (negative) or lighten (positive) a hex color by a percentage.
  function shade(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const r = Math.min(255, Math.max(0, (num >> 16) + amt));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt));
    const b = Math.min(255, Math.max(0, (num & 0xff) + amt));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // ---------- Tower rendering ----------
  const TOWER_COLORS = {
    basic: '#38bdf8',
    sniper: '#a78bfa',
    cannon: '#f87171',
    splash: '#22c55e',
    frost: '#22d3ee'
  };

  function drawTowers() {
    // Placement preview: show the selected tower's range ring on a hovered
    // empty tile that is valid to build on.
    if (display.hoverTile && display.grid.length) {
      const ht = display.hoverTile;
      const gi = ht.row * COLS + ht.col;
      const tileType = display.grid[gi];
      const occupied = display.towers.some(function (t) {
        return t.row === ht.row && t.col === ht.col;
      });
      const def = display.towerTypes[selectedType];
      if (tileType === 0 && !occupied && def && typeof def.range === 'number') {
        const hx = ht.col * TILE_PX;
        const hy = ht.row * TILE_PY;
        const hcx = hx + TILE_PX * 0.5;
        const hcy = hy + TILE_PY * 0.5;
        const radius = def.range <= 20 ? def.range * TILE_PX : def.range;
        ctx.fillStyle = 'rgba(56,189,248,0.15)';
        ctx.strokeStyle = 'rgba(56,189,248,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hcx, hcy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Ghost of the tower to be placed.
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = TOWER_COLORS[selectedType] || '#38bdf8';
        roundRect(hx + 6, hy + 6, TILE_PX - 12, TILE_PY - 12, 8);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

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

      // Inner panel for contrast + a soft rim light on the top edge.
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x + 8, y + 8, TILE_PX - 16, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.fillRect(x + 8, y + TILE_PY - 11, TILE_PX - 16, 3);

      // Type-specific silhouette so each tower reads at a glance.
      const cx = x + TILE_PX * 0.5;
      const cy = y + TILE_PY * 0.5;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      if (t.type === 'sniper') {
        // Long barrel pointing up-right
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-0.5);
        ctx.fillRect(2, -3, TILE_PX * 0.62, 6);
        ctx.restore();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx + 10, cy - 8, 5, 0, Math.PI * 2);
        ctx.fill();
      } else if (t.type === 'cannon') {
        // Twin barrels
        ctx.fillRect(6, cy - 8, TILE_PX * 0.55, 5);
        ctx.fillRect(6, cy + 3, TILE_PX * 0.55, 5);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, 10, 0, Math.PI * 2);
        ctx.fill();
      } else if (t.type === 'splash') {
        // Rotating fan of blades
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2;
          ctx.fillRect(cx - 2, cy - 12, 4, 24);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(a);
          ctx.fillRect(-2, -12, 4, 24);
          ctx.restore();
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
      } else if (t.type === 'frost') {
        // Snowflake: 3 crossed lines
        for (let i = 0; i < 3; i++) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(i * Math.PI / 3);
          ctx.fillRect(-1.5, -11, 3, 22);
          ctx.restore();
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Basic: single forward barrel
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(cx - 3, cy - 2, TILE_PX * 0.44, 5);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, 9, 0, Math.PI * 2);
        ctx.fill();
      }

      // Level badge (top-right corner)
      const lv = t.level || 1;
      const bx = x + TILE_PX - 12;
      const by = y + 8;
      ctx.fillStyle = lv >= 3 ? '#f59e0b' : (lv === 2 ? '#e2b8ff' : '#cbd5e1');
      ctx.beginPath();
      ctx.arc(bx, by, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(lv), bx, by + 0.5);

      // Targeting-mode badge (bottom-right corner): N / F / S
      const mode = t.targetMode || 'nearest';
      const modeLetter = mode === 'first' ? 'F' : (mode === 'strong' ? 'S' : 'N');
      const mx2 = x + TILE_PX - 12;
      const my2 = y + TILE_PY - 8;
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(mx2, my2, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(modeLetter, mx2, my2 + 0.5);

      // Cooldown fill: a dark ring that refills as the tower recharges.
      if (typeof t.cooldownFrac === 'number' && t.cooldownFrac > 0) {
        const frac = Math.max(0, Math.min(1, t.cooldownFrac));
        ctx.strokeStyle = 'rgba(15,23,42,0.75)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(x + TILE_PX * 0.5, y + TILE_PY * 0.5, TILE_PX * 0.42, 0, Math.PI * 2 * frac);
        ctx.stroke();
      }
    }
  }

  // ---------- Muzzle flashes (tower firing feedback) ----------
  const muzzleFlashes = []; // {x, y, ttl}
  const MUZZLE_TTL = 6;

  function drawMuzzleFlashes() {
    for (const m of muzzleFlashes) {
      const frac = m.ttl / MUZZLE_TTL;
      ctx.globalAlpha = Math.min(1, frac * 1.5);
      ctx.fillStyle = '#fde68a';
      ctx.beginPath();
      ctx.arc(m.x, m.y, 10 * frac + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Enemy rendering ----------
  function drawEnemies() {
    for (const e of display.enemies) {
      const x = e.x;
      const y = e.y;
      const r = e.radius || 12;

      // Slowed creeps get a frosty tint so the slow is visible at a glance.
      ctx.fillStyle = e.slow ? '#7dd3fc' : (e.color || '#fbbf24');
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      // A darker rim gives creeps a bit of depth.
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Facing indicator: a small "eye" dot that shows the creep's heading
      // (uses the velocity if the snapshot provides one).
      let vx = 0;
      let vy = -1;
      if (typeof e.vx === 'number' && typeof e.vy === 'number' &&
          (Math.abs(e.vx) + Math.abs(e.vy)) > 0.01) {
        const len = Math.hypot(e.vx, e.vy);
        vx = e.vx / len;
        vy = e.vy / len;
      }
      const eyeX = x + vx * r * 0.45;
      const eyeY = y + vy * r * 0.45;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, Math.max(2, r * 0.18), 0, Math.PI * 2);
      ctx.fill();

      if (e.slow) {
        // A small icy ring around slowed creeps.
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }

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
        // Dark backing + border so the bar reads on any tile.
        ctx.fillStyle = 'rgba(15,23,42,0.8)';
        ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
        ctx.fillStyle = '#4ade80';
        ctx.fillRect(bx, by, barW * frac, barH);
        // Bosses get a gold health bar so they stand out.
        if (e.type === 'boss') {
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(bx, by, barW * frac, barH);
        }
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
  // Build a short summary of the upcoming wave, e.g. "6 normal · 2 scout".
  function nextWaveSummary(waveTypes) {
    if (!waveTypes || waveTypes.length === 0) return '—';
    const counts = {};
    for (const t of waveTypes) counts[t] = (counts[t] || 0) + 1;
    const parts = [];
    const order = ['normal', 'scout', 'tank', 'boss'];
    for (const t of order) {
      if (counts[t]) parts.push(counts[t] + ' ' + t + (counts[t] > 1 ? 's' : ''));
    }
    return parts.join(' · ');
  }

  function updateHUD() {
    if (cashEl) cashEl.textContent = String(display.cash);
    if (livesEl) livesEl.textContent = String(display.lives);
    if (waveEl) waveEl.textContent = String(display.wave);
    if (nextWaveEl) nextWaveEl.textContent = nextWaveSummary(display.nextWave);
  }

  // ---------- Tower HUD panel ----------
  // Shows details for the tower under the mouse, if any.
  function updateTowerHud() {
    const panel = document.getElementById('tower-hud');
    if (!panel) return;

    let tower = null;
    if (display.hoverTile) {
      tower = display.towers.find(function (t) {
        return t.row === display.hoverTile.row && t.col === display.hoverTile.col;
      });
    }

    if (!tower) {
      panel.classList.add('hidden');
      return;
    }

    const def = display.towerTypes[tower.type];
    const upgradeCost = def && def.cost != null
      ? Math.round(def.cost * Math.pow(0.6, tower.level)) // same formula as game_logic
      : null;

    const el = (id) => document.getElementById(id);
    el('th-title').textContent = tower.type.toUpperCase();
    el('th-level').textContent = String(tower.level);
    el('th-damage').textContent = def ? String(Math.round(def.damage * Math.pow(1.25, tower.level - 1))) : '—';
    el('th-range').textContent = def ? String(def.range * Math.pow(1.1, tower.level - 1)) : '—';
    el('th-mode').textContent = String(tower.targetMode || 'nearest');
    el('th-upgrade').textContent = upgradeCost != null ? String(upgradeCost) : '—';

    // Per-tower role line: a one-phrase reminder of what this tower does.
    const roleEl = document.getElementById('th-role');
    const role = TOWER_ROLES[tower.type] || '';
    if (roleEl) roleEl.textContent = role;

    // On touch devices, show Sell / Mode buttons so users can act on the
    // tower without right-click or keyboard. Desktop keeps the buttons hidden.
    const actionsEl = document.getElementById('th-actions');
    if (actionsEl) {
      const showActions = 'ontouchstart' in window && display.hoverTile;
      actionsEl.classList.toggle('show', showActions);
      // Remember which tower the buttons should act on.
      actionsEl._tower = { row: tower.row, col: tower.col };
    }

    panel.classList.remove('hidden');
  }

  // ---------- Main render loop ----------
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    drawTowers();
    drawMuzzleFlashes();
    drawEnemies();
    drawFlashes();
    drawDamageNumbers();
    updateHUD();
    updateTowerHud();

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

    // tick muzzle flash lifetimes (renderer-local)
    for (let i = muzzleFlashes.length - 1; i >= 0; i--) {
      muzzleFlashes[i].ttl -= 1;
      if (muzzleFlashes[i].ttl <= 0) {
        muzzleFlashes.splice(i, 1);
      }
    }

    tickBossBanner();
    tickToast();

    requestAnimationFrame(render);
  }

  // ---------- Event listeners ----------
  // Track each tower's previous cooldownFrac to detect a fresh shot.
  const lastCooldownFrac = {}; // keyed by tower id (row-col-type)

  function onStateUpdated(evt) {
    const s = evt.detail;
    if (!s) return;

    // Copy only render-relevant fields into the display object.
    if (typeof s.cash === 'number') display.cash = s.cash;
    if (typeof s.lives === 'number') display.lives = s.lives;
    if (typeof s.wave === 'number') display.wave = s.wave;
    if (Array.isArray(s.nextWave)) display.nextWave = s.nextWave;
    if (s.towerTypes && typeof s.towerTypes === 'object') display.towerTypes = s.towerTypes;

    if (s.grid) display.grid = s.grid;
    if (s.path) display.path = s.path;

    // Detect firing: a tower's cooldownFrac jumping from low to high means it shot.
    if (s.towers) {
      display.towers = s.towers;
      for (const t of s.towers) {
        const key = t.row + '-' + t.col + '-' + t.type;
        const prev = lastCooldownFrac[key] || 0;
        const cur = typeof t.cooldownFrac === 'number' ? t.cooldownFrac : 0;
        if (cur > 0.8 && prev <= 0.8) {
          muzzleFlashes.push({
            x: (t.col + 0.5) * TILE_PX,
            y: (t.row + 0.5) * TILE_PY,
            ttl: MUZZLE_TTL
          });
        }
        lastCooldownFrac[key] = cur;
      }
    }

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
    const p = canvasPoint(evt);
    display.hoverTile = tileAt(p.x, p.y) || null;
  });

  canvas.addEventListener('mouseleave', function () {
    display.hoverTile = null;
  });

  // ---------- Click -> grid coords -> dispatch build / upgrade request ----------
  canvas.addEventListener('click', function (evt) {
    const p = canvasPoint(evt);
    const tile = tileAt(p.x, p.y);
    if (!tile) return;

    const tower = display.towers.find(function (t) {
      return t.row === tile.row && t.col === tile.col;
    });

    if (tower) {
      // Left-clicking an occupied tile upgrades that tower.
      window.dispatchEvent(
        new CustomEvent(GAME_EVENTS.UPGRADE_TOWER, {
          detail: { row: tile.row, col: tile.col }
        })
      );
    } else {
      window.dispatchEvent(
        new CustomEvent(GAME_EVENTS.TOWER_PLACED, {
          detail: { row: tile.row, col: tile.col, type: selectedType }
        })
      );
    }
  });

  // ---------- Right-click a tower -> sell ----------
  canvas.addEventListener('contextmenu', function (evt) {
    evt.preventDefault();
    const p = canvasPoint(evt);
    const tile = tileAt(p.x, p.y);
    if (!tile) return;

    const tower = display.towers.find(function (t) {
      return t.row === tile.row && t.col === tile.col;
    });
    if (!tower) return;

    window.dispatchEvent(
      new CustomEvent(GAME_EVENTS.SELL_TOWER, {
        detail: { row: tile.row, col: tile.col }
      })
    );
  });

  // ---------- Touch input (mobile) ----------
  // touchstart updates the hover tile (so the range ring + panel appear);
  // a tap on an empty tile places a tower, a tap on an occupied tile upgrades.
  // Selling / mode changes are handled by the panel's Sell / Mode buttons,
  // which the tower HUD reveals on touch devices.
  let touchActive = false;

  canvas.addEventListener('touchstart', function (evt) {
    if (evt.touches && evt.touches.length > 0) {
      const t = evt.touches[0];
      const p = canvasPoint(t);
      display.hoverTile = tileAt(p.x, p.y) || null;
      touchActive = true;
    }
  }, { passive: true });

  canvas.addEventListener('touchend', function (evt) {
    if (!touchActive) return;
    touchActive = false;

    if (evt.changedTouches && evt.changedTouches.length > 0) {
      const t = evt.changedTouches[0];
      const p = canvasPoint(t);
      const tile = tileAt(p.x, p.y);
      if (!tile) return;

      const tower = display.towers.find(function (tw) {
        return tw.row === tile.row && tw.col === tile.col;
      });

      if (tower) {
        window.dispatchEvent(
          new CustomEvent(GAME_EVENTS.UPGRADE_TOWER, {
            detail: { row: tile.row, col: tile.col }
          })
        );
      } else {
        window.dispatchEvent(
          new CustomEvent(GAME_EVENTS.TOWER_PLACED, {
            detail: { row: tile.row, col: tile.col, type: selectedType }
          })
        );
      }
    }
  }, { passive: true });

  canvas.addEventListener('touchcancel', function () {
    touchActive = false;
  });

  // ---------- Mobile action bar: Sell / Mode buttons ----------
  const thSellBtn = document.getElementById('th-sell');
  if (thSellBtn) {
    thSellBtn.addEventListener('click', function () {
      const actions = document.getElementById('th-actions');
      const tower = actions && actions._tower;
      if (!tower) return;
      window.dispatchEvent(
        new CustomEvent(GAME_EVENTS.SELL_TOWER, {
          detail: { row: tower.row, col: tower.col }
        })
      );
    });
  }

  const thModeBtn = document.getElementById('th-mode-btn');
  if (thModeBtn) {
    thModeBtn.addEventListener('click', function () {
      const actions = document.getElementById('th-actions');
      const tower = actions && actions._tower;
      if (!tower) return;
      window.dispatchEvent(
        new CustomEvent(GAME_EVENTS.CHANGE_TARGET_MODE, {
          detail: { row: tower.row, col: tower.col }
        })
      );
    });
  }

  // ---------- Keyboard: cycle targeting mode of hovered tower (M key) ----------
  window.addEventListener('keydown', function (evt) {
    if (evt.key !== 'm' && evt.key !== 'M') return;
    const tile = display.hoverTile;
    if (!tile) return;
    const tower = display.towers.find(function (t) {
      return t.row === tile.row && t.col === tile.col;
    });
    if (!tower) return;

    window.dispatchEvent(
      new CustomEvent(GAME_EVENTS.CHANGE_TARGET_MODE, {
        detail: { row: tile.row, col: tile.col }
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

  // ---------- Pause button ----------
  const pauseBtn = document.getElementById('pause-btn');
  let pausedLabel = false;
  if (pauseBtn) {
    pauseBtn.addEventListener('click', function () {
      window.dispatchEvent(new CustomEvent(GAME_EVENTS.TOGGLE_PAUSE, { detail: {} }));
      pausedLabel = !pausedLabel;
      pauseBtn.textContent = pausedLabel ? '⏸ Paused' : '⏸ Pause';
    });
  }

  // ---------- Speed button (cycles 1x -> 2x -> 3x -> 1x) ----------
  const speedBtn = document.getElementById('speed-btn');
  const SPEEDS = [1, 2, 3];
  let speedIndex = 0;
  if (speedBtn) {
    speedBtn.addEventListener('click', function () {
      speedIndex = (speedIndex + 1) % SPEEDS.length;
      const speed = SPEEDS[speedIndex];
      speedBtn.textContent = speed + '×';
      window.dispatchEvent(new CustomEvent(GAME_EVENTS.SET_SPEED, { detail: { speed: speed } }));
    });
  }

  // ---------- Tower type selector (renderer UI concern) ----------
  // The order of TOWER_ORDER must match the hotkeys 1..5.
  const TOWER_ORDER = ['basic', 'sniper', 'cannon', 'splash', 'frost'];

  function selectType(type) {
    selectedType = type;
    document.querySelectorAll('#tower-types .type-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-type') === type);
    });
  }

  document.querySelectorAll('#tower-types .type-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      selectType(btn.getAttribute('data-type') || 'basic');
    });
  });

  // Hotkeys 1..5 select the tower type in TOWER_ORDER (mirrors the HUD buttons).
  window.addEventListener('keydown', function (evt) {
    const idx = ['1', '2', '3', '4', '5'].indexOf(evt.key);
    if (idx < 0 || idx >= TOWER_ORDER.length) return;
    if (evt.target && /INPUT|TEXTAREA/.test(evt.target.tagName)) return;
    selectType(TOWER_ORDER[idx]);
  });

  // ---------- Boss banner ----------
  let bossBannerEl = null;
  let bossBannerTimer = 0;
  const BOSS_BANNER_TTL = 90; // frames
  function onBossSpawned() {
    if (!bossBannerEl) bossBannerEl = document.getElementById('boss-banner');
    if (bossBannerEl) bossBannerEl.classList.remove('hidden');
    bossBannerTimer = BOSS_BANNER_TTL;
  }
  // Tick the boss banner off after its TTL.
  function tickBossBanner() {
    if (bossBannerTimer > 0) {
      bossBannerTimer--;
      if (bossBannerTimer === 0 && bossBannerEl) bossBannerEl.classList.add('hidden');
    }
  }

  // ---------- Income toast (wave-clear feedback) ----------
  let toastEl = null;
  let toastTimer = 0;
  const TOAST_TTL = 90; // frames
  function onWaveCleared(evt) {
    const d = evt.detail || {};
    if (!toastEl) toastEl = document.getElementById('toast');
    if (!toastEl) return;
    const interest = d.interest || 0;
    const wave = d.wave || 0;
    // "Wave X cleared — +$Y interest" (or "+$0" when no interest applies).
    toastEl.textContent = 'Wave ' + wave + ' cleared +$' + interest + ' interest';
    toastEl.classList.add('show');
    toastTimer = TOAST_TTL;
  }
  function tickToast() {
    if (toastTimer > 0) {
      toastTimer--;
      if (toastTimer === 0 && toastEl) toastEl.classList.remove('show');
    }
  }

  // ---------- Boss choice modal ----------
  let bossChoiceEl = null;
  let bossChoiceOptionsEl = null;
  function onBossModifierRequest(evt) {
    const d = evt.detail || {};
    const options = Array.isArray(d.options) ? d.options : [];
    if (!bossChoiceEl) bossChoiceEl = document.getElementById('boss-choice');
    if (!bossChoiceOptionsEl) bossChoiceOptionsEl = document.getElementById('bc-options');
    if (!bossChoiceEl || !bossChoiceOptionsEl) return;
    if (options.length === 0) return;

    bossChoiceOptionsEl.innerHTML = '';
    options.forEach(function (opt) {
      const btn = document.createElement('button');
      btn.className = 'bc-option';
      const strong = document.createElement('strong');
      strong.textContent = opt.label;
      const desc = document.createElement('span');
      desc.textContent = opt.desc;
      btn.appendChild(strong);
      btn.appendChild(desc);
      btn.addEventListener('click', function () {
        bossChoiceEl.classList.add('hidden');
        window.dispatchEvent(
          new CustomEvent(GAME_EVENTS.BOSS_MODIFIER, { detail: { choice: opt.id } })
        );
      });
      bossChoiceOptionsEl.appendChild(btn);
    });

    // Cancel / skip: send the wave with no modifier so the game can't soft-lock.
    const skipBtn = document.createElement('button');
    skipBtn.className = 'bc-option';
    skipBtn.textContent = 'Just send it — no modifier';
    skipBtn.addEventListener('click', function () {
      bossChoiceEl.classList.add('hidden');
      window.dispatchEvent(
        new CustomEvent(GAME_EVENTS.BOSS_MODIFIER, { detail: { choice: 'skip' } })
      );
    });
    bossChoiceOptionsEl.appendChild(skipBtn);

    bossChoiceEl.classList.remove('hidden');
  }

  // ---------- Game over overlay ----------
  const gameOverEl = document.getElementById('game-over');
  let gameOverShown = false;

  function onGameOver(evt) {
    const d = evt.detail || {};
    if (gameOverEl && !gameOverShown) {
      gameOverShown = true;
      const waveLabel = document.getElementById('game-over-wave');
      if (waveLabel) waveLabel.textContent = String(d.wave != null ? d.wave : 0);
      gameOverEl.classList.remove('hidden');
    }
  }

  // ---------- Restart (Play Again) ----------
  function resetDisplayState() {
    // Clear renderer-local state so the HUD/panel reflect the fresh game.
    display.cash = 0;
    display.lives = 0;
    display.wave = 0;
    display.nextWave = [];
    display.towers = [];
    display.enemies = [];
    display.hoverTile = null;
  }

  // ---------- Victory overlay ----------
  const victoryEl = document.getElementById('victory');
  function onVictory() {
    if (victoryEl) victoryEl.classList.remove('hidden');
  }

  function onRestart() {
    resetDisplayState();
    if (gameOverEl) gameOverEl.classList.add('hidden');
    if (victoryEl) victoryEl.classList.add('hidden');
    gameOverShown = false;

    // Reset pause/speed button labels so they stay in sync with game state.
    pausedLabel = false;
    if (pauseBtn) pauseBtn.textContent = '⏸ Pause';
    speedIndex = 0;
    if (speedBtn) speedBtn.textContent = '1×';
  }

  const playAgainBtn = document.getElementById('play-again');
  const victoryAgainBtn = document.getElementById('victory-again');
  if (playAgainBtn) {
    playAgainBtn.addEventListener('click', function () {
      window.dispatchEvent(new CustomEvent(GAME_EVENTS.RESTART, { detail: {} }));
    });
  }
  if (victoryAgainBtn) {
    victoryAgainBtn.addEventListener('click', function () {
      window.dispatchEvent(new CustomEvent(GAME_EVENTS.RESTART, { detail: {} }));
    });
  }

  // ---------- Wire up events ----------
  window.addEventListener(GAME_EVENTS.STATE_UPDATED, onStateUpdated);
  window.addEventListener(GAME_EVENTS.ENEMY_DAMAGED, onEnemyDamaged);
  window.addEventListener(GAME_EVENTS.GAME_OVER, onGameOver);
  window.addEventListener(GAME_EVENTS.BOSS_SPAWNED, onBossSpawned);
  window.addEventListener(GAME_EVENTS.BOSS_MODIFIER_REQUEST, onBossModifierRequest);
  window.addEventListener(GAME_EVENTS.WAVE_CLEARED, onWaveCleared);
  window.addEventListener(GAME_EVENTS.VICTORY, onVictory);
  window.addEventListener(GAME_EVENTS.RESTART, onRestart);

  // ---------- Onboarding overlay dismiss ----------
  // The how-to overlay is shown on first load. Dismissing it hides the
  // overlay for the rest of this session (kept in-memory, not persisted).
  const howtoEl = document.getElementById('howto');
  const howtoStart = document.getElementById('howto-start');
  if (howtoStart) {
    howtoStart.addEventListener('click', function () {
      if (howtoEl) howtoEl.classList.add('hidden');
    });
  }

  // ---------- Start the render loop ----------
  requestAnimationFrame(render);
})();
