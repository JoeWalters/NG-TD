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
    waveName: '—',  // flavor name of the upcoming wave pack
    nextWave: [],   // enemy-type composition of the upcoming wave
    towerTypes: {}, // { type: {range, cost, ...} } for placement previews
    grid: [],       // tile types, row-major: [row][col] or flat [row*COLS+col]
    path: [],       // list of {row, col} tiles that form the creep path
    towers: [],     // list of {row, col, type, range}
    enemies: [],    // list of {x, y, radius, color, hp, maxHp, hpPercent}
    damageNumbers: [], // list of {x, y, text, ttl}
    flashes: [],    // list of {x, y, ttl} red hit flashes
    hoverTile: null, // {row, col} under the mouse cursor
    // Path design: renderer-local drawing state for the player-designed maze.
    pathDesign: {
      // active (from Computer A) = design is PERMITTED (before wave 1).
      active: false,
      // designMode (renderer-local) = the player is actively shaping the maze
      // right now. Entered via the Edit/Create Path button, NOT automatically.
      designMode: false,
      drawn: [],          // ordered cells the player has drawn so far
      committed: false    // true once the drawn path has been accepted
    }
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

  // Damage numbers are tinted by the tower type that dealt the hit so the
  // damage source reads at a glance (frost = cyan, splash = green, etc.).
  const DMG_COLORS = {
    basic: '#fca5a5',
    sniper: '#d8b4fe',
    cannon: '#f87171',
    splash: '#86efac',
    frost: '#67e8f9',
    bounty: '#fdba74',
    buff: '#fde68a',
    redirect: '#6ee7b7'
  };

  function spawnDamage(x, y, text, color) {
    display.damageNumbers.push({ x, y, text, color: color || '#fca5a5', ttl: DAMAGE_TTL });
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
    // Precompute O(1) lookups once per frame so the per-cell loop avoids
    // scanning the whole path/tower arrays on every tile (O(cells x N) -> O(cells)).
    const pathSet = new Set();
    if (Array.isArray(display.path)) {
      for (const p of display.path) pathSet.add(p.row + ':' + p.col);
    }
    const occupiedSet = new Set();
    if (Array.isArray(display.towers)) {
      for (const t of display.towers) occupiedSet.add(t.row + ':' + t.col);
    }

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const x = col * TILE_PX;
        const y = row * TILE_PY;
        const cell = display.grid ? display.grid[gridIndex(row, col)] : undefined;
        const isPath = pathSet.has(row + ':' + col);

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
        const occupied = occupiedSet.has(row + ':' + col);
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

    // Draw the player's in-progress path design as a bright lane so they can
    // see exactly what maze they're shaping before committing.
    if (display.pathDesign.designMode && Array.isArray(display.pathDesign.drawn)) {
      const drawn = display.pathDesign.drawn;
      for (let i = 0; i < drawn.length; i++) {
        const c = drawn[i];
        const x = c.col * TILE_PX;
        const y = c.row * TILE_PY;
        const isStart = i === 0;
        const isEnd = i === drawn.length - 1;
        ctx.fillStyle = 'rgba(56,189,248,0.30)';
        ctx.fillRect(x, y, TILE_PX, TILE_PY);
        ctx.strokeStyle = 'rgba(56,189,248,0.85)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, TILE_PX - 2, TILE_PY - 2);
        // Mark the entry (top) and exit (bottom) ends with small markers.
        if (isStart) {
          ctx.fillStyle = '#22c55e';
          ctx.beginPath();
          ctx.arc(x + TILE_PX * 0.5, y + 6, 5, 0, Math.PI * 2);
          ctx.fill();
        }
        if (isEnd) {
          ctx.fillStyle = '#f87171';
          ctx.beginPath();
          ctx.arc(x + TILE_PX * 0.5, y + TILE_PY - 6, 5, 0, Math.PI * 2);
          ctx.fill();
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
    frost: '#22d3ee',
    bounty: '#f97316',
    buff: '#facc15',
    redirect: '#34d399'
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
      // Aim the barrel toward the last-fired target so towers visibly track
      // the creeps they're shooting (falls back to a neutral angle with none).
      let aim = null;
      if (typeof t.targetX === 'number' && typeof t.targetY === 'number') {
        aim = Math.atan2(t.targetY - cy, t.targetX - cx);
      }
      if (t.type === 'sniper') {
        // Long barrel that tracks the target (default: up-right).
        const a = aim == null ? -0.5 : aim;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.fillRect(2, -3, TILE_PX * 0.62, 6);
        ctx.restore();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
      } else if (t.type === 'cannon') {
        // Twin barrels that track the target (default: pointing right).
        const a = aim == null ? 0 : aim;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.fillRect(6, -8, TILE_PX * 0.55, 5);
        ctx.fillRect(6, 3, TILE_PX * 0.55, 5);
        ctx.restore();
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
      } else if (t.type === 'bounty') {
        // A coin: circular body with a dollar-style notch.
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(cx - 8, cy - 4, 16, 4);
        ctx.fillRect(cx - 2, cy - 8, 4, 16);
      } else if (t.type === 'buff') {
        // A radiating star / sparkle (aura tower).
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let i = 0; i < 4; i++) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(i * Math.PI / 2);
          ctx.fillRect(-2, -11, 4, 22);
          ctx.restore();
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(cx - 7, cy - 7, 14, 4);
      } else if (t.type === 'redirect') {
        // A curved arrow: an arc with a chevron head.
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 8, Math.PI * 0.1, Math.PI * 0.9);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(cx + 8, cy - 3);
        ctx.lineTo(cx + 12, cy + 2);
        ctx.lineTo(cx + 6, cy + 4);
        ctx.closePath();
        ctx.fill();
      } else {
        // Basic: single barrel that tracks the target (default: pointing right)
        const a = aim == null ? 0 : aim;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(-3, -2, TILE_PX * 0.44, 5);
        ctx.restore();
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

      // ----- Passive utility auras (always visible so the player can read
      // the field effect even without hovering the tower) -----
      if (typeof t.range === 'number' && t.range <= 20) {
        const auraRadius = t.range * TILE_PX;
        const acx = x + TILE_PX * 0.5;
        const acy = y + TILE_PY * 0.5;
        if (t.type === 'buff') {
          ctx.strokeStyle = 'rgba(250,204,21,0.55)';
          ctx.setLineDash([6, 5]);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(acx, acy, auraRadius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(250,204,21,0.06)';
          ctx.beginPath();
          ctx.arc(acx, acy, auraRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.fill();
        } else if (t.type === 'redirect') {
          ctx.strokeStyle = 'rgba(52,211,153,0.5)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(acx, acy, auraRadius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(52,211,153,0.05)';
          ctx.beginPath();
          ctx.arc(acx, acy, auraRadius, 0, Math.PI * 2);
          ctx.fill();
        }
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

  // ---------- Projectiles (visible tower shots) ----------
  // A projectile is a glowing bolt that travels from the firing tower's center
  // to the creep it shot at. Spawned when the renderer detects a fresh shot
  // (cooldownFrac spike) using the target position Computer A exposed.
  const projectiles = []; // {sx, sy, tx, ty, ttl}
  const PROJ_TTL = 6;

  // ---------- Screen shake ----------
  // A brief decaying camera offset for juicy feedback: boss spawns and creeps
  // leaking past the exit give a small jolt so the moment lands.
  let shake = 0;
  const SHAKE_DECAY = 0.82;

  function addShake(amount) {
    shake = Math.max(shake, amount);
  }

  // ---------- Death burst particles ----------
  // When the renderer notices an enemy vanish between frames (stable id gone),
  // it pops a short-lived burst of colored particles at that creep's spot.
  const particles = []; // {x, y, vx, vy, color, ttl}
  const PARTICLE_TTL = 24;

  function spawnDeathBurst(x, y, color) {
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 20 + Math.random() * 45;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        color: color,
        ttl: PARTICLE_TTL
      });
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const frac = p.ttl / PARTICLE_TTL; // 1 -> 0 (fade out)
      ctx.globalAlpha = Math.min(1, frac * 1.4);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1, 3 * frac + 1), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawProjectiles() {
    for (const p of projectiles) {
      const frac = 1 - p.ttl / PROJ_TTL;          // 0 -> 1 (progress to target)
      const x = p.sx + (p.tx - p.sx) * frac;
      const y = p.sy + (p.ty - p.sy) * frac;

      // Leading glow dot.
      ctx.globalAlpha = Math.min(1, frac * 1.5);
      ctx.fillStyle = '#fde68a';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Trailing tracer line from the tower to the bolt.
      ctx.strokeStyle = 'rgba(253,230,138,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.sx, p.sy);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }

  // ---------- Enemy rendering ----------
  // Eased health bars: each enemy id carries its *displayed* hp fraction and
  // eases toward the true value so damage reads as a smooth drain, not a step.
  const hpEase = {}; // id -> { shown }

  function drawEnemies() {
    for (const e of display.enemies) {
      const x = e.x;
      const y = e.y;
      const r = e.radius || 12;

      // Slowed creeps get a frosty tint so the slow is visible at a glance.
      // Shielded creeps get a steely gray body; regenerating creeps a green one.
      let fill = e.color || '#fbbf24';
      if (e.slow) fill = '#7dd3fc';
      else if (e.shield) fill = '#94a3b8';
      else if (e.regen) fill = '#4ade80';

      // Facing indicator: heading unit vector (velocity if the snapshot has it).
      let vx = 0;
      let vy = -1;
      if (typeof e.vx === 'number' && typeof e.vy === 'number' &&
          (Math.abs(e.vx) + Math.abs(e.vy)) > 0.01) {
        const len = Math.hypot(e.vx, e.vy);
        vx = e.vx / len;
        vy = e.vy / len;
      }
      const heading = Math.atan2(vy, vx);

      // Distinct silhouettes per creep type so the field reads at a glance:
      // normal/others = circle, scout = triangle (fast), tank = hexagon,
      // boss = crowned circle with a soft glow.
      ctx.fillStyle = fill;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (e.type === 'scout') {
        // Triangle pointing along the heading (apex ahead).
        const a = heading;
        ctx.moveTo(x + Math.cos(a) * r * 1.35, y + Math.sin(a) * r * 1.35);
        ctx.lineTo(x + Math.cos(a + 2.4) * r, y + Math.sin(a + 2.4) * r);
        ctx.lineTo(x + Math.cos(a - 2.4) * r, y + Math.sin(a - 2.4) * r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (e.type === 'tank') {
        // Flat-top hexagon (armored).
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 6 + i * Math.PI / 3;
          const px = x + Math.cos(a) * r;
          const py = y + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (e.type === 'boss') {
        // Circle body + a soft glow and a crown of three spikes.
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Crown spikes on top.
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(x - 9, y - r);
        ctx.lineTo(x - 5, y - r - 7);
        ctx.lineTo(x - 1, y - r);
        ctx.lineTo(x + 1, y - r - 8);
        ctx.lineTo(x + 5, y - r - 1);
        ctx.lineTo(x + 9, y - r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Boss glow aura so the big threat reads even from the map edge.
      if (e.type === 'boss') {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Eye dot showing the creep's heading (all shapes).
      const eyeX = x + vx * r * 0.45;
      const eyeY = y + vy * r * 0.45;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, Math.max(2, r * 0.18), 0, Math.PI * 2);
      ctx.fill();

      // Status trails: fading motes that lag behind the creep's motion so a
      // slow / regen reads even while the body is moving.
      if (e.slow || e.regen) {
        const trailColor = e.slow ? '#22d3ee' : '#22c55e';
        const backX = -vx;
        const backY = -vy;
        for (let t = 1; t <= 3; t++) {
          const d = t * r * 0.5;
          ctx.globalAlpha = 0.35 * (1 - t / 4);
          ctx.fillStyle = trailColor;
          ctx.beginPath();
          ctx.arc(x + backX * d, y + backY * d, Math.max(1.5, r * 0.22), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      if (e.slow) {
        // A small icy ring around slowed creeps.
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (e.shield) {
        // A steel ring marks an armored (shielded) creep.
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (e.regen) {
        // A green ring marks a regenerating creep.
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
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
        // Ease the *displayed* fraction toward the true one (per enemy id).
        let shown = frac;
        if (e.id != null) {
          const st = hpEase[e.id];
          if (!st) {
            hpEase[e.id] = { shown: frac };
          } else {
            st.shown += (frac - st.shown) * 0.25;
            shown = st.shown;
          }
        }
        const barW = r * 2;
        const barH = 4;
        const bx = x - barW / 2;
        const by = y - r - 8;
        // Dark backing + border so the bar reads on any tile.
        ctx.fillStyle = 'rgba(15,23,42,0.8)';
        ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
        ctx.fillStyle = '#4ade80';
        ctx.fillRect(bx, by, barW * shown, barH);
        // Bosses get a gold health bar so they stand out.
        if (e.type === 'boss') {
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(bx, by, barW * shown, barH);
        }
      }
    }

    // Drop easing state for creeps that are gone (died/leaked) so it can't grow.
    // Note: for...in yields string keys, so store ids as strings in the Set
    // or Set.has() would never match the number ids (1 !== '1').
    const liveIds = new Set();
    for (const e of display.enemies) if (e.id != null) liveIds.add(String(e.id));
    for (const id in hpEase) {
      if (!liveIds.has(id)) delete hpEase[id];
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

  // ---------- Ambient background + vignette ----------
  // A sparse field of slowly-twinkling dust motes drifting over the grid adds
  // depth, and a radial vignette darkens the canvas edges for focus.
  let bgTime = 0;
  const BG_DOTS = (function () {
    // Deterministic pseudo-random dots (no per-frame Math.random flicker).
    const dots = [];
    let s = 1234567;
    function rnd() { s = (s * 16807) % 2147483647; return s / 2147483647; }
    for (let i = 0; i < 42; i++) {
      dots.push({
        x: rnd() * 640, y: rnd() * 640,
        r: 1 + rnd() * 1.6, phase: rnd() * Math.PI * 2
      });
    }
    return dots;
  })();

  function drawBackground() {
    bgTime += 1;
    for (const d of BG_DOTS) {
      const tw = 0.5 + 0.5 * Math.sin(bgTime * 0.05 + d.phase);
      ctx.globalAlpha = tw * 0.35;
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawVignette() {
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2;
    const maxR = Math.hypot(w, h) / 2;
    const g = ctx.createRadialGradient(cx, cy, maxR * 0.55, cx, cy, maxR);
    g.addColorStop(0, 'rgba(2,6,23,0)');
    g.addColorStop(1, 'rgba(2,6,23,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // ---------- Damage numbers ----------
  function drawDamageNumbers() {
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const d of display.damageNumbers) {
      const alpha = Math.min(1, d.ttl / 12);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = d.color || '#fca5a5';
      ctx.fillText(d.text, d.x, d.y);
      ctx.globalAlpha = 1;
    }
  }

  // Flash a HUD value with a CSS pop animation (up = green, down = red).
  function flashHud(el, cls) {
    if (!el) return;
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth; // restart the animation even if re-triggered quickly
    el.classList.add(cls);
    setTimeout(function () {
      el.classList.remove('flash-up', 'flash-down');
    }, 350);
  }

  // ---------- HUD update ----------
  // Build a short summary of the upcoming wave, e.g. "6 normal · 2 scout".
  function nextWaveSummary(waveTypes) {
    if (!waveTypes || waveTypes.length === 0) return '—';
    const counts = {};
    for (const t of waveTypes) counts[t] = (counts[t] || 0) + 1;
    const parts = [];
    const order = ['normal', 'scout', 'tank', 'boss', 'shielded', 'regener'];
    for (const t of order) {
      if (counts[t]) parts.push(counts[t] + ' ' + t + (counts[t] > 1 ? 's' : ''));
    }
    return parts.join(' · ');
  }

  // Per-type colors for the upcoming-wave dot preview (mirrors enemy tints).
  const WAVE_DOT_COLORS = {
    normal: '#fbbf24', scout: '#38bdf8', tank: '#f59e0b',
    boss: '#dc2626', shielded: '#94a3b8', regener: '#4ade80'
  };

  // Render one small colored dot per upcoming creep (capped so big waves
  // don't overflow the HUD). Pure DOM, driven by the nextWave snapshot.
  function drawWaveDots() {
    const dotsEl = document.getElementById('next-wave-dots');
    if (!dotsEl) return;
    const wave = Array.isArray(display.nextWave) ? display.nextWave : [];
    // Cap at 24 dots; beyond that just show a '+' overflow marker.
    const shown = wave.slice(0, 24);
    const overflow = wave.length > 24;
    let html = '';
    for (const t of shown) {
      const c = WAVE_DOT_COLORS[t] || '#94a3b8';
      html += '<span class="nw-dot" style="background:' + c + '"></span>';
    }
    if (overflow) html += '<span class="nw-dot" style="background:rgba(255,255,255,0.6)"></span>';
    dotsEl.innerHTML = html;
  }

  function updateHUD() {
    if (cashEl) cashEl.textContent = String(display.cash);
    if (livesEl) livesEl.textContent = String(display.lives);
    if (waveEl) waveEl.textContent = String(display.wave);
    if (nextWaveEl) nextWaveEl.textContent = nextWaveSummary(display.nextWave);
    drawWaveDots();
    // Telegraph the upcoming wave's flavor name alongside the composition.
    const nameEl = document.getElementById('next-wave-name');
    if (nameEl) nameEl.textContent = display.waveName;

    // Path design controls. The Edit/Create Path button is the OPT-IN entry to
    // maze design and only shows while design is still permitted (before wave
    // 1). Done/Reset are shown only while the player is actively designing.
    // Start Wave is ALWAYS available — a player who skips design simply plays
    // on the default S-curve maze, and can place towers freely meanwhile.
    const permitted = display.pathDesign.active;
    const designing = display.pathDesign.designMode;
    if (pathEditBtn) {
      pathEditBtn.classList.toggle('hidden', !permitted || designing);
      // Label reflects whether a path already exists: Create vs Edit.
      pathEditBtn.textContent = display.pathDesign.committed ? 'Edit Path' : 'Create Path';
    }
    if (pathDoneBtn) pathDoneBtn.classList.toggle('hidden', !designing);
    if (pathResetBtn) pathResetBtn.classList.toggle('hidden', !designing);
    if (startBtn) startBtn.classList.remove('hidden');

    // If design permission ends (wave 1 starts), force out of design mode.
    if (!permitted && designing) {
      display.pathDesign.designMode = false;
      display.pathDesign.drawn.length = 0;
    }
  }

  // Draw the design-mode instruction banner over the canvas.
  function drawPathDesignHud() {
    if (!display.pathDesign.designMode) return;
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = '#1e293b';
    roundRect(24, 20, canvas.width - 48, 34, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(56,189,248,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Optional: draw your own maze, or hit Start Wave for the default path.', 36, 37);
    ctx.restore();
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

    const el = (id) => document.getElementById(id);
    el('th-title').textContent = tower.type.toUpperCase();
    el('th-level').textContent = String(tower.level);
    // Read effective stats straight from Computer A's snapshot so the HUD
    // uses the exact same formulas as the simulation (no drift possible).
    el('th-damage').textContent = typeof tower.damage === 'number' ? String(Math.round(tower.damage)) : '—';
    el('th-range').textContent = typeof tower.range === 'number' ? String(tower.range) : '—';
    el('th-mode').textContent = String(tower.targetMode || 'nearest');
    el('th-upgrade').textContent = typeof tower.upgradeCost === 'number' ? String(tower.upgradeCost) : '—';

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
    // Camera shake: offset all game drawing by a decaying random jitter.
    let shaken = false;
    if (shake > 0.1) {
      shaken = true;
      ctx.save();
      ctx.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);
      shake *= SHAKE_DECAY;
    }
    drawGrid();
    drawBackground();
    drawTowers();
    drawProjectiles();
    drawMuzzleFlashes();
    drawEnemies();
    drawParticles();
    drawFlashes();
    drawDamageNumbers();
    if (shaken) ctx.restore();
    drawVignette();
    drawPathDesignHud();
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

    // tick projectile lifetimes (renderer-local)
    for (let i = projectiles.length - 1; i >= 0; i--) {
      projectiles[i].ttl -= 1;
      if (projectiles[i].ttl <= 0) {
        projectiles.splice(i, 1);
      }
    }

    // tick particle lifetimes + move (renderer-local)
    for (let i = particles.length - 1; i >= 0; i--) {
      particles[i].ttl -= 1;
      particles[i].x += particles[i].vx * 0.05;
      particles[i].y += particles[i].vy * 0.05;
      if (particles[i].ttl <= 0) {
        particles.splice(i, 1);
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
    if (typeof s.cash === 'number') {
      const prev = display.cash;
      display.cash = s.cash;
      // Income/loss feedback: flash the cash readout so gains land.
      if (s.cash > prev) flashHud(cashEl, 'flash-up');
      else if (s.cash < prev) flashHud(cashEl, 'flash-down');
    }
    if (typeof s.lives === 'number') {
      const prev = display.lives;
      display.lives = s.lives;
      // Losing a life is a big negative moment — flash lives red.
      if (s.lives < prev) flashHud(livesEl, 'flash-down');
    }
    if (typeof s.wave === 'number') display.wave = s.wave;
    if (typeof s.waveName === 'string') display.waveName = s.waveName;
    if (Array.isArray(s.nextWave)) display.nextWave = s.nextWave;
    if (s.towerTypes && typeof s.towerTypes === 'object') display.towerTypes = s.towerTypes;

    if (s.grid) display.grid = s.grid;
    if (s.path) display.path = s.path;

    // Path design state: only copy while the player can still design.
    if (s.pathDesign && typeof s.pathDesign === 'object') {
      display.pathDesign.active = !!s.pathDesign.active;
      display.pathDesign.committed = !!s.pathDesign.committed;
      // While designing, the renderer's local `drawn` array is the source of
      // truth (it records the exact click/drag sequence). Computer A's snapshot
      // may lag by a frame, so only adopt it once the design is committed.
      if (!display.pathDesign.active) {
        if (Array.isArray(s.pathDesign.drawn)) {
          display.pathDesign.drawn = s.pathDesign.drawn.map(function (c) {
            return { row: c.row, col: c.col };
          });
        }
      }
    }

    // Detect firing: a tower's cooldownFrac jumping from low to high means it shot.
    if (s.towers) {
      display.towers = s.towers;
      for (const t of s.towers) {
        const key = t.row + '-' + t.col + '-' + t.type;
        const prev = lastCooldownFrac[key] || 0;
        const cur = typeof t.cooldownFrac === 'number' ? t.cooldownFrac : 0;
        if (cur > 0.8 && prev <= 0.8) {
          const sx = (t.col + 0.5) * TILE_PX;
          const sy = (t.row + 0.5) * TILE_PY;
          // Muzzle flash at the barrel tip: offset toward the fired target so
          // the spark appears where the barrel points, not the tile center.
          let mx = sx, my = sy;
          if (typeof t.targetX === 'number' && typeof t.targetY === 'number') {
            const dx = t.targetX - sx;
            const dy = t.targetY - sy;
            const len = Math.hypot(dx, dy) || 1;
            mx = sx + (dx / len) * TILE_PX * 0.42;
            my = sy + (dy / len) * TILE_PX * 0.42;
          }
          muzzleFlashes.push({ x: mx, y: my, ttl: MUZZLE_TTL });
          // Visible projectile flying toward the creep this tower just shot.
          if (typeof t.targetX === 'number' && typeof t.targetY === 'number') {
            projectiles.push({ sx: sx, sy: sy, tx: t.targetX, ty: t.targetY, ttl: PROJ_TTL });
          }
        }
        lastCooldownFrac[key] = cur;
      }
    }

    if (s.enemies) {
      // Detect deaths: enemies present last frame but gone now (stable id
      // missing) burst into particles at their last known position.
      const prev = display.enemies;
      if (Array.isArray(prev)) {
        const nowIds = new Set();
        for (const e of s.enemies) if (e.id != null) nowIds.add(e.id);
        for (const e of prev) {
          if (e.id != null && !nowIds.has(e.id)) {
            // A creep vanishing at the bottom exit leaked past the maze — a
            // red burst + a jolt so the loss reads as a hit to the player.
            if (e.y > canvas.height - TILE_PY) {
              spawnDeathBurst(e.x, e.y, '#f87171');
              addShake(5);
            } else {
              spawnDeathBurst(e.x, e.y, e.color || '#fbbf24');
            }
          }
        }
      }
      display.enemies = s.enemies;
    }
  }

  // Computer A reports damage -> brief red flash + floating damage text.
  function onEnemyDamaged(evt) {
    const d = evt.detail;
    if (!d) return;
    if (typeof d.x === 'number' && typeof d.y === 'number') {
      spawnFlash(d.x, d.y);
    }
    const color = DMG_COLORS[d.type] || '#fca5a5';
    spawnDamage(d.x, d.y, String(d.amount != null ? d.amount : '-0'), color);
  }

  // ---------- Mouse tracking (for hover range indicator) ----------
  let designDragging = false;
  canvas.addEventListener('mousemove', function (evt) {
    const p = canvasPoint(evt);
    const tile = tileAt(p.x, p.y) || null;
    display.hoverTile = tile;
    // Drag-to-draw: while the mouse is down in path-design mode, keep chaining
    // adjacent cells into the drawn path.
    if (designDragging && display.pathDesign.designMode && tile) {
      if (designAddCell(tile)) {
        dispatchPathDraw();
      }
    }
  });

  canvas.addEventListener('mousedown', function (evt) {
    if (display.pathDesign.designMode) designDragging = true;
  });

  window.addEventListener('mouseup', function () {
    designDragging = false;
  });

  canvas.addEventListener('mouseleave', function () {
    display.hoverTile = null;
  });

  // ---------- Path design helpers ----------
  // Add a tile to the drawn path (only cardinally adjacent to the last tile,
  // and never a blocked/scenery tile). Returns true if the tile was added.
  function designAddCell(tile) {
    const drawn = display.pathDesign.drawn;
    if (drawn.length === 0) {
      // The path must start on the top edge (row 0).
      if (tile.row !== 0) return false;
    } else {
      const last = drawn[drawn.length - 1];
      const dr = Math.abs(tile.row - last.row);
      const dc = Math.abs(tile.col - last.col);
      // Only a single cardinal step between consecutive tiles.
      if (dr + dc !== 1) return false;
      // No repeats (would create a loop).
      const dup = drawn.some(function (c) {
        return c.row === tile.row && c.col === tile.col;
      });
      if (dup) return false;
    }
    // Can't draw over scenery (blocked) tiles.
    if (display.grid && display.grid[gridIndex(tile.row, tile.col)] === 2) return false;
    drawn.push({ row: tile.row, col: tile.col });
    return true;
  }

  // Push the current drawn cells to Computer A (it validates & stores them).
  function dispatchPathDraw() {
    window.dispatchEvent(
      new CustomEvent(GAME_EVENTS.PATH_DRAW, {
        detail: { cells: display.pathDesign.drawn.map(function (c) {
          return { row: c.row, col: c.col };
        }) }
      })
    );
  }

  // ---------- Click -> grid coords -> dispatch build / upgrade / path request ----------
  canvas.addEventListener('click', function (evt) {
    const p = canvasPoint(evt);
    const tile = tileAt(p.x, p.y);
    if (!tile) return;

    // Path design mode: clicks draw the creep lane instead of building.
    if (display.pathDesign.designMode) {
      if (designAddCell(tile)) {
        dispatchPathDraw();
      }
      return;
    }

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

  // touchmove keeps the hover tile (range ring + tower panel) live while the
  // finger drags across tiles — matches the desktop mousemove behavior so
  // mobile players can preview a tower's range ring before placing it.
  canvas.addEventListener('touchmove', function (evt) {
    if (!touchActive) return;
    if (evt.touches && evt.touches.length > 0) {
      const t = evt.touches[0];
      const p = canvasPoint(t);
      display.hoverTile = tileAt(p.x, p.y) || null;
      // Drag-to-draw: while touching in path-design mode, chain adjacent cells.
      if (display.pathDesign.designMode && display.hoverTile) {
        if (designAddCell(display.hoverTile)) {
          dispatchPathDraw();
        }
      }
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

  // ---------- Path design buttons (Edit/Create, Done, Reset) ----------
  const pathEditBtn = document.getElementById('path-edit');
  const pathDoneBtn = document.getElementById('path-done');
  const pathResetBtn = document.getElementById('path-reset');
  if (pathEditBtn) {
    // Enter maze design. This is OPT-IN: normal clicks keep placing towers
    // until the player asks to shape the path.
    pathEditBtn.addEventListener('click', function () {
      if (!display.pathDesign.active) return; // only before wave 1
      display.pathDesign.designMode = true;
      // Start a fresh drawing (the existing committed path stays on the grid
      // as a reference while they redraw).
      display.pathDesign.drawn.length = 0;
    });
  }
  if (pathDoneBtn) {
    pathDoneBtn.addEventListener('click', function () {
      if (!display.pathDesign.designMode) return;
      window.dispatchEvent(new CustomEvent(GAME_EVENTS.COMMIT_PATH, { detail: {} }));
      // Leave design mode; the committed path is now locked in until wave 1.
      display.pathDesign.designMode = false;
    });
  }
  if (pathResetBtn) {
    pathResetBtn.addEventListener('click', function () {
      if (!display.pathDesign.designMode) return;
      // Clear the renderer-local drawing so the design starts fresh.
      display.pathDesign.drawn.length = 0;
      window.dispatchEvent(new CustomEvent(GAME_EVENTS.RESET_PATH, { detail: {} }));
    });
  }

  // Path status feedback (valid/invalid) — brief toast.
  function onPathStatus(evt) {
    const d = evt.detail || {};
    if (!toastEl) toastEl = document.getElementById('toast');
    if (!toastEl) return;
    if (d.ok) {
      toastEl.textContent = 'Path locked in!';
      toastEl.style.borderColor = '#38bdf8';
      toastEl.style.color = '#38bdf8';
    } else {
      const reason = d.reason === 'reset' ? 'Path reset to default.'
        : 'Invalid path — needs to run from the top edge to the bottom edge.';
      toastEl.textContent = reason;
      toastEl.style.borderColor = '#f87171';
      toastEl.style.color = '#f87171';
    }
    toastEl.classList.add('show');
    toastTimer = TOAST_TTL;
  }

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
  // The order of TOWER_ORDER must match the hotkeys 1..8.
  const TOWER_ORDER = ['basic', 'sniper', 'cannon', 'splash', 'frost', 'bounty', 'buff', 'redirect'];

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

  // Hotkeys 1..9 select the tower type in TOWER_ORDER (mirrors the HUD buttons).
  window.addEventListener('keydown', function (evt) {
    const idx = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].indexOf(evt.key);
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
    addShake(6); // jolt when the boss lands so its arrival reads.
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
    const kills = d.kills || 0;
    const killCash = d.killCash || 0;
    const wave = d.wave || 0;
    // "Wave X cleared — +$Y interest" (or "+$0" when no interest applies).
    toastEl.textContent = 'Wave ' + wave + ' cleared · ' + kills + ' kills ($' + killCash + ') · +$' + interest + ' interest';
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
      const killsLabel = document.getElementById('game-over-kills');
      if (killsLabel) killsLabel.textContent = String(d.kills != null ? d.kills : 0);
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
    display.pathDesign.active = false;
    display.pathDesign.designMode = false;
    display.pathDesign.drawn = [];
    display.pathDesign.committed = false;
    // Inform the player that tower building is free and maze design is opt-in.
    if (!toastEl) toastEl = document.getElementById('toast');
    if (toastEl) {
      toastEl.textContent = 'Place towers freely — hit Create Path to shape your own maze (optional).';
      toastEl.style.borderColor = '#38bdf8';
      toastEl.style.color = '#38bdf8';
      toastEl.classList.add('show');
      toastTimer = TOAST_TTL;
    }
  }

  // ---------- Victory overlay ----------
  const victoryEl = document.getElementById('victory');
  function onVictory(evt) {
    const d = evt.detail || {};
    if (victoryEl) {
      const killsLabel = document.getElementById('victory-kills');
      if (killsLabel) killsLabel.textContent = String(d.kills != null ? d.kills : 0);
      victoryEl.classList.remove('hidden');
    }
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
  window.addEventListener(GAME_EVENTS.PATH_STATUS, onPathStatus);

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
