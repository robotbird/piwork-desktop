import type {ChatMessage,ToolEvent} from '../shared/types.ts';
import type {AgentSession} from '@earendil-works/pi-coding-agent';
import {splitChatAttachment} from './chat-attachment.ts';
export function toolFailureReason(message:string):NonNullable<ToolEvent['reason']>{return /not approved|cancelled/i.test(message)?'denied':/changed|already exists/i.test(message)?'changed':/invalid|unsupported|symbolic/i.test(message)?'invalid':'error'}
/** Rebuild visible tool status from Pi's persisted context without exposing raw tool output. */
export function extractToolActivity(messages:unknown[]):ToolEvent[]{
 const found=new Map<string,ToolEvent>();
 for(const value of messages){if(!value||typeof value!=='object')continue;const message=value as Record<string,unknown>;
  if(message.role==='assistant'&&Array.isArray(message.content))for(const item of message.content){if(!item||typeof item!=='object')continue;const call=item as Record<string,unknown>;if(call.type!=='toolCall'||typeof call.id!=='string'||typeof call.name!=='string')continue;const args=call.arguments as Record<string,unknown>|null;found.set(call.id,{type:'tool',id:call.id,name:call.name,status:'failed',reason:'interrupted',...((call.name.startsWith('project_')||call.name==='skill_read')&&typeof args?.path==='string'?{path:args.path}:{})})}
  else if(message.role==='toolResult'&&typeof message.toolCallId==='string'){const previous=found.get(message.toolCallId);if(!previous)continue;const text=Array.isArray(message.content)?message.content.map(part=>part&&typeof part==='object'&&typeof part.text==='string'?part.text:'').join(' '):'';found.set(message.toolCallId,{...previous,status:message.isError?'failed':'completed',reason:message.isError?toolFailureReason(text):undefined})}
 }
 return [...found.values()];
}

type SessionMessage=AgentSession['messages'][number];

/** Keep tool results with the assistant turn that initiated them. */
export function projectChatHistory(messages:readonly SessionMessage[]):ChatMessage[]{
 const history:ChatMessage[]=[];
 let turn:SessionMessage[]=[];
 function flushTurn(){
  const text=turn.flatMap(message=>message.role==='assistant'
   ?message.content.filter(part=>part.type==='text').map(part=>part.text):[]).filter(Boolean).join('\n\n');
  const toolEvents=extractToolActivity(turn);
  if(text||toolEvents.length)history.push({role:'assistant',text,...(toolEvents.length?{toolEvents}:{})});
  turn=[];
 }
 for(const message of messages){
  if(message.role==='user'){
   flushTurn();
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
