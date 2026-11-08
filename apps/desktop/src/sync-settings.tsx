import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {Switch} from '@/components/ui/switch';
import type {Preferences} from '../shared/types';
type SyncState='off'|'ready'|'syncing'|'pending'|'conflict'|'unavailable'|'interrupted';
const words={
 'zh-CN':{title:'对话同步',enable:'同步新对话到 PiWork',description:'同步用户输入和助手回复，不上传附件、工具内容、本地路径或项目资料。同步后的对话可以在 Web 继续；已有本地对话不会自动上传。',off:'已关闭',ready:'已同步',syncing:'同步中',pending:'等待同步',conflict:'两端历史不一致，请先检查 Web 对话。',unavailable:'同步服务不可用，请检查登录与网络。',interrupted:'任务意外中断，正在等待确认；不会自动重试运行。',retry:'重试同步',recover:'确认任务已停止',saveError:'无法更改同步设置，请检查登录、服务及是否有未完成任务。'},
 en:{title:'Conversation sync',enable:'Sync new conversations to PiWork',description:'Sync user text and assistant replies, not attachments, tool content, local paths or project files. Synced chats can continue on Web; existing local chats are not uploaded automatically.',off:'Off',ready:'Up to date',syncing:'Syncing',pending:'Waiting to sync',conflict:'Histories differ. Check the Web conversation.',unavailable:'Sync is unavailable. Check sign-in and network.',interrupted:'A task was interrupted and awaits confirmation; it will not be rerun automatically.',retry:'Retry sync',recover:'Confirm task stopped',saveError:'Cannot change sync settings. Check sign-in, service availability and pending tasks.'}
} as const;
export function SyncSettings({language,preferences,onChanged}:{language:'zh-CN'|'en';preferences:Preferences;onChanged:(value:Preferences)=>void}){
 const t=words[language];const [status,setStatus]=useState<SyncState>('off');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 async function refresh(){try{setStatus((await window.desktop.syncStatus()).state)}catch{setStatus('unavailable')}}
 useEffect(()=>{void refresh();return window.desktop.onSync(()=>void refresh())},[]);
 async function change(enabled:boolean){setBusy(true);try{const saved=await window.desktop.setPreferences({...preferences,syncEnabled:enabled});onChanged(saved);setError('');await refresh()}catch{setError(t.saveError)}finally{setBusy(false)}}
 async function recover(){setBusy(true);try{await window.desktop.recoverInterruptedSync();setError('');await refresh()}catch{setError(t.saveError)}finally{setBusy(false)}}
 async function retry(){setBusy(true);try{setStatus((await window.desktop.syncNow()).state);setError('')}catch{setError(t.saveError)}finally{setBusy(false)}}
 const problematic=status==='conflict'||status==='unavailable'||status==='interrupted';
 return <section className="overflow-hidden rounded-[14px] border border-border bg-card">
  <div className="divide-y divide-border">
   <div className="flex min-h-14 items-center justify-between gap-3 px-5 py-3">
    <h3 className="text-[15px] font-medium leading-5 text-foreground">{t.title}</h3>
    <p className={problematic?'text-[13px] leading-5 text-destructive':'text-[13px] leading-5 text-muted-foreground'} role="status">{t[status]}</p>
   </div>
   <div className="px-5 py-4">
    <p className="text-[13px] leading-5 text-muted-foreground">{t.description}</p>
   </div>
   <div className="flex items-center justify-between gap-4 px-5 py-4">
    <Label htmlFor="piwork-sync-enable">{t.enable}</Label>
    <Switch aria-label={t.enable} checked={preferences.syncEnabled===true} disabled={busy} id="piwork-sync-enable" onCheckedChange={value=>void change(value)}/>
   </div>
   {(status==='interrupted'||preferences.syncEnabled)?<div className="flex flex-wrap gap-2 px-5 py-3.5">
    {status==='interrupted'&&<Button disabled={busy} onClick={()=>void recover()} size="sm" type="button" variant="outline">{t.recover}</Button>}
    {preferences.syncEnabled&&<Button disabled={busy||status==='syncing'} onClick={()=>void retry()} size="sm" type="button" variant="outline">{t.retry}</Button>}
   </div>:null}
   {error&&<p className="error px-5 py-3.5 text-[13px] leading-5" role="alert">{error}</p>}
  </div>
 </section>;
}
