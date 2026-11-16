/* 来源站点图标代理:生产 CSP 的 img-src 不放行远端图片,故由主进程抓取转存为
   data URL(渲染端 <img> 直接可用,无需放宽 CSP)。抓取链:origin/favicon.ico →
   解析 origin 首页 <head> 里的 <link rel="icon"> 候选 → apple-touch-icon.png/favicon.png
   直接路径。按 origin 内存缓存并合并并发请求;失败返回 null,渲染端回退首字母头像。
   请求带浏览器 UA(不少 CDN 会拒绝默认 UA);仅作展示下载(≤256KB),不执行任何返回内容。 */

const TIMEOUT_MS=4000;
const MAX_BYTES=256*1024;
/** 首页 HTML 只读头部:找到 </head> 或读满即止,不整页下载 */
const HEAD_MAX_BYTES=160*1024;
/** 单站点 link 图标最多尝试数,防异常页面拖慢 */
const ICON_TRIES_MAX=3;
const CACHE_MAX=200;
/** 浏览器 UA:默认 node/undici UA 会被部分站点与 CDN 直接 403 */
const BROWSER_UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const cache=new Map<string,string|null>();
const pending=new Map<string,Promise<string|null>>();

/** 魔数嗅探图片类型,防 Content-Type 伪造;SVG 无魔数仅按 Content-Type 认可 */
function sniffImage(bytes:Uint8Array,contentType:string):string|null{
 if(bytes.length>=8&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47)return 'image/png';
 if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
 if(bytes.length>=4&&bytes[0]===0x47&&bytes[1]===0x49&&bytes[2]===0x46&&bytes[3]===0x38)return 'image/gif';
 if(bytes.length>=4&&bytes[0]===0x00&&bytes[1]===0x00&&bytes[2]===0x01&&bytes[3]===0x00)return 'image/x-icon';
 if(bytes.length>=12&&bytes[8]===0x57&&bytes[9]===0x45&&bytes[10]===0x42&&bytes[11]===0x50)return 'image/webp';
 return /^image\/(png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|avif|svg\+xml)\b/i.test(contentType)?contentType.toLowerCase().replace(/^image\/vnd\.microsoft\.icon$/,'image/x-icon'):null;
}

async function fetchIconData(url:string):Promise<string|null>{
 try{
  const response=await fetch(url,{signal:AbortSignal.timeout(TIMEOUT_MS),redirect:'follow',headers:{'User-Agent':BROWSER_UA,Accept:'image/*,*/*;q=0.8'}});
  if(!response.ok)return null;
  const buffer=await response.arrayBuffer();
  if(buffer.byteLength===0||buffer.byteLength>MAX_BYTES)return null;
  const bytes=new Uint8Array(buffer);
  const mime=sniffImage(bytes,response.headers.get('content-type')??'');
  return mime?`data:${mime};base64,${Buffer.from(bytes).toString('base64')}`:null;
 }catch{
  return null;
 }
}

/** 拉取页面 HTML 的头部片段:读到 </head> 或 HEAD_MAX_BYTES 为止;仅接受 html 内容 */
export async function fetchPageHead(url:string):Promise<string|null>{
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  const response=await fetch(url,{signal:AbortSignal.timeout(TIMEOUT_MS),redirect:'follow',headers:{'User-Agent':BROWSER_UA,Accept:'text/html'}});
  if(!response.ok)return null;
  const type=response.headers.get('content-type')??'';
  if(type&&!/text\/html|application\/xhtml/i.test(type))return null;
  reader=response.body?.getReader();
  if(!reader)return null;
  const decoder=new TextDecoder();
  let html='';
  while(html.length<HEAD_MAX_BYTES){
   const {done,value}=await reader.read();
   if(done)break;
   html+=decoder.decode(value,{stream:true});
   if(/<\/head\s*>/i.test(html))break;
  }
  return html;
 }catch{
  return null;
 }finally{
  void reader?.cancel().catch(()=>{});
 }
}

/** 从首页 HTML 解析图标候选 URL(按出现顺序去重);跳过 data:/非 http(s) 地址 */
export function pageIconUrls(html:string,origin:string):string[]{
 const out:string[]=[];
 for(const match of html.matchAll(/<link\b[^>]*>/gi)){
  const tag=match[0];
  if(!/\brel\s*=\s*(?:"[^"]*icon[^"]*"|'[^']*icon[^']*'|icon\b)/i.test(tag))continue;
  const href=/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
  const raw=href?.[1]??href?.[2]??href?.[3];
  if(!raw)continue;
  try{
   const resolved=new URL(raw,origin);
   if(/^https?:$/.test(resolved.protocol))out.push(resolved.toString());
  }catch{}
 }
 return [...new Set(out)];
}

async function fetchOriginIcon(origin:string):Promise<string|null>{
 const direct=await fetchIconData(`${origin}/favicon.ico`);
 if(direct)return direct;
 const html=await fetchPageHead(origin);
 if(html)for(const url of pageIconUrls(html,origin).slice(0,ICON_TRIES_MAX)){
  const icon=await fetchIconData(url);
  if(icon)return icon;
 }
 /* 页面没有声明图标时的常见固定路径兜底 */
 for(const path of ['/apple-touch-icon.png','/favicon.png']){
  const icon=await fetchIconData(`${origin}${path}`);
  if(icon)return icon;
 }
 return null;
}

/** 来源 URL → 站点图标的 data URL;非法地址/抓取失败返回 null */
export function faviconDataUrl(url:string):Promise<string|null>{
 let origin:string;
 try{
  const parsed=new URL(url);
  if(!/^https?:$/.test(parsed.protocol))return Promise.resolve(null);
  origin=parsed.origin;
 }catch{
  return Promise.resolve(null);
 }
 const hit=cache.get(origin);
 if(hit!==undefined)return Promise.resolve(hit);
 let flight=pending.get(origin);
 if(!flight){
  flight=fetchOriginIcon(origin).then(value=>{
   if(cache.size>=CACHE_MAX)cache.clear();
   cache.set(origin,value);
   return value;
  }).finally(()=>{
   pending.delete(origin);
  });
  pending.set(origin,flight);
 }
 return flight;
}
