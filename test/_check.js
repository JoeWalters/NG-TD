const lh = require('./harness.js');
const dbg = lh.win.__tdDebug;
let ok=true;
const chk=(n,c)=>{console.log((c?'PASS':'FAIL')+'  '+n);ok=ok&&c;};

lh.fire('td:restart',{}); lh.tick(0.02,1);
chk('default: 20 lives, campaign', dbg.state().lives===20 && dbg.state().settings.mode==='campaign');

lh.fire('td:settings',{difficulty:'lethal'}); lh.tick(0.02,1);
chk('lethal stored', dbg.state().settings.difficulty==='lethal');
lh.fire('td:restart',{}); lh.tick(0.02,1);
chk('lethal restart -> 1 life', dbg.state().lives===1);

lh.fire('td:settings',{mode:'endless'}); lh.tick(0.02,1);
chk('endless stored', dbg.state().settings.mode==='endless');

lh.fire('td:settings',{difficulty:'bogus',mode:'bogus'}); lh.tick(0.02,1);
chk('invalid settings ignored', dbg.state().settings.difficulty==='lethal' && dbg.state().settings.mode==='endless');

lh.fire('td:restart',{}); lh.tick(0.02,1);
chk('settings persist across restart', dbg.state().settings.difficulty==='lethal' && dbg.state().settings.mode==='endless' && dbg.state().lives===1);

console.log(ok?'\nITEM5 PASS':'\nITEM5 FAIL');
