import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ChatSession} from '../apps/desktop/electron/chat-session.ts';

test('Pi session streams text from an OpenAI compatible gateway',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'piwork-chat-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let body='';const server=createServer((req,res)=>{body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta:{role:'assistant',content:'你好'},finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta:{content:'世界'},finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n');res.end('data: [DONE]\n\n')})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const events=[];const session=new ChatSession(event=>events.push(event));t.after(()=>session.dispose());
 const gateway={baseUrl:`http://127.0.0.1:${server.address().port}/v1`,modelId:'mock',apiKey:'local'};const sessionFile=path.join(directory,'history.jsonl');
 await session.open(gateway,directory,directory,sessionFile);
 await session.prompt('你好');
 session.dispose();const reopened=new ChatSession(event=>events.push(event));t.after(()=>reopened.dispose());await reopened.open(gateway,directory,directory,sessionFile);await reopened.prompt('再说一次');
 const request=JSON.parse(body);
 assert.equal(request.tools?.length??0,0);
 const system=request.messages.find(message=>message.role==='system')?.content;
 assert.match(system,/No local project is selected/);
 assert.match(system,/attach the files/);
 assert.doesNotMatch(system,/Help users inspect files, run commands/);
 assert.match(body,/再说一次/);assert.match(body,/你好世界/);
 assert.match(body,/你好/);assert.equal(events.filter(e=>e.type==='delta').map(e=>e.text).join(''),'你好世界你好世界');assert.ok(events.some(e=>e.type==='completed'&&e.text==='你好世界'));
});

test('explicit skill instructions are expanded by Pi with a scoped resource reader',async t=>{
 const {writeFile}=await import('node:fs/promises');const directory=await mkdtemp(path.join(os.tmpdir(),'piwork-skill-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const skillFile=path.join(directory,'SKILL.md');await writeFile(skillFile,'---\nname: test-skill\ndescription: A test skill\n---\nAlways respond in concise French.\n');
 let body='';const server=createServer((req,res)=>{req.on('data',chunk=>body+=chunk);req.on('end',()=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write(`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta:{role:'assistant',content:'Bonjour'},finish_reason:null}]})}\n\n`);res.write(`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\n`);res.end('data: [DONE]\n\n')})});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const events=[];const session=new ChatSession(event=>events.push(event));t.after(()=>session.close());await session.open({baseUrl:`http://127.0.0.1:${server.address().port}/v1`,modelId:'mock',apiKey:'local'},directory,directory,undefined,skillFile);await session.prompt('Say hello','test-skill');assert.match(body,/Always respond in concise French/);assert.ok(events.some(event=>event.type==='completed'));const request=JSON.parse(body);assert.deepEqual(request.tools.map(tool=>tool.function.name).sort(),['skill_bash','skill_read']);
});

test('MCP tool calls pass through the approval hook',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'piwork-mcp-'));const oldAgentDir=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=directory;t.after(()=>{if(oldAgentDir===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=oldAgentDir});t.after(()=>rm(directory,{recursive:true,force:true}));
 let calls=0;let firstRequest;let lastRequest;const server=createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{const request=JSON.parse(body);lastRequest=request;calls++;if(calls===1)firstRequest=request;res.writeHead(200,{'content-type':'text/event-stream'});const delta=calls===1?{role:'assistant',tool_calls:[{index:0,id:'call_test',type:'function',function:{name:'mcp__fixture__echo',arguments:'{"text":"hello"}'}}]}:{role:'assistant',content:'done'};for(const [d,finish] of [[delta,null],[{},calls===1?'tool_calls':'stop']])res.write(`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta:d,finish_reason:finish}]})}\n\n`);res.end('data: [DONE]\n\n')})});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const approvals=[];const events=[];const session=new ChatSession(event=>events.push(event),null,async(id,name,input)=>{approvals.push({id,name,input});return true});t.after(()=>session.close());await session.open({baseUrl:`http://127.0.0.1:${server.address().port}/v1`,modelId:'mock',apiKey:'local'},directory,directory,undefined,undefined,{id:'1',name:'fixture',type:'stdio',command:process.execPath,args:[path.resolve('tests/fixtures/mcp-test-server.mjs')],enabled:true});await session.prompt('echo hello');assert.ok(firstRequest.tools.some(tool=>tool.function.name==='mcp__fixture__echo'));assert.equal(approvals.length,1);assert.equal(approvals[0].name,'mcp__fixture__echo');assert.deepEqual(approvals[0].input,{text:'hello'});assert.ok(events.some(event=>event.type==='completed'));assert.match(JSON.stringify(lastRequest.messages),/echo: hello/);await session.close();calls=0;const denied=new ChatSession(()=>{},null,async()=>false);t.after(()=>denied.close());await denied.open({baseUrl:`http://127.0.0.1:${server.address().port}/v1`,modelId:'mock',apiKey:'local'},directory,directory,undefined,undefined,{id:'1',name:'fixture',type:'stdio',command:process.execPath,args:[path.resolve('tests/fixtures/mcp-test-server.mjs')],enabled:true});await denied.prompt('echo hello');assert.match(JSON.stringify(lastRequest.messages),/Tool call not approved/);assert.doesNotMatch(JSON.stringify(lastRequest.messages),/echo: hello/);const {access}=await import('node:fs/promises');await assert.rejects(access(path.join(directory,'mcp.log')));
});
