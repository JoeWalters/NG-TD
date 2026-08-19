const lh = require('./harness.js');
const dbg = lh.win.__tdDebug;
let ok = true;
const chk = (n,c)=>{ console.log((c?'PASS':'FAIL')+'  '+n); ok = ok && c; };

lh.fire('td:restart',{}); lh.tick(0.02,1);
const clearWave = ()=>{
  const mark = lh.emitted.length;   // only accept wave_cleared emitted during THIS wave
  dbg.setLives(999);
  for(let f=0; f<4000; f++){
    lh.tick(0.05,1);
    if(lh.emitted.slice(mark).find(e=>e.event==='td:wave_cleared')) return;
  }
};
const offered = (wave)=>{
  return lh.emitted.slice().reverse().some(e=>e.event==='td:wave_modifier_request' && e.detail.wave===wave);
};
const startMilestone = (wave, prev)=>{
  dbg.setWave(prev); lh.fire('td:wave_started',{});
  chk('wave '+wave+': offers (blocked until pick)', offered(wave) && dbg.state().wave===prev);
  lh.fire('td:wave_modifier',{choice:'skip'}); lh.tick(0.02,1);
  chk('wave '+wave+': starts after pick', dbg.state().wave===wave);
  clearWave();
};

dbg.setWave(0); lh.fire('td:wave_started',{});
chk('wave 1: no offer, starts', !offered(1) && dbg.state().wave===1);
clearWave();

startMilestone(5,4);
dbg.setWave(5); lh.fire('td:wave_started',{});
chk('wave 6: no offer, starts', !offered(6) && dbg.state().wave===6);
clearWave();

startMilestone(10,9);
startMilestone(15,14);
startMilestone(20,19);

console.log(ok ? '\nGATE PASS' : '\nGATE FAIL');
