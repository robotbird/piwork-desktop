import type {MessageSource} from '../shared/types.ts';
import {publicSourceUrl} from '../src/web/lib/search/protocol.ts';

/* 联网工具来源抽取(元宝式「N 个来源」数据面):桌面端联网能力来自 MCP(mcp__*)与
   pi 插件扩展,没有统一的 platform_web_search 工具,故按「web 类工具 + 结果中的 URL」
   通用抽取来源展示副本。URL 一律过 publicSourceUrl 校验(拒绝内网/IP/带端口等),
   仅作展示,主进程不访问这些地址。live 流(chat-session)与历史重建(tool-history)
   共用本模块,保证两条路径来源一致。 */

const SOURCE_MAX=20;
const TITLE_MAX=120;
const SNIPPET_MAX=200;
const WALK_DEPTH_MAX=6;
/** 明确的本地/交互工具:即使参数带 query/url 也不当联网工具 */
const LOCAL_TOOLS=new Set(['ask_user','create_scheduled_task','read','bash','edit','write','grep','find','glob','ls']);
const WEB_TOOL_NAME=/search|web|fetch|browse|reader|extract|crawl|http|url|link|news/i;
const QUERY_KEYS=new Set(['query','q','keyword','keywords','search','url','link']);
const TITLE_KEYS=['title','name','headline'];
const SNIPPET_KEYS=['snippet','content','description','summary','abstract','text'];
const URL_KEYS=['url','link','href','sourceUrl'];
const URL_RE=/https?:\/\/[^\s"'`<>\[\]{}\\]+/g;
/** markdown 链接:链接文本可当标题(排除图片 ![alt](url) 的 alt) */
const MD_LINK_RE=/(?<!!)\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g;

export function isWebTool(name:string,args?:Record<string,unknown>):boolean{
 if(LOCAL_TOOLS.has(name)||name.startsWith('project_')||name.startsWith('skill_')||name.startsWith('schedule_'))return false;
 if(WEB_TOOL_NAME.test(name))return true;
 return Object.keys(args??{}).some(key=>QUERY_KEYS.has(key.toLowerCase())&&typeof args?.[key]==='string'&&args[key]);
}

function firstString(record:Record<string,unknown>,keys:readonly string[]):string|undefined{
 for(const key of keys){const value=record[key];if(typeof value==='string'&&value.trim())return value}
 return undefined;
}
function condense(text:string):string{return text.replace(/\s+/g,' ').trim()}
function cap(text:string,max:number):string{return text.length<=max?text:text.slice(0,max-1)+'…'}
function hostnameOf(url:string):string{try{return new URL(url).hostname}catch{return url}}
/** 去 hash 后的 URL 作为去重键(fragment 只是页内锚点) */
function sourceKey(url:string):string{return url.split('#')[0]}
function pushSource(out:Map<string,MessageSource>,source:MessageSource):void{
 const key=sourceKey(source.url);
 if(!out.has(key))out.set(key,source);
}
/** pi AgentToolResult 或纯字符串中的文本块拼接;图片等非文本块跳过 */
function resultParts(result:unknown):string[]{
 if(typeof result==='string')return [result];
 if(!result||typeof result!=='object')return [];
 const content=(result as {content?:unknown}).content;
 if(!Array.isArray(content))return typeof content==='string'?[content]:[];
 return content.map(part=>part&&typeof part==='object'&&typeof part.text==='string'?part.text:'');
}
/** 宽松 JSON 解析:优先整段,失败则从首个 {/[ 起解析(兼容「前缀说明: {json}」形态) */
function parseJsonLoose(text:string):unknown{
 const start=text.search(/[[{]/);
 if(start===-1)return undefined;
 try{return JSON.parse(text.slice(start))}catch{return undefined}
}
function collectJsonSources(value:unknown,out:Map<string,MessageSource>,depth:number):void{
 if(out.size>=SOURCE_MAX||value==null||depth>WALK_DEPTH_MAX)return;
 if(Array.isArray(value)){for(const item of value){collectJsonSources(item,out,depth+1);if(out.size>=SOURCE_MAX)return}return}
 if(typeof value!=='object')return;
 const record=value as Record<string,unknown>;
 const raw=firstString(record,URL_KEYS);
 const url=raw!==undefined?publicSourceUrl(raw):undefined;
 if(url){
  const title=firstString(record,TITLE_KEYS);
  const snippet=firstString(record,SNIPPET_KEYS);
  pushSource(out,{url,title:cap(condense(title??hostnameOf(url)),TITLE_MAX),...(snippet?{snippet:cap(condense(snippet),SNIPPET_MAX)}:{})});
 }
 for(const item of Object.values(record))collectJsonSources(item,out,depth+1);
}
function collectTextSources(text:string,out:Map<string,MessageSource>):void{
 /* markdown 链接优先:链接文本即标题,避免这些 URL 落到裸域名兜底 */
 for(const match of text.matchAll(MD_LINK_RE)){
  const url=publicSourceUrl(match[2]);
  if(url)pushSource(out,{url,title:cap(condense(match[1]),TITLE_MAX)});
  if(out.size>=SOURCE_MAX)return;
 }
 for(const match of text.matchAll(URL_RE)){
  let candidate=match[0];
  while(candidate&&/[).,;:!?'">]$/.test(candidate))candidate=candidate.slice(0,-1);
  const url=publicSourceUrl(candidate);
  if(url)pushSource(out,{url,title:hostnameOf(url)});
  if(out.size>=SOURCE_MAX)return;
 }
}
/** 被抓取页面本身作为来源时的标题:<title> 或首个 `# ` 标题行,回退 hostname */
function fetchedTitle(text:string,url:string):string{
 const tag=/<title[^>]*>([^<]{1,200})<\/title>/i.exec(text);
 const heading=/^#\s+(.{1,120})$/m.exec(text);
 const value=condense(heading?.[1]??tag?.[1]??'');
 return cap(value||hostnameOf(url),TITLE_MAX);
}
function extractFromResult(result:unknown):MessageSource[]{
 const out=new Map<string,MessageSource>();
 const parts=resultParts(result);
 for(const part of parts){
  const parsed=parseJsonLoose(part);
  if(parsed!==undefined)collectJsonSources(parsed,out,0);
 }
 if(out.size===0)for(const part of parts)collectTextSources(part,out);
 return [...out.values()];
}
/** web 类工具成功结果的来源展示副本;非 web 工具返回 []。args.url 存在时被抓页面置顶。 */
export function extractToolSources(name:string,args:Record<string,unknown>|undefined,result:unknown):MessageSource[]{
 if(!isWebTool(name,args))return [];
 const sources=extractFromResult(result);
 const fetched=typeof args?.url==='string'?publicSourceUrl(args.url):undefined;
 if(fetched&&!sources.some(source=>sourceKey(source.url)===sourceKey(fetched)))sources.unshift({url:fetched,title:fetchedTitle(resultParts(result).join('\n'),fetched)});
 return sources.slice(0,SOURCE_MAX);
}
