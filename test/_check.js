// ITEM 2: per-type leak cost.
const lh = require('./harness.js');
lh.tick(0.001,1);
function leakCostObserved(type){
  lh.fire('td:restart'); lh.tick(0.001,1);
  const before = lh.latestSnapshot().lives;
  lh.win.__tdDebug.spawn(type);
  let guard=0;
  while(lh.win.__tdDebug.state().enemies.length>0 && guard<6000){ lh.tick(0.05,1); guard++; }
  const after = lh.latestSnapshot().lives;
  return before - after;
}
const normals = leakCostObserved('normal');
const tank    = leakCostObserved('tank');
const boss    = leakCostObserved('boss');
console.log('normal leak cost:', normals, '(expect 1)');
console.log('tank   leak cost:', tank,    '(expect 2)');
console.log('boss   leak cost:', boss,    '(expect 5)');
console.log((normals===1 && tank===2 && boss===5) ? 'ITEM2 PASS' : 'ITEM2 FAIL');
