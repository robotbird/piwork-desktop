import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
const MAX_BYTES = 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['.txt','.md','.markdown','.json','.csv','.tsv','.js','.ts','.tsx','.jsx','.css','.html','.xml','.yaml','.yml','.py','.sh','.log']);

export async function resolveInside(root: string, relative: string): Promise<string> {
  if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative)) throw new Error('Invalid path');
  const pieces = relative ? relative.split('/') : [];
  if (pieces.some(piece => !piece || piece === '.' || piece === '..' || piece.includes('\\'))) throw new Error('Invalid path');
  let current = await fs.realpath(root);
  for (const piece of pieces) {
    current = path.join(current, piece);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Symbolic links are not supported');
  }
  return current;
}
/** 多源文件夹项目的根集合;roots[0] 为主文件夹(可写、默认根) */
export type ProjectRoot={root:string;label:string};
/** 把项目虚拟路径拆到具体 root:首段匹配 label 进入对应文件夹,否则落到主文件夹(兼容旧提示词) */
export function splitProjectPath(roots:ProjectRoot[],relative:string):{root:string;relative:string}{
 if(!Array.isArray(roots)||!roots.length)throw new Error('Project unavailable');
 if(typeof relative!=='string'||relative.includes('\0')||path.isAbsolute(relative))throw new Error('Invalid path');
 const first=relative?relative.split('/')[0]:'';
 const match=first?roots.find(item=>item.label===first):undefined;
 if(match)return {root:match.root,relative:relative.slice(match.label.length+1)};
 return {root:roots[0].root,relative};
}
/** 写入路径拆分:仅主文件夹可写,显式指向其他源文件夹时报错 */
export function splitWritePath(roots:ProjectRoot[],relative:string):{root:string;relative:string}{
 if(!Array.isArray(roots)||!roots.length)throw new Error('Project unavailable');
 if(typeof relative!=='string')throw new Error('Invalid path');
 const first=relative?relative.split('/')[0]:'';
 const match=first?roots.find(item=>item.label===first):undefined;
 if(match&&match.root!==roots[0].root)throw new Error('Read-only project folder; writes are only allowed in the main folder');
 return {root:roots[0].root,relative:match?relative.slice(match.label.length+1):relative};
}
export async function resolveProjectPath(roots:ProjectRoot[],relative:string):Promise<string>{
 const target=splitProjectPath(roots,relative);
 return resolveInside(target.root,target.relative);
}
/** 根层列出各源文件夹(label 目录);进入 label 后为该文件夹内列表 */
export async function listProjectEntries(roots:ProjectRoot[],relative=''){
 if(typeof relative!=='string')throw new Error('Invalid path');
 if(!relative)return roots.map(item=>({name:item.label,path:item.label,kind:'directory' as const}));
 const target=splitProjectPath(roots,relative);
 return listProjectFiles(target.root,target.relative);
}
/** 跨所有源文件夹搜索,结果带 label/ 前缀 */
export async function searchProjectEntries(roots:ProjectRoot[],query:string){
 if(typeof query!=='string'||!query.trim()||query.length>200)throw new Error('Invalid search');
 const matches:{name:string;path:string;kind:'file'}[]=[];
 for(const item of roots){
  let found:Awaited<ReturnType<typeof searchProjectFiles>>;
  try{found=await searchProjectFiles(item.root,query)}catch{continue}
  for(const entry of found){matches.push({name:entry.name,path:`${item.label}/${entry.path}`,kind:'file'});if(matches.length>=100)break}
  if(matches.length>=100)break;
 }
 return matches;
}
export async function saveProjectMarkdown(root:string,relative:string,content:string):Promise<void> {
  if(typeof relative!=='string'||typeof content!=='string'||!content.trim()||Buffer.byteLength(content,'utf8')>1024*1024) throw new Error('Invalid content');
  if(!relative || path.isAbsolute(relative) || relative.includes('\0') || path.extname(relative).toLowerCase()!=='.md') throw new Error('Invalid path');
  const parts=relative.split('/');
  if(parts.some(part=>!part||part==='.'||part==='..'||part.includes('\\'))) throw new Error('Invalid path');
  const filename=parts.pop()!;
  const parent=await resolveInside(root,parts.join('/'));
  const handle=await fs.open(path.join(parent,filename),constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try { await handle.writeFile(content,{encoding:'utf8'}); } finally { await handle.close(); }
}

export async function listProjectFiles(root: string, relative = '') {
  const dir = await resolveInside(root, relative);
  const entries = await fs.readdir(dir, {withFileTypes:true});
  return entries.filter(e => e.isFile() || e.isDirectory()).sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name)).map(e=>({name:e.name,path:relative ? `${relative}/${e.name}` : e.name,kind:e.isDirectory()?'directory' as const:'file' as const}));
}
export async function searchProjectFiles(root:string,query:string) {
  if(typeof query!=='string'||!query.trim()||query.length>200)throw new Error('Invalid search');
  const term=query.trim().toLocaleLowerCase();const matches:{name:string;path:string;kind:'file'}[]=[];const pending=[''];let visited=0;
  while(pending.length&&visited<10000&&matches.length<100){
    const relative=pending.shift()!;let entries:Awaited<ReturnType<typeof listProjectFiles>>;
    try{entries=await listProjectFiles(root,relative)}catch{if(!relative)throw new Error('Project unavailable');continue}
    for(const entry of entries){if(++visited>10000)break;if(entry.kind==='directory')pending.push(entry.path);else if(entry.name.toLocaleLowerCase().includes(term)){matches.push({name:entry.name,path:entry.path,kind:'file'});if(matches.length>=100)break}}
  }
  return matches;
}
export async function readProjectText(root: string, relative: string) {
  if (!TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) throw new Error('Unsupported file type');
  return readBoundedText(root,relative);
}
export async function readBoundedText(root: string, relative: string) {
  const target = await resolveInside(root, relative);
  const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Not a file');
    if (stat.size > MAX_BYTES) throw new Error('File too large');
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length-length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > MAX_BYTES) throw new Error('File too large');
    if (bytes.subarray(0,length).includes(0)) throw new Error('Not a text file');
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length));
  } finally { await handle.close(); }
}

const IMAGE_TYPES: Record<string,string> = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'};
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
function imageSignature(bytes: Buffer, mime: string): boolean {
  if (mime === 'image/png') return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/gif') return ['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii'));
  if (mime === 'image/webp') return bytes.length >= 12 && bytes.subarray(0,4).toString('ascii') === 'RIFF' && bytes.subarray(8,12).toString('ascii') === 'WEBP';
  return false;
}
export async function readProjectImage(root:string, relative:string): Promise<{mime:string;base64:string}> {
  const mime = IMAGE_TYPES[path.extname(relative).toLowerCase()];
  if (!mime) throw new Error('Unsupported image type');
  const target = await resolveInside(root,relative);
  const handle = await fs.open(target,constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Not a file');
    if (stat.size > MAX_IMAGE_BYTES) throw new Error('Image too large');
    const bytes = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes,length,bytes.length-length,length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > MAX_IMAGE_BYTES) throw new Error('Image too large');
    const image = bytes.subarray(0,length);
    if (!imageSignature(image,mime)) throw new Error('Invalid image');
    return {mime,base64:image.toString('base64')};
  } finally { await handle.close(); }
}

export async function readProjectPdf(root:string, relative:string): Promise<string> {
  if (path.extname(relative).toLowerCase() !== '.pdf') throw new Error('Unsupported PDF type');
  const target=await resolveInside(root,relative);
  const handle=await fs.open(target,constants.O_RDONLY | constants.O_NOFOLLOW);
  const limit=20*1024*1024;
  try {
    const stat=await handle.stat();
    if(!stat.isFile()) throw new Error('Not a file');
    if(stat.size>limit) throw new Error('PDF too large');
    const buffer=Buffer.alloc(limit+1);let length=0;
    while(length<buffer.length){const chunk=await handle.read(buffer,length,buffer.length-length,length);if(!chunk.bytesRead)break;length+=chunk.bytesRead}
    if(length>limit)throw new Error('PDF too large');
    if(buffer.subarray(0,5).toString('ascii')!=='%PDF-')throw new Error('Invalid PDF');
    return buffer.subarray(0,length).toString('base64');
  } finally { await handle.close(); }
}

async function readOfficeZip(root:string,relative:string,extension:'.docx'|'.xlsx'|'.pptx'):Promise<string> {
  if(path.extname(relative).toLowerCase()!==extension)throw new Error('Unsupported Office type');
  const target=await resolveInside(root,relative);
  const handle=await fs.open(target,constants.O_RDONLY | constants.O_NOFOLLOW);
  const limit=20*1024*1024;
  try {
    const stat=await handle.stat();
    if(!stat.isFile())throw new Error('Not a file');
    if(stat.size>limit)throw new Error('Office file too large');
    const bytes=Buffer.alloc(limit+1);let length=0;
    while(length<bytes.length){const result=await handle.read(bytes,length,bytes.length-length,length);if(!result.bytesRead)break;length+=result.bytesRead}
    if(length>limit)throw new Error('Office file too large');
    if(length<4||!bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04])))throw new Error('Invalid Office file');
    return bytes.subarray(0,length).toString('base64');
  } finally {await handle.close()}
}

export function readProjectDocx(root:string,relative:string) {return readOfficeZip(root,relative,'.docx')}
export function readProjectXlsx(root:string,relative:string) {return readOfficeZip(root,relative,'.xlsx')}
export function readProjectPptx(root:string,relative:string) {return readOfficeZip(root,relative,'.pptx')}
