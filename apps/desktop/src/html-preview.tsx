import {useMemo,useState} from 'react';
import DOMPurify from 'dompurify';

/** 预览文件来源:项目文件走 preview://project/<id>/<路径>,文档库走 preview://library/<路径>,聊天附件缓存走 preview://attachment/<token>/<名>;
    inline 为无落盘文件的内联 HTML(如回复中的 fence 代码块),交互模式直接 srcDoc 渲染(相对资源不可用,https CDN 可用) */
export type HtmlPreviewSource={kind:'project';projectId:string;path:string}|{kind:'library';path:string}|{kind:'attachment';cache:string}|{kind:'inline'};

function previewUrl(source:HtmlPreviewSource):string{
  const encode=(value:string)=>value.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return source.kind==='project'
    ?`preview://project/${encodeURIComponent(source.projectId)}/${encode(source.path)}`
    :source.kind==='library'
      ?`preview://library/${encode(source.path)}`
      :source.kind==='attachment'
        ?`preview://attachment/${encode(source.cache)}`
        :''; // inline 交互模式走 srcDoc,不经协议
}

/* 静态文档:DOMPurify 整文档清洗(禁外部引用与嵌入框架)+ 内嵌严格 CSP 双保险,srcDoc 不执行任何脚本 */
function createStaticDocument(content:string):string{
  const clean=DOMPurify.sanitize(content,{
    WHOLE_DOCUMENT:true,
    FORBID_TAGS:['noscript','base','link','meta','iframe','frame','object','embed','set','animate','animateMotion','animateTransform'],
    FORBID_ATTR:['href','xlink:href'],
  });
  const parsed=new DOMParser().parseFromString(clean,'text/html');
  const policy=parsed.createElement('meta');
  policy.setAttribute('http-equiv','Content-Security-Policy');
  policy.setAttribute('content',"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'");
  if(parsed.head)parsed.head.prepend(policy);
  return `<!doctype html>${parsed.documentElement.outerHTML}`;
}

/**
 * 双模式 HTML 预览(参考 deepseek-harness HtmlBody):
 * - 交互(默认):preview:// 协议 iframe + sandbox="allow-scripts"——脚本可运行、相对资源与 https CDN 可加载,
 *   但无 allow-same-origin(opaque origin)且 preload 仅主 frame 暴露,碰不到应用与 Electron;
 * - 静态:清洗后的只读文档,禁脚本禁网络。
 */
export function HtmlPreview({source,content,language}:{source:HtmlPreviewSource;content:string;language:'zh-CN'|'en'}){
  const [interactive,setInteractive]=useState(true);
  const zh=language==='zh-CN';
  // content 变化(如工具写回后自动重载)时同步重建静态文档;指纹 key 让 srcDoc 变更即时生效
  const staticDoc=useMemo(()=>{try{return createStaticDocument(content)}catch{return undefined}},[content]);
  const title=zh?'HTML 文件预览':'HTML document preview';
  return <div className="html-preview">
    <div className="html-preview-toolbar" role="group" aria-label={zh?'预览模式':'Preview mode'}>
      <button aria-pressed={interactive} className={interactive?'active':''} onClick={()=>setInteractive(true)}>{zh?'交互':'Interactive'}</button>
      <button aria-pressed={!interactive} className={!interactive?'active':''} onClick={()=>setInteractive(false)}>{zh?'静态':'Static'}</button>
    </div>
    {interactive
      ?source.kind==='inline'
        ?<iframe key={`live-inline-${content.length}-${content.slice(0,32)}`} className="html-preview-frame" data-html-mode="interactive" data-html-preview srcDoc={content} sandbox="allow-scripts" title={title}/>
        :<iframe key={`live-${source.kind}-${'path' in source?source.path:source.cache}`} className="html-preview-frame" data-html-mode="interactive" data-html-preview src={previewUrl(source)} sandbox="allow-scripts" title={title}/>
      :staticDoc===undefined
        ?<p role="alert">{zh?'无法预览此 HTML 文件。':'Unable to preview this HTML file.'}</p>
        :<iframe key={`static-${content.length}-${content.slice(0,32)}`} className="html-preview-frame" data-html-mode="static" data-html-preview srcDoc={staticDoc} sandbox="" title={title}/>
    }
  </div>;
}
