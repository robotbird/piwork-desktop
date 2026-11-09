import {_electron as electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,copyFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'piwork-links-')));
const folder=path.join(root,'project');await mkdir(folder);
for(const ext of ['pdf','docx','xlsx','pptx'])await copyFile(new URL(`./fixtures/office-basic.${ext}`,import.meta.url),path.join(folder,`技术 报告.${ext}`));
await writeFile(path.join(folder,'report.md'),'Markdown preview fixture');
await writeFile(path.join(folder,'report.html'),'<html><body><h1>HTML preview fixture</h1></body></html>');
const answer=['Reports generated:',...['pdf','docx','xlsx','pptx'].map(ext=>`\`${folder}/技术 报告.${ext}\``),'[Markdown](report.md)','[HTML](report.html)','Plain path: project/report.md','[External](https://example.com/report.pdf)','```sh\ncat /tmp/report.pdf\n```'].join('\n\n');
const server=createServer((req,res)=>{req.resume();req.on('end',()=>{
  res.writeHead(200,{'content-type':'text/event-stream'});
  const chunk=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta,finish_reason}]})}\n\n`);
  chunk({role:'assistant',content:answer});chunk({},'stop');res.end('data: [DONE]\n\n');
})});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let app;let page;
try{
  app=await electron.launch({executablePath:path.resolve('apps/desktop/node_modules/.bin/electron'),args:[path.resolve('apps/desktop'),`--user-data-dir=${path.join(root,'profile')}`],env:{...process.env,VITE_DEV_SERVER_URL:'',PIWORK_DEFAULT_SKILLS_DIR:path.join(root,'no-skills')}});
  page=await app.firstWindow();await page.waitForLoadState('load');
  await page.evaluate(async url=>{await window.desktop.setPreferences({appearance:'light',language:'en'});await window.desktop.setGateway({baseUrl:url,modelId:'mock',apiKey:'',supportsImages:false})},`http://127.0.0.1:${server.address().port}/v1`);
  await page.reload();
  await page.getByRole('button',{name:'Model: mock',exact:true}).click();
  await page.getByRole('menuitemradio',{name:'mock',checked:true}).click();
  await app.evaluate(({dialog},dir)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[dir]})},folder);
  await page.getByRole('button',{name:'Add project',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Add a folder from this computer'}).click();await dialog.getByLabel('Project name').fill('Links project');await dialog.getByRole('button',{name:'Create project'}).click();
  const composer=page.getByRole('textbox',{name:'Start a new chat',exact:true});await composer.fill('Generate reports');await page.locator('form button[type=submit]').click();
  console.log('Sent request');
  const links=page.locator('.conversation-document-link');await links.first().waitFor({timeout:20000});
  assert.equal(await links.count(),7);
  assert.equal(await links.first().evaluate(node=>getComputedStyle(node).fontWeight),'700');
  assert.equal(await page.locator('pre .conversation-document-link').count(),0);
  assert.equal(await page.getByRole('link',{name:'External',exact:true}).getAttribute('href'),'https://example.com/report.pdf');
  const visible=page.locator('.dock-body:not([hidden])');
  for(const ext of ['pdf','docx','xlsx','pptx']){
    console.log('Preview',ext);
    await links.filter({hasText:`技术 报告.${ext}`}).click();
    await page.getByRole('tab',{name:`技术 报告.${ext}`}).waitFor();
    assert.equal(await page.locator('.file-preview').getAttribute('data-collapsed'),null);
    assert.equal(await visible.locator('.error').count(),0);
    const selector={pdf:'.pdf-preview',docx:'iframe[title="Word document preview"]',xlsx:'.xlsx-preview',pptx:'.pptx-slide'}[ext];
    await visible.locator(selector).waitFor({timeout:15000});
  }
  await page.getByRole('link',{name:'Markdown',exact:true}).click();await visible.getByText('Markdown preview fixture',{exact:true}).waitFor();
  await page.getByRole('link',{name:'HTML',exact:true}).click();await visible.frameLocator('iframe').getByText('HTML preview fixture').waitFor();
  await mkdir('.visual-tmp',{recursive:true});await page.screenshot({path:'.visual-tmp/document-links.png'});
  assert.equal(await links.first().evaluate(node=>getComputedStyle(node).color),'rgb(21, 62, 117)');
  for(const ext of ['pdf','docx','xlsx','pptx']){
    const icon=links.filter({hasText:`技术 报告.${ext}`}).locator('img');
    assert.equal(await icon.evaluate(node=>node.complete&&node.naturalWidth>0),true);
  }
  // The same reply restored from a chat with no project must still open local outputs.
  await page.getByRole('button',{name:'New chat',exact:true}).click();
  const general=page.locator('textarea');await general.fill('Historical output preview');await general.press('Enter');
  await page.locator('.conversation-document-link').first().waitFor();
  await page.getByRole('button',{name:'Send',exact:true}).waitFor();
  await page.reload();
  await page.getByRole('button',{name:'Historical output preview',exact:true}).click();
  const historical=page.locator('.conversation-document-link');
  for(const ext of ['pdf','docx','xlsx','pptx']){
    await historical.filter({hasText:`技术 报告.${ext}`}).click();
    const body=page.locator('.dock-body:not([hidden])');
    const selector={pdf:'.pdf-preview',docx:'iframe[title="Word document preview"]',xlsx:'.xlsx-preview',pptx:'.pptx-slide'}[ext];
    await body.locator(selector).waitFor({timeout:15000});
    assert.equal(await body.locator('.error').count(),0);
  }
  // Only references from the active chat can be resolved, never an arbitrary renderer path.
  const chats=await page.evaluate(()=>window.desktop.listChats());
  const chat=chats.find(chat=>chat.title==='Historical output preview');assert.equal(chat.projectId,null);
  const rejected=await page.evaluate(async id=>{try{await window.desktop.cacheGeneratedDocument(id,'/etc/private.pdf');return false}catch{return true}},chat.id);
  assert.equal(rejected,true);
  await page.screenshot({path:'.visual-tmp/historical-document-links.png'});
  console.log('Project and restored projectless chats preview documents; deep blue links and file icons verified.');
}catch(error){console.log(await page?.locator('body').innerText());throw error}finally{if(app)await app.close().catch(()=>{});await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})}
