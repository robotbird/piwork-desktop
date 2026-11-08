import {SessionManager,type SessionEntry} from '@earendil-works/pi-coding-agent';
import type {SyncTextMessage} from './sync-journal.ts';

const marker='piwork-synced-message-v1';
function textOf(entry:SessionEntry|undefined):{role:string;text:string}|null{
 if(!entry||entry.type!=='message'||!['user','assistant'].includes(entry.message.role))return null;
 const message=entry.message;if(message.role!=='user'&&message.role!=='assistant')return null;
 const text=typeof message.content==='string'?message.content:message.content.filter(part=>part.type==='text').map(part=>part.text).join('');return {role:message.role,text};
}
/** Append imported text using Pi's session API and an idempotent, crash-recoverable marker. */
export function appendRemoteHistory(filename:string,sessionDir:string,cwd:string,messages:SyncTextMessage[]):void{
 const manager=SessionManager.open(filename,sessionDir,cwd);
 for(const item of messages){
  const branch=manager.getBranch();const index=branch.findIndex(entry=>entry.type==='custom'&&entry.customType===marker&&(entry.data as {id?:unknown}|undefined)?.id===item.id);
  if(index>=0){const entry=branch[index];const saved=entry.type==='custom'?entry.data as Partial<SyncTextMessage>|undefined:undefined;if(!saved||saved.id!==item.id||saved.role!==item.role||saved.text!==item.text)throw new Error('Synced message changed');const next=textOf(branch[index+1]);if(next){if(next.role!==item.role||next.text!==item.text)throw new Error('Synced history diverged');continue}if(index!==branch.length-1)throw new Error('Incomplete sync marker')}
  else manager.appendCustomEntry(marker,item);
  if(item.role==='user')manager.appendMessage({role:'user',content:item.text,timestamp:Date.now()});
  else manager.appendMessage({role:'assistant',api:'openai-completions',provider:'piwork-sync',model:'imported',content:[{type:'text',text:item.text}],stopReason:'stop',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
 }
}
