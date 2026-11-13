'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/app.cjs');
const { validateIpcArgs } = require('../security/ipc');

const ids = ['account-1', 'account-2', 'account-3', 'account-4'];
function setAccount(runtime, session, id, points) {
  session.cookies.get = async ({name}) => [{name:name || 'session_token',value:'FAKE_TOKEN_'+id}];
  session.fetch = async url => new Response(JSON.stringify(url.endsWith('/user') ? {id,username:'Account '+id}
    : url.endsWith('/points') ? {points} : {chatroom:{id:123},livestream:{viewer_count:10,session_title:'Live'},user:{username:'channel'}}));
}

test('one application contains four independent request sessions and mutable configurations', async () => {
  const app = loadApp();
  assert.equal(app.runtimes?.length, 4, 'must own four scoped account runtimes');
  assert.equal(new Set(app.runtimes.map(r=>r.partition)).size, 4);
  for (let i=0;i<4;i++) {
    const r=app.runtimes[i]; const ses=app.sessions.get(r.partition);
    setAccount(r,ses,i+1,100*(i+1)); await r.poll();
  }
  for(let i=0;i<4;i++) {
    const s=app.runtimes[i].snapshot();
    assert.equal(s.username,'Account '+(i+1)); assert.equal(s.channels[0].points,100*(i+1));
    assert.equal(s.maxWatchers,2); assert.equal(s.rotation,true);
    assert.equal(s.channels.filter(c=>c.watching).length,2);
  }
  app.runtimes[0].__test.config.favorites.push('rodil');
  app.runtimes[0].__test.config.daily.example=50;
  assert.equal(app.runtimes[1].__test.config.favorites.includes('rodil'),false);
  assert.equal(app.runtimes[1].__test.config.daily.example,undefined);
  assert.equal(new Set(app.state.windows.filter(w=>w.options.webPreferences?.partition).map(w=>w.options.webPreferences.partition)).size,4);
});

test('changing the displayed account keeps background players and captures delayed commands', async () => {
  const app=loadApp(); assert.equal(app.runtimes?.length,4);
  for(let i=0;i<2;i++){const r=app.runtimes[i];setAccount(r,app.sessions.get(r.partition),i+1,100);await r.poll();}
  const existing=app.state.windows.filter(w=>w.options.webPreferences?.partition===app.runtimes[0].partition);
  let release; app.state.dialogResponse=0;
  app.dialog.showMessageBox=()=>new Promise(resolve=>{release=resolve;});
  const pending=app.handlers.get('account:command')(app.event(),{accountId:ids[0],command:'logout',args:[]});
  await app.handlers.get('account:select')(app.event(),ids[1]);
  assert(existing.every(w=>!w.isDestroyed()));
  release({response:0}); await pending;
  assert.equal(app.runtimes[0].snapshot().loggedIn,false);
  assert.equal(app.runtimes[1].snapshot().loggedIn,true);
  assert.equal(app.runtimes[1].snapshot().channels.filter(c=>c.watching).length,2);
  assert.equal(app.manager.snapshot().accountId,ids[1]);
});

test('cookie invalidation and report updates stay in the originating slot', async () => {
  const app=loadApp(); assert.equal(app.runtimes?.length,4);
  for(let i=0;i<2;i++){const r=app.runtimes[i];r.__test.setupSession();setAccount(r,app.sessions.get(r.partition),i+1,100);await r.poll();}
  const a=app.runtimes[0], b=app.runtimes[1]; const before=b.__test.client.generation;
  app.sessions.get(a.partition).cookies.emit('changed',{}, {name:'session_token',domain:'.kick.com'});
  assert.equal(b.__test.client.generation,before); assert.equal(b.snapshot().loggedIn,true);
  await app.handlers.get('account:command')(app.event(),{accountId:ids[0],command:'purchase:add',args:['xp:1']});
  assert.equal(b.snapshot().purchases.length,0);
});

test('account IPC validates slot and channel ownership before dispatch and rejects recursive or global commands', () => {
  const context={platform:'kick',accounts:{'account-1':{channels:['rodil']},'account-2':{channels:['faturetosl']}}};
  const valid={accountId:'account-1',command:'store:open',args:['rodil']};
  assert.deepEqual(validateIpcArgs('account:command',[valid],context),[valid]);
  for(const value of [
    {...valid,accountId:'../../other'}, {...valid,accountId:'toString'}, {...valid,args:['faturetosl']},
    {...valid,command:'app:quit',args:[]}, {...valid,command:'account:command'}, {...valid,command:'autostart:set',args:[true]},
    {...valid,token:'unexpected'}, {...valid,args:'rodil'},
  ]) assert.throws(()=>validateIpcArgs('account:command',[value],context),/Invalid IPC/);
});

test('official popups keep their source session after another account is selected', async () => {
  const app=loadApp(); await app.start();
  const login=app.state.windows.find(w=>w.options.webPreferences?.partition==='persist:kick-account-2');
  app.manager.select('account-4');
  const options=login.webContents.openHandler({url:'https://accounts.google.com/ServiceLogin'});
  assert.equal(options.action,'allow');
  assert.equal(options.overrideBrowserWindowOptions.webPreferences.session,app.sessions.get('persist:kick-account-2'));
  assert.equal(options.overrideBrowserWindowOptions.webPreferences.nodeIntegration,false);
  assert.equal(options.overrideBrowserWindowOptions.webPreferences.sandbox,true);
  assert.equal(login.webContents.openHandler({url:'https://evil.invalid'}).action,'deny');
});

test('slot1 retains existing profile paths and no aggregate snapshot contains a credential', async () => {
  const app=loadApp({env:{KICKTERINO_DATA:'/existing installation'}}); await app.start();
  const paths=app.state.writes.filter(([p])=>p.endsWith('config.json')).map(([p])=>p.replaceAll('\\','/'));
  assert(paths.includes('/existing installation/config.json'));
  for(let i=2;i<=4;i++) assert(paths.includes('/existing installation/accounts/account-'+i+'/config.json'));
  assert.equal(app.runtimes[0].partition,'persist:kick');
  for(let i=0;i<4;i++) {const r=app.runtimes[i];setAccount(r,app.sessions.get(r.partition),i+1,100);await r.poll();}
  assert(!JSON.stringify(app.manager.snapshot()).includes('FAKE_TOKEN'));
  assert.equal(app.manager.snapshot().accounts.length,4);
});
test('regional Google login windows retain their source session', async()=>{
 const a=loadApp();await a.start();
 const login=a.state.windows.find(w=>w.options.webPreferences?.partition==='persist:kick-account-2');
 for(const url of ['https://accounts.google.com.br/signin','https://accounts.google.co.uk/signin']){
  assert.equal(login.webContents.openHandler({url}).action,'allow',url);
  let prevented=false;login.webContents.emit('will-redirect',{isMainFrame:true,url,preventDefault(){prevented=true;}});
  assert.equal(prevented,false);
 }
 assert.equal(login.webContents.openHandler({url:'https://accounts.google.com.br.evil.invalid/'}).action,'deny');
});
test('selector today total comes from the selected account daily report',async()=>{
 const a=loadApp(),d=new Date();
 const day=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 a.runtimes[0].__test.config.daily[day]=10;a.runtimes[1].__test.config.daily[day]=25;
 assert.equal(a.manager.snapshot().accounts[0].today,10);
 assert.equal(a.manager.snapshot().accounts[1].today,25);
});
test('empty slots do not prevent sleep after the connected account is paused',async()=>{
 const a=loadApp();
 for(const ses of a.sessions.values()) ses.fetch=async()=>new Response('{}',{status:401});
 await a.start();
 assert.equal(a.state.blockers.size,0,'unauthenticated slots must not prevent sleep');
 const r=a.runtimes[0];setAccount(r,a.sessions.get(r.partition),1,100);await r.poll();
 assert.equal(a.state.blockers.size,1);
 await a.handlers.get('account:command')(a.event(),{accountId:ids[0],command:'farming:set',args:[false]});
 assert.equal(a.state.blockers.size,0);
});
