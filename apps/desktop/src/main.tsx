import {projectDocumentPath} from './chat/file-links';
import React, {lazy,Suspense,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Preferences, Project, ProjectFile, GatewayConfig, ChatSummary, LocalSkill, AccountStatus, PickedAttachment, ChatMessage, ChatAttachmentRef, ApprovalDecision, QuestionResponse, ToolEvent} from '../shared/types';
import {PreviewDock,type DockFile,type DockTab} from './preview-dock';
import {usePreviewWidth,usePreviewCollapse} from './preview-resizer';
import {Skills} from './skills';
import {Schedules} from './web/components/scheduled-tasks/scheduled-tasks-panel';
import {DocumentLibrary} from './documents/library-page';
import {LibraryFilePicker} from './documents/library-picker';
import {libraryStrings} from './documents/strings';
import {Toaster,toast} from 'sonner';
import {SettingsPage,type SettingsSectionId} from './settings';
import {WebHistory} from './web-history';
import {BoxIcon,LogOutIcon,MoonIcon,Settings2Icon,SquarePenIcon,FileTextIcon,Clock3Icon,Grid2X2Icon,FolderIcon,SearchIcon,PanelLeftCloseIcon,PanelLeftOpenIcon,SettingsIcon,PlugIcon,PlusIcon,SunIcon,ChevronUpIcon,ChevronRightIcon,UserRoundIcon,XIcon,PencilIcon,PanelRightIcon,ArrowUpCircleIcon} from 'lucide-react';
import {cn} from '@/lib/utils';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuLabel,DropdownMenuSeparator,DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {Button} from '@/components/ui/button';
import {ArrowUpIcon, StopIcon} from '@/components/chat/icons';
import {FileTypeIcon} from '@/components/documents/file-type-icon';
import {PendingInteractionDock,usePendingInteractions} from './chat/pending-interactions';
import {Conversation} from './chat/conversation';
import {AttachmentChip} from './chat/attachment-chip';
import {Lightbox,type LightboxState} from './lightbox';
import {isImageName} from './documents/library-thumb';
import {isHtmlFile} from './chat/assistant-html';
import {AttachmentsMenu, ComposerModelMenu, ComposerPermissionMenu, ComposerProjectMenu} from './chat/composer-menus';
import {CreateProjectDialog, EditProjectDialog, type ProjectDialogCopy} from './projects/project-dialogs';
import {ProjectHome, type ProjectHomeCopy} from './projects/project-home';
import zhMessages from '@/i18n/messages/zh.json';
import enMessages from '@/i18n/messages/en.json';
import {BrandSmoke} from './brand-smoke';
import {WebIntlProvider} from './web-intl-provider';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles.css';
import './web/app/globals.css';
const attachmentReadError={
  'zh-CN':'无法添加此文件。支持文本或代码文件、PDF 及 Office 文档（自动提取文字），和 10 MB 以内的 PNG、JPEG、GIF、WebP 图片；其他二进制文件无法发送。',
  en:'Could not add this file. Text and code files, PDF and Office documents (text is extracted automatically), and PNG, JPEG, GIF or WebP images up to 10 MB are supported; other binary files cannot be sent.',
};
/* 读取粘贴的图片文件为 base64(readAsDataURL 结果截去 data: 前缀) */
function readFileAsBase64(file:File):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>{const result=String(reader.result);resolve(result.slice(result.indexOf(',')+1))};reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)})}
const words={ 'zh-CN':{newChat:'新对话',chooseProject:'项目',addFile:'添加文件',addCapabilities:'添加内容与能力',model:'模型',configureModels:'配置模型…',documents:'我的文档',searchChats:'搜索对话',collapseSidebar:'收起侧栏',expandSidebar:'展开侧栏',projects:'项目',createProject:'创建项目',projectFolder:'项目文件夹',existingProject:'该目录已存在项目，已切换到已有项目。',cancel:'取消',editProject:'编辑项目',projectName:'项目名称',projectDescription:'项目说明',projectSaveFailed:'保存项目失败，请检查名称和说明。',searchFiles:'搜索项目文件名',searchHint:'最多显示 100 条结果，搜索前 10000 个文件及目录。',noMatches:'没有匹配的文件',projectAccessFailed:'无法读取此项目目录，请检查目录是否存在及访问权限。',toolRunning:'执行中',toolCompleted:'已完成',toolFailed:'执行失败',toolDenied:'用户未批准或已取消',toolChanged:'文件已变化，请重新执行',toolInvalid:'文件路径或类型不受支持',toolError:'请检查文件或工具配置',toolBash:'执行本机命令',toolSkillRead:'读取技能资源',toolList:'浏览项目文件',toolRead:'读取项目文件',toolWrite:'写入项目文件',toolOffice:'生成 Office 文件',toolActivity:'工具执行',toolInterrupted:'未完成',toolParams:'参数',toolOutput:'输出',toolExpandAll:'全部展开',toolCollapseAll:'全部收起',toolShowLess:'收起',toolMoreLines:'…还有 {n} 行',permissionLabel:'权限',permConfirm:'变更前确认',permConfirmHint:'执行命令、写入文件前先问我',permAuto:'自主模式',permAutoHint:'命令自动执行，仅写入文件时确认',permFull:'完全访问',permFullHint:'自动批准所有工具执行，不再弹出确认',projectContextNoticeFull:'任务可读取项目文本、PDF、Office 文字及已启用的图片并发送给模型。',toolGroupBrowse:'查阅',toolGroupRun:'执行',toolGroupWrite:'写入',toolGroupFiles:'文件',toolGroupSearches:'次搜索',toolGroupFetches:'次网页抓取',toolGroupCommands:'条命令',toolGroupWrites:'次写入',toolGroupCalls:'次调用',unexecutedToolRequest:'模型返回了工具请求文本，未执行任何工具。',missingProjectToolHint:'如需读取本地目录，请在新对话中选择项目，或通过加号添加相关文件。',recent:'最近对话',empty:'选择一个项目，开始工作',description:'添加本地文件夹，整理资料并开展任务。',add:'添加项目',settings:'设置',updateBanner:'新版本 {version}',accountAndSync:'账号与同步',modelGateway:'模型网关',piPlugins:'插件管理',skills:'技能',noSkill:'不使用技能',schedules:'定时任务',appearance:'外观',language:'语言',system:'跟随系统',light:'浅色',dark:'深色',close:'关闭',unavailable:'目录不可用',rebind:'重新选择文件夹',rebindFailed:'无法绑定文件夹，请检查是否已被其他项目使用。',remove:'移除项目',confirm:'仅从列表中移除项目，不会删除本地文件。确定移除？',failed:'操作失败，请重试。',placeholder:'描述你想完成的任务…',soon:'对话功能正在开发中',title:'工作空间',projectMissing:'关联项目已移除',originalProjectPath:'此对话使用原项目目录：',projectContextNotice:'任务可读取项目文本、PDF、Office 文字及已启用的图片并发送给模型；写入前需要确认。',attach:'加入对话',attached:'已选择文件，发送时将其文本或图片提交给当前模型；过长内容将自动截断。',removeAttachment:'移除附件',attachmentLimit:'一次最多发送 10 个附件。',attachmentFailed:'发送失败，请检查附件类型（文本、PDF、Office 文档或图片）及网关配置。',send:'发送',stop:'停止',chatFailed:'对话未能完成，请检查模型网关、所选技能或 MCP 配置。',sessionBusy:'上一个请求仍在进行中。请点停止按钮结束，或稍候重试。',syncSendUnavailable:'无法连接同步服务或确认任务状态。草稿已保留，请检查网络和登录后重试。',syncSendConflict:'两端对话记录不一致，请检查 Web 对话；草稿已保留。',syncSendBusy:'同步正在进行，请稍后重试；草稿已保留。',syncTaskRunning:'此对话正在另一端执行，请等待任务结束后重试；草稿已保留。',syncOldChat:'同步仅支持新对话；请关闭同步后继续此对话，或创建新对话。',accountQuota:'账号用量已达限制，请联系管理员。',accountForbidden:'账号无权使用此模型。',accountExpired:'账号登录已失效，请重新登录。',historyFailed:'无法打开对话记录，文件可能不存在或已损坏。',renameChat:'重命名对话',deleteChat:'删除对话',deleteChatConfirm:'删除这条对话？本地会话文件将移入应用回收目录。',aborted:'已停止',configure:'请先在设置中配置模型网关。',gateway:'自定义模型网关',gatewayUrl:'网关地址',modelId:'模型 ID',apiKey:'API Key',imageSupport:'模型支持图片输入',keyHint:'已保存；留空保持不变',save:'保存',gatewaySaved:'网关配置已保存',gatewayFail:'保存失败，请检查地址和系统安全存储。',openExternal:'用默认应用打开',reveal:'在访达中显示',openFailed:'无法打开文件，请检查文件是否存在及系统权限。',unsupported:'此文件暂不支持预览，可尝试用系统应用打开。',saveAnswer:'保存为 Markdown',saveHtml:'保存 HTML 文件',htmlSaved:'HTML 文件已保存',htmlSaveFailed:'无法保存 HTML 文件，请选择新的 .html 文件名。',saveAnswerFailed:'保存失败：请选择新的 .md 文件名，并检查目录权限。',files:'项目文件',up:'上一级',loading:'正在加载…',emptyFolder:'文件夹为空',preview:'文件预览',guideStart:'开始',newTab:'新建标签',closeTab:'关闭标签',collapsePreview:'收起侧边栏',expandPreview:'打开侧边栏',fullscreenPreview:'全屏预览',exitFullscreenPreview:'退出全屏',fileUnavailable:'文件不存在或没有访问权限，请检查文件位置和权限。',fileError:'无法预览此文件。支持 1 MB 以内的文本和 10 MB 以内的常见图片和 20 MB 以内的 PDF、DOCX、XLSX 和 PPTX。',sourceFolders:'源文件夹',addFromComputer:'在此电脑上添加文件夹',addFolder:'添加文件夹',mainBadge:'主要',setMain:'设为主要',removeFolder:'移除文件夹',removeLocalProject:'移除本地项目',writeHint:'所有源文件夹均可读取；文件仅写入主文件夹。'},en:{syncSendUnavailable:'Cannot reach the sync service or confirm the task state. Your draft is preserved; check your connection and sign-in.',syncSendConflict:'The conversation histories differ. Check the Web conversation; your draft is preserved.',syncSendBusy:'Sync is in progress. Try again; your draft is preserved.',syncTaskRunning:'This conversation is running on another device. Wait for it to finish; your draft is preserved.',syncOldChat:'Sync supports new conversations only. Turn off sync to continue this chat, or start a new one.',newChat:'New chat',chooseProject:'Project',addFile:'Add file',addCapabilities:'Add content and capabilities',model:'Model',configureModels:'Configure model…',documents:'My documents',searchChats:'Search chats',collapseSidebar:'Collapse sidebar',expandSidebar:'Expand sidebar',projects:'Projects',createProject:'Create project',projectFolder:'Project folder',existingProject:'This folder already belongs to a project. Switched to the existing project.',cancel:'Cancel',editProject:'Edit project',projectName:'Project name',projectDescription:'Description',projectSaveFailed:'Could not save project. Check the name and description.',searchFiles:'Search project filenames',searchHint:'Shows up to 100 matches from the first 10,000 files and folders.',noMatches:'No matching files',projectAccessFailed:'Cannot read this project folder. Check that it exists and is accessible.',toolRunning:'Running',toolCompleted:'Completed',toolFailed:'Failed',toolDenied:'Not approved or cancelled',toolChanged:'File changed; try again',toolInvalid:'Unsupported file path or type',toolError:'Check the file or tool configuration',toolBash:'Run local command',toolSkillRead:'Read skill resource',toolList:'List project files',toolRead:'Read project file',toolWrite:'Write project file',toolOffice:'Create Office file',toolActivity:'Tool activity',toolInterrupted:'Interrupted',toolParams:'Input',toolOutput:'Output',toolExpandAll:'Expand all',toolCollapseAll:'Collapse all',toolShowLess:'Show less',toolMoreLines:'…{n} more lines',permissionLabel:'Permissions',permConfirm:'Confirm before changes',permConfirmHint:'Ask me before running commands or writing files',permAuto:'Autonomous',permAutoHint:'Run commands automatically; confirm file writes only',permFull:'Full access',permFullHint:'Approve every tool call without asking',projectContextNoticeFull:'The task may send project text, PDFs, Office document text and enabled images to the model.',toolGroupBrowse:'Consult',toolGroupRun:'Run',toolGroupWrite:'Write',toolGroupFiles:'files',toolGroupSearches:'searches',toolGroupFetches:'web fetches',toolGroupCommands:'commands',toolGroupWrites:'writes',toolGroupCalls:'calls',unexecutedToolRequest:'The model returned a tool request as text. No tools ran.',missingProjectToolHint:'To use local files, select a project in a new chat or attach the files using the add button.',recent:'Recent chats',empty:'Choose a project to get started',description:'Add a local folder to organize your work.',add:'Add project',settings:'Settings',updateBanner:'New version {version}',accountAndSync:'Account & sync',modelGateway:'Model gateway',piPlugins:'Plugins',skills:'Skills',noSkill:'No skill',schedules:'Scheduled tasks',appearance:'Appearance',language:'Language',system:'System',light:'Light',dark:'Dark',close:'Close',unavailable:'Folder unavailable',rebind:'Choose folder again',rebindFailed:'Unable to bind folder. It may already belong to another project.',remove:'Remove project',confirm:'Remove this project from the list? Local files will not be deleted.',failed:'Something went wrong. Please try again.',placeholder:'Describe what you want to do…',soon:'Chat is coming soon',title:'Workspace',projectMissing:'Linked project removed',originalProjectPath:'This chat uses its original project folder: ',projectContextNotice:'The task may send project text, PDFs, Office document text and enabled images to the model; writing requires confirmation.',attach:'Add to chat',attached:'The selected file will be sent to the current model as text or an image; long content is truncated automatically.',removeAttachment:'Remove attachment',attachmentLimit:'Up to 10 attachments can be sent per message.',attachmentFailed:'Send failed. Check the attachment type (text, PDF, Office document or image) and the gateway.',send:'Send',stop:'Stop',chatFailed:'Chat could not finish. Check the model gateway, selected skill or MCP settings.',sessionBusy:'A request is still running. Press stop to end it, or retry shortly.',accountQuota:'Account usage limit reached. Contact an administrator.',accountForbidden:'Your account cannot use this model.',accountExpired:'Your account session has expired. Sign in again.',historyFailed:'Cannot open this chat. Its file may be missing or damaged.',renameChat:'Rename chat',deleteChat:'Delete chat',deleteChatConfirm:'Delete this chat? Its local session file will be moved to the application trash.',aborted:'Stopped',configure:'Configure a model gateway in Settings first.',gateway:'Custom model gateway',gatewayUrl:'Gateway URL',modelId:'Model ID',apiKey:'API key',imageSupport:'Model supports image input',keyHint:'Saved; leave blank to keep',save:'Save',gatewaySaved:'Gateway saved',gatewayFail:'Could not save. Check the URL and system secure storage.',openExternal:'Open with default app',reveal:'Show in Finder',openFailed:'Cannot open the file. Check that it exists and is accessible.',unsupported:'Preview is unavailable. Try opening it with a system app.',saveAnswer:'Save as Markdown',saveHtml:'Save HTML file',htmlSaved:'HTML file saved',htmlSaveFailed:'Could not save the HTML file. Choose a new .html filename.',saveAnswerFailed:'Save failed. Choose a new .md filename and check folder permissions.',files:'Project files',up:'Up',loading:'Loading…',emptyFolder:'This folder is empty',preview:'File preview',guideStart:'Start',newTab:'New tab',closeTab:'Close tab',collapsePreview:'Collapse sidebar',expandPreview:'Open sidebar',fullscreenPreview:'Fullscreen preview',exitFullscreenPreview:'Exit fullscreen',fileUnavailable:'The file is missing or inaccessible. Check its location and permissions.',fileError:'Cannot preview this file. Text files up to 1 MB and common images up to 10 MB and PDF, DOCX, XLSX and PPTX files up to 20 MB are supported.',sourceFolders:'Source folders',addFromComputer:'Add a folder from this computer',addFolder:'Add folder',mainBadge:'Main',setMain:'Set as main',removeFolder:'Remove folder',removeLocalProject:'Remove local project',writeHint:'Every source folder is readable; files are written only to the main folder.'}} as const;

function App(){const [prefs,setPrefs]=useState<Preferences>({appearance:'system',language:'system'});const [projects,setProjects]=useState<Project[]>([]);const [selected,setSelected]=useState<string|null>(null);const [files,setFiles]=useState<ProjectFile[]>([]);const [folder,setFolder]=useState('');const [fileQuery,setFileQuery]=useState('');const [editingProject,setEditingProject]=useState<Project|null>(null);const [dockTabs,setDockTabs]=useState<DockTab[]>([{id:'guide',kind:'guide',title:'Start'}]);const [activeDockTab,setActiveDockTab]=useState('guide');const [fileError,setFileError]=useState('');const [fileVersion,setFileVersion]=useState(0);const [loading,setLoading]=useState(false);const [chats,setChats]=useState<ChatSummary[]>([]);const [activeChat,setActiveChat]=useState<string|null>(null);const [documentsOpen,setDocumentsOpen]=useState(false);const [searchOpen,setSearchOpen]=useState(false);const [chatSearch,setChatSearch]=useState('');const [sidebarCollapsed,setSidebarCollapsed]=useState(false);const [editingChat,setEditingChat]=useState<ChatSummary|null>(null);const [chatTitle,setChatTitle]=useState('');const [chatEditError,setChatEditError]=useState('');const [draft,setDraft]=useState('');const [attachments,setAttachments]=useState<(string|PickedAttachment)[]>([]);const [messages,setMessages]=useState<ChatMessage[]>([]);const toolPaths=useRef(new Map<string,string>());const [changedPath,setChangedPath]=useState<string|null>(null);const [chatBusy,setChatBusy]=useState(false);const [chatError,setChatError]=useState('');const [skills,setSkills]=useState<LocalSkill[]>([]);const [skillId,setSkillId]=useState('');const [skillsOpen,setSkillsOpen]=useState(false);const [mcpServers,setMcpServers]=useState<import('../shared/types').McpServer[]>([]);const [mcpId,setMcpId]=useState('');const [settings,setSettings]=useState(false);const [webHistoryOpen,setWebHistoryOpen]=useState(false);const [schedulesOpen,setSchedulesOpen]=useState(false);const [gateway,setGateway]=useState<GatewayConfig|null>(null);const [account,setAccount]=useState<AccountStatus|null>(null);const [modelSelection,setModelSelection]=useState('');const [error,setError]=useState('');const [systemDark,setSystemDark]=useState(matchMedia('(prefers-color-scheme: dark)').matches);const [systemLanguage,setSystemLanguage]=useState(navigator.language);const lang=prefs.language==='system'?(systemLanguage.toLowerCase().startsWith('zh')?'zh-CN':'en'):prefs.language;const t=words[lang];
const [slashIndex,setSlashIndex]=useState(0);const [slashDismissed,setSlashDismissed]=useState(false);
const [composerSelection,setComposerSelection]=useState({start:0,end:0});
const [skillMention,setSkillMention]=useState<{start:number;end:number;name:string}|null>(null);
const composerHighlight=useRef<HTMLDivElement>(null);
const pendingComposerCaret=useRef<number|null>(null);
const draftPrompt=(skillMention?draft.slice(0,skillMention.start)+draft.slice(skillMention.end):draft).trim();
/* 技能以原生文本保留在输入位置;镜像层只负责颜色,输入、选择和粘贴仍由 textarea 处理。 */
const inSkillMention=skillMention&&composerSelection.start>skillMention.start&&composerSelection.start<=skillMention.end;
const slashMatch=!inSkillMention&&composerSelection.start===composerSelection.end?/\/([^\s/]*)$/.exec(draft.slice(0,composerSelection.start)):null;const slashAll=slashMatch?[...skills.filter(skill=>skill.enabled).map(skill=>({kind:'skill' as const,id:skill.id,name:skill.name,description:skill.description,tag:skill.source==='agents'?'~/.agents/skills':lang==='zh-CN'?'本地导入':'Imported'})),...mcpServers.filter(server=>server.enabled).map(server=>({kind:'mcp' as const,id:server.id,name:server.name,description:server.description??'',tag:'MCP'}))].filter(item=>`${item.name} ${item.description}`.toLocaleLowerCase().includes(slashMatch[1].toLocaleLowerCase())):[];const slashMatches=slashAll;
const slashOpen=!!slashMatch&&!slashDismissed&&slashMatches.length>0;const slashActive=Math.min(slashIndex,slashMatches.length-1);
function updateComposerDraft(value:string){
 if(skillMention){
  let start=0;while(start<draft.length&&start<value.length&&draft[start]===value[start])start++;
  let oldEnd=draft.length,newEnd=value.length;while(oldEnd>start&&newEnd>start&&draft[oldEnd-1]===value[newEnd-1]){oldEnd--;newEnd--}
  if(oldEnd<=skillMention.start){const shift=newEnd-oldEnd;setSkillMention({...skillMention,start:skillMention.start+shift,end:skillMention.end+shift})}
  else if(start<skillMention.end){setSkillMention(null);setSkillId('')}
 }
 setDraft(value);setSlashDismissed(false);setSlashIndex(0);
}
function focusComposerAt(caret:number){
 pendingComposerCaret.current=caret;
 setComposerSelection({start:caret,end:caret});
}
useLayoutEffect(()=>{const input=composerInput.current,caret=pendingComposerCaret.current;if(input&&caret!==null){pendingComposerCaret.current=null;input.focus();input.setSelectionRange(caret,caret)}});
const applySlash=(item:(typeof slashMatches)[number])=>{
 if(!slashMatch)return;
 let start=slashMatch.index,end=composerSelection.start,text=draft;
 if(item.kind==='skill'){
  if(skillMention){text=text.slice(0,skillMention.start)+text.slice(skillMention.end);if(skillMention.end<=start){start-=skillMention.end-skillMention.start;end-=skillMention.end-skillMention.start}}
  // 一个 em 空格为技能图标预留位置,与镜像层保持相同的光标和换行宽度。
  const label=`\u2003${item.name}`;
  setDraft(text.slice(0,start)+label+' '+text.slice(end));setSkillId(item.id);setSkillMention({start,end:start+label.length,name:item.name});focusComposerAt(start+label.length+1);
 }else{
  updateComposerDraft(text.slice(0,start)+text.slice(end));setMcpId(item.id);focusComposerAt(start);
 }
 setSlashDismissed(true);setSlashIndex(0);
};
useEffect(()=>{if(skillMention&&!skillId)setSkillMention(null)},[skillId,skillMention]);
useEffect(()=>{const input=composerInput.current,highlight=composerHighlight.current;if(input&&highlight){highlight.scrollTop=input.scrollTop;highlight.scrollLeft=input.scrollLeft}},[draft,skillMention]);
/* 列表完整展示,超出面板高度时滚动;渐隐遮罩按真实溢出判断,键盘导航时高亮行滚动进可视区 */
const slashListRef=useRef<HTMLDivElement|null>(null);const [slashOverflow,setSlashOverflow]=useState(false);
useEffect(()=>{const element=slashListRef.current;setSlashOverflow(!!element&&element.scrollHeight>element.clientHeight)},[draft,skills,mcpServers,slashOpen]);
useEffect(()=>{if(slashOpen)document.getElementById(`slash-option-${slashActive}`)?.scrollIntoView({block:'nearest'})},[slashActive,slashOpen]);
/* 输入框上方统一展示权限确认和 Agent 问题,并保留并发请求队列。 */
const {pending:pendingInteractions,dismiss:dismissInteraction,saved:interactionDrafts}=usePendingInteractions();
const respondApproval=(id:string,decision:ApprovalDecision)=>{dismissInteraction('approval',id);void window.desktop.respondApproval(id,decision)};
const escalateApprovalFullAccess=(id:string)=>{dismissInteraction('approval',id);void change({...prefs,permission:'full'});void window.desktop.respondApproval(id,'allow')};
const respondQuestion=(id:string,response:QuestionResponse)=>{dismissInteraction('question',id);void window.desktop.respondQuestion(id,response)};
const interactionDock=<PendingInteractionDock saved={interactionDrafts} pending={pendingInteractions} language={lang} onApproval={respondApproval} onFullAccess={escalateApprovalFullAccess} onQuestion={respondQuestion}/>;
const [createOpen,setCreateOpen]=useState(false);
const [settingsSection,setSettingsSection]=useState<SettingsSectionId>('general');
/* 客户端更新:主界面侧栏仅在有新版/已就绪时露出入口(点击进设置-关于);下载过程不打扰 */
const [updateVersion,setUpdateVersion]=useState<string|null>(null);
useEffect(()=>{const refresh=()=>{void window.desktop.getAppUpdateState().then(value=>setUpdateVersion(value.phase==='available'||value.phase==='downloaded'?(value.info?.version??null):null)).catch(()=>{})};refresh();return window.desktop.onAppUpdateChanged(refresh)},[]);
const settingsRef=useRef(false);settingsRef.current=settings;
const webMessages=lang==='zh-CN'?zhMessages:enMessages;
const webChat=webMessages.chat;
const [historyExpanded, setHistoryExpanded] = useState(true);
  const [libraryPickerOpen,setLibraryPickerOpen]=useState(false);
  const [lightbox,setLightbox]=useState<LightboxState|null>(null);
const [attachmentLoading,setAttachmentLoading]=useState(false);
const composerInput=useRef<HTMLTextAreaElement>(null);
const {width:previewPanelWidth,resizer:previewResizer}=usePreviewWidth({minChatWidth:320});
const {collapsed:previewCollapsed,fullscreen:previewFullscreen,animating:previewAnimating,setCollapsed:setPreviewCollapsed,setFullscreen:setPreviewFullscreen,endAnimation:endPreviewAnimation}=usePreviewCollapse();
/* ---- 右侧 dock 标签操作(参考 deepseek sidebar-right:打开必展开,guide 为兜底标签,栈不空) ---- */
const dockTabsRef=useRef(dockTabs);dockTabsRef.current=dockTabs;
function activateDockTab(id:string){setActiveDockTab(id);setPreviewCollapsed(false)}
function closeDockTab(id:string){
  setDockTabs(current=>{
    const index=current.findIndex(tab=>tab.id===id);
    if(index===-1)return current;
    const next=current.filter(tab=>tab.id!==id);
    const settled=next.length?next:[{id:'guide',kind:'guide' as const,title:'Start'}];
    setActiveDockTab(active=>active===id?settled[Math.min(index,settled.length-1)]!.id:active);
    return settled;
  });
}
function newDockTab(){
  setDockTabs(current=>current.some(tab=>tab.id==='guide')?current:[...current,{id:'guide',kind:'guide',title:'Start'}]);
  activateDockTab('guide');
}
function openFilesTab(){
  setDockTabs(current=>current.some(tab=>tab.id==='files')?current:[...current,{id:'files',kind:'files',title:t.files}]);
  activateDockTab('files');
}
function openBrowserTab(url?:string){
  const id=crypto.randomUUID();
  setDockTabs(current=>[...current,{id,kind:'browser',title:lang==='zh-CN'?'浏览器':'Browser',url}]);
  activateDockTab(id);
}
// guide 卡片开新工具 = 替换 guide(deepseek replaceTab 语义)
function openGuideTool(kind:'files'|'browser'){
  if(kind==='files')openFilesTab();else openBrowserTab();
  setDockTabs(current=>current.filter(tab=>tab.id!=='guide'));
}
function setTabError(id:string,message:string){setDockTabs(current=>current.map(tab=>tab.id===id?{...tab,error:message}:tab))}
function setTabTitle(id:string,title:string){if(!title)return;setDockTabs(current=>current.some(tab=>tab.id===id&&tab.title!==title)?current.map(tab=>tab.id===id?{...tab,title}:tab):current)}
function openDocumentTab(file:DockFile,tabError=''){
  const existing=dockTabsRef.current.find(tab=>tab.kind==='document'&&tab.file?.path===file.path);
  const id=existing?.id??crypto.randomUUID();
  setDockTabs(current=>current.some(tab=>tab.id===id)
    ?current.map(tab=>tab.id===id?{...tab,file,error:tabError}:tab)
    :[...current,{id,kind:'document',title:file.path.split('/').at(-1)||file.path,file,error:tabError}]);
  activateDockTab(id);
}
useEffect(()=>window.desktop.onBrowserOpen(url=>{if(/^https?:\/\//i.test(url)){const id=crypto.randomUUID();setDockTabs(current=>[...current,{id,kind:'browser',title:navigator.language.toLowerCase().startsWith('zh')?'浏览器':'Browser',url}]);setActiveDockTab(id);setPreviewCollapsed(false)}}),[]);
const models=(account?.models??[]).map(model=>({
  ...model,
  value:`account:${model.id}`,
  providerKey:model.providerKey??model.id.split('/')[0],
}));
const defaultModel=models.find(model=>model.id===account?.defaultModelId)??models[0];
if(gateway)models.push({value:'custom',id:gateway.modelId,name:gateway.modelId,providerKey:gateway.modelId.split('/')[0]});
const boundModel=activeChat?chats.find(chat=>chat.id===activeChat)?.modelBinding:undefined;
const modelValue=boundModel
  ? boundModel.source==='custom'?'custom':`account:${boundModel.id}`
  : models.find(model=>model.value===modelSelection)?.value??defaultModel?.value??models[0]?.value??'';
const modelAcceptsImages=modelValue==='custom'
  ? gateway?.supportsImages
  : models.find(model=>model.value===modelValue)?.supportsImages;
/* 追加附件(粘贴/选择/加入对话共用):去重(string 按路径、picked 按缓存),总量超 10 放弃并提示 */
function addAttachments(items:(string|PickedAttachment)[]){
  if(!items.length)return;
  const merged=[...attachments];
  for(const item of items){
    if(typeof item==='string'){if(!merged.includes(item))merged.push(item)}
    else if(item.cache&&!merged.some(existing=>typeof existing!=='string'&&existing.cache===item.cache))merged.push(item);
    else if(!item.cache)merged.push(item);
  }
  if(merged.length>10){setChatError(t.attachmentLimit);return}
  setAttachments(merged);
}
/* 移除单个附件 chip:picked 项同时通知主进程释放持有的读取内容 */
function removeAttachment(item:string|PickedAttachment){
  setAttachments(current=>current.filter(existing=>existing!==item));
  if(typeof item==='object')void window.desktop.detachAttachments([item.token]).catch(()=>{});
}
async function pickAttachment(file?:{projectId:string;path:string}|{library:string}):Promise<PickedAttachment|null>{
  setAttachmentLoading(true);
  setChatError('');
  try{
    const picked=await window.desktop.pickChatAttachment(file);
    if(picked){
      addAttachments([picked]);
      if(file){
        setLibraryPickerOpen(false);
        requestAnimationFrame(()=>composerInput.current?.focus());
      }
    }
    return picked;
  }catch{
    setChatError(attachmentReadError[lang]);
    if(file)setLibraryPickerOpen(false);
    return null;
  }finally{setAttachmentLoading(false)}
 }
/* 粘贴剪贴板内容(多选):Finder 拷贝的文件带真实路径(pathForFile),截图/网页图片无路径按字节提交;
   纯文本粘贴(无文件)不受影响;任一条目将成图片而模型不支持时整批放弃 */
async function pasteFiles(e:React.ClipboardEvent<HTMLTextAreaElement>){
  if(chatBusy||attachmentLoading)return;
  const files=Array.from(e.clipboardData.files);
  if(!files.length)return;
  const paths:string[]=[];
  const images:File[]=[];
  for(const file of files){
    const absolute=window.desktop.pathForFile(file);
    if(absolute)paths.push(absolute);
    else if(file.type.startsWith('image/'))images.push(file);
  }
  if(!paths.length&&!images.length)return;
  // preventDefault 必须在事件同步阶段完成(异步 await 后再调用已无效)
  e.preventDefault();
  const hasImage=images.length>0||paths.some(value=>/\.(png|jpe?g|gif|webp)$/i.test(value));
  if(hasImage&&modelValue&&!modelAcceptsImages){setChatError((lang==='zh-CN'?zhMessages:enMessages).api.modelNoImages);return}
  setAttachmentLoading(true);setChatError('');
  try{
    // 名字仅作展示:非法或缺扩展名时主进程会回退为 clipboard-<时间戳>.<ext>
    const items:({path:string}|{name:string;mimeType:string;base64:string})[]=[
      ...paths.map((path):{path:string}=>({path})),
      ...await Promise.all(images.map(async (file):Promise<{name:string;mimeType:string;base64:string}>=>({name:file.name||'',mimeType:file.type,base64:await readFileAsBase64(file)}))),
    ];
    addAttachments(await window.desktop.attachFiles(items));
  }catch{setChatError(attachmentReadError[lang])}
  finally{setAttachmentLoading(false)}
 }
const accountLabel = account?.user?.email || account?.user?.name;
// 账号菜单的主题切换与 Web 端一致:按当前生效主题(含跟随系统)翻转并显示对应词条
const effectiveDark=prefs.appearance==='system'?systemDark:prefs.appearance==='dark';
useEffect(()=>{Promise.all([window.desktop.getPreferences(),window.desktop.listProjects(),window.desktop.getGateway(),window.desktop.listChats(),window.desktop.listSkills(),window.desktop.listMcp()]).then(([p,ps,g,history,localSkills,localMcp])=>{setMcpServers(localMcp);setPrefs(p);setProjects(ps);setChats(history);setSkills(localSkills);setGateway(g);window.dispatchEvent(new Event('piwork:prefs-changed'))}).catch(()=>setError('Unable to load local settings.'));void window.desktop.accountStatus().then(setAccount).catch(()=>setAccount(null));const media=matchMedia('(prefers-color-scheme: dark)');const onTheme=(e:MediaQueryListEvent)=>setSystemDark(e.matches);const onLanguage=()=>setSystemLanguage(navigator.language);media.addEventListener('change',onTheme);window.addEventListener('languagechange',onLanguage);return()=>{media.removeEventListener('change',onTheme);window.removeEventListener('languagechange',onLanguage)}},[]);
const pendingSyncReload=useRef(false);
useEffect(()=>window.desktop.onAccountChanged(()=>{void window.desktop.accountStatus().then(setAccount).catch(()=>setAccount(null))}),[]);
useEffect(()=>{if(!activeChat)return;let disposed=false;const refresh=()=>{if(disposed||chatBusy||!pendingSyncReload.current)return;pendingSyncReload.current=false;void window.desktop.openChat(activeChat).then(result=>{if(!disposed){setMessages(result.messages)}}).catch(()=>{if(!disposed)pendingSyncReload.current=true})};const offHistory=window.desktop.onSyncHistory(id=>{if(id===activeChat){pendingSyncReload.current=true;refresh()}});const offSync=window.desktop.onSync(refresh);refresh();return()=>{disposed=true;offHistory();offSync()}},[activeChat,chatBusy]);
useEffect(()=>window.desktop.onChat(event=>{
  if(event.type==='approval')return;
  if(event.type==='tool'){
    if(event.path)toolPaths.current.set(event.id,event.path);
    if(event.status==='completed'&&(event.name==='project_write'||event.name==='project_create_office')){
      setFileVersion(value=>value+1);
      setChangedPath(toolPaths.current.get(event.id)??null);
    }
  }else if(event.type!=='delta'){
    void window.desktop.listChats().then(setChats).catch(()=>{});
    setChatBusy(false);
    if(event.type==='aborted')setChatError(t.aborted);
    if(event.type==='failed'){
      const accountErrors:Record<string,string>={'account:429':t.accountQuota,'account:403':t.accountForbidden,'account:401':t.accountExpired};
      setChatError(accountErrors[event.message]??t.chatFailed);
    }
  }

  setMessages(items=>{
    const last=items.at(-1);
    if(last?.role!=='assistant')return items;
    const updated={...last};
    if(event.type==='completed'||event.type==='failed'||event.type==='aborted')updated.durationMs=last.startedAt===undefined?undefined:Math.max(0,Date.now()-last.startedAt);
    if(event.type==='delta'){
      updated.text+=event.text;
      /* 维护交错分段:文字增量并入尾部 text 段(无则新建),保证与工具组按时间线排列 */
      const segments=[...(updated.segments??[{kind:'text' as const,text:''}])];
      const tail=segments.at(-1);
      if(tail&&tail.kind==='text')segments[segments.length-1]={kind:'text',text:tail.text+event.text};
      else segments.push({kind:'text',text:event.text});
      updated.segments=segments;
    }else if(event.type==='tool'){
      const events=[...(last.toolEvents??[])];
      const index=events.findIndex(tool=>tool.id===event.id);
      if(index===-1)events.push(event);
      else events[index]={...events[index],...event};
      updated.toolEvents=events;
      const segments=[...(last.segments??[])];
      const tail=segments.at(-1);
      if(tail&&tail.kind==='tools'){
        const at=tail.tools.findIndex(tool=>tool.id===event.id);
        segments[segments.length-1]={kind:'tools',tools:at===-1?[...tail.tools,event]:tail.tools.map((tool,position)=>position===at?{...tool,...event}:tool)};
      }else segments.push({kind:'tools',tools:[event]});
      updated.segments=segments;
    }else{
      if(event.type==='completed'&&event.text)updated.text=event.text;
      const interrupt=(tool:ToolEvent)=>tool.status==='running'?{...tool,status:'failed' as const,reason:'interrupted' as const}:tool;
      updated.toolEvents=last.toolEvents?.map(interrupt);
      updated.segments=last.segments?.map(segment=>segment.kind==='tools'
        ?{kind:'tools',tools:segment.tools.map(interrupt)}:segment);
    }
    return [...items.slice(0,-1),updated];
  });
}),[lang]);
useEffect(()=>{const key=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&!settingsRef.current){event.preventDefault();setSearchOpen(value=>!value)}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[]);
// dock 快捷键(参考 deepseek 桌面键位):Cmd/Ctrl+Alt+B 折叠切换、Cmd/Ctrl+T 新浏览器标签、Cmd/Ctrl+P 项目文件。
// macOS Option 组合输入特殊字符(event.key 非 ASCII),需以 event.code 兜底判断。
useEffect(()=>{const key=(event:KeyboardEvent)=>{const pressed=event.key.toLowerCase();const code=event.code;const modify=event.metaKey||event.ctrlKey;if(modify&&event.altKey&&(pressed==='b'||code==='KeyB')){event.preventDefault();setPreviewCollapsed(!previewCollapsed)}else if(modify&&!event.altKey&&(pressed==='t'||code==='KeyT')){event.preventDefault();openBrowserTab()}else if(modify&&!event.altKey&&(pressed==='p'||code==='KeyP')&&!settingsRef.current){event.preventDefault();if(selected)openFilesTab()}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[previewCollapsed,selected]);
useEffect(()=>{if(changedPath){if(selected&&dockTabsRef.current.some(tab=>tab.kind==='document'&&tab.file?.path===changedPath))void openFile({name:changedPath.split('/').at(-1)!,path:changedPath,kind:'file'});setChangedPath(null)}},[changedPath]);
useEffect(()=>{document.documentElement.dataset.theme=prefs.appearance==='system'?(systemDark?'dark':'light'):prefs.appearance;document.documentElement.classList.toggle('dark',document.documentElement.dataset.theme==='dark');document.documentElement.lang=lang},[prefs.appearance,systemDark,lang]);
// 切项目/对话:文件列表状态清空,dock 保留 guide/浏览器标签(与项目无关),清文件类标签
useEffect(()=>{setFolder('');setFileQuery('');setFileError('');setDockTabs(current=>{const next=current.filter(tab=>tab.kind==='guide'||tab.kind==='browser');return next.length?next:[{id:'guide',kind:'guide',title:'Start'}]});setActiveDockTab(current=>current)},[selected,activeChat]);
useEffect(()=>{if(!selected)return;let alive=true;setLoading(true);const timer=setTimeout(()=>{const query=fileQuery.trim();const request=query?window.desktop.searchFiles(selected,query):window.desktop.listFiles(selected,folder);request.then(result=>{if(alive){setFiles(result);setFileError('')}}).catch(()=>{if(alive){setFiles([]);setFileError(t.projectAccessFailed)}}).finally(()=>{if(alive)setLoading(false)})},fileQuery.trim()?250:0);return()=>{alive=false;clearTimeout(timer)}},[selected,folder,fileVersion,fileQuery,activeChat,projects]);
async function openFile(entry:ProjectFile){if(!selected)return;// 打开文件必定展开面板:折叠状态下的打开不算打开(deepseek 同款语义)
if(entry.kind==='directory'){setFolder(entry.path);return}
const documentPath=projectDocumentPath(entry.path,projects.find(project=>project.id===selected)?.folders??[]);
if(!documentPath){openDocumentTab({path:entry.path,content:'',kind:'unsupported'},t.fileUnavailable);return}
entry={...entry,path:documentPath};
// HTML:读文本供静态模式清洗展示;交互模式由 preview:// 协议直接按路径加载(相对资源与 CDN 均可)
const readError=(error:unknown)=>error instanceof Error&&/\b(?:ENOENT|EACCES|EPERM)\b/.test(error.message)?t.fileUnavailable:t.fileError;
if(isHtmlFile(entry.path)){
  try{
    const content=await window.desktop.readText(selected,entry.path);
    openDocumentTab({path:entry.path,content,kind:'html'});
  }catch(error){
    // 读取失败仍开标签:交互模式经 preview:// 协议按路径加载不受 1MB 文本限制
    openDocumentTab({path:entry.path,content:'',kind:'html'},readError(error));
  }
  return;
}
// 图片不进右侧 dock:当前文件列表中的图片组成相册,点开全屏灯箱上一张/下一张
if(isImageName(entry.path)){
  const images=files.filter(item=>item.kind==='file'&&isImageName(item.name)).map(item=>({name:item.name,project:{projectId:selected,path:item.path}}));
  const at=images.findIndex(item=>item.project?.path===entry.path);
  setLightbox({items:at<0?[{name:entry.name,project:{projectId:selected,path:entry.path}}]:images,index:at<0?0:at});
  return;
}
try{const isPptx=/\.pptx$/i.test(entry.path);const isXlsx=/\.xlsx$/i.test(entry.path);const isDocx=/\.docx$/i.test(entry.path);const isPdf=/\.pdf$/i.test(entry.path);const content=isPptx?await window.desktop.readPptx(selected,entry.path):isXlsx?await window.desktop.readXlsx(selected,entry.path):isDocx?await window.desktop.readDocx(selected,entry.path):isPdf?await window.desktop.readPdf(selected,entry.path):await window.desktop.readText(selected,entry.path);openDocumentTab({path:entry.path,content,kind:isPptx?'pptx':isXlsx?'xlsx':isDocx?'docx':isPdf?'pdf':'text'})}catch(error){openDocumentTab({path:entry.path,content:'',kind:'unsupported'},readError(error))}}
// 附件引用→可打开形态:项目文件复用 openFile,缓存副本经 chat:readAttachment 按类型读出后直接进 dock
function attachmentRefOf(value:string|PickedAttachment|null|undefined):ChatAttachmentRef|undefined{
  if(!value)return undefined;
  return typeof value==='string'
    ?{name:value.split('/').at(-1)!,projectPath:value}
    :value.cache?{name:value.name,cachePath:value.cache}:undefined;
}
async function documentAction(path:string,action:'open'|'reveal'){
  try{
    const projectPath=projectDocumentPath(path,projects.find(project=>project.id===selected)?.folders??[]);
    if(selected&&projectPath){
      if(action==='open')await window.desktop.openFile(selected,projectPath);
      else await window.desktop.revealFile(selected,projectPath);
    }else{
      if(!activeChat)throw new Error('No active chat');
      await window.desktop.generatedDocumentAction(activeChat,path,action);
    }
  }catch{toast.error(t.openFailed)}
}
async function openDocumentLink(path:string){
  const projectPath=projectDocumentPath(path,projects.find(project=>project.id===selected)?.folders??[]);
  if(selected&&projectPath){await openFile({name:path.split('/').at(-1)!,path:projectPath,kind:'file'});return}
  try{
    if(!activeChat)throw new Error('No active chat');
    const file=await window.desktop.cacheGeneratedDocument(activeChat,path);
    const preview=await window.desktop.readAttachment(file.cache);
    openDocumentTab({path,content:preview.content,kind:preview.kind,cache:file.cache,label:file.name});
  }catch(error){
    const unavailable=error instanceof Error&&/\b(?:ENOENT|EACCES|EPERM)\b/.test(error.message);
    openDocumentTab({path,content:'',kind:'unsupported'},unavailable?t.fileUnavailable:t.fileError);
  }
}
async function openAttachment(ref:ChatAttachmentRef){
  if(ref.projectPath){void openFile({name:ref.name,path:ref.projectPath,kind:'file'});return}
  if(ref.cachePath){
    // 图片不进右侧 dock:收集对话内的全部图片附件,全屏灯箱上一张/下一张
    if(isImageName(ref.name)){
      const items=messages.flatMap(message=>(message.attachments??[]).flatMap(entry=>entry.ref?.cachePath&&isImageName(entry.ref.name)
        ?[{name:entry.ref.name,cache:entry.ref.cachePath}]:[]));
      const at=items.findIndex(item=>item.cache===ref.cachePath);
      setLightbox({items:at<0?[{name:ref.name,cache:ref.cachePath}]:items,index:at<0?0:at});
      return;
    }
    try{
      const preview=await window.desktop.readAttachment(ref.cachePath);
      openDocumentTab({path:ref.cachePath,content:preview.content,kind:preview.kind,cache:ref.cachePath,label:ref.name});
    }catch{toast.error(t.fileError)}
    return;
  }
  // 旧版历史消息的文本附件:无缓存副本,用 marker 里存的内容做纯文本预览
  if(ref.textContent!==undefined)openDocumentTab({path:`text:${ref.name}`,content:ref.textContent,kind:'text',label:ref.name,virtual:true});
}
function editProject(project:Project){setEditingProject(project)}
async function saveAnswer(content:string){if(chatBusy)return;try{const relative=await window.desktop.saveAnswer(content);if(relative){setChatError('');toast.success(libraryStrings[lang].savedToLibrary);window.dispatchEvent(new Event('piwork:library-changed'))}}catch{setChatError(t.saveAnswerFailed)}}
async function sendMessage(text:string){if(!text||chatBusy||attachmentLoading)return false;
if(attachments.some(item=>typeof item!=='string'&&item.kind==='image')&&!modelAcceptsImages&&modelValue){setChatError((lang==='zh-CN'?zhMessages:enMessages).api.modelNoImages);return false}
const chosen=modelValue;if(!chosen){setChatError(t.configure);return false}const model=chosen==='custom'?{source:'custom' as const,id:gateway?.modelId??''}:{source:'account' as const,id:chosen.slice(8)};const pendingDraft=draft,pendingMention=skillMention;setDraft('');setSkillMention(null);setSkillId('');setChatError('');toolPaths.current.clear();
const pendingAttachments=attachments.map(item=>({name:typeof item==='string'?item.split('/').at(-1)!:item.name,ref:attachmentRefOf(item)}));
const activeSkillName=skillId?skills.find(item=>item.id===skillId)?.name:undefined;
setMessages(items=>[...items,{role:'user',text,...(pendingAttachments.length?{attachments:pendingAttachments}:{}),...(activeSkillName?{skillName:activeSkillName}:{})},{role:'assistant',text:'',startedAt:Date.now()}]);setChatBusy(true);try{setActiveChat(await window.desktop.sendChat(text,selected,skillId||null,mcpId||null,attachments.map(item=>typeof item==='object'?{token:item.token}:item),model));setAttachments([]);return true}catch(error){setDraft(pendingMention?pendingDraft:text);setSkillMention(pendingMention);setSkillId(skillId);setMessages(items=>items.slice(0,-2));setChatBusy(false);const message=String(error);setChatError(message.includes('Sync task running')?t.syncTaskRunning:message.includes('Sync conflict')?t.syncSendConflict:message.includes('Sync unavailable')?t.syncSendUnavailable:message.includes('Sync busy')?t.syncSendBusy:message.includes('Sync only supports new chats')?t.syncOldChat:message.includes('Session busy')?t.sessionBusy:attachments.length?t.attachmentFailed:t.chatFailed);return false}}
async function sendChat(e:React.FormEvent){e.preventDefault();await sendMessage(draftPrompt)}
// 定时任务页「AI 安排任务」入口:开新对话并自动发送(web 端为 /?query= 跳转,由聊天页自动发出首条消息)
async function askAI(text:string){await newChat();const sent=await sendMessage(text);if(!sent)setDraft(current=>current||text)}
async function newChat(){if(attachmentLoading)return;setSchedulesOpen(false);setSkillsOpen(false);setDocumentsOpen(false);if(chatBusy){await window.desktop.stopChat();return}await window.desktop.clearChat();setMessages([]);setActiveChat(null);setChatError('');setChatBusy(false);setSelected(null);setAttachments([])}
async function openChat(id:string){setSchedulesOpen(false);setSkillsOpen(false);setDocumentsOpen(false);if(chatBusy||attachmentLoading)return;try{const history=await window.desktop.openChat(id);setMessages(history.messages);setActiveChat(id);setAttachments([]);if(history.modelBinding)setModelSelection(history.modelBinding.source==='account'?`account:${history.modelBinding.id}`:'custom');setSelected(history.projectId);setChatError('')}catch{setChatError(t.historyFailed)}}
function renameChat(chat:ChatSummary){setEditingChat(chat);setChatTitle(chat.title);setChatEditError('')}
async function saveChatTitle(e:React.FormEvent){e.preventDefault();if(!editingChat)return;try{await window.desktop.renameChat(editingChat.id,chatTitle);setChats(await window.desktop.listChats());setEditingChat(null)}catch{setChatEditError(t.failed)}}
async function deleteChat(chat:ChatSummary){if(chatBusy||!confirm(t.deleteChatConfirm))return;try{await window.desktop.deleteChat(chat.id);setChats(await window.desktop.listChats());if(activeChat===chat.id){setActiveChat(null);setMessages([]);setAttachments([]);setChatError('')}}catch{setChatError(t.failed)}}
async function selectProject(id:string|null){if(chatBusy||attachmentLoading)return;setSchedulesOpen(false);setSkillsOpen(false);setDocumentsOpen(false);try{await window.desktop.clearChat();setMessages([]);setActiveChat(null);setChatError('');setSelected(id);setAttachments([])}catch{setError(t.failed)}}
async function change(p:Preferences){setPrefs(p);try{await window.desktop.setPreferences(p);setError('');window.dispatchEvent(new Event('piwork:prefs-changed'))}catch{setError(t.failed)}}
async function signOut(){try{await window.desktop.accountLogout();setAccount(await window.desktop.accountStatus().catch(()=>null))}catch{setError(t.failed)}}
async function add(){setCreateOpen(true)}
async function remove(p:Project){if(!confirm(t.confirm))return;try{await window.desktop.removeProject(p.id);setProjects(await window.desktop.listProjects());if(selected===p.id&&!activeChat){setSelected(null);setAttachments([])}}catch{setError(t.failed)}}
async function refreshProjects(){setProjects(await window.desktop.listProjects());setChats(await window.desktop.listChats())}
const conversationTitle=messages.find(message=>message.role==='user')?.text.trim()||chats.find(chat=>chat.id===activeChat)?.title||t.newChat;
const current=projects.find(p=>p.id===selected);const mainFolder=current?.folders.find(folder=>folder.main)??current?.folders[0];const chatProjectPath=chats.find(chat=>chat.id===activeChat)?.projectPath;const originalPath=activeChat&&current&&chatProjectPath&&mainFolder&&chatProjectPath!==mainFolder.path?chatProjectPath:null;
const projectDialogCopy:ProjectDialogCopy={createTitle:t.createProject,editTitle:t.editProject,nameLabel:t.projectName,sourceFolders:t.sourceFolders,addFromComputer:t.addFromComputer,addFolder:t.addFolder,mainBadge:t.mainBadge,setMain:t.setMain,removeFolder:t.removeFolder,removeLocalProject:t.removeLocalProject,cancel:t.cancel,create:t.createProject,save:t.save,existingProject:t.existingProject,saveFailed:t.projectSaveFailed,confirmRemove:t.confirm,writeHint:t.writeHint};
const projectHomeCopy:ProjectHomeCopy={webChat,web:webMessages.projects,editProject:t.editProject,removeProject:t.remove,removeProjectConfirm:t.confirm,renameChat:t.renameChat,deleteChat:t.deleteChat,deleteChatConfirm:t.deleteChatConfirm,failed:t.failed,unavailable:t.unavailable,reveal:t.reveal,setMain:t.setMain,removeFolder:t.removeFolder,addFolder:t.addFolder,mainBadge:t.mainBadge,existingProject:t.existingProject,writeHint:t.writeHint,removeAttachment:t.removeAttachment,dateLocale:lang==='zh-CN'?'zh-CN':'en-US'};
// 全页面（文档库/定时任务/技能）打开时侧栏只高亮该页面；项目选中态保留但暂不高亮。
const pageOpen=schedulesOpen||skillsOpen||documentsOpen;
// 设置为全页面接管(macOS 系统设置风格,组件见 settings.tsx):左侧分组图标导航 +
// 搜索,右侧按分区切换页面;「配置模型…」入口直达模型网关分区。
return <>{settings?<SettingsPage
  account={account}
  gateway={gateway}
  lang={lang}
  onAccountChanged={setAccount}
  onClose={()=>setSettings(false)}
  onLocalPrefs={setPrefs}
  onOpenWebHistory={()=>{setSettings(false);setWebHistoryOpen(true)}}
  onSaveGateway={async input=>{const saved=await window.desktop.setGateway(input);setGateway(saved);setModelSelection('custom');return saved}}
  onMcpChanged={items=>{setMcpServers(items);if(mcpId&&!items.some(item=>item.id===mcpId&&item.enabled))setMcpId('')}}
  onSectionChange={setSettingsSection}
  onChangePrefs={p=>void change(p)}
  prefs={prefs}
  section={settingsSection}
/>:<div className="app openai-chat">
  <aside className="sidebar" data-collapsed={sidebarCollapsed}>
    <div className="drag"/>
    <div className="sidebar-header">
      <div className="brand">PiWork</div>
      <div className="sidebar-header-actions">
        <Button variant="ghost" size="icon" onClick={()=>setSearchOpen(true)} aria-label={t.searchChats} title={t.searchChats}>
          <SearchIcon className="size-[18px]"/>
        </Button>
        <Button variant="ghost" size="icon" onClick={()=>setSidebarCollapsed(value=>!value)} aria-label={sidebarCollapsed?t.expandSidebar:t.collapseSidebar} title={sidebarCollapsed?t.expandSidebar:t.collapseSidebar}>
          {sidebarCollapsed ? <PanelLeftOpenIcon className="size-[18px]"/> : <PanelLeftCloseIcon className="size-[18px]"/>}
        </Button>
      </div>
    </div>
    <div className="sidebar-content">
      <nav className="sidebar-primary">
        <button className={"nav "+(!pageOpen&&!selected&&!activeChat?"active":"")} onClick={()=>void newChat()} aria-label={t.newChat} title={t.newChat}><SquarePenIcon size={18}/><span>{t.newChat}</span></button>
        <button className={"nav "+(documentsOpen?"active":"")} onClick={()=>{setSchedulesOpen(false);setSkillsOpen(false);setDocumentsOpen(true)}} aria-label={t.documents} title={t.documents}><FileTextIcon size={18}/><span>{t.documents}</span></button>
        <button className={"nav "+(schedulesOpen?"active":"")} onClick={()=>{setSkillsOpen(false);setDocumentsOpen(false);setSchedulesOpen(true)}} aria-label={t.schedules} title={t.schedules}><Clock3Icon size={18}/><span>{t.schedules}</span></button>
        <button className={"nav "+(skillsOpen?"active":"")} onClick={()=>{setSchedulesOpen(false);setDocumentsOpen(false);setSkillsOpen(true)}} aria-label={t.skills} title={t.skills}><Grid2X2Icon size={18}/><span>{t.skills}</span></button>
      </nav>
      <div className="label">
        <span>{t.projects}</span>
        <Button variant="ghost" size="icon-xs" disabled={chatBusy} onClick={add} aria-label={t.add} title={t.add}><PlusIcon className="size-4"/></Button>
      </div>
      <div className="projects">
        {projects.map(p=>{
          const projectMain=p.folders.find(folder=>folder.main)??p.folders[0];
          return (
          <div className={'project '+((selected===p.id&&!pageOpen)?'selected':'')} key={p.id}>
            <button className="project-name" disabled={chatBusy} onClick={()=>selectProject(p.id)} title={projectMain?.path}><FolderIcon size={18}/><span>{p.name}{!p.available&&<small> · {t.unavailable}</small>}</span></button>
          </div>
          );
        })}
      </div>
      <div className="label history-label">
        <button type="button" aria-controls="desktop-chat-history" aria-expanded={historyExpanded} onClick={()=>setHistoryExpanded(value=>!value)}>
          {webChat.recent}
          <ChevronRightIcon size={16}/>
        </button>
      </div>
      <div className="chat-history" id="desktop-chat-history" hidden={!historyExpanded}>
        {chats.map(chat=>(
          <div key={chat.id} className={"chat-history-row "+(activeChat===chat.id?"selected":"")}>
            <button disabled={chatBusy} title={chat.title} onClick={()=>openChat(chat.id)}>{chat.title}</button>
            <button className="chat-action" disabled={chatBusy} aria-label={t.renameChat} title={t.renameChat} onClick={()=>renameChat(chat)}><PencilIcon size={14}/></button>
            <button className="chat-action" disabled={chatBusy} aria-label={t.deleteChat} title={t.deleteChat} onClick={()=>deleteChat(chat)}><XIcon size={16}/></button>
          </div>
        ))}
      </div>
    </div>
    {updateVersion&&(
      <button className="update-hint" type="button" onClick={()=>{setSettingsSection('about');setSettings(true)}}>
        <ArrowUpCircleIcon aria-hidden="true" className="size-4"/>
        <span>{t.updateBanner.replace('{version}',updateVersion)}</span>
      </button>
    )}
    {/* 账号菜单交互对齐 Web 端 user-nav:底部账号按钮向上弹出菜单(账号名称/设置/切换主题/退出登录) */}
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="settings" aria-label={t.settings} title={accountLabel ? `${accountLabel} · ${t.settings}` : t.settings}>
          {accountLabel ? <span className="account-avatar"><UserRoundIcon/></span> : <SettingsIcon className="size-[18px]"/>}
          <span className="settings-label">{accountLabel || t.settings}</span>
          {accountLabel && <ChevronUpIcon className="settings-chevron size-3.5"/>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--radix-popper-anchor-width) rounded-md border border-border bg-card shadow-none" side="top">
        {accountLabel && <DropdownMenuLabel className="flex min-w-0 items-center gap-2"><span className="account-avatar"><UserRoundIcon/></span><span className="truncate">{accountLabel}</span></DropdownMenuLabel>}
        <DropdownMenuItem className="cursor-pointer gap-2 text-sm" onSelect={()=>{setSettingsSection('general');setSettings(true)}}>
          <Settings2Icon className="size-3.5"/>
          {t.settings}
        </DropdownMenuItem>
        <DropdownMenuSeparator/>
        <DropdownMenuItem className="cursor-pointer gap-2 text-sm" onSelect={()=>void change({...prefs,appearance:effectiveDark?'light':'dark'})}>
          {effectiveDark?<SunIcon aria-hidden="true" className="size-3.5"/>:<MoonIcon aria-hidden="true" className="size-3.5"/>}
          {effectiveDark?webMessages.chat.switchToLightMode:webMessages.chat.switchToDarkMode}
        </DropdownMenuItem>
        {account?.user&&<>
          <DropdownMenuSeparator/>
          <DropdownMenuItem className="cursor-pointer gap-2 text-sm" onSelect={()=>void signOut()}>
            <LogOutIcon aria-hidden="true" className="size-3.5"/>
            {webMessages.chat.signOut}
          </DropdownMenuItem>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
  </aside>
  {schedulesOpen?<Schedules language={lang} projects={projects} skills={skills} mcpServers={mcpServers} onOpenChat={id=>void openChat(id)} onAskAI={text=>void askAI(text)}/>:skillsOpen?<Skills language={lang} onClose={()=>setSkillsOpen(false)} onChanged={items=>{setSkills(items);if(skillId&&!items.some(item=>item.id===skillId&&item.enabled))setSkillId("")}}/>:documentsOpen?<DocumentLibrary language={lang} onClose={()=>setDocumentsOpen(false)}/>:<main className={messages.length?'chatting':!current?'home':undefined}>
  <header className={messages.length?'conversation-header':undefined}>
    {messages.length ? (
      <div className="conversation-breadcrumb">
        <FolderIcon aria-hidden="true" className="size-[18px] shrink-0 text-muted-foreground"/>
        <span className="conversation-workspace truncate">{current?.name??(selected?t.projectMissing:'PiWork')}</span>
        <span aria-hidden="true">/</span>
        <span className="conversation-title truncate" title={conversationTitle}>{conversationTitle}</span>
      </div>
    ) : current?current.name:selected?t.projectMissing:null}
    {/* 右上角 dock 开关仅在面板收起时显示,展开时由面板内 dock-chrome 的收起按钮负责,保证同一时刻只有一个 toggle */}
    <div className="header-actions">
      {previewCollapsed&&<button aria-label={t.expandPreview} className="header-panel-toggle" onClick={()=>setPreviewCollapsed(false)} title={t.expandPreview} type="button"><PanelRightIcon className="size-4"/></button>}
      {current&&<button className="header-files" type="button" aria-pressed={(!previewCollapsed&&activeDockTab==='files')||undefined} onClick={()=>{if(!previewCollapsed&&activeDockTab==='files')setPreviewCollapsed(true);else openFilesTab()}}>{t.files}</button>}
    </div>
  </header>
  {messages.length ? (
    <Conversation
      busy={chatBusy}
      copy={{process:webMessages.reasoning,waiting:webChat.waiting,scrollToBottom:webMessages.common.scrollToBottom,copy:webChat.copy,copied:webChat.copied,copyFailed:webChat.copyFailed,saveAnswer:t.saveAnswer,saveHtml:t.saveHtml,htmlSaved:t.htmlSaved,htmlSaveFailed:t.htmlSaveFailed,openHtml:t.openExternal,preview:t.preview}}
      key={activeChat??'draft'}
      messages={messages}
      onSave={text=>void saveAnswer(text)}
      context={selected&&<p className="project-context-note">{prefs.permission==='full'?t.projectContextNoticeFull:t.projectContextNotice}{originalPath&&<><br/>{t.originalProjectPath}{originalPath}</>}</p>}
      onOpenToolFile={path=>{void openDocumentLink(path)}}
      onDocumentAction={(path,action)=>{void documentAction(path,action)}}
      fileFolders={current?.folders}
      onOpenAttachment={ref=>void openAttachment(ref)}
      onPreviewHtml={(content,name)=>openDocumentTab({path:`html:${name}`,content,kind:'html',label:name,virtual:true})}
      toolCopy={{
        label:t.toolActivity,
        running:t.toolRunning,
        completed:t.toolCompleted,
        failed:t.toolFailed,
        reasons:{denied:t.toolDenied,changed:t.toolChanged,invalid:t.toolInvalid,error:t.toolError,interrupted:t.toolInterrupted},
        names:{ask_user:lang==='zh-CN'?'询问用户':'Ask user',skill_bash:t.toolBash,bash:webMessages.toolStatus.bash,skill_read:t.toolSkillRead,
          project_list:t.toolList,project_read:t.toolRead,project_write:t.toolWrite,project_create_office:t.toolOffice},
        params:t.toolParams,
        output:t.toolOutput,
        expandAll:t.toolExpandAll,
        collapseAll:t.toolCollapseAll,
        showLess:t.toolShowLess,
        moreLines:count=>t.toolMoreLines.replace('{n}',String(count)),
        groups:{browse:t.toolGroupBrowse,run:t.toolGroupRun,write:t.toolGroupWrite,tools:t.toolActivity,
          files:count=>`${count} ${t.toolGroupFiles}`,searches:count=>`${count} ${t.toolGroupSearches}`,fetches:count=>`${count} ${t.toolGroupFetches}`,
          commands:count=>`${count} ${t.toolGroupCommands}`,writes:count=>`${count} ${t.toolGroupWrites}`,calls:count=>`${count} ${t.toolGroupCalls}`,
          join:parts=>parts.join(lang==='zh-CN'?'，':', ')},
      }}
      unexecutedToolRequest={selected?t.unexecutedToolRequest:`${t.unexecutedToolRequest} ${t.missingProjectToolHint}`}
    />
  ) : current ? (
    <ProjectHome
      attachments={attachments.map(item=>({name:typeof item==='string'?item.split('/').at(-1)!:item.name,ref:attachmentRefOf(item)}))}
      attachmentReady={!attachmentLoading}
      onOpenAttachment={ref=>void openAttachment(ref)}
      busy={chatBusy}
      chats={chats}
      copy={projectHomeCopy}
      feedback={chatError||((!gateway&&!account?.models.length)?t.configure:undefined)}
      onRemoveAttachment={index=>removeAttachment(attachments[index]!)}
      onDeleteChat={chat=>deleteChat(chat)}
      onEditProject={()=>editProject(current)}
      onOpenChat={id=>void openChat(id)}
      onOpenLibrary={()=>setLibraryPickerOpen(true)}
      onPasteImage={pasteFiles}
      onPickAttachment={()=>void pickAttachment()}
      onProjectChanged={()=>void refreshProjects()}
      onRemoveProject={project=>void remove(project)}
      onRenameChat={chat=>renameChat(chat)}
      onSend={text=>void sendMessage(text)}
      project={current}
    />
  ) : (
    <section className="empty"><><div className="mark">✳</div><h1>{t.empty}</h1><p>{t.description}</p><button disabled={chatBusy} onClick={add}>{t.add}</button></></section>
  )}
{(!current||messages.length>0||pendingInteractions.length>0)&&<div className="composer-shell" data-awaiting={pendingInteractions.length>0||undefined}>
  {messages.length>0&&(
    <p className="conversation-disclaimer">{webChat.piworkCanMakeMistakesCheckImportantInformation}</p>
  )}
  {interactionDock}
  <form className="openai-composer" onSubmit={sendChat}>
    {slashOpen&&<div className="slash-menu" data-more={slashOverflow||undefined}><p className="slash-menu-title" id="slash-menu-title">{lang==='zh-CN'?'技能与 MCP':'Skills & MCP'}</p><div className="slash-menu-list" ref={slashListRef} onMouseDown={e=>e.preventDefault()} role="listbox" aria-labelledby="slash-menu-title">{slashMatches.map((item,index)=><button key={`${item.kind}:${item.id}`} id={`slash-option-${index}`} type="button" role="option" aria-selected={index===slashActive} className={'slash-option'+(index===slashActive?' active':'')} onMouseEnter={()=>setSlashIndex(index)} onClick={()=>applySlash(item)}><span className="slash-option-icon">{item.kind==='mcp'?<PlugIcon size={16}/>:<BoxIcon size={16}/>}</span><span className="slash-option-name">{item.name}</span><span className="slash-option-desc">{item.description}</span><span className="slash-option-tag">{item.tag}</span></button>)}</div></div>}
    <div className="composer" data-slot="input-group">
      {attachments.length>0&&<div className="attachment-chips">{attachments.map(item=><AttachmentChip key={typeof item==='string'?item:item.token} name={typeof item==='string'?item:item.name} attachmentRef={attachmentRefOf(item)} onOpen={ref=>void openAttachment(ref)} onRemove={()=>removeAttachment(item)} removeLabel={t.removeAttachment} previewLabel={t.preview}/>)}</div>}
      {mcpId&&<div className="capability-chips"><span>MCP: {mcpServers.find(item=>item.id===mcpId)?.name}<button type="button" onClick={()=>setMcpId('')} aria-label={lang==='zh-CN'?`取消选择 ${mcpServers.find(item=>item.id===mcpId)?.name??''}`:`Detach ${mcpServers.find(item=>item.id===mcpId)?.name??''}`}>×</button></span></div>}
      <div className="composer-input" data-has-skill={!!skillMention||undefined}>
        <div className="composer-highlight" ref={composerHighlight} aria-hidden="true">{skillMention&&<>{draft.slice(0,skillMention.start)}<span className="composer-skill-mention"><span className="composer-skill-icon">{'\u2003'}<BoxIcon size={14}/></span>{draft.slice(skillMention.start+1,skillMention.end)}</span>{draft.slice(skillMention.end)}{'\n'}</>}</div>
      <textarea
        ref={composerInput}
        placeholder={current && !messages.length ? webChat.newChatInProject.replace('{name}', current.name) : webChat.askAnything}
        aria-label={t.placeholder}
        value={draft}
        aria-activedescendant={slashOpen?`slash-option-${slashActive}`:undefined}
        onChange={e=>{updateComposerDraft(e.target.value);setComposerSelection({start:e.currentTarget.selectionStart,end:e.currentTarget.selectionEnd})}}
        onScroll={e=>{const highlight=composerHighlight.current;if(highlight){highlight.scrollTop=e.currentTarget.scrollTop;highlight.scrollLeft=e.currentTarget.scrollLeft}}}
        onSelect={e=>{const {selectionStart:start,selectionEnd:end}=e.currentTarget;if(start!==composerSelection.start||end!==composerSelection.end){setComposerSelection({start,end});setSlashDismissed(false);setSlashIndex(0)}}}
        onPaste={pasteFiles}
        onKeyDown={e=>{
          if(skillMention&&!e.nativeEvent.isComposing&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&(e.key==='Backspace'||e.key==='Delete')){
            const {selectionStart:start,selectionEnd:end}=e.currentTarget;
            if(start===end&&((e.key==='Backspace'&&start>skillMention.start&&start<=skillMention.end)||(e.key==='Delete'&&start>=skillMention.start&&start<skillMention.end))){
              e.preventDefault();setDraft(draft.slice(0,skillMention.start)+draft.slice(skillMention.end));setSkillMention(null);setSkillId('');setSlashDismissed(true);focusComposerAt(skillMention.start);return;
            }
          }
          if(slashOpen&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();setSlashIndex(e.key==='ArrowDown'?(slashActive+1)%slashMatches.length:(slashActive-1+slashMatches.length)%slashMatches.length);return}
          if(slashOpen&&e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();applySlash(slashMatches[slashActive]);return}
          if(slashOpen&&e.key==='Escape'){e.preventDefault();setSlashDismissed(true);return}
          if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      </div>
      <div className="composer-actions">
        <AttachmentsMenu
          copy={webChat}
          disabled={chatBusy||attachmentLoading}
          onComputer={()=>void pickAttachment()}
          onLibrary={()=>setLibraryPickerOpen(true)}
        />
        {/* 权限模式:对话进行中也可切换,变更即时下发 worker */}
        <ComposerPermissionMenu
          copy={{label:t.permissionLabel,modes:[
            {value:'confirm',title:t.permConfirm,hint:t.permConfirmHint},
            {value:'auto',title:t.permAuto,hint:t.permAutoHint},
            {value:'full',title:t.permFull,hint:t.permFullHint},
          ]}}
          value={prefs.permission??'confirm'}
          onChange={mode=>{if(mode!==(prefs.permission??'confirm'))void change({...prefs,permission:mode})}}
          onFocusInput={()=>composerInput.current?.focus()}
        />
        <ComposerModelMenu
          copy={webChat}
          disabled={chatBusy||!!activeChat}
          label={t.model}
          models={models}
          value={modelValue}
          configure={t.configureModels}
          onConfigure={()=>{setSettingsSection('gateway');setSettings(true)}}
          onChange={setModelSelection}
          onFocusInput={()=>composerInput.current?.focus()}
        />
        {chatBusy
          ? <Button className="composer-submit" size="icon-lg" type="button" aria-label={t.stop} title={webChat.stopGenerating} onClick={()=>window.desktop.stopChat()}><StopIcon aria-hidden="true" className="size-4"/></Button>
          : <Button className="composer-submit" size="icon-lg" type="submit" aria-label={t.send} title={t.send} disabled={!draftPrompt||attachmentLoading}><ArrowUpIcon aria-hidden="true" className="size-5"/></Button>}
      </div>
    </div>
  </form>
  {!messages.length && !activeChat && (
    <ComposerProjectMenu copy={webChat} disabled={chatBusy||attachmentLoading} projects={projects} selected={current} onChange={id=>void selectProject(id)}/>
  )}
  {(chatError || (!gateway && !account?.models.length)) && (
    <p className="composer-feedback" role="status">{chatError || t.configure}</p>
  )}
</div>}
{error&&<div role="alert" className="error-banner">{error}</div>}</main>}<LibraryFilePicker open={libraryPickerOpen} onOpenChange={open=>{if(!attachmentLoading)setLibraryPickerOpen(open)}} onPick={file=>pickAttachment(file)}/>{searchOpen&&<div className="overlay"><section className="dialog search-dialog" role="dialog" aria-modal="true" aria-label={t.searchChats}><div className="dialog-header"><h2>{t.searchChats}</h2><button onClick={()=>setSearchOpen(false)} aria-label={t.close}>×</button></div><input autoFocus aria-label={t.searchChats} value={chatSearch} onChange={e=>setChatSearch(e.target.value)}/><div>{chats.filter(chat=>chat.title.toLocaleLowerCase().includes(chatSearch.trim().toLocaleLowerCase())).map(chat=><button className="file-row" disabled={chatBusy} key={chat.id} onClick={()=>{setSearchOpen(false);void openChat(chat.id)}}>{chat.title}</button>)}</div></section></div>}{!schedulesOpen&&!skillsOpen&&!documentsOpen&&<PreviewDock
  tabs={dockTabs}
  activeTabId={activeDockTab}
  onActivate={activateDockTab}
  onClose={closeDockTab}
  onNewTab={newDockTab}
  collapsed={previewCollapsed}
  fullscreen={previewFullscreen}
  animating={previewAnimating}
  width={previewPanelWidth}
  resizer={previewResizer}
  onCollapse={setPreviewCollapsed}
  onFullscreen={setPreviewFullscreen}
  onTransitionEnd={event=>{if(event.propertyName==='width'||event.propertyName==='transform')endPreviewAnimation()}}
  language={lang}
  words={{files:t.files,searchFiles:t.searchFiles,searchHint:t.searchHint,noMatches:t.noMatches,up:t.up,emptyFolder:t.emptyFolder,attach:t.attach,openExternal:t.openExternal,reveal:t.reveal,unsupported:t.unsupported,loading:t.loading,fileError:t.fileError,collapsePreview:t.collapsePreview,fullscreenPreview:t.fullscreenPreview,exitFullscreenPreview:t.exitFullscreenPreview,newTab:t.newTab,closeTab:t.closeTab,guideStart:t.guideStart}}
  selected={selected}
  hasProject={!!selected}
  onGuideFiles={()=>openGuideTool('files')}
  onGuideBrowser={()=>openGuideTool('browser')}
  files={files}
  folder={folder}
  fileQuery={fileQuery}
  filesLoading={loading}
  filesError={fileError}
  onFolderChange={setFolder}
  onFileQueryChange={setFileQuery}
  onOpenEntry={entry=>void openFile(entry)}
  chatBusy={chatBusy}
  onAttach={path=>addAttachments([path])}
  onTabError={setTabError}
  onOpenExternal={file=>{if(file.cache)window.desktop.openAttachmentExternal(file.cache).catch(()=>toast.error(t.openFailed));else if(selected)window.desktop.openFile(selected,file.path).catch(()=>toast.error(t.openFailed))}}
  onReveal={file=>{if(file.cache)window.desktop.revealAttachment(file.cache).catch(()=>toast.error(t.openFailed));else if(selected)window.desktop.revealFile(selected,file.path).catch(()=>toast.error(t.openFailed))}}
  onTitleChange={setTabTitle}
  onOpenUrlExternal={url=>{void window.desktop.openExternalUrl(url).catch(()=>toast.error(t.openFailed))}}
/>}{editingChat&&<div className="overlay"><section className="dialog" role="dialog" aria-modal="true" aria-label={t.renameChat}><div className="dialog-header"><h2>{t.renameChat}</h2><button onClick={()=>setEditingChat(null)} aria-label={t.close}>×</button></div><form className="project-edit" onSubmit={saveChatTitle}><label>{t.renameChat}<input value={chatTitle} maxLength={80} required autoFocus onChange={e=>setChatTitle(e.target.value)}/></label><button type="submit">{t.save}</button> <button type="button" onClick={()=>setEditingChat(null)}>{t.cancel}</button>{chatEditError&&<p className="error" role="alert">{chatEditError}</p>}</form></section></div>}<CreateProjectDialog copy={projectDialogCopy} open={createOpen} onClose={()=>setCreateOpen(false)} onCreated={async project=>{setCreateOpen(false);setProjects(await window.desktop.listProjects());await selectProject(project.id)}}/>{editingProject&&<EditProjectDialog copy={projectDialogCopy} project={editingProject} open={!!editingProject} onClose={()=>setEditingProject(null)} onSaved={()=>{setEditingProject(null);void refreshProjects()}} onRemoved={async project=>{setEditingProject(null);setProjects(await window.desktop.listProjects());if(selected===project.id&&!activeChat){setSelected(null);setAttachments([])}}}/>}{webHistoryOpen&&<WebHistory language={lang} onClose={()=>setWebHistoryOpen(false)} onImported={id=>{setWebHistoryOpen(false);void window.desktop.listChats().then(setChats);void openChat(id)}}/>}</div>}{lightbox&&<Lightbox index={lightbox.index} items={lightbox.items} language={lang} onClose={()=>setLightbox(null)}/>}{(settings||schedulesOpen||skillsOpen||documentsOpen)&&pendingInteractions.length>0&&<div className="interaction-detached">{interactionDock}</div>}<Toaster position="top-center" theme="system" toastOptions={{className:'!bg-card !text-foreground !border-[var(--hairline-strong)] !shadow-none'}}/></>;}
createRoot(document.getElementById('root')!).render(<WebIntlProvider>{location.hash==='#smoke-brand'?<BrandSmoke/>:<App/>}</WebIntlProvider>);
