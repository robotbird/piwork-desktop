import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink,copyFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {createProjectTools} from '../apps/desktop/electron/project-tools.ts';
import {ChatSession} from '../apps/desktop/electron/chat-session.ts';

test('project tools confine paths and confirm writes while preserving changed originals',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'piwork-tools-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(path.join(root,'notes.md'),'before');let allow=true;let during;const approved=[];
 const tools=createProjectTools([{root,label:'main'}],async(id,name,input)=>{approved.push(input);await during?.();return allow});const read=tools.find(t=>t.name==='project_read'),write=tools.find(t=>t.name==='project_write');const invoke=(tool,args)=>tool.execute('id',args,undefined,undefined,{});
 assert.equal((await invoke(read,{path:'notes.md'})).content[0].text,'before');await assert.rejects(invoke(read,{path:'../outside.md'}));await assert.rejects(invoke(write,{path:'../outside.md',content:'x'}));
 await symlink(path.join(root,'notes.md'),path.join(root,'link.md'));await assert.rejects(invoke(read,{path:'link.md'}));await assert.rejects(invoke(write,{path:'link.md',content:'x'}));
 allow=false;await assert.rejects(invoke(write,{path:'notes.md',content:'denied'}),/not approved/);assert.equal(await readFile(path.join(root,'notes.md'),'utf8'),'before');allow=true;
 during=()=>writeFile(path.join(root,'notes.md'),'external');await assert.rejects(invoke(write,{path:'notes.md',content:'new'}),/changed/);assert.equal(await readFile(path.join(root,'notes.md'),'utf8'),'external');during=undefined;
 await invoke(write,{path:'notes.md',content:'updated'});await invoke(write,{path:'new.md',content:'created'});assert.equal(await readFile(path.join(root,'notes.md'),'utf8'),'updated');assert.equal(await readFile(path.join(root,'new.md'),'utf8'),'created');assert.deepEqual(approved.map(x=>x.action),['replace','replace','replace','create']);
});

test('multi-root projects read every source folder but only write the main folder',async t=>{
 const base=await mkdtemp(path.join(os.tmpdir(),'piwork-multiroot-tools-'));t.after(()=>rm(base,{recursive:true,force:true}));
 const main=path.join(base,'main'),second=path.join(base,'second');await mkdir(main);await mkdir(second);
 await writeFile(path.join(main,'note.md'),'main note');await writeFile(path.join(second,'data.md'),'second note');
 const roots=[{root:main,label:'main'},{root:second,label:'second'}];
 const tools=createProjectTools(roots,async()=>true);
 const read=tools.find(tool=>tool.name==='project_read'),write=tools.find(tool=>tool.name==='project_write'),list=tools.find(tool=>tool.name==='project_list'),office=tools.find(tool=>tool.name==='project_create_office');
 const invoke=(tool,args)=>tool.execute('id',args,undefined,undefined,{});
 // 根层列出源文件夹并标记主文件夹
 const rootListing=JSON.parse((await invoke(list,{path:''})).content[0].text);
 assert.deepEqual(rootListing.folders,[{name:'main',main:true},{name:'second',main:false}]);
 assert.deepEqual(rootListing.entries.map(entry=>[entry.name,entry.kind]),[['main','directory'],['second','directory']]);
 // 读取:裸路径落主文件夹,label 前缀可读任意源文件夹
 assert.equal((await invoke(read,{path:'note.md'})).content[0].text,'main note');
 assert.equal((await invoke(read,{path:'second/data.md'})).content[0].text,'second note');
 assert.equal((await invoke(read,{path:'main/note.md'})).content[0].text,'main note');
 // 写入:仅主文件夹(主文件夹 label 前缀剥掉后仍落主文件夹;其他源文件夹拒绝)
 await invoke(write,{path:'generated.md',content:'ok'});
 assert.equal(await readFile(path.join(main,'generated.md'),'utf8'),'ok');
 await invoke(write,{path:'main/nested.md',content:'ok'});
 assert.equal(await readFile(path.join(main,'nested.md'),'utf8'),'ok');
 await assert.rejects(invoke(write,{path:'second/out.md',content:'x'}),/main folder/);
 await assert.rejects(invoke(office,{path:'second/out.docx',title:'t',paragraphs:[]}),/main folder/);
});

test('cancelling during approval prevents text and Office writes even if approval arrives later',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'piwork-cancel-write-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path.join(root,'notes.md'),'original');
 for(const [name,args,target] of [
  ['project_write',{path:'notes.md',content:'replacement'},'notes.md'],
  ['project_create_office',{path:'report.docx',title:'报告',paragraphs:['内容']},'report.docx'],
 ]){
  const controller=new AbortController();let releaseApproval,approvalStarted;
  const entered=new Promise(resolve=>{approvalStarted=resolve});
  const tools=createProjectTools([{root,label:'main'}],async()=>{approvalStarted();return new Promise(resolve=>{releaseApproval=resolve})});
  const tool=tools.find(item=>item.name===name);
  const pending=tool.execute('id',args,controller.signal,undefined,{});
  await entered;controller.abort();releaseApproval(true);
  await assert.rejects(pending,/cancelled/);
  if(target==='notes.md')assert.equal(await readFile(path.join(root,target),'utf8'),'original');
  else await assert.rejects(readFile(path.join(root,target)),/ENOENT/);
 }
});

test('Pi invokes project tools with streamed execution events',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'piwork-agent-tools-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(path.join(root,'input.md'),'中文资料');let count=0;let lastBody;const server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{lastBody=JSON.parse(body);count++;res.writeHead(200,{'content-type':'text/event-stream'});const chunk=(delta,finish)=>`data: ${JSON.stringify({id:'t',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;if(count===1||count===2){const name=count===1?'project_read':'project_write',args=count===1?{path:'input.md'}:{path:'result.md',content:'整理完成'};res.write(chunk({role:'assistant',tool_calls:[{index:0,id:'call_'+count,type:'function',function:{name,arguments:JSON.stringify(args)}}]},null));res.write(chunk({},'tool_calls'))}else{res.write(chunk({role:'assistant',content:'完成'},null));res.write(chunk({},'stop'))}res.end('data: [DONE]\n\n')})});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const events=[],approvals=[];const session=new ChatSession(e=>events.push(e),null,async(...args)=>{approvals.push(args);return true});t.after(()=>session.close());await session.open({baseUrl:`http://127.0.0.1:${server.address().port}/v1`,modelId:'mock',apiKey:''},root,root,undefined,undefined,undefined,[{root,label:'main'}]);await session.prompt('整理资料');assert.equal(await readFile(path.join(root,'result.md'),'utf8'),'整理完成');assert.match(JSON.stringify(lastBody.messages),/中文资料/);assert.equal(approvals.length,1);assert.ok(events.some(e=>e.type==='tool'&&e.name==='project_read'&&e.status==='completed'));assert.ok(events.some(e=>e.type==='tool'&&e.name==='project_write'&&e.status==='completed'));assert.ok(events.some(e=>e.type==='completed'));
});

test('project read extracts Chinese spreadsheet cells and slide text with bounded output',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'piwork-office-tools-'));t.after(()=>rm(root,{recursive:true,force:true}));for(const ext of ['docx','xlsx','pptx'])await copyFile(new URL(`./fixtures/office-basic.${ext}`,import.meta.url),path.join(root,`office.${ext}`));const tool=createProjectTools([{root,label:'main'}],async()=>false).find(t=>t.name==='project_read');const read=async name=>(await tool.execute('id',{path:name},undefined,undefined,{})).content[0].text;const doc=await read('office.docx');assert.match(doc,/中文文档预览/);assert.match(doc,/项目/);assert.match(doc,/42/);const sheet=await read('office.xlsx');assert.match(sheet,/中文工作表/);assert.match(sheet,/项目/);assert.match(sheet,/42/);const slides=await read('office.pptx');assert.match(slides,/中文幻灯片/);assert.ok(slides.length<=64020);
});

test('project read extracts Chinese text from a PDF using bundled character maps',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'piwork-cjk-pdf-'));t.after(()=>rm(root,{recursive:true,force:true}));await copyFile(new URL('./fixtures/chinese-text.pdf',import.meta.url),path.join(root,'chinese.pdf'));const tool=createProjectTools([{root,label:'main'}],async()=>false).find(t=>t.name==='project_read');const output=await tool.execute('id',{path:'chinese.pdf'},undefined,undefined,{});assert.match(output.content[0].text,/中文办公测试/);
});

test('project read extracts text from a PDF',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'piwork-pdf-tool-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>','<< /Length 37 >>\nstream\nBT /F1 18 Tf 40 150 Td (Hello) Tj ET\nendstream','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`}const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;await writeFile(path.join(root,'test.pdf'),pdf);const tool=createProjectTools([{root,label:'main'}],async()=>false).find(t=>t.name==='project_read');const value=await tool.execute('id',{path:'test.pdf'},undefined,undefined,{});assert.match(value.content[0].text,/Hello/);
});

test('image input requires explicit capability and reaches a vision-enabled gateway',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'piwork-image-tools-'));t.after(()=>rm(root,{recursive:true,force:true}));const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');await writeFile(path.join(root,'image.png'),png);const disabled=createProjectTools([{root,label:'main'}],async()=>false).find(tool=>tool.name==='project_read');await assert.rejects(disabled.execute('id',{path:'image.png'},undefined,undefined,{}),/disabled/);
 let calls=0,body='';const server=createServer((req,res)=>{let data='';req.on('data',chunk=>data+=chunk);req.on('end',()=>{body=data;calls++;res.writeHead(200,{'content-type':'text/event-stream'});const chunk=(delta,finish)=>`data: ${JSON.stringify({id:'vision',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;if(calls===1){res.write(chunk({role:'assistant',tool_calls:[{index:0,id:'image_call',type:'function',function:{name:'project_read',arguments:JSON.stringify({path:'image.png'})}}]},null));res.write(chunk({},'tool_calls'))}else{res.write(chunk({role:'assistant',content:'image received'},null));res.write(chunk({},'stop'))}res.end('data: [DONE]\n\n')})});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const events=[];const session=new ChatSession(event=>events.push(event));t.after(()=>session.close());await session.open({baseUrl:`http://127.0.0.1:${server.address().port}/v1`,modelId:'mock',apiKey:'',supportsImages:true},root,root,undefined,undefined,undefined,[{root,label:'main'}]);await session.prompt('inspect image');assert.match(body,/image_url/);assert.match(body,/data:image\/png;base64/);assert.ok(events.some(event=>event.type==='completed'));
});

test('creates Word, spreadsheet and presentation files only after approval without overwriting',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'piwork-office-create-'));t.after(()=>rm(root,{recursive:true,force:true}));let allowed=true;const calls=[];const tools=createProjectTools([{root,label:'main'}],async(_id,name,input)=>{calls.push({name,input});return allowed});const create=tools.find(tool=>tool.name==='project_create_office'),read=tools.find(tool=>tool.name==='project_read');const invoke=(tool,args)=>tool.execute('id',args,undefined,undefined,{});
 const input={title:'工作报告',paragraphs:['中文正文'],rows:[['项目','数量'],['资料','42']],slides:[{title:'中文幻灯片',body:'办公内容'}]};
 for(const ext of ['docx','xlsx','pptx']){await invoke(create,{...input,path:`result.${ext}`});const extracted=(await invoke(read,{path:`result.${ext}`})).content[0].text;assert.match(extracted,ext==='pptx'?/中文幻灯片/:/项目/);assert.match(extracted,/42/)}
 const before=await readFile(path.join(root,'result.docx'));await assert.rejects(invoke(create,{...input,path:'result.docx'}),/already exists/);assert.deepEqual(await readFile(path.join(root,'result.docx')),before);allowed=false;await assert.rejects(invoke(create,{...input,path:'denied.docx'}),/not approved/);await assert.rejects(readFile(path.join(root,'denied.docx')),/ENOENT/);await assert.rejects(invoke(create,{...input,path:'../escape.docx'}));assert.equal(calls.length,4);
});
