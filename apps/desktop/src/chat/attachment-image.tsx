import {useEffect, useState } from 'react';
import {FileTextIcon} from 'lucide-react';
import {isImageName} from '../documents/library-thumb';
import type {ChatAttachmentRef} from '../../shared/types';

/** 图片附件可否以缩略图/灯箱呈现(与主进程 readChatAttachment 接受的图片类型一致) */
export function isImageAttachment(ref:ChatAttachmentRef|undefined):boolean{
  return !!ref&&isImageName(ref.name)&&!!ref.cachePath;
}

/* 会话级 data-url 缓存:缩略图与灯箱共用,避免消息流重渲染时反复 IPC 读盘 */
const imageSrcCache=new Map<string,string>();

export type ImageSource={name:string;cache?:string;project?:{projectId:string;path:string}};

export async function loadImageSrc(source:ImageSource):Promise<string>{
  const key=source.cache??`project:${source.project!.projectId}:${source.project!.path}`;
  const cached=imageSrcCache.get(key);
  if(cached)return cached;
  const src=source.cache
    ?(await window.desktop.readAttachment(source.cache)).content
    :await window.desktop.readImage(source.project!.projectId!,source.project!.path).then(image=>`data:${image.mime};base64,${image.base64}`);
  imageSrcCache.set(key,src);
  return src;
}

/** 附件缩略图:加载期间渲染 fallback(通用文件图标占位),失败保持占位 */
export function AttachmentThumb({cache,name,className,fallbackClassName}:{cache:string;name:string;className?:string;fallbackClassName?:string}){
  const [src,setSrc]=useState<string>();
  useEffect(()=>{
    let alive=true;
    setSrc(undefined);
    loadImageSrc({name,cache}).then(value=>{if(alive)setSrc(value)}).catch(()=>{});
    return()=>{alive=false};
  },[cache,name]);
  if(src)return <img alt={name} className={className} src={src}/>;
  return <span className={fallbackClassName??className}><FileTextIcon aria-hidden="true" className="size-4"/></span>;
}
