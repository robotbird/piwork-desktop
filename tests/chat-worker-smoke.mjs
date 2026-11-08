import {app,utilityProcess} from 'electron';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

app.whenReady().then(async()=>{
const directory=await mkdtemp(path.join(os.tmpdir(),'piwork-worker-'));
const server=createServer((request,response)=>{request.resume();request.on('end',()=>{response.writeHead(200,{'content-type':'text/event-stream'});response.write(`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta:{role:'assistant',content:'工作进程正常'},finish_reason:null}]})}\n\n`);response.write(`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\n`);response.end('data: [DONE]\n\n')})});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const child=utilityProcess.fork(path.resolve('apps/desktop/dist-electron/chat-worker.js'),[],{stdio:'pipe'});
child.stderr?.on('data',data=>process.stderr.write(data));
try{
 const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('worker timeout')),20000);child.on('exit',code=>{clearTimeout(timer);reject(new Error(`worker exited ${code}`))});child.on('message',event=>{if(event.type==='completed'){clearTimeout(timer);resolve(event.text)}else if(event.type==='failed'){clearTimeout(timer);reject(new Error(event.message))}});child.postMessage({type:'start',gateway:{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,modelId:'mock',apiKey:'local'},cwd:directory,agentDir:directory,text:'你好'})});
 assert.equal(result,'工作进程正常');console.log('Electron utility process Pi gateway smoke test passed');
}catch(error){console.error(error);process.exitCode=1}
finally{child.kill();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});app.exit(process.exitCode??0)}

}).catch(error=>{console.error(error);app.exit(1)});
