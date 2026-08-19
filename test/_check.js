const lh = require('./harness.js');
const dbg = lh.win.__tdDebug;
let ok = true;
const chk = (n,c)=>{ console.log((c?'PASS':'FAIL')+'  '+n); ok = ok && c; };
const TILE = 64;

lh.fire('td:restart',{}); lh.tick(0.02,1);
const snap = lh.latestSnapshot(), grid = snap.grid;
const spot = [[0,5],[0,4],[1,4],[1,5]].find(([r,c])=> r>=0&&r<10&&c>=0&&c<10 && grid[r*10+c]===0);
chk('placed frost tower', !!spot);
lh.fire('td:tower_placed',{row:spot[0],col:spot[1],type:'frost'}); lh.tick(0.02,1);
dbg.spawn('normal'); dbg.spawn('normal'); dbg.spawn('normal');

// Wait for the frost to fire (enemy hp drops from 63.75 to 58.75).
let fired = false;
for(let f=0; f<60 && !fired; f++){
  lh.tick(0.05,1);
  const e = dbg.state().enemies[0];
  if(e && e.hp < 63.7) fired = true;
}
chk('frost fired', fired);
// Measure displacement over 0.5s (10 ticks). Slowed: 60*0.4=24px/s -> 12px/0.5s.
// Unslowed: 60px/s -> 30px/0.5s. All 3 in range should move ~12px.
const p0 = dbg.state().enemies.map(e=>({x:e.x,y:e.y}));
for(let f=0; f<10; f++) lh.tick(0.05,1);
const es = dbg.state().enemies;
let slowedCount = 0;
for(let i=0;i<3 && es[i];i++){
  const d = Math.hypot(es[i].x-p0[i].x, es[i].y-p0[i].y);
  if(d < 18 && d > 6) slowedCount++;
}
chk('all in-range creeps slowed by AoE ('+slowedCount+'/3 slowed, ~12px/0.5s)', slowedCount === 3);
console.log(ok ? '\nITEM7 PASS' : '\nITEM7 FAIL');
