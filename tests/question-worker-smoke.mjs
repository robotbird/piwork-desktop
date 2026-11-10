import {app,utilityProcess} from 'electron';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

app.whenReady().then(async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'piwork-question-worker-'));
 const bodies=[];let mode='answer';let requestCount=0;const responses=[];
 const server=createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
  const data=JSON.parse(body);bodies.push(data);
  const user=data.messages.findLastIndex(message=>message.role==='user');
  const tool=data.messages.slice(user+1).find(message=>message.role==='tool');
  const chunk=(delta,finish_reason=null)=>`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta,finish_reason}]})}\n\n`;
  res.writeHead(200,{'content-type':'text/event-stream'});
  if(tool){responses.push(JSON.parse(tool.content));res.write(chunk({role:'assistant',content:'User response received'},'stop'))}
  else{res.write(chunk({role:'assistant',tool_calls:[{index:0,id:`ask_${++requestCount}`,type:'function',function:{name:'ask_user',arguments:JSON.stringify({questions:[{id:'choice',question:'Which environment?',options:[{label:'Demo'},{label:'Production'}]}]})}}]}));res.write(chunk({},'tool_calls'))}
  res.end('data: [DONE]\n\n');
 })});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const child=utilityProcess.fork(path.resolve('apps/desktop/dist-electron/chat-worker.js'),[],{stdio:'pipe'});
 child.stderr?.on('data',data=>process.stderr.write(data));
 let finish;let fail;
 child.on('message',event=>{
  if(event.type==='question'){
   assert.equal(event.questions[0].id,'choice');
   if(mode==='abort')child.postMessage({type:'abort'});
   else child.postMessage({type:'question:response',id:event.id,response:mode==='cancel'?{answers:{},cancelled:true}:{answers:{choice:'Demo'}}});
  }else if(event.type==='completed'||event.type==='aborted')finish?.(event.type);
  else if(event.type==='failed')fail?.(new Error(event.message));
 });
 const turn=command=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Question worker timeout')),20000);finish=value=>{clearTimeout(timer);resolve(value)};fail=error=>{clearTimeout(timer);reject(error)};child.postMessage(command)});
 try{
  assert.equal(await turn({type:'start',gateway:{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,modelId:'mock',apiKey:'local'},cwd:directory,agentDir:directory,text:'answer test',allowUserQuestions:true}),'completed');
  assert.deepEqual(responses.at(-1),{answers:{choice:'Demo'}});
  mode='cancel';assert.equal(await turn({type:'prompt',text:'cancel test'}),'completed');assert.equal(responses.at(-1).cancelled,true);
  mode='abort';assert.equal(await turn({type:'prompt',text:'stop test'}),'aborted');
  mode='answer';assert.equal(await turn({type:'prompt',text:'continue after stop'}),'completed');assert.deepEqual(responses.at(-1),{answers:{choice:'Demo'}});
  assert.ok(bodies[0].tools.some(tool=>tool.function.name==='ask_user'));
  console.log('Electron question worker: answer, dismiss, abort and continue passed');
 }catch(error){console.error(error);process.exitCode=1}
 finally{child.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});app.exit(process.exitCode??0)}
}).catch(error=>{console.error(error);app.exit(1)});
