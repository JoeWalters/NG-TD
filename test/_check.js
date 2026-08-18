// ITEM 1 validation: magnet removed cleanly, game runs, magnet can't be placed.
const lh = require('./harness.js');
lh.tick(0.1,1);                                          // initial snapshot
const g = lh.latestSnapshot().grid;
let empty=[];
for (let r=0;r<10&&empty.length<2;r++) for(let c=0;c<10;c++) if(g[r*10+c]===0) empty.push([r,c]);
const [a,b]=empty;
lh.fire('td:tower_placed',{row:a[0],col:a[1],type:'basic'});   lh.tick(0.001,1);
lh.fire('td:tower_placed',{row:b[0],col:b[1],type:'redirect'}); lh.tick(0.001,1);
const before=lh.latestSnapshot().towers.length;
lh.fire('td:tower_placed',{row:a[0],col:a[1],type:'magnet'});  lh.tick(0.001,1);  // rejected: undefined type
const after=lh.latestSnapshot().towers.length;
lh.tick(0.1,20);
const s=lh.latestSnapshot();
console.log('types:', Object.keys(s.towerTypes).join(','));
console.log('valid placements ->', before, 'towers; magnet attempt -> count', after, '(unchanged)');
const rh=require('./renderer_harness.js');
const snap=rh.makeSnapshot(); delete snap.towerTypes.magnet;
rh.fire('td:state_updated',snap); rh.renderFrames(3);
const pass = Object.keys(s.towerTypes).length===8 && s.towerTypes.magnet===undefined && before===2 && after===2;
console.log(pass?'ITEM1 PASS ✅':'ITEM1 FAIL ❌');
