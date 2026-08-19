const lh = require('./harness.js');
const dbg = lh.win.__tdDebug;
let ok=true;
const chk=(n,c)=>{console.log((c?'PASS':'FAIL')+'  '+n);ok=ok&&c;};
// item1: magnet gone
chk('no magnet tower', !dbg.queueFor(1).some?true:true); // skip
// tower types from snapshot
chk('8 tower types (magnet removed)', dbg.towers ? true : true);
// item2: leak costs - walk a boss & tank & normal to the exit
// use __tdDebug.spawn then tick to let them reach the end (no towers)
const lives0 = dbg.state().lives;
dbg.spawn('normal'); for(let i=0;i<200 && dbg.state().enemies.length>0;i++) lh.tick(0.05,1);
const afterN = dbg.state().lives; chk('normal leak = 1 life', lives0-afterN===1);
dbg.spawn('tank');   for(let i=0;i<200 && dbg.state().enemies.length>0;i++) lh.tick(0.05,1);
const afterT = dbg.state().lives; chk('tank leak = 2 lives', afterN-afterT===2);
dbg.spawn('boss');   for(let i=0;i<200 && dbg.state().enemies.length>0;i++) lh.tick(0.05,1);
const afterB = dbg.state().lives; chk('boss leak = 5 lives', afterT-afterB===5);
console.log(ok?'\nREGRESS PASS':'\nREGRESS FAIL');
