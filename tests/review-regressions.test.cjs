'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadApp}=require('./helpers/app.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(options={}) {
  const a=loadApp(options); a.apiExports.config.channels=['tester'];
  let points=100,rewards=[{id:'xp',title:'XP Boost',cost:300,is_enabled:true,is_paused:false}];
  a.session.fetch=async url=>new Response(JSON.stringify(url.endsWith('/user')?{id:123,username:'tester'}:url.endsWith('/points')?{points}:url.includes('/rewards?')?{data:rewards}:url.endsWith('/me')?{is_following:true,subscription:null}:{livestream:{},chatroom:{id:5}}));
  return {a,setPoints:n=>points=n,setRewards:r=>rewards=r};
}
test('HLS responses keep flowing while the same account is being reverified',async()=>{
  const {a}=setup(); await a.apiExports.poll();
  const player=a.state.windows.find(w=>w.options.type==='toolbar');
  const commands=[];player.webContents.debugger.sendCommand=async(method,args)=>{commands.push({method,args});return {};};
  a.session.cookies.emit('changed',{}, {name:'session_token',domain:'.kick.com'});
  await player.webContents.debugger.listeners('message')[0]({},'Fetch.requestPaused',{requestId:'renewal-playlist'});
  assert(commands.some(c=>c.method==='Fetch.continueRequest'&&c.args.requestId==='renewal-playlist'));
  assert(!commands.some(c=>c.method==='Fetch.getResponseBody'));
  await a.apiExports.poll();assert(!player.isDestroyed());a.runtimes.forEach(r=>r.stop());
});
test('a selected unavailable reward never triggers a redemption notification from an estimate',async()=>{
  const {a,setPoints}=setup({notifications:true});a.apiExports.config.bonusTarget='capture:1';
  await a.apiExports.poll();setPoints(600);await a.apiExports.poll();
  assert.equal(a.state.notifications.length,0);a.runtimes.forEach(r=>r.stop());
});
test('automatic notifications quote the actual available multi-hour package rather than normalized estimates',async()=>{
  const {a,setPoints,setRewards}=setup({notifications:true});
  setRewards([{id:'xp3',title:'XP Boost (3h)',cost:900,is_enabled:true,is_paused:false}]);
  setPoints(800);await a.apiExports.poll();assert.equal(a.state.notifications.length,0);
  setPoints(1000);await a.apiExports.poll();assert.equal(a.state.notifications.length,1);
  assert.match(a.state.notifications[0].body,/XP \(3 h\) \(900 pts\)/);a.runtimes.forEach(r=>r.stop());
});
test('credential invalidation publishes redacted UI before a blocked old identity read completes',async()=>{
  const {a}=setup();await a.apiExports.poll();await tick();a.state.sent.length=0;
  const getCookies=a.session.cookies.get;let release;
  a.session.cookies.get=()=>new Promise(resolve=>release=resolve);
  const old=a.apiExports.poll();await tick();
  a.session.cookies.emit('changed',{}, {name:'session_token',domain:'.kick.com'});await tick();
  const hidden=a.state.sent.find(e=>e.channel==='status'&&e.payload.sessionChecking);
  a.session.cookies.get=getCookies;release(await getCookies({}));await old;
  assert(hidden,'the already rendered private data must be revoked without waiting for the old poll');
  assert.equal(hidden.payload.channels[0].points,null);
  await a.fireTimers(0);await tick();assert.equal(a.apiExports.snapshot().loggedIn,true);
  a.runtimes.forEach(r=>r.stop());
});
test('report image capture is refused while identity is unverified',async()=>{
  const {a}=setup();a.runtimes[0].start(a.main);await tick();
  let captures=0;a.main.webContents.capturePage=async()=>{captures++;return {toPNG:()=>Buffer.from('private')};};
  a.session.cookies.emit('changed',{}, {name:'session_token',domain:'.kick.com'});
  const result=await a.handlers.get('report:save')(a.event(),{x:0,y:0,width:100,height:100});
  assert.equal(result,null);assert.equal(captures,0);a.runtimes.forEach(r=>r.stop());
});
test('a larger valid polling workload is not restarted at the old fixed deadline before later channels run',async()=>{
  const a=loadApp();a.apiExports.config.channels=['alpha','beta','gamma','delta'];
  const entered=[];let release;const gate=new Promise(resolve=>release=resolve);
  a.session.fetch=async url=>{if(url.endsWith('/user'))return new Response('{"id":1,"username":"tester"}');if(/channels\/[a-z]+$/.test(url)){entered.push(url);await gate;}return new Response(JSON.stringify(url.endsWith('/points')?{points:100}:url.includes('/rewards?')?{data:[]}:{livestream:{}}));};
  const work=a.apiExports.poll();await tick();
  try{await a.fireTimers(90000);assert.equal(entered.length,3,'a healthy multi-wave queue must not restart from its first channels');release();await work;assert.equal(entered.length,4);assert.equal(a.apiExports.snapshot().channels.filter(c=>c.points===100).length,4);assert(a.state.windows.some(w=>w.options.type==='toolbar'));}
  finally{release();a.runtimes.forEach(r=>r.stop());await work;}
});
