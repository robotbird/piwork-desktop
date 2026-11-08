import {XIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {FileTypeIcon} from '@/components/documents/file-type-icon';
import {isImageAttachment,AttachmentThumb} from './attachment-image';
import type {ChatAttachmentRef} from '../../shared/types';

/* 发送前 composer 内的附件条(参考 piwork web 附件卡片):图片用缩略图,其余用类型图标;
   缩略图与文件名同属一个点击区(图片进全屏灯箱,其余进右侧 dock),移除按钮在右。 */
export function AttachmentChip({name,attachmentRef,onOpen,onRemove,removeLabel,previewLabel}:{
  name:string;attachmentRef?:ChatAttachmentRef;onOpen:(ref:ChatAttachmentRef)=>void;onRemove:()=>void;removeLabel:string;previewLabel:string;
}){
  const icon=attachmentRef&&isImageAttachment(attachmentRef)
    ?<AttachmentThumb cache={attachmentRef.cachePath!} name={name}
      className="size-6 shrink-0 rounded-md object-cover"
      fallbackClassName="grid size-6 shrink-0 place-items-center rounded-md bg-muted"/>
    :<FileTypeIcon className="size-4 shrink-0" filename={name}/>;
  return <div className="attachment-chip">
    {attachmentRef
      ?<button className="attachment-chip-preview" onClick={()=>onOpen(attachmentRef)} title={previewLabel} type="button">
        {icon}
        <span className="truncate">{name}</span>
      </button>
      :<>{icon}<span>{name}</span></>}
    <Button variant="ghost" size="icon-xs" type="button" onClick={onRemove} aria-label={removeLabel}><XIcon/></Button>
  </div>;
}
