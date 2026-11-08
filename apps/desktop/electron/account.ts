import {app,BrowserWindow,session} from 'electron';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {AccountStatus} from '../shared/types';

const partition='persist:piwork-account';
function address(value:string):string {
 const url=new URL(value.trim());
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Invalid account server');
 return url.origin;
}
const file=()=>path.join(app.getPath('userData'),'account-server.json');
async function getAddress():Promise<string|null>{try{return address(JSON.parse(await fs.readFile(file(),'utf8')).baseUrl)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error}}
async function request(base:string,pathname:string,options:RequestInit={}){
 const response=await session.fromPartition(partition).fetch(base+pathname,{...options,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('Account request failed');
 return response.json();
}
export async function accountStatus():Promise<AccountStatus>{
 const baseUrl=await getAddress();if(!baseUrl)return {baseUrl:null,user:null,models:[]};
 const data=await request(baseUrl,'/api/auth/session');
 if(!data?.user||typeof data.user.id!=='string')return {baseUrl,user:null,models:[]};
 const catalog=await request(baseUrl,'/api/models');
 if(!Array.isArray(catalog?.models))throw new Error('Invalid model catalog');
 return {baseUrl,defaultModelId:typeof catalog.defaultModelId==='string'?catalog.defaultModelId:undefined,user:{id:data.user.id,name:typeof data.user.name==='string'?data.user.name:null,email:typeof data.user.email==='string'?data.user.email:null},models:catalog.models.filter((model:unknown):model is {id:string;name:string}=>!!model&&typeof model==='object'&&typeof (model as {id?:unknown}).id==='string'&&typeof (model as {name?:unknown}).name==='string').filter((model:{id:string})=>catalog.allowSwitch!==false||model.id===catalog.defaultModelId).map((model:{id:string;name:string;capabilities?:{vision?:boolean};providerKey?:unknown})=>({id:model.id,name:model.name,providerKey:typeof model.providerKey==='string'?model.providerKey:undefined,supportsImages:model.capabilities?.vision===true}))};
}
export async function openAccountLogin(parent:BrowserWindow,input:string){
 const baseUrl=address(input);await fs.mkdir(app.getPath('userData'),{recursive:true});await fs.writeFile(file()+'.tmp',JSON.stringify({baseUrl}),{mode:0o600});await fs.rename(file()+'.tmp',file());
 const child=new BrowserWindow({parent,width:520,height:720,webPreferences:{partition,contextIsolation:true,nodeIntegration:false,sandbox:true}});
 child.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 const guard=(event:Electron.Event,url:string)=>{try{if(new URL(url).origin!==baseUrl)event.preventDefault()}catch{event.preventDefault()}};
 child.webContents.on('will-navigate',guard);child.webContents.on('will-redirect',guard);
 await child.loadURL(baseUrl+'/login');
}
export async function logoutAccount(){
 const baseUrl=await getAddress();if(!baseUrl)return;
 const data=await request(baseUrl,'/api/auth/csrf');
 if(typeof data?.csrfToken!=='string')throw new Error('Invalid CSRF token');
 await request(baseUrl,'/api/auth/signout',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','X-Auth-Return-Redirect':'1'},body:new URLSearchParams({csrfToken:data.csrfToken,callbackUrl:baseUrl+'/'}).toString()});
 await session.fromPartition(partition).clearStorageData({origin:baseUrl,storages:['cookies']});
}

/** The renderer and Pi worker never receive the Web session cookie. */
export function accountSyncTransport(account:import('./sync-journal').SyncAccount):import('./sync-engine').SyncTransport {
 async function call(chatId:string,method:'GET'|'POST',body?:unknown,lease=false){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId)||await getAddress()!==account.baseUrl)throw new Error('Sync account changed');
  const current=await request(account.baseUrl,'/api/auth/session');if(current?.user?.id!==account.userId)throw new Error('Sync account changed');
  const response=await session.fromPartition(partition).fetch(`${account.baseUrl}/api/desktop/sync/${chatId}${lease?'/lease':''}`,{method,headers:{'x-piwork-desktop':'1',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(response.status===409)throw new Error('Sync conflict');if(!response.ok)throw new Error('Sync unavailable');
  if(Number(response.headers.get('content-length'))>2_000_000)throw new Error('Sync response too large');
  const reader=response.body?.getReader();if(!reader)throw new Error('Sync response missing');const chunks:Uint8Array[]=[];let bytes=0;while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2_000_000){await reader.cancel();throw new Error('Sync response too large')}chunks.push(part.value)}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 return {push:(chatId,payload)=>call(chatId,'POST',payload),pull:chatId=>call(chatId,'GET'),acquire:async(chatId,expected)=>{const value=await call(chatId,'POST',{action:'acquire',expected},true);if(typeof value.token!=='string')throw new Error('Invalid sync lease');return value.token},release:async(chatId,token)=>{await call(chatId,'POST',{action:'release',token},true)}};
}

export async function accountSyncAvailable(account:import('./sync-journal').SyncAccount):Promise<boolean>{
 if(await getAddress()!==account.baseUrl)return false;
 const current=await request(account.baseUrl,'/api/auth/session');if(current?.user?.id!==account.userId)return false;
 const status=await request(account.baseUrl,'/api/desktop/sync/status',{headers:{'x-piwork-desktop':'1'}});return status?.enabled===true;
}

const validWebChatId=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
async function webHistoryRequest(pathname:string){
 const baseUrl=await getAddress();if(!baseUrl)throw new Error('Account unavailable');const identity=await request(baseUrl,'/api/auth/session');if(typeof identity?.user?.id!=='string')throw new Error('Account unavailable');const account={baseUrl,user:{id:identity.user.id}};
 const response=await session.fromPartition(partition).fetch(account.baseUrl+pathname,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('Web history unavailable');
 if(Number(response.headers.get('content-length'))>4_000_000)throw new Error('Web history too large');
 const reader=response.body?.getReader();if(!reader)throw new Error('Web history unavailable');const chunks:Uint8Array[]=[];let size=0;
 while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4_000_000){await reader.cancel();throw new Error('Web history too large')}chunks.push(part.value)}
 const current=await request(account.baseUrl,'/api/auth/session');if(current?.user?.id!==account.user.id)throw new Error('Account changed');return {account,data:JSON.parse(Buffer.concat(chunks).toString('utf8'))};
}
export async function listWebHistory(before?:string){
 if(before!==undefined&&!validWebChatId(before))throw new Error('Invalid chat');
 const {data}=await webHistoryRequest(`/api/history?limit=30${before?`&ending_before=${encodeURIComponent(before)}`:''}`);
 if(!Array.isArray(data?.chats)||typeof data.hasMore!=='boolean')throw new Error('Invalid web history');
 const chats=data.chats.map((item:unknown)=>{if(!item||typeof item!=='object')throw new Error('Invalid web history');const row=item as Record<string,unknown>;if(!validWebChatId(row.id)||typeof row.title!=='string'||row.title.length>1000||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt)))throw new Error('Invalid web history');return {id:row.id,title:row.title,createdAt:row.createdAt,shared:row.sharedWithMe===true}});
 return {chats,hasMore:data.hasMore as boolean};
}
export async function readWebHistory(chatId:string){
 if(!validWebChatId(chatId))throw new Error('Invalid chat');
 const {account,data}=await webHistoryRequest(`/api/messages?chatId=${encodeURIComponent(chatId)}`);
 if(data?.isReadonly!==false||typeof data.userId!=='string'||!Array.isArray(data.messages))throw new Error('Web chat unavailable');
 const messages:import('./sync-journal').SyncTextMessage[]=[];let omitted=false;
 for(const item of data.messages){if(!item||!validWebChatId(item.id)||(item.role!=='user'&&item.role!=='assistant')||!Array.isArray(item.parts)){omitted=true;continue}const parts=item.parts.filter((part:unknown):part is {type:'text';text:string}=>!!part&&typeof part==='object'&&(part as {type?:unknown}).type==='text'&&typeof (part as {text?:unknown}).text==='string');if(parts.length!==item.parts.length)omitted=true;const text=parts.map((part:{text:string})=>part.text).join('');if(text)messages.push({id:item.id,role:item.role,text});else omitted=true}
 if(new Set(messages.map(item=>item.id)).size!==messages.length)throw new Error('Invalid web history');
 return {account,chatId,messages,omitted};
}
export async function openWebHistory(chatId:string){if(!validWebChatId(chatId))throw new Error('Invalid chat');const base=await getAddress();if(!base)throw new Error('Account unavailable');await import('electron').then(({shell})=>shell.openExternal(`${base}/chat/${chatId}`))}
