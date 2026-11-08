import {useEffect,useRef,useState} from 'react';
export function PptxPreview({data,language}:{data:string;language:'zh-CN'|'en'}){
 const ref=useRef<Worker|null>(null);const [index,setIndex]=useState(0);const [count,setCount]=useState<number|null>(null);const [svg,setSvg]=useState('');const [error,setError]=useState(false);const zh=language==='zh-CN';
 useEffect(()=>{setIndex(0);setCount(null);setSvg('');setError(false);const worker=new Worker(new URL('./pptx-worker.ts',import.meta.url),{type:'module'});ref.current=worker;worker.onmessage=event=>{const value=event.data;if(value.type==='loaded')setCount(value.count);else if(value.type==='page'){setIndex(value.index);setSvg(value.svg)}else if(value.type==='error')setError(true)};worker.onerror=()=>setError(true);worker.postMessage({type:'load',data});return()=>{ref.current=null;worker.terminate()}},[data]);
 if(error)return <p role="alert">{zh?'无法打开 PPTX 文件。':'Unable to open PPTX file.'}</p>;
 if(count===null)return <p>{zh?'正在加载…':'Loading…'}</p>;
 if(!count)return <p>{zh?'没有可显示的幻灯片。':'No slides to display.'}</p>;
 const src=`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
 return <div className="pptx-preview"><div className="pdf-controls"><button disabled={index<=0} onClick={()=>ref.current?.postMessage({type:'page',index:index-1})}>{zh?'上一页':'Previous'}</button><span>{index+1} / {count}</span><button disabled={index>=count-1} onClick={()=>ref.current?.postMessage({type:'page',index:index+1})}>{zh?'下一页':'Next'}</button></div>{svg&&<img className="pptx-slide" src={src} alt={zh?`幻灯片 ${index+1}`:`Slide ${index+1}`}/>}<p>{zh?'只读预览，复杂版式可能与原文件不同。':'Read-only preview; complex formatting may differ.'}</p></div>;
}
