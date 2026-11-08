import {_electron as electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const root=await mkdtemp(path.join(os.tmpdir(),'piwork-chat-ui-'));
const profile=path.join(root,'profile');const skill=path.join(root,'skill');await mkdir(skill);const skillFile=path.join(skill,'SKILL.md');await writeFile(skillFile,'---\nname: original\ndescription: Original skill\n---\nUse concise text.\n');
const note=path.join(root,'attachment.txt');
const image=path.join(root,'attachment.png');
await writeFile(note,'Composer attachment payload');
await writeFile(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));
const requests=[];
let finishToolText;
const gateway=createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{res.writeHead(200,{'content-type':'text/event-stream'});const lastMessage=JSON.parse(body).messages.at(-1);requests.push(lastMessage);const slow=JSON.stringify(lastMessage).includes('STOP_TEST');
if(JSON.stringify(lastMessage).includes('TOOL_TEXT_TEST')){
 const delta=(content,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta:{content},finish_reason}]})}\n\n`);
 delta('I will check\n\n<tool_ca');
 finishToolText=()=>{
  delta('ll> {"name":"bash","arguments":{"command":"pwd"}} </tool_call> </tool_call>');
  delta('', 'stop');
  res.end('data: [DONE]\n\n');
 };
 return;
}
if(JSON.stringify(lastMessage).includes('HTML_RESPONSE_TEST')){
 const delta=(content,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta:{content},finish_reason}]})}\n\n`);
 delta('Here is the report.\n\n```html\n<!doctype html><html><body>HIDDEN_HTML_BODY');
 finishToolText=()=>{
  delta('</body></html>\n```\n\nReport ready.');
  delta('', 'stop');
  res.end('data: [DONE]\n\n');
 };
 return;
}
if(JSON.stringify(lastMessage).includes('ANY_FILE_TEST')){
 const delta=(content,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta:{content},finish_reason}]})}\n\n`);
 delta('Any file reply');delta('', 'stop');res.end('data: [DONE]\n\n');return;
}
const reply=JSON.stringify(lastMessage).includes('MARKDOWN_TEST')?'## Formatting check\n\n**Bold reply**\n\n'+Array.from({length:36},(_,index)=>`${index+1}. Row ${index+1}`).join('\n'):slow?'Partial reply':'Complete reply';const chunk=(delta,finish=null)=>`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;res.write(chunk({role:'assistant',content:reply}));if(!slow){res.write(chunk({},'stop'));res.end('data: [DONE]\n\n')}})});
await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));let app;
try{
 const launch=()=>electron.launch({executablePath:path.resolve('apps/desktop/node_modules/.bin/electron'),args:[path.resolve('apps/desktop'),`--user-data-dir=${profile}`],env:{...process.env,VITE_DEV_SERVER_URL:'',PIWORK_DEFAULT_SKILLS_DIR:path.join(root,'no-default-skills')}});
 app=await launch();let page=await app.firstWindow();await page.waitForLoadState('load');await page.evaluate(async url=>{await window.desktop.setPreferences({appearance:'light',language:'en'});await window.desktop.setGateway({baseUrl:url,modelId:'mock',apiKey:'',supportsImages:true})},`http://127.0.0.1:${gateway.address().port}/v1`);await page.reload();
 const composer=()=>page.getByRole('textbox',{name:'Describe what you want to do…'});
 const composerBorder=()=>page.locator('.composer').evaluate(element=>getComputedStyle(element).borderColor);
 const unfocusedBorder=await composerBorder();
 await composer().focus();
 assert.equal(await composerBorder(),unfocusedBorder);
 assert.equal(await composer().evaluate(element=>getComputedStyle(element).outlineStyle),'none');
 await page.getByRole('button',{name:'Model: mock',exact:true}).click();
 await page.getByRole('menuitemradio',{name:'mock',checked:true}).click();
 await page.waitForFunction(()=>document.activeElement?.tagName==='TEXTAREA');

 async function attachFile(file){
  await app.evaluate(({dialog},filePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]})},file);
  await page.getByRole('button',{name:'Add photos and files'}).click();
  await page.getByRole('menuitem',{name:'Choose from my documents Browse and search files'}).waitFor();
  await page.getByRole('menuitem',{name:'Add photos and files Upload from computer'}).click();
  await page.getByText(path.basename(file),{exact:true}).waitFor();
 }
 await attachFile(note);
 await composer().fill('STOP_TEST');await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('Partial reply').waitFor({timeout:15000});assert.match(JSON.stringify(requests.at(-1)),/Composer attachment payload/);await page.getByRole('button',{name:'Stop',exact:true}).click();await page.getByText('Stopped',{exact:true}).waitFor({timeout:15000});await page.getByText('Partial reply').waitFor();
 await attachFile(image);await composer().fill('Continue after stop');await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('Complete reply').waitFor({timeout:15000});assert.match(JSON.stringify(requests.at(-1)),/data:image\/png;base64,/);await page.getByRole('button',{name:'Send',exact:true}).waitFor();
 const snippet=path.join(root,'snippet.go');await writeFile(snippet,'package main\n');
 await attachFile(snippet);await composer().fill('ANY_FILE_TEST');await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('Any file reply',{exact:true}).waitFor({timeout:15000});assert.match(JSON.stringify(requests.at(-1)),/package main/);
 const archive=path.join(root,'payload.bin');await writeFile(archive,Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]),Buffer.alloc(64)]));
 await app.evaluate(({dialog},filePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]})},archive);
 await page.getByRole('button',{name:'Add photos and files'}).click();
 await page.getByRole('menuitem',{name:'Add photos and files Upload from computer'}).click();
 await page.getByText('other binary files cannot be sent',{exact:false}).waitFor();
 await page.emulateMedia({reducedMotion:'reduce'});
 const submit=page.getByRole('button',{name:'Send',exact:true});
 assert.equal(await submit.isDisabled(),true);
 const disabledBackground=await submit.evaluate(element=>getComputedStyle(element).backgroundColor);
 await composer().fill('MARKDOWN_TEST');
 assert.notEqual(await submit.evaluate(element=>getComputedStyle(element).backgroundColor),disabledBackground);
 await submit.click();
 await page.getByRole('heading',{name:'Formatting check'}).waitFor();
 await page.locator('.conversation-reply [data-streamdown="strong"]').filter({hasText:'Bold reply'}).waitFor();
 await page.getByText('Row 36',{exact:true}).waitFor();
 await page.waitForFunction(()=>{
  const scroll=document.querySelector('.conversation-scroll');
  return scroll&&scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<80;
 });
 const scrollArea=page.locator('.conversation-scroll');
 await scrollArea.hover();
 await page.mouse.wheel(0,-1200);
 const jump=page.getByRole('button',{name:'Scroll to bottom'});
 await jump.waitFor();
 await jump.click();
 await jump.waitFor({state:'hidden'});

 const requestsBeforeToolText=requests.length;
 await composer().fill('TOOL_TEXT_TEST');
 await submit.click();
 await page.getByText('I will check',{exact:true}).waitFor();
 assert.equal(await page.getByText(/<tool_ca/).count(),0);
 finishToolText();
 const unexecuted=page.getByText('The model returned a tool request as text. No tools ran. To use local files, select a project in a new chat or attach the files using the add button.',{exact:true});
 await unexecuted.waitFor();
 assert.equal(await page.getByText(/<tool_call>/).count(),0);
 assert.equal(await page.getByRole('group',{name:'Tool activity'}).count(),0);
 assert.equal(requests.length,requestsBeforeToolText+1);

 await composer().fill('HTML_RESPONSE_TEST');
 await submit.click();
 await page.getByText('Here is the report.',{exact:true}).waitFor();
 assert.equal(await page.getByText('HIDDEN_HTML_BODY',{exact:false}).count(),0);
 finishToolText();
 const htmlCard=()=>page.getByRole('button',{name:'File preview · piwork-answer.html',exact:true});
 await htmlCard().waitFor();
 await page.getByText('Report ready.',{exact:true}).waitFor();
 assert.equal(await page.getByText('HIDDEN_HTML_BODY',{exact:false}).count(),0);
 // 内联 HTML 卡片点击直接在右侧 dock 预览(srcDoc 交互 iframe),无需先保存
 await htmlCard().click();
 await page.locator('.dock-tab.active',{hasText:'piwork-answer.html'}).waitFor();
 await page.locator('.document-pad iframe[data-html-preview][data-html-mode="interactive"]').waitFor();
 const savedHtml=path.join(profile,'library','saved.html');
 await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath})},savedHtml);
 await page.getByRole('button',{name:'Save HTML file',exact:true}).click();
 await page.getByText('HTML file saved',{exact:true}).waitFor();
 assert.equal(await readFile(savedHtml,'utf8'),'<!doctype html><html><body>HIDDEN_HTML_BODY</body></html>');

 let chats=await page.evaluate(()=>window.desktop.listChats());assert.equal(chats.length,1);const chatId=chats[0].id;
 await page.getByRole('button',{name:'Rename chat'}).click();const renameDialog=page.getByRole('dialog',{name:'Rename chat'});await renameDialog.getByLabel('Rename chat').fill('Renamed task');await renameDialog.getByRole('button',{name:'Save'}).click();await page.getByRole('button',{name:'Renamed task'}).waitFor();
 await app.close();app=undefined;app=await launch();page=await app.firstWindow();await page.getByRole('button',{name:'Renamed task'}).click();await page.getByText('Complete reply').waitFor();await page.getByText('Partial reply').waitFor();await page.locator('.conversation-attachment').getByText('attachment.txt').waitFor();assert.equal(await page.getByText('Composer attachment payload',{exact:false}).count(),0);await page.getByText('The model returned a tool request as text. No tools ran. To use local files, select a project in a new chat or attach the files using the add button.',{exact:true}).waitFor();await htmlCard().waitFor();assert.equal(await page.getByText('HIDDEN_HTML_BODY',{exact:false}).count(),0);
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete chat'}).click();await page.getByRole('button',{name:'Renamed task'}).waitFor({state:'detached'});chats=await page.evaluate(()=>window.desktop.listChats());assert.equal(chats.length,0);assert.ok((await readdir(path.join(profile,'sessions-trash'))).some(name=>name.startsWith(chatId)));
 await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]})},skill);await page.getByRole('button',{name:'Skills',exact:false}).click();const modal=page.getByRole('main',{name:'Skills'});await modal.getByRole('button',{name:'Import skill'}).click();await modal.getByText('original',{exact:true}).waitFor();await modal.getByRole('button',{name:'Close'}).click();await writeFile(skillFile,'---\nname: changed\ndescription: Changed skill\n---\nUpdated.\n');await composer().fill('/orig');await page.getByRole('option',{name:/original/}).click();await composer().fill('broken skill');await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('Chat could not finish. Check the model gateway, selected skill or MCP settings.').waitFor({timeout:15000});await page.getByRole('button',{name:'Send',exact:true}).waitFor();
 console.log('Electron chat: focus, model menu, local text, image and any-file attachments, stop, continue, rename, restart, delete and startup failure passed');
}finally{if(app)await app.close().catch(()=>{});gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));await rm(root,{recursive:true,force:true})}
