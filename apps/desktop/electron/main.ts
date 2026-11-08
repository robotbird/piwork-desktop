import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, utilityProcess, powerMonitor } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Preferences, Project, ChatEvent, ChatChunkMessage, ChatSummary, PickedAttachment, LocalSkill, McpServer, McpInput, Schedule, ScheduleRun, ScheduleInput, ScheduleCreateRequest, ApprovalRequest } from '../shared/types';
import { listProjectEntries, searchProjectEntries, splitProjectPath, resolveInside, saveProjectMarkdown, readProjectText, readProjectImage, readProjectPdf, readProjectDocx, readProjectXlsx, readProjectPptx, type ProjectRoot } from './project-files';
import { listLibrary, createLibraryFolder, saveLibraryNote, uploadLibraryFiles, renameLibraryItem, moveLibraryItem, registerAiFile, forgetLibraryItem, ensureLibrary } from './library-store';
import {accountStatus,openAccountLogin,logoutAccount,accountSyncAvailable,accountSyncTransport,listWebHistory,readWebHistory,openWebHistory} from './account';
import {SyncJournal,type SyncAccount} from './sync-journal';
import {SettingsStorage} from './settings-storage';
import {syncOneChat,prepareSyncRun} from './sync-engine';
import {appendRemoteHistory} from './sync-pi-history';
import {startAccountBridge} from './account-bridge';
import { validateGateway, type GatewayConfig } from './gateway';
import { SessionManager, loadSkillsFromDir } from '@earendil-works/pi-coding-agent';
import {addProjectTextAttachment,addPickedAttachment,readChatAttachment,type PickedAttachmentContent} from './chat-attachment';
import {projectChatHistory} from './tool-history';
import {allowedNavigation,developmentServerUrl} from './navigation';
import {validateMcp} from './mcp-config';
import {installPiPackage,listInstalledPiPackages,piAgentDir,searchPiPackageCatalog,uninstallPiPackage} from './pi-packages';
import {cancelAppUpdateDownload,checkForAppUpdate,downloadAppUpdate,getAppUpdateState,openAppUpdateInstaller,scheduleAppUpdateAutoCheck,setAppUpdateNotifier} from './app-update';
import {validateSchedule,nextSchedule,dueState} from './schedule';
import {isChatId,renameChat,validateChatProject} from './chat-index';
import { addProject, removeProject, updateProject, preserveChatProjectPaths, normalizeStoredProject, type StoredProject } from './project-state';
import { registerPreviewScheme, handlePreviewProtocol } from './preview-protocol';
import { bindBrowserGuests } from './browser-guest';
const dirname=path.dirname(fileURLToPath(import.meta.url));
const defaults:Preferences={appearance:'system',language:'system'};
type State={preferences:Preferences;projects:StoredProject[];chats?:ChatSummary[];skills?:LocalSkill[];dismissedSkills?:string[];mcpServers?:McpServer[];schedules?:Schedule[];scheduleRuns?:ScheduleRun[]};
let state:State={preferences:defaults,projects:[]};
function statePath(){return path.join(app.getPath('userData'),'settings.json')}
function validPreferences(p:Preferences){return p && ['system','light','dark'].includes(p.appearance)&&['system','zh-CN','en'].includes(p.language)&&(p.syncEnabled===undefined||typeof p.syncEnabled==='boolean')}
function validState(value:unknown):value is State {if(!value||typeof value!=='object'||Array.isArray(value))return false;const v=value as Record<string,unknown>;if(!validPreferences(v.preferences as Preferences)||!Array.isArray(v.projects))return false;for(const key of ['projects','chats','skills','mcpServers','schedules','scheduleRuns']){const items=v[key];if(items===undefined&&key!=='projects')continue;if(!Array.isArray(items)||items.some(item=>!item||typeof item!=='object'||Array.isArray(item)))return false}if(v.dismissedSkills!==undefined&&(!Array.isArray(v.dismissedSkills)||!v.dismissedSkills.every(item=>typeof item==='string')))return false;return true}
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
type StoredGateway={baseUrl:string;modelId:string;encryptedKey?:string;supportsImages?:boolean};
function gatewayPath(){return path.join(app.getPath('userData'),'gateway.json')}
async function getGateway():Promise<StoredGateway|null>{try{const data=JSON.parse(await fs.readFile(gatewayPath(),'utf8'));if(typeof data.baseUrl!=='string'||typeof data.modelId!=='string'||(data.encryptedKey!==undefined&&typeof data.encryptedKey!=='string')||(data.supportsImages!==undefined&&typeof data.supportsImages!=='boolean'))throw new Error('Invalid gateway data');return data}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error}}
function publicGateway(value:StoredGateway):GatewayConfig{return {baseUrl:value.baseUrl,modelId:value.modelId,hasApiKey:!!value.encryptedKey,supportsImages:value.supportsImages===true}}
async function saveGateway(input:{baseUrl:string;modelId:string;apiKey:string;supportsImages?:boolean}):Promise<GatewayConfig>{const valid=validateGateway(input);const old=await getGateway();let encryptedKey=old?.baseUrl===valid.baseUrl?old.encryptedKey:undefined;if(valid.apiKey){if(!safeStorage.isEncryptionAvailable())throw new Error('Secure storage unavailable');encryptedKey=safeStorage.encryptString(valid.apiKey).toString('base64')}const next:StoredGateway={baseUrl:valid.baseUrl,modelId:valid.modelId,supportsImages:valid.supportsImages===true,...(encryptedKey?{encryptedKey}:{})};await fs.mkdir(app.getPath('userData'),{recursive:true});const target=gatewayPath();await fs.writeFile(target+'.tmp',JSON.stringify(next),{mode:0o600});await fs.rename(target+'.tmp',target);return publicGateway(next)}
function register(window:BrowserWindow){
 let accountFailure:number|null=null;let accountBridge:Awaited<ReturnType<typeof startAccountBridge>>|null=null;let activeModelKey:string|null=null;let worker:Electron.UtilityProcess|null=null;let busy=false;let activeChatId:string|null=null;let activeSkillId:string|null=null;let activeMcpId:string|null=null;let pendingPicks=new Map<string,string>();
 const scheduledWorkers=new Map<string,Electron.UtilityProcess>();const activeSchedules=new Set<string>();let scheduling=false;let suspended=false;let recoverPending=true;let schedulerTimer:NodeJS.Timeout|undefined;
 const sessionDir=path.join(app.getPath('userData'),'sessions');
 const sessionFile=(id:string)=>path.join(sessionDir,`${id}.jsonl`);
 const libraryDir=path.join(app.getPath('userData'),'library');
 // 对话附件的持久缓存副本(token/name):发送前与历史消息的预览都从副本读取,不依赖原文件位置
 const attachmentsDir=path.join(app.getPath('userData'),'attachments');
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
  if(!experimentalSync||!state.preferences.syncEnabled||syncWorking||syncPreparing||busy)return;syncWorking=true;syncState='syncing';notifySync();
  try{const account=await currentSyncAccount();const records=await syncJournal.list(account);if(records.some(record=>record.running)){syncState='interrupted';return}let remoteBusy=false;for(const record of records){if(busy)break;const result=await syncOneChat({journal:syncJournal,account,chatId:record.chatId,transport:accountSyncTransport(account),isBusy:()=>busy,appendRemote:items=>appendRemote(record.chatId,items)});if(result==='idle')remoteBusy=true}const latest=await syncJournal.list(account);syncState=remoteBusy||latest.some(item=>item.pending.length||item.leaseToken)?'pending':'ready'}catch(error){syncState=error instanceof Error&&error.message==='Sync conflict'?'conflict':'unavailable'}finally{syncWorking=false;flushSyncHistory();notifySync()}
 }
 async function finishForegroundSync(status:'completed'|'failed'|'aborted',text?:string){const account=foregroundSync;foregroundSync=null;if(!account||!activeChatId)return;try{await syncJournal.finish(activeChatId,account,status,text);syncState='pending'}catch{syncState='interrupted'}notifySync()}

 const emit=(event:ChatEvent)=>{if(!window.isDestroyed())window.webContents.send('chat:event',event)};
 /* 工具审批走渲染层应用内弹窗(替代系统弹窗):主进程登记待答复请求,渲染层回传结果;
    120 秒无响应自动拒绝并关闭弹窗(对齐 worker 侧审批超时) */
 const approvals=new Map<string,(allowed:boolean)=>void>();
 const askApproval=(event:ApprovalRequest):Promise<boolean>=>new Promise(resolve=>{
  if(window.isDestroyed()){resolve(false);return}
  let settled=false;const settle=(allowed:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);approvals.delete(event.id);resolve(allowed)};
  const timer=setTimeout(()=>{settle(false);if(!window.isDestroyed())window.webContents.send('approval:closed',event.id)},120000);
  approvals.set(event.id,settle);window.webContents.send('approval:request',event);
 });
 const denyApproval=(id:string)=>{const settle=approvals.get(id);if(settle){approvals.delete(id);settle(false);if(!window.isDestroyed())window.webContents.send('approval:closed',id)}};
 const denyApprovals=()=>{for(const id of [...approvals.keys()])denyApproval(id)};
 const disposeWorker=(child:Electron.UtilityProcess)=>{try{child.postMessage({type:'dispose'});const timer=setTimeout(()=>child.kill(),3000);timer.unref();child.once('exit',()=>clearTimeout(timer))}catch{child.kill()}};
 const stopWorker=()=>{const old=worker;worker=null;accountBridge?.close();accountBridge=null;activeModelKey=null;activeSkillId=null;activeMcpId=null;busy=false;lastWorkerActivity=0;denyApprovals();if(old)disposeWorker(old)};
 // 推理看门狗:上游网关或插件工具长时间无任何事件时中止 worker,
 // 避免会话 busy 永久卡死(全链路无超时兜底时后续发送都会被 Session busy 拦截)
 let lastWorkerActivity=0;let abortRequested=false;
 const watchdogTimer=setInterval(()=>{if(!busy||!worker)return;if(!lastWorkerActivity){lastWorkerActivity=Date.now();return}
  const idle=Date.now()-lastWorkerActivity;
  if(idle>330000){stopWorker();emit({type:'failed',message:'Agent response timed out'});setImmediate(()=>void synchronize());return}
  if(idle>300000&&!abortRequested){abortRequested=true;worker.postMessage({type:'abort'})}
 },5000);
 let pickedAttachment: {info:PickedAttachment;data:PickedAttachmentContent}|null=null;
 let pickingAttachment=false;
 const resetChat=()=>{stopWorker();activeChatId=null;pickedAttachment=null};
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
   const gateway=await getGateway();if(!gateway||gateway.baseUrl!==schedule.gatewayUrl||gateway.modelId!==schedule.modelId)throw new Error('gateway_changed');
   if(schedule.projectId&&!state.projects.some(p=>p.id===schedule.projectId))throw new Error('project_unavailable');
   if(schedule.projectId){const project=state.projects.find(p=>p.id===schedule.projectId)!;const main=project.folders.find(folder=>folder.main)??project.folders[0];if(!main||!await fs.stat(main.path).then(s=>s.isDirectory()).catch(()=>false))throw new Error('project_unavailable')}
   let key='';if(gateway.encryptedKey){if(!safeStorage.isEncryptionAvailable())throw new Error('credentials_unavailable');key=safeStorage.decryptString(Buffer.from(gateway.encryptedKey,'base64'))}
   run.chatId=chatId;
   await update(current=>({...current,scheduleRuns:(current.scheduleRuns??[]).map(r=>r.id===run.id?{...r,chatId}:r),chats:[{id:chatId,title:schedule.name,updatedAt:Date.now(),projectId:schedule.projectId,...(schedule.projectId?(()=>{const project=current.projects.find(item=>item.id===schedule.projectId);const folders=project?.folders??[];const main=folders.find(folder=>folder.main)??folders[0];return {projectPath:main?.path??null,projectFolders:folders.map(folder=>folder.path)}})():{projectPath:null})},...(current.chats??[])]}));
   await fs.mkdir(sessionDir,{recursive:true,mode:0o700});
   child=utilityProcess.fork(path.join(dirname,'chat-worker.js'),[],{stdio:'ignore'});scheduledWorkers.set(schedule.id,child);
   const currentChild=child;let settled=false;let deadline:NodeJS.Timeout|undefined;const runApprovals=new Set<string>();
   const finish=async(status:'completed'|'failed',detail?:string,exited=false)=>{if(settled)return;settled=true;if(deadline)clearTimeout(deadline);for(const id of runApprovals)denyApproval(id);runApprovals.clear();scheduledWorkers.delete(schedule.id);activeSchedules.delete(schedule.id);if(!exited)disposeWorker(currentChild);await update(current=>({...current,scheduleRuns:(current.scheduleRuns??[]).map(r=>r.id===run.id?{...r,status,finishedAt:Date.now(),...(detail?{detail}:{})}:r)})).catch(()=>{});if(!window.isDestroyed())window.webContents.send('schedules:changed')};
   deadline=setTimeout(()=>void finish('failed','timeout'),30*60*1000);
   currentChild.on('message',(event:ChatEvent)=>{if(event.type==='completed')void finish('completed');else if(event.type==='failed'||event.type==='aborted')void finish('failed','agent_failed');else if(event.type==='approval'){runApprovals.add(event.id);void askApproval({...event,context:schedule.name}).then(allowed=>{runApprovals.delete(event.id);if(!settled)currentChild.postMessage({type:'approval',id:event.id,allowed})})}});
   currentChild.on('exit',()=>void finish('failed','agent_stopped',true));
   currentChild.postMessage({type:'start',gateway:{baseUrl:gateway.baseUrl,modelId:gateway.modelId,apiKey:key,supportsImages:gateway.supportsImages===true},cwd:app.getPath('userData'),agentDir:piAgentDir(),sessionFile:sessionFile(chatId),...(skill?{skill:{name:skill.name,filePath:skill.filePath}}:{}),...(mcp?{mcp}:{}),...(schedule.projectId?{projectFolders:(state.projects.find(project=>project.id===schedule.projectId)?.folders??[]).map(folder=>({root:folder.path,label:folder.label}))}:{}),text:schedule.prompt});
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
 handle('approval:respond',(id:string,allowed:boolean)=>{if(typeof id!=='string'||typeof allowed!=='boolean')return;approvals.get(id)?.(allowed)});
 handle('skills:read',async(id:string)=>{if(!isChatId(id))throw new Error('Invalid skill');const skill=(state.skills??[]).find(item=>item.id===id);if(!skill)throw new Error('Skill unavailable');return readProjectText(path.dirname(skill.filePath),path.basename(skill.filePath))});
 handle('skills:import',async()=>{const result=await dialog.showOpenDialog(window,{properties:['openDirectory']});if(result.canceled||!result.filePaths[0])return null;const dir=await fs.realpath(result.filePaths[0]);const loaded=loadSkillsFromDir({dir,source:'local'});const valid=loaded.skills.filter(skill=>skill.name&&skill.filePath);let added=0,duplicates=0;await update(current=>{const skills=[...(current.skills??[])];for(const skill of valid){if(skills.some(existing=>existing.filePath===skill.filePath||existing.name===skill.name)){duplicates++;continue}skills.push({id:randomUUID(),name:skill.name,description:skill.description,filePath:skill.filePath,enabled:true,source:'local'});added++}return {...current,skills}});return {added,duplicates,warnings:loaded.diagnostics.length}});
 handle('skills:enable',async(id:string,enabled:boolean)=>{if(!isChatId(id)||typeof enabled!=='boolean'||!(state.skills??[]).some(skill=>skill.id===id))throw new Error('Invalid skill');await update(current=>({...current,skills:(current.skills??[]).map(skill=>skill.id===id?{...skill,enabled}:skill)}))});
 handle('skills:remove',async(id:string)=>{if(!isChatId(id)||!(state.skills??[]).some(skill=>skill.id===id))throw new Error('Invalid skill');const target=(state.skills??[]).find(skill=>skill.id===id);await update(current=>({...current,skills:(current.skills??[]).filter(skill=>skill.id!==id),...(target?.source==='agents'?{dismissedSkills:[...(current.dismissedSkills??[]),target.filePath]}:{})}))});
 handle('schedules:list',()=>({schedules:state.schedules??[],runs:state.scheduleRuns??[]}));
 // schedules:create IPC 与前台 Agent 的 create_scheduled_task 工具共用同一落库逻辑
 async function createScheduleRecord(input:ScheduleInput):Promise<void>{const value=validateSchedule(input);if(value.projectId&&!state.projects.some(p=>p.id===value.projectId))throw new Error('Project not found');if(value.skillId&&!(state.skills??[]).some(skill=>skill.id===value.skillId&&skill.enabled))throw new Error('Skill not found');if(value.mcpId&&!(state.mcpServers??[]).some(server=>server.id===value.mcpId&&server.enabled))throw new Error('MCP not found');const gateway=await getGateway();if(!gateway)throw new Error('Gateway not configured');const item:Schedule={...value,id:randomUUID(),enabled:true,nextAt:nextSchedule(value.cron,value.timezone,Date.now()),gatewayUrl:gateway.baseUrl,modelId:gateway.modelId};await update(current=>({...current,schedules:[...(current.schedules??[]),item]}));}
 handle('schedules:create',(input:ScheduleInput)=>createScheduleRecord(input));
 handle('schedules:update',async(id:string,input:ScheduleInput)=>{if(!isChatId(id)||!(state.schedules??[]).some(s=>s.id===id)||activeSchedules.has(id))throw new Error('Schedule unavailable');const value=validateSchedule(input);if(value.projectId&&!state.projects.some(p=>p.id===value.projectId))throw new Error('Project not found');if(value.skillId&&!(state.skills??[]).some(skill=>skill.id===value.skillId&&skill.enabled))throw new Error('Skill not found');if(value.mcpId&&!(state.mcpServers??[]).some(server=>server.id===value.mcpId&&server.enabled))throw new Error('MCP not found');const gateway=await getGateway();if(!gateway)throw new Error('Gateway not configured');await update(current=>({...current,schedules:(current.schedules??[]).map(s=>s.id===id?{...s,...value,nextAt:nextSchedule(value.cron,value.timezone,Date.now()),gatewayUrl:gateway.baseUrl,modelId:gateway.modelId}:s)}))});
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
   pickedAttachment={info,data};
   return info;
  }finally{pickingAttachment=false}
 });
 // 附件缓存预览:按扩展名分发到与项目文件一致的读取器(继承 1MB 文本/10MB 图片/20MB Office 上限)
 handle('chat:readAttachment',async(cache:string)=>{
  await attachmentCacheTarget(cache);
  const name=path.basename(cache);
  if(/\.pdf$/i.test(name))return {name,kind:'pdf' as const,content:await readProjectPdf(attachmentsDir,cache)};
  if(/\.docx$/i.test(name))return {name,kind:'docx' as const,content:await readProjectDocx(attachmentsDir,cache)};
  if(/\.xlsx$/i.test(name))return {name,kind:'xlsx' as const,content:await readProjectXlsx(attachmentsDir,cache)};
  if(/\.pptx$/i.test(name))return {name,kind:'pptx' as const,content:await readProjectPptx(attachmentsDir,cache)};
  if(/\.(png|jpe?g|gif|webp)$/i.test(name))return {name,kind:'image' as const,content:await readProjectImage(attachmentsDir,cache).then(image=>`data:${image.mime};base64,${image.base64}`)};
  if(/\.html?$/i.test(name))return {name,kind:'html' as const,content:await readProjectText(attachmentsDir,cache)};
  try{return {name,kind:'text' as const,content:await readProjectText(attachmentsDir,cache)}}catch{return {name,kind:'unsupported' as const,content:''}}
 });
 handle('chat:openAttachmentExternal',async(cache:string)=>{if(await shell.openPath(await attachmentCacheTarget(cache)))throw new Error('Cannot open attachment')});
 handle('chat:revealAttachment',async(cache:string)=>{shell.showItemInFolder(await attachmentCacheTarget(cache))});
 handle('chat:send',async(text:string,projectId:string|null,skillId:string|null,mcpId:string|null,attachment:string|{token:string}|null,selection?:{source:'account'|'custom';id:string})=>{
  if(typeof text!=='string'||!text.trim()||text.length>100000)throw new Error('Invalid message');if(syncWorking||syncPreparing)throw new Error('Sync busy');if(busy||pickingAttachment)throw new Error('Session busy');
  busy=true;
  try {if(skillId!==null&&typeof skillId!=='string')throw new Error('Invalid skill');const skill=skillId?(state.skills??[]).find(item=>item.id===skillId&&item.enabled):undefined;if(skillId&&!skill)throw new Error('Skill not enabled');if(skill)await fs.access(skill.filePath);if(mcpId!==null&&typeof mcpId!=='string')throw new Error('Invalid MCP');const mcp=mcpId?(state.mcpServers??[]).find(item=>item.id===mcpId&&item.enabled):undefined;if(mcpId&&!mcp)throw new Error('MCP not enabled');if(worker&&(activeSkillId!==skillId||activeMcpId!==mcpId))stopWorker();busy=true;const activeChat=activeChatId?(state.chats??[]).find(chat=>chat.id===activeChatId):undefined;if(activeChatId&&!activeChat)throw new Error('Chat not found');const selectedProject=validateChatProject(projectId,state.projects,activeChat);const source=selection?.source??'custom';if(!['custom','account'].includes(source))throw new Error('Invalid model source');let gateway:StoredGateway;let binding:NonNullable<ChatSummary['modelBinding']>;let supportsImages=false;
  if(source==='account'){const account=await accountStatus();const model=account.models.find(item=>item.id===selection?.id);if(!account.baseUrl||!account.user||!model)throw new Error('Account model unavailable');binding={source,id:model.id,baseUrl:account.baseUrl,userId:account.user.id};supportsImages=model.supportsImages===true;gateway={baseUrl:account.baseUrl,modelId:model.id};}else{const custom=await getGateway();if(!custom||selection&&selection.id!==custom.modelId)throw new Error('Gateway not configured');gateway=custom;binding={source,id:custom.modelId,baseUrl:custom.baseUrl};supportsImages=custom.supportsImages===true}
  if(activeChat?.modelBinding&&JSON.stringify(activeChat.modelBinding)!==JSON.stringify(binding))throw new Error('Chat model changed');const modelKey=JSON.stringify(binding);if(worker&&activeModelKey!==modelKey)stopWorker();busy=true;
  const project=selectedProject?state.projects.find(item=>item.id===selectedProject):undefined;
  const roots=project?projectRoots(project.id):[];
  let promptText=text;
  let images:import('@earendil-works/pi-ai').ImageContent[]|undefined;
  if(typeof attachment==='string'){
   if(!project||!roots.length)throw new Error('Project required');
   promptText=await addProjectTextAttachment(text,roots,attachment);
  }else if(attachment!==null){
   if(!attachment||!pickedAttachment||attachment.token!==pickedAttachment.info.token)throw new Error('Invalid attachment');
   if(pickedAttachment.data.kind==='image'){
    if(!supportsImages)throw new Error('Model does not support images');
    images=[pickedAttachment.data.image];
   }
   promptText=addPickedAttachment(text,pickedAttachment.info.name,pickedAttachment.data,pickedAttachment.info.cache);
  }
  let key='';if(gateway.encryptedKey){if(!safeStorage.isEncryptionAvailable())throw new Error('Secure storage unavailable');key=safeStorage.decryptString(Buffer.from(gateway.encryptedKey,'base64'))}
  if(!activeChatId){const id=randomUUID();await update(current=>({...current,chats:[{id,title:text.trim().slice(0,80),updatedAt:Date.now(),projectId:selectedProject,projectPath:roots[0]?.root??null,...(roots.length?{projectFolders:roots.map(item=>item.root)}:{}) ,modelBinding:binding},...(current.chats??[])]}));activeChatId=id}
  await fs.mkdir(sessionDir,{recursive:true,mode:0o700});
  if(experimentalSync&&state.preferences.syncEnabled){syncPreparing=true;try{const account=await currentSyncAccount();const existing=(await syncJournal.list(account)).find(item=>item.chatId===activeChatId);if(!existing&&activeChat&&await fs.access(sessionFile(activeChatId)).then(()=>true).catch(()=>false))throw new Error('Sync only supports new chats');await prepareSyncRun({journal:syncJournal,account,chatId:activeChatId,title:activeChat?.title??text.trim().slice(0,80),text,transport:accountSyncTransport(account),isBusy:()=>false,appendRemote:items=>appendRemote(activeChatId!,items)});foregroundSync=account;busy=true;syncState='syncing';notifySync()}catch(error){if(error instanceof Error&&error.message==='Sync only supports new chats')throw error;const conflict=error instanceof Error&&error.message==='Sync conflict';const running=error instanceof Error&&error.message==='Sync task running';syncState=running?'pending':conflict?'conflict':'unavailable';notifySync();throw new Error(running?'Sync task running':conflict?'Sync conflict':'Sync unavailable')}finally{syncPreparing=false;busy=true;flushSyncHistory()}}
  if(source==='account'){if(!accountBridge)accountBridge=await startAccountBridge(binding.baseUrl,binding.id,status=>{accountFailure=status});accountFailure=null;accountBridge.newRun();gateway={baseUrl:accountBridge.baseUrl,modelId:binding.id};key=accountBridge.apiKey}activeModelKey=modelKey;
  if(!worker){const child=utilityProcess.fork(path.join(dirname,'chat-worker.js'),[],{stdio:'ignore'});worker=child;activeSkillId=skillId;activeMcpId=mcpId;child.on('message',async(event:ChatEvent|ChatChunkMessage|ScheduleCreateRequest)=>{if(worker!==child)return;lastWorkerActivity=Date.now();abortRequested=false;if(event.type==='schedule:create'){try{await createScheduleRecord({name:event.input.taskType,prompt:event.input.prompt,cron:event.input.cron,timezone:event.input.timezone,projectId:null,skillId:null,mcpId:null});child.postMessage({type:'schedule:result',id:event.id,ok:true})}catch(error){child.postMessage({type:'schedule:result',id:event.id,ok:false,error:error instanceof Error?error.message:'Schedule create failed'})}return}if(event.type==='chunk'){if(!window.isDestroyed())window.webContents.send('chat:chunk',event);return}if(event.type==='approval'){void askApproval(event).then(allowed=>{if(worker===child)child.postMessage({type:'approval',id:event.id,allowed})});return}if(event.type==='completed'||event.type==='failed'||event.type==='aborted'){await finishForegroundSync(event.type==='completed'?'completed':event.type==='aborted'?'aborted':'failed',event.type==='completed'?event.text:undefined);busy=false;setImmediate(()=>void synchronize());const id=activeChatId;if(id)await update(current=>({...current,chats:(current.chats??[]).map(chat=>chat.id===id?{...chat,updatedAt:Date.now()}:chat)})).catch(()=>{});if(worker!==child)return}emit(event.type==='failed'&&accountFailure?{type:'failed',message:`account:${accountFailure}`} : event)});child.on('exit',async()=>{if(worker!==child)return;worker=null;denyApprovals();if(busy){await finishForegroundSync('failed');busy=false;setImmediate(()=>void synchronize());emit({type:'failed',message:'Agent process stopped'})}});child.postMessage({type:'start',gateway:{baseUrl:gateway.baseUrl,modelId:gateway.modelId,apiKey:key,supportsImages,...(source==='account'?{api:'pi-messages'}:{})},cwd:app.getPath('userData'),agentDir:piAgentDir(),sessionFile:sessionFile(activeChatId),...(roots.length?{projectFolders:roots}:{}),...(mcp?{mcp}:{}),...(skill?{skill:{name:skill.name,filePath:skill.filePath}}:{}),text:promptText,images,allowScheduleTools:true})}
  else worker.postMessage({type:'prompt',text:promptText,images,...(skill?{skillName:skill.name}:{})});
  if(attachment&&typeof attachment==='object')pickedAttachment=null;
  return activeChatId;
  }catch(error){if(foregroundSync)await finishForegroundSync('failed');if(!worker){accountBridge?.close();accountBridge=null;activeModelKey=null}busy=false;setImmediate(()=>void synchronize());throw error}
 });
 handle('chat:stop',()=>{if(worker&&busy)worker.postMessage({type:'abort'})});
 handle('chat:clear',()=>{if(syncWorking||syncPreparing||foregroundSync&&busy)throw new Error('Sync run active');resetChat()});
 handle('chat:list',()=>[...(state.chats??[])].sort((a,b)=>b.updatedAt-a.updatedAt));
 handle('chat:open',async(id:string)=>{if(!isChatId(id)||!(state.chats??[]).some(chat=>chat.id===id))throw new Error('Chat not found');if(busy||syncWorking||syncPreparing)throw new Error('Chat busy');const file=sessionFile(id);await fs.access(file);const context=SessionManager.open(file,sessionDir,app.getPath('userData')).buildSessionContext();const messages=projectChatHistory(context.messages);stopWorker();if(activeChatId!==id)pickedAttachment=null;activeChatId=id;return {messages,toolEvents:messages.flatMap(message=>message.toolEvents??[]),projectId:(state.chats??[]).find(chat=>chat.id===id)?.projectId??null,modelBinding:(state.chats??[]).find(chat=>chat.id===id)?.modelBinding}});
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
 handle('account:status',()=>accountStatus());
 handle('account:login',async(baseUrl:string)=>{if(busy||syncWorking||syncPreparing)throw new Error('Session busy');if(experimentalSync&&state.preferences.syncEnabled&&await syncJournal.hasUnresolved())throw new Error('Sync pending');return openAccountLogin(window,baseUrl)});
 handle('account:logout',async()=>{if(busy||syncWorking||syncPreparing)throw new Error('Session busy');if(experimentalSync&&state.preferences.syncEnabled&&await syncJournal.hasUnresolved())throw new Error('Sync pending');await logoutAccount();stopWorker()});
 handle('gateway:get',async()=>{const value=await getGateway();return value?publicGateway(value):null});
 handle('gateway:set',async(input)=>{if(busy||pickingAttachment)throw new Error('Session busy');const result=await saveGateway(input);stopWorker();return result});
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
 handle('preferences:set',async(p:Preferences)=>{if(!validPreferences(p))throw new Error('Invalid preferences');const enabled=p.syncEnabled??state.preferences.syncEnabled??false;if(enabled&&!experimentalSync&&!state.preferences.syncEnabled)throw new Error('Sync unavailable');if(enabled!==!!state.preferences.syncEnabled){if(busy||syncWorking||syncPreparing)throw new Error('Session busy');if(enabled){const account=await currentSyncAccount();if(!await accountSyncAvailable(account))throw new Error('Sync unavailable')}else if(await syncJournal.hasUnresolved())throw new Error('Sync pending')}await update(current=>({...current,preferences:{appearance:p.appearance,language:p.language,syncEnabled:enabled}}));notifySync();if(enabled)setImmediate(()=>void synchronize());return state.preferences});
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
 handle('library:readDocx',(itemPath:string)=>readProjectDocx(libraryDir,itemPath));
 handle('library:readXlsx',(itemPath:string)=>readProjectXlsx(libraryDir,itemPath));
 handle('library:readPptx',(itemPath:string)=>readProjectPptx(libraryDir,itemPath));
 const fileTarget=async(id:string,relative:string)=>{const target=splitProjectPath(projectRoots(id),relative);const resolved=await resolveInside(target.root,target.relative);if(!(await fs.stat(resolved)).isFile())throw new Error('Not a file');return resolved};
 handle('files:open',async(id:string,relative:string)=>{const target=await fileTarget(id,relative);const error=await shell.openPath(target);if(error)throw new Error(error)});
 // 浏览器标签「系统打开」:仅放行 http(s),交给系统默认浏览器
 handle('shell:open-external',async(url:string)=>{if(typeof url!=='string'||!/^https?:\/\//i.test(url))throw new Error('Invalid URL');await shell.openExternal(url)});
 handle('files:reveal',async(id:string,relative:string)=>{const target=await fileTarget(id,relative);shell.showItemInFolder(target)});
 handle('files:list',(id:string,relative:string)=>listProjectEntries(projectRoots(id),relative));
 handle('files:search',(id:string,query:string)=>searchProjectEntries(projectRoots(id),query));
 handle('files:readText',async(id:string,relative:string)=>{const target=splitProjectPath(projectRoots(id),relative);return readProjectText(target.root,target.relative)});
 handle('files:readImage',async(id:string,relative:string)=>{const target=splitProjectPath(projectRoots(id),relative);return readProjectImage(target.root,target.relative)});
 handle('files:readPdf',async(id:string,relative:string)=>{const target=splitProjectPath(projectRoots(id),relative);return readProjectPdf(target.root,target.relative)});
 handle('files:readDocx',async(id:string,relative:string)=>{const target=splitProjectPath(projectRoots(id),relative);return readProjectDocx(target.root,target.relative)});
 handle('files:readXlsx',async(id:string,relative:string)=>{const target=splitProjectPath(projectRoots(id),relative);return readProjectXlsx(target.root,target.relative)});
 handle('files:readPptx',async(id:string,relative:string)=>{const target=splitProjectPath(projectRoots(id),relative);return readProjectPptx(target.root,target.relative)});
 handle('projects:remove',async(id:string)=>{if(typeof id!=='string')throw new Error('Invalid project');await update(current=>{const original=current.projects.find(project=>project.id===id);return {...current,projects:removeProject(current.projects,id),chats:original?preserveChatProjectPaths(current.chats??[],original):current.chats}})});
}
const hasInstanceLock=app.requestSingleInstanceLock();
if(!hasInstanceLock)app.quit();
else {
registerPreviewScheme();
app.on('second-instance',()=>{const window=BrowserWindow.getAllWindows()[0];if(window){if(window.isMinimized())window.restore();window.show();window.focus()}});
app.whenReady().then(async()=>{await load();const window=new BrowserWindow({width:1240,height:820,minWidth:800,minHeight:600,title:'piwork',titleBarStyle:'hiddenInset',webPreferences:{preload:path.join(dirname,'preload.mjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webviewTag:true}});bindBrowserGuests(window);register(window);const devUrl=developmentServerUrl(app.isPackaged,process.env.VITE_DEV_SERVER_URL);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(event,url)=>{if(!allowedNavigation(url,devUrl,path.join(dirname,'../dist/index.html')))event.preventDefault()});if(devUrl)await window.loadURL(devUrl);else await window.loadFile(path.join(dirname,'../dist/index.html'));scheduleAppUpdateAutoCheck()}).catch(error=>{dialog.showErrorBox('PiWork',`无法启动或读取本地数据。现有数据未被重置，请检查文件和权限后重试。\nUnable to start or read local data. Existing data has not been reset; check files and permissions and try again.\n\n${String(error)}`);app.quit()});
app.on('window-all-closed',()=>app.quit());
}
