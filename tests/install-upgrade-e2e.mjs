import {_electron as electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,rename,rm,writeFile,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const oldApp=path.resolve(process.env.PIWORK_OLD_APP??'apps/desktop/release/mac-arm64/PiWork.app');
const dmg=path.resolve(process.env.PIWORK_DMG??'apps/desktop/release/mvp17-final/PiWork-0.1.0-arm64.dmg');
const root=await mkdtemp(path.join(os.tmpdir(),'piwork-install-'));const mount=path.join(root,'mount'),apps=path.join(root,'Applications'),profile=path.join(root,'profile'),project=path.join(root,'project');
await Promise.all([mkdir(mount),mkdir(apps),mkdir(project)]);await writeFile(path.join(project,'sample.txt'),'keep this source');
const server=createServer((req,res)=>{req.resume();req.on('end',()=>{res.writeHead(200,{'content-type':'text/event-stream'});for(const [delta,finish] of [[{role:'assistant',content:'Upgrade preserved'},null],[{},'stop']])res.write(`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta,finish_reason:finish}]})}\n\n`);res.end('data: [DONE]\n\n')})});await new Promise(r=>server.listen(0,'127.0.0.1',r));let app,mounted=false;
try{
 execFileSync('hdiutil',['attach','-nobrowse','-readonly','-mountpoint',mount,dmg],{stdio:'ignore'});mounted=true;
 const installed=path.join(apps,'PiWork.app');execFileSync('ditto',[oldApp,installed]);
 const launch=()=>electron.launch({executablePath:path.join(installed,'Contents/MacOS/PiWork'),args:[`--user-data-dir=${profile}`],env:{...process.env,VITE_DEV_SERVER_URL:''}});
 app=await launch();let page=await app.firstWindow();await app.evaluate(({dialog},dir)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[dir]})},project);
 const created=await page.evaluate(async({gateway})=>{await window.desktop.setPreferences({appearance:'dark',language:'en'});await window.desktop.setGateway({baseUrl:gateway,modelId:'mock',apiKey:''});const picked=await window.desktop.pickProject();if(!picked)throw Error('No project');return window.desktop.createProject(picked.token,{name:'Upgrade project',description:'data stays'})},{gateway:`http://127.0.0.1:${server.address().port}/v1`});
 const result=await page.evaluate(async(projectId)=>{const result=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Agent timeout')),20000);const off=window.desktop.onChat(event=>{if(['completed','failed','aborted'].includes(event.type)){off();clearTimeout(timer);resolve(event)}})});const id=await window.desktop.sendChat('Upgrade task',projectId,null,null,null,{source:'custom',id:'mock'});return {id,event:await result}},created.id);assert.equal(result.event.type,'completed');await app.close();app=undefined;
 await rename(installed,path.join(root,'previous-PiWork.app'));execFileSync('ditto',[path.join(mount,'PiWork.app'),installed]);
 app=await launch();page=await app.firstWindow();const restored=await page.evaluate(async(id)=>({preferences:await window.desktop.getPreferences(),projects:await window.desktop.listProjects(),chats:await window.desktop.listChats(),history:await window.desktop.openChat(id)}),result.id);
 assert.equal(created.path,await realpath(project));assert.equal(restored.preferences.appearance,'dark');assert.equal(restored.preferences.language,'en');assert.ok(restored.projects.some(p=>p.id===created.id&&p.path===created.path));assert.ok(restored.chats.some(c=>c.id===result.id));assert.ok(restored.history.messages.some(m=>m.text==='Upgrade preserved'));
 assert.equal(await (await import('node:fs/promises')).readFile(path.join(project,'sample.txt'),'utf8'),'keep this source');console.log('DMG install and replacement: preferences, project, session and source file preserved');
}finally{if(app)await app.close().catch(()=>{});if(mounted)execFileSync('hdiutil',['detach',mount],{stdio:'ignore'});server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}
