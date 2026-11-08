import {useEffect,useRef,useState} from 'react';
import {ArrowLeftIcon,CheckIcon,ChevronDownIcon,GlobeIcon,InfoIcon,LayersIcon,PaintbrushIcon,PlugIcon,PuzzleIcon,SearchIcon,Settings2Icon,UserRoundIcon} from 'lucide-react';
import {cn} from '@/lib/utils';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Switch} from '@/components/ui/switch';
import {Account} from './account';
import {SyncSettings} from './sync-settings';
import {PiPackages} from './pi-packages';
import {AppUpdatePanel} from './app-update';
import {McpServices} from './mcp';
import {PiLogo} from './brand/pi-logo';
import type {AccountStatus,Appearance,GatewayConfig,Language,McpServer,Preferences} from '../shared/types';

export type SettingsSectionId='general'|'account'|'gateway'|'mcp'|'plugins'|'about';

/** 桌面端设置页自研文案(不使用 Web 同步的 i18n 词库,仿 pi-packages.tsx 模式) */
const words={
 'zh-CN':{
  settingsTitle:'设置',backToApp:'返回应用',search:'搜索设置',noMatches:'没有匹配的设置',
  groupAccount:'账户',groupApp:'应用',groupAbout:'关于',
  general:'通用',generalSubtitle:'配置应用的基础偏好。',
  accountAndSync:'账号与同步',accountSubtitle:'管理 PiWork 账号登录与对话同步。',
  modelGateway:'模型网关',gatewaySubtitle:'配置自定义 OpenAI 兼容网关,用于对话模型调用。',
  mcpServices:'MCP 服务',mcpSubtitle:'管理 MCP 服务接入配置;启用的服务可在对话中绑定使用。',
  piPlugins:'插件管理',pluginsSubtitle:'浏览、安装与卸载 pi 插件。',
  about:'关于 PiWork',aboutSubtitle:'版本与应用信息。',
  appearance:'外观',appearanceDesc:'设置主题(浅色、深色、跟随系统)。',
  language:'语言',languageDesc:'设置界面显示语言。',
  system:'跟随系统',light:'浅色',dark:'深色',
  gateway:'自定义模型网关',gatewayUrl:'网关地址',modelId:'模型 ID',apiKey:'API Key',imageSupport:'模型支持图片输入',keyHint:'已保存；留空保持不变',save:'保存',gatewaySaved:'网关配置已保存',gatewayFail:'保存失败，请检查地址和系统安全存储。',
  version:'版本',aboutDesc:'PiWork 桌面端:本地项目、对话、文档与定时任务工作区。',
 },
 en:{
  settingsTitle:'Settings',backToApp:'Back to app',search:'Search settings',noMatches:'No matching settings',
  groupAccount:'Account',groupApp:'App',groupAbout:'About',
  general:'General',generalSubtitle:'Configure basic app preferences.',
  accountAndSync:'Account & sync',accountSubtitle:'Manage your PiWork account sign-in and conversation sync.',
  modelGateway:'Model gateway',gatewaySubtitle:'Configure a custom OpenAI-compatible gateway for chat models.',
  mcpServices:'MCP services',mcpSubtitle:'Manage MCP service configurations. Enabled services can be attached in chats.',
  piPlugins:'Plugins',pluginsSubtitle:'Browse, install and uninstall pi plugins.',
  about:'About PiWork',aboutSubtitle:'Version and app information.',
  appearance:'Appearance',appearanceDesc:'Set the theme (light, dark or match your system).',
  language:'Language',languageDesc:'Set the interface display language.',
  system:'System',light:'Light',dark:'Dark',
  gateway:'Custom model gateway',gatewayUrl:'Gateway URL',modelId:'Model ID',apiKey:'API key',imageSupport:'Model supports image input',keyHint:'Saved; leave blank to keep',save:'Save',gatewaySaved:'Gateway saved',gatewayFail:'Could not save. Check the URL and system secure storage.',
  version:'Version',aboutDesc:'PiWork desktop: a workspace for local projects, chats, documents and scheduled tasks.',
 },
} as const;
type NavItem={id:SettingsSectionId;label:string;subtitle:string;icon:typeof UserRoundIcon;keywords:string};

export function SettingsPage({lang,prefs,onChangePrefs,onLocalPrefs,account,onAccountChanged,gateway,onSaveGateway,onMcpChanged,onOpenWebHistory,onClose,section,onSectionChange}:{lang:'zh-CN'|'en';prefs:Preferences;onChangePrefs:(value:Preferences)=>void;onLocalPrefs:(value:Preferences)=>void;account:AccountStatus|null;onAccountChanged:(status:AccountStatus|null)=>void;gateway:GatewayConfig|null;onSaveGateway:(input:{baseUrl:string;modelId:string;apiKey:string;supportsImages?:boolean})=>Promise<GatewayConfig>;onMcpChanged:(servers:McpServer[])=>void;onOpenWebHistory:()=>void;onClose:()=>void;section:SettingsSectionId;onSectionChange:(id:SettingsSectionId)=>void}){
 const t=words[lang];
 const [query,setQuery]=useState('');
 const searchRef=useRef<HTMLInputElement|null>(null);
 const mainRef=useRef<HTMLElement|null>(null);
 // 网关表单状态由设置页自持:打开设置时从已保存配置初始化一次,保存成功后不覆盖输入
 const [gatewayUrl,setGatewayUrl]=useState('');const [modelId,setModelId]=useState('');const [apiKey,setApiKey]=useState('');const [supportsImages,setSupportsImages]=useState(false);const [gatewayMessage,setGatewayMessage]=useState('');
 const gatewayLoaded=useRef(false);
 const [version,setVersion]=useState('');
 useEffect(()=>{if(gatewayLoaded.current||!gateway)return;gatewayLoaded.current=true;setGatewayUrl(gateway.baseUrl);setModelId(gateway.modelId);setSupportsImages(gateway.supportsImages===true)},[gateway]);
 useEffect(()=>{void window.desktop.appVersion().then(setVersion).catch(()=>{})},[]);
 // ⌘F 聚焦设置搜索(设置页挂载期间接管,不与主应用 ⌘K 冲突)
 useEffect(()=>{const key=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='f'){event.preventDefault();searchRef.current?.focus()}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[]);
 // 切换分区后内容回到顶部
 useEffect(()=>{mainRef.current?.scrollTo(0,0)},[section]);
 async function saveGateway(e:React.FormEvent){e.preventDefault();try{await onSaveGateway({baseUrl:gatewayUrl,modelId,apiKey,supportsImages});setApiKey('');setGatewayMessage(t.gatewaySaved)}catch{setGatewayMessage(t.gatewayFail)}}
 const accountLabel=account?.user?.email||account?.user?.name;
 const groups:{label:string;items:NavItem[]}[]=[
  {label:t.groupAccount,items:[{id:'account',label:t.accountAndSync,subtitle:t.accountSubtitle,icon:UserRoundIcon,keywords:'login server sync 登录 同步'}]},
  {label:t.groupApp,items:[
   {id:'general',label:t.general,subtitle:t.generalSubtitle,icon:Settings2Icon,keywords:`${t.appearance} ${t.language} theme 主题 外观 语言`},
   {id:'gateway',label:t.modelGateway,subtitle:t.gatewaySubtitle,icon:LayersIcon,keywords:'model api gateway 模型 网关'},
   {id:'mcp',label:t.mcpServices,subtitle:t.mcpSubtitle,icon:PlugIcon,keywords:'mcp server service 服务 工具 接入'},
   {id:'plugins',label:t.piPlugins,subtitle:t.pluginsSubtitle,icon:PuzzleIcon,keywords:'plugin package 插件'},
  ]},
  {label:t.groupAbout,items:[{id:'about',label:t.about,subtitle:t.aboutSubtitle,icon:InfoIcon,keywords:'version update 版本 更新'}]},
 ];
 const allItems=groups.flatMap(group=>group.items);
 const needle=query.trim().toLocaleLowerCase();
 const matches=needle?allItems.filter(item=>`${item.label} ${item.subtitle} ${item.keywords}`.toLocaleLowerCase().includes(needle)):[];
 const navButton=(item:NavItem)=>(
  <button
   aria-current={section===item.id?'true':undefined}
   className={cn('flex min-h-10 w-full items-center gap-3 rounded-[10px] px-3 text-[14px] leading-5 outline-none transition-colors duration-150',section===item.id?'bg-sidebar-accent font-medium text-sidebar-accent-foreground':'text-sidebar-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground')}
   key={item.id}
   onClick={()=>{onSectionChange(item.id);setQuery('')}}
   type="button"
  >
   <item.icon aria-hidden="true" className="size-[17px] shrink-0"/>
   <span className="truncate">{item.label}</span>
  </button>
 );
 const header=(title:string,subtitle:string)=>(
  <div>
   <h1 className="text-[28px] font-semibold leading-9 tracking-tight text-foreground">{title}</h1>
   <p className="mt-1.5 text-[15px] leading-6 text-muted-foreground">{subtitle}</p>
  </div>
 );
 return <div className="settings-page flex h-dvh w-full flex-row overflow-hidden bg-background text-foreground">
  <aside className="flex h-full w-75 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar">
   <div className="drag shrink-0"/>
   <button
    className="group mx-3 flex min-h-10 shrink-0 items-center gap-3 rounded-[10px] px-3 text-left text-[14px] leading-5 text-foreground transition-colors duration-150 hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground"
    onClick={onClose}
    type="button"
   >
    <ArrowLeftIcon aria-hidden="true" className="size-[18px] shrink-0 text-muted-foreground transition-all group-hover:-translate-x-0.5 group-hover:text-foreground"/>
    <span>{t.backToApp}</span>
   </button>
   <div className="mx-3 mt-2 shrink-0">
    <div className="relative">
     <SearchIcon aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/>
     <input
      aria-label={t.search}
      className="h-9 w-full rounded-[10px] border border-sidebar-border bg-sidebar-accent/40 pl-9 pr-12 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/40"
      onChange={event=>setQuery(event.target.value)}
      onKeyDown={event=>{if(event.key==='Escape'){setQuery('');event.currentTarget.blur()}}}
      placeholder={t.search}
      ref={searchRef}
      type="search"
      value={query}
     />
     <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-sidebar-border bg-background px-1.5 py-0.5 font-sans text-[11px] leading-4 text-muted-foreground">⌘F</kbd>
    </div>
   </div>
   <nav aria-label={t.settingsTitle} className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-5">
    {needle
     ?matches.length
      ?<div className="grid gap-1">{matches.map(navButton)}</div>
      :<p className="px-3 pt-4 text-[13px] leading-5 text-muted-foreground">{t.noMatches}</p>
     :groups.map(group=>(
      <div key={group.label}>
       <div className="px-3 pb-1 pt-4 text-[12px] font-medium leading-4 text-muted-foreground">{group.label}</div>
       <div className="grid gap-1">{group.items.map(navButton)}</div>
      </div>
     ))}
   </nav>
   {accountLabel?<div className="shrink-0 p-3"><div className="flex h-10 items-center gap-2 overflow-hidden rounded-md px-2"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/12 text-[12px] font-medium text-primary"><UserRoundIcon aria-hidden="true" className="size-4"/></span><span className="truncate text-sm">{accountLabel}</span></div></div>:null}
  </aside>
  <main aria-label={t.settingsTitle} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-6 py-10 sm:px-10" ref={mainRef}>
   {section==='general'?<div className="mx-auto max-w-2xl pb-12">
    {header(t.general,t.generalSubtitle)}
    <div className="mt-7 divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card">
     <div className="flex flex-col items-stretch justify-between gap-4 px-5 py-5 sm:flex-row sm:items-center">
      <div className="flex items-start gap-3.5">
       <PaintbrushIcon aria-hidden="true" className="mt-0.5 size-[22px] shrink-0 text-muted-foreground"/>
       <div>
        <h3 className="text-[15px] font-medium leading-5 text-foreground">{t.appearance}</h3>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{t.appearanceDesc}</p>
       </div>
      </div>
      <div className="grid w-full shrink-0 grid-cols-3 overflow-hidden rounded-[10px] border border-border bg-background p-0.5 sm:w-[288px]">
       {([{value:'light',label:t.light},{value:'dark',label:t.dark},{value:'system',label:t.system}] as const).map(option=>{
        const active=prefs.appearance===option.value;
        return <button
         aria-pressed={active}
         className={cn('flex h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-sm transition-colors sm:h-8',active?'bg-link-soft text-link':'text-muted-foreground hover:bg-muted hover:text-foreground')}
         key={option.value}
         onClick={()=>onChangePrefs({...prefs,appearance:option.value as Appearance})}
         type="button"
         value={option.value}
        >
         {active?<CheckIcon aria-hidden="true" className="size-3.5"/>:null}
         {option.label}
        </button>;
       })}
      </div>
     </div>
     <div className="flex flex-col items-stretch justify-between gap-4 px-5 py-5 sm:flex-row sm:items-center">
      <div className="flex items-start gap-3.5">
       <GlobeIcon aria-hidden="true" className="mt-0.5 size-[22px] shrink-0 text-muted-foreground"/>
       <div>
        <h3 className="text-[15px] font-medium leading-5 text-foreground">{t.language}</h3>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{t.languageDesc}</p>
       </div>
      </div>
      <label className="relative shrink-0">
       <span className="sr-only">{t.language}</span>
       <select
        className="h-11 w-full appearance-none rounded-[10px] border border-border bg-background py-0 pl-3 pr-9 text-sm text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 sm:h-9 sm:w-[170px]"
        onChange={e=>onChangePrefs({...prefs,language:e.target.value as Language})}
        value={prefs.language}
       >
        <option value="system">{t.system}</option>
        <option value="zh-CN">简体中文</option>
        <option value="en">English</option>
       </select>
       <ChevronDownIcon aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/>
      </label>
     </div>
    </div>
   </div>
   :section==='account'?<div className="mx-auto max-w-2xl pb-12">
    {header(t.accountAndSync,t.accountSubtitle)}
    <div className="mt-7 flex flex-col gap-4">
     <Account language={lang} onOpenHistory={onOpenWebHistory} onChanged={onAccountChanged}/>
     <SyncSettings language={lang} preferences={prefs} onChanged={onLocalPrefs}/>
    </div>
   </div>
   :section==='gateway'?<div className="mx-auto max-w-2xl pb-12">
    {header(t.modelGateway,t.gatewaySubtitle)}
    <form className="mt-7 overflow-hidden rounded-[14px] border border-border bg-card" onSubmit={saveGateway}>
     <div className="divide-y divide-border">
      <div className="flex flex-col gap-2 px-5 py-4">
       <Label htmlFor="settings-gateway-url">{t.gatewayUrl}</Label>
       <Input id="settings-gateway-url" onChange={e=>setGatewayUrl(e.target.value)} placeholder="https://example.com/v1" required type="url" value={gatewayUrl}/>
      </div>
      <div className="flex flex-col gap-2 px-5 py-4">
       <Label htmlFor="settings-gateway-model">{t.modelId}</Label>
       <Input id="settings-gateway-model" onChange={e=>setModelId(e.target.value)} required value={modelId}/>
      </div>
      <div className="flex flex-col gap-2 px-5 py-4">
       <Label htmlFor="settings-gateway-key">{t.apiKey}</Label>
       <Input autoComplete="off" id="settings-gateway-key" onChange={e=>setApiKey(e.target.value)} placeholder={gateway?.hasApiKey&&gateway.baseUrl===gatewayUrl.trim().replace(/\/$/,'')?t.keyHint:''} type="password" value={apiKey}/>
      </div>
      <div className="flex items-center justify-between gap-4 px-5 py-4">
       <Label htmlFor="settings-gateway-images">{t.imageSupport}</Label>
       <Switch aria-label={t.imageSupport} checked={supportsImages} id="settings-gateway-images" onCheckedChange={setSupportsImages}/>
      </div>
      <div className="flex items-center justify-between gap-4 px-5 py-4">
       {gatewayMessage?<p className="text-[13px] leading-5 text-muted-foreground" role="status">{gatewayMessage}</p>:<span/>}
       <Button type="submit">{t.save}</Button>
      </div>
     </div>
    </form>
   </div>
   :section==='mcp'?<div className="mx-auto max-w-3xl pb-12">
    {header(t.mcpServices,t.mcpSubtitle)}
    <div className="mt-7">
     <McpServices language={lang} onChanged={onMcpChanged}/>
    </div>
   </div>
   :section==='plugins'?<div className="mx-auto max-w-3xl pb-12">
    {header(t.piPlugins,t.pluginsSubtitle)}
    <div className="mt-7">
     <PiPackages language={lang}/>
    </div>
   </div>
   :<div className="mx-auto max-w-2xl pb-12">
    {header(t.about,t.aboutSubtitle)}
    <div className="mt-7 divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card">
     <div className="flex items-center gap-4 px-5 py-6">
      <PiLogo aria-hidden="true" className="size-12 shrink-0"/>
      <div>
       <h3 className="text-[17px] font-semibold leading-6 text-foreground">PiWork</h3>
       <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{t.aboutDesc}</p>
      </div>
     </div>
     <div className="flex items-center justify-between gap-4 px-5 py-4">
      <span className="text-[15px] leading-5 text-foreground">{t.version}</span>
      <span className="font-mono text-[13px] leading-5 text-muted-foreground">{version||'—'}</span>
     </div>
    </div>
    <AppUpdatePanel language={lang}/>
   </div>}
  </main>
 </div>;
}
