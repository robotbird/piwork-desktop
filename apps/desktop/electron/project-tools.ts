import {defineTool} from '@earendil-works/pi-coding-agent';
import {Type} from 'typebox';
import {constants,promises as fs} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {listProjectEntries,readProjectText,readProjectImage,resolveInside,splitProjectPath,splitWritePath,type ProjectRoot} from './project-files.ts';
import {readDocumentText} from './file-text.ts';
import {generateOffice} from './office-generate.ts';

const supported=new Set(['.txt','.md','.markdown','.json','.csv','.tsv','.js','.ts','.tsx','.jsx','.css','.html','.xml','.yaml','.yml','.py','.sh','.log']);
const result=(text:string)=>({content:[{type:'text' as const,text}],details:undefined});
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
type Approve=(id:string,name:string,input:unknown)=>Promise<boolean>;
async function readForTask(roots:ProjectRoot[],relative:string){const {root,relative:rel}=splitProjectPath(roots,relative);return readDocumentText(root,rel)}
/** Only exposes project-relative, bounded text operations. This is not an OS sandbox. */
/** roots[0] 为主文件夹:全部源文件夹可读,project_write/project_create_office 仅主文件夹可写 */
export function createProjectTools(roots:ProjectRoot[],approve:Approve,supportsImages=false){
 const pathSchema=Type.Object({path:Type.String({description:'Project-relative path; top-level names are the project source folders returned by project_list'})});
 return [
  defineTool({name:'project_list',label:'List project files',description:'List files and folders in the selected project. Use an empty path to list the source folders (the first is the main folder where files are created).',parameters:pathSchema,execute:async(_id,{path:relative})=>{const entries=await listProjectEntries(roots,relative);return result(JSON.stringify({entries:entries.slice(0,200),truncated:entries.length>200,...(relative?'':{folders:roots.map((item,index)=>({name:item.label,main:index===0}))})}))}}),
  defineTool({name:'project_read',label:'Read project file',description:'Read a project-relative text, PDF, Office or supported image file from any source folder. Office documents return extracted text. Image reading requires a vision-capable model.',parameters:pathSchema,execute:async(_id,{path:relative})=>{if(/\.(png|jpe?g|gif|webp)$/i.test(relative)){if(!supportsImages)throw new Error('Image input is disabled for this model');const {root,relative:rel}=splitProjectPath(roots,relative);const image=await readProjectImage(root,rel);return {content:[{type:'text' as const,text:`Image: ${relative}`},{type:'image' as const,data:image.base64,mimeType:image.mime}],details:undefined}}return result(await readForTask(roots,relative))}}),
  defineTool({name:'project_create_office',label:'Create Office file',description:'Create a new DOCX, XLSX or PPTX file in the main project folder. Supply paragraphs for documents, rows for a table, and slides for a presentation. Existing files are never overwritten. Requires user confirmation.',parameters:Type.Object({path:Type.String(),title:Type.String(),paragraphs:Type.Optional(Type.Array(Type.String())),rows:Type.Optional(Type.Array(Type.Array(Type.String()))),slides:Type.Optional(Type.Array(Type.Object({title:Type.String(),body:Type.String()})))}),executionMode:'sequential',execute:async(id,params,signal)=>{
   const write=splitWritePath(roots,params.path);const root=write.root;const relative=write.relative;const ext=path.extname(relative).toLowerCase();if(!relative||path.isAbsolute(relative)||relative.includes('\0')||!['.docx','.xlsx','.pptx'].includes(ext))throw new Error('Invalid project file');const parts=relative.split('/');if(parts.some(p=>!p||p==='.'||p==='..'||p.includes('\\')))throw new Error('Invalid project path');const filename=parts.pop()!,parent=await resolveInside(root,parts.join('/')),target=path.join(parent,filename);
   try{await fs.lstat(target);throw new Error('File already exists')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
   const bytes=await generateOffice(ext,params);if(bytes.length>20*1024*1024)throw new Error('Document too large');if(signal?.aborted||!await approve(id,'project_create_office',{path:relative,action:'create',bytes:bytes.length}))throw new Error('File write not approved');if(signal?.aborted)throw new Error('File write cancelled');if(await resolveInside(root,parts.join('/'))!==parent)throw new Error('Project folder changed');
   const temp=path.join(parent,`.piwork-${randomUUID()}.tmp`);let created=false;try{const handle=await fs.open(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);created=true;try{await handle.writeFile(bytes);await handle.sync()}finally{await handle.close()}if(signal?.aborted)throw new Error('File write cancelled');await fs.link(temp,target);await fs.unlink(temp)}catch(error){if(created)await fs.unlink(temp).catch(()=>{});throw error}return result(`Created ${relative}`);
  }}),
  defineTool({name:'project_write',label:'Write project file',description:'Create or replace a project text file in the main project folder. A user confirmation is required before any write. Parent folder must already exist.',parameters:Type.Object({path:Type.String({description:'Project-relative path'}),content:Type.String({description:'Complete UTF-8 file content'})}),executionMode:'sequential',execute:async(id,{path:relative,content},signal)=>{
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
   return result(`Saved ${relative}`);
  }}),
 ];
}
