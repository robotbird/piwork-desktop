import {_electron as electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readdir,rm,copyFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
/* 对话附件点击右侧预览:发送前 composer chip、发送后消息 chip、重启后历史 chip(缓存副本持久化) */
const root=await mkdtemp(path.join(os.tmpdir(),'piwork-attachment-preview-'));
const profile=path.join(root,'profile');await mkdir(profile);
const note=path.join(root,'notes.txt');await writeFile(note,'Preview payload text');
const pdf=path.join(root,'chinese-text.pdf');await copyFile(new URL('./fixtures/chinese-text.pdf',import.meta.url),pdf);
const pngBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const image1=path.join(root,'shot-1.png');await writeFile(image1,pngBytes);
const image2=path.join(root,'shot-2.png');await writeFile(image2,pngBytes);
const gateway=createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{res.writeHead(200,{'content-type':'text/event-stream'});const chunk=(delta,finish=null)=>`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;
 if(body.includes('INLINE_HTML_TEST')){res.write(chunk({role:'assistant',content:'Here is the page.\n\n```html\n<!doctype html><html><body>INLINE_PREVIEW_BODY</body></html>\n```\n\nDone.'}));res.write(chunk({},'stop'));res.end('data: [DONE]\n\n');return}
 res.write(chunk({role:'assistant',content:'Complete reply'}));res.write(chunk({},'stop'));res.end('data: [DONE]\n\n')})});
await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));let app;
try{
 const launch=()=>electron.launch({executablePath:path.resolve('apps/desktop/node_modules/.bin/electron'),args:[path.resolve('apps/desktop'),`--user-data-dir=${profile}`],env:{...process.env,VITE_DEV_SERVER_URL:''}});
 app=await launch();let page=await app.firstWindow();await page.waitForLoadState('load');
 await page.evaluate(async url=>{await window.desktop.setPreferences({appearance:'light',language:'en'});await window.desktop.setGateway({baseUrl:url,modelId:'mock',apiKey:'',supportsImages:true})},`http://127.0.0.1:${gateway.address().port}/v1`);await page.reload();
 const composer=()=>page.getByRole('textbox',{name:'Describe what you want to do…'});
 await page.getByRole('button',{name:'Model: mock',exact:true}).click();
 await page.getByRole('menuitemradio',{name:'mock',checked:true}).click();
 const attachFile=async file=>{
  await app.evaluate(({dialog},filePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]})},file);
  await page.getByRole('button',{name:'Add photos and files'}).click();
  await page.getByRole('menuitem',{name:'Add photos and files Upload from computer'}).click();
  await page.getByText(path.basename(file),{exact:true}).waitFor();
 };
 // 发送前:composer chip 可点击,右侧 dock 打开文本预览
 await attachFile(note);
 await page.locator('.attachment-chip-preview',{hasText:'notes.txt'}).click();
 await page.locator('.dock-tab.active',{hasText:'notes.txt'}).waitFor();
 await page.getByText('Preview payload text').waitFor();
 // 发送后:消息内 chip 点击复用同一标签
 await composer().fill('Attachment preview test');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByText('Complete reply',{exact:true}).last().waitFor({timeout:15000});
 await page.locator('button.conversation-attachment',{hasText:'notes.txt'}).click();
 await page.locator('.dock-tab.active',{hasText:'notes.txt'}).waitFor();
 await page.getByText('Preview payload text').waitFor();
 // PDF 附件:chip 用文件类型 SVG 图标,点击打开 pdf 预览标签
 await attachFile(pdf);
 await page.locator('.attachment-chip img[src*="pdf.svg"]').waitFor();
 await composer().fill('Second with pdf');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByText('Complete reply',{exact:true}).last().waitFor({timeout:15000});
 await page.locator('button.conversation-attachment img[src*="pdf.svg"]').waitFor();
 await page.locator('button.conversation-attachment',{hasText:'chinese-text.pdf'}).click();
 await page.locator('.dock-tab.active',{hasText:'chinese-text.pdf'}).waitFor();
 // 附件缓存副本落盘
 const cached=(await readdir(path.join(profile,'attachments'),{recursive:true})).filter(name=>typeof name==='string'&&name.includes('/'));
 assert.equal(cached.length,2);
 // 图片附件:发送前 composer chip 显示缩略图,点击缩略图本体即打开全屏灯箱(不进右侧 dock)
 await attachFile(image1);
 await page.locator('.attachment-chip img').waitFor();
 await page.locator('.attachment-chip-preview img').click();
 await page.locator('[data-lightbox]').waitFor();
 await page.locator('.lightbox-close').click();
 await page.locator('[data-lightbox]').waitFor({state:'hidden'});
 await composer().fill('Third with image');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByText('Complete reply',{exact:true}).last().waitFor({timeout:15000});
 // 第二张图片:消息内缩略图卡片,点开灯箱后多图上一张/下一张
 await attachFile(image2);
 await composer().fill('Fourth with image');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByText('Complete reply',{exact:true}).last().waitFor({timeout:15000});
 await page.locator('button.conversation-attachment-image img').first().waitFor();
 await page.locator('button.conversation-attachment-image',{hasText:'shot-2.png'}).click();
 await page.locator('[data-lightbox] img').waitFor();
 await page.getByText('2 / 2',{exact:true}).waitFor();
 await page.locator('.lightbox-nav button[aria-label="Previous"]').click();
 await page.getByText('1 / 2',{exact:true}).waitFor();
 await page.locator('.lightbox-close').click();
 await page.locator('[data-lightbox]').waitFor({state:'hidden'});
 assert.equal(await page.locator('.dock-tab',{hasText:/shot-[12]\.png/}).count(),0);
 // 对话中生成的内联 HTML:卡片点击直接在右侧预览(无需先保存),不再泄露正文
 await composer().fill('INLINE_HTML_TEST');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByText('Done.',{exact:true}).waitFor({timeout:15000});
 assert.equal(await page.getByText('INLINE_PREVIEW_BODY',{exact:false}).count(),0);
 await page.getByRole('button',{name:'File preview · piwork-answer.html',exact:true}).click();
 await page.locator('.dock-tab.active',{hasText:'piwork-answer.html'}).waitFor();
 await page.locator('.document-pad iframe[data-html-preview][data-html-mode="interactive"]').waitFor();
 // 重启后历史消息 chip 仍可点击预览(缓存副本持久化)
 await app.close();app=undefined;app=await launch();page=await app.firstWindow();
 await page.getByRole('button',{name:'Attachment preview test'}).click();
 await page.locator('button.conversation-attachment',{hasText:'notes.txt'}).waitFor();
 await page.locator('button.conversation-attachment',{hasText:'notes.txt'}).click();
 await page.locator('.dock-tab.active',{hasText:'notes.txt'}).waitFor();
 await page.getByText('Preview payload text').waitFor();
 // 重启后图片缩略图与灯箱依旧可用
 await page.locator('button.conversation-attachment-image',{hasText:'shot-1.png'}).click();
 await page.locator('[data-lightbox] img').waitFor();
 await page.getByText('1 / 2',{exact:true}).waitFor();
 await page.locator('.lightbox-close').click();
 console.log('Electron chat attachment preview: composer chip, message chip, type icons, image lightbox with navigation and post-restart history preview passed');
}finally{if(app)await app.close().catch(()=>{});gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));await rm(root,{recursive:true,force:true})}
