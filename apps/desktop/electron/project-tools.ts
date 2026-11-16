import {defineTool} from '@earendil-works/pi-coding-agent';
import {Type} from 'typebox';
import {constants,promises as fs} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {listProjectEntries,readProjectText,readProjectImage,resolveInside,splitProjectPath,splitWritePath,type ProjectRoot} from './project-files.ts';
import {readDocumentText} from './file-text.ts';
import {generateOffice,normalizeOfficeBlocks,normalizeOfficeDocOptions,type OfficeBlock,type OfficeContent,type OfficeDocOptions} from './office-generate.ts';

const supported=new Set(['.txt','.md','.markdown','.json','.csv','.tsv','.js','.ts','.tsx','.jsx','.css','.html','.xml','.yaml','.yml','.py','.sh','.log']);
const result=(text:string)=>({content:[{type:'text' as const,text}],details:undefined});
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
type Approve=(id:string,name:string,input:unknown)=>Promise<boolean>;
async function readForTask(roots:ProjectRoot[],relative:string){const {root,relative:rel}=splitProjectPath(roots,relative);return readDocumentText(root,rel)}

/** agent 视觉自检回调:worker 经 main 的 LibreOffice 引擎把 Office 渲染成 PNG(office-preview.renderPages) */
export type RenderPages=(absPath:string,pages:unknown)=>Promise<{pageCount:number;missingFonts:string[];images:{data:string;mimeType:string;width:number;height:number}[]}>;

export interface ProjectToolOptions{
 /** workspace:无项目会话的聊天专属输出目录(我的文档/AI 生成/<会话文件夹>),允许覆盖本会话文件 */
 mode?:'workspace';
 /** 提供且模型支持图片时注册 office_render 视觉自检工具 */
 renderPages?:RenderPages;
}

const blocksSchema=Type.Optional(Type.Union([
 Type.Array(Type.Object({type:Type.String({description:'heading|paragraph|list|quote|code|table|divider|pageBreak|cover'})},{additionalProperties:true})),
 Type.String({description:'JSON-encoded array of block objects, accepted if you send blocks as a string'}),
],{description:'Document blocks for DOCX: heading {level 1-3,text,align}, paragraph {text or runs:[{text,bold,italic,code,color}]}, list {ordered,items}, quote {text}, code {text}, table {header,rows}, divider, pageBreak, cover {subtitle,meta (array of short strings or a single line)}'}));
const docOptionsSchema=Type.Optional(Type.Object({footer:Type.Optional(Type.Boolean({description:'Add a page-number footer (第 X 页)'})),accent:Type.Optional(Type.String({description:'Heading accent color, 3 or 6 hex digits e.g. 1F4E79 (leading # accepted)'}))},{additionalProperties:true}));

/* 分块写文档(长文档单次工具调用会超模型输出上限被截断):create 把归一化后的 blocks 存进
   同目录隐藏 sidecar,append 读取合并后整体重建 docx。sidecar 只是生成源(非用户数据),
   点前缀避免出现在项目/文档库文件列表里 */
type BlocksSidecar={version:1;title:string;doc?:OfficeDocOptions;blocks:OfficeBlock[]};
const sidecarName=(filename:string)=>`.${filename}.blocks.json`;
async function readBlocksSidecar(target:string):Promise<BlocksSidecar>{
 let raw:string;
 try{raw=await fs.readFile(path.join(path.dirname(target),sidecarName(path.basename(target))),'utf8')}catch{throw new Error('No saved blocks for this file; recreate it with project_create_office using blocks first')}
 try{
  const parsed=JSON.parse(raw) as BlocksSidecar;
  if(parsed?.version!==1||typeof parsed.title!=='string'||!Array.isArray(parsed.blocks))throw new Error('bad shape');
  return parsed;
 }catch{throw new Error('The saved blocks for this file are unreadable; recreate it with project_create_office')}
}
async function writeBlocksSidecar(target:string,sidecar:BlocksSidecar):Promise<void>{
 const sidecarPath=path.join(path.dirname(target),sidecarName(path.basename(target)));
 const temp=`${sidecarPath}.${randomUUID()}.tmp`;
 await fs.writeFile(temp,JSON.stringify(sidecar),'utf8');
 await fs.rename(temp,sidecarPath);
}

/** Only exposes project-relative, bounded text operations. This is not an OS sandbox. */
/** roots[0] 为主文件夹:全部源文件夹可读,project_write/project_create_office 仅主文件夹可写;
    workspace 模式(无项目)以聊天专属输出目录为唯一根,描述与覆盖语义相应调整 */
export function createProjectTools(roots:ProjectRoot[],approve:Approve,supportsImages=false,options:ProjectToolOptions={}){
 const workspace=options.mode==='workspace';
 const renderPages=options.renderPages;
 const pathSchema=Type.Object({path:Type.String({description:workspace?'File name inside your PiWork documents output folder, e.g. "报告.docx"; no folder prefixes':'Project-relative path; top-level names are the project source folders returned by project_list'})});
 const listDescription=workspace
  ?'List files you created in this chat. Use an empty path; the single folder is your PiWork documents output folder.'
  :'List files and folders in the selected project. Use an empty path to list the source folders (the first is the main folder where files are created).';
 const readDescription=workspace
  ?'Read a text, PDF, Office or supported image file you created in the PiWork documents output folder. Office documents return extracted text. Image reading requires a vision-capable model.'
  :'Read a project-relative text, PDF, Office or supported image file from any source folder. Office documents return extracted text. Image reading requires a vision-capable model.';
 const officeDescription=workspace
  ?`Create a new DOCX, XLSX or PPTX file in the PiWork documents folder (shown under 我的文档 → AI 生成). Supply paragraphs for documents, rows for a table, slides for a presentation, or structured blocks for a well-formatted Word document (headings, bold runs, lists, tables, cover, page-number footer). The tool returns the absolute path — link that exact path in your reply. Existing files you created may be replaced to apply fixes. Requires user confirmation.`
  :`Create a new DOCX, XLSX or PPTX file in the main project folder. Supply paragraphs for documents, rows for a table, slides for a presentation, or structured blocks for a well-formatted Word document (headings, bold runs, lists, tables, cover, page-number footer). Existing files are never overwritten. Requires user confirmation.`;
 const writeDescription=workspace
  ?'Create or replace a text file (md/html/csv/json/…) in the PiWork documents folder. A user confirmation is required before any write.'
  :'Create or replace a project text file in the main project folder. A user confirmation is required before any write. Parent folder must already exist.';
 return [
  defineTool({name:'project_list',label:'List project files',description:listDescription,parameters:pathSchema,execute:async(_id,{path:relative})=>{const entries=await listProjectEntries(roots,relative);return result(JSON.stringify({entries:entries.slice(0,200),truncated:entries.length>200,...(relative?'':{folders:roots.map((item,index)=>({name:item.label,main:index===0}))})}))}}),
  defineTool({name:'project_read',label:'Read project file',description:readDescription,parameters:pathSchema,execute:async(_id,{path:relative})=>{if(/\.(png|jpe?g|gif|webp)$/i.test(relative)){if(!supportsImages)throw new Error('Image input is disabled for this model');const {root,relative:rel}=splitProjectPath(roots,relative);const image=await readProjectImage(root,rel);return {content:[{type:'text' as const,text:`Image: ${relative}`},{type:'image' as const,data:image.base64,mimeType:image.mime}],details:undefined}}return result(await readForTask(roots,relative))}}),
  defineTool({name:'project_create_office',label:'Create Office file',description:officeDescription,parameters:Type.Object({path:Type.String(),title:Type.String(),paragraphs:Type.Optional(Type.Array(Type.String())),rows:Type.Optional(Type.Array(Type.Array(Type.String()))),slides:Type.Optional(Type.Array(Type.Object({title:Type.String(),body:Type.String()}))),blocks:blocksSchema,doc:docOptionsSchema}),executionMode:'sequential',execute:async(id,params,signal)=>{
   const write=splitWritePath(roots,params.path);const root=write.root;const relative=write.relative;const ext=path.extname(relative).toLowerCase();if(!relative||path.isAbsolute(relative)||relative.includes('\0')||!['.docx','.xlsx','.pptx'].includes(ext))throw new Error('Invalid project file');const parts=relative.split('/');if(parts.some(p=>!p||p==='.'||p==='..'||p.includes('\\')))throw new Error('Invalid project path');const filename=parts.pop()!,parent=await resolveInside(root,parts.join('/')),target=path.join(parent,filename);
   const exists=await fs.lstat(target).then(()=>true).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error});
   if(exists&&!workspace)throw new Error('File already exists');
   const normalizedBlocks=params.blocks===undefined?undefined:normalizeOfficeBlocks(params.blocks);
   const normalizedDoc=normalizeOfficeDocOptions(params.doc);
   const bytes=await generateOffice(ext,{title:params.title,paragraphs:params.paragraphs,rows:params.rows,slides:params.slides,blocks:normalizedBlocks,doc:normalizedDoc});if(bytes.length>20*1024*1024)throw new Error('Document too large');if(signal?.aborted||!await approve(id,'project_create_office',{path:relative,action:exists?'replace':'create',bytes:bytes.length}))throw new Error('File write not approved');if(signal?.aborted)throw new Error('File write cancelled');if(await resolveInside(root,parts.join('/'))!==parent)throw new Error('Project folder changed');
   const temp=path.join(parent,`.piwork-${randomUUID()}.tmp`);let created=false;try{const handle=await fs.open(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);created=true;try{await handle.writeFile(bytes);await handle.sync()}finally{await handle.close()}if(signal?.aborted)throw new Error('File write cancelled');if(exists)await fs.rename(temp,target);else{await fs.link(temp,target);await fs.unlink(temp)}}catch(error){if(created)await fs.unlink(temp).catch(()=>{});throw error}
   /* blocks 来源的文档保存 sidecar,供 project_append_office 分块续写 */
   if(normalizedBlocks)await writeBlocksSidecar(target,{version:1,title:params.title,...(normalizedDoc?{doc:normalizedDoc}:{}),blocks:normalizedBlocks}).catch(()=>{});
   return workspace?result(`Created ${relative}\n${target}`):result(`Created ${relative}`);
  }}),
  defineTool({name:'project_append_office',label:'Append to Office file',description:'Append more blocks to a DOCX created with project_create_office blocks. Build long documents in several calls that each stay well below your output token limit: create the file with the first group of blocks, then append the next groups in order. Never repeat earlier blocks in an append. Requires user confirmation.',parameters:Type.Object({path:Type.String({description:workspace?'File name inside your PiWork documents output folder':'Project-relative path'}),blocks:Type.Union([Type.Array(Type.Object({type:Type.String({description:'heading|paragraph|list|quote|code|table|divider|pageBreak|cover'})},{additionalProperties:true})),Type.String({description:'JSON-encoded array of block objects'})],{description:'The next document blocks to append (same shapes as project_create_office)'})}),executionMode:'sequential',execute:async(id,params,signal)=>{
   const write=splitWritePath(roots,params.path);const root=write.root;const relative=write.relative;const ext=path.extname(relative).toLowerCase();if(!relative||path.isAbsolute(relative)||relative.includes('\0')||ext!=='.docx')throw new Error('Invalid project file');const parts=relative.split('/');if(parts.some(p=>!p||p==='.'||p==='..'||p.includes('\\')))throw new Error('Invalid project path');const filename=parts.pop()!,parent=await resolveInside(root,parts.join('/')),target=path.join(parent,filename);
   const sidecarPath=path.join(parent,sidecarName(filename));
   const before=await fs.readFile(sidecarPath,'utf8').catch(()=>{throw new Error('No saved blocks for this file; recreate it with project_create_office using blocks first')});
   let sidecar:BlocksSidecar;try{sidecar=JSON.parse(before) as BlocksSidecar;if(sidecar?.version!==1||typeof sidecar.title!=='string'||!Array.isArray(sidecar.blocks))throw new Error('bad shape')}catch{throw new Error('The saved blocks for this file are unreadable; recreate it with project_create_office')}
   const incoming=normalizeOfficeBlocks(params.blocks);
   const bytes=await generateOffice('.docx',{title:sidecar.title,blocks:[...sidecar.blocks,...incoming],doc:sidecar.doc});if(bytes.length>20*1024*1024)throw new Error('Document too large');
   if(signal?.aborted||!await approve(id,'project_append_office',{path:relative,action:'append',appended:incoming.length,bytes:bytes.length}))throw new Error('File write not approved');
   if(signal?.aborted)throw new Error('File write cancelled');
   if(await resolveInside(root,parts.join('/'))!==parent)throw new Error('Project folder changed');
   if(sha(await fs.readFile(sidecarPath,'utf8').catch(()=>''))!==sha(before))throw new Error('File changed while awaiting approval');
   const temp=path.join(parent,`.piwork-${randomUUID()}.tmp`);let created=false;try{const handle=await fs.open(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);created=true;try{await handle.writeFile(bytes);await handle.sync()}finally{await handle.close()}if(signal?.aborted)throw new Error('File write cancelled');await fs.rename(temp,target)}catch(error){if(created)await fs.unlink(temp).catch(()=>{});throw error}
   await writeBlocksSidecar(target,{version:1,title:sidecar.title,...(sidecar.doc?{doc:sidecar.doc}:{}),blocks:[...sidecar.blocks,...incoming]});
   return workspace?result(`Appended ${incoming.length} blocks to ${relative}\n${target}`):result(`Appended ${incoming.length} blocks to ${relative}`);
  }}),
  defineTool({name:'project_write',label:'Write project file',description:writeDescription,parameters:Type.Object({path:Type.String({description:workspace?'File name inside your PiWork documents output folder':'Project-relative path'}),content:Type.String({description:'Complete UTF-8 file content'})}),executionMode:'sequential',execute:async(id,{path:relative,content},signal)=>{
   const write=splitWritePath(roots,relative);const root=write.root;relative=write.relative;
   if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.includes('\0')||!supported.has(path.extname(relative).toLowerCase())||typeof content!=='string'||content.includes('\0')||Buffer.byteLength(content,'utf8')>1024*1024)throw new Error('Invalid project file');
   const parts=relative.split('/');if(parts.some(p=>!p||p==='.'||p==='..'||p.includes('\\')))throw new Error('Invalid project path');const filename=parts.pop()!;const parent=await resolveInside(root,parts.join('/'));const target=path.join(parent,filename);
   let previous:string|undefined;let previousMode=0o600;try{previous=await readProjectText(root,relative);previousMode=(await fs.stat(target)).mode&0o777}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
   if(signal?.aborted||!await approve(id,'project_write',{path:relative,action:previous===undefined?'create':'replace',bytes:Buffer.byteLength(content,'utf8')}))throw new Error('File write not approved');
   if(signal?.aborted)throw new Error('File write cancelled');
   const checkedParent=await resolveInside(root,parts.join('/'));if(checkedParent!==parent)throw new Error('Project folder changed');
   if(previous!==undefined){const current=await readProjectText(root,relative);if(sha(current)!==sha(previous))throw new Error('File changed while awaiting approval')}else{try{await fs.lstat(target);throw new Error('File already exists')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}
   const temporary=path.join(parent,`.piwork-${randomUUID()}.tmp`);let created=false;
   try{const fd=await fs.open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,previousMode);created=true;try{await fd.chmod(previousMode);await fd.writeFile(content,'utf8');await fd.sync()}finally{await fd.close()}
   if(signal?.aborted)throw new Error('File write cancelled');if(previous===undefined){await fs.link(temporary,target);await fs.unlink(temporary)}else{if(sha(await readProjectText(root,relative))!==sha(previous))throw new Error('File changed while writing');await fs.rename(temporary,target)}}catch(error){if(created)await fs.unlink(temporary).catch(()=>{});throw error}
   return workspace?result(`Saved ${relative}\n${target}`):result(`Saved ${relative}`);
  }}),
  ...(renderPages&&supportsImages?[defineTool({name:'office_render',label:'Render Office pages',description:'Render a DOCX/PPTX (pages) or XLSX (worksheets) you created to PNG images for visual layout inspection. Inspect the returned images: check clipped tables, overlapping or garbled text, broken numbering, blank pages. Uniformly blank or transparent images mean a renderer failure — stop visual checks. Re-render only after changing the file.',parameters:Type.Object({path:Type.String({description:workspace?'File name inside your PiWork documents output folder':'Project-relative path'}),pages:Type.Optional(Type.Array(Type.Number({description:'One-based page numbers, DOCX/PPTX only'}),{description:'Pages to render; defaults to the first two'}))}),execute:async(_id,{path:relative,pages})=>{
   const {root,relative:rel}=splitProjectPath(roots,relative);const target=await resolveInside(root,rel);
   if(!/\.(docx|xlsx|pptx)$/i.test(target))throw new Error('Only DOCX, XLSX or PPTX files can be rendered');
   const outcome=await renderPages(target,pages);
   return {content:[{type:'text' as const,text:JSON.stringify({file:relative,pageCount:outcome.pageCount,rendered:outcome.images.length,missingFonts:outcome.missingFonts})},...outcome.images.map(image=>({type:'image' as const,data:image.data,mimeType:image.mimeType}))],details:undefined};
  }})]:[]),
 ];
}
