import {_electron as electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,readdir,realpath,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
/* 无项目会话生成 Word 文档端到端:mock 网关依次调用 project_create_office(blocks)→
   project_append_office(分块续写)→ office_render(视觉自检),断言文件落入 我的文档/AI 生成/<会话文件夹>、
   登记为 AI 生成、渲染图片回到模型、回复的绝对路径链接可点击预览(LibreOffice→PDF 文本层)、
   重开对话后单张文件卡片。 */
const root=await mkdtemp(path.join(os.tmpdir(),'piwork-doc-ui-'));
const bodies=[];let documentPath='';
const server=createServer((req,res)=>{let body='';req.on('data',x=>body+=x);req.on('end',()=>{
 bodies.push(body);
 const call=bodies.length===1?{name:'project_create_office',args:{path:'报告.docx',title:'季度核查报告',doc:{footer:true},blocks:[
  {type:'cover',subtitle:'自检与结论',meta:['2026-11-14']},
  {type:'heading',level:1,text:'一、核查过程'},
  {type:'paragraph',runs:[{text:'已确认 '},{text:'queryIndex',code:true},{text:' 字段存在',bold:true}]},
  {type:'table',header:['字段','说明'],rows:[['id','主键']]}
 ]}}:bodies.length===2?{name:'project_append_office',args:{path:'报告.docx',blocks:JSON.stringify([
  {type:'heading',level:1,text:'二、追加章节'},
  {type:'list',ordered:true,items:['第一条结论','第二条结论']},
 ])}}:bodies.length===3?{name:'office_render',args:{path:'报告.docx'}}:null;
 const chunk=(delta,finish)=>`data: ${JSON.stringify({id:'t',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;
 res.writeHead(200,{'content-type':'text/event-stream'});
 if(call){res.write(chunk({role:'assistant',tool_calls:[{index:0,id:'call_'+bodies.length,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]},null));res.write(chunk({},'tool_calls'))}
 else{
  // 从 project_create_office 工具结果中取 workspace 绝对路径,回复以粗体链接交付
  const messages=JSON.parse(body).messages;
  const created=messages.map(message=>typeof message.content==='string'?message.content:'').find(text=>text.includes('Created 报告.docx'))??'';
  documentPath=created.split('\n').at(-1);
  assert.match(documentPath,/报告\.docx$/);
  res.write(chunk({role:'assistant',content:`报告已生成 **[报告.docx](${documentPath})**`},null));res.write(chunk({},'stop'));
 }
 res.end('data: [DONE]\n\n')})});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let app;
try{
 const packaged=process.env.PIWORK_PACKAGED_APP==='1';const executable=packaged?(process.env.PIWORK_PACKAGED_EXECUTABLE||'apps/desktop/release/mac-arm64/PiWork.app/Contents/MacOS/PiWork'):'apps/desktop/node_modules/.bin/electron';const args=packaged?[`--user-data-dir=${path.join(root,'profile')}`]:[path.resolve('apps/desktop'),`--user-data-dir=${path.join(root,'profile')}`];
 app=await electron.launch({executablePath:path.resolve(executable),args,env:{...process.env,VITE_DEV_SERVER_URL:''}});
 const page=await app.firstWindow();await page.waitForLoadState('load');
 await page.evaluate(async url=>{await window.desktop.setPreferences({appearance:'light',language:'en'});await window.desktop.setGateway({baseUrl:url,modelId:'mock',apiKey:'',supportsImages:true})},`http://127.0.0.1:${server.address().port}/v1`);
 await page.reload();
 // 无项目:空状态直接在全局 composer 发起对话;create 与 append 两次落盘写入均经内联审批卡确认
 await page.getByLabel('Describe what you want to do…').fill('生成一份 Word 报告');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 for(const step of ['create','append']){
  const allowChoice=page.getByText('Allow once',{exact:true});
  await allowChoice.waitFor({timeout:30000});
  assert.match(await page.locator('body').innerText(),/报告\.docx/);
  await allowChoice.click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
 }
 await page.getByText('报告已生成').waitFor({timeout:60000});
 // 文件落在聊天专属输出目录,库索引登记为 AI 生成
 const aiRoot=path.join(root,'profile','library','AI 生成');
 const folders=await readdir(aiRoot);
 assert.equal(folders.length,1);
 const doc=path.join(aiRoot,folders[0],'报告.docx');
 assert.equal(documentPath,await realpath(doc));
 assert.equal(Buffer.from(await readFile(doc)).subarray(0,2).toString('ascii'),'PK');
 const libraryIndex=JSON.parse(await readFile(path.join(root,'profile','library','.piwork-library.json'),'utf8'));
 assert.ok(libraryIndex.ai.includes(`AI 生成/${folders[0]}/报告.docx`),'library index marks the document as AI generated');
 // office_render 的渲染图片真的回到了模型上下文(工具结果摘要 + data:image/png 附件)
 assert.match(bodies[3],/image\/png/);
 assert.match(bodies[3],/pageCount/);
 // 工具面板折叠在「Worked for」处理面板内:先展开处理过程,再展开工具组查看渲染自检步骤
 await page.getByRole('button',{name:/Worked for/}).click();
 await page.getByRole('button',{name:/Tool activity/}).first().click();
 await page.getByText('Render document pages',{exact:true}).waitFor();
 await page.getByText('Append to Office file',{exact:true}).waitFor();
 // 回复中的绝对路径链接渲染为文件卡片,点击进入预览(LibreOffice→PDF 文本层含创建与追加的全部正文)
 const card=page.getByRole('button',{name:'Preview: 报告.docx'});
 await card.waitFor();
 await card.click();
 const pdfTextHas=async needle=>{await page.waitForFunction(needle=>{const text=[...document.querySelectorAll('.dock-body:not([hidden]) .pdf-text-layer')].map(node=>node.textContent).join('');return [...needle].every(ch=>text.includes(ch))},needle,{timeout:60000})};
 await pdfTextHas('核查过程');
 await pdfTextHas('追加章节');
 // 重开对话(历史回放):工具事件按绝对路径还原,与正文链接去重后仍只展示一张文件卡片
 await page.getByRole('button',{name:'New chat',exact:false}).click();
 await page.getByRole('button',{name:'生成一份 Word 报告',exact:true}).first().click();
 await page.getByText('报告已生成').waitFor({timeout:30000});
 const cardCount=await page.getByRole('button',{name:'Preview: 报告.docx'}).count();
 assert.equal(cardCount,1,`expected exactly one file card after reopening, got ${cardCount}`);
 console.log('Electron chat document: workspace write, AI library registration, render self-check, preview and single card after reopen passed');
}finally{if(app)await app.close().catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})}
