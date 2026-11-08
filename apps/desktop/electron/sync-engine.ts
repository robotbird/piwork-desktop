import type {SyncAccount,SyncJournal,SyncTextMessage} from './sync-journal.ts';
export type SyncRemoteChat={id:string;title:string;messages:SyncTextMessage[];activeBy?:'web'|'desktop'|null};
export interface SyncTransport {
 push(chatId:string,payload:{title:string;expected:SyncTextMessage[];messages:SyncTextMessage[];leaseToken?:string}):Promise<{ids:string[]}>;
 pull(chatId:string):Promise<SyncRemoteChat>;
 acquire(chatId:string,expected:SyncTextMessage[]):Promise<string>;
 release(chatId:string,token:string):Promise<void>;
}
const equal=(a:readonly SyncTextMessage[],b:readonly SyncTextMessage[])=>a.length===b.length&&a.every((item,index)=>item.id===b[index]?.id&&item.role===b[index]?.role&&item.text===b[index]?.text);
function validMessage(value:unknown):value is SyncTextMessage {if(!value||typeof value!=='object')return false;const v=value as Record<string,unknown>;return typeof v.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.id)&&(v.role==='user'||v.role==='assistant')&&typeof v.text==='string'&&v.text.length<=100000}
/** One attempt never replays a task: it sends text records or appends remote text only. */
export async function syncOneChat(input:{journal:SyncJournal;account:SyncAccount;chatId:string;transport:SyncTransport;isBusy:()=>boolean;appendRemote:(messages:SyncTextMessage[])=>Promise<void>}):Promise<'idle'|'synced'> {
 let record=(await input.journal.list(input.account)).find(item=>item.chatId===input.chatId);if(!record)throw new Error('Sync chat unavailable');if(record.running||input.isBusy())return 'idle';
 if(!record.expected.length&&!record.pending.length){const created=await input.transport.push(record.chatId,{title:record.title,expected:[],messages:[]});if(!Array.isArray(created.ids)||created.ids.length)throw new Error('Invalid sync acknowledgement')}
 if(record.pending.length){
  try {
   const result=await input.transport.push(record.chatId,{title:record.title,expected:record.expected,messages:record.pending,...(record.leaseToken?{leaseToken:record.leaseToken}:{})});
   const expectedIds=[...record.expected,...record.pending].map(item=>item.id);if(!Array.isArray(result.ids)||result.ids.length!==expectedIds.length||result.ids.some((id,index)=>id!==expectedIds[index]))throw new Error('Invalid sync acknowledgement');
  }catch(error){
   if(!(error instanceof Error)||error.message!=='Sync conflict')throw error;
   const remote=await input.transport.pull(record.chatId);if(remote.id!==record.chatId||!Array.isArray(remote.messages)||remote.messages.some(item=>!validMessage(item)))throw new Error('Invalid sync history');
   if(remote.activeBy)return 'idle';
   const committed=[...record.expected,...record.pending];if(!equal(remote.messages.slice(0,committed.length),committed))throw error;
  }
  await input.journal.acknowledge(record.chatId,input.account,record.expected,record.pending,record.leaseToken);record=(await input.journal.list(input.account)).find(item=>item.chatId===input.chatId);if(!record)throw new Error('Sync chat unavailable');
 }
 if(input.isBusy()||record.running||record.pending.length)return 'idle';
 const remote=await input.transport.pull(record.chatId);if(remote.id!==record.chatId||!Array.isArray(remote.messages)||remote.messages.some(item=>!validMessage(item)))throw new Error('Invalid sync history');if(remote.activeBy)return 'idle';
 const prefix=remote.messages.slice(0,record.expected.length);if(!equal(prefix,record.expected))throw new Error('Sync conflict');const incoming=remote.messages.slice(record.expected.length);if(!incoming.length)return 'synced';
 if(input.isBusy())return 'idle';await input.appendRemote(incoming);await input.journal.acceptRemote(record.chatId,input.account,record.expected,incoming);return 'synced';
}

/** Callers must serialize this with local sends and imports for the same chat. */
export async function prepareSyncRun(input:{journal:SyncJournal;account:SyncAccount;chatId:string;title:string;text:string;transport:SyncTransport;isBusy:()=>boolean;appendRemote:(messages:SyncTextMessage[])=>Promise<void>}):Promise<void>{
 await input.journal.register({chatId:input.chatId,title:input.title,account:input.account});
 const result=await syncOneChat(input);
 if(result==='idle')throw new Error('Sync task running');
 const record=(await input.journal.list(input.account)).find(item=>item.chatId===input.chatId);
 if(!record||record.running||record.pending.length||record.leaseToken||input.isBusy())throw new Error('Sync run unavailable');
 const token=await input.transport.acquire(input.chatId,record.expected);
 try{if(input.isBusy())throw new Error('Sync run unavailable');await input.journal.begin({chatId:input.chatId,title:input.title,account:input.account,text:input.text,leaseToken:token})}catch(error){await input.transport.release(input.chatId,token).catch(()=>{});throw error}
}
