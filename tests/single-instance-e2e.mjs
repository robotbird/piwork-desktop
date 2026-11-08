import {_electron as electron} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=await mkdtemp(path.join(os.tmpdir(),'piwork-instance-'));const packaged=process.env.PIWORK_PACKAGED_APP==='1';const exe=path.resolve(packaged?'apps/desktop/release/mac-arm64/PiWork.app/Contents/MacOS/PiWork':'apps/desktop/node_modules/.bin/electron');const appDir=path.resolve('apps/desktop');const args=packaged?[`--user-data-dir=${root}`]:[appDir,`--user-data-dir=${root}`];const env={...process.env,VITE_DEV_SERVER_URL:''};let app,child;
try{
 app=await electron.launch({executablePath:exe,args,env});await app.firstWindow();
 child=spawn(exe,args,{env,stdio:'ignore'});
 const result=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Second instance did not exit')),15000);child.once('error',error=>{clearTimeout(timeout);reject(error)});child.once('exit',(code,signal)=>{clearTimeout(timeout);resolve({code,signal})})});
 assert.equal(result.code,0);assert.equal(result.signal,null);assert.equal((await app.windows()).length,1);
 console.log('Single-instance lock: second instance exited; first window remained available');
}finally{if(child&&child.exitCode===null)child.kill();if(app)await app.close().catch(()=>{});await rm(root,{recursive:true,force:true})}
