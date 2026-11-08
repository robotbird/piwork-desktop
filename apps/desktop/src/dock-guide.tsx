import {FolderIcon,GlobeIcon,CompassIcon} from 'lucide-react';

/* 开始页(guide tab,参考 deepseek-harness GuideBody):罗盘 hero + 工具卡片;点击开对应标签并替换 guide */
export function DockGuide({language,hasProject,onOpenFiles,onOpenBrowser}:{language:'zh-CN'|'en';hasProject:boolean;onOpenFiles:()=>void;onOpenBrowser:()=>void}){
  const zh=language==='zh-CN';
  const isMac=navigator.platform.toLowerCase().includes('mac');
  return <div className="dock-guide" data-dock-guide>
    <CompassIcon aria-hidden="true" className="dock-guide-compass" size={56} strokeWidth={1.2}/>
    <button className="guide-card" disabled={!hasProject} onClick={onOpenFiles} title={!hasProject?(zh?'先选择项目':'Choose a project first'):undefined} type="button">
      <span className="guide-card-icon"><FolderIcon size={22}/></span>
      <span className="guide-card-text"><strong>{zh?'工作区文件':'Workspace files'}</strong><small>{zh?'浏览项目文件':'Browse project files'}</small></span>
      <kbd>{isMac?'⌘P':'Ctrl+P'}</kbd>
    </button>
    <button className="guide-card" onClick={onOpenBrowser} type="button">
      <span className="guide-card-icon guide-card-icon-browser"><GlobeIcon size={22}/></span>
      <span className="guide-card-text"><strong>{zh?'浏览器':'Browser'}</strong><small>{zh?'浏览网页':'Browse the web'}</small></span>
      <kbd>{isMac?'⌘T':'Ctrl+T'}</kbd>
    </button>
  </div>;
}
