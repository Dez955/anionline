import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const code=fs.readFileSync(new URL('../anitube.js',import.meta.url),'utf8');
let store={}, menu, params=[], back;
const ctx={URL,console,Lampa:{Storage:{get:(k,d)=>k in store?store[k]:d,set:(k,v)=>store[k]=v,field:k=>store[k]},
 Controller:{enabled:()=>({name:'settings_component'}),toggle:n=>back=n},Select:{show:o=>menu=o},
 SettingsApi:{getComponent:()=>false,addComponent(){},addParam:p=>params.push(p)},Noty:{show(){}}}};
ctx.window=ctx;vm.createContext(ctx);vm.runInContext(code.replace('    start();','window.t={sourceAllowed,sourceMenu,sourceSettings,addSettings,clearLegacyWorkerKey};'),ctx);
const t=ctx.t;t.addSettings();assert.equal(params[0].param.name,'anitube_sources');
store.anitube_proxy_key='legacy-worker-key';t.clearLegacyWorkerKey();assert.equal(store.anitube_proxy_key,'','legacy built-in Worker key is cleared');
store.anitube_proxy_key='custom-key';store.anitube_box='http://192.168.0.10:8787';t.clearLegacyWorkerKey();assert.equal(store.anitube_proxy_key,'custom-key','home-box key is preserved');
store.anitube_box='';store.anitube_proxy='https://my-worker.example';t.clearLegacyWorkerKey();assert.equal(store.anitube_proxy_key,'custom-key','custom-proxy key is preserved');
store.anitube_proxy='';store.anitube_proxy_key='';
t.sourceSettings();assert.equal(menu.items.length,11);
menu.onSelect({value:'dorama'});assert.equal(t.sourceAllowed('dorama'),false);
assert.equal(menu.items.find(e=>e.value==='dorama').subtitle,'Приховано');
assert.equal(t.sourceMenu([{group:'x',value:'dorama'},{group:'x',value:'anitube'}]).filter(e=>e.value).length,1);
menu.onSelect({value:'dorama'});assert.equal(t.sourceAllowed('dorama'),true);
store.anitube_russian=true;assert.equal(t.sourceAllowed('kodik'),true);assert.equal(t.sourceAllowed('anilibria'),true);
menu.onSelect({value:'anilibria'});assert.equal(t.sourceAllowed('anilibria'),false,'hidden wins over Russian switch');
menu.onBack();assert.equal(back,'settings_component');
store.anitube_choice={1:{name:'kept'}};t.sourceSettings();menu.onSelect({value:'anitube'});assert.equal(store.anitube_choice[1].name,'kept');
const run=spawnSync(process.execPath,['dev/sim-ui.mjs','Вигнаний лицар',''],{encoding:'utf8',timeout:3000,
 env:{...process.env,SRC:'anitube',TITLE:'https://anitube.in.ua/6071-test.html',STALL_TITLES:'1',STALL_SEASON:'1',FIXTURE:'1',INIT:'700',WAIT:'100',OUTPUT:'/tmp/anitube-fast-start.html'}});
assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stdout,/PLAYED: Серія 1/);
console.log('PASS: first settings item, persistent source toggles, menu filtering, Russian gate, preserved choices; saved AniTube opens despite stalled translations');
