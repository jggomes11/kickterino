'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
test('installer includes security, runtimes and MIT license with no upstream updater',()=>{
 const p=require('../package.json');
 assert.deepEqual(p.build.win.target,['nsis']);
 for(const f of ['account-runtime.js','account-manager.js','security/**/*','LICENSE']) assert(p.build.files.includes(f),f);
 assert.equal(p.build.appId,'com.vinniisaantos.kickterino');
 assert.equal(p.repository,'github:jggomes11/kickterino');
 assert(!p.dependencies?.['electron-updater']);
 for(const f of ['main.js','account-runtime.js']) assert(!fs.readFileSync(path.join(root,f),'utf8').includes('autoUpdater'));
});
