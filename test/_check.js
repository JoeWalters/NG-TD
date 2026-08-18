// ITEM 3: WAVE_CLEARED now reports kills + killCash alongside interest.
const lh = require('./harness.js');
lh.tick(0.001,1);
const g = lh.latestSnapshot().grid, path = lh.latestSnapshot().path;
// place a basic on buildable tiles adjacent to the path (near top = early hits)
function buildable(r,c){ return r>=0&&r<10&&c>=0&&c<10&&g[r*10+c]===0; }
const near=[];
for (const p of path){
  for (const [dr,dc] of [[0,1],[0,-1],[1,0],[-1,0]]){
    const r=p.row+dr,c=p.col+dc;
    if (buildable(r,c) && !near.some(x=>x[0]===r&&x[1]===c)) near.push([r,c]);
  }
}
let placed=0;
// spend all cash on basics near the path
for (const [r,c] of near){ lh.fire('td:tower_placed',{row:r,col:c,type:'basic'}); const s=lh.latestSnapshot(); if(s.cash<50)break; placed++; }
console.log('placed',placed,'towers near the path');
lh.fire('td:wave_started');
let guard=0, lastClear=null;
for(let i=0;i<2000;i++){
  lh.tick(0.05,1);
  const ev=[...lh.emitted].reverse().find(e=>e.event==='td:wave_cleared');
  if(ev){ lastClear=ev.detail; break; }
  if(lh.win.__tdDebug.state().lives<=0) break;
}
console.log('WAVE_CLEARED detail:', JSON.stringify(lastClear));
const pass = lastClear && lastClear.kills>0 && lastClear.killCash>0 && typeof lastClear.interest==='number' && lastClear.wave===1;
console.log(pass?'ITEM3 PASS':'ITEM3 FAIL');

// renderer toast text includes kills + interest
const rh=require('./renderer_harness.js');
rh.fire('td:wave_cleared',{wave:3,kills:12,killCash:96,interest:7});
const t=rh.el('toast');
console.log('toast:', JSON.stringify(t.textContent));
console.log(/kills/.test(t.textContent)&&/\+\$7 interest/.test(t.textContent)?'RENDER PASS':'RENDER FAIL');
