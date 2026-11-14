'use strict';
// Test harness only: run normal main.js with controlled Kick pages/API.
const {app,session,net}=require('electron');
const fs=require('node:fs'),path=require('node:path');
app.setPath('userData',process.env.KICKTERINO_DATA);
app.whenReady().then(async()=>{
 const ids=['account-1','account-2','account-3','account-4'];
 for(let i=0;i<4;i++){
  const ses=session.fromPartition(i===0?'persist:kick':'persist:kick-account-'+(i+1));
  ses.protocol.handle('https', async request=>{
   const url=new URL(request.url);
   if(url.hostname!=='kick.com')return new Response('',{status:403});
   if(url.pathname==='/api/v1/user'||url.pathname==='/api/v2/user')return new Response(JSON.stringify({id:i+1,username:'Fixture '+(i+1)}),{headers:{'Content-Type':'application/json'}});
   if(url.pathname.endsWith('/rewards'))return new Response(JSON.stringify(require('./fixtures/kick-rewards.json').cases[0].body),{headers:{'Content-Type':'application/json'}});
   if(url.pathname.endsWith('/points'))return new Response('{"points":100}',{headers:{'Content-Type':'application/json'}});
   if(url.pathname.startsWith('/api/v2/channels/'))return new Response(JSON.stringify({chatroom:{id:123},livestream:url.pathname.includes('/cogu')?null:{viewer_count:10,session_title:'Fixture'},user:{username:'Channel'}}),{headers:{'Content-Type':'application/json'}});
   return new Response('<!doctype html><html><body>Local Kick fixture<video></video></body></html>',{headers:{'Content-Type':'text/html'}});
  });
 }
 net.fetch=async()=>new Response('{"channels":[]}');
});
require('../main.js');
