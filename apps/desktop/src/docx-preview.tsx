import {useEffect,useRef,useState} from 'react';
import {renderAsync} from 'docx-preview';

const FRAME = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data: blob:"><style>body{margin:0;background:#f2f2f2}.docx-wrapper{padding:12px!important}.docx-wrapper>section{box-shadow:none!important;min-width:0!important;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere}</style></head><body><div id="content"></div></body></html>`;
export function DocxPreview({data,language}:{data:string;language:'zh-CN'|'en'}) {
 const iframe=useRef<HTMLIFrameElement>(null);
 const [error,setError]=useState(false);
 const [loading,setLoading]=useState(true);
 useEffect(()=>{setLoading(true);setError(false)},[data]);
 async function render(){
  const frame=iframe.current;const content=frame?.contentDocument?.getElementById('content');
  if(!content)return;
  try {
   const bytes=Uint8Array.from(atob(data),character=>character.charCodeAt(0));
   await renderAsync(bytes,content,undefined,{renderAltChunks:false,renderComments:false,ignoreFonts:true,useBase64URL:true,ignoreWidth:true,ignoreHeight:true});
   if(iframe.current===frame)setLoading(false);
  } catch {if(iframe.current===frame){setLoading(false);setError(true)}}
 }
 return <div className="docx-preview">{loading&&<p>{language==='zh-CN'?'正在加载…':'Loading…'}</p>}{error&&<p role="alert">{language==='zh-CN'?'无法打开 DOCX 文件。':'Unable to open DOCX file.'}</p>}<iframe key={data} ref={iframe} title={language==='zh-CN'?'Word 文件预览':'Word document preview'} sandbox="allow-same-origin" srcDoc={FRAME} onLoad={render}/></div>
}
