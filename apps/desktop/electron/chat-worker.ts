import type {ImageContent} from '@earendil-works/pi-ai';
import {randomUUID} from 'node:crypto';
import {ChatSession} from './chat-session';
import {runtimeEventToUIMessageChunks} from '../src/web/app/(chat)/api/chat/stream-mapping';
import type {McpConfig} from './mcp-config';
import type {GatewayInput} from './gateway';
import type {ScheduleCreateInput} from './schedule-tools';
import type {ScheduleCreateRequest,PermissionMode} from '../shared/types';
import type {ProjectRoot} from './project-files';
const port=process.parentPort;
if(!port)throw new Error('Missing parent port');
let chat:ChatSession|null=null;
/* 权限模式(start 消息初始化,permission 命令实时切换):
   full 一律放行;auto 仅 project_write/project_create_office(落盘写入)仍走弹窗 */
let permission:PermissionMode='confirm';
const writesRequiringApproval=new Set(['project_write','project_create_office']);
const approvals=new Map<string,(allowed:boolean)=>void>();
/* 「始终允许」的稳定 key:skill_bash 匹配命令全文,mcp__* 匹配工具名;写入类不提供始终允许 */
function approvalKey(name:string,input:unknown):string|undefined{
 if(name==='skill_bash'&&input&&typeof input==='object'&&typeof (input as {command?:unknown}).command==='string')return `bash:${(input as {command:string}).command}`;
 if(name.startsWith('mcp__'))return `mcp:${name}`;
 return undefined;
}
function requestApproval(id:string,name:string,input:unknown):Promise<boolean>{if(permission==='full'||permission==='auto'&&!writesRequiringApproval.has(name))return Promise.resolve(true);let detail:string;try{detail=JSON.stringify(input,null,2)}catch{return Promise.resolve(false)}if(!detail||detail.length>12000)return Promise.resolve(false);const key=approvalKey(name,input);return new Promise(resolve=>{const timer=setTimeout(()=>{approvals.delete(id);resolve(false)},120000);approvals.set(id,allowed=>{clearTimeout(timer);resolve(allowed)});port!.postMessage({type:'approval',id,name,detail,...(key?{key}:{})})})}
// create_scheduled_task 工具经 main 进程落库:id 关联的请求/响应,30 秒兜底超时
const scheduleRequests=new Map<string,(error?:string)=>void>();
function requestScheduleCreate(input:ScheduleCreateInput):Promise<void>{return new Promise((resolve,reject)=>{const id=randomUUID();const timer=setTimeout(()=>{scheduleRequests.delete(id);reject(new Error('Schedule create timed out'))},30000);scheduleRequests.set(id,error=>{clearTimeout(timer);if(error)reject(new Error(error));else resolve()});const message:ScheduleCreateRequest={type:'schedule:create',id,input};port!.postMessage(message)})}
let starting=false;let cancelRequested=false;
port.on('message',async event=>{
 const command=event.data as {type:'start';gateway:GatewayInput;cwd:string;agentDir:string;text:string;images?:ImageContent[];sessionFile?:string;projectFolders?:ProjectRoot[];skill?:{name:string;filePath:string};mcp?:McpConfig;allowScheduleTools?:boolean;permission?:PermissionMode}|{type:'permission';mode:PermissionMode}|{type:'approval';id:string;allowed:boolean}|{type:'prompt';text:string;images?:ImageContent[];skillName?:string}|{type:'abort'}|{type:'dispose'}|{type:'schedule:result';id:string;ok:boolean;error?:string};
 try{
  if(command.type==='start'){await chat?.close();starting=true;cancelRequested=false;permission=command.permission??'confirm';chat=new ChatSession(message=>port.postMessage(message),runtimeEvent=>{
   if(runtimeEvent.type==='run.started')port.postMessage({type:'chunk',control:'start',runId:runtimeEvent.runId});
   for(const chunk of runtimeEventToUIMessageChunks(runtimeEvent))port.postMessage({type:'chunk',chunk});
   if(runtimeEvent.type==='run.settled')port.postMessage({type:'chunk',control:'end',reason:runtimeEvent.reason});
   else if(runtimeEvent.type==='run.failed')port.postMessage({type:'chunk',control:'error',error:runtimeEvent.error});
  },requestApproval);await chat.open(command.gateway,command.cwd,command.agentDir,command.sessionFile,command.skill?.filePath,command.mcp,command.projectFolders,command.allowScheduleTools?{requestCreate:requestScheduleCreate}:undefined);starting=false;if(cancelRequested){port.postMessage({type:'aborted'});return}void chat.prompt(command.text,command.skill?.name,command.images).catch(error=>port.postMessage({type:'failed',message:error instanceof Error&&error.message?error.message:'Model request failed'}))}
  else if(command.type==='prompt'){if(!chat)throw new Error('Session not ready');void chat.prompt(command.text,command.skillName,command.images).catch(error=>port.postMessage({type:'failed',message:error instanceof Error&&error.message?error.message:'Model request failed'}))}
  else if(command.type==='permission'){permission=command.mode}
  else if(command.type==='approval'){const resolve=approvals.get(command.id);approvals.delete(command.id);resolve?.(command.allowed===true)}
  else if(command.type==='schedule:result'){const settle=scheduleRequests.get(command.id);scheduleRequests.delete(command.id);settle?.(command.ok?undefined:command.error??'Schedule create failed')}
  else if(command.type==='abort'){for(const resolve of approvals.values())resolve(false);approvals.clear();if(starting)cancelRequested=true;else await chat?.abort()}
  else if(command.type==='dispose'){for(const resolve of approvals.values())resolve(false);approvals.clear();for(const settle of scheduleRequests.values())settle('Session disposed');scheduleRequests.clear();await chat?.close();process.exit(0)}
 }catch(error){starting=false;port.postMessage({type:'failed',message:error instanceof Error&&error.message?error.message:'Model request failed'})}
});
