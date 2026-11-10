import path from 'node:path';
import type {ImageContent} from '@earendil-works/pi-ai';
import type {ChatMessageAttachment} from '../shared/types.ts';
import {readBoundedText,readProjectImage,readProjectText,splitProjectPath,type ProjectRoot} from './project-files.ts';
import {readDocumentText} from './file-text.ts';

const PROJECT_FILE_MARKER='\n\nProject file selected by the user (JSON data):\n';
const PICKED_FILE_MARKER='\n\nFile selected by the user (JSON data):\n';
const MAX_ATTACHMENT_BYTES=64*1024;
const MAX_ATTACHMENT_CHARS=64000;
/** The model receives only a project file explicitly selected for this message. */
export async function addProjectTextAttachment(text:string,roots:ProjectRoot[],relative:string):Promise<string>{
 if(typeof relative!=='string'||!relative||relative.length>4096)throw new Error('Invalid attachment');
 const target=splitProjectPath(roots,relative);
 const content=await readProjectText(target.root,target.relative);
 if(Buffer.byteLength(content,'utf8')>MAX_ATTACHMENT_BYTES)throw new Error('Attachment too large');
 return `${text}${PROJECT_FILE_MARKER}${JSON.stringify({path:relative,content})}`;
}

export type PickedAttachmentContent =
  | {kind:'text';content:string}
  | {kind:'image';image:ImageContent};

/** 任意本地文件:图片按图片发送;PDF/Office 提取文字;其余扩展名按有界文本读取,过长截断。 */
export async function readChatAttachment(root:string,relative:string):Promise<PickedAttachmentContent>{
 if (/\.(png|jpe?g|gif|webp)$/i.test(relative)) {
  const {mime,base64}=await readProjectImage(root,relative);
  return {kind:'image',image:{type:'image',mimeType:mime,data:base64}};
 }
 const ext=path.extname(relative).toLowerCase();
 const content=['.pdf','.docx','.xlsx','.pptx'].includes(ext)
  ? await readDocumentText(root,relative)
  : await readBoundedText(root,relative);
 return {kind:'text',content:content.length>MAX_ATTACHMENT_CHARS?`${content.slice(0,MAX_ATTACHMENT_CHARS)}\n[Text truncated]`:content};
}

export function addPickedAttachment(text:string,name:string,attachment:PickedAttachmentContent,cache?:string):string{
 const file=attachment.kind==='text'
  ?{name,content:attachment.content,...(cache?{cache}:{})}
  :{name,...(cache?{cache}:{})};
 return `${text}${PICKED_FILE_MARKER}${JSON.stringify(file)}`;
}


export function splitChatAttachment(text:string):{text:string;attachments?:ChatMessageAttachment[]}{
 const attachments:ChatMessageAttachment[]=[];
 let rest=text;
 for(;;){
  // 从尾部逐个剥离 marker:多附件按发送顺序追加,先剥最后一个;单附件旧消息等价(取两种 marker 的最晚出现处)
  let marker='';let index=-1;
  for(const candidate of [PICKED_FILE_MARKER,PROJECT_FILE_MARKER]){
   const at=rest.lastIndexOf(candidate);
   if(at>index){index=at;marker=candidate}
  }
  if(index<0)break;
  try{
   const attachment=JSON.parse(rest.slice(index+marker.length));
   const name=marker===PROJECT_FILE_MARKER?attachment?.path:attachment?.name;
   if(typeof name==='string'&&name&&
      (typeof attachment.content==='string'||(marker===PICKED_FILE_MARKER&&(Object.keys(attachment).length===1||typeof attachment.cache==='string')))){
    const projectPath=marker===PROJECT_FILE_MARKER?name:undefined;
    const cachePath=marker===PICKED_FILE_MARKER&&typeof attachment.cache==='string'&&attachment.cache?attachment.cache:undefined;
    // 旧版历史消息没有缓存副本:文本附件至少能用 marker 里存的内容做纯文本预览
    const textContent=marker===PICKED_FILE_MARKER&&!cachePath&&typeof attachment.content==='string'&&attachment.content?attachment.content:undefined;
    attachments.unshift({name:path.basename(name),ref:{name:path.basename(name),...(projectPath?{projectPath}:{}),...(cachePath?{cachePath}:{}),...(textContent?{textContent}:{})}});
    rest=rest.slice(0,index);
    continue;
   }
  }catch{
   // Preserve messages whose text only resembles an attachment marker.
  }
  break;
 }
 return attachments.length?{text:rest,attachments}:{text};
}
