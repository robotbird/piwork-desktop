import {createAgentSession,createBashToolDefinition,createMcpExtension,defineTool,DefaultResourceLoader,ModelRuntime,SessionManager,SettingsManager,type AgentSession,type ExtensionFactory} from '@earendil-works/pi-coding-agent';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import type {McpConfig} from './mcp-config.ts';
import type {GatewayInput} from './gateway.ts';
import {validateGateway} from './gateway.ts';
import {createProjectTools} from './project-tools.ts';
import type {ProjectRoot} from './project-files.ts';
import {createSkillTools} from './skill-tools.ts';
import {createScheduleTools,schedulingPrompt,type ScheduleCreateInput} from './schedule-tools.ts';
import type {ChatEvent} from '../shared/types.ts';
import {capToolText,sanitizeArgs,toolFailureReason,toolResultText} from './tool-history.ts';
import {PiToRuntimeMapper} from './pi-to-runtime.ts';
import type {RuntimeEvent} from '../src/web/lib/runtime/protocol/events.ts';

export class ChatSession {
 private session:AgentSession|null=null;
 private running=false;
 private aborted=false;
 private unsubscribe:(()=>void)|null=null;
 private readonly onEvent:(event:ChatEvent)=>void;
 private readonly onRuntimeEvent:((event:RuntimeEvent)=>void)|null;
 private readonly approve:(id:string,name:string,input:unknown)=>Promise<boolean>;
 private mapper:PiToRuntimeMapper|null=null;
 constructor(onEvent:(event:ChatEvent)=>void,onRuntimeEvent:((event:RuntimeEvent)=>void)|null=null,approve:(id:string,name:string,input:unknown)=>Promise<boolean>=async()=>false){this.onEvent=onEvent;this.onRuntimeEvent=onRuntimeEvent;this.approve=approve}
 async open(input:GatewayInput,cwd:string,agentDir:string,sessionFile?:string,skillPath?:string,mcp?:McpConfig,projectRoots?:ProjectRoot[],schedule?:{requestCreate:(input:ScheduleCreateInput)=>Promise<void>}){
  const config=validateGateway(input);
  const runtime=await ModelRuntime.create({modelsPath:null,authPath:`${agentDir}/auth.json`,refreshOnCreate:false});
  runtime.registerProvider('piwork-custom',{name:'Custom gateway',baseUrl:config.baseUrl,api:config.api??'openai-completions',apiKey:config.apiKey||'local',models:[{id:config.modelId,name:config.modelId,reasoning:false,input:config.supportsImages?['text','image']:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:8192}]});
  const model=runtime.getModel('piwork-custom',config.modelId);
  if(!model)throw new Error('Model unavailable');
  // 从磁盘加载受管 agentDir(<userData>/pi)的 settings:已安装 pi 插件(pi.dev/packages)
  // 注册在 packages 数组,loader 据此解析包内 extensions/skills/prompts 并在对话中生效
  const settings=SettingsManager.create(cwd,agentDir);
  const approval:ExtensionFactory=pi=>{pi.on('tool_call',async event=>{if((event.toolName.startsWith('mcp__')||event.toolName==='skill_bash')&&!await this.approve(event.toolCallId,event.toolName,event.toolName==='skill_bash'?{...event.input,cwd:projectRoots?.[0]?.root??(skillPath?path.dirname(skillPath):cwd)}:event.input))return {block:true,reason:'Tool call not approved'}})};
  const extensions:ExtensionFactory[]=[...((mcp||skillPath)?[approval]:[]),...(mcp?[createMcpExtension({logPath:'/dev/null',loadConfig:()=>({servers:[{name:mcp.name,source:'desktop',config:mcp.type==='stdio'?{command:mcp.command!,args:mcp.args,env:mcp.env,description:mcp.description,exposure:'direct'}:{url:mcp.url!,headers:mcp.headers,description:mcp.description,exposure:'direct'}}],errors:[],autoEnableCodemode:false})})]:[])];
  const systemPrompt=[
   'You are PiWork, a desktop assistant for answering questions and working with user-provided materials.',
   'After generating a document or report, include a bold Markdown link to each output file, for example **[Report.pptx](<project-folder/Report.pptx>)**. Use the exact path returned by the tool. Do not present output paths only as inline code. PiWork opens local document links in the preview panel.',
   'Use only the tools declared in the current request, through the native tool calling interface. Never emit tool-call markup or JSON as a substitute for a tool call. Only report actions supported by an actual tool result.',
   projectRoots
    ? `A local project is selected. Call project_list with an empty path first: the top-level directories are the project source folders, and the first one is the main folder. Project paths start with a source folder name (for example "${projectRoots[0].label}/notes.md"); a bare path resolves inside the main folder. Every source folder is readable, but project_write and project_create_office only work inside the main folder. When the user requests an HTML file, use project_write to deliver it and summarize the result in the reply.`
    : 'No local project is selected. For local project materials, use the files attached to the conversation. If the task needs local project files that were not attached, ask the user to start a new chat with a project selected or attach the files. Do not assume access to a local directory. When delivering HTML without a project, put it in a fenced html block so PiWork can offer it as a file.',
   // 前台对话注册 create_scheduled_task 时附带调度规则(web schedulingPrompt 的桌面版);
   // 定时任务的 worker 运行不带该工具,避免 Agent 递归建任务。
   ...(schedule?[schedulingPrompt+new Date().toString()]:[]),
  ].join('\n\n');
  const loader=new DefaultResourceLoader({
   cwd,agentDir,settingsManager:settings,extensionFactories:extensions,systemPrompt,
   additionalSkillPaths:skillPath?[skillPath]:[],
   // 桌面端不用 pi 终端主题与 AGENTS.md 类上下文文件;extensions/skills/prompts
   // 保持加载,使已安装 pi 插件在对话中生效
   noThemes:true,noContextFiles:true,
  });
  await loader.reload();
  // noTools:'builtin' 关闭默认编码工具(read/bash/edit/write)但保留扩展与自定义工具;
  // 原先的 tools 白名单无法容纳插件扩展注册的任意工具名,故改用此模式
  const {session}=await createAgentSession({cwd,agentDir,model,modelRuntime:runtime,settingsManager:settings,resourceLoader:loader,sessionManager:sessionFile?SessionManager.open(sessionFile,undefined,cwd):SessionManager.inMemory(),noTools:'builtin',customTools:[...(projectRoots?createProjectTools(projectRoots,this.approve,config.supportsImages===true):[]),...(skillPath?[...createSkillTools(skillPath),defineTool({...createBashToolDefinition(projectRoots?.[0]?.root??path.dirname(skillPath),{exposeSessionEnvironment:false,spawnHook:context=>({...context,cwd:projectRoots?.[0]?.root??path.dirname(skillPath)})}),name:'skill_bash'})]:[]),...(schedule?createScheduleTools(schedule.requestCreate):[])],thinkingLevel:'off'});
  this.session=session;
  if(mcp)await session.bindExtensions({});
  this.unsubscribe=session.subscribe(event=>{
   if(this.mapper)for(const runtimeEvent of this.mapper.push(event))this.onRuntimeEvent?.(runtimeEvent);
   if(event.type==='message_update'&&event.assistantMessageEvent.type==='text_delta')this.onEvent({type:'delta',text:event.assistantMessageEvent.delta});
   else if(event.type==='tool_execution_start')this.onEvent({type:'tool',id:event.toolCallId,name:event.toolName,status:'running',args:sanitizeArgs(event.args),startedAt:Date.now(),...((event.toolName.startsWith('project_')||event.toolName==='skill_read')&&typeof event.args?.path==='string'?{path:event.args.path}:{})});
   else if(event.type==='tool_execution_update'){const partial=capToolText(toolResultText(event.partialResult));this.onEvent({type:'tool',id:event.toolCallId,name:event.toolName,status:'running',...(partial?{result:partial}:{})})}
   else if(event.type==='tool_execution_end'){
    const message=capToolText(toolResultText(event.result));
    const reason=toolFailureReason(message);
    this.onEvent({type:'tool',id:event.toolCallId,name:event.toolName,status:event.isError?'failed':'completed',...(message?{result:message}:{}),...(event.isError?{reason}:{}),...(typeof event.durationMs==='number'?{durationMs:event.durationMs}:{})});
   }
  });
 }
 async prompt(text:string,skillName?:string,images?:import('@earendil-works/pi-ai').ImageContent[]){
  if(!this.session)throw new Error('Session not ready');if(skillName&&!this.session.resourceLoader.getSkills().skills.some(skill=>skill.name===skillName))throw new Error('Skill unavailable');if(this.running)throw new Error('Session busy');if(!text.trim())throw new Error('Empty message');
  this.running=true;this.aborted=false;
  this.mapper=new PiToRuntimeMapper(randomUUID());
  for(const runtimeEvent of this.mapper.start())this.onRuntimeEvent?.(runtimeEvent);
  try {
   await this.session.prompt(skillName?`/skill:${skillName} ${text}`:text,{expandPromptTemplates:!!skillName,images});
   await this.resumeAfterModelError();
   if(!this.session)throw new Error('Session closed');
   if(this.aborted){this.onEvent({type:'aborted'});for(const runtimeEvent of this.mapper.settle('aborted'))this.onRuntimeEvent?.(runtimeEvent)}
   else {const last=this.session.messages.at(-1);const failure=last?.role==='assistant'&&last.stopReason==='error'?last.errorMessage||'Model request failed':'';if(failure){this.onEvent({type:'failed',message:failure});for(const runtimeEvent of this.mapper.fail(failure))this.onRuntimeEvent?.(runtimeEvent)}else{this.onEvent({type:'completed',text:this.session.getLastAssistantText()??''});for(const runtimeEvent of this.mapper.settle('completed'))this.onRuntimeEvent?.(runtimeEvent)}}
  } catch(error){const failure=error instanceof Error&&error.message?error.message:'Model request failed';this.onEvent(this.aborted?{type:'aborted'}:{type:'failed',message:failure});for(const runtimeEvent of this.aborted?this.mapper.settle('aborted'):this.mapper.fail(failure))this.onRuntimeEvent?.(runtimeEvent)} finally{this.running=false}
 }
 /** 瞬态模型错误(连接失败/网关抖动)不应终结整个回合——长流水线技能(如 ppt-master)几十次工具调用后断线即前功尽弃。
  *  Pi 运行时会把失败的 assistant 响应挂起并在下一次请求中原样带回,因此等待数秒后追加一条「继续」
  *  即可续跑同一回合。仅自动尝试一次;二次失败沿用挂起的错误响应,由 prompt() 如实上报真实原因。 */
 private async resumeAfterModelError(){
  if(!this.session||this.aborted)return;
  const failed=this.session.messages.at(-1);
  if(failed?.role!=='assistant'||failed.stopReason!=='error')return;
  // 调用时读取以便测试经 PIWORK_MODEL_ERROR_RESUME_DELAY_MS 缩短等待
  await new Promise(resolve=>setTimeout(resolve,Number(process.env.PIWORK_MODEL_ERROR_RESUME_DELAY_MS??8000)));
  if(!this.session||this.aborted)return;
  const still=this.session.messages.at(-1);
  if(still?.role!=='assistant'||still.stopReason!=='error')return;
  try{await this.session.prompt('继续')}catch{/* 二次异常不覆盖挂起的错误响应,由外层统一判定 */}
 }
 async abort(){if(this.running&&this.session){this.aborted=true;await this.session.abort()}}
 async close(){const session=this.session;this.session=null;this.unsubscribe?.();if(session){try{await session.extensionRunner.emit({type:'session_shutdown',reason:'quit'})}finally{session.dispose()}}}
 dispose(){this.unsubscribe?.();this.session?.dispose();this.session=null}
}
