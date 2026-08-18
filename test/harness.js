// Node test harness for Computer A (game_logic.js).
// Mocks the minimal browser surface game_logic.js touches, then drives the
// game deterministically frame-by-frame so we can assert on snapshots.
'use strict';

const fs = require('fs');
const path = require('path');

// ---------- Minimal browser mock ----------
const listeners = {};           // eventName -> [fn]
const emitted = [];             // [{event, detail}] every dispatched event
let rafCallback = null;         // the pending requestAnimationFrame callback
let lastRafTs = 0;

const win = {
  addEventListener: function (name, fn) {
    (listeners[name] = listeners[name] || []).push(fn);
  },
  dispatchEvent: function (evt) {
    emitted.push({ event: evt.type, detail: evt.detail });
    const fns = listeners[evt.type] || [];
    for (const fn of fns) fn(evt);
  },
  requestAnimationFrame: function (cb) { rafCallback = cb; },
  __tdDebug: null,
  CustomEvent: class {
    constructor(type, opts) {
      this.type = type;
      this.detail = (opts && opts.detail) || {};
    }
  }
};

// Load config.js then game_logic.js into the mock window.
const CONFIG_SRC = fs.readFileSync(path.join(__dirname, '../config.js'), 'utf8');
const LOGIC_SRC = fs.readFileSync(path.join(__dirname, '../game_logic.js'), 'utf8');

// config.js assigns `const CONFIG = {...}` at top-level; run both via vm in a
// shared context so the logic module can see CONFIG and GAME_EVENTS.
const vm = require('vm');
const ctx = vm.createContext({ window: win, console });
// config.js uses top-level `const`; those become globals in the context.
// game_logic.js calls bare `requestAnimationFrame` / `CustomEvent` globals.
ctx.requestAnimationFrame = win.requestAnimationFrame.bind(win);
ctx.CustomEvent = win.CustomEvent;
ctx.addEventListener = win.addEventListener.bind(win);
ctx.dispatchEvent = win.dispatchEvent.bind(win);
vm.runInContext(CONFIG_SRC, ctx);
vm.runInContext(LOGIC_SRC, ctx);

// ---------- Driver API ----------
function fire(name, detail) {
  win.dispatchEvent(new win.CustomEvent(name, { detail }));
  return emitted;
}

// Advance the game loop by `frames` frames of `dt` seconds each.
function tick(dt, frames) {
  for (let i = 0; i < frames; i++) {
    lastRafTs += dt * 1000;
    const cb = rafCallback;
    rafCallback = null;
    cb(lastRafTs);
  }
  return emitted;
}

// Last STATE_UPDATED snapshot emitted (the renderer's view of the world).
function latestSnapshot() {
  let snap = null;
  for (let i = emitted.length - 1; i >= 0; i--) {
    if (emitted[i].event === 'td:state_updated') { snap = emitted[i].detail; break; }
  }
  return snap;
}

function reset() {
  emitted.length = 0;
  lastRafTs = 0;
}

module.exports = { win, emitted, fire, tick, latestSnapshot, reset, fireEventName: (n) => n };
