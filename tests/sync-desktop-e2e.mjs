import {mockBrowserLogin,loginWithMockBrowser} from './support/browser-login.mjs';
import {_electron as electron} from '@playwright/test';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const root=await mkdtemp(path.join(os.tmpdir(),'piwork-sync-e2e-'));
let chat, inferenceCount=0, syncOffline=false;
const json=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))};
const browserLogin=mockBrowserLogin();
const server=createServer(async(req,res)=>{
 if(browserLogin(req,res))return;
 if(req.url==='/login'&&req.method==='POST'){res.writeHead(303,{location:'/login','set-cookie':'session=test; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax'});res.end();return}
 if(req.url==='/login'){res.writeHead(200,{'content-type':'text/html'});res.end('<form method="post"><button>Sign in</button></form>');return}
 if(req.url==='/api/auth/session')return json(res,req.headers.cookie?.includes('authjs.session-token=test')?{user:{id:'member',name:'Tester'}}:{});
 if(req.url==='/api/models')return json(res,{models:[{id:'provider/model',name:'Test model'}]});
 if(req.url==='/api/desktop/sync/status')return json(res,{enabled:true});
 if(req.url?.startsWith('/api/desktop/sync/')&&syncOffline)return json(res,{},503);
 if(req.url?.startsWith('/api/desktop/sync/')){
  const [, , , , id, action]=req.url.split('/');let body='';for await(const chunk of req)body+=chunk;const input=body?JSON.parse(body):null;
  if(req.method==='GET')return json(res,chat??{},chat?200:404);
  if(action==='lease'){if(input.action==='acquire'){if(chat.activeBy||JSON.stringify(chat.messages)!==JSON.stringify(input.expected))return json(res,{},409);chat.activeBy='desktop';chat.token=randomUUID();return json(res,{token:chat.token})}chat.activeBy=null;return json(res,{ok:true})}
  if(!chat)chat={id,title:input.title,messages:[],activeBy:null};
  if(JSON.stringify(chat.messages)!==JSON.stringify(input.expected))return json(res,{},409);
  chat.messages.push(...input.messages);if(input.leaseToken){assert.equal(input.leaseToken,chat.token);chat.activeBy=null}return json(res,{ids:chat.messages.map(m=>m.id)});
 }
 if(req.url==='/api/desktop/inference/messages'){inferenceCount++;for await(const _ of req){}res.writeHead(200,{'content-type':'text/event-stream'});for(const event of [{type:'start'},{type:'text_start',contentIndex:0},{type:'text_delta',contentIndex:0,delta:'Local answer'},{type:'text_end',contentIndex:0,content:'Local answer'},{type:'done',reason:'stop',usage:{input:1,output:1,totalTokens:2,cacheRead:0,cacheWrite:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}])res.write(`data: ${JSON.stringify(event)}\n\n`);res.end();return}
 res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;let app;
const waitFor=async(fn)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Timed out')};
try{
 const profile=path.join(root,'profile');const launch=()=>electron.launch({executablePath:path.resolve('apps/desktop/node_modules/.bin/electron'),args:[path.resolve('apps/desktop'),`--user-data-dir=${profile}`],env:{...process.env,VITE_DEV_SERVER_URL:'',PIWORK_DESKTOP_SYNC_EXPERIMENTAL:'1'}});app=await launch();let page=await app.firstWindow();await page.waitForLoadState('load');await page.evaluate(()=>window.desktop.setPreferences({appearance:'light',language:'en'}));await page.reload();await page.getByRole('button',{name:'Settings',exact:false}).click();await page.getByRole('menuitem',{name:'Settings',exact:true}).click();const settings=page.getByRole('main',{name:'Settings'});await page.getByRole('button',{name:'Account & sync'}).click();await settings.getByLabel('PiWork server URL').fill(base);await loginWithMockBrowser(app,settings,base);await settings.getByText('Tester').waitFor();await settings.getByLabel('Sync new conversations to PiWork').click();await settings.getByText('Up to date').waitFor();await page.getByRole('button',{name:'Back to app'}).click();
 await page.getByRole('textbox',{name:'Describe what you want to do…'}).fill('Local question');await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('Local answer').waitFor({timeout:20000});await waitFor(()=>chat?.messages.length===2&&!chat.activeBy);assert.deepEqual(chat.messages.map(m=>m.text),['Local question','Local answer']);
 chat.activeBy='web';const busyDraft=page.getByRole('textbox',{name:'Describe what you want to do…'});await busyDraft.fill('Wait for Web');await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText(/This conversation is running on another device/).waitFor();assert.equal(await busyDraft.inputValue(),'Wait for Web');assert.equal(inferenceCount,1);chat.activeBy=null;await busyDraft.fill('');
 chat.messages.push({id:randomUUID(),role:'user',text:'Web question'},{id:randomUUID(),role:'assistant',text:'Web answer'});await page.evaluate(()=>window.desktop.syncNow());await page.getByText('Web answer').waitFor();assert.equal(inferenceCount,1);const id=chat.id;await app.close();app=await launch();page=await app.firstWindow();await page.getByRole('button',{name:'Local question'}).click();await page.getByText('Web answer').waitFor();const session=await readFile(path.join(profile,'sessions',`${id}.jsonl`),'utf8');assert.match(session,/Web question/);assert.equal(inferenceCount,1);
 await app.close();app=undefined;const journalFile=path.join(profile,'sync-journal.json');const journal=JSON.parse(await readFile(journalFile,'utf8'));const pending={id:randomUUID(),role:'user',text:'Interrupted input'};chat.token=randomUUID();chat.activeBy='desktop';journal.records[0].running=true;journal.records[0].leaseToken=chat.token;journal.records[0].pending=[pending];await writeFile(journalFile,JSON.stringify(journal));
 app=await launch();page=await app.firstWindow();await page.waitForURL(/dist\/index\.html/);await waitFor(async()=>(await page.evaluate(()=>window.desktop.syncNow())).state==='interrupted');assert.equal(inferenceCount,1);assert.equal(chat.activeBy,'desktop');await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false})});await page.evaluate(()=>window.desktop.recoverInterruptedSync());await waitFor(()=>!chat.activeBy&&chat.messages.some(item=>item.id===pending.id));assert.equal(inferenceCount,1);await waitFor(async()=>(await page.evaluate(()=>window.desktop.syncNow())).state==='ready');await page.getByRole('button',{name:'New chat',exact:false}).first().click();syncOffline=true;const draft=page.getByRole('textbox',{name:'Describe what you want to do…'});await draft.fill('Offline draft');await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText(/Cannot reach the sync service/).waitFor();assert.equal(await draft.inputValue(),'Offline draft');assert.equal(inferenceCount,1);console.log('Desktop sync: text, restart, confirmed recovery and offline draft preservation passed');
}finally{if(app)await app.close().catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})}
