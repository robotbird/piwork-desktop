import {assertDocumentReference,cacheGeneratedDocument} from './generated-document';
import { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess, powerMonitor } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Preferences, Project, ChatEvent, ChatChunkMessage, ChatSummary, PickedAttachment, LocalSkill, McpServer, McpInput, Schedule, ScheduleRun, ScheduleInput, ScheduleCreateRequest, OfficeRenderRequest, OfficeRenderResult, ApprovalRequest, ApprovalDecision, QuestionRequest, QuestionResponse } from '../shared/types';
import { listProjectEntries, searchProjectEntries, splitProjectPath, resolveInside, saveProjectMarkdown, readProjectText, readProjectImage, readProjectPdf, verifyImageBytes, imageExtension, type ProjectRoot } from './project-files';
import { listLibrary, createLibraryFolder, saveLibraryNote, uploadLibraryFiles, renameLibraryItem, moveLibraryItem, registerAiFile, forgetLibraryItem, ensureLibrary } from './library-store';
import {completeAccountLogin,setAccountNotifier,accountStatus,openAccountLogin,logoutAccount,accountSyncAvailable,accountSyncTransport,listWebHistory,readWebHistory,openWebHistory} from './account';
import {SyncJournal,type SyncAccount} from './sync-journal';
import {SettingsStorage} from './settings-storage';
import {syncOneChat,prepareSyncRun} from './sync-engine';
import {appendRemoteHistory} from './sync-pi-history';
import {startAccountBridge} from './account-bridge';
import {validateQuestionResponse} from './question-tools';
import {defaultCustomModel,installFromBuffer,installFromCatalog,legacyGatewayGet,legacyGatewaySet,loadModelProviders,modelProvidersView,removeInstallation,resolveCustomModel,resolveScheduledModel,setDefaultModelValue,setModelProvidersNotifier,updateInstallation} from './model-providers/service';
import type {WorkerModelInput} from './model-providers/store';
import { SessionManager, loadSkillsFromDir } from '@earendil-works/pi-coding-agent';
import {addProjectTextAttachment,addPickedAttachment,readChatAttachment,type PickedAttachmentContent} from './chat-attachment';
import {locateUserEntry,projectChatHistory} from './tool-history';
import {faviconDataUrl} from './favicons';
import {sourceMeta} from './source-meta';
import {allowedNavigation,developmentServerUrl} from './navigation';
import {createOfficePreview} from './office-preview';
import {validateMcp} from './mcp-config';
import {installPiPackage,listInstalledPiPackages,piAgentDir,searchPiPackageCatalog,uninstallPiPackage} from './pi-packages';
import {cancelAppUpdateDownload,checkForAppUpdate,downloadAppUpdate,getAppUpdateState,openAppUpdateInstaller,scheduleAppUpdateAutoCheck,setAppUpdateNotifier} from './app-update';
import {validateSchedule,nextSchedule,dueState} from './schedule';
import {isChatId,renameChat,validateChatProject} from './chat-index';
import { addProject, removeProject, updateProject, preserveChatProjectPaths, normalizeStoredProject, type StoredProject } from './project-state';
import { registerPreviewScheme, handlePreviewProtocol } from './preview-protocol';
import { bindBrowserGuests } from './browser-guest';
const dirname=path.dirname(fileURLToPath(import.meta.url));
const defaults:Preferences={appearance:'system',language:'system',permission:'confirm'};
type State={preferences:Preferences;projects:StoredProject[];chats?:ChatSummary[];skills?:LocalSkill[];dismissedSkills?:string[];mcpServers?:McpServer[];schedules?:Schedule[];scheduleRuns?:ScheduleRun[];approvalAllowlist?:Record<string,string[]>};
let state:State={preferences:defaults,projects:[]};
function statePath(){return path.join(app.getPath('userData'),'settings.json')}
function validPreferences(p:Preferences){return p && ['system','light','dark'].includes(p.appearance)&&['system','zh-CN','en'].includes(p.language)&&(p.syncEnabled===undefined||typeof p.syncEnabled==='boolean')&&(p.permission===undefined||['confirm','auto','full'].includes(p.permission))&&(p.modelSource===undefined||['account','custom'].includes(p.modelSource))}
function validState(value:unknown):value is State {if(!value||typeof value!=='object'||Array.isArray(value))return false;const v=value as Record<string,unknown>;if(!validPreferences(v.preferences as Preferences)||!Array.isArray(v.projects))return false;for(const key of ['projects','chats','skills','mcpServers','schedules','scheduleRuns']){const items=v[key];if(items===undefined&&key!=='projects')continue;if(!Array.isArray(items)||items.some(item=>!item||typeof item!=='object'||Array.isArray(item)))return false}if(v.dismissedSkills!==undefined&&(!Array.isArray(v.dismissedSkills)||!v.dismissedSkills.every(item=>typeof item==='string')))return false;if(v.approvalAllowlist!==undefined&&(!v.approvalAllowlist||typeof v.approvalAllowlist!=='object'||Array.isArray(v.approvalAllowlist)||!Object.values(v.approvalAllowlist).every(list=>Array.isArray(list)&&list.every(item=>typeof item==='string'))))return false;return true}
let storage:SettingsStorage<State>;
/* 旧版单路径记录升级为 folders;单条损坏数据回退为占位文件夹,由具体操作暴露错误。
   load 与 update 都要过一遍:storage.update 以内部 current 为基线,若只在 load 归一化,
   首次 update 会把未归一化的原始记录带回 state(projects:list 随即崩溃)。 */
function normalizeStoredProjects(projects:State['projects']):State['projects']{return projects.map(item=>{try{return normalizeStoredProject(item)}catch{const legacy=item as {path?:unknown};const fallback=typeof legacy.path==='string'&&legacy.path?legacy.path:'';return {...(item as StoredProject),folders:[{path:fallback,label:'',main:true}]}}})}
function normalizeState(value:State):State{return {...value,projects:normalizeStoredProjects(value.projects??[])}}
async function load(){storage=new SettingsStorage(statePath(),state,validState);state=normalizeState(await storage.load())}
async function update(change:(current:State)=>State){state=await storage.update(current=>change(normalizeState(current)))}
/* 默认技能目录 ~/.agents/skills:每次读取技能列表时同步,新技能自动入库、
   文件已删除的自动移除;手动"移除"过的默认技能记入 dismissedSkills,避免下次同步复活。
   目录不可读(不存在/无权限)时静默跳过;无变化不落盘。 */
const defaultSkillsDir=()=>process.env.PIWORK_DEFAULT_SKILLS_DIR||path.join(app.getPath('home'),'.agents','skills');
async function syncDefaultSkills(){
 let discovered:{name:string;description:string;filePath:string}[]=[];
 try{const loaded=loadSkillsFromDir({dir:defaultSkillsDir(),source:'agents'});discovered=loaded.skills.filter(skill=>skill.name&&skill.filePath).map(skill=>({name:skill.name,description:skill.description,filePath:skill.filePath}))}catch{return}
 const reconcile=(current:State):State=>{
  const dismissed=new Set((current.dismissedSkills??[]).filter((item):item is string=>typeof item==='string'));
  const onDisk=new Map(discovered.map(skill=>[skill.filePath,skill]));
  const next:LocalSkill[]=[];
  for(const existing of current.skills??[]){
   if(existing.source!=='agents'){next.push(existing);continue}
   const latest=onDisk.get(existing.filePath);
   if(!latest)continue;
   next.push({...existing,name:latest.name,description:latest.description});
  }
  for(const skill of discovered){
   if(dismissed.has(skill.filePath))continue;
   if(next.some(existing=>existing.filePath===skill.filePath||existing.name===skill.name))continue;
   next.push({id:randomUUID(),name:skill.name,description:skill.description,filePath:skill.filePath,enabled:true,source:'agents'});
  }
  return {...current,skills:next};
 };
 const preview=reconcile(state);
 if(JSON.stringify(preview.skills)===JSON.stringify(state.skills??[]))return;
 await update(reconcile);
}
/* 模型供应商存储在 register() 初始化(含旧 gateway.json 迁移);
   gateway:get/set IPC 由 service 的兼容 shim 指向常驻 openai-compat 安装项 */
let receiveAccountCallback:((url:string)=>Promise<void>)|undefined;
let queuedAccountCallback:string|undefined;
function dispatchAccountCallback(url:string){if(!url.startsWith("piwork://auth/callback?"))return;if(receiveAccountCallback)void receiveAccountCallback(url).catch(()=>{});else queuedAccountCallback=url}
function register(window:BrowserWindow){
 let accountChanging=false;
 setAccountNotifier(()=>{if(!window.isDestroyed())window.webContents.send("account:changed")});
 setModelProvidersNotifier(()=>{if(!window.isDestroyed())window.webContents.send("model-providers:changed")});
 void loadModelProviders().catch(()=>{});
 let accountFailure:number|null=null;let accountBridge:Awaited<ReturnType<typeof startAccountBridge>>|null=null;let activeModelKey:string|null=null;let worker:Electron.UtilityProcess|null=null;let busy=false;let activeChatId:string|null=null;let activeSkillId:string|null=null;let activeMcpId:string|null=null;let pendingPicks=new Map<string,string>();
 const scheduledWorkers=new Map<string,Electron.UtilityProcess>();const activeSchedules=new Set<string>();let scheduling=false;let suspended=false;let recoverPending=true;let schedulerTimer:NodeJS.Timeout|undefined;
 const sessionDir=path.join(app.getPath('userData'),'sessions');
 const sessionFile=(id:string)=>path.join(sessionDir,`${id}.jsonl`);
 const libraryDir=path.join(app.getPath('userData'),'library');
 // 对话附件的持久缓存副本(token/name):发送前与历史消息的预览都从副本读取,不依赖原文件位置
 const attachmentsDir=path.join(app.getPath('userData'),'attachments');
 // Office 高保真预览(LibreOffice→PDF):转换结果缓存于 <userData>/preview-cache(electron/office-preview.ts)
 const officePreview=createOfficePreview({cacheDir:path.join(app.getPath('userData'),'preview-cache'),isPackaged:app.isPackaged,appPath:app.getAppPath()});
 const attachmentCacheTarget=async(cache:string)=>{if(typeof cache!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/\\]+$/.test(cache))throw new Error('Invalid attachment cache');return resolveInside(attachmentsDir,cache)};
 const syncJournal=new SyncJournal(path.join(app.getPath('userData'),'sync-journal.json'));
 const experimentalSync=process.env.PIWORK_DESKTOP_SYNC_EXPERIMENTAL!=='0';
 let syncWorking=false;let syncPreparing=false;let syncState:'ready'|'syncing'|'pending'|'conflict'|'unavailable'|'interrupted'='ready';let foregroundSync:SyncAccount|null=null;
 const notifySync=()=>{if(!window.isDestroyed())window.webContents.send('sync:changed')};
 const changedSyncHistory=new Set<string>();
 const flushSyncHistory=()=>{if(!window.isDestroyed())for(const id of changedSyncHistory)window.webContents.send('sync:history',id);changedSyncHistory.clear()};
 async function currentSyncAccount():Promise<SyncAccount>{const account=await accountStatus();if(!account.baseUrl||!account.user)throw new Error('Account unavailable');return {baseUrl:account.baseUrl,userId:account.user.id}}
 async function appendRemote(id:string,items:import('./sync-journal').SyncTextMessage[]){if(activeChatId===id&&worker)stopWorker();await fs.mkdir(sessionDir,{recursive:true,mode:0o700});appendRemoteHistory(sessionFile(id),sessionDir,app.getPath('userData'),items);changedSyncHistory.add(id);notifySync()}
 async function synchronize(){
  if(!experimentalSync||!state.preferences.syncEnabled||syncWorking||syncPreparing||busy||accountChanging)return;syncWorking=true;syncState='syncing';notifySync();
  try{const account=await currentSyncAccount();const records=await syncJournal.list(account);if(records.some(record=>record.running)){syncState='interrupted';return}let remoteBusy=false;for(const record of records){if(busy)break;const result=await syncOneChat({journal:syncJournal,account,chatId:record.chatId,transport:accountSyncTransport(account),isBusy:()=>busy,appendRemote:items=>appendRemote(record.chatId,items)});if(result==='idle')remoteBusy=true}const latest=await syncJournal.list(account);syncState=remoteBusy||latest.some(item=>item.pending.length||item.leaseToken)?'pending':'ready'}catch(error){syncState=error instanceof Error&&error.message==='Sync conflict'?'conflict':'unavailable'}finally{syncWorking=false;flushSyncHistory();notifySync()}
 }
 async function finishForegroundSync(status:'completed'|'failed'|'aborted',text?:string){const account=foregroundSync;foregroundSync=null;if(!account||!activeChatId)return;try{await syncJournal.finish(activeChatId,account,status,text);syncState='pending'}catch{syncState='interrupted'}notifySync()}

 const emit=(event:ChatEvent)=>{if(!window.isDestroyed())window.webContents.send('chat:event',event)};
 /* 工具审批走渲染层应用内弹窗(替代系统弹窗):主进程登记待答复请求,渲染层回传结果;
     120 秒无响应自动拒绝并关闭弹窗(对齐 worker 侧审批超时) */
 type PendingApproval={settle:(allowed:boolean)=>void;key?:string;projectId?:string};
 const approvals=new Map<string,PendingApproval>();
 const foregroundApprovalIds=new Set<string>();
 /* 项目级「始终允许」名单(settings.json 持久化):skill_bash 按命令全文、MCP 按工具名命中即放行 */
 const alwaysAllowed=(key:string|undefined,projectId:string|undefined)=>!!key&&!!projectId&&(state.approvalAllowlist?.[projectId]??[]).includes(key);
 const askApproval=(event:ApprovalRequest,projectId?:string):Promise<boolean>=>new Promise(resolve=>{
  if(alwaysAllowed(event.key,projectId)){resolve(true);return}
  if(window.isDestroyed()){resolve(false);return}
  let settled=false;const settle=(allowed:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);approvals.delete(event.id);resolve(allowed)};
  const timer=setTimeout(()=>{settle(false);if(!window.isDestroyed())window.webContents.send('approval:closed',event.id)},120000);
  approvals.set(event.id,{settle,...(event.key?{key:event.key}:{}),...(projectId?{projectId}:{})});window.webContents.send('approval:request',{...event,key:projectId?event.key:undefined});
 });
 const denyApproval=(id:string)=>{const pending=approvals.get(id);if(pending){approvals.delete(id);pending.settle(false);if(!window.isDestroyed())window.webContents.send('approval:closed',id)}};
 const denyForegroundApprovals=()=>{for(const id of foregroundApprovalIds)denyApproval(id);foregroundApprovalIds.clear()};
 const denyApprovals=()=>{for(const id of [...approvals.keys()])denyApproval(id)};
 const questions=new Map<string,{request:QuestionRequest;settle:(response:QuestionResponse)=>void}>();
 const askQuestions=(request:QuestionRequest):Promise<QuestionResponse>=>new Promise(resolve=>{
  if(window.isDestroyed()){resolve({answers:{},cancelled:true});return}
  const settle=(response:QuestionResponse)=>{clearTimeout(timer);questions.delete(request.id);lastWorkerActivity=Date.now();if(!window.isDestroyed())window.webContents.send('question:closed',request.id);resolve(response)};
  const timer=setTimeout(()=>settle({answers:{},cancelled:true}),600000);
  questions.set(request.id,{request,settle});window.webContents.send('question:request',request);
 });
 const cancelQuestions=()=>{for(const pending of questions.values())pending.settle({answers:{},cancelled:true})};
 const disposeWorker=(child:Electron.UtilityProcess)=>{try{child.postMessage({type:'dispose'});const timer=setTimeout(()=>child.kill(),3000);timer.unref();child.once('exit',()=>clearTimeout(timer))}catch{child.kill()}};
 const stopWorker=()=>{const old=worker;worker=null;accountBridge?.close();accountBridge=null;activeModelKey=null;activeSkillId=null;activeMcpId=null;busy=false;lastWorkerActivity=0;runningToolIds.clear();denyApprovals();cancelQuestions();if(old)disposeWorker(old)};
 // 推理看门狗:上游网关或插件工具长时间无任何事件时中止 worker,
 // 避免会话 busy 永久卡死(全链路无超时兜底时后续发送都会被 Session busy 拦截)。
 // 工具执行中允许更长的静默期(pi 的 bash 无默认超时,venv/pip 等安装可能 5 分钟以上无输出):
 // 预算分级——工具运行中 15 分钟,其余 5 分钟
 const runningToolIds=new Set<string>();
 let lastWorkerActivity=0;let abortRequested=false;
 const watchdogTimer=setInterval(()=>{if(!busy||!worker||questions.size)return;if(!lastWorkerActivity){lastWorkerActivity=Date.now();return}
  const idle=Date.now()-lastWorkerActivity;
  const softLimit=runningToolIds.size>0?900000:300000;
  if(idle>softLimit+30000){stopWorker();emit({type:'failed',message:'Agent response timed out'});setImmediate(()=>void synchronize());return}
  if(idle>softLimit&&!abortRequested){abortRequested=true;worker.postMessage({type:'abort'})}
 },5000);
 let pickedAttachments: {info:PickedAttachment;data:PickedAttachmentContent}[]=[];
 let pickingAttachment=false;
 const resetChat=()=>{stopWorker();activeChatId=null;pickedAttachments=[]};
 const onSuspend=()=>{suspended=true};const onResume=()=>{suspended=false;recoverPending=true;void tickSchedules().catch(()=>{})};powerMonitor.on('suspend',onSuspend);powerMonitor.on('resume',onResume);
 const syncTimer=setInterval(()=>{void synchronize()},15000);
 setImmediate(()=>void synchronize());
 window.on('closed',()=>{clearInterval(syncTimer);clearInterval(watchdogTimer);powerMonitor.removeListener('suspend',onSuspend);powerMonitor.removeListener('resume',onResume);stopWorker();if(schedulerTimer)clearInterval(schedulerTimer);for(const child of scheduledWorkers.values())disposeWorker(child);scheduledWorkers.clear()});
 const handle=(channel:string,fn:(...args:any[])=>unknown)=>ipcMain.handle(channel,(event,...args)=>{if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error('Unauthorized sender');return fn(...args)});
 async function executeSchedule(schedule:Schedule,plannedAt:number,claimed?:ScheduleRun){
  if(!claimed){if(activeSchedules.has(schedule.id))return;activeSchedules.add(schedule.id)}
  const run:ScheduleRun=claimed??{id:randomUUID(),scheduleId:schedule.id,scheduleName:schedule.name,plannedAt,startedAt:Date.now(),status:'running'};
  const chatId=randomUUID();let child:Electron.UtilityProcess|undefined;
  try{
   if(!claimed)await update(current=>({...current,scheduleRuns:[run,...(current.scheduleRuns??[])].slice(0,1000)}));
   const skill=schedule.skillId?(state.skills??[]).find(item=>item.id===schedule.skillId&&item.enabled):undefined;if(schedule.skillId&&!skill)throw new Error('skill_unavailable');if(skill)await fs.access(skill.filePath);const mcp=schedule.mcpId?(state.mcpServers??[]).find(item=>item.id===schedule.mcpId&&item.enabled):undefined;if(schedule.mcpId&&!mcp)throw new Error('mcp_unavailable');
   // 定时任务按创建时固定的 baseUrl+modelId 解析供应商务工载荷;未命中沿用旧错误语义 gateway_changed
   const model=await resolveScheduledModel(schedule.gatewayUrl,schedule.modelId);if(!model)throw new Error('gateway_changed');
   if(schedule.projectId&&!state.projects.some(p=>p.id===schedule.projectId))throw new Error('project_unavailable');
   const scheduleRoots=schedule.projectId?(state.projects.find(project=>project.id===schedule.projectId)?.folders??[]).map(folder=>({root:folder.path,label:folder.label})):[];
   // 定时任务无项目时同样使用会话输出目录(我的文档/AI 生成),agent 可产出文档并自检
   let chatWorkspace:ProjectRoot|undefined;
   if(!scheduleRoots.length){chatWorkspace=chatWorkspaceFor(workspaceFolderName(schedule.name,chatId));await fs.mkdir(chatWorkspace.root,{recursive:true,mode:0o700})}
   if(schedule.projectId){const project=state.projects.find(p=>p.id===schedule.projectId)!;const main=project.folders.find(folder=>folder.main)??project.folders[0];if(!main||!await fs.stat(main.path).then(s=>s.isDirectory()).catch(()=>false))throw new Error('project_unavailable')}
   run.chatId=chatId;
   await update(current=>({...current,scheduleRuns:(current.scheduleRuns??[]).map(r=>r.id===run.id?{...r,chatId}:r),chats:[{id:chatId,title:schedule.name,updatedAt:Date.now(),projectId:schedule.projectId,...(schedule.projectId?(()=>{const project=current.projects.find(item=>item.id===schedule.projectId);const folders=project?.folders??[];const main=folders.find(folder=>folder.main)??folders[0];return {projectPath:main?.path??null,projectFolders:folders.map(folder=>folder.path)}})():{projectPath:null})},...(current.chats??[])]}));
   await fs.mkdir(sessionDir,{recursive:true,mode:0o700});
   child=utilityProcess.fork(path.join(dirname,'chat-worker.js'),[],{stdio:'ignore'});scheduledWorkers.set(schedule.id,child);
   const currentChild=child;let settled=false;let deadline:NodeJS.Timeout|undefined;const runApprovals=new Set<string>();
   const finish=async(status:'completed'|'failed',detail?:string,exited=false)=>{if(settled)return;settled=true;if(deadline)clearTimeout(deadline);for(const id of runApprovals)denyApproval(id);runApprovals.clear();scheduledWorkers.delete(schedule.id);activeSchedules.delete(schedule.id);if(!exited)disposeWorker(currentChild);await update(current=>({...current,scheduleRuns:(current.scheduleRuns??[]).map(r=>r.id===run.id?{...r,status,finishedAt:Date.now(),...(detail?{detail}:{})}:r)})).catch(()=>{});if(!window.isDestroyed())window.webContents.send('schedules:changed')};
   deadline=setTimeout(()=>void finish('failed','timeout'),30*60*1000);
   currentChild.on('message',(event:ChatEvent|OfficeRenderRequest)=>{if(event.type==='completed')void finish('completed');else if(event.type==='failed'||event.type==='aborted')void finish('failed','agent_failed');else if(event.type==='approval'){runApprovals.add(event.id);void askApproval({...event,context:schedule.name},schedule.projectId??undefined).then(allowed=>{runApprovals.delete(event.id);if(!settled)currentChild.postMessage({type:'approval',id:event.id,allowed})})}
    else if(event.type==='render:request'){void (async()=>{try{
     if(!renderPathAllowed(event.inputPath,scheduleRoots,chatWorkspace))throw new Error('Render path is not available to this task');
     const outcome=await officePreview.renderPages(event.inputPath,event.pages);
     const reply:OfficeRenderResult={type:'render:result',id:event.id,outcome};if(!settled)currentChild.postMessage(reply)
    }catch(error){const reply:OfficeRenderResult={type:'render:result',id:event.id,error:error instanceof Error&&error.message?error.message:'Render failed'};if(!settled)currentChild.postMessage(reply)}})();return}
    else if(event.type==='tool'&&event.status==='completed'&&(event.name==='project_write'||event.name==='project_create_office'||event.name==='project_append_office')&&chatWorkspace&&typeof event.path==='string'){const relative=path.relative(libraryDir,event.path).split(path.sep).join('/');if(relative&&!relative.startsWith('..'))void registerAiFile(libraryDir,relative).catch(()=>{})}});
   currentChild.on('exit',()=>void finish('failed','agent_stopped',true));
   currentChild.postMessage({type:'start',model,cwd:app.getPath('userData'),agentDir:piAgentDir(),sessionFile:sessionFile(chatId),...(skill?{skill:{name:skill.name,filePath:skill.filePath}}:{}),...(mcp?{mcp}:{}),...(scheduleRoots.length?{projectFolders:scheduleRoots}:{}),...(chatWorkspace?{chatWorkspace}:{}),text:schedule.prompt,permission:state.preferences.permission??'confirm'});
  }catch(error){if(child)disposeWorker(child);scheduledWorkers.delete(schedule.id);activeSchedules.delete(schedule.id);const detail=error instanceof Error&&['gateway_changed','project_unavailable','credentials_unavailable','skill_unavailable','mcp_unavailable'].includes(error.message)?error.message:'start_failed';await update(current=>({...current,scheduleRuns:[{...run,status:'failed' as const,finishedAt:Date.now(),detail},...(current.scheduleRuns??[]).filter(r=>r.id!==run.id)].slice(0,1000)}));if(!window.isDestroyed())window.webContents.send('schedules:changed')}
 }
 async function tickSchedules(){
  if(scheduling||suspended)return;scheduling=true;const recover=recoverPending;recoverPending=false;
  try{const now=Date.now();for(const item of state.schedules??[]){if(!item.enabled)continue;const due=dueState(item.nextAt,now,activeSchedules.has(item.id));if(due==='future')continue;const result=recover?'missed':due;const plannedAt=item.nextAt;const record:ScheduleRun=result==='run'?{id:randomUUID(),scheduleId:item.id,scheduleName:item.name,plannedAt,startedAt:now,status:'running'}:{id:randomUUID(),scheduleId:item.id,scheduleName:item.name,plannedAt,finishedAt:now,status:result==='overlap'?'skipped':'missed',detail:result==='overlap'?'overlap':'missed_while_offline'};if(result==='run')activeSchedules.add(item.id);let claimed=false;try{await update(current=>{const latest=(current.schedules??[]).find(s=>s.id===item.id);if(!latest||!latest.enabled||latest.nextAt!==plannedAt)return current;claimed=true;return {...current,schedules:(current.schedules??[]).map(s=>s.id===item.id?{...s,nextAt:nextSchedule(s.cron,s.timezone,now)}:s),scheduleRuns:[record,...(current.scheduleRuns??[])].slice(0,1000)}})}catch(error){if(result==='run')activeSchedules.delete(item.id);throw error}if(result==='run'){if(claimed)void executeSchedule(item,plannedAt,record);else activeSchedules.delete(item.id)}}
   if(!window.isDestroyed())window.webContents.send('schedules:changed');
  }catch(error){if(recover)recoverPending=true;throw error}finally{scheduling=false}
 }
 handle('mcp:list',()=>state.mcpServers??[]);
 handle('mcp:test',async(id:string)=>{if(!isChatId(id))throw new Error('Invalid MCP');const server=(state.mcpServers??[]).find(item=>item.id===id);if(!server)throw new Error('MCP unavailable');const config=validateMcp(server);return await new Promise(resolve=>{const child=utilityProcess.fork(path.join(dirname,'mcp-test-worker.js'),[],{stdio:'ignore'});let done=false;const finish=(value:unknown)=>{if(done)return;done=true;clearTimeout(timer);child.kill();resolve(value)};const timer=setTimeout(()=>finish({ok:false,reason:'timeout'}),15000);child.once('message',value=>finish(value));child.once('exit',()=>finish({ok:false,reason:'unavailable'}));child.postMessage(config)})});
 handle('mcp:save',async(id:string|null,input:McpInput)=>{if(id&&id===activeMcpId){if(busy)throw new Error('MCP is in use');stopWorker()}const config=validateMcp(input);if(id!==null&&(!isChatId(id)||!(state.mcpServers??[]).some(server=>server.id===id)))throw new Error('Invalid MCP');await update(current=>{const servers=current.mcpServers??[];if(servers.some(server=>server.id!==id&&server.name.replace(/-/g,'_')===config.name.replace(/-/g,'_')))throw new Error('Duplicate name');const old=servers.find(server=>server.id===id);return {...current,mcpServers:id?servers.map(server=>server.id===id?{...config,id,enabled:old?.enabled??true}:server):[...servers,{...config,id:randomUUID(),enabled:true}]}})});
 handle('mcp:enable',async(id:string,enabled:boolean)=>{if(id===activeMcpId){if(busy)throw new Error('MCP is in use');stopWorker()}if(!isChatId(id)||typeof enabled!=='boolean'||!(state.mcpServers??[]).some(server=>server.id===id))throw new Error('Invalid MCP');await update(current=>({...current,mcpServers:(current.mcpServers??[]).map(server=>server.id===id?{...server,enabled}:server)}))});
 handle('mcp:remove',async(id:string)=>{if(id===activeMcpId){if(busy)throw new Error('MCP is in use');stopWorker()}if(!isChatId(id)||!(state.mcpServers??[]).some(server=>server.id===id))throw new Error('Invalid MCP');await update(current=>({...current,mcpServers:(current.mcpServers??[]).filter(server=>server.id!==id)}))});
 // pi 插件(pi.dev/packages):安装/卸载后重启 worker,下次对话重新加载插件资源
 handle('pi-packages:search',(query:string,offset?:number)=>{if(typeof query!=='string')throw new Error('Invalid query');return searchPiPackageCatalog(query,typeof offset==='number'&&Number.isFinite(offset)?Math.max(0,Math.floor(offset)):0)});
 handle('pi-packages:list',()=>listInstalledPiPackages());
 handle('pi-packages:install',async(source:string)=>{if(typeof source!=='string')throw new Error('Invalid package');if(busy)throw new Error('Pi package is in use');const item=await installPiPackage(source);stopWorker();return item});
 handle('pi-packages:uninstall',async(source:string)=>{if(typeof source!=='string')throw new Error('Invalid package');if(busy)throw new Error('Pi package is in use');await uninstallPiPackage(source);stopWorker()});
 handle('skills:list',async()=>{await syncDefaultSkills().catch(()=>{});return state.skills??[]});
 handle('approval:respond',(id:string,decision:ApprovalDecision)=>{
  if(typeof id!=='string'||!['allow','always','deny'].includes(decision))return;
  const pending=approvals.get(id);if(!pending)return;
  if(decision==='always'&&pending.key&&pending.projectId){
   const key=pending.key,projectId=pending.projectId;
   /* 去重后置顶追加,单项目封顶 200 条;落盘异步,不阻塞工具放行 */
   void update(current=>({...current,approvalAllowlist:{...current.approvalAllowlist,[projectId]:[key,...(current.approvalAllowlist?.[projectId]??[])].filter((item,index,list)=>list.indexOf(item)===index).slice(0,200)}})).catch(()=>{});
  }
  pending.settle(decision!=='deny');
 });
 handle('question:respond',(id:string,response:unknown)=>{
  if(typeof id!=='string')return;
  const pending=questions.get(id);if(!pending)return;
  pending.settle(validateQuestionResponse(pending.request.questions,response));
 });
 handle('skills:read',async(id:string)=>{if(!isChatId(id))throw new Error('Invalid skill');const skill=(state.skills??[]).find(item=>item.id===id);if(!skill)throw new Error('Skill unavailable');return readProjectText(path.dirname(skill.filePath),path.basename(skill.filePath))});
 handle('skills:import',async()=>{const result=await dialog.showOpenDialog(window,{properties:['openDirectory']});if(result.canceled||!result.filePaths[0])return null;const dir=await fs.realpath(result.filePaths[0]);const loaded=loadSkillsFromDir({dir,source:'local'});const valid=loaded.skills.filter(skill=>skill.name&&skill.filePath);let added=0,duplicates=0;await update(current=>{const skills=[...(current.skills??[])];for(const skill of valid){if(skills.some(existing=>existing.filePath===skill.filePath||existing.name===skill.name)){duplicates++;continue}skills.push({id:randomUUID(),name:skill.name,description:skill.description,filePath:skill.filePath,enabled:true,source:'local'});added++}return {...current,skills}});return {added,duplicates,warnings:loaded.diagnostics.length}});
 handle('skills:enable',async(id:string,enabled:boolean)=>{if(!isChatId(id)||typeof enabled!=='boolean'||!(state.skills??[]).some(skill=>skill.id===id))throw new Error('Invalid skill');await update(current=>({...current,skills:(current.skills??[]).map(skill=>skill.id===id?{...skill,enabled}:skill)}))});
 handle('skills:remove',async(id:string)=>{if(!isChatId(id)||!(state.skills??[]).some(skill=>skill.id===id))throw new Error('Invalid skill');const target=(state.skills??[]).find(skill=>skill.id===id);await update(current=>({...current,skills:(current.skills??[]).filter(skill=>skill.id!==id),...(target?.source==='agents'?{dismissedSkills:[...(current.dismissedSkills??[]),target.filePath]}:{})}))});
 handle('schedules:list',()=>({schedules:state.schedules??[],runs:state.scheduleRuns??[]}));
 // schedules:create IPC 与前台 Agent 的 create_scheduled_task 工具共用同一落库逻辑
 async function createScheduleRecord(input:ScheduleInput):Promise<void>{const value=validateSchedule(input);if(value.projectId&&!state.projects.some(p=>p.id===value.projectId))throw new Error('Project not found');if(value.skillId&&!(state.skills??[]).some(skill=>skill.id===value.skillId&&skill.enabled))throw new Error('Skill not found');if(value.mcpId&&!(state.mcpServers??[]).some(server=>server.id===value.mcpId&&server.enabled))throw new Error('MCP not found');const target=await defaultCustomModel();if(!target)throw new Error('Gateway not configured');const item:Schedule={...value,id:randomUUID(),enabled:true,nextAt:nextSchedule(value.cron,value.timezone,Date.now()),gatewayUrl:target.baseUrl,modelId:target.modelId};await update(current=>({...current,schedules:[...(current.schedules??[]),item]}));}
 handle('schedules:create',(input:ScheduleInput)=>createScheduleRecord(input));
 handle('schedules:update',async(id:string,input:ScheduleInput)=>{if(!isChatId(id)||!(state.schedules??[]).some(s=>s.id===id)||activeSchedules.has(id))throw new Error('Schedule unavailable');const value=validateSchedule(input);if(value.projectId&&!state.projects.some(p=>p.id===value.projectId))throw new Error('Project not found');if(value.skillId&&!(state.skills??[]).some(skill=>skill.id===value.skillId&&skill.enabled))throw new Error('Skill not found');if(value.mcpId&&!(state.mcpServers??[]).some(server=>server.id===value.mcpId&&server.enabled))throw new Error('MCP not found');const target=await defaultCustomModel();if(!target)throw new Error('Gateway not configured');await update(current=>({...current,schedules:(current.schedules??[]).map(s=>s.id===id?{...s,...value,nextAt:nextSchedule(value.cron,value.timezone,Date.now()),gatewayUrl:target.baseUrl,modelId:target.modelId}:s)}))});
 handle('schedules:toggle',async(id:string,enabled:boolean)=>{if(!isChatId(id)||typeof enabled!=='boolean'||!(state.schedules??[]).some(s=>s.id===id))throw new Error('Invalid schedule');await update(current=>({...current,schedules:(current.schedules??[]).map(s=>s.id===id?{...s,enabled,...(enabled?{nextAt:nextSchedule(s.cron,s.timezone,Date.now())}:{})}:s)}))});
 // 与 web 语义对齐:删除任务级联删除运行记录(已生成的结果对话保留)
 handle('schedules:delete',async(id:string)=>{if(!isChatId(id)||!(state.schedules??[]).some(s=>s.id===id))throw new Error('Invalid schedule');await update(current=>({...current,schedules:(current.schedules??[]).filter(s=>s.id!==id),scheduleRuns:(current.scheduleRuns??[]).filter(r=>r.scheduleId!==id)}))});
 handle('schedules:run',async(id:string)=>{const item=(state.schedules??[]).find(s=>s.id===id);if(!item||activeSchedules.has(id))throw new Error('Schedule unavailable');void executeSchedule(item,Date.now())});
 void (async()=>{await update(current=>({...current,scheduleRuns:(current.scheduleRuns??[]).map(run=>run.status==='running'?{...run,status:'failed' as const,finishedAt:Date.now(),detail:'app_stopped'}:run)}));await tickSchedules();schedulerTimer=setInterval(()=>void tickSchedules().catch(()=>{}),5000)})().catch(()=>{});
 handle('chat:pick-attachment',async(file?:{projectId:string;path:string}|{library:string})=>{
  if(busy||pickingAttachment)throw new Error('Chat busy');
  pickingAttachment=true;
  try{
   let root:string;
   let relative:string;
   if(file!==undefined){
    if('library' in file){
     if(typeof file.library!=='string'||!file.library)throw new Error('Invalid library file');
     root=libraryDir;
     relative=file.library;
    }else{
     const project=file&&state.projects.find(item=>item.id===file.projectId);
     if(!project||typeof file.path!=='string')throw new Error('Invalid project file');
     const target=splitProjectPath(project.folders.map(folder=>({root:folder.path,label:folder.label})),file.path);
     root=target.root;
     relative=target.relative;
    }
   }else{
    // 不带扩展名过滤:允许选择本地任意文件;能否作为附件由 readChatAttachment 决定
    const result=await dialog.showOpenDialog(window,{properties:['openFile']});
    if(result.canceled||!result.filePaths[0])return null;
    root=path.dirname(result.filePaths[0]);
    relative=path.basename(result.filePaths[0]);
   }
   const data=await readChatAttachment(root,relative);
   const token=randomUUID();
   const name=path.basename(relative);
   const cacheDir=path.join(attachmentsDir,token);
   await fs.mkdir(cacheDir,{recursive:true,mode:0o700});
   await fs.copyFile(await resolveInside(root,relative),path.join(cacheDir,name));
   const info={token,name,kind:data.kind,cache:`${token}/${name}`};
   pickedAttachments=[...pickedAttachments.filter(entry=>entry.info.cache!==info.cache),{info,data}];
   return info;
  }finally{pickingAttachment=false}
 });
 // 粘贴的剪贴板内容批量入槽:带 path 的条目为 Finder 拷贝的文件(任意类型,按 pick 对话框分支读取+复制进缓存),
 // base64 条目为剪贴板图片字节;全部处理成功才统一写入(all-or-nothing),任一失败整批放弃不留部分附件
 handle('chat:attach-files',async(items:({path:string}|{name:string;mimeType:string;base64:string})[])=>{
  if(busy||pickingAttachment)throw new Error('Chat busy');
  pickingAttachment=true;
  try{
   if(!Array.isArray(items)||!items.length||items.length>10)throw new Error('Invalid files');
   const staged:{info:PickedAttachment;data:PickedAttachmentContent}[]=[];
   for(const item of items){
    if(item&&'path' in item&&typeof item.path==='string'&&item.path){
     const root=path.dirname(item.path);
     const relative=path.basename(item.path);
     const data=await readChatAttachment(root,relative);
     const token=randomUUID();
     const name=path.basename(relative);
     const cacheDir=path.join(attachmentsDir,token);
     await fs.mkdir(cacheDir,{recursive:true,mode:0o700});
     await fs.copyFile(await resolveInside(root,relative),path.join(cacheDir,name));
     staged.push({info:{token,name,kind:data.kind,cache:`${token}/${name}`},data});
    }else if(item&&'base64' in item&&typeof item.base64==='string'){
     const image=item as {name?:unknown;mimeType?:unknown;base64:string};
     if(typeof image.mimeType!=='string')throw new Error('Invalid image');
     const bytes=Buffer.from(image.base64,'base64');
     verifyImageBytes(bytes,image.mimeType);
     const ext=imageExtension(image.mimeType)!;
     // 文件名仅作展示:basename + 白名单字符集与扩展名,不合规则回退时间戳名(防路径穿越,并保证缓存扩展名与真实格式一致供 readAttachment 分发)
     const provided=typeof image.name==='string'?path.basename(image.name):'';
     const name=/^[\w .\u4e00-\u9fff-]+\.(png|jpe?g|gif|webp)$/i.test(provided)&&provided.length<=100?provided:`clipboard-${Date.now()}${ext}`;
     const token=randomUUID();
     const cacheDir=path.join(attachmentsDir,token);
     await fs.mkdir(cacheDir,{recursive:true,mode:0o700});
     await fs.writeFile(path.join(cacheDir,name),bytes,{mode:0o600});
     staged.push({info:{token,name,kind:'image' as const,cache:`${token}/${name}`},data:{kind:'image',image:{type:'image',mimeType:image.mimeType,data:image.base64}}});
    }else throw new Error('Invalid files');
   }
   const added:PickedAttachment[]=[];
   for(const entry of staged){
    pickedAttachments=[...pickedAttachments.filter(existing=>existing.info.cache!==entry.info.cache),entry];
    added.push(entry.info);
   }
   return added;
  }finally{pickingAttachment=false}
 });
 // 输入框移除附件 chip:释放主进程为对应 token 持有的读取内容,防止反复粘贴/移除累积大对象
 handle('chat:detach-attachments',async(tokens:string[])=>{
  if(!Array.isArray(tokens))return;
  const removed=new Set(tokens);
  pickedAttachments=pickedAttachments.filter(entry=>!removed.has(entry.info.token));
 });
 // 附件缓存预览:按扩展名分发到与项目文件一致的读取器(继承 1MB 文本/10MB 图片/20MB Office 上限)
 handle('chat:documentAction',async(id:string,target:string,action:'open'|'reveal')=>{
  if(!isChatId(id)||id!==activeChatId||!(state.chats??[]).some(chat=>chat.id===id)||!['open','reveal'].includes(action))throw new Error('Invalid document action');
  const manager=SessionManager.open(sessionFile(id),sessionDir,app.getPath('userData'));
  assertDocumentReference(target,projectChatHistory(manager.buildSessionContext().messages));
  if(!(await fs.stat(target)).isFile())throw new Error('Not a file');
  if(action==='reveal')shell.showItemInFolder(target);
  else if(await shell.openPath(target))throw new Error('Cannot open document');
 });
 handle('chat:cacheGeneratedDocument',async(id:string,target:string)=>{
  if(!isChatId(id)||id!==activeChatId||!(state.chats??[]).some(chat=>chat.id===id))throw new Error('Chat not found');
  const manager=SessionManager.open(sessionFile(id),sessionDir,app.getPath('userData'));
  const messages=projectChatHistory(manager.buildSessionContext().messages);
  return cacheGeneratedDocument(target,messages,attachmentsDir);
 });
 handle('chat:readAttachment',async(cache:string)=>{
  const target=await attachmentCacheTarget(cache);
  const name=path.basename(cache);
  if(/\.pdf$/i.test(name))return {name,kind:'pdf' as const,content:await readProjectPdf(attachmentsDir,cache)};
  // office 三件套走高保真 LibreOffice→PDF(缓存命中/转换,失败回落原始字节),missingFonts 供灰色提示
  if(/\.(docx|xlsx|pptx)$/i.test(name)){const preview=await officePreview.readDocumentPreview(target);return {name,kind:preview.kind,content:preview.content,missingFonts:preview.missingFonts}}
  if(/\.(png|jpe?g|gif|webp)$/i.test(name))return {name,kind:'image' as const,content:await readProjectImage(attachmentsDir,cache).then(image=>`data:${image.mime};base64,${image.base64}`)};
  if(/\.html?$/i.test(name))return {name,kind:'html' as const,content:await readProjectText(attachmentsDir,cache)};
  try{return {name,kind:'text' as const,content:await readProjectText(attachmentsDir,cache)}}catch{return {name,kind:'unsupported' as const,content:''}}
 });
 handle('chat:openAttachmentExternal',async(cache:string)=>{if(await shell.openPath(await attachmentCacheTarget(cache)))throw new Error('Cannot open attachment')});
 handle('chat:revealAttachment',async(cache:string)=>{shell.showItemInFolder(await attachmentCacheTarget(cache))});
 handle('chat:send',async(text:string,projectId:string|null,skillId:string|null,mcpId:string|null,attachments:(string|{token:string})[],selection?:{source:'account'|'custom';id:string})=>{
  if(typeof text!=='string'||!text.trim()||text.length>100000)throw new Error('Invalid message');if(!Array.isArray(attachments)||attachments.length>10)throw new Error('Invalid attachment');if(syncWorking||syncPreparing)throw new Error('Sync busy');if(busy||pickingAttachment||accountChanging)throw new Error('Session busy');
  busy=true;
  try {if(skillId!==null&&typeof skillId!=='string')throw new Error('Invalid skill');const skill=skillId?(state.skills??[]).find(item=>item.id===skillId&&item.enabled):undefined;if(skillId&&!skill)throw new Error('Skill not enabled');if(skill)await fs.access(skill.filePath);if(mcpId!==null&&typeof mcpId!=='string')throw new Error('Invalid MCP');const mcp=mcpId?(state.mcpServers??[]).find(item=>item.id===mcpId&&item.enabled):undefined;if(mcpId&&!mcp)throw new Error('MCP not enabled');if(worker&&(activeSkillId!==skillId||activeMcpId!==mcpId))stopWorker();busy=true;const activeChat=activeChatId?(state.chats??[]).find(chat=>chat.id===activeChatId):undefined;if(activeChatId&&!activeChat)throw new Error('Chat not found');const selectedProject=validateChatProject(projectId,state.projects,activeChat);const source=selection?.source??'custom';if(!['custom','account'].includes(source))throw new Error('Invalid model source');let workerModel:WorkerModelInput;let binding:NonNullable<ChatSummary['modelBinding']>;let supportsImages=false;let accountBinding:{baseUrl:string;modelId:string}|null=null;
  /* 自定义来源:selection.id 为 '<providerKey>/<modelId>'(旧格式无 / 按 openai-compat 兼容);
     binding 沿用 {id:原始 modelId, baseUrl},旧会话的 modelBinding 可直接比对 */
  if(source==='account'){const account=await accountStatus();const model=account.models.find(item=>item.id===selection?.id);if(!account.baseUrl||!account.user||!model)throw new Error('Account model unavailable');binding={source,id:model.id,baseUrl:account.baseUrl,userId:account.user.id};supportsImages=model.supportsImages===true;accountBinding={baseUrl:account.baseUrl,modelId:model.id};workerModel={providerId:'piwork-account',name:'PiWork',baseUrl:account.baseUrl,apiKey:'',api:'pi-messages',modelId:model.id,models:[{id:model.id,name:model.name??model.id,reasoning:false,input:supportsImages?['text','image']:['text'],contextWindow:128000,maxTokens:8192}]};}else{workerModel=await resolveCustomModel(selection?.id??'');binding={source,id:workerModel.modelId,baseUrl:workerModel.baseUrl};supportsImages=workerModel.models.some(model=>model.id===workerModel.modelId&&model.input.includes('image'));}
  if(activeChat?.modelBinding&&JSON.stringify(activeChat.modelBinding)!==JSON.stringify(binding))throw new Error('Chat model changed');const modelKey=JSON.stringify(binding);if(worker&&activeModelKey!==modelKey)stopWorker();busy=true;
  const project=selectedProject?state.projects.find(item=>item.id===selectedProject):undefined;
  const roots=project?projectRoots(project.id):[];
  // 无项目会话:产出走聊天专属输出目录(我的文档/AI 生成/<标题>-<id前缀>),写入/office_render/库登记都以此为界;
  // 文件夹名固定在首条消息(workspaceFolder),后续轮次与 worker 重启沿用
  const chatId=activeChatId??randomUUID();
  let chatWorkspace:ProjectRoot|undefined;
  if(!roots.length){
   const folder=activeChat?.workspaceFolder??workspaceFolderName(activeChat?.title??text.trim().slice(0,80),chatId);
   chatWorkspace=chatWorkspaceFor(folder);
   await fs.mkdir(chatWorkspace.root,{recursive:true,mode:0o700});
  }
  let promptText=text;
  let images:import('@earendil-works/pi-ai').ImageContent[]|undefined;
  // 多附件:项目文件(string)逐个追加 PROJECT marker;token 逐个映射 pickedAttachments 并追加 PICKED marker,图片汇入 images
  const usedTokens=new Set<string>();
  for(const attachment of attachments){
   if(typeof attachment==='string'){
    if(!project||!roots.length)throw new Error('Project required');
    promptText=await addProjectTextAttachment(promptText,roots,attachment);
   }else{
    if(!attachment||typeof attachment.token!=='string')throw new Error('Invalid attachment');
    const entry=pickedAttachments.find(candidate=>candidate.info.token===attachment.token);
    if(!entry)throw new Error('Invalid attachment');
    usedTokens.add(entry.info.token);
    if(entry.data.kind==='image'){
     if(!supportsImages)throw new Error('Model does not support images');
     (images??=[]).push(entry.data.image);
    }
    promptText=addPickedAttachment(promptText,entry.info.name,entry.data,entry.info.cache);
   }
  }
  if(!activeChatId){await update(current=>({...current,chats:[{id:chatId,title:text.trim().slice(0,80),updatedAt:Date.now(),projectId:selectedProject,projectPath:roots[0]?.root??null,...(roots.length?{projectFolders:roots.map(item=>item.root)}:{}),...(chatWorkspace?{workspaceFolder:path.basename(chatWorkspace.root)}:{}),modelBinding:binding},...(current.chats??[])]}));activeChatId=chatId}
  await fs.mkdir(sessionDir,{recursive:true,mode:0o700});
  if(experimentalSync&&state.preferences.syncEnabled){syncPreparing=true;try{const account=await currentSyncAccount();const existing=(await syncJournal.list(account)).find(item=>item.chatId===activeChatId);if(!existing&&activeChat&&await fs.access(sessionFile(activeChatId)).then(()=>true).catch(()=>false))throw new Error('Sync only supports new chats');await prepareSyncRun({journal:syncJournal,account,chatId:activeChatId,title:activeChat?.title??text.trim().slice(0,80),text,transport:accountSyncTransport(account),isBusy:()=>false,appendRemote:items=>appendRemote(activeChatId!,items)});foregroundSync=account;busy=true;syncState='syncing';notifySync()}catch(error){if(error instanceof Error&&error.message==='Sync only supports new chats')throw error;const conflict=error instanceof Error&&error.message==='Sync conflict';const running=error instanceof Error&&error.message==='Sync task running';syncState=running?'pending':conflict?'conflict':'unavailable';notifySync();throw new Error(running?'Sync task running':conflict?'Sync conflict':'Sync unavailable')}finally{syncPreparing=false;busy=true;flushSyncHistory()}}
  if(source==='account'){if(!accountBridge)accountBridge=await startAccountBridge(binding.baseUrl,binding.id,status=>{accountFailure=status});accountFailure=null;accountBridge.newRun();workerModel={providerId:'piwork-account',name:'PiWork',baseUrl:accountBridge.baseUrl,apiKey:accountBridge.apiKey,api:'pi-messages',modelId:accountBinding!.modelId,models:[{id:accountBinding!.modelId,name:accountBinding!.modelId,reasoning:false,input:supportsImages?['text','image']:['text'],contextWindow:128000,maxTokens:8192}]}}activeModelKey=modelKey;
  if(!worker){const child=utilityProcess.fork(path.join(dirname,'chat-worker.js'),[],{stdio:'ignore'});worker=child;activeSkillId=skillId;activeMcpId=mcpId;child.on('message',async(event:ChatEvent|ChatChunkMessage|ScheduleCreateRequest|QuestionRequest|OfficeRenderRequest)=>{if(worker!==child)return;lastWorkerActivity=Date.now();abortRequested=false;if(event.type==='tool'){if(event.status==='running')runningToolIds.add(event.id);else runningToolIds.delete(event.id);
   /* 无项目会话的落盘产物登记进文档库(我的文档 → AI 生成);event.path 为 chat-session 解析出的绝对路径 */
   if(event.status==='completed'&&(event.name==='project_write'||event.name==='project_create_office'||event.name==='project_append_office')&&chatWorkspace&&typeof event.path==='string'){const relative=path.relative(libraryDir,event.path).split(path.sep).join('/');if(relative&&!relative.startsWith('..'))void registerAiFile(libraryDir,relative).catch(()=>{})}}
  if(event.type==='render:request'){void (async()=>{try{
   if(!renderPathAllowed(event.inputPath,roots,chatWorkspace))throw new Error('Render path is not available to this chat');
   const outcome=await officePreview.renderPages(event.inputPath,event.pages);
   const reply:OfficeRenderResult={type:'render:result',id:event.id,outcome};if(worker===child)child.postMessage(reply)
  }catch(error){const reply:OfficeRenderResult={type:'render:result',id:event.id,error:error instanceof Error&&error.message?error.message:'Render failed'};if(worker===child)child.postMessage(reply)}})();return}
  if(event.type==='question'){void askQuestions(event).then(response=>{if(worker===child)child.postMessage({type:'question:response',id:event.id,response})});return}if(event.type==='schedule:create'){try{await createScheduleRecord({name:event.input.taskType,prompt:event.input.prompt,cron:event.input.cron,timezone:event.input.timezone,projectId:null,skillId:null,mcpId:null});child.postMessage({type:'schedule:result',id:event.id,ok:true})}catch(error){child.postMessage({type:'schedule:result',id:event.id,ok:false,error:error instanceof Error?error.message:'Schedule create failed'})}return}if(event.type==='chunk'){if(!window.isDestroyed())window.webContents.send('chat:chunk',event);return}if(event.type==='approval'){foregroundApprovalIds.add(event.id);const chatProject=(state.chats??[]).find(chat=>chat.id===activeChatId)?.projectId??undefined;void askApproval(event,chatProject).then(allowed=>{foregroundApprovalIds.delete(event.id);if(worker===child)child.postMessage({type:'approval',id:event.id,allowed})});return}if(event.type==='completed'||event.type==='failed'||event.type==='aborted'){cancelQuestions();denyForegroundApprovals();await finishForegroundSync(event.type==='completed'?'completed':event.type==='aborted'?'aborted':'failed',event.type==='completed'?event.text:undefined);busy=false;setImmediate(()=>void synchronize());const id=activeChatId;if(id)await update(current=>({...current,chats:(current.chats??[]).map(chat=>chat.id===id?{...chat,updatedAt:Date.now()}:chat)})).catch(()=>{});if(worker!==child)return}emit(event.type==='failed'&&accountFailure?{type:'failed',message:`account:${accountFailure}`} : event)});child.on('exit',async()=>{if(worker!==child)return;worker=null;denyApprovals();cancelQuestions();if(busy){await finishForegroundSync('failed');busy=false;setImmediate(()=>void synchronize());emit({type:'failed',message:'Agent process stopped'})}});child.postMessage({type:'start',model:workerModel,cwd:app.getPath('userData'),agentDir:piAgentDir(),sessionFile:sessionFile(activeChatId),...(roots.length?{projectFolders:roots}:{}),...(chatWorkspace?{chatWorkspace}:{}),...(mcp?{mcp}:{}),...(skill?{skill:{name:skill.name,filePath:skill.filePath}}:{}),text:promptText,images,allowScheduleTools:true,allowUserQuestions:true,permission:state.preferences.permission??'confirm'})}
  else worker.postMessage({type:'prompt',text:promptText,images,...(skill?{skillName:skill.name}:{})});
  if(usedTokens.size)pickedAttachments=pickedAttachments.filter(entry=>!usedTokens.has(entry.info.token));
  return activeChatId;
  }catch(error){if(foregroundSync)await finishForegroundSync('failed');if(!worker){accountBridge?.close();accountBridge=null;activeModelKey=null}busy=false;setImmediate(()=>void synchronize());throw error}
 });
 handle('chat:stop',()=>{if(worker&&busy){worker.postMessage({type:'abort'});denyForegroundApprovals();cancelQuestions()}});
 handle('chat:clear',()=>{if(syncWorking||syncPreparing||foregroundSync&&busy)throw new Error('Sync run active');resetChat()});
 handle('chat:list',()=>[...(state.chats??[])].sort((a,b)=>b.updatedAt-a.updatedAt));
 handle('chat:open',async(id:string)=>{if(!isChatId(id)||!(state.chats??[]).some(chat=>chat.id===id))throw new Error('Chat not found');if(busy||syncWorking||syncPreparing)throw new Error('Chat busy');const file=sessionFile(id);await fs.access(file);const manager=SessionManager.open(file,sessionDir,app.getPath('userData'));const context=manager.buildSessionContext();const timings=new Map<number,{startedAt:number;durationMs:number}>();for(const entry of manager.getBranch()){if(entry.type==='custom'&&entry.customType==='piwork:turn-timing'){const data=entry.data as {userTimestamp?:number;startedAt?:number;durationMs?:number}|undefined;if(data&&typeof data.userTimestamp==='number'&&typeof data.startedAt==='number'&&typeof data.durationMs==='number')timings.set(data.userTimestamp,{startedAt:data.startedAt,durationMs:data.durationMs})}}const messages=projectChatHistory(context.messages,timings);stopWorker();if(activeChatId!==id)pickedAttachments=[];activeChatId=id;return {messages,toolEvents:messages.flatMap(message=>message.toolEvents??[]),projectId:(state.chats??[]).find(chat=>chat.id===id)?.projectId??null,modelBinding:(state.chats??[]).find(chat=>chat.id===id)?.modelBinding}});
 // 编辑用户消息:把会话 leaf 移到该条目的父节点(pi 追加树 branch/resetLeaf,文件不改写),
 // 截断其后全部条目;渲染端随后走 chat:send 以新文本重生成(worker 已停,重新 fork 从新 leaf 打开)
 handle('chat:edit',async(id:string,userIndex:number)=>{
  if(!isChatId(id)||!(state.chats??[]).some(chat=>chat.id===id))throw new Error('Chat not found');
  if(busy||syncWorking||syncPreparing)throw new Error('Chat busy');
  if(await syncJournal.hasChat(id))throw new Error('Synced chat edit unavailable');
  if(!Number.isInteger(userIndex)||userIndex<0)throw new Error('Invalid message');
  const file=sessionFile(id);await fs.access(file);
  stopWorker();
  const manager=SessionManager.open(file,sessionDir,app.getPath('userData'));
  const target=locateUserEntry(manager.getBranch(),userIndex);
  if(!target)throw new Error('Message not found');
  if(target.parentId)manager.branch(target.parentId);else manager.resetLeaf();
  /* branch()/resetLeaf() 只移动内存 leaf,不追加就不会落盘:补一条不进模型上下文的
     marker 条目提交新分支,worker 重开文件时 leaf 恰好落在截断处(pi leaf=文件最后一条) */
  manager.appendCustomEntry('piwork:edit-truncate',{userIndex});
 });
 handle('chat:rename',async(id:string,title:string)=>{await update(current=>({...current,chats:renameChat(current.chats??[],id,title)}))});
 handle('chat:delete',async(id:string)=>{
  if(!isChatId(id)||!(state.chats??[]).some(chat=>chat.id===id))throw new Error('Chat not found');
  if(busy||syncWorking||syncPreparing)throw new Error('Chat busy');
  if(await syncJournal.hasChat(id))throw new Error('Synced chat deletion unavailable');
  if(activeChatId===id)resetChat();
  const source=sessionFile(id),trashDir=path.join(app.getPath('userData'),'sessions-trash');
  await fs.mkdir(trashDir,{recursive:true,mode:0o700});
  const destination=path.join(trashDir,`${id}-${randomUUID()}.jsonl`);let moved=false;
  try{try{await fs.rename(source,destination);moved=true}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
   await update(current=>({...current,chats:(current.chats??[]).filter(chat=>chat.id!==id)}));
  }catch(error){if(moved)await fs.rename(destination,source).catch(()=>{});throw error}
 });
 handle('web-history:list',(before?:string)=>listWebHistory(before));
 handle('web-history:read',async(id:string)=>{const result=await readWebHistory(id);return {messages:result.messages,omitted:result.omitted}});
 handle('web-history:open',(id:string)=>openWebHistory(id));
 handle('web-history:import',async(id:string,title:string)=>{if(busy||syncWorking||syncPreparing)throw new Error('Session busy');if(typeof title!=='string'||!title.trim()||title.length>1000)throw new Error('Invalid title');const remote=await readWebHistory(id);if(!remote.messages.length)throw new Error('Empty web chat');await fs.mkdir(sessionDir,{recursive:true,mode:0o700});const newId=randomUUID(),target=sessionFile(newId);try{appendRemoteHistory(target,sessionDir,app.getPath('userData'),remote.messages);await update(current=>({...current,chats:[{id:newId,title:title.trim().slice(0,80),updatedAt:Date.now(),projectId:null,projectPath:null},...(current.chats??[])]}));return newId}catch(error){await fs.unlink(target).catch(()=>{});throw error}});
 async function canChangeAccount(){if(busy||syncWorking||syncPreparing)throw new Error('Session busy');if(experimentalSync&&state.preferences.syncEnabled&&await syncJournal.hasUnresolved())throw new Error('Sync pending')}
 receiveAccountCallback=async(url)=>{
  if(accountChanging)return;accountChanging=true;
  try{if(await completeAccountLogin(url,canChangeAccount)){stopWorker();if(window.isMinimized())window.restore();window.show();window.focus();setImmediate(()=>void synchronize())}}
  finally{accountChanging=false}
 };
 if(queuedAccountCallback){const url=queuedAccountCallback;queuedAccountCallback=undefined;void receiveAccountCallback(url).catch(()=>{})}
 handle('account:status',()=>accountStatus());
 handle('account:login',async(baseUrl:string)=>{if(accountChanging)throw new Error('Session busy');accountChanging=true;try{await canChangeAccount();await openAccountLogin(baseUrl)}finally{accountChanging=false}});
 handle('account:logout',async()=>{if(accountChanging)throw new Error('Session busy');accountChanging=true;try{await canChangeAccount();await logoutAccount();stopWorker();if(!window.isDestroyed())window.webContents.send('account:changed')}finally{accountChanging=false}});
 handle('gateway:get',()=>legacyGatewayGet());
 handle('gateway:set',async(input)=>{if(busy||pickingAttachment||accountChanging)throw new Error('Session busy');const result=await legacyGatewaySet(input);stopWorker();return result});
 /* 模型供应商管理:变更影响 worker 配置的操作沿用 gateway:set 的 busy 守卫并重启 worker;
    失败时记录主进程日志(IPC 错误到渲染层只剩 message,现场丢失) */
 const providersBusy=()=>{if(busy||pickingAttachment||accountChanging)throw new Error('Session busy')};
 const logged=(name:string,fn:(...args:any[])=>unknown)=>(...args:any[])=>Promise.resolve().then(()=>fn(...args)).catch(error=>{console.error(`[model-providers] ${name} failed:`,error);throw error});
 handle('model-providers:get',()=>modelProvidersView());
 handle('model-providers:install',logged('install',async(packageId:string)=>{providersBusy();if(typeof packageId!=='string')throw new Error('Invalid package');const view=await installFromCatalog(packageId);stopWorker();return view}));
 handle('model-providers:upload',logged('upload',async()=>{providersBusy();const picked=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'PiWork model provider package',extensions:['zip']}]});const file=picked.canceled?undefined:picked.filePaths[0];if(!file)throw new Error('Canceled');const buffer=await fs.readFile(file);const view=await installFromBuffer(path.basename(file),buffer);stopWorker();return view}));
 handle('model-providers:update',logged('update',async(id:string,patch)=>{providersBusy();if(!isChatId(id))throw new Error('Provider unavailable');const view=await updateInstallation(id,patch);stopWorker();return view}));
 handle('model-providers:remove',logged('remove',async(id:string)=>{providersBusy();if(!isChatId(id))throw new Error('Provider unavailable');const view=await removeInstallation(id);stopWorker();return view}));
 handle('model-providers:set-default',logged('set-default',async(value)=>{if(value!==null&&(!value||typeof value.providerKey!=='string'||typeof value.modelId!=='string'))throw new Error('Invalid default model');return await setDefaultModelValue(value)}));
 handle('preferences:get',()=>state.preferences);
 handle('app:version',()=>app.getVersion());
 // 客户端自动更新:快照/检查/下载/取消/打开安装包;状态变化经 app-update:changed 通知渲染层(仿 sync:changed)
 setAppUpdateNotifier(()=>{if(!window.isDestroyed())window.webContents.send('app-update:changed')});
 handle('app-update:state',()=>getAppUpdateState());
 handle('app-update:check',()=>checkForAppUpdate());
 handle('app-update:download',()=>downloadAppUpdate());
 handle('app-update:cancel-download',()=>cancelAppUpdateDownload());
 handle('app-update:open-installer',()=>openAppUpdateInstaller());
 handle('sync:status',()=>({state:experimentalSync&&state.preferences.syncEnabled?syncState:'off'}));
 handle('sync:now',async()=>{await synchronize();return {state:experimentalSync&&state.preferences.syncEnabled?syncState:'off'}});
 handle('sync:recover',async()=>{if(!experimentalSync||!state.preferences.syncEnabled||busy||syncWorking||syncPreparing||syncState!=='interrupted')throw new Error('Recovery unavailable');const account=await currentSyncAccount();const answer=await dialog.showMessageBox(window,{type:'warning',buttons:['取消 / Cancel','确认已停止 / Confirm stopped'],defaultId:0,cancelId:0,noLink:true,title:'PiWork · 中断任务 / Interrupted task',message:'请先确认之前的 PiWork 任务及其启动的本机进程均已停止。确认后将保留已记录的输入并释放同步锁，不会重跑任务。\nFirst verify that the previous PiWork task and processes it started have stopped. Confirmation keeps the recorded input and releases the sync lock without rerunning the task.',detail:'未完成的回复仍保留在本地，不会自动上传。\nAn unfinished reply stays local and is not uploaded automatically.'});if(answer.response!==1)return;if(busy||syncWorking||syncPreparing||syncState!=='interrupted')throw new Error('Recovery unavailable');const current=await currentSyncAccount();if(current.baseUrl!==account.baseUrl||current.userId!==account.userId)throw new Error('Sync account changed');await syncJournal.markInterruptedConfirmed(account,true);syncState='pending';notifySync();setImmediate(()=>void synchronize())});
 handle('preferences:set',async(p:Preferences)=>{if(!validPreferences(p))throw new Error('Invalid preferences');const enabled=p.syncEnabled??state.preferences.syncEnabled??false;if(enabled&&!experimentalSync&&!state.preferences.syncEnabled)throw new Error('Sync unavailable');if(enabled!==!!state.preferences.syncEnabled){if(busy||syncWorking||syncPreparing)throw new Error('Session busy');if(enabled){const account=await currentSyncAccount();if(!await accountSyncAvailable(account))throw new Error('Sync unavailable')}else if(await syncJournal.hasUnresolved())throw new Error('Sync pending')}const permission=p.permission??'confirm';await update(current=>({...current,preferences:{appearance:p.appearance,language:p.language,syncEnabled:enabled,permission,...(p.modelSource?{modelSource:p.modelSource}:{})}}));/* 权限模式变化即时下发活跃对话与定时任务 worker,对话进行中切换立即生效 */if(permission!==(state.preferences.permission??'confirm')){worker?.postMessage({type:'permission',mode:permission});for(const child of scheduledWorkers.values())child.postMessage({type:'permission',mode:permission})}notifySync();if(enabled)setImmediate(()=>void synchronize());return state.preferences});
 handle('projects:list',async()=>Promise.all(state.projects.map(async p=>{
  const folders=await Promise.all(p.folders.map(async f=>({...f,available:await fs.stat(f.path).then(s=>s.isDirectory()).catch(()=>false)})));
  return {...p,folders,available:folders.find(f=>f.main)?.available??folders[0]?.available??false};
 })));
 // 原生多选目录选择器;已属于其他项目的文件夹返回 existing(不带 token),由渲染层提示并跳过
 handle('projects:pick',async()=>{const result=await dialog.showOpenDialog(window,{properties:['openDirectory','multiSelections']});if(result.canceled||!result.filePaths.length)return null;const picks:Promise<{token:string;path:string;name:string;existing?:Project}>[]=[];for(const filePath of result.filePaths){picks.push((async()=>{const selected=await fs.realpath(filePath);if(!(await fs.stat(selected)).isDirectory())throw new Error('Invalid folder');const old=state.projects.find(p=>p.folders.some(folder=>folder.path===selected));if(old)return {token:'',path:selected,name:path.basename(selected),existing:{...old,available:true}};const token=randomUUID();pendingPicks.set(token,selected);return {token,path:selected,name:path.basename(selected)}})())}return Promise.all(picks)});
 handle('projects:cancel',(tokens?:string[])=>{if(Array.isArray(tokens))for(const token of tokens)pendingPicks.delete(token);else pendingPicks.clear()});
 handle('projects:create',async(tokens:string[],input:{name:string;description:string})=>{
  if(!Array.isArray(tokens)||!tokens.length||tokens.some(token=>typeof token!=='string'))throw new Error('Invalid project selection');
  const resolved:string[]=[];
  for(const token of tokens){const pending=pendingPicks.get(token);if(!pending)throw new Error('Invalid project selection');const real=await fs.realpath(pending);if(real!==pending||!(await fs.stat(real)).isDirectory())throw new Error('Project folder unavailable');resolved.push(real)}
  const folderInputs=resolved.map((folder,index)=>({path:folder,main:index===0}));
  const candidate={id:randomUUID(),name:'pending',description:'',folders:[]} as StoredProject;
  const validated=updateProject([candidate],candidate.id,{...input,folders:folderInputs})[0];
  let chosen:StoredProject=validated;
  await update(current=>{const result=addProject(current.projects,validated);chosen=result.selected;return {...current,projects:result.projects}});
  for(const token of tokens)pendingPicks.delete(token);
  return {...chosen,available:true};
 });
 handle('projects:update',async(id:string,input:{name:string;description:string;folders?:({token:string;main:boolean}|{path:string;main:boolean})[]})=>{
  if(typeof id!=='string'||!state.projects.some(p=>p.id===id))throw new Error('Project not found');
  let foldersInput:{path:string;main:boolean}[]|undefined;
  if(input.folders!==undefined){
   if(!Array.isArray(input.folders))throw new Error('Invalid folder');
   const current=state.projects.find(p=>p.id===id)!;
   foldersInput=[];
   for(const entry of input.folders){
    if(!entry||typeof entry!=='object')throw new Error('Invalid folder');
    if('token' in entry){
     if(typeof entry.token!=='string')throw new Error('Invalid folder');
     const pending=pendingPicks.get(entry.token);
     if(!pending)throw new Error('Project selection canceled');
     const real=await fs.realpath(pending);
     if(real!==pending||!(await fs.stat(real)).isDirectory())throw new Error('Project folder unavailable');
     foldersInput.push({path:real,main:entry.main===true});
    }else if(typeof entry.path==='string'&&current.folders.some(folder=>folder.path===entry.path)){
     // 仅允许保留本项目已有文件夹;新增路径必须来自选择器 token
     foldersInput.push({path:entry.path,main:entry.main===true});
    }else throw new Error('Invalid folder');
   }
  }
  await update(current=>{const original=current.projects.find(p=>p.id===id);return {...current,projects:updateProject(current.projects,id,{name:input.name,description:input.description,...(foldersInput?{folders:foldersInput}:{})}),chats:foldersInput&&original?preserveChatProjectPaths(current.chats??[],original):current.chats}});
  if(foldersInput)for(const entry of input.folders!)if('token' in entry)pendingPicks.delete(entry.token);
 });
 handle('projects:reveal-folder',async(id:string,folderPath:string)=>{
  if(typeof id!=='string'||typeof folderPath!=='string')throw new Error('Invalid project');
  const project=state.projects.find(item=>item.id===id);
  if(!project||!project.folders.some(folder=>folder.path===folderPath))throw new Error('Project not found');
  const target=await fs.realpath(folderPath).catch(()=>{throw new Error('Project unavailable')});
  shell.showItemInFolder(target);
 });
 /** 对话冻结的文件夹列表优先(主文件夹在前),否则用项目当前源文件夹 */
 const projectRoots=(id:string):ProjectRoot[]=>{
  if(typeof id!=='string')throw new Error('Invalid project');
  const p=state.projects.find(project=>project.id===id);
  if(!p)throw new Error('Project not found');
  const chat=activeChatId?(state.chats??[]).find(item=>item.id===activeChatId):undefined;
  if(chat?.projectId===id){
   const frozen=Array.isArray(chat.projectFolders)&&chat.projectFolders.length?chat.projectFolders:typeof chat.projectPath==='string'&&chat.projectPath?[chat.projectPath]:[];
   if(frozen.length)return frozen.map(root=>({root,label:p.folders.find(folder=>folder.path===root)?.label??path.basename(root)}));
  }
  return p.folders.map(folder=>({root:folder.path,label:folder.label}));
 };
 /** 无项目会话的输出文件夹名:聊天标题清洗 + chatId 前缀(库内唯一、合法文件名;标题改名不影响已存文件夹)。
     标题里的 Markdown 符号(*`[]#)、成对括号与引号一并剔除——它们进入文件夹名后会成为绝对路径的一
     部分,模型回显路径时按裸文本匹配会被这些字符截断,且目录名不可读 */
 const workspaceFolderName=(title:string,chatId:string):string=>{
  const cleaned=title.replace(/[\\/\0]/g,' ').replace(/[\x00-\x1f\u007f]/g,'').replace(/[*`[\]{}<>#|"'（）()【】]/g,' ').replace(/\s+/g,' ').replace(/^\.+/,'').trim().replace(/[.\s]+$/,'').slice(0,40).trimEnd();
  return `${cleaned||'文档'}-${chatId.slice(0,6)}`;
 };
 /** 无项目会话的聊天专属输出目录(我的文档/AI 生成/<文件夹>);写入/渲染/库注册都以此为界 */
 const chatWorkspaceFor=(folder:string):ProjectRoot=>{
  const workspace={root:path.join(libraryDir,'AI 生成',folder),label:'AI 生成'};
  return workspace;
 };
 /** office_render 的路径闸门:仅允许渲染本项目源文件夹或会话输出目录内的文件(渲染=读,防越权外带) */
 const renderPathAllowed=(target:unknown,roots:ProjectRoot[],workspace?:ProjectRoot):boolean=>{
  if(typeof target!=='string'||!path.isAbsolute(target)||target.includes('\0'))return false;
  return [...roots.map(item=>item.root),...(workspace?[workspace.root]:[])].some(container=>{
   const rel=path.relative(container,target);
   return !!rel&&!rel.startsWith('..')&&!path.isAbsolute(rel);
  });
 };
 // HTML 预览协议:项目文件沿用 projectRoots(含对话冻结文件夹),库文件与 library:read* 同根
 handlePreviewProtocol({getProjectRoots:projectRoots,getLibraryRoot:()=>libraryDir,getAttachmentRoot:()=>attachmentsDir});
 handle('files:saveAnswer',async(content:string)=>{
  if(typeof content!=='string'||!content.trim()||Buffer.byteLength(content,'utf8')>1024*1024)throw new Error('Invalid content');
  const root=await ensureLibrary(libraryDir);
  const result=await dialog.showSaveDialog(window,{defaultPath:path.join(root,'piwork-answer.md'),filters:[{name:'Markdown',extensions:['md']}]});
  if(result.canceled||!result.filePath)return null;
  const canonicalRoot=await fs.realpath(root);
  const canonicalParent=await fs.realpath(path.dirname(result.filePath));
  const relative=path.relative(canonicalRoot,path.join(canonicalParent,path.basename(result.filePath))).split(path.sep).join('/');
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Invalid path');
  await saveProjectMarkdown(canonicalRoot,relative,content);
  await registerAiFile(root,relative);
  return relative;
 });
 handle('files:saveHtml',async(content:string,name:string)=>{
  if(typeof content!=='string'||!content.trim()||Buffer.byteLength(content,'utf8')>1024*1024)throw new Error('Invalid HTML content');
  if(typeof name!=='string'||!/^piwork-answer(?:-[0-9]+)?\.html$/.test(name))throw new Error('Invalid HTML filename');
  const root=await ensureLibrary(libraryDir);
  const result=await dialog.showSaveDialog(window,{defaultPath:path.join(root,name),filters:[{name:'HTML',extensions:['html','htm']}]});
  if(result.canceled||!result.filePath)return null;
  if(!/\.html?$/i.test(result.filePath))throw new Error('Invalid HTML filename');
  const canonicalRoot=await fs.realpath(root);
  const canonicalParent=await fs.realpath(path.dirname(result.filePath));
  const relative=path.relative(canonicalRoot,path.join(canonicalParent,path.basename(result.filePath))).split(path.sep).join('/');
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Invalid path');
  await fs.writeFile(result.filePath,content,{encoding:'utf8',flag:'wx'});
  await registerAiFile(root,relative);
  return relative;
 });
 handle('library:list',()=>listLibrary(libraryDir));
 handle('library:createFolder',(parentPath:string,name:string)=>createLibraryFolder(libraryDir,parentPath,name));
 handle('library:saveNote',(parentPath:string,name:string,content:string)=>saveLibraryNote(libraryDir,parentPath,name,content));
 handle('library:upload',(sources:string[],parentPath:string)=>uploadLibraryFiles(libraryDir,sources,parentPath));
 handle('library:rename',(itemPath:string,newName:string)=>renameLibraryItem(libraryDir,itemPath,newName));
 handle('library:move',(itemPath:string,targetFolderPath:string)=>moveLibraryItem(libraryDir,itemPath,targetFolderPath));
 handle('library:trash',async(itemPath:string)=>{const target=await resolveInside(libraryDir,itemPath);if(!await fs.stat(target).then(stat=>stat.isFile()||stat.isDirectory()).catch(()=>false))throw new Error('Item not found');await shell.trashItem(target);await forgetLibraryItem(libraryDir,itemPath)});
 handle('library:reveal',async(itemPath:string)=>{const target=await resolveInside(libraryDir,itemPath);if(!await fs.stat(target).then(stat=>stat.isFile()||stat.isDirectory()).catch(()=>false))throw new Error('Item not found');shell.showItemInFolder(target)});
 handle('library:open',async(itemPath:string)=>{const target=await resolveInside(libraryDir,itemPath);if(!await fs.stat(target).then(stat=>stat.isFile()||stat.isDirectory()).catch(()=>false))throw new Error('Item not found');const error=await shell.openPath(target);if(error)throw new Error(error)});
 handle('library:export',async(itemPath:string)=>{const target=await resolveInside(libraryDir,itemPath);if(!await fs.stat(target).then(stat=>stat.isFile()).catch(()=>false))throw new Error('Not a file');const result=await dialog.showSaveDialog(window,{defaultPath:path.basename(target)});if(result.canceled||!result.filePath)return false;if(path.resolve(result.filePath)!==path.resolve(target))await fs.copyFile(target,result.filePath);return true});
 handle('library:readText',(itemPath:string)=>readProjectText(libraryDir,itemPath));
 handle('library:readImage',(itemPath:string)=>readProjectImage(libraryDir,itemPath));
 handle('library:readPdf',(itemPath:string)=>readProjectPdf(libraryDir,itemPath));
 // office 三件套与项目文件/附件同走高保真 LibreOffice→PDF 路径
 handle('library:readDocx',async(itemPath:string)=>officePreview.readDocumentPreview(await resolveInside(libraryDir,itemPath)));
 handle('library:readXlsx',async(itemPath:string)=>officePreview.readDocumentPreview(await resolveInside(libraryDir,itemPath)));
 handle('library:readPptx',async(itemPath:string)=>officePreview.readDocumentPreview(await resolveInside(libraryDir,itemPath)));
 const fileTarget=async(id:string,relative:string)=>{const target=splitProjectPath(projectRoots(id),relative);const resolved=await resolveInside(target.root,target.relative);if(!(await fs.stat(resolved)).isFile())throw new Error('Not a file');return resolved};
 handle('files:open',async(id:string,relative:string)=>{const target=await fileTarget(id,relative);const error=await shell.openPath(target);if(error)throw new Error(error)});
 // 浏览器标签「系统打开」:仅放行 http(s),交给系统默认浏览器
 handle('shell:open-external',async(url:string)=>{if(typeof url!=='string'||!/^https?:\/\//i.test(url))throw new Error('Invalid URL');await shell.openExternal(url)});
 // 来源站点图标:主进程代理抓取转 data URL(生产 CSP img-src 不放行远端图片)
 handle('chat:favicon',(url:string)=>faviconDataUrl(url));
 // 来源页面元数据(标题/摘要):补齐纯文本 URL 来源缺失的展示信息
 handle('chat:source-meta',(url:string)=>sourceMeta(url));
 handle('files:reveal',async(id:string,relative:string)=>{const target=await fileTarget(id,relative);shell.showItemInFolder(target)});
 handle('files:list',(id:string,relative:string)=>listProjectEntries(projectRoots(id),relative));
 handle('files:search',(id:string,query:string)=>searchProjectEntries(projectRoots(id),query));
 handle('files:readText',async(id:string,relative:string)=>{const target=splitProjectPath(projectRoots(id),relative);return readProjectText(target.root,target.relative)});
 handle('files:readImage',async(id:string,relative:string)=>{const target=splitProjectPath(projectRoots(id),relative);return readProjectImage(target.root,target.relative)});
 handle('files:readPdf',async(id:string,relative:string)=>{const target=splitProjectPath(projectRoots(id),relative);return readProjectPdf(target.root,target.relative)});
 // office 三件套:高保真 LibreOffice→PDF,失败回落原始字节(electron/office-preview.ts)
 handle('files:readDocument',async(id:string,relative:string)=>{const target=await fileTarget(id,relative);return officePreview.readDocumentPreview(target)});
 handle('projects:remove',async(id:string)=>{if(typeof id!=='string')throw new Error('Invalid project');await update(current=>{const original=current.projects.find(project=>project.id===id);return {...current,projects:removeProject(current.projects,id),chats:original?preserveChatProjectPaths(current.chats??[],original):current.chats}})});
}
const hasInstanceLock=app.requestSingleInstanceLock();
if(!hasInstanceLock)app.quit();
else {
registerPreviewScheme();
app.on('open-url',(event,url)=>{event.preventDefault();dispatchAccountCallback(url)});
if(process.defaultApp&&process.argv[1])app.setAsDefaultProtocolClient('piwork',process.execPath,[path.resolve(process.argv[1])]);else app.setAsDefaultProtocolClient('piwork');
app.on('second-instance',(_event,argv)=>{for(const arg of argv)dispatchAccountCallback(arg);const window=BrowserWindow.getAllWindows()[0];if(window){if(window.isMinimized())window.restore();window.show();window.focus()}});
app.whenReady().then(async()=>{await load();const window=new BrowserWindow({width:1240,height:820,minWidth:800,minHeight:600,title:'piwork',titleBarStyle:'hiddenInset',webPreferences:{preload:path.join(dirname,'preload.mjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webviewTag:true}});bindBrowserGuests(window);register(window);for(const arg of process.argv)dispatchAccountCallback(arg);const devUrl=developmentServerUrl(app.isPackaged,process.env.VITE_DEV_SERVER_URL);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(event,url)=>{if(!allowedNavigation(url,devUrl,path.join(dirname,'../dist/index.html')))event.preventDefault()});if(devUrl)await window.loadURL(devUrl);else await window.loadFile(path.join(dirname,'../dist/index.html'));scheduleAppUpdateAutoCheck()}).catch(error=>{dialog.showErrorBox('PiWork',`无法启动或读取本地数据。现有数据未被重置，请检查文件和权限后重试。\nUnable to start or read local data. Existing data has not been reset; check files and permissions and try again.\n\n${String(error)}`);app.quit()});
app.on('window-all-closed',()=>app.quit());
}
