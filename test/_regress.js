const lh = require('./harness.js');
const dbg = lh.win.__tdDebug;
let ok=true;
const chk=(n,c)=>{console.log((c?'PASS':'FAIL')+'  '+n);ok=ok&&c;};
// item2 leak costs
const walk=(t)=>{dbg.spawn(t);for(let f=0;f<4000&&dbg.state().enemies.length>0;f++)lh.tick(0.05,1);return dbg.state().lives;};
const L0=dbg.state().lives, LN=walk('normal'), LT=walk('tank'), LB=walk('boss');
chk('leak costs 1/2/5', L0-LN===1 && LN-LT===2 && LT-LB===5);
// item5 settings
lh.fire('td:settings',{difficulty:'lethal',mode:'endless'}); lh.tick(0.02,1);
lh.fire('td:restart',{}); lh.tick(0.02,1);
chk('lethal=1 life, endless', dbg.state().lives===1 && dbg.state().settings.mode==='endless');
// item4 presets
chk('wave20 preset 24/5boss', dbg.queueFor(20).length===24 && dbg.queueFor(20).filter(x=>x==='boss').length===5);
chk('wave100 capped 50', dbg.queueFor(100).length===50);
// item6 generalized request
lh.fire('td:wave_started',{});
const req = lh.emitted.slice().reverse().find(e=>e.event==='td:wave_modifier_request');
chk('wave modifier offered on every wave', !!req);
console.log(ok?'\nALL REGRESS PASS':'\nREGRESS FAIL');
