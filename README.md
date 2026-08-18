# NG-TD

**N**ot very **G**ood **T**ower **D**efense — a browser tower-defense game built as a
two-computer (A/B) split: one module owns all game logic and state, the other owns
rendering, canvas and UI. They communicate purely through a shared event bus, so the
logic never touches the DOM and the renderer never mutates game state.

## How to run

No build step, no dependencies — but the game must be **served over HTTP**, not opened
as a plain local file. The recommended way is Python's built-in static server:

```bash
# 1) from the project folder, start the server
python3 -m http.server 8000

# 2) open the game in your browser
#    http://localhost:8000
```

Any other static file server works too (e.g. `npx serve .`, `php -S`), but
`python3 -m http.server 8000` is the zero-dependency default. The page loads its
three scripts in a fixed order, so serve the whole folder rather than opening
`index.html` directly.

The page loads three scripts in this fixed order:

1. `config.js` — shared config, event names, and **all** balance tunables.
2. `game_logic.js` — Computer A: state, pathfinding, spawning, targeting, damage, cash.
3. `renderer_ui.js` — Computer B: canvas, HUD, input, overlays.

## How to play

1. **Design the maze (optional).** Drag from the green top edge to the red bottom
   edge to draw your own lane, then hit **Done Path**. Skip it and the default
   S-curve maze is used — hit **Start Wave** to begin.
2. **Place towers** on empty tiles along the path. Click a tower to **upgrade**,
   right-click to **sell**, press **M** (or the Mode button) to cycle its targeting.
3. **Start Wave** to send the next pack. Keep **Lives** above 0 — each leak costs a life (bigger threats leak more: tank 2, boss 5).
4. Clear **20 waves** to win. Lose all 20 lives and it's game over.

## Controls

| Action | Desktop | Mobile |
|---|---|---|
| Build / upgrade | left-click | tap |
| Sell | right-click | tower panel **Sell** button |
| Cycle targeting (N/F/S) | `M` key | tower panel **Mode** button |
| Draw path | drag with mouse | drag with finger (live range ring) |
| Pause | **⏸ Pause** button | same |
| Speed | **1×/2×/3×** button | same |

Targeting modes: **N**earest (default), **F**irst (furthest along path), **S**trong
(highest *current* HP — prioritizes the most dangerous remaining target).

## Tower roster

| Tower | Cost | Role |
|---|---|---|
| Basic | 50 | Cheap all-rounder single-target damage. |
| Sniper | 80 | Long range, picks off one target, high damage. |
| Cannon | 60 | Big, slow, heavy single-target hits. |
| Splash | 90 | Area damage on everything near its target. |
| Frost | 70 | Low damage, but slows creeps (pairs great with Splash). |
| Bounty | 100 | Pays bonus cash for every kill inside its range. |
| Buff | 110 | Aura that boosts nearby towers' damage. |
| Redirect | 130 | Teleports creeps a few steps back along the path, forcing them to re-walk that stretch. |

## Enemies

- **normal** — standard creep.
- **scout** — half HP, double speed.
- **tank** — 4× HP, slow.
- **boss** — 15× HP, very slow, big payout.
- **shielded** — armored: resists single-target shots unless splash/pierce.
- **regener** — heals over time unless recently damaged.

Enemies get tougher every wave (+15% HP) and waves grow (+2 enemies per wave).
Clearing a wave earns interest (5% of unspent cash, capped) from wave 2 onward.

## Architecture

The two halves never share variables — they talk through `CustomEvent`s:

- **A → B:** `STATE_UPDATED` (a render-only snapshot each frame), `ENEMY_DAMAGED`,
  `WAVE_CLEARED`, `BOSS_SPAWNED`, `BOSS_MODIFIER_REQUEST`, `VICTORY`, `GAME_OVER`,
  `PATH_STATUS`.
- **B → A:** `TOWER_PLACED`, `UPGRADE_TOWER`, `SELL_TOWER`, `CHANGE_TARGET_MODE`,
  `WAVE_STARTED`, `TOGGLE_PAUSE`, `SET_SPEED`, `RESTART`, `BOSS_MODIFIER`, `PATH_DRAW`,
  `COMMIT_PATH`, `RESET_PATH`.

Key design guarantees:

- **Single source of truth for balance.** All tunables (HP per wave, enemy counts,
  interest rate, upgrade multipliers, boss HP, victory wave) live in
  `config.js → CONFIG.BALANCE` and are referenced from game logic — no
  magic-number drift.
- **HUD can't lie.** Effective tower stats (damage, range, upgrade cost) are computed
  in the logic and shipped through the snapshot; the HUD displays them verbatim.
- **Per-frame snapshot is cheap.** The upcoming-wave queue is cached per wave, and the
  grid render precomputes path/occupied lookup sets instead of scanning arrays per tile.
- **No soft-locks.** The boss-choice modal has a "send it anyway" fallback, and
  restart resets pause/speed/button labels so "Play Again" always starts clean.

## Project layout

```
config.js        shared config, event names, balance tunables
game_logic.js    Computer A: simulation & state (no DOM)
renderer_ui.js   Computer B: canvas, HUD, input (no game state)
index.html       single-page shell, loads the three scripts in order
```
