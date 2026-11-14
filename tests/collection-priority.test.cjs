'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadApp}=require('./helpers/app.cjs');

function account(app,index=0) {
  const runtime=app.runtimes[index];
  const state={live:new Set(['alpha','beta']),sub:new Set(),disabled:new Set(),balances:{alpha:100,beta:100,gamma:100}};
  runtime.__test.config.channels=['alpha','beta','gamma'];
  const session=app.sessions.get(runtime.partition);
  session.fetch=async url=>{
    const slug=url.match(/channels\/([^/?]+)/)?.[1];
    const data=url.endsWith('/user')?{id:index+1,username:'account_'+index}
      :url.endsWith('/me')?{is_following:true,subscription:state.sub.has(slug)?{}:null}
      :url.endsWith('/points')?{points:state.balances[slug]}
      :url.includes('/rewards?')?{data:state.disabled.has(slug)?[]:[{id:'xp',title:'XP Boost',cost:300,is_enabled:true,is_paused:false}]}
      :{user:{username:slug},chatroom:{id:1},livestream:state.live.has(slug)?{}:null};
    return new Response(JSON.stringify(data));
  };
  return {runtime,state};
}
const watched=runtime=>runtime.snapshot().channels.filter(c=>c.watching).map(c=>c.slug);

test('warming players count their first credits in both accounts without replacing the players',async()=>{
  const app=loadApp();const accounts=[account(app,0),account(app,1)];
  for(const {runtime} of accounts) {
    await runtime.poll();
    for(const slug of ['alpha','beta'])runtime.__test.status.get(slug).watchingSince=Date.now()-5*60000;
    assert(runtime.snapshot().channels.filter(c=>c.watching).every(c=>c.earning==='warming'));
  }
  const players=app.state.windows.filter(w=>w.options.type==='toolbar');
  const starts=accounts.map(({runtime})=>runtime.__test.status.get('alpha').watchingSince);
  app.manager.select('account-2');app.manager.select('account-1');
  for(const {runtime,state} of accounts){state.balances.alpha+=10;state.balances.beta+=10;await runtime.poll();}
  accounts.forEach(({runtime},index)=>{
    const result=runtime.snapshot();
    assert.equal(result.today,20);
    assert.equal(result.channels.find(c=>c.slug==='alpha').gained,10);
    assert.equal(result.channels.find(c=>c.slug==='beta').gained,10);
    assert(result.channels.filter(c=>c.watching).every(c=>c.earning==='earning'));
    assert.equal(runtime.__test.status.get('alpha').watchingSince,starts[index]);
  });
  assert(players.every(w=>!w.isDestroyed()));
  assert.equal(app.state.windows.filter(w=>w.options.type==='toolbar').length,4);
});

test('an online subscribed channel survives the chosen goal and a period without credits',async()=>{
  const app=loadApp();const {runtime,state}=account(app);
  state.sub.add('alpha');state.balances.alpha=1200;
  runtime.__test.config.bonusTarget='xp:1';runtime.__test.config.maxWatchers=1;
  await runtime.poll();assert.deepEqual(watched(runtime),['alpha']);
  const player=app.state.windows.at(-1);
  const status=runtime.__test.status.get('alpha');
  status.watchingSince=Date.now()-15*60000;
  await runtime.poll();
  assert.equal(player.isDestroyed(),false,'lack of credits must not rotate a subscribed channel away');
  assert.deepEqual(watched(runtime),['alpha']);
});

test('subscription priority overrides stale cooldown and the absence of channel points',async()=>{
  const app=loadApp();const {runtime,state}=account(app);
  runtime.__test.config.maxWatchers=1;
  await runtime.poll();
  state.sub.add('gamma');state.disabled.add('gamma');state.live.add('gamma');
  runtime.__test.status.set('gamma',{cooldownUntil:Date.now()+30*60000});
  await runtime.poll();
  assert.deepEqual(watched(runtime),['gamma']);
});

test('an online subscription takes an automatic slot even when goal rotation is disabled',async()=>{
  const app=loadApp();const {runtime,state}=account(app);
  runtime.__test.config.maxWatchers=1;runtime.__test.config.rotation=false;
  await runtime.poll();assert.deepEqual(watched(runtime),['alpha']);
  state.sub.add('beta');
  await runtime.poll();
  assert.deepEqual(watched(runtime),['beta']);
  state.live.delete('beta');await runtime.poll();
  assert.deepEqual(watched(runtime),['alpha'],'offline subscription releases its automatic slot');
  await runtime.invoke('farming:set',app.event(),[false]);
  assert.equal(watched(runtime).length,0,'the internal validation command can stop its players');
});
