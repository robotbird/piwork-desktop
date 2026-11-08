import {useEffect,useState} from 'react';
import {UserRoundIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import type {AccountStatus} from '../shared/types';
const messages={
 'zh-CN':{title:'PiWork 账号',address:'PiWork 服务地址',login:'打开登录',refresh:'刷新账号状态',logout:'退出登录',signedOut:'未登录',models:'账号可用模型',none:'暂无可用模型',pending:'可在对话输入框选择账号模型或自定义网关。',history:'查看 Web 对话',error:'无法连接或读取账号状态，请检查服务地址及网络。',logoutError:'退出失败，请检查网络后重试。',hint:'使用 HTTPS 地址；本机测试可使用 HTTP。登录完成后返回此窗口刷新状态。'},
 en:{title:'PiWork account',address:'PiWork server URL',login:'Open login',refresh:'Refresh account',logout:'Sign out',signedOut:'Signed out',models:'Available account models',none:'No models available',pending:'Choose an account model or custom gateway in the chat composer.',history:'View Web conversations',error:'Unable to connect or read account status. Check the server URL and network.',logoutError:'Sign out failed. Check the network and try again.',hint:'Use an HTTPS URL; HTTP is allowed for local testing. Return here and refresh after signing in.'}
} as const;
export function Account({language,onChanged,onOpenHistory}:{language:'zh-CN'|'en';onChanged:(status:AccountStatus|null)=>void;onOpenHistory:()=>void}){
 const t=messages[language];const [baseUrl,setBaseUrl]=useState('');const [status,setStatus]=useState<AccountStatus|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 async function refresh(){setBusy(true);try{const value=await window.desktop.accountStatus();setStatus(value);onChanged(value);if(value.baseUrl)setBaseUrl(value.baseUrl);setError('')}catch{setStatus(null);onChanged(null);setError(t.error)}finally{setBusy(false)}}
 useEffect(()=>{void refresh()},[]);
 async function login(e:React.FormEvent){e.preventDefault();setBusy(true);try{await window.desktop.accountLogin(baseUrl);setStatus(null);onChanged(null);setError('')}catch{setError(t.error)}finally{setBusy(false)}}
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
