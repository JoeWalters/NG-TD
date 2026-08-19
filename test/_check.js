const lh = require('./harness.js');
const dbg = lh.win.__tdDebug;
let ok = true;
const chk = (n,c)=>{ console.log((c?'PASS':'FAIL')+'  '+n); ok = ok && c; };

lh.fire('td:restart',{}); lh.tick(0.02,1);
const snap = lh.latestSnapshot(), grid = snap.grid;
// empty tiles to work with
const empties = [];
for(let r=0;r<10;r++)for(let c=0;c<10;c++)if(grid[r*10+c]===0)empties.push([r,c]);

const reasons = [];
const tryBuild = (row,col,type) => {
  const m = lh.emitted.length;
  lh.fire('td:tower_placed',{row:row,col:col,type:type}); lh.tick(0.02,1);
  const ev = lh.emitted.slice(m).find(e=>e.event==='td:build_failed');
  if(ev) reasons.push(ev.detail.reason);
};
// path tile: (0,4) is on the path (grid 1)
tryBuild(0,4,'basic');
// drain cash: build 4 basics on empty tiles
for(let i=0;i<4 && empties[i];i++) lh.fire('td:tower_placed',{row:empties[i][0],col:empties[i][1],type:'basic'});
lh.tick(0.02,1);
tryBuild(empties[5][0], empties[5][1], 'basic');      // no cash
// occupied: same tile as first built tower
tryBuild(empties[0][0], empties[0][1], 'basic');
chk('path-tile failure reported', reasons.includes('path'));
chk('cash failure reported', reasons.includes('cash'));
chk('occupied failure reported', reasons.includes('occupied'));
// valid build (after restart with cash) should NOT emit build_failed
const m2 = lh.emitted.length;
lh.fire('td:restart',{}); lh.tick(0.02,1);
const m3 = lh.emitted.length;
lh.fire('td:tower_placed',{row:empties[0][0],col:empties[0][1],type:'basic'}); lh.tick(0.02,1);
const ev2 = lh.emitted.slice(m3).find(e=>e.event==='td:build_failed');
chk('valid build does NOT emit build_failed', !ev2);
console.log(ok ? '\nITEM9 PASS' : '\nITEM9 FAIL');
