import type {AssistantSegment,ChatMessage,ToolEvent} from '../shared/types.ts';
import type {AgentSession} from '@earendil-works/pi-coding-agent';
import {splitChatAttachment} from './chat-attachment.ts';
export function toolFailureReason(message:string):NonNullable<ToolEvent['reason']>{return /not approved|cancelled/i.test(message)?'denied':/aborted/i.test(message)?'interrupted':/changed|already exists/i.test(message)?'changed':/invalid|unsupported|symbolic/i.test(message)?'invalid':'error'}
/** pi AgentToolResult(或其 content)中的文本部分拼接;图片等非文本块跳过。 */
export function toolResultText(result:unknown):string{
 if(!result||typeof result!=='object')return '';
 const content=(result as {content?:unknown}).content;
 if(!Array.isArray(content))return typeof content==='string'?content:'';
 return content.map(part=>part&&typeof part==='object'&&typeof part.text==='string'?part.text:'').join(' ');
}
/* 展示副本截断上限(参考 pi 的预览思路,同时防 IPC/渲染层膨胀):参数单值 500 字符、
   层数 4、条目 50;输出 12000 字符(头 8000 + 尾 4000) */
const ARG_STRING_MAX=500;
const ARG_ENTRY_MAX=50;
const ARG_DEPTH_MAX=4;
const RESULT_CHAR_MAX=12000;
const RESULT_HEAD=8000;
const RESULT_TAIL=4000;
export function capToolText(text:string):string{
 if(text.length<=RESULT_CHAR_MAX)return text;
 const omitted=text.length-RESULT_HEAD-RESULT_TAIL;
 return `${text.slice(0,RESULT_HEAD)}\n…(${omitted} chars omitted)…\n${text.slice(-RESULT_TAIL)}`;
}
function sanitizeValue(value:unknown,depth:number):unknown{
 if(typeof value==='string'){
  if(value.startsWith('data:'))return `(${value.length}-byte data uri)`;
  return value.length<=ARG_STRING_MAX?value:`${value.slice(0,ARG_STRING_MAX)}…(${value.length-ARG_STRING_MAX} chars)`;
 }
 if(depth>=ARG_DEPTH_MAX||value===null||typeof value!=='object')return value;
 if(Array.isArray(value)){const head=value.slice(0,ARG_ENTRY_MAX).map(item=>sanitizeValue(item,depth+1));return value.length>ARG_ENTRY_MAX?[...head,`(${value.length-ARG_ENTRY_MAX} more)`]:head}
 const entries=Object.entries(value as Record<string,unknown>).slice(0,ARG_ENTRY_MAX).map(([key,item])=>[key,sanitizeValue(item,depth+1)]);
 return Object.fromEntries(entries);
}
/** 工具入参的展示副本:长字符串截断、data: URI 折叠、层数与条目数封顶;非对象返回 undefined。 */
export function sanitizeArgs(args:unknown):Record<string,unknown>|undefined{
 if(!args||typeof args!=='object'||Array.isArray(args))return undefined;
 return sanitizeValue(args,0) as Record<string,unknown>;
}
/** Rebuild the interleaved transcript (text segments + tool groups) plus truncated display
    copies of args/result from Pi's persisted context, preserving assistant message order:
    each assistant message contributes its text parts then its toolCalls; toolResult messages
    back-fill status/result into the matching ToolEvent by toolCallId. */
type SessionMessage=AgentSession['messages'][number];

/** Keep tool results with the assistant turn that initiated them. */
export function projectChatHistory(messages:readonly SessionMessage[],timings:ReadonlyMap<number,{startedAt:number;durationMs:number}>=new Map()):ChatMessage[]{
 const history:ChatMessage[]=[];
 let turn:SessionMessage[]=[];
 let timing:{startedAt:number;durationMs:number}|undefined;
 function appendText(segments:AssistantSegment[],text:string){
  if(!text)return;
  const last=segments.at(-1);
  if(last&&last.kind==='text')segments[segments.length-1]={kind:'text',text:last.text?`${last.text}\n\n${text}`:text};
  else segments.push({kind:'text',text});
 }
 function upsertTool(segments:AssistantSegment[],event:ToolEvent){
  const last=segments.at(-1);
  if(last&&last.kind==='tools'){
   const index=last.tools.findIndex(tool=>tool.id===event.id);
   if(index===-1)last.tools.push(event);
   else last.tools[index]={...last.tools[index],...event};
   return;
  }
  segments.push({kind:'tools',tools:[event]});
 }
 function patchTool(segments:AssistantSegment[],id:string,patch:(tool:ToolEvent)=>ToolEvent){
  for(const segment of segments)if(segment.kind==='tools')for(let index=0;index<segment.tools.length;index++)
   if(segment.tools[index].id===id)segment.tools[index]=patch(segment.tools[index]);
 }
 function flushTurn(){
  const segments:AssistantSegment[]=[];
  for(const message of turn){
   if(message.role==='assistant'){
    for(const part of message.content){
     if(part.type==='text')appendText(segments,part.text);
     else if(part.type==='toolCall')upsertTool(segments,{type:'tool',id:part.id,name:part.name,status:'failed',reason:'interrupted',args:sanitizeArgs(part.arguments),...((part.name.startsWith('project_')||part.name==='skill_read')&&typeof part.arguments?.path==='string'?{path:part.arguments.path as string}:{})});
    }
   }else if(message.role==='toolResult'){
    const text=capToolText(toolResultText(message));
    patchTool(segments,message.toolCallId,tool=>({...tool,status:message.isError?'failed':'completed',reason:message.isError?toolFailureReason(text):undefined,...(text?{result:text}:{})}));
   }
  }
  const text=segments.filter(segment=>segment.kind==='text').map(segment=>segment.text).join('\n\n');
  const toolEvents=segments.flatMap(segment=>segment.kind==='tools'?segment.tools:[]);
  if(text||toolEvents.length)history.push({role:'assistant',text,...timing,...(toolEvents.length?{toolEvents,segments}:{})});
  turn=[];
 }
 for(const message of messages){
  if(message.role==='user'){
   flushTurn();
   timing=timings.get(message.timestamp);
   const raw=typeof message.content==='string'?message.content:message.content.filter(part=>part.type==='text').map(part=>part.text).join('');
   /* pi 把 /skill:NAME 展开成 <skill name="...">...</skill>\n\n 前缀块:提取技能名驱动气泡标识;
      兼容未展开、直接存 /skill:NAME 前缀的旧格式 */
   let text=raw;let skillName:string|undefined;
   const expanded=/^<skill\s[^>]*\bname="([^"]*)"/.exec(raw);
   if(expanded){skillName=expanded[1];text=text.replace(/^<skill\s[\s\S]*?<\/skill>\n\n/,'')}
   else{const bare=/^\/skill:([^\s]+)\s+/.exec(raw);if(bare){skillName=bare[1];text=text.slice(bare[0].length)}}
   if(skillName)text=text.replace(/^\n+/,'');
   if(text)history.push({role:'user',...splitChatAttachment(text),...(skillName?{skillName}:{})});
  }else if(message.role==='assistant'||message.role==='toolResult'){
   turn.push(message);
  }
 }
 flushTurn();
 return history;
}
