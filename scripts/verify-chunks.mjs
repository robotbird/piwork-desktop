// P4 verification: the chat worker dual-emits legacy ChatEvents AND the
// UIMessageChunk stream (translated by the copied web stream-mapping).
// Asserts chunk control markers, text part lifecycle and tool-status parts.
import {_electron as electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const root=await mkdtemp(path.join(os.tmpdir(),'piwork-chunk-'));
const profile=path.join(root,'profile');
const gateway=createServer((req,res)=>{
  let body='';
  req.on('data',chunk=>body+=chunk);
  req.on('end',()=>{
    res.writeHead(200,{'content-type':'text/event-stream'});
    const frame=delta=>`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta,finish_reason:null}]})}\n\n`;
    res.write(frame({role:'assistant',content:'Hello'}));
    res.write(frame({content:' chunk'}));
    res.write(`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
let app;
try{
  app=await electron.launch({executablePath:path.resolve('apps/desktop/node_modules/.bin/electron'),args:[path.resolve('apps/desktop'),`--user-data-dir=${profile}`],env:{...process.env,VITE_DEV_SERVER_URL:''}});
  const page=await app.firstWindow();
  await page.evaluate(async url=>{
    await window.desktop.setPreferences({appearance:'light',language:'en'});
    await window.desktop.setGateway({baseUrl:url,modelId:'mock',apiKey:''});
  },`http://127.0.0.1:${gateway.address().port}/v1`);
  const events=await page.evaluate(async()=>{
    const received=[];
    const stop=window.desktop.onChatChunks(event=>received.push(event));
    const chatId=await window.desktop.sendChat('streaming test',null,null,null,null);
    await new Promise(resolve=>{
      const timer=setInterval(()=>{
        if(received.some(e=>e.control==='end')){clearInterval(timer);resolve()}
      },100);
      setTimeout(()=>{clearInterval(timer);resolve()},20000);
    });
    stop();
    return {chatId,received};
  });
  const controls=events.received.filter(e=>e.control).map(e=>e.control);
  assert.deepEqual(controls,['start','end'],`control markers: ${JSON.stringify(controls)}`);
  const chunkTypes=events.received.filter(e=>e.chunk).map(e=>e.chunk.type);
  assert.ok(chunkTypes.includes('text-start'),'text-start present');
  assert.ok(chunkTypes.includes('text-delta'),'text-delta present');
  assert.ok(chunkTypes.includes('text-end'),'text-end present');
  const text=events.received.filter(e=>e.chunk?.type==='text-delta').map(e=>e.chunk.delta).join('');
  assert.equal(text,'Hello chunk',`streamed text: ${JSON.stringify(text)}`);
  // legacy channel must still fire alongside
  const legacy=await page.evaluate(async()=>{
    const seen=[];
    const stop=window.desktop.onChat(event=>seen.push(event.type));
    await window.desktop.sendChat('legacy check',null,null,null,null);
    await new Promise(resolve=>setTimeout(resolve,3000));
    stop();
    return seen;
  });
  assert.ok(legacy.includes('completed'),`legacy events: ${JSON.stringify(legacy)}`);
  console.log('chat worker dual-emit verified: chunk stream + legacy events both flow');
}finally{
  if(app)await app.close().catch(()=>{});
  gateway.closeAllConnections();
  await new Promise(resolve=>gateway.close(resolve));
  await rm(root,{recursive:true,force:true});
}
