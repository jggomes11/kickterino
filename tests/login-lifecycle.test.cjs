'use strict';const {test}=require('node:test');const assert=require('node:assert/strict');const {loadApp}=require('./helpers/app.cjs');
const windows=a=>a.state.windows.filter(w=>w.options.title==='Kick — login'&&!w.isDestroyed());
function setup(){const a=loadApp();for(const ses of a.sessions.values())ses.fetch=async()=>new Response('{}',{status:401});return a;}
test('four slots start without a robots or login renderer; demand reuses and cancellation releases login',async()=>{const a=setup();await a.start();assert.equal(windows(a).length,0);await a.handlers.get('login:show')(a.event());const login=windows(a)[0];assert(login);await a.handlers.get('login:show')(a.event());assert.equal(windows(a).length,1);login.close();assert.equal(windows(a).length,0);a.app.emit('before-quit');await assert.rejects(a.runtimes[0].invoke('login:show',a.event(),[]),/Session changed/);});
test('new verified login releases document but routine poll preserves explicitly opened verified login',async()=>{const a=setup();await a.start();await a.handlers.get('login:show')(a.event());const login=windows(a)[0];a.session.fetch=async url=>new Response(JSON.stringify(url.endsWith('/user')?{id:123,username:'tester'}:{}));await a.runtimes[0].poll();assert(login.isDestroyed());await a.handlers.get('login:show')(a.event());const second=windows(a)[0];await a.runtimes[0].poll();assert(!second.isDestroyed());});
test('closing stalled login settles its command and shutdown cannot resurrect navigation',async()=>{const a=setup();await a.start();await a.handlers.get('login:show')(a.event());const login=windows(a)[0];login.loadURL=()=>new Promise(()=>{});const pending=a.handlers.get('login:show')(a.event());await Promise.resolve();login.close();await Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(Error('pending')),100))]);assert.equal(windows(a).length,0);});

test('unavailable identity verification permits explicit official login while keeping private commands guarded',async()=>{
 const a=setup();
 for(const ses of a.sessions.values())ses.fetch=async()=>{throw Error('Identity service unavailable');};
 await a.start();
 assert.equal(a.apiExports.snapshot().loggedIn,false);
 assert.equal(a.apiExports.snapshot().sessionChecking,true);
 assert.equal(windows(a).length,0);
 await a.handlers.get('login:show')(a.event());
 assert.equal(windows(a).length,1);
 assert.equal(windows(a)[0].webContents.getURL(),'https://kick.com/login');
 assert.equal(a.apiExports.snapshot().loggedIn,false);
 assert.equal(a.apiExports.snapshot().sessionChecking,true);
 assert.equal(await a.handlers.get('report:get')(a.event()),null);
 a.apiExports.status.set(a.apiExports.config.channels[0],{chatroomId:5});
 await assert.rejects(a.handlers.get('chat:send')(a.event(),{chatroomId:5,content:'must remain private'}),/Session unavailable/);
});
