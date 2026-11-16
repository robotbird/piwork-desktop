export type Appearance = 'system' | 'light' | 'dark';
export type Language = 'system' | 'zh-CN' | 'en';
/** 工具执行确认模式(对齐 ZCode 权限档位):confirm 全部确认(默认);auto 自主(仅落盘写入确认);full 完全访问(免确认) */
export type PermissionMode = 'confirm' | 'auto' | 'full';
/** 对话模型来源:account 走 PiWork 账号(piwork.net)模型;custom 走本地安装的模型供应商。缺省自动(有账号模型选 account,否则 custom) */
export type ModelSource = 'account' | 'custom';
export type Preferences = {appearance: Appearance; language: Language; syncEnabled?:boolean; permission?:PermissionMode; modelSource?:ModelSource};
/** 项目源文件夹:label 为项目内唯一短名(路径 basename 派生),main 标记主文件夹(可写、默认工作目录) */
export type ProjectFolder = {path:string; label:string; main:boolean; available?:boolean};
export type Project = {id:string; name:string; description?:string; folders:ProjectFolder[]; available:boolean};
export type ProjectFile = {name:string; path:string; kind:'file'|'directory'};
export type GatewayConfig = {baseUrl:string;modelId:string;hasApiKey:boolean;supportsImages:boolean};
/** 模型供应商声明式定义:内置目录 / 上传插件包 / 安装快照共用的纯数据形状(不执行插件代码)。
    局部文本 keyed by BCP-47('zh-CN'/'en'),缺键回退 en */
export type LocalizedText = Record<string,string>;
export type ProviderModelSpec = {modelId:string;label:LocalizedText;vision:boolean;reasoning:boolean;toolCall:boolean;contextSize:number;defaultMaxTokens:number};
export type ProviderCredentialField = {variable:string;type:'secret-input'|'text-input';label:LocalizedText;required:boolean;placeholder?:LocalizedText};
/** openai-completions 兼容参数(桌面 pi-ai OpenAICompletionsCompat 的白名单子集) */
export type ProviderCompat = {maxTokensField?:'max_tokens'|'max_completion_tokens';thinkingFormat?:'ant-ling'|'baseten'|'chat-template'|'deepseek'|'openai'|'openrouter'|'qwen'|'qwen-chat-template'|'string-thinking'|'together'|'zai';supportsDeveloperRole?:boolean;supportsReasoningEffort?:boolean;supportsStore?:boolean};
export type ProviderDefinition = {packageId:string;providerKey:string;version:string;name:LocalizedText;description:LocalizedText;baseUrl:string;networkHosts:string[];validationModel:string;helpUrl?:string;credentialFields:ProviderCredentialField[];compat?:ProviderCompat;models:ProviderModelSpec[]};
/** source:'builtin' 内置目录安装;'upload' 上传插件包;'openai-compat' 常驻的 OpenAI 兼容网关(承接旧 gateway.json,模型目录可编辑) */
export type ProviderInstallation = {id:string;source:'builtin'|'upload'|'openai-compat';definition:ProviderDefinition;baseUrl:string;enabled:boolean;enabledModels:string[];credentialsConfigured:boolean;credentialSummary:Record<string,string>;credentialReadable?:boolean;iconDataUrl?:string;updatedAt:number};
export type ProviderCatalogItem = ProviderDefinition & {installed:boolean};
/** 全局自定义默认模型(跨安装项唯一,对齐 web 端 defaultModelId 语义) */
export type ProviderDefaultModel = {providerKey:string;modelId:string};
export type ModelProvidersView = {installations:ProviderInstallation[];catalog:ProviderCatalogItem[];defaultModel:ProviderDefaultModel|null};
/** 渲染层提交的安装项更新;credentials 空串=保留已存值;models 仅 openai-compat 可用(整表替换);defaultModelId 指该安装项内模型 */
export type ProviderUpdateInput = {enabled?:boolean;enabledModels?:string[];credentials?:Record<string,string>;baseUrl?:string;models?:ProviderModelSpec[];defaultModelId?:string|null};
export type ChatSummary = {id:string; title:string; updatedAt:number; projectId?:string | null; projectPath?:string | null; projectFolders?:string[] | null; workspaceFolder?:string; summary?:string | null; modelBinding?:{source:'account'|'custom';id:string;baseUrl:string;userId?:string}};
/** cache 为附件副本在 <userData>/attachments 下的相对路径(token/name),供发送前后与历史消息预览 */
export type PickedAttachment = {token:string;name:string;kind:"text"|"image";cache?:string};
/** 对话消息可回溯的附件引用:projectPath 为项目相对路径,cachePath 为附件缓存相对路径;
    textContent 为旧版历史消息(无缓存机制)随 marker 存储的文本内容,仅文本类附件可还原 */
export type ChatAttachmentRef = {name:string;projectPath?:string;cachePath?:string;textContent?:string};
/** 用户消息的单个附件:ref 缺省时(如旧历史无缓存副本的图片)仅按 name 展示 */
export type ChatMessageAttachment = {name:string;ref?:ChatAttachmentRef};
/** assistant 回合内按时间线交错的段:文字段与工具组段交替(pi 语义:每条 assistant 消息 = text + 其 toolCalls);
    segments 缺省时渲染端回退到 text + toolEvents 平铺展示 */
export type AssistantSegment = {kind:'text';text:string}|{kind:'tools';tools:ToolEvent[]};
export type ChatMessage = {role:'user'|'assistant'; text:string; startedAt?:number; durationMs?:number; attachments?:ChatMessageAttachment[]; toolEvents?:ToolEvent[]; segments?:AssistantSegment[]; skillName?:string};
/** chat:readAttachment 的返回,kind 与渲染端 DockFile 对齐;missingFonts 为引擎声明的缺失字体(仅 office 转 PDF 路径) */
export type AttachmentPreview = {name:string;kind:'text'|'html'|'image'|'pdf'|'docx'|'xlsx'|'pptx'|'unsupported';content:string;missingFonts?:string[]};
/** office 文档预览(files:readDocument 与 library office 读取共用):kind 为应挂载的预览器——
    高保真路径转 PDF 成功返回 kind:'pdf',引擎不可用时回落原始字节(kind 为原扩展名) */
export type DocumentPreview = {kind:'pdf'|'docx'|'xlsx'|'pptx';content:string;missingFonts?:string[]};
/** args/result 为经截断清洗的展示副本(见 electron/tool-history.ts),非原始载荷 */
export type ToolEvent = {type:'tool';id:string;name:string;status:'running'|'completed'|'failed';path?:string;reason?:'denied'|'changed'|'invalid'|'error'|'interrupted';args?:Record<string,unknown>;result?:string;durationMs?:number;startedAt?:number;sources?:MessageSource[]};
/** 联网工具结果中抽取的来源展示副本(worker 侧抽取,见 electron/tool-sources.ts);favicon 经 chat:favicon 代理为 data URL */
export type MessageSource={url:string;title:string;snippet?:string};
export type ChatEvent = {type:'delta';text:string}|{type:'completed';text:string}|{type:'failed';message:string}|{type:'aborted'}|{type:'approval';id:string;name:string;detail:string;key?:string}|ToolEvent;
/** UIMessageChunk 流(worker 经 web stream-mapping 翻译后双发;P5 渲染层切换消费) */
export type ChatChunkMessage = {type:'chunk';chunk?:unknown;control?:'start'|'end'|'error';runId?:string;reason?:string;error?:string};
/** worker→main:前台对话 Agent 的 create_scheduled_task 工具请求建定时任务 */
export type ScheduleCreateRequest = {type:'schedule:create';id:string;input:{taskType:string;prompt:string;cron:string;timezone:string}};
/** main→worker:schedule:create 的处理结果 */
export type ScheduleCreateResult = {type:'schedule:result';id:string;ok:boolean;error?:string};
/** worker→main:office_render 工具请求把 Office 文档页渲染成 PNG(agent 视觉自检;路径校验在 main 侧) */
export type OfficeRenderRequest = {type:'render:request';id:string;inputPath:string;pages?:number[]};
/** main→worker:render:request 的处理结果(引擎不可用/路径越权时 error) */
export type OfficeRenderResult = {type:'render:result';id:string;outcome?:{pageCount:number;missingFonts:string[];images:{data:string;mimeType:string;width:number;height:number}[]};error?:string};
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
export type AccountStatus={loginServer?:string;loginPending?:boolean;loginFailed?:boolean;baseUrl:string|null;user:{id:string;name:string|null;email:string|null}|null;defaultModelId?:string;models:{id:string;name:string;providerKey?:string;supportsImages?:boolean}[]};
export type WebHistoryItem={id:string;title:string;createdAt:string;shared:boolean};
/** 客户端更新信息(来自 GitHub Releases latest);sha256 取资产 digest,缺失为空(仅 size 校验) */
export type AppUpdateInfo={version:string;notes:string;assetName:string;downloadUrl:string;size:number;sha256:string};
export type AppUpdateProgress={received:number;total:number};
/** 更新状态机:idle 未检查 / upToDate 已是最新 / available 有新版 / downloading 下载中 / downloaded 已就绪 */
export type AppUpdateState={phase:'idle'|'upToDate'|'available'|'downloading'|'downloaded';info?:AppUpdateInfo;progress?:AppUpdateProgress};
export type LibraryEntry={path:string;parentPath:string;name:string;kind:'file'|'folder';source:'upload'|'ai'|'manual';contentType:string|null;size:number;updatedAt:number};
/** 工具审批请求(主进程→输入框上方交互卡片);context 为附加来源(如定时任务名);
    key 为「始终允许」的稳定标识(skill_bash 为命令全文,mcp__* 为工具名),仅执行类工具携带 */
export type ApprovalRequest={id:string;name:string;detail:string;context?:string;key?:string};
/** 审批答复:allow 允许一次;always 允许并记入项目级始终允许名单;deny 拒绝 */
export type ApprovalDecision='allow'|'always'|'deny';
export type AgentQuestion={id:string;question:string;header?:string;options?:{label:string;description?:string}[]};
export type QuestionRequest={type:'question';id:string;questions:AgentQuestion[]};
/** null 表示跳过;cancelled 表示关闭整组问题,不应被模型视为确认。 */
export type QuestionResponse={answers:Record<string,string|null>;cancelled?:boolean};
export type DesktopApi = {
  listWebHistory(before?:string):Promise<{chats:WebHistoryItem[];hasMore:boolean}>;
  readWebHistory(id:string):Promise<{messages:{id:string;role:'user'|'assistant';text:string}[];omitted:boolean}>;
  importWebHistory(id:string,title:string):Promise<string>;
  openWebHistory(id:string):Promise<void>;
  accountStatus():Promise<AccountStatus>;
  accountLogin(baseUrl:string):Promise<void>;
  onAccountChanged(listener:()=>void):()=>void;
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
  /** 粘贴的剪贴板内容:带 path 的条目为 Finder 拷贝的文件(任意类型),base64 条目为剪贴板图片字节;
      全部成功才写入附件缓存(任一失败整批放弃),返回值与 pick-attachment 一样占用多附件槽位 */
  attachFiles(items:({path:string}|{name:string;mimeType:string;base64:string})[]):Promise<PickedAttachment[]>;
  /** 输入框移除附件 chip:释放主进程为对应 token 持有的读取内容 */
  detachAttachments(tokens:string[]):Promise<void>;
  /** 读取附件缓存副本并按扩展名给出可直接进 dock 的预览内容 */
  readAttachment(cache:string):Promise<AttachmentPreview>;
  openAttachmentExternal(cache:string):Promise<void>;
  revealAttachment(cache:string):Promise<void>;
  sendChat(text:string, projectId:string|null,skillId:string|null,mcpId:string|null,attachments:(string|{token:string})[],model?:{source:'account'|'custom';id:string}):Promise<string>;
  /** 编辑用户消息:把会话截断到该条用户消息之前(第 userIndex 条,与 openChat 投影顺序一致),
      其后条目全部舍弃;随后应立即 sendChat 以新文本重生成 */
  editChat(id:string, userIndex:number):Promise<void>;
  renameChat(id:string,title:string):Promise<void>;
  deleteChat(id:string):Promise<void>;
  listChats():Promise<ChatSummary[]>;
  generatedDocumentAction(id:string,path:string,action:'open'|'reveal'):Promise<void>;
  cacheGeneratedDocument(id:string,path:string):Promise<{name:string;cache:string}>;
  openChat(id:string):Promise<{messages:ChatMessage[];projectId:string|null;modelBinding?:ChatSummary['modelBinding'];toolEvents:Extract<ChatEvent,{type:'tool'}>[]}>;
  stopChat():Promise<void>;
  clearChat():Promise<void>;
  onChat(listener:(event:ChatEvent)=>void):()=>void;
  onChatChunks(listener:(event:ChatChunkMessage)=>void):()=>void;
  onApprovalRequest(listener:(request:ApprovalRequest)=>void):()=>void;
  onApprovalClosed(listener:(id:string)=>void):()=>void;
  respondApproval(id:string,decision:ApprovalDecision):Promise<void>;
  onQuestionRequest(listener:(request:QuestionRequest)=>void):()=>void;
  onQuestionClosed(listener:(id:string)=>void):()=>void;
  respondQuestion(id:string,response:QuestionResponse):Promise<void>;
  onBrowserOpen(listener:(url:string)=>void):()=>void;
  openExternalUrl(url:string):Promise<void>;
  /** 来源站点图标:主进程抓取 origin/favicon.ico 转存为 data URL(内存缓存);失败返回 null,渲染端回退首字母头像 */
  favicon(url:string):Promise<string|null>;
  /** 来源页面元数据:抓取页面头部解析标题/摘要,补齐纯文本 URL 来源缺失的展示信息;失败返回空对象 */
  sourceMeta(url:string):Promise<{title?:string|null;description?:string|null}>;
  getGateway():Promise<GatewayConfig | null>;
  setGateway(input:{baseUrl:string;modelId:string;apiKey:string;supportsImages?:boolean}):Promise<GatewayConfig>;
  /** 模型供应商管理:目录安装/插件包上传/配置更新/卸载/默认模型;变更后推送 model-providers:changed */
  getModelProviders():Promise<ModelProvidersView>;
  installModelProvider(packageId:string):Promise<ModelProvidersView>;
  uploadModelProvider():Promise<ModelProvidersView>;
  updateModelProvider(id:string,patch:ProviderUpdateInput):Promise<ModelProvidersView>;
  removeModelProvider(id:string):Promise<ModelProvidersView>;
  setDefaultModel(value:ProviderDefaultModel|null):Promise<ModelProvidersView>;
  onModelProvidersChanged(listener:()=>void):()=>void;
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
  /** pptx/docx/xlsx:高保真 LibreOffice→PDF 预览,失败回落原始字节(electron/office-preview.ts) */
  readDocument(id:string, path:string):Promise<DocumentPreview>;
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
  libraryReadDocx(itemPath:string):Promise<DocumentPreview>;
  libraryReadXlsx(itemPath:string):Promise<DocumentPreview>;
  libraryReadPptx(itemPath:string):Promise<DocumentPreview>;
  pathForFile(file:File):string;
};
