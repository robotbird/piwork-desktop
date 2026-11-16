import {_electron as electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const root=await mkdtemp(path.join(os.tmpdir(),'piwork-chat-edit-'));
const profile=path.join(root,'profile');await mkdir(profile);
const requests=[];
/* mock 网关:记录完整请求体,按触发词回复固定文案,便于区分轮次与验证截断后的上下文 */
const gateway=createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
 const payload=JSON.parse(body);requests.push(payload);
 const transcript=JSON.stringify(payload.messages);
 const reply=transcript.includes('Edited second question')?'Edited reply':transcript.includes('Original second question')?'Second reply':'First reply';
 const chunk=(delta,finish=null)=>`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;
 res.writeHead(200,{'content-type':'text/event-stream'});
 res.write(chunk({role:'assistant',content:reply}));
 res.write(chunk({},'stop'));
 res.end('data: [DONE]\n\n');
})});
await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));let app;
try{
 const launch=()=>electron.launch({executablePath:path.resolve('apps/desktop/node_modules/.bin/electron'),args:[path.resolve('apps/desktop'),`--user-data-dir=${profile}`],env:{...process.env,VITE_DEV_SERVER_URL:'',PIWORK_DEFAULT_SKILLS_DIR:path.join(root,'no-default-skills')}});
 app=await launch();const page=await app.firstWindow();await page.waitForLoadState('load');
 await page.evaluate(async url=>{await window.desktop.setPreferences({appearance:'light',language:'en'});await window.desktop.setGateway({baseUrl:url,modelId:'mock',apiKey:'',supportsImages:true})},`http://127.0.0.1:${gateway.address().port}/v1`);
 await page.reload();
 const composer=()=>page.getByRole('textbox',{name:'Describe what you want to do…'});
 const send=page.getByRole('button',{name:'Send',exact:true});
 const userMessage=index=>page.locator('.conversation-message[data-role=user]').nth(index);

 await composer().fill('First question');await send.click();
 await page.getByText('First reply',{exact:true}).waitFor({timeout:15000});
 await composer().fill('Original second question');await send.click();
 await page.getByText('Second reply',{exact:true}).waitFor({timeout:15000});
 await send.waitFor();

 /* hover 前:用户消息操作栏隐藏(opacity 0);hover 后淡入(等 150ms 过渡完成),编辑在前、复制在后 */
 assert.equal(await userMessage(1).locator('.conversation-message-actions-user').evaluate(element=>getComputedStyle(element).opacity),'0');
 const hoverRevealed=()=>page.waitForFunction(()=>{
  const element=document.querySelectorAll('.conversation-message[data-role=user]')[1]?.querySelector('.conversation-message-actions-user');
  return !!element&&getComputedStyle(element).opacity==='1';
 },{timeout:5000});
 await userMessage(1).hover();
 await hoverRevealed();
 const actionLabels=await userMessage(1).getByRole('button').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label')));
 assert.deepEqual(actionLabels,['Edit','Copy']);

 /* Esc 取消编辑:编辑器消失,气泡还原 */
 await userMessage(1).getByRole('button',{name:'Edit',exact:true}).click();
 const editor=userMessage(1).locator('.conversation-edit-input');
 await editor.waitFor();
 assert.equal(await editor.inputValue(),'Original second question');
 await editor.press('Escape');
 await userMessage(1).locator('.conversation-edit-input').waitFor({state:'detached'});
 await userMessage(1).getByText('Original second question',{exact:true}).waitFor();

 /* 编辑第二条用户消息:截断其后回复并以新文本重生成 */
 const requestsBefore=requests.length;
 await userMessage(1).hover();
 await hoverRevealed();
 await userMessage(1).getByRole('button',{name:'Edit',exact:true}).click();
 await editor.waitFor();
 await editor.fill('Edited second question');
 await editor.press('Enter');
 await page.getByText('Edited second question',{exact:true}).waitFor({timeout:15000});
 await page.getByText('Edited reply',{exact:true}).waitFor({timeout:15000});
 /* 旧回复从 UI 消失(截断) */
 await page.getByText('Second reply',{exact:true}).waitFor({state:'detached'});
 assert.equal(await page.getByText('Original second question',{exact:true}).count(),0);
 /* 第一轮保留 */
 await page.getByText('First reply',{exact:true}).waitFor();
 /* 重生成请求:包含编辑文本与第一轮历史,不含被截断的旧第二轮 */
 assert.equal(requests.length,requestsBefore+1);
 const context=JSON.stringify(requests.at(-1).messages);
 assert.match(context,/Edited second question/);
 assert.doesNotMatch(context,/Original second question/);
 assert.doesNotMatch(context,/Second reply/);
 assert.match(context,/First question/);
 assert.match(context,/First reply/);

 /* 复制按钮存在且可点击(剪贴板内容由系统策略决定,此处只验证交互路径) */
 await userMessage(1).hover();
 await hoverRevealed();
 await userMessage(1).getByRole('button',{name:'Copy',exact:true}).click();

 /* 重启后从磁盘回读:截断持久化,旧轮次不再出现 */
 await app.close();app=undefined;app=await launch();
 const page2=await app.firstWindow();
 await page2.getByRole('button',{name:'First question',exact:false}).first().click();
 await page2.getByText('First reply',{exact:true}).waitFor();
 await page2.getByText('Edited second question',{exact:true}).waitFor();
 await page2.getByText('Edited reply',{exact:true}).waitFor();
 assert.equal(await page2.getByText('Original second question',{exact:true}).count(),0);
 console.log('Electron chat edit: hover actions, inline editor, escape, truncate-and-regenerate and persistence passed');
}finally{if(app)await app.close().catch(()=>{});gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));await rm(root,{recursive:true,force:true})}
