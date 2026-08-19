const lh = require('./harness.js');
const dbg = lh.win.__tdDebug;
let ok = true;
const chk = (n,c)=>{ console.log((c?'PASS':'FAIL')+'  '+n); ok = ok && c; };

lh.fire('td:restart',{}); lh.tick(0.02,1);
const snap = lh.latestSnapshot(), grid = snap.grid;
dbg.spawn('normal');
for(let f=0; f<18; f++) lh.tick(0.05,1);   // A ~54px into segment 1
dbg.spawn('normal');                        // B at start, same segment 1
const spot = [[0,5],[0,4],[1,4],[1,5]].find(([r,c])=> r>=0&&r<10&&c>=0&&c<10 && grid[r*10+c]===0);
const mark = lh.emitted.length;
lh.fire('td:tower_placed',{row:spot[0],col:spot[1],type:'basic'});
lh.fire('td:change_target_mode',{row:spot[0],col:spot[1]});   // set 'first' BEFORE any tick fires
lh.tick(0.02,1);                                              // tower fires in 'first' mode
const ev = lh.emitted.slice(mark).find(e=>e.event==='td:enemy_damaged');
const hitY = ev ? ev.detail.y : null;
const es = dbg.state().enemies;
const sameSeg = es[0].pathIndex === es[1].pathIndex;
const aheadY = Math.max(es[0].y, es[1].y);
chk('both on same segment (pathIndex='+es[0].pathIndex+')', sameSeg);
chk('first mode picks exact AHEAD (hit='+(hitY?hitY.toFixed(0):'null')+' ahead='+aheadY.toFixed(0)+')', hitY!=null && Math.abs(hitY-aheadY) < 6);
console.log(ok ? '\nITEM8 PASS' : '\nITEM8 FAIL');
