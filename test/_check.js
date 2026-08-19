const lh = require('./harness.js');
const dbg = lh.win.__tdDebug;
let ok=true;
const chk=(n,c)=>{console.log((c?'PASS':'FAIL')+'  '+n);ok=ok&&c;};
const last=(ev)=>{for(let i=lh.emitted.length-1;i>=0;i--)if(lh.emitted[i].event===ev)return lh.emitted[i].detail;return null;};

lh.fire('td:wave_started',{});
const req1 = last('td:wave_modifier_request');
chk('wave 1 offers modifier (generalized)', !!req1 && req1.wave===1 && req1.options.length===3);
chk('wave 1 did NOT start yet', dbg.state().wave===0);

lh.fire('td:wave_modifier',{choice:'frail'}); lh.tick(0.05,1);
for(let f=0; f<30 && dbg.state().enemies.length===0; f++) lh.tick(0.05,1);
const sp1 = dbg.state().enemies[0];
chk('wave 1 started after modifier', dbg.state().wave===1);
chk('frail applies to normal enemy (hp 45)', sp1 && sp1.hp===45);

// Complete wave 1 (leak all 6 frail enemies), then wave 2 must also offer.
let cleared=false;
for(let f=0; f<5000; f++){ lh.tick(0.05,1); if(last('td:wave_cleared')){cleared=true;break;} }
chk('wave 1 fully cleared', cleared);
lh.fire('td:wave_started',{});
const req2 = last('td:wave_modifier_request');
chk('wave 2 offers modifier too', !!req2 && req2.wave===2);

lh.fire('td:wave_modifier',{choice:'skip'}); lh.tick(0.05,1);
for(let f=0; f<30 && dbg.state().enemies.length===0; f++) lh.tick(0.05,1);
const sp2 = dbg.state().enemies[0];
chk('skip -> unmodified hp (86.25)', sp2 && Math.abs(sp2.hp-86.25)<0.01);

console.log(ok?'\nITEM6 PASS':'\nITEM6 FAIL');
