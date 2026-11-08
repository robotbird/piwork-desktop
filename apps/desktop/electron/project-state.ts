import path from 'node:path';
import type { ChatSummary } from '../shared/types';
/** 持久化形态:不含运行时计算的 available */
export type StoredFolder={path:string;label:string;main:boolean};
export type StoredProject={id:string;name:string;description?:string;folders:StoredFolder[]};
const MAX_FOLDERS=20;

/** label 取 basename,在已占用集合内用 " (n)" 后缀去重 */
export function folderLabel(dirPath:string,taken:readonly string[]):string{
 const base=path.basename(dirPath)||dirPath;
 let label=base;let index=2;
 while(taken.includes(label))label=`${base} (${index++})`;
 return label;
}
/** 校验并归一化 folder 候选:去重、恰好一个 main(取第一个标记项,未标记则第一项),生成唯一 label */
export function normalizeFolders(input:unknown):StoredFolder[]{
 if(!Array.isArray(input)||!input.length)throw new Error('Project needs at least one folder');
 if(input.length>MAX_FOLDERS)throw new Error('Too many project folders');
 const seen=new Set<string>();const folders:{path:string;main:boolean}[]=[];
 for(const entry of input){
  if(!entry||typeof entry!=='object')throw new Error('Invalid project folder');
  const candidate=entry as {path?:unknown;main?:unknown};
  if(typeof candidate.path!=='string'||!candidate.path||!path.isAbsolute(candidate.path))throw new Error('Invalid project folder');
  if(seen.has(candidate.path))continue;
  seen.add(candidate.path);
  folders.push({path:candidate.path,main:candidate.main===true});
 }
 if(!folders.length)throw new Error('Project needs at least one folder');
 const mainIndex=folders.findIndex(folder=>folder.main);
 const normalized:StoredFolder[]=[];
 const taken:string[]=[];
 const ordered=mainIndex>0?[folders[mainIndex],...folders.slice(0,mainIndex),...folders.slice(mainIndex+1)]:folders;
 for(const folder of ordered){const label=folderLabel(folder.path,taken);taken.push(label);normalized.push({path:folder.path,label,main:normalized.length===0})}
 return normalized;
}
/** 旧版单路径记录({path:string})升级为 folders;已是新形态的做形状归一 */
export function normalizeStoredProject(project:unknown):StoredProject{
 if(!project||typeof project!=='object')throw new Error('Invalid project');
 const value=project as {id?:unknown;name?:unknown;description?:unknown;path?:unknown;folders?:unknown};
 if(typeof value.id!=='string'||!value.id||typeof value.name!=='string'||!value.name)throw new Error('Invalid project');
 if(value.description!==undefined&&typeof value.description!=='string')throw new Error('Invalid project');
 const folders=Array.isArray(value.folders)&&value.folders.length?normalizeFolders(value.folders)
  :typeof value.path==='string'&&value.path?normalizeFolders([{path:value.path,main:true}])
  :[{path:'',label:'',main:true}];
 return {id:value.id,name:value.name,...(typeof value.description==='string'?{description:value.description}:{}),folders};
}
export function addProject(projects:StoredProject[],candidate:StoredProject):{projects:StoredProject[];selected:StoredProject} {
 // 任一文件夹已属于某个项目:与旧版语义一致,切换到已有项目
 const candidatePaths=new Set(candidate.folders.map(folder=>folder.path));
 const existing=projects.find(project=>project.folders.some(folder=>candidatePaths.has(folder.path)));
 return existing?{projects,selected:existing}:{projects:[...projects,candidate],selected:candidate};
}
export function removeProject(projects:StoredProject[],id:string):StoredProject[] {
 return projects.filter(project=>project.id!==id);
}
export function updateProject(projects:StoredProject[],id:string,input:{name:string;description:string;folders?:{path:string;main:boolean}[]}):StoredProject[] {
 if(!projects.some(project=>project.id===id))throw new Error('Project not found');
 if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>100||typeof input.description!=='string'||input.description.length>1000)throw new Error('Invalid project details');
 let folders:StoredFolder[]|undefined;
 if(input.folders!==undefined){
  folders=normalizeFolders(input.folders);
  // 跨项目占用检查:任一路径被其他项目使用则拒绝
  if(projects.some(project=>project.id!==id&&project.folders.some(folder=>folders!.some(item=>item.path===folder.path))))throw new Error('Directory already used');
 }
 return projects.map(project=>project.id===id?{...project,name:input.name.trim(),description:input.description.trim(),...(folders?{folders}:{})}:project);
}
/** 项目文件夹变化/移除前,为缺少快照的历史对话补记当时的路径(主文件夹在前) */
export function preserveChatProjectPaths(chats:ChatSummary[],project:StoredProject):ChatSummary[] {
 const main=project.folders.find(folder=>folder.main)??project.folders[0];
 const paths=project.folders.map(folder=>folder.path);
 return chats.map(chat=>chat.projectId===project.id&&chat.projectPath===undefined?{...chat,projectPath:main?.path??null,projectFolders:paths}:chat);
}
