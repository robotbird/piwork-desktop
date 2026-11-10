import {Fragment, lazy, Suspense, useEffect, useState, type ReactNode} from 'react';
import {ArrowDownIcon, CheckIcon, CopyIcon, DownloadIcon, FileTextIcon, SparklesIcon} from 'lucide-react';
import {useStickToBottom} from 'use-stick-to-bottom';
import {Button} from '@/components/ui/button';
import {copyTextToClipboard} from '@/lib/utils';
import {FileTypeIcon} from '@/components/documents/file-type-icon';
import {GeneratedFiles,type DocumentAction} from './generated-files';
import {documentReferences,documentPath,uniqueDocumentPaths,type DocumentFolder} from './file-links';
import {isHtmlFile,splitAssistantHtml} from './assistant-html';
import {visibleAssistantText} from './assistant-text';
import {Processing,type ProcessCopy} from './processing';
import {ToolActivity,type ToolActivityCopy} from './tool-activity';
import {isImageAttachment,AttachmentThumb} from './attachment-image';
import type {ChatMessage,ChatAttachmentRef} from '../../shared/types';

const DocumentResponse=lazy(()=>import('./document-response').then(module=>({default:module.DocumentResponse})));

type Copy={
  process:ProcessCopy;
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

function ConversationMessage({message, latest, busy, copy, toolCopy, unexecutedToolRequest, onSave, onOpenToolFile, onOpenAttachment, onPreviewHtml, onDocumentAction, fileFolders}: {
  message:ChatMessage; latest:boolean; busy:boolean; copy:Copy; toolCopy:ToolActivityCopy;
  unexecutedToolRequest:string; fileFolders?:DocumentFolder[]; onDocumentAction?:(path:string,action:DocumentAction)=>void; onSave?:(text:string)=>void; onOpenToolFile?:(path:string)=>void;
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

  const {role,attachments,toolEvents,segments}=message;
  /* 携带技能发送的用户消息:气泡前置 ✨ 技能名标识(浅紫高亮,对齐 Codex 参考) */
  const skillName=role==='user'?message.skillName:undefined;
  const streaming=busy&&latest;
  const outputPaths=role==='assistant'?[...new Set([...documentReferences(segments?.filter(segment=>segment.kind==='text').map(segment=>segment.text).join('\n')||message.text),...(toolEvents??[]).flatMap(event=>event.status==='completed'&&['project_write','project_create_office'].includes(event.name)&&event.path&&documentPath(event.path)?[event.path]:[])])]:[];
  const outputCards=<GeneratedFiles paths={uniqueDocumentPaths(outputPaths,fileFolders)} onPreview={onOpenToolFile} onAction={onDocumentAction}/>;
  /* 分段交错渲染(对齐 pi 轮次语义/ZCode 展示):text 段与工具组段按时间线交替;
     segments 缺省(旧数据/异常兜底)走下方平铺路径 */
  if(role==='assistant'&&segments?.length){
    const blocks=segments.map(segment=>{
      if(segment.kind==='tools')return {kind:'tools' as const,tools:segment.tools};
      const separated=splitAssistantHtml(segment.text,streaming);
      const visible=visibleAssistantText(separated.text,streaming);
      return {kind:'text' as const,text:visible.text,html:separated.html,hiddenToolRequest:visible.hiddenToolRequest};
    });
    const anyText=blocks.some(block=>block.kind==='text'&&block.text);
    const anyTools=blocks.some(block=>block.kind==='tools'&&block.tools.length>0);
    const anyHidden=blocks.some(block=>block.kind==='text'&&block.hiddenToolRequest);
    const htmlFiles=[...new Set(toolEvents?.flatMap(event=>
      event.status==='completed'&&event.name==='project_write'&&event.path&&isHtmlFile(event.path)?[event.path]:[]
    ))];
    const totalHtml=blocks.reduce((count,block)=>count+(block.kind==='text'?block.html.length:0),0);
    const showUnexecuted=anyHidden&&!streaming&&!anyTools;
    const hasHtml=totalHtml>0||htmlFiles.length>0;
    const waiting=streaming&&!anyText&&!anyTools&&!hasHtml;
    if(!anyText&&!waiting&&!showUnexecuted&&!anyTools&&!hasHtml)return null;
    // A trailing text block is the answer; preceding text and tools form the process.
    const answerIndex=blocks.at(-1)?.kind==='text'?blocks.length-1:-1;
    const processBlocks=blocks.slice(0,answerIndex<0?blocks.length:answerIndex);
    const process=<Processing active={streaming} copy={copy.process} startedAt={message.startedAt} durationMs={message.durationMs}>
      {processBlocks.length>0?processBlocks.map((block,index)=>block.kind==='tools'
        ?<ToolActivity copy={toolCopy} events={block.tools} key={index} onOpenFile={onOpenToolFile}/>
        :block.text?<div className="conversation-step-description conversation-reply" key={index}>
          <Suspense fallback={<div className="conversation-text">{block.text}</div>}>
            <DocumentResponse onOpenFile={onOpenToolFile}>{block.text}</DocumentResponse>
          </Suspense>
        </div>:null):undefined}
    </Processing>;
    let htmlCounter=0;
    return (
      <article className="conversation-message" data-role={role}>
        <div className="conversation-message-body">
          {process}
          {waiting&&<p className="conversation-waiting" role="status">{copy.waiting}</p>}
          {showUnexecuted&&<p className="conversation-tool-progress">{unexecutedToolRequest}</p>}
          {blocks.map((block,index)=>{
            if(block.kind==='tools')return null;
            return (
              <Fragment key={index}>
                {index===answerIndex&&block.text&&(
                  <div className="conversation-reply">
                    <Suspense fallback={<div className="conversation-text">{block.text}</div>}>
                      <DocumentResponse onOpenFile={onOpenToolFile}>{block.text}</DocumentResponse>
                    </Suspense>
                  </div>
                )}
                {block.html.map(content=>{
                  htmlCounter+=1;
                  const name=totalHtml===1?'piwork-answer.html':`piwork-answer-${htmlCounter}.html`;
                  return <InlineHtmlCard content={content} copy={copy} key={name} name={name}
                    disabled={streaming||!onPreviewHtml} saving={savingHtml}
                    onPreview={onPreviewHtml??(()=>{})} onSave={(value,file)=>void saveHtml(value,file)}/>;
                })}
              </Fragment>
            );
          })}
          {outputCards}
          {htmlSaveResult&&<p className="conversation-tool-progress" role="status">{htmlSaveResult}</p>}
        </div>
        {anyText&&!busy&&(
          <div className="conversation-message-actions">
            <Button
              aria-label={copy.copy}
              className="text-muted-foreground"
              onClick={async()=>setCopyResult(await copyTextToClipboard(message.text)?'success':'failed')}
              size="icon-sm"
              title={copy.copy}
              type="button"
              variant="ghost"
            >
              {copyResult==='success'?<CheckIcon/>:<CopyIcon/>}
            </Button>
            {onSave&&<Button className="conversation-save" size="sm" type="button" variant="ghost" onClick={()=>onSave(message.text)}>{copy.saveAnswer}</Button>}
            {copyResult&&<span className={copyResult==='success'?'sr-only':'text-xs text-muted-foreground'} role="status">
              {copyResult==='success'?copy.copied:copy.copyFailed}
            </span>}
          </div>
        )}
      </article>
    );
  }
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
        {role==='assistant'&&<Processing active={streaming} copy={copy.process} startedAt={message.startedAt} durationMs={message.durationMs}>
          {toolEvents?.length?<ToolActivity events={toolEvents} copy={toolCopy} onOpenFile={onOpenToolFile}/>:undefined}
        </Processing>}
        {/* 输入附件(多选):可回溯到项目路径/缓存副本/旧版存储的文本内容时点击预览,否则保持纯展示;图片用缩略图卡片(点击进全屏灯箱) */}
        {(attachments?.length ?? 0) > 0 && (
          <div className="conversation-attachments">
            {attachments!.map((attachment,index)=>{
              const {name,ref}=attachment;
              if(ref && onOpenAttachment && (ref.projectPath || ref.cachePath || ref.textContent!==undefined)){
                return isImageAttachment(ref)
                  ?<button className="conversation-attachment conversation-attachment-image" key={`${name}:${index}`} title={name}
                    type="button" onClick={()=>onOpenAttachment(ref)}>
                    <AttachmentThumb cache={ref.cachePath!} name={name}
                      className="conversation-thumb" fallbackClassName="conversation-thumb conversation-thumb-fallback"/>
                    <span className="truncate">{name}</span>
                  </button>
                  :<button className="conversation-attachment conversation-attachment-open" key={`${name}:${index}`} title={name}
                    type="button" onClick={()=>onOpenAttachment(ref)}>
                    <FileTypeIcon className="size-7" filename={name}/>
                    <span className="truncate">{name}</span>
                  </button>;
              }
              return <div className="conversation-attachment" key={`${name}:${index}`} title={name}>
                <FileTypeIcon className="size-7" filename={name}/>
                <span className="truncate">{name}</span>
              </div>;
            })}
          </div>
        )}
        {hasHtml&&(
          <div className="conversation-html-files">
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
              <DocumentResponse onOpenFile={onOpenToolFile}>{text}</DocumentResponse>
            </Suspense>
          </div>
        ) : <div className={'conversation-bubble conversation-text'+(skillName?' conversation-bubble-skill':'')}>{skillName&&<span className="conversation-skill-tag"><SparklesIcon aria-hidden className="size-3.5"/>{skillName}</span>}{text}</div>}
        {outputCards}
        {showUnexecuted&&<p className="conversation-tool-progress">{unexecutedToolRequest}</p>}
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

export function Conversation({messages,busy,copy,context,toolCopy,unexecutedToolRequest,onSave,onOpenToolFile,onOpenAttachment,onPreviewHtml,onDocumentAction,fileFolders}: {
  messages:ChatMessage[]; busy:boolean; copy:Copy; context?:ReactNode; toolCopy:ToolActivityCopy; unexecutedToolRequest:string;
  fileFolders?:DocumentFolder[]; onDocumentAction?:(path:string,action:DocumentAction)=>void; onSave?:(text:string)=>void; onOpenToolFile?:(path:string)=>void; onOpenAttachment?:(ref:ChatAttachmentRef)=>void; onPreviewHtml?:(content:string,name:string)=>void;
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
              fileFolders={fileFolders}
              onDocumentAction={onDocumentAction}
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
