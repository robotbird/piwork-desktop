import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {toast} from 'sonner';
import {
 BrainCircuitIcon,CheckIcon,ChevronDownIcon,CircleHelpIcon,GlobeIcon,KeyRoundIcon,MoreHorizontalIcon,
 PlusIcon,SearchIcon,Settings2Icon,ShieldCheckIcon,Trash2Icon,UploadIcon,WrenchIcon,
} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from '@/components/ui/collapsible';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator,DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Spinner} from '@/components/ui/spinner';
import {Switch} from '@/components/ui/switch';
import {cn} from '@/lib/utils';
import type {
 AccountStatus,LocalizedText,ModelProvidersView,ModelSource,ProviderCatalogItem,ProviderCredentialField,
 ProviderInstallation,ProviderModelSpec,
} from '../shared/types';

/** 模型管理设置分区(仿 piwork web admin/models):模型来源选择(piwork.net/自定义)+
    已安装供应商 + 发现更多供应商(搜索/安装/上传插件包)。桌面端自研文案,仿 mcp.tsx 模式。 */
const words={
 'zh-CN':{
  sourceTitle:'模型来源',sourceDesc:'选择对话使用的模型来源;输入框菜单两组模型都会显示,此处决定新对话的默认模型。',
  sourceAccount:'PiWork.net 模型',sourceAccountDesc:'使用 PiWork 账号提供的模型,由服务端统一管理。',
  sourceCustom:'自定义模型',sourceCustomDesc:'使用本地安装的模型供应商,自行配置 API Key 与模型。',
  accountSignedIn:'已登录 · {count} 个模型',accountSignedOut:'尚未登录 PiWork 账号',signIn:'前往登录',accountDefault:'默认:{name}',
  customDefault:'默认:{name}',customDefaultNone:'尚未配置自定义模型',
  installedProviders:'已安装供应商({count})',defaultModel:'默认模型设置',defaultBadge:'默认',
  pluginModels:'{count} 个插件模型',enabledModelCount:'{enabled} / {total} 个模型已启用',
  llm:'大语言模型',vision:'视觉',tools:'工具',reasoning:'推理',chat:'对话',
  healthy:'运行正常',disabled:'已禁用',apiKeyRequired:'需要配置 API Key',credentialsUnreadable:'凭据无法解密,请重新填写',
  modelsUnlockAfterSetup:'配置 API Key 后即可启用模型',
  configure:'配置',addApiKey:'添加 API Key',enable:'启用',disable:'禁用',uninstall:'卸载',more:'更多操作',
  emptyInstalled:'尚未安装模型供应商',emptyInstalledDesc:'从下方发现更多供应商安装,或上传插件包。',
  discover:'发现更多供应商',searchPlaceholder:'搜索供应商名称或描述',uploadPackage:'上传插件包',
  install:'安装',installed:'已安装',modelCount:'{count} 个模型',
  installTitle:'安装模型供应商',installDescription:'安装后可在供应商配置中填写 API Key 并启用所需模型。',
  networkAccess:'插件网络访问:',installProvider:'安装供应商',installing:'安装中…',
  uninstallTitle:'卸载模型供应商?',uninstallDescription:'将卸载「{name}」及其模型配置;已保存的凭据将被删除。',uninstallAction:'卸载',
  configureTitle:'配置模型供应商',endpoint:'API 端点',endpointHint:'默认使用供应商官方端点,可替换为自建或代理地址。',
  saveConfig:'保存配置',saving:'保存中…',cancel:'取消',
  credentialsEncrypted:'凭据经系统安全存储加密后保存在本机。',
  modelCatalog:'模型目录',noModels:'暂无模型',addModel:'添加模型',modelIdPlaceholder:'输入模型 ID,如 qwen3.5-plus',
  modelVision:'支持图片输入',removeModel:'移除',setDefault:'设为默认',
  loadFailed:'无法加载模型供应商,请重启应用后重试。',actionFailed:'操作失败,请稍后重试。',actionFailedDetail:'操作失败:{detail}',
  uploaded:'插件包已安装:{name}',providerInstalled:'已安装 {name}',providerUninstalled:'已卸载 {name}',
  errProviderAlreadyInstalled:'该供应商已安装',errConfigureApiKeyFirst:'请先配置并保存 API Key,再启用模型。',
  errDefaultModel:'默认模型需处于启用状态。',errCredentialRequired:'请填写所有必填凭据。',
  errCredentialRecovery:'已保存凭据无法解密,请重新完整填写。',errUnreachable:'无法连接服务商,请检查网络与端点地址。',
  errInvalidKey:'API Key 无效({detail})',errValidation:'凭据验证失败({detail})',errProviderUnavailable:'服务商暂不可用({detail}),请稍后重试。',
  errInvalidPackage:'插件包格式无效',errInvalidName:'文件名需为 piwork-llm-<供应商>.zip',errTooLarge:'插件包超出大小限制',
  errEntry:'插件包内容不受支持',errProviderJson:'缺少或无法解析 provider.json',errKeyMismatch:'providerKey 与包名不一致',
  errIcon:'图标不受支持',errInvalidDefinition:'插件包定义无效:{detail}',errBusy:'当前有对话进行中,请先停止再修改。',
  errReadOnly:'该供应商模型目录不可编辑',errUnavailable:'供应商不可用',
 },
 en:{
  sourceTitle:'Model source',sourceDesc:'Choose where chat models come from. The composer menu lists both groups; this choice sets the default for new chats.',
  sourceAccount:'PiWork.net models',sourceAccountDesc:'Use models provided by your PiWork account, managed server-side.',
  sourceCustom:'Custom models',sourceCustomDesc:'Use locally installed model providers with your own API keys and models.',
  accountSignedIn:'Signed in · {count} models',accountSignedOut:'Not signed in to PiWork',signIn:'Sign in',accountDefault:'Default: {name}',
  customDefault:'Default: {name}',customDefaultNone:'No custom model configured yet',
  installedProviders:'Installed providers ({count})',defaultModel:'Default model settings',defaultBadge:'Default',
  pluginModels:'{count} plugin models',enabledModelCount:'{enabled} / {total} models enabled',
  llm:'LLM',vision:'Vision',tools:'Tools',reasoning:'Reasoning',chat:'Chat',
  healthy:'Running normally',disabled:'Disabled',apiKeyRequired:'API key required',credentialsUnreadable:'Credentials unreadable; re-enter them',
  modelsUnlockAfterSetup:'Models unlock after the API key is set',
  configure:'Configure',addApiKey:'Add API key',enable:'Enable',disable:'Disable',uninstall:'Uninstall',more:'More actions',
  emptyInstalled:'No model providers installed',emptyInstalledDesc:'Install from the catalog below, or upload a package.',
  discover:'Discover more providers',searchPlaceholder:'Search provider name or description',uploadPackage:'Upload package',
  install:'Install',installed:'Installed',modelCount:'{count} models',
  installTitle:'Install model provider',installDescription:'After installing, add your API key and enable the models you need.',
  networkAccess:'Package network access:',installProvider:'Install provider',installing:'Installing…',
  uninstallTitle:'Uninstall model provider?',uninstallDescription:'This uninstalls "{name}" and its model configuration. Saved credentials will be deleted.',uninstallAction:'Uninstall',
  configureTitle:'Configure provider',endpoint:'API endpoint',endpointHint:'Defaults to the provider endpoint; replace for self-hosted or proxy URLs.',
  saveConfig:'Save configuration',saving:'Saving…',cancel:'Cancel',
  credentialsEncrypted:'Credentials are encrypted with system secure storage on this device.',
  modelCatalog:'Model catalog',noModels:'No models yet',addModel:'Add model',modelIdPlaceholder:'Enter a model ID, e.g. qwen3.5-plus',
  modelVision:'Supports image input',removeModel:'Remove',setDefault:'Set default',
  loadFailed:'Unable to load model providers. Restart the app and try again.',
  actionFailed:'Something went wrong. Please try again.',actionFailedDetail:'Action failed: {detail}',
  uploaded:'Package installed: {name}',providerInstalled:'Installed {name}',providerUninstalled:'Uninstalled {name}',
  errProviderAlreadyInstalled:'Provider already installed',errConfigureApiKeyFirst:'Configure and save an API key before enabling models.',
  errDefaultModel:'The default model must be enabled.',errCredentialRequired:'Fill in all required credentials.',
  errCredentialRecovery:'Saved credentials are unreadable. Re-enter them in full.',errUnreachable:'Could not reach the provider. Check the network and endpoint.',
  errInvalidKey:'Invalid API key ({detail})',errValidation:'Credential validation failed ({detail})',errProviderUnavailable:'Provider unavailable ({detail}); try again later.',
  errInvalidPackage:'Invalid package format',errInvalidName:'File name must be piwork-llm-<provider>.zip',errTooLarge:'Package exceeds the size limit',
  errEntry:'Package content is not supported',errProviderJson:'provider.json missing or unreadable',errKeyMismatch:'providerKey does not match the package name',
  errIcon:'Icon not supported',errInvalidDefinition:'Invalid package definition: {detail}',errBusy:'A chat is running. Stop it before changing models.',
  errReadOnly:'This provider has a read-only model catalog',errUnavailable:'Provider unavailable',
 },
} as const;
type Words={[K in keyof (typeof words)['zh-CN']]:string};
type Language='zh-CN'|'en';

function text(value:LocalizedText|undefined,language:Language):string{
 return value?.[language]??value?.en??'';
}
function fill(template:string,params:Record<string,string|number>):string{
 return template.replace(/\{(\w+)\}/g,(_,key)=>String(params[key]??''));
}
function formatContextWindow(value:number):string{
 if(value>=1_000_000)return `${value/1_000_000}M`;
 if(value>=1000)return `${Math.round(value/1000)}K`;
 return String(value);
}

/* 供应商 logo:与 composer 模型菜单同一组静态资源(源自 piwork web public/images/model-providers);
   注意本文件位于 src/ 根,路径前缀与 chat/ 下的组件不同 */
const providerIcons=import.meta.glob<string>('./brand/images/model-providers/*.svg',{eager:true,query:'?url',import:'default'});

function ProviderMark({providerKey,iconDataUrl}: {providerKey:string;iconDataUrl?:string}){
 const icon=iconDataUrl??providerIcons[`./brand/images/model-providers/${providerKey}.svg`];
 if(!icon)return <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-foreground"><BrainCircuitIcon aria-hidden="true" className="size-5"/></div>;
 return <img alt="" aria-hidden="true" className="size-11 shrink-0 rounded-xl" src={icon}/>;
}

function CapabilityTags({models,language}:{models:ProviderModelSpec[];language:Language}){
 const w=words[language];
 return (
  <div className="flex flex-wrap gap-1.5">
   <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">{w.llm}</span>
   {models.some(model=>model.vision)?<span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">{w.vision}</span>:null}
   {models.some(model=>model.toolCall)?<span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">{w.tools}</span>:null}
  </div>
 );
}

function ModelTags({model,language}:{model:ProviderModelSpec;language:Language}){
 const w=words[language];
 return (
  <div className="flex flex-wrap items-center gap-1.5">
   <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">{w.llm}</span>
   <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">{w.chat}</span>
   <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">{formatContextWindow(model.contextSize)}</span>
   {model.vision?<span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">{w.vision}</span>:null}
   {model.toolCall?<span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">{w.tools}</span>:null}
   {model.reasoning?<span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">{w.reasoning}</span>:null}
  </div>
 );
}

function CredentialFields({fields,language,onChange,values}:{fields:ProviderCredentialField[];language:Language;onChange:(variable:string,value:string)=>void;values:Record<string,string>}){
 const w=words[language];
 return (
  <div className="grid gap-4">
   {fields.map(field=>(
    <div className="grid gap-2" key={field.variable}>
     <Label htmlFor={`provider-credential-${field.variable}`}>
      {text(field.label,language)}
      {field.required?<span className="ml-1 text-destructive">*</span>:null}
     </Label>
     <Input
      autoComplete="off"
      id={`provider-credential-${field.variable}`}
      onChange={event=>onChange(field.variable,event.currentTarget.value)}
      placeholder={text(field.placeholder,language)}
      type={field.type==='secret-input'?'password':'text'}
      value={values[field.variable]??''}
     />
    </div>
   ))}
   <div className="flex items-start gap-2 rounded-lg bg-muted/70 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
    <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0"/>
    {w.credentialsEncrypted}
   </div>
  </div>
 );
}

function InstallDialog({item,language,onOpenChange,onInstalled}:{item:ProviderCatalogItem|null;language:Language;onOpenChange:(open:boolean)=>void;onInstalled:()=>Promise<void>}){
 const w=words[language];
 const [installing,setInstalling]=useState(false);
 const install=async()=>{
  if(!item||installing)return;
  setInstalling(true);
  try{
   await window.desktop.installModelProvider(item.packageId);
   toast.success(fill(w.providerInstalled,{name:text(item.name,language)}));
   onOpenChange(false);
   await onInstalled();
  }catch(error){
   toast.error(error instanceof Error&&error.message==='providerAlreadyInstalled'?w.errProviderAlreadyInstalled:w.actionFailed);
  }finally{setInstalling(false)}
 };
 return (
  <Dialog onOpenChange={onOpenChange} open={item!==null}>
   <DialogContent className="max-w-[520px]">
    <DialogHeader>
     <DialogTitle>{w.installTitle}</DialogTitle>
     <DialogDescription>{item?`${text(item.name,language)} v${item.version} · ${fill(w.modelCount,{count:item.models.length})}`:''}</DialogDescription>
    </DialogHeader>
    {item?(
     <div className="grid gap-5 py-2">
      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/25 p-4">
       <ProviderMark providerKey={item.providerKey}/>
       <div className="min-w-0">
        <p className="font-medium text-foreground">{text(item.name,language)}</p>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">{text(item.description,language)}</p>
        <div className="mt-3"><CapabilityTags language={language} models={item.models}/></div>
       </div>
      </div>
      <div className="rounded-xl border border-border bg-muted/25 px-4 py-3 text-sm leading-6 text-muted-foreground">{w.installDescription}</div>
      <p className="text-xs text-muted-foreground">{w.networkAccess}{item.networkHosts.join(', ')}</p>
     </div>
    ):null}
    <DialogFooter>
     <Button disabled={installing} onClick={()=>onOpenChange(false)} variant="outline">{w.cancel}</Button>
     <Button disabled={installing} onClick={install}>{installing?<Spinner/>:null}{installing?w.installing:w.installProvider}</Button>
    </DialogFooter>
   </DialogContent>
  </Dialog>
 );
}

/** openai-compat 的可编辑模型行:增删模型与图片开关(其余供应商目录只读) */
function CustomModelEditor({language,models,onChange}:{language:Language;models:ProviderModelSpec[];onChange:(models:ProviderModelSpec[])=>void}){
 const w=words[language];
 const [draft,setDraft]=useState('');
 const add=()=>{
  const modelId=draft.trim();
  if(!modelId||models.some(model=>model.modelId===modelId))return;
  onChange([...models,{modelId,label:{'zh-CN':modelId,en:modelId},vision:false,reasoning:false,toolCall:true,contextSize:128000,defaultMaxTokens:8192}]);
  setDraft('');
 };
 return (
  <div className="grid gap-3">
   <div className="flex gap-2">
    <Input onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();add()}}} placeholder={w.modelIdPlaceholder} value={draft}/>
    <Button disabled={!draft.trim()} onClick={add} type="button" variant="outline"><PlusIcon/>添加</Button>
   </div>
   {models.length?models.map(model=>(
    <div className="flex items-center gap-3 rounded-xl border border-border bg-background px-3.5 py-2.5" key={model.modelId}>
     <div className="min-w-0 flex-1">
      <p className="truncate font-mono text-sm font-medium">{model.modelId}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{formatContextWindow(model.contextSize)} · {w.chat}</p>
     </div>
     <div className="flex shrink-0 items-center gap-2">
      <Label className="text-xs font-normal text-muted-foreground" htmlFor={`custom-model-vision-${model.modelId}`}>{w.modelVision}</Label>
      <Switch aria-label={w.modelVision} checked={model.vision} id={`custom-model-vision-${model.modelId}`} onCheckedChange={vision=>onChange(models.map(entry=>entry.modelId===model.modelId?{...entry,vision}:entry))}/>
      <Button onClick={()=>onChange(models.filter(entry=>entry.modelId!==model.modelId))} size="icon-sm" title={w.removeModel} type="button" variant="ghost"><Trash2Icon/></Button>
     </div>
    </div>
   )):<p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{w.noModels}</p>}
  </div>
 );
}

/** 模型行精简徽章:上下文/视觉/工具/推理(列表页 ModelTags 保留完整版,弹窗内空间紧凑) */
function ModelFeatureTags({model,language}:{model:ProviderModelSpec;language:Language}){
 const w=words[language];
 const tags=[formatContextWindow(model.contextSize),model.vision?w.vision:null,model.toolCall?w.tools:null,model.reasoning?w.reasoning:null].filter((tag):tag is string=>!!tag);
 return <div className="mt-1 flex flex-wrap items-center gap-1">{tags.map(tag=><span className="rounded border border-border/80 px-1.5 py-px text-[11px] leading-4 text-muted-foreground" key={tag}>{tag}</span>)}</div>;
}

function ConfigureDialog({installation,language,defaultModel,onOpenChange,onSaved}:{installation:ProviderInstallation|null;language:Language;defaultModel:{providerKey:string;modelId:string}|null;onOpenChange:(open:boolean)=>void;onSaved:()=>Promise<void>}){
 const w=words[language];
 const [credentials,setCredentials]=useState<Record<string,string>>({});
 const [enabledModels,setEnabledModels]=useState<string[]>([]);
 const [baseUrl,setBaseUrl]=useState('');
 const [defaultModelId,setDefaultModelId]=useState<string|null>(null);
 const [customModels,setCustomModels]=useState<ProviderModelSpec[]>([]);
 const [saving,setSaving]=useState(false);
 // defaultModel 随刷新换对象身份,经 ref 读取避免重置用户输入
 const defaultModelRef=useRef(defaultModel);
 defaultModelRef.current=defaultModel;
 useEffect(()=>{
  if(!installation)return;
  setCredentials({});setEnabledModels(installation.enabledModels);setBaseUrl(installation.baseUrl);
  setDefaultModelId(defaultModelRef.current?.providerKey===installation.definition.providerKey?defaultModelRef.current.modelId:null);
  setCustomModels(installation.definition.models);
 },[installation]);
 const editable=installation?.source==='openai-compat';
 const requiredFilled=installation?.definition.credentialFields.filter(field=>field.required).every(field=>Boolean(credentials[field.variable]?.trim()))??false;
 const canSave=editable||installation?.credentialsConfigured||requiredFilled;
 const toggleModel=(modelId:string,enabled:boolean)=>{
  setEnabledModels(current=>enabled?[...new Set([...current,modelId])]:current.filter(id=>id!==modelId));
  if(!enabled&&defaultModelId===modelId)setDefaultModelId(null);
 };
 const models=editable?customModels:(installation?.definition.models??[]);
 const switchDisabled=installation?!installation.credentialsConfigured&&!editable&&Object.keys(credentials).length===0:true;
 const save=async()=>{
  if(!installation||saving)return;
  setSaving(true);
  try{
   const dirty=Object.fromEntries(Object.entries(credentials).filter(([,value])=>value.trim()!==''));
   await window.desktop.updateModelProvider(installation.id,{
    baseUrl:baseUrl.trim(),
    ...(editable?{models:customModels}:{}),
    enabledModels,
    ...(Object.keys(dirty).length?{credentials:dirty}:{}),
    defaultModelId,
   });
   onOpenChange(false);
   await onSaved();
  }catch(error){
   toast.error(actionMessage(error,words[language]));
  }finally{setSaving(false)}
 };
 return (
  <Dialog onOpenChange={onOpenChange} open={installation!==null}>
   {/* 固定高度双栏布局:头部/底部固定,左栏凭据、右栏模型目录各自独立滚动 */}
   <DialogContent className="flex h-[min(86dvh,720px)] w-[min(100%-2rem,1000px)] flex-col gap-0 sm:max-w-[1000px]">
    <DialogHeader className="shrink-0 border-b border-border pb-4 pr-10">
     <DialogTitle>{w.configureTitle}{installation?` · ${text(installation.definition.name,language)}`:''}</DialogTitle>
     <DialogDescription className="line-clamp-2">{installation?text(installation.definition.description,language):''}</DialogDescription>
    </DialogHeader>
    {installation?(
     <div className="grid min-h-0 flex-1 gap-6 overflow-hidden py-4 md:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
      <div className="grid min-h-0 content-start gap-5 overflow-y-auto pr-1">
       <div className="grid gap-2">
        <Label htmlFor="provider-endpoint">{w.endpoint}</Label>
        <Input id="provider-endpoint" onChange={event=>setBaseUrl(event.target.value)} placeholder={installation.definition.baseUrl} type="url" value={baseUrl}/>
        <p className="text-xs leading-5 text-muted-foreground">{w.endpointHint}</p>
       </div>
       <CredentialFields fields={installation.definition.credentialFields} language={language} onChange={(variable,value)=>setCredentials(current=>({...current,[variable]:value}))} values={credentials}/>
       {installation.definition.helpUrl?(
        <a className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" href={installation.definition.helpUrl} onClick={event=>{event.preventDefault();void window.desktop.openExternalUrl(installation.definition.helpUrl!)}} target="_blank" rel="noreferrer">
         <CircleHelpIcon aria-hidden="true" className="size-3.5"/>{text(installation.definition.name,language)} · API Key
        </a>
       ):null}
      </div>
      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2">
       <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{w.modelCatalog}</p>
        <p className="text-xs text-muted-foreground">{fill(w.enabledModelCount,{enabled:enabledModels.length,total:models.length})}</p>
       </div>
       {editable
        ?<div className="min-h-0 overflow-y-auto pr-1">
         <CustomModelEditor language={language} models={customModels} onChange={next=>{setCustomModels(next);const ids=new Set(next.map(model=>model.modelId));setEnabledModels(current=>current.filter(id=>ids.has(id)));if(defaultModelId&&!ids.has(defaultModelId))setDefaultModelId(null)}}/>
        </div>
        :<div className="min-h-0 overflow-y-auto rounded-xl border border-border bg-background">
         {models.map(model=>{
          const enabled=enabledModels.includes(model.modelId);
          const isDefault=defaultModelId===model.modelId;
          return (
           <div className="flex items-center gap-3 border-b border-border/70 px-4 py-2.5 last:border-b-0" key={model.modelId}>
            <div className="min-w-0 flex-1">
             <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-medium">{text(model.label,language)||model.modelId}</p>
              {isDefault?<Badge className="shrink-0" variant="secondary">{w.defaultBadge}</Badge>:null}
             </div>
             <p className="truncate font-mono text-[11px] leading-4 text-muted-foreground">{model.modelId}</p>
             <ModelFeatureTags language={language} model={model}/>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
             {enabled?(
              <Button onClick={()=>setDefaultModelId(model.modelId)} size="sm" type="button" variant={isDefault?'default':'outline'}>
               {isDefault?<CheckIcon/>:null}{w.setDefault}
              </Button>
             ):null}
             <Switch aria-label={model.modelId} checked={enabled} disabled={switchDisabled} onCheckedChange={checked=>toggleModel(model.modelId,checked)}/>
            </div>
           </div>
          );
         })}
        </div>}
      </div>
     </div>
    ):<div className="flex-1"/>}
    <DialogFooter className="shrink-0 border-t border-border pt-4">
     <Button disabled={saving} onClick={()=>onOpenChange(false)} variant="outline">{w.cancel}</Button>
     <Button disabled={saving||!canSave} onClick={save}>{saving?<Spinner/>:null}{saving?w.saving:w.saveConfig}</Button>
    </DialogFooter>
   </DialogContent>
  </Dialog>
 );
}

/** 主进程错误 → 本地文案;先剥离 Electron IPC 的多层包装
    ("Error invoking remote method 'x': Error: 原始信息")取最内层 */
/** detail 形如 "(HTTP 401 Not Authorized)",文案模板自带括号,剥掉外层避免双括号 */
function stripDetail(message:string,prefix:string):string{
 return message.slice(prefix.length).trim().replace(/^\((.*)\)$/,'$1');
}
function actionMessage(error:unknown,w:Words):string{
 const raw=error instanceof Error?error.message:String(error);
 const message=raw.split(/\s*Error:\s*/).map(part=>part.trim()).filter(Boolean).at(-1)??raw;
 if(message==='Session busy')return w.errBusy;
 if(message==='providerAlreadyInstalled')return w.errProviderAlreadyInstalled;
 if(message==='configureApiKeyFirst')return w.errConfigureApiKeyFirst;
 if(message==='defaultModelMustBeEnabled')return w.errDefaultModel;
 if(message==='credentialRequired')return w.errCredentialRequired;
 if(message==='credentialRecoveryRequired')return w.errCredentialRecovery;
 if(message==='validationUnreachable')return w.errUnreachable;
 if(message==='Secure storage unavailable')return w.errCredentialRecovery;
 if(message.startsWith('invalidApiKey'))return fill(w.errInvalidKey,{detail:stripDetail(message,'invalidApiKey')});
 if(message.startsWith('validationFailed'))return fill(w.errValidation,{detail:stripDetail(message,'validationFailed')});
 if(message.startsWith('providerUnavailable'))return fill(w.errProviderUnavailable,{detail:stripDetail(message,'providerUnavailable')});
 if(message==='invalidPackage'||message==='invalidPackageSize'||message.startsWith('Invalid model providers'))return w.errInvalidPackage;
 if(message==='invalidPackageName')return w.errInvalidName;
 if(message==='unsafePath'||message==='tooManyEntries'||message==='fileTooLarge'||message==='unexpectedEntry')return w.errEntry;
 if(message==='providerJsonMissing'||message==='providerJsonInvalid')return w.errProviderJson;
 if(message==='providerKeyMismatch')return w.errKeyMismatch;
 if(message==='iconTooLarge'||message==='iconInvalid')return w.errIcon;
 if(message==='Model catalog is read-only')return w.errReadOnly;
 if(message==='Provider unavailable'||message==='Model provider unavailable')return w.errUnavailable;
 // validateProviderDefinition 的可读校验消息(英文句子)
 if(/^(baseUrl|packageId|providerKey|version|localized|model |credential|compat|networkHosts|models|duplicate|Duplicate|Unknown|Too many|Invalid)/.test(message))return fill(w.errInvalidDefinition,{detail:message});
 // 兜底展示原始详情,避免被「操作失败」掩盖真实原因(如网络/文件系统错误)
 return fill(w.actionFailedDetail,{detail:message});
}

export function ModelProviders({language,account,modelSource,onModelSourceChange,onOpenAccount}:{language:Language;account:AccountStatus|null;modelSource:ModelSource|undefined;onModelSourceChange:(value:ModelSource)=>void;onOpenAccount:()=>void}){
 const w=words[language];
 const [view,setView]=useState<ModelProvidersView|null>(null);
 const [loadError,setLoadError]=useState(false);
 const [query,setQuery]=useState('');
 const [installTarget,setInstallTarget]=useState<ProviderCatalogItem|null>(null);
 const [configureTarget,setConfigureTarget]=useState<ProviderInstallation|null>(null);
 const [deleteTarget,setDeleteTarget]=useState<ProviderInstallation|null>(null);
 const [busyId,setBusyId]=useState<string|null>(null);
 const refresh=useCallback(async()=>{
  const next=await window.desktop.getModelProviders();
  setView(next);
 },[]);
 useEffect(()=>{void refresh().catch(()=>setLoadError(true))},[refresh]);
 useEffect(()=>window.desktop.onModelProvidersChanged(()=>{void refresh().catch(()=>{})}),[refresh]);

 const effectiveSource:ModelSource=modelSource??(account?.models.length?'account':'custom');
 const customDefaultEntry=useMemo(()=>{
  const target=view?.defaultModel;
  if(!target)return null;
  const installation=view.installations.find(item=>item.definition.providerKey===target.providerKey);
  const model=installation?.definition.models.find(entry=>entry.modelId===target.modelId);
  return installation&&model?{installation,model}:null;
 },[view]);
 const needle=query.trim().toLocaleLowerCase();
 const catalog=(view?.catalog??[]).filter(item=>!needle||`${text(item.name,language)} ${text(item.description,language)}`.toLocaleLowerCase().includes(needle));

 const toggleModel=useCallback(async(installation:ProviderInstallation,modelId:string,enabled:boolean)=>{
  setBusyId(`${installation.id}:${modelId}`);
  try{
   const enabledModels=enabled?[...new Set([...installation.enabledModels,modelId])]:installation.enabledModels.filter(id=>id!==modelId);
   await window.desktop.updateModelProvider(installation.id,{enabledModels});
   await refresh();
  }catch(error){toast.error(actionMessage(error,words[language]))}
  finally{setBusyId(null)}
 },[language,refresh]);
 const toggleProvider=useCallback(async(installation:ProviderInstallation)=>{
  setBusyId(installation.id);
  try{
   await window.desktop.updateModelProvider(installation.id,{enabled:!installation.enabled});
   await refresh();
  }catch(error){toast.error(actionMessage(error,words[language]))}
  finally{setBusyId(null)}
 },[language,refresh]);
 const uninstall=useCallback(async()=>{
  if(!deleteTarget)return;
  setBusyId(deleteTarget.id);
  try{
   await window.desktop.removeModelProvider(deleteTarget.id);
   toast.success(fill(w.providerUninstalled,{name:text(deleteTarget.definition.name,language)}));
   setDeleteTarget(null);
   await refresh();
  }catch(error){toast.error(actionMessage(error,w))}
  finally{setBusyId(null)}
 },[deleteTarget,language,refresh,w]);
 const upload=useCallback(async()=>{
  try{
   const next=await window.desktop.uploadModelProvider();
   const installed=next.installations.at(-1);
   if(installed)toast.success(fill(w.uploaded,{name:text(installed.definition.name,language)}));
   setView(next);
  }catch(error){
   if(error instanceof Error&&error.message==='Canceled')return;
   toast.error(actionMessage(error,w));
  }
 },[language,w]);

 const sourceCard=(value:ModelSource,title:string,desc:string,status:React.ReactNode)=>(
  <button
   aria-pressed={effectiveSource===value}
   className={cn('flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-colors',effectiveSource===value?'border-primary/40 bg-primary/5':'border-border hover:bg-muted/50')}
   onClick={()=>onModelSourceChange(value)}
   type="button"
  >
   <span className="flex items-center gap-2 text-sm font-medium text-foreground">
    {effectiveSource===value?<CheckIcon aria-hidden="true" className="size-4 text-primary"/>:null}
    {title}
   </span>
   <span className="text-[13px] leading-5 text-muted-foreground">{desc}</span>
   {status}
  </button>
 );

 return (
  <div className="flex flex-col gap-5">
   <section className="overflow-hidden rounded-2xl border border-border bg-card">
    <div className="border-b border-border px-5 py-4">
     <h2 className="text-base font-semibold">{w.sourceTitle}</h2>
     <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{w.sourceDesc}</p>
    </div>
    <div className="grid gap-3 px-5 py-4 md:grid-cols-2">
     {sourceCard('account',w.sourceAccount,w.sourceAccountDesc,account?.user?(
      <span className="text-xs text-muted-foreground">
       {fill(w.accountSignedIn,{count:account.models.length})}
       {account.defaultModelId&&account.models.some(model=>model.id===account.defaultModelId)?` · ${fill(w.accountDefault,{name:account.models.find(model=>model.id===account.defaultModelId)?.name??account.defaultModelId})}`:''}
      </span>
     ):(
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
       {w.accountSignedOut}
       <Button onClick={event=>{event.stopPropagation();onOpenAccount()}} size="sm" type="button" variant="outline">{w.signIn}</Button>
      </span>
     ))}
     {sourceCard('custom',w.sourceCustom,w.sourceCustomDesc,customDefaultEntry?(
      <span className="text-xs text-muted-foreground">{fill(w.customDefault,{name:`${text(customDefaultEntry.installation.definition.name,language)} / ${text(customDefaultEntry.model.label,language)||customDefaultEntry.model.modelId}`})}</span>
     ):(
      <span className="text-xs text-muted-foreground">{w.customDefaultNone}</span>
     ))}
    </div>
   </section>

   <section className="overflow-hidden rounded-2xl border border-border bg-card">
    <div className="flex items-center justify-between border-b border-border px-5 py-4">
     <h2 className="text-base font-semibold">{fill(w.installedProviders,{count:view?.installations.length??0})}</h2>
     <Button
      disabled={!view?.installations.some(item=>item.credentialsConfigured)}
      onClick={()=>setConfigureTarget(view?.installations.find(item=>view?.defaultModel?.providerKey===item.definition.providerKey)??view?.installations.find(item=>item.credentialsConfigured)??null)}
      size="sm"
      variant="outline"
     >
      <Settings2Icon/>{w.defaultModel}
     </Button>
    </div>
    {view?.installations.length?(
     <div className="divide-y divide-border">
      {view.installations.map(item=>{
       const isDefaultProvider=view.defaultModel?.providerKey===item.definition.providerKey;
       return (
        <article key={item.id}>
         <div className="grid gap-4 px-5 py-4 xl:grid-cols-[minmax(240px,1.4fr)_minmax(160px,.8fr)_auto] xl:items-center">
          <div className="flex min-w-0 items-start gap-3">
           <ProviderMark iconDataUrl={item.iconDataUrl} providerKey={item.definition.providerKey}/>
           <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
             <p className="font-medium">{text(item.definition.name,language)}</p>
             <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">v{item.definition.version}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">{text(item.definition.description,language)}</p>
           </div>
          </div>
          <div>
           <CapabilityTags language={language} models={item.definition.models}/>
           <p className="mt-2 text-xs text-muted-foreground">{fill(w.enabledModelCount,{enabled:item.enabledModels.length,total:item.definition.models.length})}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
           <div className="mr-1 text-left xl:text-right">
            <p className={cn('text-xs font-medium',item.credentialsConfigured&&item.credentialReadable!==false&&item.enabled?'text-emerald-600 dark:text-emerald-400':'text-muted-foreground')}>
             {item.credentialsConfigured
              ?item.credentialReadable===false
               ?w.credentialsUnreadable
               :item.enabled
                ?w.healthy
                :w.disabled
              :item.source==='openai-compat'&&item.enabledModels.length
               ?w.healthy
               :w.apiKeyRequired}
            </p>
            {!item.credentialsConfigured&&item.source!=='openai-compat'?<p className="mt-0.5 text-[11px] text-muted-foreground">{w.modelsUnlockAfterSetup}</p>:null}
           </div>
           <Button onClick={()=>setConfigureTarget(item)} size="sm" variant={item.credentialsConfigured||item.source==='openai-compat'?'outline':'default'}>
            <KeyRoundIcon/>{item.credentialsConfigured||item.source==='openai-compat'?w.configure:w.addApiKey}
           </Button>
           <DropdownMenu>
            <DropdownMenuTrigger asChild>
             <Button aria-label={w.more} disabled={busyId===item.id} size="icon-sm" variant="ghost">
              {busyId===item.id?<Spinner/>:<MoreHorizontalIcon/>}
             </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
             <DropdownMenuItem disabled={!item.credentialsConfigured&&item.source!=='openai-compat'} onClick={()=>void toggleProvider(item)}>
              <WrenchIcon/>{item.enabled?w.disable:w.enable}
             </DropdownMenuItem>
             {item.source!=='openai-compat'?<><DropdownMenuSeparator/><DropdownMenuItem onClick={()=>setDeleteTarget(item)} variant="destructive"><Trash2Icon/>{w.uninstall}</DropdownMenuItem></>:null}
            </DropdownMenuContent>
           </DropdownMenu>
          </div>
         </div>
         <div className="border-t border-border/70 bg-muted/15 px-5 py-3">
          <Collapsible defaultOpen={false}>
           <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-1.5 rounded-md text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180"/>
            {fill(w.pluginModels,{count:item.definition.models.length})}
           </CollapsibleTrigger>
           <CollapsibleContent>
            <div className="mt-2 overflow-hidden rounded-xl border border-border bg-background">
             {item.definition.models.map(model=>{
              const modelEnabled=item.enabledModels.includes(model.modelId);
              const modelBusy=busyId===`${item.id}:${model.modelId}`;
              return (
               <div className="flex flex-col gap-3 border-b border-border/70 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center" key={model.modelId}>
                <div className="min-w-0 flex-1">
                 <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{text(model.label,language)||model.modelId}</p>
                  {isDefaultProvider&&view.defaultModel?.modelId===model.modelId?<Badge variant="secondary">{w.defaultBadge}</Badge>:null}
                 </div>
                 <div className="mt-1.5"><ModelTags language={language} model={model}/></div>
                </div>
                {modelBusy?<Spinner/>:<Switch aria-label={model.modelId} checked={modelEnabled} disabled={!item.credentialsConfigured&&item.source!=='openai-compat'} onCheckedChange={checked=>void toggleModel(item,model.modelId,checked)}/>}
               </div>
              );
             })}
            </div>
           </CollapsibleContent>
          </Collapsible>
         </div>
        </article>
       );
      })}
     </div>
    ):loadError?(
     <div className="px-5 py-10 text-center"><BrainCircuitIcon aria-hidden="true" className="mx-auto size-8 text-muted-foreground"/><p className="mt-3 text-sm text-muted-foreground">{w.loadFailed}</p></div>
    ):(
     <div className="px-5 py-10 text-center"><BrainCircuitIcon aria-hidden="true" className="mx-auto size-8 text-muted-foreground"/><p className="mt-3 text-sm font-medium">{w.emptyInstalled}</p><p className="mt-1 text-[13px] text-muted-foreground">{w.emptyInstalledDesc}</p></div>
    )}
   </section>

   <section className="overflow-hidden rounded-2xl border border-border bg-card">
    <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
     <h2 className="text-base font-semibold">{w.discover}</h2>
     <div className="flex items-center gap-2">
      <div className="relative">
       <SearchIcon aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/>
       <Input aria-label={w.discover} className="w-full pl-9 sm:w-64" onChange={event=>setQuery(event.target.value)} placeholder={w.searchPlaceholder} type="search" value={query}/>
      </div>
      <Button onClick={()=>void upload()} size="sm" variant="outline"><UploadIcon/>{w.uploadPackage}</Button>
     </div>
    </div>
    <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
     {catalog.map(item=>(
      <article className="flex flex-col overflow-hidden rounded-xl border border-border p-4" key={item.packageId}>
       <div className="flex items-start gap-3">
        <ProviderMark providerKey={item.providerKey}/>
        <div className="min-w-0">
         <p className="font-medium">{text(item.name,language)}</p>
         <p className="mt-0.5 text-xs text-muted-foreground">v{item.version} · {fill(w.modelCount,{count:item.models.length})}</p>
        </div>
       </div>
       <p className="mt-3 line-clamp-3 flex-1 text-sm leading-5 text-muted-foreground">{text(item.description,language)}</p>
       <Button className="mt-4 w-full" disabled={item.installed} onClick={()=>setInstallTarget(item)} variant={item.installed?'ghost':'outline'}>
        {item.installed?<><CheckIcon/>{w.installed}</>:w.install}
       </Button>
      </article>
     ))}
     {!catalog.length&&!needle?(
      <div className="col-span-full flex flex-col items-center gap-2 px-4 py-8 text-center">
       <GlobeIcon aria-hidden="true" className="size-6 text-muted-foreground"/>
       <p className="text-sm text-muted-foreground">{w.emptyInstalledDesc}</p>
       <Button onClick={()=>void upload()} size="sm" variant="outline"><UploadIcon/>{w.uploadPackage}</Button>
      </div>
     ):null}
    </div>
   </section>

   <InstallDialog item={installTarget} language={language} onInstalled={refresh} onOpenChange={open=>{if(!open)setInstallTarget(null)}}/>
   <ConfigureDialog defaultModel={view?.defaultModel??null} installation={configureTarget} language={language} onOpenChange={open=>{if(!open)setConfigureTarget(null)}} onSaved={refresh}/>
   <Dialog onOpenChange={open=>{if(!open)setDeleteTarget(null)}} open={deleteTarget!==null}>
    <DialogContent className="max-w-[440px]">
     <DialogHeader>
      <DialogTitle>{w.uninstallTitle}</DialogTitle>
      <DialogDescription>{deleteTarget?fill(w.uninstallDescription,{name:text(deleteTarget.definition.name,language)}):''}</DialogDescription>
     </DialogHeader>
     <DialogFooter>
      <Button disabled={busyId===deleteTarget?.id} onClick={()=>setDeleteTarget(null)} variant="outline">{w.cancel}</Button>
      <Button disabled={busyId===deleteTarget?.id} onClick={()=>void uninstall()} variant="destructive">{busyId===deleteTarget?.id?<Spinner/>:null}{w.uninstallAction}</Button>
     </DialogFooter>
    </DialogContent>
   </Dialog>
  </div>
 );
}
