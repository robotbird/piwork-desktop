import {randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';

export type SyncTextMessage={id:string;role:'user'|'assistant';text:string};
export type SyncAccount={baseUrl:string;userId:string};
export type SyncRecord={chatId:string;title:string;account:SyncAccount;expected:SyncTextMessage[];pending:SyncTextMessage[];running:boolean;leaseToken?:string;lastStatus?:'completed'|'failed'|'aborted'};
type JournalData={version:1;records:SyncRecord[]};
const sameAccount=(a:SyncAccount,b:SyncAccount)=>a.baseUrl===b.baseUrl&&a.userId===b.userId;

/** Records only explicitly supplied display text; never read model prompts or tool data. */
export class SyncJournal {
 private queue:Promise<unknown>=Promise.resolve();
 private readonly filename:string;
 constructor(filename:string){this.filename=filename}
 private async load():Promise<JournalData>{try{const value=JSON.parse(await fs.readFile(this.filename,'utf8'));if(value?.version!==1||!Array.isArray(value.records))throw new Error('Invalid sync journal');return value}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {version:1,records:[]};throw error}}
 private change<T>(fn:(data:JournalData)=>T):Promise<T>{const task=this.queue.then(async()=>{const data=await this.load();const result=fn(data);await fs.mkdir(path.dirname(this.filename),{recursive:true,mode:0o700});const temp=`${this.filename}.${randomUUID()}.tmp`;try{await fs.writeFile(temp,JSON.stringify(data),{mode:0o600,flag:'wx'});await fs.rename(temp,this.filename)}catch(error){await fs.rm(temp,{force:true}).catch(()=>{});throw error}return result});this.queue=task.catch(()=>{});return task}
 async list(account:SyncAccount):Promise<SyncRecord[]>{await this.queue;return (await this.load()).records.filter(record=>sameAccount(record.account,account))}
 async hasChat(chatId:string):Promise<boolean>{await this.queue;return (await this.load()).records.some(record=>record.chatId===chatId)}
 async hasUnresolved():Promise<boolean>{await this.queue;return (await this.load()).records.some(record=>record.running||!!record.leaseToken||record.pending.length>0)}
 register(input:{chatId:string;title:string;account:SyncAccount}):Promise<void>{return this.change(data=>{const existing=data.records.find(item=>item.chatId===input.chatId);if(existing&&!sameAccount(existing.account,input.account))throw new Error('Sync account mismatch');if(!existing)data.records.push({chatId:input.chatId,title:input.title,account:input.account,expected:[],pending:[],running:false})})}
 begin(input:{chatId:string;title:string;account:SyncAccount;text:string;leaseToken:string}):Promise<string>{return this.change(data=>{const record=data.records.find(item=>item.chatId===input.chatId);if(!record||!sameAccount(record.account,input.account))throw new Error('Sync account mismatch');if(record.running||record.leaseToken||record.pending.length)throw new Error('Sync run active');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.leaseToken))throw new Error('Invalid sync lease');record.leaseToken=input.leaseToken;const id=randomUUID();record.pending.push({id,role:'user',text:input.text});record.title=input.title;record.running=true;return id})}
 finish(chatId:string,account:SyncAccount,status:'completed'|'failed'|'aborted',text?:string):Promise<void>{return this.change(data=>{const record=data.records.find(item=>item.chatId===chatId&&sameAccount(item.account,account));if(!record?.running)throw new Error('Sync run not active');if(status==='completed'&&text)record.pending.push({id:randomUUID(),role:'assistant',text});record.running=false;record.lastStatus=status})}
 acknowledge(chatId:string,account:SyncAccount,expected:SyncTextMessage[],sent:SyncTextMessage[],leaseToken?:string):Promise<void>{return this.change(data=>{const record=data.records.find(item=>item.chatId===chatId&&sameAccount(item.account,account));if(!record||record.leaseToken!==leaseToken||record.running||JSON.stringify(record.expected)!==JSON.stringify(expected)||JSON.stringify(record.pending.slice(0,sent.length))!==JSON.stringify(sent))throw new Error('Sync journal changed');record.expected.push(...sent);record.pending.splice(0,sent.length);if(leaseToken&&!record.pending.length)delete record.leaseToken})}
 markInterruptedConfirmed(account:SyncAccount,confirmedStopped:boolean):Promise<number>{if(!confirmedStopped)return Promise.reject(new Error('Run status unknown'));return this.change(data=>{let count=0;for(const record of data.records){if(sameAccount(record.account,account)&&record.running){record.running=false;record.lastStatus='aborted';count+=1}}return count})}
 acceptRemote(chatId:string,account:SyncAccount,expected:SyncTextMessage[],incoming:SyncTextMessage[]):Promise<void>{return this.change(data=>{const record=data.records.find(item=>item.chatId===chatId&&sameAccount(item.account,account));if(!record||record.running||record.pending.length||JSON.stringify(record.expected)!==JSON.stringify(expected))throw new Error('Sync journal changed');const ids=new Set(record.expected.map(item=>item.id));if(incoming.some(item=>ids.has(item.id)||!ids.add(item.id)))throw new Error('Duplicate remote message');record.expected.push(...incoming)})}
}
