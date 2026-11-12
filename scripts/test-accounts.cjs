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
