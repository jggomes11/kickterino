'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/app.cjs');
test('application queries keep credentials out of navigable page JavaScript', async () => {
  const a = loadApp();
  await a.apiExports.poll();
  assert.ok(a.state.requests.some(r => r.url === 'https://kick.com/api/v1/user'));
  assert.ok(!a.state.scripts.some(s => /FAKE_ACCOUNT_TOKEN|Authorization|X-XSRF/.test(s)));
});
test('IPC rejects remote sources and invalid arguments before effects', async () => {
  const a = loadApp();
  const handler = a.handlers.get('channels:add');
  await assert.rejects(handler({sender:a.api.webContents,senderFrame:a.api.webContents.mainFrame}, 'valid-name'), /Unauthorized/);
  await assert.rejects(handler(a.event(), 'https://evil.invalid/foo'), /Invalid/);
  assert.equal(a.state.writes.length, 0);
});
test('logout cancels queued stores and rejects a delayed balance write', async () => {
  const a = loadApp();
  a.apiExports.config.channels = ['tester', 'other'];
  await a.apiExports.poll();
  await a.handlers.get('stores:sequence')(a.event(), ['tester', 'other']);
  let resolve;
  a.session.fetch = () => new Promise(r => { resolve = r; });
  const pending = a.apiExports.refreshChannel('tester');
  await new Promise(r => setImmediate(r));
  await a.handlers.get('logout')(a.event());
  const windows = a.state.windows.length;
  resolve(new Response('{"points":999}'));
  await pending;
  assert.equal(a.apiExports.status.size, 0);
  assert.equal(a.apiExports.stores.size, 0);
  assert.equal(a.state.windows.length, windows);
});
test('packaged startup does not check upstream updates', async () => {
  const a = loadApp({packaged:true}); await a.start();
  assert.equal(a.state.updates, 0);
});
test('same identity renewal keeps balance baseline; another identity archives reports', async () => {
  const a = loadApp();
  a.apiExports.config.channels = ['tester'];
  let id = 123, points = 100;
  a.session.fetch = async url => new Response(JSON.stringify(url.endsWith('/user') ? {id,username:'user'+id}
    : url.endsWith('/points') ? {points} : {chatroom:{id:5},livestream:{},user:{username:'tester'}}));
  await a.apiExports.poll();
  points = 110;
  a.session.cookies.emit('changed', {}, {name:'session_token'});
  await a.apiExports.poll();
  const day = Object.values(a.apiExports.config.daily).reduce((x,y)=>x+y,0);
  assert.equal(day,10);
  id = 456; points = 900;
  a.session.cookies.emit('changed', {}, {name:'session_token'});
  await a.apiExports.poll();
  assert.equal(a.apiExports.config.reportAccount,'id:456');
  assert.equal(Object.keys(a.apiExports.config.daily).length,0);
  assert.equal(Object.values(a.apiExports.config.accountReports[0].daily)[0],10);
});
test('unverified sessions cannot collect and every command authenticates caller', async () => {
  const a = loadApp();
  a.session.fetch = async () => new Response('{"username":"no-id"}');
  await a.apiExports.poll();
  assert.equal(a.apiExports.snapshot().loggedIn,false);
  assert.equal(a.state.windows.filter(w=>w.options.title?.startsWith('Kick — tester')).length,0);
  for (const handler of a.handlers.values()) {
    await assert.rejects(handler({sender:a.api.webContents,senderFrame:a.api.webContents.mainFrame}),/Unauthorized/);
  }
});
