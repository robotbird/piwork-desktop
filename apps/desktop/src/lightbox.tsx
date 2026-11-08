import {useEffect, useState } from 'react';
import {ChevronLeftIcon, ChevronRightIcon, XIcon} from 'lucide-react';
import {loadImageSrc, type ImageSource} from './chat/attachment-image';

/* 全屏灯箱预览(图片不进右侧 dock):点击缩略图打开,多图时上一张/下一张导航;
   图片源按需加载并预取相邻项,Esc/点击背景关闭,左右方向键翻页。 */
export type LightboxState={items:ImageSource[];index:number};

export function Lightbox({items,index,language,onClose}:{items:ImageSource[];index:number;language:'zh-CN'|'en';onClose:()=>void}){
  const [current,setCurrent]=useState(index);
  const [src,setSrc]=useState<string>();
  const [failed,setFailed]=useState(false);
  const zh=language==='zh-CN';
  const item=items[current];
  useEffect(()=>{let alive=true;
    setSrc(undefined);setFailed(false);
    if(item)loadImageSrc(item).then(value=>{if(alive)setSrc(value)}).catch(()=>{if(alive)setFailed(true)});
    for(const adjacent of [current-1,current+1])if(items[adjacent])void loadImageSrc(items[adjacent]).catch(()=>{});
    return()=>{alive=false};
  },[items,current,item]);
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(event.key==='Escape')onClose();
      else if(event.key==='ArrowLeft'&&current>0)setCurrent(current-1);
      else if(event.key==='ArrowRight'&&current<items.length-1)setCurrent(current+1);
    };
    window.addEventListener('keydown',handler);
    return()=>window.removeEventListener('keydown',handler);
  },[current,items.length,onClose]);
  if(!item)return null;
  return <div className="lightbox" data-lightbox role="dialog" aria-modal="true" aria-label={item.name}>
    <div className="lightbox-header">
      {items.length>1&&<div className="lightbox-nav" role="group" aria-label={zh?'图片切换':'Image navigation'}>
        <span className="lightbox-counter">{current+1} / {items.length}</span>
        <button aria-label={zh?'上一张':'Previous'} disabled={current===0} onClick={()=>setCurrent(current-1)} type="button"><ChevronLeftIcon aria-hidden="true" className="size-6"/></button>
        <button aria-label={zh?'下一张':'Next'} disabled={current===items.length-1} onClick={()=>setCurrent(current+1)} type="button"><ChevronRightIcon aria-hidden="true" className="size-6"/></button>
      </div>}
      <button aria-label={zh?'关闭':'Close'} className="lightbox-close" onClick={onClose} type="button"><XIcon aria-hidden="true" className="size-5"/></button>
    </div>
    <div className="lightbox-stage" onClick={onClose}>
      {failed?<p role="alert">{zh?'无法加载图片。':'Unable to load the image.'}</p>
        :src===undefined?<p>{zh?'正在加载…':'Loading…'}</p>
        :<img alt={item.name} onClick={event=>event.stopPropagation()} src={src}/>}
    </div>
    <p className="lightbox-caption">{item.name}</p>
  </div>;
}
