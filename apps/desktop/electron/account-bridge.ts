import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {randomBytes,randomUUID} from 'node:crypto';
import {session} from 'electron';

export async function startAccountBridge(baseUrl:string,modelId:string,onFailure:(status:number)=>void){
 const token=randomBytes(32).toString('hex');let runId=randomUUID();
 const server=createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/messages'||req.headers.authorization!==`Bearer ${token}`){res.writeHead(403);res.end();return}
  const abort=new AbortController();res.on('close',()=>{if(!res.writableEnded)abort.abort()});
  try{
   const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>32*1024*1024)throw new Error('Request too large');chunks.push(chunk)}
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(body.model!==modelId)throw new Error('Invalid model');body.runId=runId;
   const upstream=await session.fromPartition('persist:piwork-account').fetch(baseUrl+'/api/desktop/inference/messages',{method:'POST',headers:{'content-type':'application/json','x-piwork-desktop':'1'},body:JSON.stringify(body),redirect:'error',signal:abort.signal});
   if(!upstream.ok)onFailure(upstream.status);
   res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'application/json','cache-control':'no-store'});
   if(upstream.body)Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).on('error',()=>res.destroy()).pipe(res);else res.end();
  }catch{onFailure(502);if(!res.headersSent)res.writeHead(502);res.end()}
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve())});
 const address=server.address();if(!address||typeof address==='string'){server.close();throw new Error('Bridge unavailable')}
 return {baseUrl:`http://127.0.0.1:${address.port}`,apiKey:token,newRun(){runId=randomUUID()},close(){server.closeAllConnections();server.close()}};
}
