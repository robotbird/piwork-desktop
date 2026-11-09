export type Appearance = 'system' | 'light' | 'dark';
export type Language = 'system' | 'zh-CN' | 'en';
/** 工具执行确认模式(对齐 ZCode 权限档位):confirm 全部确认(默认);auto 自主(仅落盘写入确认);full 完全访问(免确认) */
export type PermissionMode = 'confirm' | 'auto' | 'full';
export type Preferences = {appearance: Appearance; language: Language; syncEnabled?:boolean; permission?:PermissionMode};
/** 项目源文件夹:label 为项目内唯一短名(路径 basename 派生),main 标记主文件夹(可写、默认工作目录) */
export type ProjectFolder = {path:string; label:string; main:boolean; available?:boolean};
export type Project = {id:string; name:string; description?:string; folders:ProjectFolder[]; available:boolean};
export type ProjectFile = {name:string; path:string; kind:'file'|'directory'};
export type GatewayConfig = {baseUrl:string;modelId:string;hasApiKey:boolean;supportsImages:boolean};
export type ChatSummary = {id:string; title:string; updatedAt:number; projectId?:string | null; projectPath?:string | null; projectFolders?:string[] | null; summary?:string | null; modelBinding?:{source:'account'|'custom';id:string;baseUrl:string;userId?:string}};
/** cache 为附件副本在 <userData>/attachments 下的相对路径(token/name),供发送前后与历史消息预览 */
export type PickedAttachment = {token:string;name:string;kind:"text"|"image";cache?:string};
/** 对话消息可回溯的附件引用:projectPath 为项目相对路径,cachePath 为附件缓存相对路径;
    textContent 为旧版历史消息(无缓存机制)随 marker 存储的文本内容,仅文本类附件可还原 */
export type ChatAttachmentRef = {name:string;projectPath?:string;cachePath?:string;textContent?:string};
/** assistant 回合内按时间线交错的段:文字段与工具组段交替(pi 语义:每条 assistant 消息 = text + 其 toolCalls);
    segments 缺省时渲染端回退到 text + toolEvents 平铺展示 */
export type AssistantSegment = {kind:'text';text:string}|{kind:'tools';tools:ToolEvent[]};
export type ChatMessage = {role:'user'|'assistant'; text:string; attachmentName?:string; attachment?:ChatAttachmentRef; toolEvents?:ToolEvent[]; segments?:AssistantSegment[]; skillName?:string};
/** chat:readAttachment 的返回,kind 与渲染端 DockFile 对齐 */
export type AttachmentPreview = {name:string;kind:'text'|'html'|'image'|'pdf'|'docx'|'xlsx'|'pptx'|'unsupported';content:string};
/** args/result 为经截断清洗的展示副本(见 electron/tool-history.ts),非原始载荷 */
export type ToolEvent = {type:'tool';id:string;name:string;status:'running'|'completed'|'failed';path?:string;reason?:'denied'|'changed'|'invalid'|'error'|'interrupted';args?:Record<string,unknown>;result?:string;durationMs?:number;startedAt?:number};
export type ChatEvent = {type:'delta';text:string}|{type:'completed';text:string}|{type:'failed';message:string}|{type:'aborted'}|{type:'approval';id:string;name:string;detail:string;key?:string}|ToolEvent;
/** UIMessageChunk 流(worker 经 web stream-mapping 翻译后双发;P5 渲染层切换消费) */
export type ChatChunkMessage = {type:'chunk';chunk?:unknown;control?:'start'|'end'|'error';runId?:string;reason?:string;error?:string};
/** worker→main:前台对话 Agent 的 create_scheduled_task 工具请求建定时任务 */
export type ScheduleCreateRequest = {type:'schedule:create';id:string;input:{taskType:string;prompt:string;cron:string;timezone:string}};
/** main→worker:schedule:create 的处理结果 */
export type ScheduleCreateResult = {type:'schedule:result';id:string;ok:boolean;error?:string};
export type ScheduleInput = {name:string;prompt:string;cron:string;timezone:string;projectId:string|null;skillId?:string|null;mcpId?:string|null};
export type Schedule = ScheduleInput & {id:string;enabled:boolean;nextAt:number;gatewayUrl:string;modelId:string};
export type ScheduleRun = {id:string;scheduleId:string;scheduleName?:string;plannedAt:number;startedAt?:number;finishedAt?:number;status:'running'|'completed'|'failed'|'missed'|'skipped';chatId?:string;detail?:string};
/** source:'agents' = 默认从 ~/.agents/skills 同步;'local' = 手动导入。缺省视为 'local'(旧数据)。 */
export type LocalSkill = {id:string;name:string;description:string;filePath:string;enabled:boolean;source?:'agents'|'local'};
export type McpInput={name:string;type:'stdio'|'http';command?:string;args?:string[];url?:string;description?:string;env?:Record<string,string>;headers?:Record<string,string>};
export type McpServer=McpInput&{id:string;enabled:boolean};
/** pi.dev/packages 目录条目(npm search keyword:pi-package,与官网画廊同源) */
export type PiCatalogItem={name:string;version:string;description:string;publisher:string;date:string;keywords:string[];links:{npm?:string;repository?:string}};
export type PiCatalogResult={items:PiCatalogItem[];total:number};
/** 已安装的 pi 插件;安装源 npm:<name>[@<version>],落盘于 <userData>/pi(与 pi CLI pi install 同布局) */
export type InstalledPiPackage={source:string;name:string;version:string;description:string;resources:{extensions:number;skills:number;prompts:number;themes:number}};
export type AccountStatus={baseUrl:string|null;user:{id:string;name:string|null;email:string|null}|null;defaultModelId?:string;models:{id:string;name:string;providerKey?:string;supportsImages?:boolean}[]};
export type WebHistoryItem={id:string;title:string;createdAt:string;shared:boolean};
/** 客户端更新信息(来自 GitHub Releases latest);sha256 取资产 digest,缺失为空(仅 size 校验) */
export type AppUpdateInfo={version:string;notes:string;assetName:string;downloadUrl:string;size:number;sha256:string};
export type AppUpdateProgress={received:number;total:number};
/** 更新状态机:idle 未检查 / upToDate 已是最新 / available 有新版 / downloading 下载中 / downloaded 已就绪 */
export type AppUpdateState={phase:'idle'|'upToDate'|'available'|'downloading'|'downloaded';info?:AppUpdateInfo;progress?:AppUpdateProgress};
export type LibraryEntry={path:string;parentPath:string;name:string;kind:'file'|'folder';source:'upload'|'ai'|'manual';contentType:string|null;size:number;updatedAt:number};
/** 工具审批请求(主进程→渲染层应用内弹窗);context 为附加来源(如定时任务名);
    key 为「始终允许」的稳定标识(skill_bash 为命令全文,mcp__* 为工具名),仅执行类工具携带 */
export type ApprovalRequest={id:string;name:string;detail:string;context?:string;key?:string};
/** 审批答复:allow 允许一次;always 允许并记入项目级始终允许名单;deny 拒绝 */
export type ApprovalDecision='allow'|'always'|'deny';
export type DesktopApi = {
  listWebHistory(before?:string):Promise<{chats:WebHistoryItem[];hasMore:boolean}>;
  readWebHistory(id:string):Promise<{messages:{id:string;role:'user'|'assistant';text:string}[];omitted:boolean}>;
  importWebHistory(id:string,title:string):Promise<string>;
  openWebHistory(id:string):Promise<void>;
  accountStatus():Promise<AccountStatus>;
  accountLogin(baseUrl:string):Promise<void>;
  accountLogout():Promise<void>;
  listMcp():Promise<McpServer[]>;
  testMcp(id:string):Promise<{ok:true;tools:{name:string;description:string}[]}|{ok:false;reason:'unavailable'|'timeout'}>;
  saveMcp(id:string|null,input:McpInput):Promise<void>;
  setMcpEnabled(id:string,enabled:boolean):Promise<void>;
  removeMcp(id:string):Promise<void>;
  searchPiPackages(query:string,offset?:number):Promise<PiCatalogResult>;
  listInstalledPiPackages():Promise<InstalledPiPackage[]>;
  installPiPackage(source:string):Promise<InstalledPiPackage>;
  uninstallPiPackage(source:string):Promise<void>;
  getAppUpdateState():Promise<AppUpdateState>;
  checkAppUpdate():Promise<AppUpdateState>;
  downloadAppUpdate():Promise<AppUpdateState>;
  cancelAppUpdateDownload():Promise<AppUpdateState>;
  openAppUpdateInstaller():Promise<void>;
  onAppUpdateChanged(listener:()=>void):()=>void;
  listSkills():Promise<LocalSkill[]>;
  readSkill(id:string):Promise<string>;
  importSkills():Promise<{added:number;duplicates:number;warnings:number}|null>;
  setSkillEnabled(id:string,enabled:boolean):Promise<void>;
  removeSkill(id:string):Promise<void>;
  listSchedules():Promise<{schedules:Schedule[];runs:ScheduleRun[]}>;
  createSchedule(input:ScheduleInput):Promise<void>;
  updateSchedule(id:string,input:ScheduleInput):Promise<void>;
  toggleSchedule(id:string,enabled:boolean):Promise<void>;
  deleteSchedule(id:string):Promise<void>;
  runSchedule(id:string):Promise<void>;
  pickChatAttachment(file?:{projectId:string;path:string}|{library:string}):Promise<PickedAttachment|null>;
  /** 读取附件缓存副本并按扩展名给出可直接进 dock 的预览内容 */
  readAttachment(cache:string):Promise<AttachmentPreview>;
  openAttachmentExternal(cache:string):Promise<void>;
  revealAttachment(cache:string):Promise<void>;
  sendChat(text:string, projectId:string|null,skillId:string|null,mcpId:string|null,attachment:string|{token:string}|null,model?:{source:'account'|'custom';id:string}):Promise<string>;
  renameChat(id:string,title:string):Promise<void>;
  deleteChat(id:string):Promise<void>;
  listChats():Promise<ChatSummary[]>;
  openChat(id:string):Promise<{messages:ChatMessage[];projectId:string|null;modelBinding?:ChatSummary['modelBinding'];toolEvents:Extract<ChatEvent,{type:'tool'}>[]}>;
  stopChat():Promise<void>;
  clearChat():Promise<void>;
  onChat(listener:(event:ChatEvent)=>void):()=>void;
  onChatChunks(listener:(event:ChatChunkMessage)=>void):()=>void;
  onApprovalRequest(listener:(request:ApprovalRequest)=>void):()=>void;
  onApprovalClosed(listener:(id:string)=>void):()=>void;
  respondApproval(id:string,decision:ApprovalDecision):Promise<void>;
  onBrowserOpen(listener:(url:string)=>void):()=>void;
  openExternalUrl(url:string):Promise<void>;
  getGateway():Promise<GatewayConfig | null>;
  setGateway(input:{baseUrl:string;modelId:string;apiKey:string;supportsImages?:boolean}):Promise<GatewayConfig>;
  recoverInterruptedSync():Promise<void>;
  syncNow():Promise<{state:'off'|'ready'|'syncing'|'pending'|'conflict'|'unavailable'|'interrupted'}>;
  onSyncHistory(listener:(chatId:string)=>void):()=>void;
  syncStatus():Promise<{state:'off'|'ready'|'syncing'|'pending'|'conflict'|'unavailable'|'interrupted'}>;
  onSync(listener:()=>void):()=>void;
  getPreferences():Promise<Preferences>;
  setPreferences(value:Preferences):Promise<Preferences>;
  appVersion():Promise<string>;
  listProjects():Promise<Project[]>;
  /** 原生多选目录选择器;existing 项表示该文件夹已属于其他项目(token 为空) */
  pickProject():Promise<{token:string;path:string;name:string;existing?:Project}[]|null>;
  createProject(tokens:string[],input:{name:string;description:string}):Promise<Project>;
  cancelProject(tokens?:string[]):Promise<void>;
  removeProject(id:string):Promise<void>;
  /** folders 省略时仅更新名称/说明;folder 项带 token(新选)或 path(保留现有) */
  updateProject(id:string,input:{name:string;description:string;folders?:({token:string;main:boolean}|{path:string;main:boolean})[]}):Promise<void>;
  revealProjectFolder(id:string,path:string):Promise<void>;
  saveAnswer(content:string):Promise<string|null>;
  saveHtml(content:string,name:string):Promise<string|null>;
  openFile(id:string,path:string):Promise<void>;
  revealFile(id:string,path:string):Promise<void>;
  listFiles(id:string, path:string):Promise<ProjectFile[]>;
  searchFiles(id:string, query:string):Promise<ProjectFile[]>;
  readText(id:string, path:string):Promise<string>;
  readImage(id:string, path:string):Promise<{mime:string;base64:string}>;
  readPdf(id:string, path:string):Promise<string>;
  readDocx(id:string, path:string):Promise<string>;
  readXlsx(id:string, path:string):Promise<string>;
  readPptx(id:string, path:string):Promise<string>;
  libraryList():Promise<LibraryEntry[]>;
  libraryCreateFolder(parentPath:string,name:string):Promise<string>;
  librarySaveNote(parentPath:string,name:string,content:string):Promise<string>;
  libraryUpload(sources:string[],parentPath:string):Promise<{name:string;path:string}[]>;
  libraryRename(itemPath:string,newName:string):Promise<string>;
  libraryMove(itemPath:string,targetFolderPath:string):Promise<string>;
  libraryTrash(itemPath:string):Promise<void>;
  libraryReveal(itemPath:string):Promise<void>;
  libraryOpen(itemPath:string):Promise<void>;
  libraryExport(itemPath:string):Promise<boolean>;
  libraryReadText(itemPath:string):Promise<string>;
  libraryReadImage(itemPath:string):Promise<{mime:string;base64:string}>;
  libraryReadPdf(itemPath:string):Promise<string>;
  libraryReadDocx(itemPath:string):Promise<string>;
  libraryReadXlsx(itemPath:string):Promise<string>;
  libraryReadPptx(itemPath:string):Promise<string>;
  pathForFile(file:File):string;
};
