const lh = require('./harness.js');
const dbg = lh.win.__tdDebug;
let ok = true;
const chk = (n,c)=>{ console.log((c?'PASS':'FAIL')+'  '+n); ok = ok && c; };
const TILE = 64;

// ---- item 2: per-type leak costs ----
const walk=(t)=>{ dbg.spawn(t); for(let f=0;f<4000&&dbg.state().enemies.length>0;f++)lh.tick(0.05,1); return dbg.state().lives; };
lh.fire('td:restart',{}); lh.tick(0.02,1);
const L0=dbg.state().lives, LN=walk('normal'), LT=walk('tank'), LB=walk('boss');
chk('leak costs 1/2/5', L0-LN===1 && LN-LT===2 && LT-LB===5);

// ---- item 4: presets & cap ----
chk('wave20 preset 24/5boss', dbg.queueFor(20).length===24 && dbg.queueFor(20).filter(x=>x==='boss').length===5);
chk('wave100 capped 50', dbg.queueFor(100).length===50);

// ---- item 5: settings/lethal/endless ----
lh.fire('td:settings',{difficulty:'lethal',mode:'endless'}); lh.tick(0.02,1);
lh.fire('td:restart',{}); lh.tick(0.02,1);
chk('lethal=1 life, endless', dbg.state().lives===1 && dbg.state().settings.mode==='endless');

// ---- item 6: wave modifier every wave ----
lh.fire('td:settings',{difficulty:'normal',mode:'campaign'}); lh.tick(0.02,1);
lh.fire('td:restart',{}); lh.tick(0.02,1);
lh.fire('td:wave_started',{});
const req = lh.emitted.slice().reverse().find(e=>e.event==='td:wave_modifier_request');
chk('wave 1 offers modifier', !!req);

// ---- item 7: frost aoe slow ----
const snap=lh.latestSnapshot(), grid=snap.grid;
const spot=[[0,5],[0,4],[1,4],[1,5]].find(([r,c])=>r>=0&&r<10&&c>=0&&c<10&&grid[r*10+c]===0);
lh.fire('td:tower_placed',{row:spot[0],col:spot[1],type:'frost'}); lh.tick(0.02,1);
dbg.spawn('normal'); dbg.spawn('normal'); dbg.spawn('normal');
let fired=false;
for(let f=0;f<60&&!fired;f++){lh.tick(0.05,1);const e=dbg.state().enemies[0];if(e&&e.hp<63.7)fired=true;}
const p0=dbg.state().enemies.map(e=>({x:e.x,y:e.y}));
for(let f=0;f<10;f++)lh.tick(0.05,1);
const es=dbg.state().enemies;
let slowed=0;for(let i=0;i<3&&es[i];i++){const d=Math.hypot(es[i].x-p0[i].x,es[i].y-p0[i].y);if(d<18&&d>6)slowed++;}
chk('frost aoe slow 3/3', slowed===3);

// ---- item 9: build failure feedback ----
lh.fire('td:restart',{}); lh.tick(0.02,1);
const m=lh.emitted.length;
lh.fire('td:tower_placed',{row:0,col:4,type:'basic'}); lh.tick(0.02,1);
const bf=lh.emitted.slice(m).find(e=>e.event==='td:build_failed');
chk('path build failure reported', !!bf && bf.detail.reason==='path');

console.log(ok ? '\nFINAL REGRESSION PASS' : '\nFINAL REGRESSION FAIL');
