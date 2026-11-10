import {useEffect,useState} from 'react';
import {UserRoundIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import type {AccountStatus} from '../shared/types';
import zh from '@/i18n/messages/zh.json';
import en from '@/i18n/messages/en.json';
const messages={'zh-CN':zh.desktopAccount,en:en.desktopAccount} as const;
export function Account({language,onChanged,onOpenHistory}:{language:'zh-CN'|'en';onChanged:(status:AccountStatus|null)=>void;onOpenHistory:()=>void}){
 const t=messages[language];const [baseUrl,setBaseUrl]=useState('https://piwork.net');const [status,setStatus]=useState<AccountStatus|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 async function refresh(){setBusy(true);try{const value=await window.desktop.accountStatus();setStatus(value);onChanged(value);if(value.loginServer??value.baseUrl)setBaseUrl((value.loginServer??value.baseUrl)!);setError(value.loginFailed?t.loginFailed:'')}catch{setStatus(null);onChanged(null);setError(t.error)}finally{setBusy(false)}}
 useEffect(()=>{void refresh();return window.desktop.onAccountChanged(()=>void refresh())},[]);
 async function login(e:React.FormEvent){e.preventDefault();setBusy(true);try{await window.desktop.accountLogin(baseUrl);await refresh()}catch{setError(t.error)}finally{setBusy(false)}}
 async function logout(){setBusy(true);try{await window.desktop.accountLogout();await refresh()}catch{setError(t.logoutError)}finally{setBusy(false)}}
 const userLabel=status?.user?(status.user.name||status.user.email||status.user.id):t.signedOut;
 return <section className="overflow-hidden rounded-[14px] border border-border bg-card">
  <div className="divide-y divide-border">
   <div className="flex min-h-14 items-center justify-between gap-3 px-5 py-3">
    <h3 className="text-[15px] font-medium leading-5 text-foreground">{t.title}</h3>
    {status?.user
     ?<span className="flex min-w-0 items-center gap-2 text-[13px] leading-5 text-muted-foreground"><UserRoundIcon aria-hidden="true" className="size-4 shrink-0"/><span className="truncate">{userLabel}</span></span>
     :<span className="text-[13px] leading-5 text-muted-foreground">{t.signedOut}</span>}
   </div>
   <form className="flex flex-col gap-2.5 px-5 py-4" onSubmit={login}>
    <Label htmlFor="piwork-server-url">{t.address}</Label>
    <Input id="piwork-server-url" onChange={e=>setBaseUrl(e.target.value)} placeholder="https://piwork.example" required type="url" value={baseUrl}/>
    <p className="text-[13px] leading-5 text-muted-foreground">{t.hint}</p>
    {status?.loginPending&&<p className="text-[13px] leading-5 text-muted-foreground" role="status">{t.waiting}</p>}
    <div className="mt-1 flex flex-wrap gap-2">
     <Button disabled={busy} size="sm" type="submit">{t.login}</Button>
     <Button disabled={busy} onClick={()=>void refresh()} size="sm" type="button" variant="outline">{t.refresh}</Button>
    </div>
   </form>
   {status?.user?<div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
    <div className="flex flex-wrap gap-2">
     <Button disabled={busy} onClick={()=>void logout()} size="sm" type="button" variant="outline">{t.logout}</Button>
     <Button disabled={busy} onClick={onOpenHistory} size="sm" type="button" variant="outline">{t.history}</Button>
    </div>
   </div>:null}
   {status?.user?<div className="px-5 py-4">
    <h4 className="text-[13px] font-medium leading-5 text-muted-foreground">{t.models}</h4>
    {status.models.length
     ?<ul className="mt-2 flex flex-col divide-y divide-border">
      {status.models.map(model=><li className="flex min-h-9 items-center justify-between gap-3 py-1.5 text-sm leading-5" key={model.id}>{model.name} <span className="truncate font-mono text-[12px] text-muted-foreground">({model.id})</span></li>)}
     </ul>
     :<p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">{t.none}</p>}
   </div>:null}
   <p className="px-5 py-3.5 text-[13px] leading-5 text-muted-foreground">{t.pending}</p>
   {error&&<p className="error px-5 py-3.5 text-[13px] leading-5" role="alert">{error}</p>}
  </div>
 </section>;
}
