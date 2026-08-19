// ITEM 4 validation: presets 11-20 + capped fallback for past-preset waves.
const lh = require('./harness.js');
const dbg = lh.win.__tdDebug;
let ok = true;
function chk(name, cond){ console.log((cond?'PASS':'FAIL')+'  '+name); ok = ok && cond; }

// Preset waves return their hand-tuned arrays.
const q20 = dbg.queueFor(20);
chk('wave20 preset: 24 enemies, 5 bosses', q20.length===24 && q20.filter(t=>t==='boss').length===5);
chk('wave15 preset: 2 bosses (Overlord)', dbg.queueFor(15).filter(t=>t==='boss').length===2);
chk('wave14 preset: no boss', dbg.queueFor(14).filter(t=>t==='boss').length===0);

// Past-preset (endless) waves use the capped formula.
const q21 = dbg.queueFor(21);
const expected21 = Math.min(6 + 20*2, 50);   // 46
chk('wave21 fallback count capped ('+q21.length+')', q21.length===expected21);
const q100 = dbg.queueFor(100);
chk('wave100 count hits cap 50 ('+q100.length+')', q100.length===50);
chk('wave100 has boss (wave%5==0)', q100[0]==='boss');
chk('wave21 has regener (wave%7==0)', q21[1]==='regener');
console.log(ok ? '\nITEM4 PASS' : '\nITEM4 FAIL');
