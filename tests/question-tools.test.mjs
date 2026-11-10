import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {ChatSession} from '../apps/desktop/electron/chat-session.ts';
import {createQuestionTools,validateQuestionResponse} from '../apps/desktop/electron/question-tools.ts';

const questions=[{id:'server',question:'Which server?',options:[{label:'Demo server'},{label:'Another server'}]},{id:'location',question:'Where?'}];
test('question replies preserve custom answers, skips and cancellations without accepting unknown keys',()=>{
 assert.deepEqual(validateQuestionResponse(questions,{answers:{server:' Demo server ',location:null,unexpected:'ignored'}}),{answers:{server:'Demo server',location:null}});
 assert.deepEqual(validateQuestionResponse(questions,{answers:{},cancelled:true}),{answers:{server:null,location:null},cancelled:true});
 for(const value of [null,{}, {answers:[]},{answers:{server:42}},{answers:{server:'a'.repeat(10001)}},{answers:{},cancelled:'yes'}])assert.throws(()=>validateQuestionResponse(questions,value));
});
test('question tool waits for the user, propagates cancellation and rejects ambiguous question ids',async()=>{
 let finish;const tool=createQuestionTools(async()=>new Promise(resolve=>finish=resolve))[0];
 let settled=false;const pending=tool.execute('call',{questions},undefined,undefined,{}).then(value=>{settled=true;return value});
 await Promise.resolve();assert.equal(settled,false);
 finish({answers:{server:'Another server',location:null}});
 assert.deepEqual(JSON.parse((await pending).content[0].text),{answers:{server:'Another server',location:null}});
 const cancel=createQuestionTools(async()=>({answers:{},cancelled:true}))[0];
 assert.equal(JSON.parse((await cancel.execute('call',{questions},undefined,undefined,{})).content[0].text).cancelled,true);
 await assert.rejects(cancel.execute('call',{questions:[questions[0],questions[0]]},undefined,undefined,{}),/unique/);
 await assert.rejects(cancel.execute('call',{questions:[{id:'q',question:'Pick',options:[{label:'Same'},{label:'Same'}]}]},undefined,undefined,{}),/unique/);
 const signal=AbortSignal.abort();await assert.rejects(cancel.execute('call',{questions},signal,undefined,{}),/cancelled/);
});
test('foreground Agent resumes from structured user answers and background sessions omit ask_user',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'piwork-questions-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const bodies=[];let release;let entered;const asked=new Promise(resolve=>entered=resolve);
 const gateway=createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
  const data=JSON.parse(body);bodies.push(data);
  const result=data.messages.findLast(message=>message.role==='tool');
  const chunk=(delta,finish_reason=null)=>`data: ${JSON.stringify({id:'mock',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta,finish_reason}]})}\n\n`;
  res.writeHead(200,{'content-type':'text/event-stream'});
  if(result||!data.tools?.some(tool=>tool.function.name==='ask_user'))res.write(chunk({role:'assistant',content:'Answer received'},'stop'));
  else{res.write(chunk({role:'assistant',tool_calls:[{index:0,id:'question-call',type:'function',function:{name:'ask_user',arguments:JSON.stringify({questions})}}]}));res.write(chunk({},'tool_calls'))}
  res.end('data: [DONE]\n\n');
 })});
 await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));t.after(()=>{gateway.closeAllConnections();gateway.close()});
 const config={baseUrl:`http://127.0.0.1:${gateway.address().port}/v1`,modelId:'mock',apiKey:''};
 const events=[];const chat=new ChatSession(event=>events.push(event));t.after(()=>chat.close());
 await chat.open(config,root,root,undefined,undefined,undefined,undefined,undefined,async(id,input)=>{assert.equal(id,'question-call');assert.deepEqual(input,questions);entered();return new Promise(resolve=>release=resolve)});
 const prompt=chat.prompt('Ask me to pick a server');await asked;
 assert.equal(bodies.length,1);assert.equal(events.some(event=>event.type==='completed'),false);
 release({answers:{server:'Another server',location:'Test region'}});await prompt;
 assert.equal(events.at(-1).type,'completed');
 assert.deepEqual(JSON.parse(bodies.at(-1).messages.findLast(message=>message.role==='tool').content),{answers:{server:'Another server',location:'Test region'}});
 await chat.close();await chat.open(config,root,root);await chat.prompt('Background task');
 assert.ok(!bodies.at(-1).tools?.some(tool=>tool.function.name==='ask_user'));
});
