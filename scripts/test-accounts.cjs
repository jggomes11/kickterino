'use strict';
// Actual source startup + isolated partitions, controlled API, quit/restart persistence.
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const assert=require('node:assert/strict');
const {connect,evaluate}=require('./cdp-client.cjs');
const root=path.resolve(__dirname,'..');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'kickterino-accounts-'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let child,ui;const connections=[];
async function until(fn,label,timeout=20000){const end=Date.now()+timeout;let error;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch(e){error=e;}await pause(100);}throw Error(label+': '+(error?.message||'timeout'));}
async function start(){
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const flags=process.platform==='linux'?['--no-sandbox','--disable-gpu',...(!process.env.DISPLAY?['--ozone-platform=headless']:[])]:[];
 child=spawn(require('electron'),[...flags,'--remote-debugging-port='+port,path.join(root,'tests/app-bootstrap.cjs')],{env:{...process.env,KICKTERINO_DATA:profile},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',d=>{logs+=d;});child.stderr.on('data',d=>{logs+=d;});
 const targets=()=>fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1500)}).then(r=>r.json());
 child.fixtureLogs=()=>logs;
 const target=await until(async()=>{if(child.exitCode!==null)throw Error(logs);return(await targets()).find(t=>t.url.endsWith('/renderer/index.html'));},'UI');
 console.log('Connecting UI',target.webSocketDebuggerUrl);
 ui=await connect(target.webSocketDebuggerUrl);connections.push(ui);await ui.call('Runtime.enable');
 await until(()=>evaluate(ui,'document.querySelectorAll("#accounts button").length === 4'),'four controls');
 const bounds=await evaluate(ui,'({accounts:document.querySelector("#accounts").getBoundingClientRect().bottom,panel:document.querySelector("#panel").getBoundingClientRect().top,hidden:document.querySelector("#panel").hidden})');
 assert(bounds.hidden || bounds.panel >= bounds.accounts,'bonus panel must not cover the account selector');
 // Layout follows Twitchterino: compact toolbar, account row, searchable channel rail.
 assert.equal(await evaluate(ui, '!!document.querySelector("#shell > #rail #rail-search")'),true);
 await evaluate(ui, 'document.querySelector("#btn-settings").click();true');
 assert.equal(await evaluate(ui, 'document.querySelector("#settings").hidden'),false);
 for(const id of ['max-watchers','rotation','low-quality','autostart','notify-bonus','notify-chat','sleep-mode','btn-refresh','btn-logout']){
  assert.equal(await evaluate(ui, '!!document.querySelector("#settings #'+id+'")'),true,id);
 }
 await evaluate(ui, 'document.querySelector("#btn-settings").click();true');
 assert.equal(await evaluate(ui, 'document.querySelector("#settings").hidden'),true);
 await evaluate(ui, '{const search=document.querySelector("#rail-search");search.value="yetz";search.dispatchEvent(new Event("input"));}true');
 await until(()=>evaluate(ui, 'document.querySelectorAll("#tabs .ch").length === 1 && document.querySelector("#tabs .ch").dataset.slug === "yetz"'),'channel search');
 await evaluate(ui, '{const search=document.querySelector("#rail-search");search.value="";search.dispatchEvent(new Event("input"));}true');

 return targets;
}
async function quit(){
 const current=child;
 try{await evaluate(ui,'window.kick.quit()');}catch{}
 await until(()=>current.exitCode!==null,'natural quit');
 assert.equal(current.exitCode,0);
}
(async()=>{
 try{
  let targets=await start();
  for(let n=1;n<=4;n++){
   await evaluate(ui,`document.querySelector('[data-account-id="account-${n}"]').click()`);
   await until(async()=>{const s=await evaluate(ui,'window.kick.getState()');return s.accountId==='account-'+n&&s.loggedIn&&s.channels.filter(c=>c.watching).length===2;},'verified account '+n);
   const s=await evaluate(ui,'window.kick.getState()');
   assert.equal(s.username,'Fixture '+n);assert.equal(s.channels.filter(c=>c.watching).length,2);
   await evaluate(ui,'window.kick.setNotifyChat(false)');
   await evaluate(ui,'void window.kick.showLogin();true');
   const login=await until(async()=> (await targets()).find(t=>t.url==='https://kick.com/login'),'login');
   console.log('Connecting login',login.webSocketDebuggerUrl);
   const c=await connect(login.webSocketDebuggerUrl);connections.push(c);
   await c.call('Network.setCookie',{url:'https://marker.invalid',name:'isolation',value:'FAKE_'+n,expires:Date.now()/1000+86400});
   await c.call('Page.navigate',{url:'https://kick.com/robots.txt'});
  }
  const all=await evaluate(ui,'window.kick.getState()');
  assert.equal(all.accounts.length,4);assert(all.accounts.every(a=>a.watching===2));
  assert.deepEqual(ui.exceptions,[]);
  await evaluate(ui, 'document.querySelectorAll("#modal button").forEach(b => { if (b.textContent === "Entendi") b.click(); }); true');
  await ui.call('Emulation.setDeviceMetricsOverride',{width:820,height:800,deviceScaleFactor:1,mobile:false});
  await evaluate(ui,'document.querySelector("#btn-report").click();true');
  await until(()=>evaluate(ui,'!document.querySelector("#modal").hidden && !!document.querySelector("#modal .report")'),'report dialog');
  assert.equal(await evaluate(ui,'(()=>{const r=document.querySelector("#modal .modal-actions button").getBoundingClientRect();return !!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest("#modal");})()'),true,'report controls must be above the bonus panel');
  await evaluate(ui,'document.querySelectorAll("#modal button").forEach(b=>{if(b.textContent==="Fechar")b.click();});true');
  const narrow=await evaluate(ui, '({add:document.querySelector(".add-ch").getBoundingClientRect().height,search:document.querySelector(".search").getBoundingClientRect().height,offline:document.querySelector(".toggle-off").getBoundingClientRect().height})');
  assert(narrow.add>0 && narrow.search>0 && narrow.offline>0,'narrow windows must retain add/search/offline controls');
  await evaluate(ui,'document.querySelector(".toggle-off").click();true');
  assert.equal(await evaluate(ui,'!!document.querySelector(".ch[data-slug=cogu]")'),true);
  const overlap=await evaluate(ui, '({accounts:document.querySelector("#accounts").getBoundingClientRect().bottom,panel:document.querySelector("#panel").getBoundingClientRect().top,hidden:document.querySelector("#panel").hidden})');
  assert(overlap.hidden || overlap.panel >= overlap.accounts,'narrow bonus panel must not cover account selector');
  await ui.call('Emulation.clearDeviceMetricsOverride');
  const screenshots=path.join(root,'.superpowers','account-fixture');
  fs.mkdirSync(screenshots,{recursive:true});
  await ui.call('Page.captureScreenshot',{format:'png'}).then(r=>fs.writeFileSync(path.join(screenshots,'screenshot.png'),Buffer.from(r.data,'base64')));
  await quit();targets=await start();
  const bound=new Set();
  for(let n=1;n<=4;n++){
   await evaluate(ui,`document.querySelector('[data-account-id="account-${n}"]').click()`);
   await until(async()=> (await evaluate(ui,'window.kick.getState()')).accountId==='account-'+n,'selection');
   assert.equal((await evaluate(ui,'window.kick.getState()')).notifyChat,false);
   await evaluate(ui,'void window.kick.showLogin();true');
   const login=await until(async()=> (await targets()).find(t=>t.url==='https://kick.com/login'&&!bound.has(t.id)),'reopened login');bound.add(login.id);
   console.log('Connecting login',login.webSocketDebuggerUrl);
   const c=await connect(login.webSocketDebuggerUrl);connections.push(c);
   const cookies=await c.call('Network.getCookies',{urls:['https://marker.invalid']});
   assert.deepEqual(cookies.cookies.filter(c=>c.name==='isolation').map(c=>c.value),['FAKE_'+n]);
   await c.call('Page.navigate',{url:'https://kick.com/robots.txt'});
  }
  assert.deepEqual(ui.exceptions,[]);await quit();
  console.log('One real Electron application, four account players/settings/cookie jars, natural quit/restart persistence: PASS (fictitious accounts)');
 }catch(e){console.error(e);console.error(child?.fixtureLogs?.());if(ui){try{console.error('UI diagnostics',await evaluate(ui,'JSON.stringify({bridge:typeof window.kick,guard:typeof AccountView,html:document.body.innerText.slice(0,300)})'),ui.exceptions);}catch{}}process.exitCode=1;}
 finally{for(const c of connections)c.close();if(child&&child.exitCode===null)child.kill('SIGKILL');fs.rmSync(profile,{recursive:true,force:true});}
})();
