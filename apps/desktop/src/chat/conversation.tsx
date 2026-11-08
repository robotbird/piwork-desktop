import {lazy, Suspense, useEffect, useState, type ReactNode} from 'react';
import {ArrowDownIcon, CheckIcon, CopyIcon, DownloadIcon, FileTextIcon, SparklesIcon} from 'lucide-react';
import {useStickToBottom} from 'use-stick-to-bottom';
import {Button} from '@/components/ui/button';
import {copyTextToClipboard} from '@/lib/utils';
import {FileTypeIcon} from '@/components/documents/file-type-icon';
import {isHtmlFile,splitAssistantHtml} from './assistant-html';
import {visibleAssistantText} from './assistant-text';
import {ToolActivity,type ToolActivityCopy} from './tool-activity';
import {isImageAttachment,AttachmentThumb} from './attachment-image';
import type {ChatMessage,ChatAttachmentRef} from '../../shared/types';

const MessageResponse=lazy(async()=>{
  const module=await import('@/components/ai-elements/message');
  return {default:module.MessageResponse};
});

type Copy={
  waiting:string;
  scrollToBottom:string;
  copy:string;
  copied:string;
  copyFailed:string;
  saveAnswer:string;
  saveHtml:string;
  htmlSaved:string;
  htmlSaveFailed:string;
  openHtml:string;
  preview:string;
};

function HtmlFileCard({name,action,onClick,disabled=false}:{
  name:string; action:string; onClick:()=>void; disabled?:boolean;
}) {
  return (
    <button className="conversation-attachment conversation-html-file" type="button"
      title={`${name} · ${action}`} aria-label={`${action} · ${name}`} disabled={disabled} onClick={onClick}>
      <FileTypeIcon className="size-7" filename={name} fallback={<FileTextIcon aria-hidden="true" className="size-7"/>}/>
      <span>HTML</span>
      <span className="truncate">{name}</span>
    </button>
  );
}

/* 回复中的内联 HTML(未落盘):卡片点击直接在右侧预览,保存降为旁边的次按钮 */
function InlineHtmlCard({name,content,copy,disabled,saving,onPreview,onSave}:{
  name:string; content:string; copy:Copy; disabled?:boolean; saving?:boolean;
  onPreview:(content:string,name:string)=>void; onSave:(content:string,name:string)=>void;
}) {
  return (
    <div className="conversation-html-inline">
      <HtmlFileCard action={copy.preview} name={name} disabled={disabled} onClick={()=>onPreview(content,name)}/>
      <button aria-label={copy.saveHtml} className="conversation-html-save" disabled={disabled||saving}
        onClick={()=>onSave(content,name)} title={copy.saveHtml} type="button">
        <DownloadIcon aria-hidden="true" className="size-4"/>
      </button>
    </div>
  );
}

function ConversationMessage({message, latest, busy, copy, toolCopy, unexecutedToolRequest, onSave, onOpenToolFile, onOpenAttachment, onPreviewHtml}: {
  message:ChatMessage; latest:boolean; busy:boolean; copy:Copy; toolCopy:ToolActivityCopy;
  unexecutedToolRequest:string; onSave?:(text:string)=>void; onOpenToolFile?:(path:string)=>void;
  onOpenAttachment?:(ref:ChatAttachmentRef)=>void; onPreviewHtml?:(content:string,name:string)=>void;
}) {
  const [copyResult,setCopyResult]=useState<'success'|'failed'>();
  const [savingHtml,setSavingHtml]=useState(false);
  const [htmlSaveResult,setHtmlSaveResult]=useState('');
  async function saveHtml(content:string,name:string) {
    setSavingHtml(true);
    setHtmlSaveResult('');
    try {
      if(await window.desktop.saveHtml(content,name)){setHtmlSaveResult(copy.htmlSaved);window.dispatchEvent(new Event('piwork:library-changed'))}
    }catch{
      setHtmlSaveResult(copy.htmlSaveFailed);
    }finally{
      setSavingHtml(false);
    }
  }
  useEffect(()=>{
    if(!copyResult)return;
    const timeout=setTimeout(()=>setCopyResult(undefined),2000);
    return()=>clearTimeout(timeout);
  },[copyResult]);

  const {role,attachmentName,attachment,toolEvents}=message;
  /* 携带技能发送的用户消息:气泡前置 ✨ 技能名标识(浅紫高亮,对齐 Codex 参考) */
  const skillName=role==='user'?message.skillName:undefined;
  const streaming=busy&&latest;
  const separated=role==='assistant'?splitAssistantHtml(message.text,streaming):{text:message.text,html:[]};
  const {text,hiddenToolRequest}=role==='assistant'
    ?visibleAssistantText(separated.text,streaming):{text:separated.text,hiddenToolRequest:false};
  const htmlFiles=[...new Set(toolEvents?.flatMap(event=>
    event.status==='completed'&&event.name==='project_write'&&event.path&&isHtmlFile(event.path)?[event.path]:[]
  ))];
  const hasHtml=separated.html.length>0||htmlFiles.length>0;
  const waiting=streaming&&role==='assistant'&&!text&&!toolEvents?.length&&!hasHtml;
  const showUnexecuted=hiddenToolRequest&&!streaming&&!toolEvents?.length;
  if(!text&&!waiting&&!showUnexecuted&&!toolEvents?.length&&!hasHtml)return null;

  return (
    <article className="conversation-message" data-role={role}>
      <div className="conversation-message-body">
        {/* 输入附件:可回溯到项目路径/缓存副本/旧版存储的文本内容时点击预览,否则保持纯展示;图片用缩略图卡片(点击进全屏灯箱) */}
        {attachmentName && attachment && onOpenAttachment && (attachment.projectPath || attachment.cachePath || attachment.textContent!==undefined) ? (
          isImageAttachment(attachment)
            ?<button className="conversation-attachment conversation-attachment-image" title={attachmentName}
              type="button" onClick={()=>onOpenAttachment(attachment)}>
              <AttachmentThumb cache={attachment.cachePath!} name={attachmentName}
                className="conversation-thumb" fallbackClassName="conversation-thumb conversation-thumb-fallback"/>
              <span className="truncate">{attachmentName}</span>
            </button>
            :<button className="conversation-attachment conversation-attachment-open" title={attachmentName}
              type="button" onClick={()=>onOpenAttachment(attachment)}>
              <FileTypeIcon className="size-7" filename={attachmentName}/>
              <span className="truncate">{attachmentName}</span>
            </button>
        ) : attachmentName && (
          <div className="conversation-attachment" title={attachmentName}>
            <FileTypeIcon className="size-7" filename={attachmentName}/>
            <span className="truncate">{attachmentName}</span>
          </div>
        )}
        {hasHtml&&(
          <div className="conversation-html-files">
            {htmlFiles.map(path=>(
              <HtmlFileCard action={copy.openHtml} name={path.split('/').at(-1)??path} key={path}
                disabled={!onOpenToolFile} onClick={()=>onOpenToolFile?.(path)}/>
            ))}
            {separated.html.map((content,index)=>{
              const name=separated.html.length===1?'piwork-answer.html':`piwork-answer-${index+1}.html`;
              return <InlineHtmlCard copy={copy} content={content} key={name} name={name}
                disabled={streaming||!onPreviewHtml} saving={savingHtml}
                onPreview={onPreviewHtml??(()=>{})} onSave={(value,file)=>void saveHtml(value,file)}/>;
            })}
          </div>
        )}
        {htmlSaveResult&&<p className="conversation-tool-progress" role="status">{htmlSaveResult}</p>}
        {waiting ? (
          <p className="conversation-waiting" role="status">{copy.waiting}</p>
        ) : role==='assistant' ? text&&(
          <div className="conversation-reply">
            <Suspense fallback={<div className="conversation-text">{text}</div>}>
              <MessageResponse skipHtml disallowedElements={['img']}>{text}</MessageResponse>
            </Suspense>
          </div>
        ) : <div className={'conversation-bubble conversation-text'+(skillName?' conversation-bubble-skill':'')}>{skillName&&<span className="conversation-skill-tag"><SparklesIcon aria-hidden className="size-3.5"/>{skillName}</span>}{text}</div>}
        {showUnexecuted&&<p className="conversation-tool-progress">{unexecutedToolRequest}</p>}
        {!!toolEvents?.length&&<ToolActivity events={toolEvents} copy={toolCopy} onOpenFile={onOpenToolFile}/>}
      </div>
      {role==='assistant'&&text&&!busy&&(
        <div className="conversation-message-actions">
          <Button
            aria-label={copy.copy}
            className="text-muted-foreground"
            onClick={async()=>setCopyResult(await copyTextToClipboard(text)?'success':'failed')}
            size="icon-sm"
            title={copy.copy}
            type="button"
            variant="ghost"
          >
            {copyResult==='success'?<CheckIcon/>:<CopyIcon/>}
          </Button>
          {onSave&&<Button className="conversation-save" size="sm" type="button" variant="ghost" onClick={()=>onSave(text)}>{copy.saveAnswer}</Button>}
          {copyResult&&<span className={copyResult==='success'?'sr-only':'text-xs text-muted-foreground'} role="status">
            {copyResult==='success'?copy.copied:copy.copyFailed}
          </span>}
        </div>
      )}
    </article>
  );
}

export function Conversation({messages,busy,copy,context,toolCopy,unexecutedToolRequest,onSave,onOpenToolFile,onOpenAttachment,onPreviewHtml}: {
  messages:ChatMessage[]; busy:boolean; copy:Copy; context?:ReactNode; toolCopy:ToolActivityCopy; unexecutedToolRequest:string;
  onSave?:(text:string)=>void; onOpenToolFile?:(path:string)=>void; onOpenAttachment?:(ref:ChatAttachmentRef)=>void; onPreviewHtml?:(content:string,name:string)=>void;
}) {
  const {scrollRef,contentRef,isNearBottom,scrollToBottom}=useStickToBottom({
    initial:'instant',
    resize:'instant',
  });
  useEffect(()=>{
    if(busy)void scrollToBottom('instant');
  },[busy,scrollToBottom]);

  return (
    <section className="conversation">
      <div className="conversation-scroll" ref={scrollRef}>
        <div className="conversation-messages" ref={contentRef}>
          {context}
          {messages.map((message,index)=>(
            <ConversationMessage
              busy={busy}
              copy={copy}
              key={index}
              message={message}
              onSave={onSave}
              latest={index===messages.length-1}
              toolCopy={toolCopy}
              unexecutedToolRequest={unexecutedToolRequest}
              onOpenAttachment={onOpenAttachment}
              onOpenToolFile={onOpenToolFile}
              onPreviewHtml={onPreviewHtml}
            />
          ))}
        </div>
      </div>
      {!isNearBottom&&(
        <Button
          aria-label={copy.scrollToBottom}
          className="conversation-jump"
          onClick={()=>void scrollToBottom()}
          size="sm"
          title={copy.scrollToBottom}
          type="button"
          variant="outline"
        >
          <ArrowDownIcon className="size-3 text-muted-foreground"/>
        </Button>
      )}
    </section>
  );
}
