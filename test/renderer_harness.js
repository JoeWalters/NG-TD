// Node test harness for Computer B (renderer_ui.js).
// Mocks document/canvas/window, loads config.js + renderer_ui.js, then drives
// the render loop with synthetic STATE_UPDATED snapshots and asserts the
// renderer draws without throwing. The canvas 2D context counts draw calls so
// tests can assert on visible behavior (projectiles, shapes, effects, etc.).
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const drawCounts = {};
function bump(name) { drawCounts[name] = (drawCounts[name] || 0) + 1; }
const styleLog = []; // {prop, value} for fillStyle/strokeStyle assignments
const rectLog = []; // fillRect args [x,y,w,h] for health-bar assertions
function resetRectLog() { rectLog.length = 0; }

// ---------- Canvas 2D context mock ----------
const ctx2d = new Proxy({}, {
  get(target, prop) {
    // Return a no-op counting function for any method.
    if (typeof prop === 'string') {
      const fn = function (...args) {
        bump(prop);
        if (prop === 'fillRect') rectLog.push(args.slice(0, 4));
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return { addColorStop: () => {} };
        }
        return undefined;
      };
      return fn;
    }
    return target[prop];
  },
  set(target, prop, val) {
    if (prop === 'fillStyle' || prop === 'strokeStyle') styleLog.push({ prop, value: val });
    target[prop] = val;
    return true;
  }
});
function countStyle(value) {
  return styleLog.filter(function (s) { return s.value === value; }).length;
}
function resetStyleLog() { styleLog.length = 0; }

function makeEl(id) {
  return {
    id,
    textContent: '',
    style: {},
    className: '',
    innerHTML: '',
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, force) { if (force === undefined) { if (this._set.has(c)) this._set.delete(c); else this._set.add(c); } else if (force) this._set.add(c); else this._set.delete(c); },
      contains(c) { return this._set.has(c); }
    },
    addEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 640 }; },
    appendChild() {}
  };
}

const els = {};
const listeners = {};
let rafCallback = null;
let lastTs = 0;

const win = {
  addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
  dispatchEvent(evt) {
    const fns = listeners[evt.type] || [];
    for (const fn of fns) fn(evt);
  },
  requestAnimationFrame(cb) { rafCallback = cb; },
  CustomEvent: class { constructor(t, o) { this.type = t; this.detail = (o && o.detail) || {}; } }
};

const document = {
  getElementById(id) {
    if (id === 'game-canvas') return canvas;
    if (!els[id]) els[id] = makeEl(id);
    return els[id];
  },
  querySelectorAll() { return []; },
  createElement() { return makeEl('dyn'); }
};

const canvas = {
  width: 640,
  height: 640,
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 640 }; },
  getContext() { return ctx2d; },
  addEventListener() {}
};

const ctx = vm.createContext({
  window: win,
  document,
  canvas,
  console,
  requestAnimationFrame: (cb) => { rafCallback = cb; },
  setTimeout: (fn, ms) => { /* no-op timer */ },
  CustomEvent: win.CustomEvent,
  addEventListener: win.addEventListener.bind(win),
  dispatchEvent: win.dispatchEvent.bind(win),
  ontouchstart: undefined
});

const CONFIG_SRC = fs.readFileSync(path.join(__dirname, '../config.js'), 'utf8');
const RENDER_SRC = fs.readFileSync(path.join(__dirname, '../renderer_ui.js'), 'utf8');
vm.runInContext(CONFIG_SRC, ctx);
vm.runInContext(RENDER_SRC, ctx);

// ---------- Driver ----------
function fire(name, detail) {
  win.dispatchEvent(new win.CustomEvent(name, { detail }));
}

function renderFrames(n) {
  for (let i = 0; i < n; i++) {
    lastTs += 16.7;
    const cb = rafCallback;
    rafCallback = null;
    cb(lastTs);
  }
}

function resetDrawCounts() {
  for (const k in drawCounts) delete drawCounts[k];
}

function getCount(name) { return drawCounts[name] || 0; }

// A realistic snapshot with a tower about to fire at an enemy.
function makeSnapshot(opts) {
  opts = opts || {};
  return {
    cash: 150, lives: 20, wave: 1, waveName: 'First Contact',
    nextWave: ['normal', 'normal'],
    grid: new Array(100).fill(0),
    path: [{ row: 0, col: 0 }],
    pathDesign: { active: false, drawn: [], committed: true },
    towerTypes: {
      basic: { range: 2.5 }, sniper: { range: 5 }, cannon: { range: 3 },
      splash: { range: 2.5 }, frost: { range: 3 }, bounty: { range: 2.5 },
      buff: { range: 2 }, magnet: { range: 2.5 }, redirect: { range: 1.2 }
    },
    towers: opts.towers || [],
    enemies: opts.enemies || []
  };
}

module.exports = {
  fire, renderFrames, resetDrawCounts, getCount,
  makeSnapshot, ctx2d, drawCounts, countStyle, resetStyleLog,
  el: (id) => (els[id] ? els[id] : document.getElementById(id)),
  resetRectLog, rectLog
};
