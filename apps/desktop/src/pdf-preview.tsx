import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {getDocument,GlobalWorkerOptions,TextLayer,type PDFDocumentProxy,type RenderTask,type PageViewport} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc=workerUrl;

/* 连续滚动 PDF 预览(参考 deepseek-harness pdf/pdf.tsx):
   所有页按基准尺寸占位纵向排列、可视区懒渲染、fit-width/百分比缩放、可选中文本层。 */
const BASE_SCALE=96/72;
const MIN_ZOOM=.25,MAX_ZOOM=4;
const MAX_PIXELS=16_777_216;
const ZOOM_STEP=1.25;
const HORIZONTAL_INSET=16;

type PageSize={width:number;height:number};

export function PdfPreview({data,language}:{data:string;language:'zh-CN'|'en'}){
  const zh=language==='zh-CN';
  const [document,setDocument]=useState<PDFDocumentProxy|null>(null);
  const [sizes,setSizes]=useState<PageSize[]|null>(null);
  const [failed,setFailed]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const [fitMode,setFitMode]=useState(true);
  const [fixedScale,setFixedScale]=useState(1);
  const [viewportWidth,setViewportWidth]=useState(0);
  const [page,setPage]=useState(1);
  const scroll=useRef<HTMLDivElement>(null);
  const anchor=useRef<{x:number;y:number}|null>(null);
  const zoom=fitMode
    ?Math.min(1,Math.max(1,viewportWidth-HORIZONTAL_INSET)/(sizes?.[0]?.width||1))
    :fixedScale;

  useEffect(()=>{
    let active=true;setDocument(null);setSizes(null);setFailed(false);setPage(1);
    const bytes=Uint8Array.from(atob(data),character=>character.charCodeAt(0));
    const task=getDocument({data:bytes,isEvalSupported:false,useSystemFonts:true});
    void task.promise.then(async pdf=>{
      if(!active)return;
      setDocument(pdf);
      // 每页基准尺寸做精确占位;getPage 走 pdfjs 页缓存,大文件也只解析一次
      const next:PageSize[]=[];
      for(let index=1;index<=pdf.numPages;index++){
        const view=(await pdf.getPage(index)).getViewport({scale:BASE_SCALE});
        next.push({width:view.width,height:view.height});
      }
      if(active)setSizes(next);
    }).catch(()=>{if(active)setFailed(true)});
    return()=>{active=false;void task.destroy()};
  },[data,attempt]);

  // 面板宽度测量:pdf-scroll 只在文档就绪后渲染,依赖 sizes 变化重新挂载观察
  useLayoutEffect(()=>{
    const node=scroll.current;
    if(!node)return;
    const measure=()=>setViewportWidth(node.clientWidth);
    measure();
    if(typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(measure);
    observer.observe(node);
    return()=>observer.disconnect();
  },[sizes]);

  const onVisible=useCallback((value:number)=>setPage(value),[]);
  const applyZoom=useCallback((next:number)=>{
    setFitMode(false);
    setFixedScale(Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,next)));
  },[]);
  // Ctrl/Cmd+滚轮缩放:记录指针锚点,布局更新后按比例还原滚动位置
  const previousZoom=useRef(zoom);
  useLayoutEffect(()=>{
    const node=scroll.current;
    if(!node||previousZoom.current===zoom)return;
    const ratio=zoom/previousZoom.current;
    const point=anchor.current??{x:node.clientWidth/2,y:node.clientHeight/2};
    node.scrollLeft=(node.scrollLeft+point.x)*ratio-point.x;
    node.scrollTop=(node.scrollTop+point.y)*ratio-point.y;
    previousZoom.current=zoom;
    anchor.current=null;
  },[zoom]);

  if(failed)return <div className="pdf-status" role="alert"><p>{zh?'PDF 无法打开或需要密码。':'Unable to open PDF or password required.'}</p><button onClick={()=>setAttempt(value=>value+1)}>{zh?'重试':'Retry'}</button></div>;
  if(!sizes||!document)return <p>{zh?'正在加载…':'Loading…'}</p>;
  return <div className="pdf-preview">
    <div className="pdf-controls">
      <span>{page} / {sizes.length}</span>
      <div className="pdf-zoom">
        <button aria-label={zh?'缩小':'Zoom out'} disabled={zoom<=MIN_ZOOM} onClick={()=>applyZoom(zoom/ZOOM_STEP)}>−</button>
        <span>{Math.round(zoom*100)}%</span>
        <button aria-label={zh?'放大':'Zoom in'} disabled={zoom>=MAX_ZOOM} onClick={()=>applyZoom(zoom*ZOOM_STEP)}>+</button>
        <button aria-pressed={fitMode} onClick={()=>{setFitMode(true);anchor.current=null}}>{zh?'适应宽度':'Fit width'}</button>
      </div>
    </div>
    <div className="pdf-scroll" ref={scroll} onWheel={event=>{
      if(!event.ctrlKey&&!event.metaKey)return;
      event.preventDefault();
      const rect=event.currentTarget.getBoundingClientRect();
      anchor.current={x:event.clientX-rect.left,y:event.clientY-rect.top};
      const unit=event.deltaMode===WheelEvent.DOM_DELTA_LINE?16:event.deltaMode===WheelEvent.DOM_DELTA_PAGE?event.currentTarget.clientHeight:1;
      applyZoom(zoom*Math.exp(-Math.max(-40,Math.min(40,event.deltaY*unit))*.01));
    }}>
      {sizes.map((size,index)=><PdfPage key={index} document={document} pageNumber={index+1} size={size} zoom={zoom} onVisible={onVisible} zh={zh}/>)}
    </div>
  </div>;
}

function PdfPage({document,pageNumber,size,zoom,onVisible,zh}:{document:PDFDocumentProxy;pageNumber:number;size:PageSize;zoom:number;onVisible:(page:number)=>void;zh:boolean}){
  const host=useRef<HTMLDivElement>(null);
  const canvas=useRef<HTMLCanvasElement>(null);
  const text=useRef<HTMLDivElement>(null);
  const [visible,setVisible]=useState(pageNumber===1);
  const [failed,setFailed]=useState(false);
  const renderedZoom=useRef<number|undefined>(undefined);
  const textZoom=useRef<number|undefined>(undefined);
  const pending=useRef(Promise.resolve());

  useEffect(()=>{
    const node=host.current;
    if(!node||typeof IntersectionObserver==='undefined')return;
    let disposed=false;
    const observer=new IntersectionObserver(entries=>{
      if(disposed)return;
      const intersects=entries.some(entry=>entry.isIntersecting);
      setVisible(intersects);
      if(intersects)onVisible(pageNumber);
    },{rootMargin:'100% 0px'});
    observer.observe(node);
    return()=>{disposed=true;observer.disconnect()};
  },[pageNumber,onVisible]);

  useEffect(()=>{
    // 已按当前 zoom 渲染过则跳过;不可见的页复用旧位图,回到可视区再重渲
    if(!visible||(renderedZoom.current!==undefined&&renderedZoom.current===zoom))return;
    let cancelled=false;
    const lifetime=new AbortController();
    const signal=lifetime.signal;
    // pdfjs 的 page render 任务必须等上一个 cancel 清理完才能继续,同页串行化
    pending.current=pending.current.then(async()=>{
      signal.throwIfAborted();
      const page=await document.getPage(pageNumber);
      signal.throwIfAborted();
      const viewport=page.getViewport({scale:BASE_SCALE});
      const node=canvas.current;
      if(!node)return;
      // 位图分辨率随缩放提升,但限制单页最大像素,避免大倍率下光栅爆内存
      const ratio=Math.min(window.devicePixelRatio*zoom,Math.sqrt(MAX_PIXELS/(viewport.width*viewport.height)));
      node.width=Math.max(1,Math.floor(viewport.width*ratio));
      node.height=Math.max(1,Math.floor(viewport.height*ratio));
      const context=node.getContext('2d');
      if(!context)throw new Error('Canvas unavailable');
      const task=page.render({canvasContext:context,viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]});
      const buildText=async()=>{
        // 文本层只在首次建立;后续 zoom 变化由 effect 用 CSS scale 跟随(参考 deepseek text.ts)
        if(textZoom.current!==undefined||!text.current)return;
        textZoom.current=zoom;
        const layer=new TextLayer({textContentSource:await page.getTextContent(),container:text.current,viewport:viewport as PageViewport});
        text.current.style.setProperty('--total-scale-factor',String(viewport.scale));
        signal.addEventListener('abort',()=>layer.cancel(),{once:true});
        await layer.render();
      };
      try{
        await Promise.all([task.promise,buildText()]);
        signal.throwIfAborted();
        renderedZoom.current=zoom;
      }catch(error){
        task.cancel();
        await Promise.allSettled([task.promise]);
        throw error;
      }finally{
        if(signal.aborted)task.cancel();
      }
    }).catch(()=>{if(!signal.aborted&&!cancelled)setFailed(true)});
    return()=>{cancelled=true;lifetime.abort()};
  },[document,pageNumber,visible,zoom]);

  // 文本层跟随缩放:按建立时 viewport 与当前 zoom 的比例整体变换,选择与复制不受影响
  useEffect(()=>{
    const node=text.current;
    if(!node||textZoom.current===undefined)return;
    node.style.scale=String(zoom/textZoom.current);
  },[zoom]);

  return <div className="pdf-page" ref={host} style={{width:size.width*zoom,height:size.height*zoom}}>
    {failed
      ?<p className="pdf-page-error" role="alert">{zh?'此页渲染失败。':'Failed to render this page.'}</p>
      :<div className="pdf-page-surface">
        <canvas aria-label={zh?`PDF 第 ${pageNumber} 页`:`PDF page ${pageNumber}`} ref={canvas}/>
        <div className="pdf-text-layer" data-pdf-text ref={text}/>
      </div>}
  </div>;
}
