'use strict';
// Real Chromium transport, controlled local server, fictitious credentials only.
const {app,session,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createSessionClient,readCookie}=require('../security/requests');
const {createIpcRegistrar}=require('../security/ipc');
const {checkpoint}=require('./electron-fixture-support.cjs');
app.setPath('userData',process.env.SECURITY_FIXTURE_DATA);
// Native Windows must not implicitly quit between hidden-window test phases.
app.on('window-all-closed',()=>{});
checkpoint('waiting for Electron ready');
app.whenReady().then(async()=>{
 let server;
 try{
  checkpoint('Chromium session transport');
  let leaked=0,observed;
  server=http.createServer((req,res)=>{
   res.setHeader('Access-Control-Allow-Origin','https://kick.com');
   res.setHeader('Access-Control-Allow-Credentials','true');
   res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-XSRF-TOKEN');
   if(req.method==='OPTIONS')return res.end();
   if(req.url==='/redirect'){res.writeHead(302,{Location:'/leak'});return res.end();}
   if(req.url==='/leak'){leaked++;return res.end('{}');}
   if(req.url==='/slow')return;
   observed=req.headers;
   res.setHeader('Content-Type','application/json');res.end('{"points":42}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const ses=session.fromPartition('fixture');
  await ses.cookies.set({url:origin,name:'session_token',value:'FAKE_RUNTIME_TOKEN'});
  const options={getSession:()=>ses,getHeaders:async()=>({Authorization:'Bearer '+await readCookie(ses,origin,'session_token')}),
   resolveUrl:input=>{if(!['/data','/redirect','/slow'].includes(input))throw Error();return origin+input;}};
  const client=createSessionClient(options);
  assert.deepEqual(await client.request('/data'),{status:200,json:{points:42}});
  assert.equal(observed.authorization,'Bearer FAKE_RUNTIME_TOKEN');
  assert.match(observed.cookie,/session_token=FAKE_RUNTIME_TOKEN/);
  await assert.rejects(client.request('/redirect'),/Request failed/);assert.equal(leaked,0);
  await assert.rejects(createSessionClient({...options,timeoutMs:30}).request('/slow'),/Request timed out/);
  const pending=client.request('/slow');client.invalidate();await assert.rejects(pending,/Session changed/);
  checkpoint('Kick session headers');
  // Kick-specific headers through Chromium (destination mapped only by this fixture).
  const {createPlatformClient}=require('../security/platform');
  const kick=createPlatformClient('kick',()=>({
   cookies:{get:async({name})=>[{value:name==='session_token'?'FAKE_KICK_TOKEN':'FAKE_XSRF'}]},
   fetch:(_url,init)=>{const headers={...init.headers};delete headers.Referer;return ses.fetch(origin+'/data',{...init,headers});}
  }));
  await kick.request('/api/v1/user');assert.equal(observed.authorization,'Bearer FAKE_KICK_TOKEN');
  assert.equal(observed['x-xsrf-token'],'FAKE_XSRF');
  checkpoint('local-only preload');
  const ui=pathToFileURL(path.resolve(__dirname,'../renderer/index.html')).href;
  const win=new BrowserWindow({show:false,webPreferences:{preload:path.resolve(__dirname,'../preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,additionalArguments:['--app-ui-url='+ui]}});
  const handle=createIpcRegistrar({ipcMain,getMainWindow:()=>win,uiDocument:ui,platform:'kick',getContext:()=>({})});
  handle('state:get',()=>({accountId:'account-1',channels:[]}));
  await win.loadURL(ui);
  assert.equal(await win.webContents.executeJavaScript('typeof window.kick'),'object');
  assert.equal((await win.webContents.executeJavaScript('window.kick.getState()')).accountId,'account-1');
  await win.loadURL(origin);
  assert.equal(await win.webContents.executeJavaScript('typeof window.kick'),'undefined');
  checkpoint('account controls');
  await require('./account-controls-electron.cjs')();
  win.destroy();
  checkpoint('all checks passed');
  fs.writeFileSync(process.env.SECURITY_FIXTURE_RESULT,JSON.stringify({passed:true}));
  console.log('Electron transport/redirect/timeout/invalidation, Kick headers and local-only preload: PASS');
  app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
 finally{server?.closeAllConnections();server?.close();}
});
