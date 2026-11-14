'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {createAccountViewGuard}=require('../security/account-view');
const source=fs.readFileSync(path.join(__dirname,'../renderer/renderer.js'),'utf8');
const report={gained:123,bought:[],bonusHours:1,coverage:10,days:[],periods:[],timeline:[],channels:1};
function node(tag='',text=''){return {tag,textContent:text,children:[],hidden:true,style:{},classList:{toggle(){}},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},getBoundingClientRect(){return {x:0,y:0,width:100,height:100};}};}
function renderHarness(getReport=async()=>report) {
  const nodes=new Map();const $=key=>{if(!nodes.has(key))nodes.set(key,node());return nodes.get(key);};
  const initial={accountId:'account-1',sessionRevision:1,loggedIn:true,sessionChecking:false,channels:[],maxWatchers:2};
  const context={initial,window:{kick:{getReport,saveReport:async()=>null}},AccountView:{createAccountViewGuard},document:{querySelector:$,addEventListener(){}},
    el:(tag,cls,text)=>node(tag,text),button:(text,cls,onclick)=>Object.assign(node('button',text),{onclick}),
    renderAccounts(){},renderTabs(){},renderHeader(){},renderPanel(){},renderTargetSelect(){},celebrate(){},
    BONUS_NAMES:{xp:'+15% XP',capture:'+15% Capture Boost',lure:'+15% Secret Lure'},shortName:x=>x.replace('+15% ',''),fmt:String,sleepPicked:new Set()};
  vm.createContext(context);
  vm.runInContext(source.slice(0,source.indexOf('let state ='))+'\nlet state=initial,active=null,modalKind=null,introShown=false;accountView.accept(state);\n'+
    source.slice(source.indexOf('function applyState('),source.indexOf('// ---------- Bônus ativos'))+
    source.slice(source.indexOf('function openModal('),source.indexOf("$('#modal').onclick"))+
    source.slice(source.indexOf('function renderSleepList('),source.indexOf('// Relatório da semana'))+
    source.slice(source.indexOf('async function showReport('),source.indexOf('// Boas-vindas na primeira vez'))+
    '\nglobalThis.driver={applyState,showReport,renderSleepList};',context);
  return {driver:context.driver,nodes,$,initial};
}
for(const transition of [{loggedIn:false,sessionChecking:true},{loggedIn:false,sessionChecking:false},{loggedIn:true,sessionChecking:false,username:'another-account'}]) {
  test('an open private report is removed on session transition '+JSON.stringify(transition),async()=>{
    const h=renderHarness();await h.driver.showReport();assert.equal(h.$('#modal').hidden,false);
    h.driver.applyState({...h.initial,...transition,sessionRevision:2});
    assert.equal(h.$('#modal').hidden,true);assert.equal(h.$('#modal-card').children.length,0);
  });
}
test('a delayed report cannot reopen after the same slot invalidates and verifies again',async()=>{
  let release;const h=renderHarness(()=>new Promise(resolve=>release=resolve));
  const old=h.driver.showReport();h.driver.applyState({...h.initial,sessionRevision:2,loggedIn:false,sessionChecking:true});
  h.driver.applyState({...h.initial,sessionRevision:3});release(report);await old;
  assert.equal(h.$('#modal').hidden,true);
});
test('a delayed old-session state cannot restore private data after redaction',async()=>{
  const h=renderHarness();await h.driver.showReport();h.driver.applyState({...h.initial,sessionRevision:2,loggedIn:false,sessionChecking:true});
  assert.equal(h.driver.applyState({...h.initial,sessionRevision:1}),false);
  assert.equal(h.$('#modal').hidden,true);
  assert.equal(h.$('#modal-card').children.length,0);
});
test('sleep purchase counts exclude unavailable selected packages and normalized one-hour estimates',()=>{
  for(const target of ['capture:3','']) {
    const h=renderHarness();h.driver.applyState({...h.initial,bonusTarget:target,channels:[{slug:'tester',points:2000,hasBonus:true,targetCost:1500,targetEstimated:true,costs:{xp:300},rewards:[{kind:'xp',hours:3,cost:900,available:true}]}]});
    h.driver.renderSleepList();
    const text=n=>[n.textContent,...n.children.map(c=>typeof c==='string'?c:text(c))].join(' ');
    assert.match(text(h.$('#modal-card')),/Nenhum canal tem pontos/);
  }
});
