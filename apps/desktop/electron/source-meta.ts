import {publicSourceUrl} from '../src/web/lib/search/protocol.ts';
import {fetchPageHead} from './favicons.ts';

/* 来源页面元数据补充(标题/摘要):纯文本 URL 扫描产生的来源只有裸域名标题、
   无摘要,这里由主进程抓取页面头部,解析 og:title/<title> 与 og:description/
   meta description 补齐展示副本。URL 一律过 publicSourceUrl 校验(拒绝内网/
   IP/带端口),仅读 </head> 前的 HTML 片段,不执行任何返回内容;按 URL 内存
   缓存并合并并发请求,失败返回空对象,渲染端保持原展示。 */

const TITLE_MAX=120;
const SNIPPET_MAX=200;
const CACHE_MAX=300;

const cache=new Map<string,{title?:string|null;description?:string|null}>();
const pending=new Map<string,Promise<{title?:string|null;description?:string|null}>>();

function condense(text:string):string{return text.replace(/\s+/g,' ').trim()}
function cap(text:string,max:number):string{return text.length<=max?text:text.slice(0,max-1)+'…'}
function attr(tag:string,name:string):string|undefined{
 const value=new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,'i').exec(tag);
 return condense(value?.[1]??value?.[2]??value?.[3]??'')||undefined;
}
function metaContent(html:string,names:string[]):string|undefined{
 /* 按 names 优先级逐个查找,前面的名称优先于后面,与标签出现顺序无关 */
 for(const name of names){
  for(const match of html.matchAll(/<meta\b[^>]*>/gi)){
   const tag=match[0];
   const tagName=attr(tag,'name')??attr(tag,'property');
   if(tagName&&tagName.toLowerCase()===name.toLowerCase()){
    const value=attr(tag,'content');
    if(value)return value;
   }
  }
 }
 return undefined;
}

/** 从 HTML 头部解析展示标题(og:title/twitter:title/<title>)与摘要(og:description/description) */
export function pageMeta(html:string):{title?:string;description?:string}{
 const out:{title?:string;description?:string}={};
 const title=cap(condense(metaContent(html,['og:title','twitter:title'])
   ??/<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)?.[1]??''),TITLE_MAX);
 if(title)out.title=title;
 const description=cap(condense(metaContent(html,['og:description','twitter:description','description'])??''),SNIPPET_MAX);
 if(description)out.description=description;
 return out;
}

async function fetchSourceMeta(url:string):Promise<{title?:string|null;description?:string|null}>{
 const html=await fetchPageHead(url);
 if(!html)return {};
 const {title,description}=pageMeta(html);
 return {title:title??null,description:description??null};
}

/** 来源 URL → 页面标题与摘要;非法地址/抓取失败返回空对象 */
export function sourceMeta(url:string):Promise<{title?:string|null;description?:string|null}>{
 const valid=publicSourceUrl(url);
 if(!valid)return Promise.resolve({});
 const hit=cache.get(valid);
 if(hit!==undefined)return Promise.resolve(hit);
 let flight=pending.get(valid);
 if(!flight){
  flight=fetchSourceMeta(valid).then(value=>{
   if(cache.size>=CACHE_MAX)cache.clear();
   cache.set(valid,value);
   return value;
  }).finally(()=>{
   pending.delete(valid);
  });
  pending.set(valid,flight);
 }
 return flight;
}
