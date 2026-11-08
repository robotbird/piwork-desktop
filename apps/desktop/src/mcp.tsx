import {useEffect,useState} from 'react';
import {useTranslations} from 'next-intl';
import {toast} from 'sonner';
import {GlobeIcon,MoreHorizontalIcon,PencilIcon,PlugIcon,PlugZapIcon,PlusIcon,TerminalIcon,Trash2Icon} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Spinner} from '@/components/ui/spinner';
import {Switch} from '@/components/ui/switch';
import {Textarea} from '@/components/ui/textarea';
import {cn} from '@/lib/utils';
import type {McpInput,McpServer} from '../shared/types';

/** 与 Web 管理台同源的文案来自 mcpServers/common 目录(useTranslations);此处仅保留桌面端机制不同的句子 */
const words={
 'zh-CN':{
  invalidName:'名称需以字母、数字或下划线开头，仅含字母、数字、下划线与连字符（最长 64 字符）',
  duplicateName:'该名称已被其他服务使用',
  inUse:'服务正在被当前对话使用，请先停止对话再试',
  actionFailed:'操作失败，请检查配置后重试',
  loadFailed:'无法加载 MCP 服务，请重启应用后重试',
  workspaceHint:'启用的服务可在对话输入框的「添加内容与能力」菜单中绑定；本地命令在本机运行，不受系统沙箱限制。',
  dialogDescription:'配置 MCP 服务接入；启用的服务可在对话中绑定使用。',
  transportStdioDescription:'在本机以子进程方式启动',
  fieldEnabledHint:'停用后对话中将无法选择该服务',
  deleteDescription:'将永久删除「{name}」，对话中将无法再使用该服务，删除后无法恢复。',
  testAction:'测试连接',
  testTitle:'连接测试',
  testPassed:'连接测试成功',
  testNoTools:'没有可用工具',
  testTimeout:'连接超时，请检查服务状态。',
  testFailed:'连接失败，请检查命令、地址或服务状态。',
 },
 en:{
  invalidName:'Name must start with a letter, digit or underscore and contain only letters, digits, underscores and hyphens (max 64)',
  duplicateName:'This name is already used by another server',
  inUse:'This server is used by the active chat. Stop the chat first.',
  actionFailed:'Action failed. Check the configuration and try again.',
  loadFailed:'Unable to load MCP servers. Restart the app and try again.',
  workspaceHint:'Enabled servers attach from the composer\'s "Add content and capabilities" menu. Local commands run on this Mac without OS sandboxing.',
  dialogDescription:'Configure an MCP service. Enabled services can be attached in chats.',
  transportStdioDescription:'Launches as a subprocess on this machine',
  fieldEnabledHint:'Disabled servers are not offered in chats',
  deleteDescription:'This permanently deletes "{name}". Chats will no longer offer this service. This cannot be undone.',
  testAction:'Test connection',
  testTitle:'Connection test',
  testPassed:'Connection test passed',
  testNoTools:'No tools available',
  testTimeout:'Connection timed out. Check the server.',
  testFailed:'Connection failed. Check the command, URL or server.',
 },
} as const;

type McpWords={[K in keyof (typeof words)['zh-CN']]:string};

/** 桌面端名称规则保留下划线(与既有配置及 pi 工具名 mcp__<name>__ 兼容),比 Web 管理台略宽 */
const NAME_PATTERN=/^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,63}$/;

function parseLines(text:string):string[]{
 return text.split('\n').map(line=>line.trim()).filter(Boolean);
}
/** 一行一条 KEY=VALUE；返回 null 表示存在格式错误 */
function parseKeyValueLines(text:string):{error:boolean;value:Record<string,string>}{
 const value:Record<string,string>={};
 for(const line of parseLines(text)){
  const eq=line.indexOf('=');
  if(eq<=0)return {error:true,value:{}};
  value[line.slice(0,eq).trim()]=line.slice(eq+1);
 }
 return {error:false,value};
}
function serializeKeyValue(record:Record<string,string>|undefined):string{
 return Object.entries(record??{}).map(([key,value])=>`${key}=${value}`).join('\n');
}

type McpFormValues={
 args:string[];
 command:string;
 description:string;
 enabled:boolean;
 env:Record<string,string>;
 headers:Record<string,string>;
 name:string;
 transport:'stdio'|'http';
 url:string;
};

type TestOutcome=Awaited<ReturnType<typeof window.desktop.testMcp>>;

export function McpServices({language,onChanged}:{language:'zh-CN'|'en';onChanged:(servers:McpServer[])=>void}){
 const t=useTranslations('mcpServers');
 const tc=useTranslations('common');
 const w=words[language];
 const [servers,setServers]=useState<McpServer[]>([]);
 const [loadError,setLoadError]=useState(false);
 const [dialogOpen,setDialogOpen]=useState(false);
 const [dialogServer,setDialogServer]=useState<McpServer|null>(null);
 const [deleteTarget,setDeleteTarget]=useState<McpServer|null>(null);
 const [deleting,setDeleting]=useState(false);
 const [togglingId,setTogglingId]=useState<string|null>(null);
 const [testingId,setTestingId]=useState<string|null>(null);
 const [testResult,setTestResult]=useState<{name:string;result:TestOutcome}|null>(null);
 const refresh=async()=>{
  const items=await window.desktop.listMcp();
  setServers(items);
  onChanged(items);
 };
 useEffect(()=>{void refresh().catch(()=>setLoadError(true))},[]);
 function actionError(error:unknown){
  const message=error instanceof Error?error.message:'';
  toast.error(message==='Duplicate name'?w.duplicateName:message==='MCP is in use'?w.inUse:w.actionFailed);
 }
 async function handleToggle(server:McpServer,enabled:boolean){
  setTogglingId(server.id);
  try{
   await window.desktop.setMcpEnabled(server.id,enabled);
   await refresh();
   toast.success(enabled?t('serverEnabled',{name:server.name}):t('serverDisabled',{name:server.name}));
  }catch(error){actionError(error)}finally{setTogglingId(null)}
 }
 async function handleDelete(){
  if(!deleteTarget)return;
  setDeleting(true);
  try{
   await window.desktop.removeMcp(deleteTarget.id);
   await refresh();
   toast.success(t('serverDeleted',{name:deleteTarget.name}));
   setDeleteTarget(null);
  }catch(error){actionError(error)}finally{setDeleting(false)}
 }
 async function handleSubmit(values:McpFormValues):Promise<boolean>{
  const input:McpInput=values.transport==='stdio'
   ?{name:values.name,type:'stdio',command:values.command,args:values.args,env:values.env,description:values.description||undefined}
   :{name:values.name,type:'http',url:values.url,headers:values.headers,description:values.description||undefined};
  try{
   await window.desktop.saveMcp(dialogServer?.id??null,input);
   await refresh();
  }catch(error){actionError(error);return false}
  toast.success(dialogServer?t('serverUpdated',{name:values.name}):t('serverCreated',{name:values.name}));
  setDialogOpen(false);
  setDialogServer(null);
  return true;
 }
 async function handleTest(server:McpServer){
  setTestingId(server.id);
  try{
   const result=await window.desktop.testMcp(server.id);
   setTestResult({name:server.name,result});
  }catch{setTestResult({name:server.name,result:{ok:false,reason:'unavailable'}})}finally{setTestingId(null)}
 }
 /* 设置页内嵌形态:标题与副标题由设置分区页头提供,这里只渲染工具行(提示 + 新建)与列表 */
 return <div>
  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
   <p className="min-w-0 text-[13px] leading-5 text-muted-foreground">{w.workspaceHint}</p>
   <Button className="w-fit shrink-0 px-4" onClick={()=>{setDialogServer(null);setDialogOpen(true)}}>
    <PlusIcon data-icon="inline-start"/>
    {t('addServer')}
   </Button>
  </div>
   {loadError?<p className="mt-4 text-[13px] text-destructive" role="alert">{w.loadFailed}</p>:servers.length?(
    <div className="mt-6 overflow-hidden rounded-[14px] border border-border bg-card">
     <div className="overflow-x-auto">
      <table aria-label={t('serverList')} className="w-full min-w-[760px] text-left text-sm">
       <thead className="bg-muted/50 text-[13px] text-muted-foreground">
        <tr>
         <th className="h-10 px-4 font-medium" scope="col">{t('colName')}</th>
         <th className="h-10 w-24 px-4 font-medium" scope="col">{t('colTransport')}</th>
         <th className="h-10 px-4 font-medium" scope="col">{t('colTarget')}</th>
         <th className="h-10 w-28 px-4 font-medium" scope="col">{tc('status')}</th>
         <th className="h-10 w-14 px-4 text-right font-medium" scope="col">{tc('actions')}</th>
        </tr>
       </thead>
       <tbody>
        {servers.map(server=><McpServerRow key={server.id} onDelete={setDeleteTarget} onEdit={server=>{setDialogServer(server);setDialogOpen(true)}} onTest={handleTest} onToggle={handleToggle} server={server} testing={testingId===server.id} toggling={togglingId===server.id} w={w}/>)}
       </tbody>
      </table>
     </div>
    </div>
   ):(
    <div className="mt-6 rounded-[14px] border border-border bg-card px-6 py-14 text-center">
     <span className="mx-auto grid size-12 place-items-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
      <PlugIcon className="size-5"/>
     </span>
     <p className="mt-4 text-sm font-medium">{t('emptyTitle')}</p>
     <p className="mt-1 text-[13px] text-muted-foreground">{t('emptyDescription')}</p>
     <Button className="mt-5" onClick={()=>{setDialogServer(null);setDialogOpen(true)}} variant="outline">
      <PlusIcon data-icon="inline-start"/>
      {t('addServer')}
     </Button>
    </div>
   )}
  <McpServerDialog onClose={()=>{setDialogOpen(false);setDialogServer(null)}} onSubmit={handleSubmit} open={dialogOpen} server={dialogServer} w={w}/>
  <Dialog onOpenChange={open=>{if(!open&&!deleting)setDeleteTarget(null)}} open={Boolean(deleteTarget)}>
   <DialogContent className="sm:max-w-md">
    <DialogHeader>
     <DialogTitle>{t('deleteTitle')}</DialogTitle>
     <DialogDescription>{w.deleteDescription.replace('{name}',deleteTarget?.name??'')}</DialogDescription>
    </DialogHeader>
    <DialogFooter>
     <Button disabled={deleting} onClick={()=>setDeleteTarget(null)} variant="outline">{tc('cancel')}</Button>
     <Button disabled={deleting} onClick={()=>void handleDelete()} variant="destructive">{deleting?tc('deleting'):tc('delete')}</Button>
    </DialogFooter>
   </DialogContent>
  </Dialog>
  <Dialog onOpenChange={open=>{if(!open)setTestResult(null)}} open={Boolean(testResult)}>
   <DialogContent className="sm:max-w-lg">
    <DialogHeader>
     <DialogTitle>{w.testTitle}</DialogTitle>
     <DialogDescription>{testResult?.name}</DialogDescription>
    </DialogHeader>
    {testResult&&(testResult.result.ok?(
     <div role="status">
      <p className="text-sm font-medium">{w.testPassed}</p>
      {testResult.result.tools.length?(
       <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto text-sm">
        {testResult.result.tools.map(tool=>(
         <li className="rounded-lg border border-border px-3 py-2" key={tool.name}>
          <span className="font-mono text-[13px] font-medium">{tool.name}</span>
          {tool.description?<span className="mt-0.5 block text-[13px] leading-5 text-muted-foreground">{tool.description}</span>:null}
         </li>
        ))}
       </ul>
      ):<p className="mt-2 text-sm text-muted-foreground">{w.testNoTools}</p>}
     </div>
    ):(
     <p className="text-sm text-destructive" role="alert">{testResult.result.reason==='timeout'?w.testTimeout:w.testFailed}</p>
    ))}
    <DialogFooter>
     <Button onClick={()=>setTestResult(null)}>{tc('close')}</Button>
    </DialogFooter>
   </DialogContent>
  </Dialog>
 </div>;
}

function McpServerRow({onDelete,onEdit,onTest,onToggle,server,testing,toggling,w}:{onDelete:(server:McpServer)=>void;onEdit:(server:McpServer)=>void;onTest:(server:McpServer)=>void;onToggle:(server:McpServer,enabled:boolean)=>void;server:McpServer;testing:boolean;toggling:boolean;w:McpWords}){
 const t=useTranslations('mcpServers');
 const tc=useTranslations('common');
 const target=server.type==='stdio'?(
  <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[13px] text-muted-foreground">
   <TerminalIcon aria-hidden="true" className="size-3.5 shrink-0"/>
   <span className="truncate">
    {server.command}
    {server.args&&server.args.length>0?` ${t('argsCount',{count:server.args.length})}`:''}
   </span>
  </span>
 ):(
  <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[13px] text-muted-foreground">
   <GlobeIcon aria-hidden="true" className="size-3.5 shrink-0"/>
   <span className="truncate">{server.url}</span>
  </span>
 );
 return <tr className="border-t border-border/70 align-middle transition-colors hover:bg-muted/30">
  <td className="px-4 py-3.5">
   <div className="min-w-0">
    <span className={cn('block truncate text-[14px] leading-5 font-medium',server.enabled?'text-foreground':'text-muted-foreground')}>{server.name}</span>
    {server.description?<p className="mt-0.5 line-clamp-1 text-[13px] leading-5 text-muted-foreground">{server.description}</p>:null}
   </div>
  </td>
  <td className="px-4 py-3.5">
   <Badge variant={server.type==='stdio'?'secondary':'outline'}>{server.type==='stdio'?t('transportStdio'):t('transportHttp')}</Badge>
  </td>
  <td className="max-w-[280px] px-4 py-3.5">{target}</td>
  <td className="px-4 py-3.5">
   <div className="flex items-center gap-2">
    <Switch aria-label={t('toggleServer',{name:server.name})} checked={server.enabled} disabled={toggling} onCheckedChange={checked=>onToggle(server,checked)}/>
    <span className={cn('text-[13px] leading-5 whitespace-nowrap',server.enabled?'text-foreground':'text-muted-foreground')}>{server.enabled?tc('enabled'):t('disabled')}</span>
   </div>
  </td>
  <td className="px-4 py-3.5 text-right">
   <DropdownMenu modal>
    <DropdownMenuTrigger asChild>
     <Button aria-label={tc('moreActions')} className="text-muted-foreground hover:text-foreground data-[state=open]:bg-muted" disabled={testing||toggling} size="icon-sm" variant="ghost">
      {testing?<Spinner className="size-4"/>:<MoreHorizontalIcon/>}
     </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" side="bottom">
     <DropdownMenuItem className="cursor-pointer" onClick={()=>onTest(server)}>
      <PlugZapIcon/>
      <span>{w.testAction}</span>
     </DropdownMenuItem>
     <DropdownMenuItem className="cursor-pointer" onClick={()=>onEdit(server)}>
      <PencilIcon/>
      <span>{t('editAction')}</span>
     </DropdownMenuItem>
     <DropdownMenuItem className="cursor-pointer" onClick={()=>onDelete(server)} variant="destructive">
      <Trash2Icon/>
      <span>{tc('delete')}</span>
     </DropdownMenuItem>
    </DropdownMenuContent>
   </DropdownMenu>
  </td>
 </tr>;
}

function McpServerDialog({onClose,onSubmit,open,server,w}:{onClose:()=>void;onSubmit:(values:McpFormValues)=>Promise<boolean>;open:boolean;server:McpServer|null;w:McpWords}){
 const t=useTranslations('mcpServers');
 const tc=useTranslations('common');
 const isEdit=server!==null;
 const [name,setName]=useState('');
 const [description,setDescription]=useState('');
 const [transport,setTransport]=useState<'stdio'|'http'>('stdio');
 const [command,setCommand]=useState('');
 const [argsText,setArgsText]=useState('');
 const [envText,setEnvText]=useState('');
 const [url,setUrl]=useState('');
 const [headersText,setHeadersText]=useState('');
 const [enabled,setEnabled]=useState(true);
 const [submitting,setSubmitting]=useState(false);
 useEffect(()=>{
  if(open){
   setName(server?.name??'');
   setDescription(server?.description??'');
   setTransport(server?.type??'stdio');
   setCommand(server?.command??'');
   setArgsText((server?.args??[]).join('\n'));
   setEnvText(serializeKeyValue(server?.env));
   setUrl(server?.url??'');
   setHeadersText(serializeKeyValue(server?.headers));
   setEnabled(server?.enabled??true);
  }
 },[open,server]);
 async function handleSubmit(event:React.FormEvent){
  event.preventDefault();
  const trimmedName=name.trim();
  if(!trimmedName){toast.error(t('nameRequired'));return}
  if(!NAME_PATTERN.test(trimmedName)){toast.error(w.invalidName);return}
  if(transport==='stdio'&&!command.trim()){toast.error(t('commandRequired'));return}
  if(transport==='http'&&!/^https?:\/\//.test(url.trim())){toast.error(t('urlRequired'));return}
  const env=parseKeyValueLines(envText);
  if(transport==='stdio'&&env.error){toast.error(t('invalidKeyValue'));return}
  const headers=parseKeyValueLines(headersText);
  if(transport==='http'&&headers.error){toast.error(t('invalidKeyValue'));return}
  setSubmitting(true);
  try{
   await onSubmit({args:parseLines(argsText),command:command.trim(),description:description.trim(),enabled,env:env.value,headers:headers.value,name:trimmedName,transport,url:url.trim()});
  }finally{setSubmitting(false)}
 }
 const transportOptions=[
  {description:w.transportStdioDescription,icon:TerminalIcon,key:'stdio' as const,label:t('transportStdioTitle')},
  {description:t('transportHttpDescription'),icon:GlobeIcon,key:'http' as const,label:t('transportHttpTitle')},
 ];
 return <Dialog onOpenChange={open=>{if(!open)onClose()}} open={open}>
  <DialogContent className="gap-5 sm:max-w-lg">
   <DialogHeader>
    <DialogTitle className="text-lg">{isEdit?t('editTitle'):t('createTitle')}</DialogTitle>
    <DialogDescription>{w.dialogDescription}</DialogDescription>
   </DialogHeader>
   <form className="grid gap-4" onSubmit={e=>void handleSubmit(e)}>
    <div className="grid gap-2">
     <Label htmlFor="mcp-server-name">{t('fieldName')}</Label>
     <Input disabled={isEdit} id="mcp-server-name" onChange={e=>setName(e.target.value)} placeholder={t('fieldNamePlaceholder')} value={name}/>
    </div>
    <div className="grid gap-2">
     <Label htmlFor="mcp-server-description">{t('fieldDescription')}</Label>
     <Input id="mcp-server-description" maxLength={1024} onChange={e=>setDescription(e.target.value)} placeholder={t('fieldDescriptionPlaceholder')} value={description}/>
    </div>
    <div className="grid gap-2">
     <Label>{t('fieldTransport')}</Label>
     <div className="grid gap-2 sm:grid-cols-2">
      {transportOptions.map(option=>{
       const Icon=option.icon;
       const active=transport===option.key;
       return <button className={cn('flex min-h-20 w-full flex-col items-start rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors',active?'border-primary/60 bg-primary/5':'hover:bg-muted/45')} key={option.key} onClick={()=>setTransport(option.key)} type="button">
        <span className="flex items-center gap-2 text-sm font-medium">
         <Icon aria-hidden="true" className="size-4"/>
         {option.label}
        </span>
        <span className="mt-1 text-xs text-muted-foreground">{option.description}</span>
       </button>;
      })}
     </div>
    </div>
    {transport==='stdio'?<>
     <div className="grid gap-2">
      <Label htmlFor="mcp-server-command">{t('fieldCommand')}</Label>
      <Input id="mcp-server-command" onChange={e=>setCommand(e.target.value)} placeholder={t('fieldCommandPlaceholder')} value={command}/>
     </div>
     <div className="grid gap-2">
      <Label htmlFor="mcp-server-args">{t('fieldArgs')}</Label>
      <Textarea id="mcp-server-args" onChange={e=>setArgsText(e.target.value)} placeholder={t('fieldArgsPlaceholder')} rows={3} value={argsText}/>
     </div>
     <div className="grid gap-2">
      <Label htmlFor="mcp-server-env">{t('fieldEnv')}</Label>
      <Textarea id="mcp-server-env" onChange={e=>setEnvText(e.target.value)} placeholder={t('fieldEnvPlaceholder')} rows={3} value={envText}/>
     </div>
    </>:<>
     <div className="grid gap-2">
      <Label htmlFor="mcp-server-url">{t('fieldUrl')}</Label>
      <Input id="mcp-server-url" onChange={e=>setUrl(e.target.value)} placeholder={t('fieldUrlPlaceholder')} value={url}/>
     </div>
     <div className="grid gap-2">
      <Label htmlFor="mcp-server-headers">{t('fieldHeaders')}</Label>
      <Textarea id="mcp-server-headers" onChange={e=>setHeadersText(e.target.value)} placeholder={t('fieldHeadersPlaceholder')} rows={3} value={headersText}/>
     </div>
    </>}
    <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
     <div>
      <p className="text-sm font-medium">{t('fieldEnabled')}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{w.fieldEnabledHint}</p>
     </div>
     <Switch aria-label={t('fieldEnabled')} checked={enabled} onCheckedChange={setEnabled}/>
    </div>
    <DialogFooter>
     <Button disabled={submitting} onClick={onClose} variant="outline">{tc('cancel')}</Button>
     <Button disabled={submitting} type="submit">
      {submitting?<Spinner/>:null}
      {isEdit?t('submitSave'):t('submitCreate')}
     </Button>
    </DialogFooter>
   </form>
  </DialogContent>
 </Dialog>;
}
