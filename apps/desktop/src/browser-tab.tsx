import {useEffect,useRef,useState} from 'react';

/* 内部浏览器标签(参考 deepseek-harness ui-sidebar-browser):地址栏 + Electron webview。
   webview 用 createElement 创建、不进 React 树,tab 切换由父层 hidden 控制保活。 */
const MAX_URL_LENGTH = 16384;
const BROWSER_PARTITION = 'persist:piwork-browser';

type BrowserAddress={ok:true;url:string;hostname:string}|{ok:false;reason:'empty'|'invalid'|'protocol'|'credentials'|'application-origin'};

/** 无 scheme 补 https://,仅放行 http/https,拒绝凭据与应用自身 origin(同 deepseek url.ts 规则)。 */
export function parseBrowserAddress(input:string):BrowserAddress{
  const trimmed=input.trim();
  if(trimmed==='')return {ok:false,reason:'empty'};
  if(trimmed.length>MAX_URL_LENGTH)return {ok:false,reason:'invalid'};
  const explicitScheme=/^[A-Za-z][A-Za-z\d+.-]*:(?!\d+(?:[/?#]|$))/u.test(trimmed);
  const candidate=explicitScheme?trimmed:`https://${trimmed}`;
  let url:URL;
  try{url=new URL(candidate)}catch{return {ok:false,reason:'invalid'}}
  if(url.username!==''||url.password!=='')return {ok:false,reason:'credentials'};
  if(url.protocol!=='https:'&&url.protocol!=='http:')return {ok:false,reason:'protocol'};
  if(location.origin.startsWith('http')&&url.origin===location.origin)return {ok:false,reason:'application-origin'};
  return {ok:true,url:url.href,hostname:url.hostname};
}

interface WebviewElement extends HTMLElement{
  loadURL(url:string):Promise<void>;
  getURL():string;
  getTitle():string;
  canGoBack():boolean;
  canGoForward():boolean;
  clearHistory():void;
  goBack():void;
  goForward():void;
  reload():void;
  isLoading():boolean;
}

function hostnameOf(url:string){try{return new URL(url).hostname}catch{return ''}}

const failureText:Record<string,{zh:string;en:string}>={
  invalid:{zh:'无效的网址。',en:'Invalid web address.'},
  protocol:{zh:'仅支持 http/https 网址。',en:'Only http/https URLs are supported.'},
  credentials:{zh:'不允许在网址中携带用户名或密码。',en:'Usernames and passwords in URLs are not allowed.'},
  'application-origin':{zh:'不能浏览应用自身的页面。',en:'Browsing the application itself is not allowed.'},
};

export function BrowserTab({initialUrl,onTitleChange,onOpenExternal,language}:{initialUrl?:string;onTitleChange:(title:string)=>void;onOpenExternal:(url:string)=>void;language:'zh-CN'|'en'}){
  const zh=language==='zh-CN';
  const host=useRef<HTMLDivElement>(null);
  const webview=useRef<WebviewElement|null>(null);
  const initial=useRef(initialUrl);
  const ready=useRef(false);
  // dom-ready 前提交的导航先挂起,ready 后统一加载,避免调用未就绪的 webview 方法
  const pending=useRef('');
  const [url,setUrl]=useState('');
  const [draft,setDraft]=useState('');
  const [title,setTitle]=useState('');
  const [loading,setLoading]=useState(false);
  const [canBack,setCanBack]=useState(false);
  const [canForward,setCanForward]=useState(false);
  const [failure,setFailure]=useState('');

  useEffect(()=>{
    const container=host.current;
    if(!container)return;
    const element=document.createElement('webview') as WebviewElement;
    element.className='browser-webview';
    element.setAttribute('partition',BROWSER_PARTITION);
    element.setAttribute('src','about:blank');
    const start=initial.current?(()=>{const parsed=parseBrowserAddress(initial.current!);return parsed.ok?parsed.url:''})():'';
    const sync=()=>{
      // did-start-loading 等事件可能先于 dom-ready:getURL 等方法在就绪前调用会抛错
      if(!ready.current)return;
      const current=element.getURL();
      const page=element.getTitle();
      setCanBack(element.canGoBack());
      setCanForward(element.canGoForward());
      setLoading(element.isLoading());
      if(current&&current!=='about:blank'){
        setUrl(current);
        setDraft(current);
        const next=page||hostnameOf(current);
        setTitle(next);
        onTitleChange(next);
      }
    };
    element.addEventListener('dom-ready',()=>{
      ready.current=true;
      element.clearHistory();
      const target=pending.current||start;
      if(target)void element.loadURL(target).catch(()=>{});
    },{once:true});
    for(const name of ['did-navigate','did-navigate-in-page','did-start-loading','did-stop-loading','page-title-updated'])element.addEventListener(name,sync);
    element.addEventListener('did-fail-load',event=>{
      const detail=event as Event&{isMainFrame?:boolean;errorDescription?:string};
      if(detail.isMainFrame===false)return;
      setFailure(detail.errorDescription||(zh?'页面加载失败。':'Failed to load the page.'));
    });
    element.addEventListener('render-process-gone',()=>setFailure(zh?'浏览器进程已退出，请刷新重试。':'The browser process exited. Reload to try again.'));
    container.appendChild(element);
    webview.current=element;
    return()=>{element.remove();webview.current=null};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  function navigate(input:string){
    const parsed=parseBrowserAddress(input);
    if(!parsed.ok){setFailure(parsed.reason==='empty'?'':(failureText[parsed.reason]?.[zh?'zh':'en']??failureText.invalid[zh?'zh':'en']));return}
    setFailure('');
    // webview 未就绪时挂起导航,dom-ready 后加载
    if(!ready.current){pending.current=parsed.url;return}
    try{void webview.current?.loadURL(parsed.url).catch(()=>setFailure(zh?'页面加载失败。':'Failed to load the page.'))}
    catch{pending.current=parsed.url}
  }
  function guest(action:'goBack'|'goForward'|'reload'){
    const element=webview.current;
    if(!ready.current||!element)return;
    try{element[action]()}catch{/* 未就绪时忽略 */}
  }

  return <div className="browser-tab">
    <form className="browser-toolbar" onSubmit={event=>{event.preventDefault();navigate(draft)}}>
      <button aria-label={zh?'后退':'Back'} disabled={!canBack} type="button" onClick={()=>guest('goBack')}>←</button>
      <button aria-label={zh?'前进':'Forward'} disabled={!canForward} type="button" onClick={()=>guest('goForward')}>→</button>
      <button aria-label={zh?'刷新':'Reload'} type="button" onClick={()=>{setFailure('');guest('reload')}}>⟳</button>
      <input aria-label={zh?'地址栏':'Address bar'} placeholder={zh?'输入网址，如 example.com':'Enter a web address, e.g. example.com'} spellCheck={false} value={draft} onChange={event=>setDraft(event.target.value)}/>
      {url&&<button aria-label={zh?'用系统浏览器打开':'Open in system browser'} type="button" onClick={()=>onOpenExternal(url)}>↗</button>}
    </form>
    {failure&&<p className="browser-failure" role="alert">{failure}</p>}
    <div aria-busy={loading} className="browser-content">
      <div ref={host}/>
      {!url&&!loading&&!failure&&<p className="browser-empty">{zh?'输入网址开始浏览':'Type a web address to start browsing'}</p>}
    </div>
  </div>;
}
