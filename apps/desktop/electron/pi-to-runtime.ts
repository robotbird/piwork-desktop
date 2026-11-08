import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { RuntimeEvent } from '../src/web/lib/runtime/protocol/events';

/**
 * Pi 会话事件 → RuntimeEvent 的桌面版归一化(对齐 web PiEventNormalizer 的
 * 语义:assistant 消息序号从 1 起、text/reasoning/tool 三通道相位事件、
 * at 时间戳在归一化时刻打点)。流式翻译成 UIMessageChunk 由复制的 web
 * stream-mapping 完成,双发 legacy ChatEvent 保持现行渲染层不变。
 */
export class PiToRuntimeMapper {
 private sequence=0;
 private readonly runId:string;
 constructor(runId:string){this.runId=runId}
 start():RuntimeEvent[]{return [{type:'run.started',runId:this.runId}]}
 push(event:AgentSessionEvent):RuntimeEvent[]{
  const out:RuntimeEvent[]=[];
  if(event.type==='message_start'&&event.message.role==='assistant'){
   this.sequence+=1;out.push({type:'message.started',sequence:this.sequence});
  }else if(event.type==='message_update'){
   const inner=event.assistantMessageEvent;const now=Date.now();
   if(inner.type==='start'){this.sequence+=1;out.push({type:'message.started',sequence:this.sequence})}
   else if(inner.type==='text_start')out.push(this.delta('text','start',inner.contentIndex,undefined,now));
   else if(inner.type==='text_delta')out.push(this.delta('text','delta',inner.contentIndex,inner.delta));
   else if(inner.type==='text_end')out.push(this.delta('text','end',inner.contentIndex,undefined,now));
   else if(inner.type==='thinking_start')out.push(this.delta('reasoning','start',inner.contentIndex,undefined,now));
   else if(inner.type==='thinking_delta')out.push(this.delta('reasoning','delta',inner.contentIndex,inner.delta));
   else if(inner.type==='thinking_end')out.push(this.delta('reasoning','end',inner.contentIndex,undefined,now));
   else if(inner.type==='toolcall_start')out.push(this.delta('tool','start',inner.contentIndex,undefined,now));
   else if(inner.type==='toolcall_delta')out.push(this.delta('tool','delta',inner.contentIndex,inner.delta));
   else if(inner.type==='toolcall_end')out.push(this.delta('tool','end',inner.contentIndex,undefined,now));
  }else if(event.type==='message_end'&&event.message.role==='assistant'){
   out.push({type:'message.completed',sequence:Math.max(this.sequence,1)});
  }else if(event.type==='tool_execution_start'){
   out.push({type:'tool.started',toolCallId:event.toolCallId,toolName:event.toolName,args:event.args});
  }else if(event.type==='tool_execution_end'){
   out.push({type:'tool.completed',toolCallId:event.toolCallId,toolName:event.toolName,isError:event.isError===true});
  }
  return out;
 }
 settle(reason?:'completed'|'aborted'):RuntimeEvent[]{return [{type:'run.settled',runId:this.runId,...(reason?{reason}:{})}]}
 fail(error:string):RuntimeEvent[]{return [{type:'run.failed',runId:this.runId,error}]}
 private delta(channel:'text'|'reasoning'|'tool',phase:'start'|'delta'|'end',contentIndex:number,delta?:string,at?:number):RuntimeEvent{
  return {type:'message.delta',sequence:Math.max(this.sequence,1),contentIndex,channel,phase,...(delta!==undefined?{delta}:{}),...(at!==undefined?{at}:{})};
 }
}
