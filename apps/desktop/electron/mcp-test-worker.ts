import {McpClient,StdioTransport,StreamableHttpTransport} from '@earendil-works/pi-mcp';
import {validateMcp,type McpInput} from './mcp-config';
const port=process.parentPort;if(!port)throw new Error('Missing parent port');
port.on('message',async event=>{
 const client=new McpClient({name:'piwork-desktop',version:'0.1.0',requestTimeoutMs:10000});
 let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;void client.close()},10000);let result:{ok:true;tools:{name:string;description:string}[]}|{ok:false;reason:'unavailable'|'timeout'}={ok:false,reason:'unavailable'};
 try{const config=validateMcp(event.data as McpInput);const transport=config.type==='stdio'?new StdioTransport({command:config.command!,args:config.args,env:config.env,stderr:'pipe',closeTimeoutMs:1000}):new StreamableHttpTransport({url:config.url!,headers:config.headers,openGetStream:false});await client.connect(transport);const tools=await client.listTools({timeoutMs:10000});result={ok:true,tools:tools.slice(0,200).map(tool=>({name:tool.name.slice(0,200),description:(tool.description??'').slice(0,500)}))}}catch{if(timedOut)result={ok:false,reason:'timeout'}}finally{clearTimeout(timeout);await client.close().catch(()=>{});port!.postMessage(result);process.exit(0)}
});
