import {createHash,randomBytes} from 'node:crypto';

export const LOGIN_TTL=10*60*1000;
export const secretPattern=/^[A-Za-z0-9_-]{43}$/;
export type PendingLogin={baseUrl:string;state:string;verifier:string;expiresAt:number};
export function accountAddress(value:string):string {
 const url=new URL(value.trim());
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!['https:','http:'].includes(url.protocol))throw new Error('Invalid account server');
 return url.origin;
}
export function beginAccountLogin(input:string){
 const pending:PendingLogin={baseUrl:accountAddress(input),state:randomBytes(32).toString('base64url'),verifier:randomBytes(32).toString('base64url'),expiresAt:Date.now()+LOGIN_TTL};
 const url=new URL('/desktop-login',pending.baseUrl);
 url.search=new URLSearchParams({state:pending.state,challenge:createHash('sha256').update(pending.verifier).digest('base64url')}).toString();
 return {pending,url:url.href};
}
export function callbackCode(input:string,pending:PendingLogin):string|null {
 try {
  if(input.length>2048||Date.now()>=pending.expiresAt)return null;
  const url=new URL(input);
  if(url.protocol!=='piwork:'||url.hostname!=='auth'||url.pathname!=='/callback'||url.username||url.password||url.port||url.hash||[...url.searchParams].length!==2)return null;
  const code=url.searchParams.get('code');
  return url.searchParams.get('state')===pending.state&&code&&secretPattern.test(code)?code:null;
 }catch{return null}
}
