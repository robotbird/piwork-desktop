import {lazy,Suspense,type ReactNode,type TransitionEvent} from 'react';
import {CompassIcon,FolderIcon,GlobeIcon,Maximize2Icon,Minimize2Icon,PanelRightIcon,PlusIcon,XIcon} from 'lucide-react';
import type {ProjectFile} from '../shared/types';
import {DockGuide} from './dock-guide';
import {BrowserTab} from './browser-tab';
import {FileTypeIcon} from '@/components/documents/file-type-icon';

const PptxPreview=lazy(()=>import('./pptx-preview').then(module=>({default:module.PptxPreview})));
const XlsxPreview=lazy(()=>import('./xlsx-preview').then(module=>({default:module.XlsxPreview})));
const DocxPreview=lazy(()=>import('./docx-preview').then(module=>({default:module.DocxPreview})));
const PdfPreview=lazy(()=>import('./pdf-preview').then(module=>({default:module.PdfPreview})));
const HtmlPreview=lazy(()=>import('./html-preview').then(module=>({default:module.HtmlPreview})));

/* 右侧常驻工具 dock(参考 deepseek-harness sidebar-right 的单 pane 多 tab 形态):
   guide(开始)/files(项目文件)/browser(内置浏览器)/document(文件预览)四类标签;
   所有已开标签的 body 常驻渲染(hidden 切换),浏览器 webview 因此在标签切换时保活。 */
export type DockFile={path:string;content:string;kind:'text'|'html'|'image'|'pdf'|'docx'|'xlsx'|'pptx'|'unsupported';cache?:string;label?:string;virtual?:boolean};
export type DockTabKind='guide'|'files'|'browser'|'document';
export type DockTab={id:string;kind:DockTabKind;title:string;file?:DockFile;url?:string;error?:string};

export interface PreviewDockWords{
  files:string;searchFiles:string;searchHint:string;noMatches:string;up:string;emptyFolder:string;
  attach:string;openExternal:string;reveal:string;unsupported:string;loading:string;fileError:string;
  collapsePreview:string;fullscreenPreview:string;exitFullscreenPreview:string;newTab:string;closeTab:string;guideStart:string;
}

export interface PreviewDockProps{
  tabs:DockTab[];activeTabId:string;
  onActivate:(id:string)=>void;onClose:(id:string)=>void;onNewTab:()=>void;
  collapsed:boolean;fullscreen:boolean;animating:boolean;
  width:number;resizer:ReactNode;
  onCollapse:(value:boolean)=>void;onFullscreen:(value:boolean)=>void;
  onTransitionEnd:(event:TransitionEvent)=>void;
  language:'zh-CN'|'en';words:PreviewDockWords;
  selected:string|null;
  // guide
  hasProject:boolean;onGuideFiles:()=>void;onGuideBrowser:()=>void;
  // files body
  files:ProjectFile[];folder:string;fileQuery:string;filesLoading:boolean;filesError:string;
  onFolderChange:(path:string)=>void;onFileQueryChange:(query:string)=>void;onOpenEntry:(entry:ProjectFile)=>void;
  // document body
  chatBusy:boolean;onAttach:(path:string)=>void;onTabError:(id:string,message:string)=>void;
  onOpenExternal:(file:DockFile)=>void;onReveal:(file:DockFile)=>void;
  // browser body
  onTitleChange:(id:string,title:string)=>void;onOpenUrlExternal:(url:string)=>void;
}

const TAB_ICONS={guide:CompassIcon,files:FolderIcon,browser:GlobeIcon} as const;

export function PreviewDock(props:PreviewDockProps){
  const {tabs,activeTabId,collapsed,fullscreen,animating,width,resizer,words:word}=props;
  return <aside
    className="file-preview"
    data-animating={animating||undefined}
    data-collapsed={collapsed||undefined}
    data-fullscreen={fullscreen&&!collapsed||undefined}
    aria-hidden={collapsed||undefined}
    onTransitionEnd={props.onTransitionEnd}
    style={{width:collapsed?0:width}}
  >
    {resizer}
    <div className="file-preview-inner" style={{width}}>
      <div className="dock-tabs" role="tablist">
        {tabs.map(tab=>{
          const Icon=tab.kind==='document'?undefined:TAB_ICONS[tab.kind];
          const active=tab.id===activeTabId;
          return <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            className={'dock-tab'+(active?' active':'')}
            tabIndex={active?0:-1}
            onClick={()=>props.onActivate(tab.id)}
          >
            {Icon?<Icon aria-hidden="true" className="size-3.5"/>:<FileTypeIcon className="size-3.5" filename={tab.title}/>}
            <span>{tab.kind==='guide'?word.guideStart:tab.title}</span>
            {tab.kind!=='guide'&&<button aria-label={word.closeTab} className="dock-tab-close" onClick={event=>{event.stopPropagation();props.onClose(tab.id)}} type="button"><XIcon aria-hidden="true" className="size-3"/></button>}
          </div>;
        })}
        <button aria-label={word.newTab} className="dock-new-tab" onClick={props.onNewTab} title={word.newTab} type="button"><PlusIcon className="size-3.5"/></button>
        <div className="dock-chrome">
          <button aria-label={fullscreen?word.exitFullscreenPreview:word.fullscreenPreview} onClick={()=>props.onFullscreen(!fullscreen)} title={fullscreen?word.exitFullscreenPreview:word.fullscreenPreview} type="button">{fullscreen?<Minimize2Icon className="size-3.5"/>:<Maximize2Icon className="size-3.5"/>}</button>
          <button aria-label={word.collapsePreview} onClick={()=>props.onCollapse(true)} title={word.collapsePreview} type="button"><PanelRightIcon className="size-3.5"/></button>
        </div>
      </div>
      {tabs.map(tab=>(
        <div key={tab.id} className="dock-body" hidden={tab.id!==activeTabId} inert={tab.id!==activeTabId||undefined} role="tabpanel">
          {tab.kind==='guide'&&<DockGuide hasProject={props.hasProject} language={props.language} onOpenBrowser={props.onGuideBrowser} onOpenFiles={props.onGuideFiles}/>}
          {tab.kind==='files'&&<FilesBody {...props}/>}
          {tab.kind==='browser'&&<div className="dock-body-pad browser-pad"><BrowserTab initialUrl={tab.url} language={props.language} onOpenExternal={props.onOpenUrlExternal} onTitleChange={title=>props.onTitleChange(tab.id,title)}/></div>}
          {tab.kind==='document'&&<DocumentBody {...props} tab={tab}/>}
        </div>
      ))}
    </div>
  </aside>;
}

function FilesBody({words:word,files,folder,fileQuery,filesLoading,filesError,onFolderChange,onFileQueryChange,onOpenEntry}:PreviewDockProps){
  return <div className="preview-file-list dock-file-list">
    <strong>{word.files}</strong>
    <span>{folder||'/'}</span>
    <label className="file-search"><span>{word.searchFiles}</span><input aria-label={word.searchFiles} maxLength={200} value={fileQuery} onChange={event=>onFileQueryChange(event.target.value)}/></label>
    {fileQuery.trim()&&<p>{word.searchHint}</p>}
    {folder&&!fileQuery.trim()&&<button className="file-row" onClick={()=>onFolderChange(folder.split('/').slice(0,-1).join('/'))} type="button">← {word.up}</button>}
    {files.map(entry=><button className="file-row" key={entry.path} onClick={()=>onOpenEntry(entry)} type="button"><span>{entry.kind==='directory'?'▱':'▤'}</span>{fileQuery.trim()?entry.path:entry.name}</button>)}
    {filesError&&<p className="error" role="alert">{filesError}</p>}
    {!filesError&&!files.length&&!filesLoading&&<p>{fileQuery.trim()?word.noMatches:word.emptyFolder}</p>}
  </div>;
}

function DocumentBody({tab,words:word,language,selected,chatBusy,onAttach,onTabError,onOpenExternal,onReveal}:PreviewDockProps&{tab:DockTab}){
  const file=tab.file;
  if(!file)return <p>{word.unsupported}</p>;
  return <div className="dock-body-pad document-pad">
    <p>{file.label??file.path}</p>
    {!file.virtual&&<div className="preview-actions">
      <button onClick={()=>onOpenExternal(file)} type="button">{word.openExternal}</button>
      <button onClick={()=>onReveal(file)} type="button">{word.reveal}</button>
    </div>}
    {tab.error&&<p className="error" role="alert">{tab.error}</p>}
    {file.kind==='text'&&!file.cache&&!file.virtual&&<button disabled={chatBusy} onClick={()=>onAttach(file.path)} type="button">{word.attach}</button>}
    {file.kind==='html'
      ?file.cache
        ?<Suspense fallback={<p>{word.loading}</p>}><HtmlPreview source={{kind:'attachment',cache:file.cache}} content={file.content} language={language}/></Suspense>
        :selected
          ?<Suspense fallback={<p>{word.loading}</p>}><HtmlPreview source={{kind:'project',projectId:selected,path:file.path}} content={file.content} language={language}/></Suspense>
          :<Suspense fallback={<p>{word.loading}</p>}><HtmlPreview source={{kind:'inline'}} content={file.content} language={language}/></Suspense>
      :file.kind==='unsupported'?<p>{word.unsupported}</p>
      :file.kind==='pptx'?<Suspense fallback={<p>{word.loading}</p>}><PptxPreview data={file.content} language={language}/></Suspense>
      :file.kind==='xlsx'?<Suspense fallback={<p>{word.loading}</p>}><XlsxPreview data={file.content} language={language}/></Suspense>
      :file.kind==='docx'?<Suspense fallback={<p>{word.loading}</p>}><DocxPreview data={file.content} language={language}/></Suspense>
      :file.kind==='pdf'?<Suspense fallback={<p>{word.loading}</p>}><PdfPreview data={file.content} language={language}/></Suspense>
      :file.kind==='image'?<img alt={file.path} className="preview-image" onError={()=>onTabError(tab.id,word.fileError)} src={file.content}/>
      :<pre>{file.content}</pre>}
  </div>;
}
