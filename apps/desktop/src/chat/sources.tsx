import {useEffect,useState} from 'react';
import {ChevronRightIcon,XIcon} from 'lucide-react';
import type {ChatMessage,MessageSource} from '../../shared/types';

/* 联网来源展示(参考元宝「N 个来源」):chip 内叠放前三个站点图标,点击在聊天区
   右侧平铺打开「引用来源」面板(与内容并排的固定侧栏,不覆盖聊天内容);
   来源由 worker 侧 tool-sources 抽取并挂在 ToolEvent 上,这里只做聚合去重与展示,
   外链统一走系统浏览器(openExternalUrl)。 */

const SOURCES_MAX=50;

/** 聚合一条 assistant 消息跨工具的来源:按去 hash 的 URL 去重、保序,封顶 50 */
export function messageSources(message:ChatMessage):MessageSource[]{
 const out=new Map<string,MessageSource>();
 for(const event of message.toolEvents??[])for(const source of event.sources??[]){
  const key=source.url.split('#')[0];
  if(!out.has(key))out.set(key,source);
 }
 return [...out.values()].slice(0,SOURCES_MAX);
}

function hostnameOf(url:string):string{try{return new URL(url).hostname}catch{return url}}

/* 元数据补充的渲染端缓存:面板反复开合不重复抓取 */
const metaCache=new Map<string,{title?:string;snippet?:string}>();

/** 抽取信息缺失(裸域名标题或无摘要)时,经主进程抓取页面元数据补齐展示副本 */
function useEnrichedSource(source:MessageSource):{title:string;snippet?:string}{
 const host=hostnameOf(source.url);
 const hasOwnTitle=source.title&&source.title!==host;
 const [meta,setMeta]=useState(()=>metaCache.get(source.url));
 const needsMeta=!hasOwnTitle||!source.snippet;
 useEffect(()=>{
  if(!needsMeta||meta)return;
  let alive=true;
  window.desktop.sourceMeta(source.url).then(value=>{
   if(!alive)return;
   const next={title:value.title??undefined,snippet:value.description??undefined};
   metaCache.set(source.url,next);
   setMeta(next);
  }).catch(()=>{});
  return()=>{alive=false};
 },[needsMeta,meta,source.url]);
 const title=hasOwnTitle?source.title:(meta?.title||source.title||host);
 const snippet=source.snippet??meta?.snippet;
 return {title,snippet};
}

/* 无图标时回退首字母头像:按 host 哈希取色,同站同色 */
function hueOf(host:string):number{
 let hash=0;
 for(let index=0;index<host.length;index++)hash=(hash*31+host.charCodeAt(index))>>>0;
 return hash%360;
}

export function SourceFavicon({source,className}:{source:MessageSource;className?:string}){
 const [icon,setIcon]=useState<string|null>(null);
 useEffect(()=>{
  let alive=true;
  setIcon(null);
  window.desktop.favicon(source.url).then(value=>{if(alive)setIcon(value)}).catch(()=>{});
  return()=>{alive=false};
 },[source.url]);
 if(icon)return <img alt="" aria-hidden="true" className={className} src={icon}/>;
 const host=hostnameOf(source.url);
 const hue=hueOf(host);
 return <span aria-hidden="true" className={className} data-fallback=""
   style={{background:`hsl(${hue} 55% 90%)`,color:`hsl(${hue} 65% 32%)`}}>
   {(host.replace(/^www\./,'')[0]??'?').toUpperCase()}
 </span>;
}

export function SourcesChip({sources,label,onOpen}:{sources:MessageSource[];label:string;onOpen:()=>void}){
 return (
  <button className="conversation-sources-chip" type="button" onClick={onOpen}>
   <span className="conversation-sources-favicons">
    {sources.slice(0,3).map(source=><SourceFavicon className="conversation-source-favicon" key={source.url} source={source}/>)}
   </span>
   <span>{label}</span>
   <ChevronRightIcon aria-hidden="true" className="size-3.5 text-muted-foreground"/>
  </button>
 );
}

const words={
 'zh-CN':{title:'引用来源',close:'关闭',openExternal:'用默认应用打开'},
 en:{title:'Citations',close:'Close',openExternal:'Open with default app'},
} as const;

/** 面板条目:favicon+站点名 / 标题 / 摘要;缺失字段经 sourceMeta 异步补齐 */
function SourceItem({openLabel,source}:{openLabel:string;source:MessageSource}){
 const {title,snippet}=useEnrichedSource(source);
 return (
  <button className="sources-panel-item" title={openLabel} type="button"
    onClick={()=>void window.desktop.openExternalUrl(source.url)}>
   <span className="sources-panel-text">
    <span className="sources-panel-site">
     <SourceFavicon className="sources-panel-favicon" source={source}/>
     <span className="sources-panel-host">{hostnameOf(source.url)}</span>
    </span>
    <span className="sources-panel-title">{title}</span>
    {snippet&&<span className="sources-panel-snippet">{snippet}</span>}
   </span>
  </button>
 );
}

export function SourcesPanel({sources,language,onClose}:{sources:MessageSource[];language:'zh-CN'|'en';onClose:()=>void}){
 const copy=words[language];
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};
  window.addEventListener('keydown',key);
  return()=>window.removeEventListener('keydown',key);
 },[onClose]);
 return (
  <aside aria-label={`${copy.title} (${sources.length})`} className="sources-panel" role="complementary">
   <header className="sources-panel-header">
    <h2>{copy.title} ({sources.length})</h2>
    <button aria-label={copy.close} className="sources-panel-close" onClick={onClose} type="button">
     <XIcon aria-hidden="true" className="size-4"/>
    </button>
   </header>
   <ul className="sources-panel-list">
    {sources.map(source=>(
     <li key={source.url}><SourceItem openLabel={copy.openExternal} source={source}/></li>
    ))}
   </ul>
  </aside>
 );
}
