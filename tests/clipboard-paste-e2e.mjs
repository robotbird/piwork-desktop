import {_electron as electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
/* 输入框粘贴剪贴板内容:一次多图 → 多 chip → 发送成多图消息;Finder 拷贝文件(path 分支)混合批量;
   缓存副本落盘;无图片支持模型报错;纯文本粘贴不受影响 */
const root=await mkdtemp(path.join(os.tmpdir(),'piwork-clipboard-paste-'));
const profile=path.join(root,'profile');await mkdir(profile);
const pngBase64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const gateway=createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{res.writeHead(200,{'content-type':'text/event-stream'});const chunk=(delta,finish=null)=>`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[[{index:0,delta,finish_reason:finish}]][0]})}\n\n`;
 res.write(chunk({role:'assistant',content:'Complete reply'}));res.write(chunk({},'stop'));res.end('data: [DONE]\n\n')})});
await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));let app;
try{
 const launch=()=>electron.launch({executablePath:path.resolve('apps/desktop/node_modules/.bin/electron'),args:[path.resolve('apps/desktop'),`--user-data-dir=${profile}`],env:{...process.env,VITE_DEV_SERVER_URL:''}});
 app=await launch();let page=await app.firstWindow();await page.waitForLoadState('load');
 await page.evaluate(async url=>{await window.desktop.setPreferences({appearance:'light',language:'en'});await window.desktop.setGateway({baseUrl:url,modelId:'mock',apiKey:'',supportsImages:true})},`http://127.0.0.1:${gateway.address().port}/v1`);await page.reload();
 await page.getByRole('button',{name:'Model: mock',exact:true}).click();
 await page.getByRole('menuitemradio',{name:'mock',checked:true}).click();
 const composer=()=>page.getByRole('textbox',{name:'Describe what you want to do…'});
 const pngBytes=Buffer.from(pngBase64,'base64');
 // 在输入框派发携带多个图片文件的 paste 事件(等价 Cmd/Ctrl+V 剪贴板多图)
 const pasteImages=async names=>page.evaluate(([fileNames,base64])=>{
  const bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0));
  const transfer=new DataTransfer();
  for(const name of fileNames)transfer.items.add(new File([bytes],name,{type:'image/png'}));
  document.querySelector('.openai-composer textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
 },[names,pngBase64]);
 // 一次粘贴两张 → 两个 chip 各带缩略图;再粘一张 → 累积为三个(多附件追加)
 await pasteImages(['pasted-one.png','pasted-two.png']);
 await page.locator('.attachment-chip img').first().waitFor();
 assert.equal(await page.locator('.attachment-chip').count(),2);
 await pasteImages(['pasted-three.png']);
 await page.getByText('pasted-three.png',{exact:true}).waitFor();
 assert.equal(await page.locator('.attachment-chip').count(),3);
 // Finder 拷贝文件分支(DataTransfer 无法伪造真实路径,直连 IPC 验证 path 条目):
 // 文本文件 + 图片文件混合批量 → text/image 两种 kind、缓存副本落盘
 const note=path.join(root,'notes.txt');await writeFile(note,'Pasted from Finder');
 const shot=path.join(root,'finder-shot.png');await writeFile(shot,pngBytes);
 const picked=await page.evaluate(async([textPath,imagePath])=>await window.desktop.attachFiles([{path:textPath},{path:imagePath}]),[note,shot]);
 assert.equal(picked.length,2);
 assert.deepEqual(picked.map(item=>item.kind),['text','image']);
 assert.equal(picked[0].name,'notes.txt');
 assert.equal(picked[1].name,'finder-shot.png');
 const cacheRoot=path.join(profile,'attachments');
 const cached=async()=>(await readdir(cacheRoot,{recursive:true})).filter(name=>typeof name==='string'&&name.includes('/'));
 assert.equal((await cached()).length,5); // 3 张粘贴图 + 2 个 Finder 文件
 // 发送 → 消息内三个图片卡(多附件渲染);prompt 经 marker 记录全部附件
 await composer().fill('Clipboard paste test');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByText('Complete reply',{exact:true}).last().waitFor({timeout:15000});
 assert.equal(await page.locator('button.conversation-attachment-image').count(),3);
 // 纯文本粘贴不受影响:真实 Cmd+V 仍进入草稿文本、不产生附件 chip
 await app.evaluate(({clipboard},text)=>{clipboard.writeText(text)},'plain paste keeps working');
 await composer().click();
 await page.keyboard.press('Meta+v');
 await page.waitForFunction(()=>document.querySelector('.openai-composer textarea').value==='plain paste keeps working');
 assert.equal(await page.locator('.attachment-chip').count(),0);
 // 不支持图片的模型:粘贴报 modelNoImages,不产生 chip
 await page.evaluate(async url=>{await window.desktop.setGateway({baseUrl:url,modelId:'mock',apiKey:'',supportsImages:false})},`http://127.0.0.1:${gateway.address().port}/v1`);
 await page.reload();await page.waitForLoadState('load');
 await page.getByRole('button',{name:'Model: mock',exact:true}).click();
 await page.getByRole('menuitemradio',{name:'mock',checked:true}).click();
 await pasteImages(['blocked.png']);
 await page.getByText('The current model does not support images. Switch to a model with image support.').waitFor();
 assert.equal(await page.locator('.attachment-chip').count(),0);
 console.log('Electron clipboard paste: multi-image chips, cumulative paste, Finder path batch via attachFiles, send as multi-attachment message, cache copies, text paste intact, image-less model rejected passed');
}finally{if(app)await app.close().catch(()=>{});gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));await rm(root,{recursive:true,force:true})}
