import type {ChatSummary,LocalSkill,McpServer,Preferences,Project,Schedule,ScheduleRun} from '../shared/types.ts';
import {validateMcp} from './mcp-config.ts';
import {validateSchedule} from './schedule.ts';

type StoredProject=Omit<Project,'available'>;
export type LegacyState={preferences:Preferences;projects:StoredProject[];chats:ChatSummary[];skills:LocalSkill[];mcpServers:McpServer[];schedules:Schedule[];scheduleRuns:ScheduleRun[]};
type Obj=Record<string,unknown>;
const keys=new Set(['preferences','projects','chats','skills','mcpServers','schedules','scheduleRuns']);
const obj=(x:unknown):x is Obj=>!!x&&typeof x==='object'&&!Array.isArray(x);
const text=(x:unknown):x is string=>typeof x==='string'&&!!x.trim();
const nullableText=(x:unknown)=>x==null||typeof x==='string';
const time=(x:unknown)=>Number.isSafeInteger(x)&&Number(x)>=0;
function fail(category:string):never{throw new Error(`Invalid legacy ${category}`)}
function list(root:Obj,key:string,required=false):Obj[]{const value=root[key];if(value===undefined&&!required)return [];if(!Array.isArray(value)||value.some(item=>!obj(item)))return fail(key);return value as Obj[]}
function unique(items:Obj[],key:string,category:string,normalize:(s:string)=>string=s=>s){const seen=new Set<string>();for(const item of items){const value=item[key];if(!text(value)||seen.has(normalize(value)))fail(category);seen.add(normalize(value))}}
/** Validates existing JSON without reading project files or logging content. */
export function preflightLegacy(input:unknown):LegacyState {
 if(!obj(input)||Object.keys(input).some(key=>!keys.has(key)))return fail('root');
 const p=input.preferences;if(!obj(p)||!['system','light','dark'].includes(String(p.appearance))||!['system','zh-CN','en'].includes(String(p.language)))return fail('preferences');
 const projects=list(input,'projects',true),chats=list(input,'chats'),skills=list(input,'skills'),mcp=list(input,'mcpServers'),schedules=list(input,'schedules'),runs=list(input,'scheduleRuns');
 for(const [items,key] of [[projects,'projects'],[chats,'chats'],[skills,'skills'],[mcp,'mcpServers'],[schedules,'schedules'],[runs,'scheduleRuns']] as const)unique(items,'id',key);
 unique(skills,'name','skills');unique(skills,'filePath','skills');unique(mcp,'name','mcpServers',name=>name.replace(/-/g,'_'));
 // 项目支持旧版单 path 或新版 folders;所有文件夹路径跨项目唯一
 const folderPaths=new Set<string>();
 for(const x of projects){
  if(!text(x.name)||(x.description!==undefined&&typeof x.description!=='string'))fail('projects');
  const folders=Array.isArray(x.folders)&&x.folders.length?x.folders:typeof x.path==='string'&&x.path?[x.path]:[];
  if(!folders.length)fail('projects');
  for(const folder of folders){const folderPath=typeof folder==='string'?folder:(obj(folder)&&typeof folder.path==='string'?folder.path:'');if(!text(folderPath)||folderPaths.has(folderPath))fail('projects');folderPaths.add(folderPath)}
 }
 for(const x of chats)if(!text(x.title)||!time(x.updatedAt)||!nullableText(x.projectId)||!nullableText(x.projectPath)||(x.projectFolders!==undefined&&x.projectFolders!==null&&(!Array.isArray(x.projectFolders)||x.projectFolders.some(item=>typeof item!=='string'))))fail('chats');
 for(const x of skills)if(typeof x.description!=='string'||typeof x.enabled!=='boolean')fail('skills');
 for(const x of mcp){if(typeof x.enabled!=='boolean')fail('mcpServers');try{validateMcp(x as McpServer)}catch{return fail('mcpServers')}}
 for(const x of schedules){if(typeof x.enabled!=='boolean'||!time(x.nextAt)||!text(x.gatewayUrl)||!text(x.modelId))fail('schedules');try{validateSchedule(x as Schedule)}catch{return fail('schedules')}}
 for(const x of runs)if(!text(x.scheduleId)||!time(x.plannedAt)||!['running','completed','failed','missed','skipped'].includes(String(x.status))||(x.startedAt!==undefined&&!time(x.startedAt))||(x.finishedAt!==undefined&&!time(x.finishedAt))||!nullableText(x.chatId)||(x.detail!==undefined&&typeof x.detail!=='string'))fail('scheduleRuns');
 return {preferences:p as Preferences,projects:projects as StoredProject[],chats:chats as ChatSummary[],skills:skills as LocalSkill[],mcpServers:mcp as McpServer[],schedules:schedules as Schedule[],scheduleRuns:runs as ScheduleRun[]};
}
