import {mockBrowserLogin,loginWithMockBrowser} from './support/browser-login.mjs';
import {_electron as electron} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
const root=await mkdtemp(path.join(os.tmpdir(),'piwork-account-e2e-'));
let signedOut=false;let inferenceCount=0;let deny=false;const runIds=[];
const browserLogin=mockBrowserLogin();
const server=createServer((req,res)=>{
 if(browserLogin(req,res))return;
 if(req.url==='/login'&&req.method==='POST'){res.writeHead(303,{'location':'/login','set-cookie':'session=test; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax'});res.end();return}
 if(req.url==='/login'){res.writeHead(200,{'content-type':'text/html'});res.end('<form method="post" action="/login"><button>Sign in</button></form>');return}
 if(req.url==='/api/auth/session'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(req.headers.cookie?.includes('authjs.session-token=test')?{user:{id:'member',name:'Test member',email:'test@example.com'}}:{}));return}
 if(req.url==='/api/models'){res.writeHead(req.headers.cookie?.includes('authjs.session-token=test')?200:401,{'content-type':'application/json'});res.end(JSON.stringify({defaultModelId:'provider/model',models:[{id:'provider/other',name:'Other model'},{id:'provider/model',name:'Test model',providerKey:'deepseek'}]}));return}
 if(req.url==='/api/desktop/inference/messages'&&req.method==='POST'){
  if(!req.headers.cookie?.includes('authjs.session-token=test')||req.headers['x-piwork-desktop']!=='1'){res.writeHead(401);res.end();return}
  if(deny){res.writeHead(429,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'quota_exceeded',message:'Quota exceeded'}}));return}
  let body='';req.on('data',part=>body+=part);req.on('end',()=>{const parsed=JSON.parse(body);assert.equal(parsed.model,'provider/model');assert.match(parsed.runId,/^[0-9a-f-]{36}$/);runIds.push(parsed.runId);inferenceCount++;res.writeHead(200,{'content-type':'text/event-stream'});for(const event of [{type:'start'},{type:'text_start',contentIndex:0},{type:'text_delta',contentIndex:0,delta:'账号模型回复'},{type:'text_end',contentIndex:0,content:'账号模型回复'},{type:'done',reason:'stop',usage:{input:2,output:3,totalTokens:5,cacheRead:0,cacheWrite:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}])res.write(`data: ${JSON.stringify(event)}\n\n`);res.end()});return
 }
 if(req.url==='/api/auth/csrf'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({csrfToken:'csrf'}));return}
 if(req.url==='/api/auth/signout'&&req.method==='POST'){signedOut=true;res.writeHead(200,{'content-type':'application/json','set-cookie':'authjs.session-token=; Max-Age=0; Path=/'});res.end('{}');return}
 res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;let app;
try{
 const packaged=process.env.PIWORK_PACKAGED_APP==='1';const exe=packaged?(process.env.PIWORK_PACKAGED_EXECUTABLE||'apps/desktop/release/mac-arm64/PiWork.app/Contents/MacOS/PiWork'):'apps/desktop/node_modules/.bin/electron';const profile=path.join(root,'profile');const args=packaged?[`--user-data-dir=${profile}`]:[path.resolve('apps/desktop'),`--user-data-dir=${profile}`];const launch=()=>electron.launch({executablePath:path.resolve(exe),args,env:{...process.env,VITE_DEV_SERVER_URL:''}});
 app=await launch();let page=await app.firstWindow();await page.waitForLoadState('load');await assert.rejects(page.evaluate(()=>window.desktop.accountLogin('http://example.com')));await assert.rejects(page.evaluate(()=>window.desktop.accountLogin('https://user:pass@example.com')));await page.evaluate(()=>window.desktop.setPreferences({appearance:'light',language:'en'}));await page.reload();await page.getByRole('button',{name:'Settings',exact:false}).click();await page.getByRole('menuitem',{name:'Settings',exact:true}).click();const settings=page.getByRole('main',{name:'Settings'});await page.getByRole('button',{name:'Account & sync'}).click();await settings.getByLabel('PiWork server URL').fill(base);await loginWithMockBrowser(app,settings,base);await settings.getByText('Test member').waitFor();await settings.getByText('Test model (provider/model)').waitFor();await page.getByRole('button',{name:'Back to app'}).click();const modelButton=page.getByRole('button',{name:'Model: Test model',exact:true});
 await modelButton.click();
 await page.getByRole('menuitemradio',{name:'Test model',exact:true,checked:true}).waitFor();
 await page.getByRole('menuitemradio',{name:'Other model',exact:true}).click();
 await page.getByRole('button',{name:'Model: Other model',exact:true}).click();
 await page.getByRole('menuitemradio',{name:'Test model',exact:true}).click();
 await page.getByRole('textbox',{name:'Describe what you want to do…'}).fill('账号测试');await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('账号模型回复').waitFor({timeout:20000});assert.equal(inferenceCount,1);await page.getByRole('textbox',{name:'Describe what you want to do…'}).fill('继续');await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('账号模型回复').last().waitFor({timeout:20000});await page.getByRole('button',{name:'Send',exact:true}).waitFor({timeout:20000});assert.equal(inferenceCount,2);assert.notEqual(runIds[0],runIds[1]);deny=true;await page.getByRole('textbox',{name:'Describe what you want to do…'}).fill('超额');await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('Account usage limit reached. Contact an administrator.').waitFor({timeout:30000});deny=false;await app.close();app=await launch();page=await app.firstWindow();await page.getByRole('button',{name:'Settings',exact:false}).click();await page.getByRole('menuitem',{name:'Settings',exact:true}).click();const after=page.getByRole('main',{name:'Settings'});await page.getByRole('button',{name:'Account & sync'}).click();await after.getByText('Test member').waitFor();await page.getByRole('button',{name:'Back to app'}).click();await page.getByRole('button',{name:'Settings',exact:false}).click();await page.getByRole('menuitem',{name:'Sign out',exact:true}).click();assert.equal(signedOut,true);assert.equal((await page.evaluate(()=>window.desktop.accountStatus())).user,null);console.log('Account login session, model catalog, restart and menu sign-out passed');
}finally{if(app)await app.close().catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})}
